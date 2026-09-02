import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import type {
  Agent, AgentConfig, AgentDraft, AgentStatus, Channel, KeyStatus, Message, MessageKind, Provider, ProviderConfig, ProviderSettings, ProviderStatus, Question, QuestionKind,
  Run, RunStatus, RunStep, RunStepKind, RunTrigger, SpendSummary, SupervisorStatus, TeamConfig, TeamDraft,
} from "@crew/shared";
import { DEFAULT_MODELS } from "@crew/shared";
import { Bus } from "./bus.js";
import { Db } from "./db.js";
import { Store } from "./store.js";
import { DEFAULTS, type SupervisorOptions } from "./config.js";
import { DEFAULT_DEV_RULES } from "./permissions.js";

export interface Keys {
  anthropic?: string;
  openrouter?: string;
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
  readonly bus = new Bus();
  readonly startedAt = new Date().toISOString();
  team: TeamConfig | null;
  keys: Keys = {};
  pausedAll = false;

  private readonly runtime = new Map<string, AgentRuntime>();
  private readonly waiters = new Map<string, (answer: string | null) => void>();

  constructor(readonly opts: SupervisorOptions) {
    this.db = new Db(opts.dataDir);
    this.store = new Store(opts.dataDir);
    this.team = this.store.readTeam();
    const stale = this.db.recoverStaleRuns();
    if (stale > 0) console.error(`[crew] marked ${stale} stale run(s) as failed after restart`);
  }

  // ---------------- keys & providers ----------------

  setKeys(keys: Keys): void {
    this.keys = { ...this.keys, ...keys };
    this.bus.emit("supervisor.status", this.status());
  }
  keyStatus(): KeyStatus {
    const p = this.providerStatus();
    return { anthropic: p.anthropic.ready, openrouter: p.openrouter.ready };
  }
  get providers(): ProviderSettings {
    return this.readProviders();
  }
  setProviders(patch: { anthropic?: Partial<ProviderConfig>; openrouter?: Partial<ProviderConfig> }): ProviderStatus {
    const cur = this.readProviders();
    const next: ProviderSettings = {
      anthropic: { ...cur.anthropic, ...(patch.anthropic ?? {}) },
      openrouter: { ...cur.openrouter, ...(patch.openrouter ?? {}) },
    };
    fs.writeFileSync(path.join(this.opts.dataDir, "providers.json"), JSON.stringify(next, null, 2));
    this.bus.emit("supervisor.status", this.status());
    return this.providerStatus();
  }
  private readProviders(): ProviderSettings {
    const base: ProviderSettings = {
      anthropic: { enabled: true, defaultModel: DEFAULT_MODELS.anthropic.main, checkinModel: DEFAULT_MODELS.anthropic.checkin },
      openrouter: { enabled: true, defaultModel: DEFAULT_MODELS.openrouter.main, checkinModel: DEFAULT_MODELS.openrouter.checkin },
    };
    const p = path.join(this.opts.dataDir, "providers.json");
    if (!fs.existsSync(p)) return base;
    try {
      const saved = JSON.parse(fs.readFileSync(p, "utf8")) as { anthropic?: Partial<ProviderConfig>; openrouter?: Partial<ProviderConfig> };
      return { anthropic: { ...base.anthropic, ...(saved.anthropic ?? {}) }, openrouter: { ...base.openrouter, ...(saved.openrouter ?? {}) } };
    } catch { return base; }
  }
  providerStatus(): ProviderStatus {
    const s = this.readProviders();
    const hasKey = Boolean(this.keys.anthropic);
    const hasLogin = this.hasClaudeLogin();
    return {
      anthropic: { ...s.anthropic, hasKey, hasLogin, ready: s.anthropic.enabled && (hasKey || hasLogin) },
      openrouter: { ...s.openrouter, hasKey: Boolean(this.keys.openrouter), ready: s.openrouter.enabled && Boolean(this.keys.openrouter) },
    };
  }
  /** The provider to prefer for new work: Claude when ready, else OpenRouter. */
  preferredProvider(): Provider | null {
    const s = this.providerStatus();
    return s.anthropic.ready ? "anthropic" : s.openrouter.ready ? "openrouter" : null;
  }
  /** True when Claude Code is signed in on this machine, so the Claude runner works without an API key. */
  hasClaudeLogin(): boolean {
    try {
      if (fs.existsSync(path.join(os.homedir(), ".claude", ".credentials.json"))) return true; // Linux/Windows
      const cfg = path.join(os.homedir(), ".claude.json"); // macOS keeps the token in the Keychain; the account marker lives here
      return fs.existsSync(cfg) && fs.readFileSync(cfg, "utf8").includes('"oauthAccount"');
    } catch {
      return false;
    }
  }

  // ---------------- team ----------------

  createTeamFromDraft(draft: TeamDraft, opts: { workspaceRoot: string | null; ownerName: string }): TeamConfig {
    this.store.deleteTeam();
    this.db.deleteAllChannels();
    const team: TeamConfig = {
      id: nanoid(8),
      name: draft.name,
      charter: draft.charter,
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

    const channels: Channel[] = [{ id: "general", name: "general", purpose: "Everyone. Announcements, standups, anything cross-cutting.", members: [...nameToId.values()] }];
    for (const c of draft.channels) {
      const name = c.name.replace(/^#/, "").toLowerCase();
      if (name === "general") continue;
      channels.push({ id: name, name, purpose: c.purpose, members: c.members.map((n) => nameToId.get(n.toLowerCase())).filter((x): x is string => Boolean(x)) });
    }
    for (const c of channels) this.db.upsertChannel(c);

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
    const pc = this.providers[draft.provider];
    const cfg: AgentConfig = {
      id,
      name: draft.name,
      role: draft.role,
      provider: draft.provider,
      model: draft.model || pc.defaultModel,
      checkinModel: pc.checkinModel,
      heartbeat: { everyMinutes: draft.heartbeatMinutes || DEFAULTS.heartbeatMinutes, workHours: DEFAULTS.workHours },
      triggers: { onMention: true, cron: [] },
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
    return this.getAgent(id);
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
  ensureChannel(name: string, purpose = "", members: string[] = []): Channel {
    const existing = this.db.getChannel(name);
    if (existing) return existing;
    const id = name.replace(/^#/, "").toLowerCase();
    const c: Channel = { id, name: id, purpose, members };
    this.db.upsertChannel(c);
    return c;
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
      mentions: this.parseMentions(input.text),
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
      this.setAgentRuntime(q.fromAgentId, { status: "needs_you", statusText: q.title });
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

  /** Apply default answers whose deadline passed. Called by the scheduler tick. */
  expireQuestions(): Question[] {
    const expired = this.db.expiredQuestions(new Date().toISOString());
    return expired.map((q) => this.answerQuestion(q.id, q.defaultAnswer!, "default"));
  }

  // ---------------- runs ----------------

  createRun(agentId: string, trigger: RunTrigger, model: string): Run {
    const run: Run = {
      id: nanoid(10), agentId, trigger, status: "queued", summary: "", model, startedAt: null, finishedAt: null,
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
    return this.updateRun(run, { status, summary: summary.slice(0, 500), finishedAt: new Date().toISOString(), ...extra });
  }

  // ---------------- spend & status ----------------

  spend(): SpendSummary {
    return { todayUsd: this.db.spentToday(), capUsd: this.team?.dailyCapUsd ?? DEFAULTS.teamDailyCapUsd, perAgent: this.db.spentTodayByAgent(), checkinsUsd: this.db.checkinSpendToday() };
  }
  budgetAllows(agentId: string): { ok: boolean; reason?: string } {
    const agent = this.getAgent(agentId);
    if (!this.providers[agent.provider].enabled) return { ok: false, reason: `${agent.provider} is turned off in Settings` };
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
      startedAt: this.startedAt, pausedAll: this.pausedAll,
      runningRuns: agents.filter((a) => a.currentRunId).length,
      runsToday: this.db.runsToday(), keys: this.keyStatus(),
      nextWake: next ? { agentId: next.id, at: next.nextWakeAt! } : null,
    };
  }
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || nanoid(6);
}
