import { log } from "./log.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import type {
  Agent, AgentConfig, AgentDraft, AgentStatus, Channel, GitSettings, KeyStatus, Message, MessageKind, Provider, ProviderConfig, ProviderSettings, ProviderStatus, Question, QuestionKind,
  Run, RunDiff, RunStatus, RunStep, RunStepKind, RunTrigger, SpendSummary, SupervisorStatus, TeamConfig, TeamDraft,
} from "@crew/shared";
import { dmChannelId, providerLabel, providerSpec } from "@crew/shared";
import { Bus } from "./bus.js";
import { Db } from "./db.js";
import { runDiff } from "./git.js";
import { Store } from "./store.js";
import { SkillLibrary } from "./skills.js";
import { Backlog } from "./backlog.js";
import { watchTeamFolder, type FolderWatch } from "./folder-watch.js";
import { DEFAULTS } from "./config.js";
import { DEFAULT_DEV_RULES } from "./permissions.js";
import { defaultSettings, hasClaudeLogin, preferredProvider, readSettings, statusFor, writeSettings, type Keys } from "./providers.js";

export type { Keys };

export interface CrewOptions {
  /** This team's folder: team.json, agents/, crew.db */
  dataDir: string;
  /** Shared across teams: providers.json */
  globalDir: string;
  /** Shared key object owned by the hub */
  keys: Keys;
  /** A short-lived crew opened only to read global settings: it owns nothing and watches nothing. */
  transient?: boolean;
  /**
   * Where this supervisor's WebSocket API is listening. A spawned coding-agent CLI reaches its
   * team through the stdio MCP bridge, which needs both to connect back.
   */
  api?: { port: number; token: string };
}

interface AgentRuntime {
  status: AgentStatus;
  statusText: string;
  currentRunId: string | null;
  nextWakeAt: string | null;
}

/**
 * The one object that owns the team's state. Tools, the scheduler and the API all go through it,
 * so every change is persisted once and broadcast once.
 */
export class Crew {
  readonly db: Db;
  readonly store: Store;
  /** User, team and agent skills, and everything that installs or edits them. */
  readonly skills: SkillLibrary;
  /** What the team has decided is worth doing, in the team folder so it travels with the project. */
  readonly backlog: Backlog;
  readonly bus = new Bus();
  readonly startedAt = new Date().toISOString();
  team: TeamConfig | null;
  readonly keys: Keys;
  /**
   * Whether the owner has stopped the whole team. Backed by team.json, not by a field: this used
   * to live only in memory, so quitting the app and opening it again quietly started a paused
   * team back up — the one thing a pause must never do.
   */
  get pausedAll(): boolean {
    return this.team?.paused ?? false;
  }
  set pausedAll(value: boolean) {
    if (!this.team || this.team.paused === value) return;
    this.updateTeam({ paused: value });
  }

  /**
   * The gentler stop: the owner has asked the team to down tools, but only once the work that is
   * already running has finished. Nothing new is queued or started while this is set, and the
   * queue flips it into a real `pausedAll` when the last run ends. Persisted alongside `paused`,
   * so a supervisor that restarts mid-wind-down does not quietly start everything up again.
   */
  get pauseWhenIdle(): boolean {
    return this.team?.pauseWhenIdle ?? false;
  }
  set pauseWhenIdle(value: boolean) {
    if (!this.team || (this.team.pauseWhenIdle ?? false) === value) return;
    this.updateTeam({ pauseWhenIdle: value });
  }

  /** True while the team is either stopped or on its way there: nothing new may start. */
  get stopping(): boolean {
    return this.pausedAll || this.pauseWhenIdle;
  }

  /** This supervisor's API endpoint, for CLIs that join the team over the stdio MCP bridge. */
  get api(): { port: number; token: string } | undefined {
    return this.opts.api;
  }

  /** Runs cut off by a restart, waiting for the scheduler to start them again. Read once. */
  interrupted: Run[] = [];
  private folderWatch: FolderWatch | null = null;
  /** Set by close(). A debounced folder event can land after teardown and must not touch the db. */
  private closed = false;

  private readonly runtime = new Map<string, AgentRuntime>();
  private readonly waiters = new Map<string, (answer: string | null) => void>();
  private readonly lastFailNotifyAt = new Map<string, number>();

  constructor(readonly opts: CrewOptions) {
    fs.mkdirSync(opts.dataDir, { recursive: true });
    this.keys = opts.keys;
    this.db = new Db(opts.dataDir);
    this.store = new Store(opts.dataDir);
    this.team = this.store.readTeam();
    const store = this.store;
    const crew = this;
    this.skills = new SkillLibrary({
      user: path.join(opts.globalDir, "skills"),
      team: store.teamSkillsDir,
      get teamId(): string | null { return crew.team?.id ?? null; },
      agent: (id) => store.agentSkillsDir(id),
      agentDir: (id) => store.agentDir(id),
    });
    this.backlog = new Backlog(opts.dataDir);
    // Runs that were still going when the process stopped. They are closed out here and handed
    // to the scheduler, which starts each one again with what the interrupted run got through.
    this.interrupted = this.db.recoverStaleRuns();
    if (this.interrupted.length) log(`${this.interrupted.length} run(s) were cut off by a restart; they will be picked up again`, { team: this.team?.id });
    this.restoreChannels();
    this.ensureGeneral();
    this.pruneMissingChannels();
    this.watchFolder();
    for (const a of this.store.listAgentConfigs()) this.ensureDm(a.id); // teams created before direct chats existed
  }

  get id(): string | null {
    return this.team?.id ?? null;
  }
  /** True once close() has run. A run still in flight must not write to a database that has gone. */
  get isClosed(): boolean {
    return this.closed;
  }
  /**
   * Follow the folder. A team is files so a person can edit them; when they do, the running app
   * should already agree with what is on disk rather than needing a restart.
   */
  private watchFolder(): void {
    // Not conditional on a team existing yet: a crew is often constructed before its team.json is
    // written, and the folder is the thing being watched either way. A throwaway crew opened only
    // to read the global settings is the exception: nobody closes it, so a watcher on it would
    // outlive every team and fire against a database that has since gone.
    if (this.folderWatch || this.opts.transient) return;
    this.folderWatch = watchTeamFolder(this.opts.dataDir, () => {
      // A debounced event can land in the moment between close() and the timer being cleared, and
      // during shutdown the folder may be going away underneath us. Neither is worth a crash.
      try { this.reloadFromDisk(); }
      catch (e) { if (!this.closed) log(`could not reload the team folder: ${e instanceof Error ? e.message : String(e)}`, { team: this.team?.id }); }
    });
  }

  /**
   * Re-read what the team is. Safe to call at any time: everything here is derived from the files
   * rather than accumulated, so an edit, a new agent folder, or a deleted one all land the same way.
   */
  reloadFromDisk(): void {
    if (this.closed) return;
    const before = this.store.listAgentConfigs().map((a) => a.id).join(",");
    this.team = this.store.readTeam();
    if (!this.team) return;
    this.restoreChannels();
    this.ensureGeneral();
    // Someone dropped an agent folder in by hand: it needs its direct chat and its place in the
    // rooms, exactly as if it had been hired through the app.
    for (const cfg of this.store.listAgentConfigs()) this.ensureDm(cfg.id);
    this.pruneMissingChannels();
    const after = this.store.listAgentConfigs().map((a) => a.id).join(",");
    if (before !== after) log(`the team on disk changed: now ${after.split(",").filter(Boolean).length} agent(s)`, { team: this.team.id });
    this.bus.emit("team.updated", this.team);
    this.bus.emit("agents.updated", this.listAgents());
  }

  close(): void {
    this.closed = true;
    this.folderWatch?.close();
    this.skills.dispose();
    this.db.sqlite.close();
  }

  // ---------------- keys & providers ----------------

  setKeys(keys: Keys): void {
    Object.assign(this.keys, keys);
    this.bus.emit("supervisor.status", this.status());
  }
  /** Which providers can run right now, by id. The status bar and the empty states read this. */
  keyStatus(): KeyStatus {
    const s = this.providerStatus();
    return Object.fromEntries(Object.entries(s).map(([id, st]) => [id, st.ready]));
  }
  get providers(): ProviderSettings {
    return readSettings(this.opts.globalDir);
  }
  /** Patch any number of providers at once; unknown ids are ignored rather than written. */
  setProviders(patch: Record<string, Partial<ProviderConfig>>): ProviderStatus {
    const next = readSettings(this.opts.globalDir);
    for (const [id, cfg] of Object.entries(patch)) {
      if (!next[id]) continue;
      // `settings` is merged field by field so saving a base URL does not wipe a region.
      next[id] = { ...next[id], ...cfg, settings: { ...(next[id].settings ?? {}), ...(cfg.settings ?? {}) } };
    }
    writeSettings(this.opts.globalDir, next);
    this.bus.emit("supervisor.status", this.status());
    return this.providerStatus();
  }
  providerStatus(): ProviderStatus {
    return statusFor(readSettings(this.opts.globalDir), this.keys);
  }
  /** The config for one provider, falling back to catalog defaults for one never touched. */
  providerConfig(id: Provider): ProviderConfig {
    return this.providers[id] ?? defaultSettings()[id] ?? { enabled: false, defaultModel: "", checkinModel: "" };
  }
  /** The provider to prefer for new work: Claude when ready, else the first other one that is. */
  preferredProvider(): Provider | null {
    return preferredProvider(this.providerStatus());
  }
  /** True when Claude Code is signed in on this machine, so the Claude runner works without an API key. */
  hasClaudeLogin(): boolean {
    return hasClaudeLogin();
  }

  // ---------------- team ----------------

  createTeamFromDraft(draft: TeamDraft, opts: { workspaceRoot: string | null; ownerName: string; id?: string; git?: GitSettings | null }): TeamConfig {
    this.store.deleteTeam();
    this.db.deleteAllChannels();
    const team: TeamConfig = {
      id: opts.id ?? nanoid(8),
      name: draft.name,
      charter: draft.charter,
      git: opts.git ?? null,
      dailyCapUsd: draft.dailyCapUsd || DEFAULTS.teamDailyCapUsd,
      chatDepthCap: DEFAULTS.chatDepthCap,
      workspaceRoot: opts.workspaceRoot,
      ownerName: opts.ownerName,
      createdAt: new Date().toISOString(),
    };
    this.store.writeTeam(team);
    this.team = team;

    const nameToId = new Map<string, string>();
    for (const a of draft.agents) nameToId.set(a.name.toLowerCase(), slug(a.name));

    const channels: Channel[] = [{ id: "general", name: "general", purpose: "Everyone. Announcements, standups, anything cross-cutting.", members: [...nameToId.values()], kind: "group", dmAgentId: null }];
    for (const c of draft.channels) {
      const name = c.name.replace(/^#/, "").toLowerCase();
      if (name === "general" || name.startsWith("dm-")) continue;
      channels.push({ id: name, name, purpose: c.purpose, members: c.members.map((n) => nameToId.get(n.toLowerCase())).filter((x): x is string => Boolean(x)), kind: "group", dmAgentId: null });
    }
    for (const c of channels) this.db.upsertChannel(c);
    this.syncChannels();

    for (const a of draft.agents) this.createAgent(a, channels);
    this.bus.emit("team.updated", team);
    this.bus.emit("agents.updated", this.listAgents());
    this.postMessage({ channel: "general", authorId: "system", text: `Team "${team.name}" created. Charter: ${team.charter}`, kind: "system" });
    return team;
  }

  updateTeam(patch: Partial<TeamConfig>): TeamConfig {
    if (!this.team) throw new Error("No team yet");
    this.team = { ...this.team, ...patch, id: this.team.id };
    this.store.writeTeam(this.team);
    this.bus.emit("team.updated", this.team);
    return this.team;
  }

  createAgent(draft: AgentDraft, channels: Channel[] = this.db.listChannels()): Agent {
    const id = slug(draft.name);
    const memberOf = channels.filter((c) => c.id === "general" || c.members.includes(id) || draft.channels.map((n) => n.replace(/^#/, "").toLowerCase()).includes(c.id)).map((c) => c.id);
    const pc = this.providerConfig(draft.provider);
    const cfg: AgentConfig = {
      id,
      name: draft.name,
      role: draft.role,
      provider: draft.provider,
      model: draft.model || pc.defaultModel,
      checkinModel: pc.checkinModel,
      heartbeat: { everyMinutes: draft.heartbeatMinutes || DEFAULTS.heartbeatMinutes, workHours: DEFAULTS.workHours },
      triggers: { onMention: true, cron: (draft.schedules ?? []).map((s) => ({ name: s.name, expr: s.expr, prompt: s.prompt })) },
      permissions: DEFAULT_DEV_RULES,
      budget: { dailyUsd: draft.dailyBudgetUsd || DEFAULTS.agentDailyUsd, perRunUsd: draft.perRunBudgetUsd ?? DEFAULTS.agentPerRunUsd, hourlyUsd: draft.hourlyBudgetUsd ?? null, capBy: draft.capBy ?? "day" },
      channels: memberOf,
      workspace: null,
      color: draft.color || "#EFEDE8",
      paused: false,
      createdAt: new Date().toISOString(),
    };
    this.store.writeAgentConfig(cfg);
    this.store.writeAgentFile(id, "soul", draft.soul.trim() + "\n");
    this.store.writeAgentFile(id, "rules", "# Rules\n\n" + draft.rules.map((r) => `- ${r}`).join("\n") + "\n\n# Responsibilities\n\n" + draft.responsibilities.map((r) => `- ${r}`).join("\n") + "\n");
    this.store.writeAgentFile(id, "memory", "# Memory\n\nThings learned on the job. Newest at the bottom.\n\n");
    for (const c of channels) {
      if (memberOf.includes(c.id) && !c.members.includes(id)) this.db.upsertChannel({ ...c, members: [...c.members, id] });
    }
    this.ensureDm(id);
    return this.getAgent(id);
  }

  /**
   * Every team has a room everyone is in. The app guaranteed each agent a direct chat but never
   * this, so a team that lost its group channels kept running with nowhere shared to talk: agents
   * told to "post in #general" found it missing and quietly fell back to messaging the owner, and
   * nobody could see what anyone else was doing. Found on a live team with only DMs left.
   */
  private ensureGeneral(): Channel | null {
    if (!this.team) return null;
    const existing = this.db.getChannel("general");
    const members = this.store.listAgentConfigs().map((a) => a.id);
    if (existing) {
      // Everyone belongs here, including agents hired after the channel was made.
      const missing = members.filter((m) => !existing.members.includes(m));
      if (!missing.length) return existing;
      const next = { ...existing, members: [...existing.members, ...missing] };
      this.db.upsertChannel(next);
      this.syncChannels();
      return next;
    }
    const channel: Channel = {
      id: "general", name: "general",
      purpose: "Everyone. Announcements, standups, anything cross-cutting.",
      members, kind: "group", dmAgentId: null,
    };
    this.db.upsertChannel(channel);
    for (const cfg of this.store.listAgentConfigs()) {
      if (!cfg.channels.includes("general")) this.store.writeAgentConfig({ ...cfg, channels: [...cfg.channels, "general"] });
    }
    this.syncChannels();
    log("restored #general: the team had no shared channel", { team: this.team.id });
    return channel;
  }

  /**
   * Drop channels an agent lists that no longer exist.
   *
   * A stale name is not harmless: `assign_task` picks a room the two agents share, and picking a
   * deleted one failed the whole hand-off with "Unknown channel dev" — which the team hit twice
   * before anyone noticed. The lists are reconciled against the real channels on load.
   */
  private pruneMissingChannels(): void {
    const real = new Set(this.db.listChannels().map((c) => c.id));
    for (const cfg of this.store.listAgentConfigs()) {
      const kept = cfg.channels.filter((c) => real.has(c));
      if (kept.length === cfg.channels.length) continue;
      const gone = cfg.channels.filter((c) => !real.has(c));
      this.store.writeAgentConfig({ ...cfg, channels: kept });
      log(`${cfg.name} listed ${gone.join(", ")}, which no longer exist; removed`, { team: this.team?.id });
    }
  }

  /** Every agent has a direct chat with the owner. It is a channel the agent is always a member of. */
  ensureDm(agentId: string): Channel {
    const id = dmChannelId(agentId);
    let c = this.db.getChannel(id);
    if (!c) {
      const cfg = this.store.readAgentConfig(agentId);
      c = { id, name: id, purpose: `Direct messages between ${this.team?.ownerName ?? "the owner"} and ${cfg?.name ?? agentId}.`, members: [agentId], kind: "dm", dmAgentId: agentId };
      this.db.upsertChannel(c);
    }
    const cfg = this.store.readAgentConfig(agentId);
    if (cfg && !cfg.channels.includes(id)) this.store.writeAgentConfig({ ...cfg, channels: [...cfg.channels, id] });
    return c;
  }

  // ---------------- agents ----------------

  private rt(id: string): AgentRuntime {
    let r = this.runtime.get(id);
    if (!r) {
      r = { status: "idle", statusText: "", currentRunId: null, nextWakeAt: null };
      this.runtime.set(id, r);
    }
    return r;
  }

  listAgents(): Agent[] {
    const spend = this.db.spentTodayByAgent();
    return this.store.listAgentConfigs().map((cfg) => this.toAgent(cfg, spend[cfg.id] ?? 0));
  }
  getAgent(id: string): Agent {
    const cfg = this.store.readAgentConfig(id);
    if (!cfg) throw new Error(`Unknown agent ${id}`);
    return this.toAgent(cfg, this.db.spentToday(id));
  }
  findAgent(nameOrId: string): Agent | undefined {
    const key = nameOrId.replace(/^@/, "").toLowerCase();
    return this.listAgents().find((a) => a.id === key || a.name.toLowerCase() === key);
  }
  private toAgent(cfg: AgentConfig, spentTodayUsd: number): Agent {
    const rt = this.rt(cfg.id);
    const last = this.db.lastRun(cfg.id);
    let status = rt.status;
    let statusText = rt.statusText;
    if (cfg.paused || this.pausedAll) { status = "paused"; statusText = "Paused"; }
    // Winding down: whoever is still running is genuinely still working, but an agent with
    // nothing in flight is already stopped — it will not wake again — so say so.
    else if (this.pauseWhenIdle && !rt.currentRunId) { status = "paused"; statusText = "Stopping · no new work"; }
    else if (status === "idle" && spentTodayUsd >= cfg.budget.dailyUsd) { status = "over_budget"; statusText = "Daily budget reached"; }
    return {
      ...cfg, status, statusText, currentRunId: rt.currentRunId, spentTodayUsd,
      lastRunAt: last?.finishedAt ?? last?.startedAt ?? null, nextWakeAt: rt.nextWakeAt, memoryCount: this.store.memoryCount(cfg.id),
    };
  }
  setAgentRuntime(id: string, patch: Partial<AgentRuntime>): void {
    Object.assign(this.rt(id), patch);
    this.bus.emit("agent.updated", this.getAgent(id));
  }
  /** Same, without broadcasting. Used by the scheduler tick for nextWakeAt. */
  setAgentRuntimeQuiet(id: string, patch: Partial<AgentRuntime>): void {
    Object.assign(this.rt(id), patch);
  }
  updateAgent(id: string, patch: Partial<AgentConfig>): Agent {
    const cfg = this.store.readAgentConfig(id);
    if (!cfg) throw new Error(`Unknown agent ${id}`);
    const next: AgentConfig = { ...cfg, ...patch, id };
    this.store.writeAgentConfig(next);
    const agent = this.getAgent(id);
    this.bus.emit("agent.updated", agent);
    return agent;
  }

  // ---------------- channels & messages ----------------

  listChannels(): Channel[] {
    return this.db.listChannels();
  }
  /** Keep `channels.json` in step with the rooms, so the setup travels even though the talk does not. */
  private syncChannels(): void {
    try { this.store.writeChannels(this.db.listChannels()); } catch (e) { log(`could not write channels.json: ${e instanceof Error ? e.message : String(e)}`, { team: this.team?.id }); }
  }
  /**
   * Bring back the rooms recorded in the team folder. On a fresh clone `crew.db` does not exist
   * — the history is deliberately not shared — so without this the team would arrive with its
   * agents and no channels to talk in. Existing rooms win: this only fills in what is missing.
   */
  private restoreChannels(): void {
    if (!this.team) return;
    const saved = this.store.readChannels();
    if (!saved.length) return;
    const have = new Set(this.db.listChannels().map((c) => c.id));
    const missing = saved.filter((c) => !have.has(c.id));
    for (const c of missing) this.db.upsertChannel({ ...c, kind: "group", dmAgentId: null });
    if (missing.length) log(`restored ${missing.length} channel(s) from channels.json`, { team: this.team.id });
  }
  ensureChannel(name: string, purpose = "", members: string[] = []): Channel {
    // Validate before looking up, so "dm-kai" can never hand back someone's private chat.
    const id = name.replace(/^#/, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
    if (!id || id.startsWith("dm-")) throw new Error("Pick another channel name");
    const existing = this.db.getChannel(id);
    if (existing) return existing;
    const c: Channel = { id, name: id, purpose, members, kind: "group", dmAgentId: null };
    this.db.upsertChannel(c);
    for (const a of members) {
      const cfg = this.store.readAgentConfig(a);
      if (cfg && !cfg.channels.includes(id)) this.store.writeAgentConfig({ ...cfg, channels: [...cfg.channels, id] });
    }
    this.syncChannels();
    this.bus.emit("team.updated", this.team);
    return c;
  }
  updateChannel(id: string, patch: { purpose?: string; members?: string[] }): Channel {
    const c = this.db.getChannel(id);
    if (!c || c.kind === "dm") throw new Error(`Unknown channel ${id}`);
    const next: Channel = { ...c, purpose: patch.purpose ?? c.purpose, members: patch.members ?? c.members };
    this.db.upsertChannel(next);
    for (const a of this.store.listAgentConfigs()) {
      const inChannel = next.members.includes(a.id);
      const listed = a.channels.includes(id);
      if (inChannel && !listed) this.store.writeAgentConfig({ ...a, channels: [...a.channels, id] });
      if (!inChannel && listed) this.store.writeAgentConfig({ ...a, channels: a.channels.filter((x) => x !== id) });
    }
    this.syncChannels();
    this.bus.emit("team.updated", this.team);
    return next;
  }
  deleteChannel(id: string): void {
    const c = this.db.getChannel(id);
    if (!c || c.kind === "dm" || c.id === "general") throw new Error("That channel can't be deleted");
    this.db.deleteChannel(id);
    for (const a of this.store.listAgentConfigs()) if (a.channels.includes(id)) this.store.writeAgentConfig({ ...a, channels: a.channels.filter((x) => x !== id) });
    this.syncChannels();
    this.bus.emit("team.updated", this.team);
  }

  postMessage(input: { channel: string; authorId: string; text: string; kind?: MessageKind; runId?: string | null; depth?: number; questionId?: string | null }): Message {
    const channel = this.db.getChannel(input.channel);
    if (!channel) throw new Error(`Unknown channel ${input.channel}`);
    const authorName = input.authorId === "user" ? this.team?.ownerName ?? "You" : input.authorId === "system" ? "System" : this.findAgent(input.authorId)?.name ?? input.authorId;
    const message: Message = {
      id: nanoid(10),
      channelId: channel.id,
      authorId: input.authorId,
      authorName,
      kind: input.kind ?? "message",
      text: input.text,
      // In a direct chat, anything the owner writes is addressed to that agent.
      mentions: channel.kind === "dm" && input.authorId === "user" && channel.dmAgentId ? [...new Set([...this.parseMentions(input.text), channel.dmAgentId])] : this.parseMentions(input.text),
      depth: input.depth ?? 0,
      runId: input.runId ?? null,
      questionId: input.questionId ?? null,
      createdAt: new Date().toISOString(),
    };
    this.db.insertMessage(message);
    this.bus.emit("message.created", message);
    return message;
  }

  parseMentions(text: string): string[] {
    const agents = this.listAgents();
    const found = new Set<string>();
    for (const m of text.matchAll(/@([\w-]+)/g)) {
      const a = agents.find((x) => x.name.toLowerCase() === m[1]!.toLowerCase() || x.id === m[1]!.toLowerCase());
      if (a) found.add(a.id);
    }
    return [...found];
  }

  // ---------------- questions ----------------

  askQuestion(input: {
    kind: QuestionKind; fromAgentId: string; toId: string; channel?: string | null; title: string; body: string;
    options?: string[]; recommended?: string | null; defaultAnswer?: string | null; defaultInMinutes?: number | null;
    payload?: Record<string, unknown> | null; runId?: string | null;
  }): Question {
    const now = new Date();
    const defaultAt =
      input.defaultAnswer && input.defaultInMinutes !== null
        ? new Date(now.getTime() + (input.defaultInMinutes ?? DEFAULTS.questionDefaultMinutes) * 60_000).toISOString()
        : null;
    const channel = input.channel ? this.db.getChannel(input.channel) : null;
    const q: Question = {
      id: nanoid(10), kind: input.kind, fromAgentId: input.fromAgentId, toId: input.toId, channelId: channel?.id ?? null,
      title: input.title, body: input.body, options: input.options ?? [], recommended: input.recommended ?? null,
      defaultAnswer: input.defaultAnswer ?? null, defaultAt, status: "open", answer: null, answeredBy: null,
      payload: input.payload ?? null, runId: input.runId ?? null, createdAt: now.toISOString(), answeredAt: null,
    };
    this.db.insertQuestion(q);
    this.bus.emit("question.created", q);
    if (channel) {
      const text = q.body && q.body.trim() !== q.title.trim() && !q.body.startsWith(q.title) ? `${q.title}\n${q.body}` : q.body || q.title;
      this.postMessage({ channel: channel.id, authorId: input.fromAgentId, kind: "question", text, questionId: q.id, runId: q.runId });
    }
    if (q.toId === "user") {
      const from = this.findAgent(q.fromAgentId);
      this.bus.emit("notify", { title: `${from?.name ?? q.fromAgentId} · ${from?.role ?? ""}`.trim(), body: q.title, questionId: q.id });
      if (q.kind !== "report") this.setAgentRuntime(q.fromAgentId, { status: "needs_you", statusText: q.title });
    }
    return q;
  }

  answerQuestion(id: string, answer: string, by: string, remember = false): Question {
    const q = this.db.getQuestion(id);
    if (!q) throw new Error(`Unknown question ${id}`);
    if (q.status !== "open") return q;
    const next: Question = { ...q, status: "answered", answer, answeredBy: by, answeredAt: new Date().toISOString() };
    this.db.updateQuestion(next);
    if (remember) {
      this.db.insertDecision({ id: nanoid(8), title: q.title, answer, by, createdAt: next.answeredAt! });
    }
    this.bus.emit("question.updated", next);
    if (q.channelId) {
      const who = by === "user" ? this.team?.ownerName ?? "You" : this.findAgent(by)?.name ?? by;
      this.postMessage({ channel: q.channelId, authorId: by, text: `${who === (this.team?.ownerName ?? "You") ? "" : ""}Re "${q.title}": ${answer}`, questionId: q.id });
    }
    const waiter = this.waiters.get(id);
    if (waiter) { this.waiters.delete(id); waiter(answer); }
    const from = this.findAgent(q.fromAgentId);
    if (from && from.status === "needs_you" && !this.db.listQuestions({ status: "open" }).some((o) => o.fromAgentId === from.id && o.toId === "user")) {
      this.setAgentRuntime(from.id, { status: from.currentRunId ? "working" : "idle", statusText: "" });
    }
    return next;
  }

  dismissQuestion(id: string): Question {
    const q = this.db.getQuestion(id);
    if (!q) throw new Error(`Unknown question ${id}`);
    const next: Question = { ...q, status: "dismissed", answeredAt: new Date().toISOString(), answeredBy: "user" };
    this.db.updateQuestion(next);
    this.bus.emit("question.updated", next);
    const waiter = this.waiters.get(id);
    if (waiter) { this.waiters.delete(id); waiter(null); }
    return next;
  }

  /** Block a running tool call until the question is answered, dismissed, or times out. */
  waitForAnswer(questionId: string, timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.waiters.delete(questionId); resolve(null); }, timeoutMs);
      this.waiters.set(questionId, (answer) => { clearTimeout(timer); resolve(answer); });
    });
  }

  /** Queue slot bridge, wired by the scheduler (Queue is a scheduler concern, not crew's). */
  private slotBridge: { suspend(runId: string): void; resume(runId: string): Promise<void> } | null = null;
  setSlotBridge(bridge: { suspend(runId: string): void; resume(runId: string): Promise<void> } | null): void {
    this.slotBridge = bridge;
  }

  /**
   * Wait for the owner to answer a question, freeing the run's concurrency slot while
   * parked. With no bridge (unit tests, crew without scheduler) this is just
   * waitForAnswer. With a bridge, the slot is released BEFORE the wait (the run sits in
   * needs_you slotless) and re-taken afterwards — in `finally`, so the run re-enters the
   * FIFO even when the wait times out.
   */
  async waitOnOwner(questionId: string, runId: string, timeoutMs: number): Promise<string | null> {
    const bridge = this.slotBridge;
    if (!bridge) return this.waitForAnswer(questionId, timeoutMs);
    try {
      bridge.suspend(runId);
      return await this.waitForAnswer(questionId, timeoutMs);
    } finally {
      await bridge.resume(runId);
    }
  }

  /** Apply default answers whose deadline passed. Called by the scheduler tick. */
  expireQuestions(): Question[] {
    const expired = this.db.expiredQuestions(new Date().toISOString());
    return expired.map((q) => this.answerQuestion(q.id, q.defaultAnswer!, "default"));
  }

  // ---------------- runs ----------------

  createRun(agentId: string, trigger: RunTrigger, model: string): Run {
    const run: Run = {
      id: nanoid(10), agentId, trigger, status: "queued", summary: "", model, baseHead: null, startedAt: null, finishedAt: null,
      costUsd: 0, inputTokens: 0, outputTokens: 0, stepCount: 0, error: null, createdAt: new Date().toISOString(),
    };
    this.db.insertRun(run);
    this.bus.emit("run.updated", run);
    return run;
  }
  updateRun(run: Run, patch: Partial<Run>): Run {
    const next = { ...run, ...patch };
    this.db.updateRun(next);
    this.bus.emit("run.updated", next);
    if (patch.costUsd !== undefined || patch.status !== undefined) this.bus.emit("spend.updated", this.spend());
    return next;
  }
  addStep(runId: string, kind: RunStepKind, text: string, detail: string | null = null): RunStep {
    const step: RunStep = { id: nanoid(10), runId, at: new Date().toISOString(), kind, text: text.slice(0, 500), detail: detail ? detail.slice(0, 8000) : null };
    this.db.insertStep(step);
    this.bus.emit("run.step", step);
    return step;
  }
  finishRun(run: Run, status: RunStatus, summary: string, extra: Partial<Run> = {}): Run {
    const next = this.updateRun(run, { status, summary: summary.slice(0, 500), finishedAt: new Date().toISOString(), ...extra });
    if (status === "failed") this.notifyRunFailed(next, summary);
    return next;
  }
  /**
   * Terminal run failures (provider auth/credits, crash, timeout, unknown provider) ping the
   * owner once per agent per hour — the run itself is already in the Runs list, but nothing
   * told the owner it happened. Not fired for transient retries or cancellations.
   */
  private notifyRunFailed(run: Run, summary: string): void {
    const now = Date.now();
    if (now - (this.lastFailNotifyAt.get(run.agentId) ?? 0) < 60 * 60 * 1000) return;
    this.lastFailNotifyAt.set(run.agentId, now);
    const agent = this.getAgent(run.agentId);
    const body = summary.trim() || "The run ended in an error — see the Runs screen for details.";
    this.bus.emit("notify", { title: `${agent?.name ?? run.agentId} run failed`, body: body.slice(0, 200), runId: run.id });
  }
  /**
   * What the workspace looks like now vs. when the run started. Always answerable — an
   * unavailable diff (missing base, no repo, branch switched away) is a result, not an error.
   */
  runDiff(runId: string): RunDiff {
    const run = this.db.getRun(runId);
    if (!run) return { runId, available: false, reason: "Run not found.", baseHead: null, head: null, stat: null, patch: null };
    return runDiff(this.team?.workspaceRoot ?? "", runId, run.baseHead ?? null);
  }

  // ---------------- spend & status ----------------

  spend(): SpendSummary {
    return { todayUsd: this.db.spentToday(), capUsd: this.team?.dailyCapUsd ?? DEFAULTS.teamDailyCapUsd, perAgent: this.db.spentTodayByAgent(), checkinsUsd: this.db.checkinSpendToday() };
  }
  /**
   * May this agent run right now? Covers money (daily / hourly / team cap) and churn
   * (runs per hour), which is what stops two agents answering each other all night.
   * `fromOwner` runs skip the churn ceiling: a direct instruction is never refused.
   */
  budgetAllows(agentId: string, fromOwner = false): { ok: boolean; reason?: string } {
    const agent = this.getAgent(agentId);
    // Only the owner's own switch is checked here. Missing credentials are the runner's to
    // report: it knows whether the key was rejected, the CLI is not installed or the endpoint
    // is unreachable, and that distinction is what pauses the agent and what the owner reads.
    if (!providerSpec(agent.provider)) return { ok: false, reason: `${agent.name} is on "${agent.provider}", which this version of StandBye does not offer. Pick another provider in ${agent.name}'s settings.` };
    if (!this.providerConfig(agent.provider).enabled) return { ok: false, reason: `${providerLabel(agent.provider)} is turned off in Settings` };
    if (!fromOwner) {
      const anHourAgo = new Date(Date.now() - 3_600_000).toISOString();
      const recent = this.db.runsSince(agentId, anHourAgo);
      if (recent >= DEFAULTS.maxRunsPerHour) {
        return { ok: false, reason: `${agent.name} has already woken ${recent} times this hour. Pausing the chatter until the hour rolls over; message ${agent.name} directly to override.` };
      }
    }
    if (agent.budget.dailyUsd > 0 && agent.spentTodayUsd >= agent.budget.dailyUsd) return { ok: false, reason: `${agent.name} reached the daily budget ($${agent.budget.dailyUsd})` };
    if (agent.budget.hourlyUsd && this.db.spentSince(agentId, new Date(Date.now() - 3_600_000).toISOString()) >= agent.budget.hourlyUsd) {
      return { ok: false, reason: `${agent.name} reached the hourly budget ($${agent.budget.hourlyUsd})` };
    }
    const s = this.spend();
    if (s.todayUsd >= s.capUsd) return { ok: false, reason: `Team daily cap ($${s.capUsd}) reached` };
    return { ok: true };
  }
  status(): SupervisorStatus {
    const agents = this.listAgents();
    const next = agents.filter((a) => a.nextWakeAt).sort((a, b) => a.nextWakeAt!.localeCompare(b.nextWakeAt!))[0];
    return {
      teamId: this.id, startedAt: this.startedAt, pausedAll: this.pausedAll, pausePending: this.pauseWhenIdle,
      runningRuns: agents.filter((a) => a.currentRunId).length,
      runsToday: this.db.runsToday(), keys: this.keyStatus(),
      nextWake: next ? { agentId: next.id, at: next.nextWakeAt! } : null,
    };
  }
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || nanoid(6);
}
