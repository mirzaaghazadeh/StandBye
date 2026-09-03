import { useSyncExternalStore } from "react";
import { dmChannelId } from "@crew/shared";
import type {
  Agent, AgentFiles, ArchivedTeam, Channel, GitSettings, KeyStatus, Message, ModelInfo, Provider, ProviderConfig, ProviderStatus, PushEvent, Question, Run, RunStep, SkillScope, SpendSummary, SupervisorStatus, TeamConfig, TeamDraft, TeamSummary,
} from "@crew/shared";

export type Route =
  | { name: "home" }
  | { name: "inbox"; questionId?: string }
  | { name: "runs"; runId?: string }
  | { name: "channel"; channelId: string }
  | { name: "dm"; agentId: string }
  | { name: "agent"; agentId: string };

export type Sheet =
  | { kind: "none" }
  | { kind: "onboarding" }
  | { kind: "builder"; mode?: "describe" | "template" }
  | { kind: "manual" }
  | { kind: "keys" }
  | { kind: "channel"; channelId?: string }
  | { kind: "agent"; agentId: string; tab?: string }
  | { kind: "skills"; scope?: SkillScope; ownerId?: string | null; name?: string }
  | { kind: "wake"; agentId: string }
  | { kind: "removeTeam"; teamId: string };

export interface State {
  ready: boolean;
  error: string | null;
  route: Route;
  sheet: Sheet;
  status: SupervisorStatus | null;
  keys: KeyStatus;
  providers: ProviderStatus | null;
  models: Record<Provider, ModelInfo[]> | null;
  teams: TeamSummary[];
  /** Teams taken off the list: stopped, but every file kept. */
  archived: ArchivedTeam[];
  activeTeamId: string | null;
  team: TeamConfig | null;
  agents: Agent[];
  channels: Channel[];
  messages: Record<string, Message[]>;
  questions: Question[];
  runs: Run[];
  steps: Record<string, RunStep[]>;
  spend: SpendSummary | null;
  selectedAgentId: string | null;
  /** Folder chosen by "Open folder…" that turned out to have no team yet. */
  pendingWorkspace: string | null;
  /** channelId -> ISO time of the newest message the owner has looked at */
  seen: Record<string, string>;
  /** messageId -> agents being woken by it, until their run shows up */
  waking: Record<string, { agentIds: string[]; at: number }>;
  firstStepsDismissed: boolean;
  /** Bumped whenever a skill is installed, edited or removed, so open skill views reload. */
  skillsStamp: number;
  builderDraft: TeamDraft | null;
  builderBusy: boolean;
  toast: string | null;
}

const initial: State = {
  ready: false, error: null, route: { name: "home" }, sheet: { kind: "none" }, status: null,
  keys: {}, providers: null, models: null, teams: [], archived: [], activeTeamId: null, team: null, agents: [], channels: [], messages: {}, questions: [], runs: [], steps: {},
  spend: null, selectedAgentId: null, pendingWorkspace: null, seen: {}, waking: {}, firstStepsDismissed: false, skillsStamp: 0, builderDraft: null, builderBusy: false, toast: null,
};

type Listener = () => void;

class Store {
  private state: State = initial;
  private readonly listeners = new Set<Listener>();
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  get = (): State => this.state;
  subscribe = (l: Listener): (() => void) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  private set(patch: Partial<State> | ((s: State) => Partial<State>)): void {
    const p = typeof patch === "function" ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  rpc = <T = unknown>(method: string, params?: unknown): Promise<T> => window.crew.rpc<T>(method, params);

  async init(): Promise<void> {
    window.crew.onEvent((e) => this.onEvent(e));
    window.crew.onNavigate((r) => this.navigateByPath(r));
    try {
      await this.refreshAll();
      this.set({ ready: true });
    } catch (e) {
      this.set({ ready: true, error: e instanceof Error ? e.message : String(e) });
    }
  }

  async refreshAll(): Promise<void> {
    const teams = await this.rpc<TeamSummary[]>("teams.list");
    let activeTeamId = this.state.activeTeamId ?? readLocal("standbye.activeTeam");
    if (!activeTeamId || !teams.some((t) => t.id === activeTeamId)) activeTeamId = teams[0]?.id ?? null;
    if (activeTeamId) await this.rpc("teams.select", { id: activeTeamId });
    writeLocal("standbye.activeTeam", activeTeamId ?? "");
    const [status, providers, team, agents, channels, questions, runs, spend] = await Promise.all([
      this.rpc<SupervisorStatus>("status.get"), this.rpc<ProviderStatus>("providers.get"), this.rpc<TeamConfig | null>("team.get"), this.rpc<Agent[]>("agents.list"),
      this.rpc<Channel[]>("channels.list"), this.rpc<Question[]>("questions.list", {}), this.rpc<Run[]>("runs.list", { limit: 200 }), this.rpc<SpendSummary>("spend.get"),
    ]);
    this.set({
      firstStepsDismissed: readLocal("standbye.firstSteps." + (activeTeamId ?? "")) === "done",
      teams, activeTeamId, status, keys: readyMap(providers), providers, team, agents, channels, questions, runs, spend, messages: {}, steps: {},
      selectedAgentId: agents.some((a) => a.id === this.state.selectedAgentId) ? this.state.selectedAgentId : agents[0]?.id ?? null,
    });
    if (!team && this.state.sheet.kind === "none") this.set({ sheet: { kind: "onboarding" } });
    void this.loadModels();
  }

  async switchTeam(id: string): Promise<void> {
    if (id === this.state.activeTeamId) return;
    this.set({ activeTeamId: id, route: { name: "home" } });
    await this.refreshAll();
  }

  async loadModels(force = false): Promise<void> {
    try {
      const models = await this.rpc<Record<Provider, ModelInfo[]>>("models.list", { force });
      this.set({ models });
    } catch (e) {
      this.toast(`Could not load models: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  async setProviders(patch: Record<string, Partial<ProviderConfig>>): Promise<void> {
    const providers = await this.rpc<ProviderStatus>("providers.set", patch);
    this.set({ providers, keys: readyMap(providers) });
  }
  /** Ask a provider whether its credentials actually work, without saving anything. */
  async testProvider(id: string, config?: Partial<ProviderConfig>): Promise<{ ok: boolean; detail: string }> {
    return this.rpc<{ ok: boolean; detail: string }>("providers.test", { id, config });
  }

  private onEvent(e: PushEvent): void {
    if (e.event === "teams.updated") { this.set({ teams: e.data }); return; }
    if (e.event === "supervisor.reconnected") { this.toast("Reconnected to the supervisor."); void this.refreshAll(); return; }
    if (e.teamId && e.teamId !== this.state.activeTeamId) return; // another team's event; the switcher shows its counters
    switch (e.event) {
      case "agents.updated": this.set({ agents: e.data, selectedAgentId: this.state.selectedAgentId && e.data.some((a) => a.id === this.state.selectedAgentId) ? this.state.selectedAgentId : e.data[0]?.id ?? null }); break;
      case "agent.updated": this.set((s) => ({ agents: s.agents.some((a) => a.id === e.data.id) ? s.agents.map((a) => (a.id === e.data.id ? e.data : a)) : [...s.agents, e.data] })); break;
      case "message.created": this.set((s) => ({ messages: { ...s.messages, [e.data.channelId]: [...(s.messages[e.data.channelId] ?? []), e.data].slice(-500) } })); break;
      case "question.created": this.set((s) => ({ questions: [e.data, ...s.questions] })); break;
      case "question.updated": this.set((s) => ({ questions: s.questions.map((q) => (q.id === e.data.id ? e.data : q)) })); break;
      case "run.updated": this.set((s) => ({ runs: s.runs.some((r) => r.id === e.data.id) ? s.runs.map((r) => (r.id === e.data.id ? e.data : r)) : [e.data, ...s.runs] })); break;
      case "run.step": this.set((s) => ({ steps: { ...s.steps, [e.data.runId]: [...(s.steps[e.data.runId] ?? []), e.data].slice(-300) } })); break;
      case "team.updated": this.set({ team: e.data }); if (e.data) void this.rpc<Channel[]>("channels.list").then((channels) => this.set({ channels })); break;
      case "spend.updated": this.set({ spend: e.data }); break;
      case "skills.updated": this.set((s) => ({ skillsStamp: s.skillsStamp + 1 })); break;
      case "supervisor.status": this.set({ status: e.data }); break;
      case "notify": break;
    }
  }

  // ---------- navigation ----------

  navigate(route: Route): void {
    this.set({ route });
    if (route.name === "channel") void this.loadMessages(route.channelId);
    if (route.name === "dm") { void this.loadMessages(dmChannelId(route.agentId)); this.set({ selectedAgentId: route.agentId }); }
    if (route.name === "runs" && route.runId) void this.loadSteps(route.runId);
    if (route.name === "agent") this.set({ selectedAgentId: route.agentId });
  }
  navigateByPath(p: string): void {
    const [, a, b] = p.split("/");
    if (a === "inbox") this.navigate({ name: "inbox", questionId: b });
    else if (a === "agent" && b) this.navigate({ name: "dm", agentId: b });
    else if (a === "runs") this.navigate({ name: "runs", runId: b });
    else this.navigate({ name: "home" });
  }
  markSeen(channelId: string): void {
    const last = this.state.messages[channelId]?.at(-1)?.createdAt;
    if (last && last !== this.state.seen[channelId]) this.set((s) => ({ seen: { ...s.seen, [channelId]: last } }));
  }
  setChannels(channels: Channel[]): void { this.set({ channels }); }
  openSheet(sheet: Sheet): void { this.set({ sheet }); }
  closeSheet(): void { this.set({ sheet: { kind: "none" } }); }
  selectAgent(id: string | null): void { this.set({ selectedAgentId: id }); }
  toast(text: string): void {
    this.set({ toast: text });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.set({ toast: null }), 3500);
  }

  // ---------- data loaders ----------

  async loadMessages(channelId: string): Promise<void> {
    const messages = await this.rpc<Message[]>("messages.list", { channelId, limit: 200 });
    this.set((s) => ({ messages: { ...s.messages, [channelId]: messages } }));
  }
  async loadSteps(runId: string): Promise<void> {
    const r = await this.rpc<{ run: Run | null; steps: RunStep[] }>("run.get", { id: runId });
    this.set((s) => ({ steps: { ...s.steps, [runId]: r.steps }, runs: r.run && !s.runs.some((x) => x.id === runId) ? [r.run, ...s.runs] : s.runs }));
  }
  async loadAgentFiles(agentId: string): Promise<AgentFiles> {
    return this.rpc<AgentFiles>("agent.files.get", { id: agentId });
  }

  // ---------- actions ----------

  /**
   * Send and immediately show that something is happening: the agents named in the message are
   * marked "waking" until a run for them appears (or a few seconds pass), so the channel never
   * looks like it swallowed the message.
   */
  async sendMessage(channelId: string, text: string): Promise<void> {
    try {
      const m = await this.rpc<Message>("messages.send", { channelId, text });
      if (m.mentions.length) {
        this.set((s) => ({ waking: { ...s.waking, [m.id]: { agentIds: m.mentions, at: Date.now() } } }));
        setTimeout(() => this.set((s) => { const w = { ...s.waking }; delete w[m.id]; return { waking: w }; }), 12_000);
      }
    } catch (e) {
      this.toast(`Could not send: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  /** Ask an agent to have another go at a message whose run failed. */
  async retryMessage(agentId: string, text: string): Promise<void> {
    await this.rpc("agent.wake", { id: agentId, prompt: text });
    this.toast("Asked again.");
  }
  dismissFirstSteps(): void {
    writeLocal("standbye.firstSteps." + (this.state.activeTeamId ?? ""), "done");
    this.set({ firstStepsDismissed: true });
  }
  async answerQuestion(id: string, answer: string, remember: boolean): Promise<void> {
    await this.rpc("questions.answer", { id, answer, remember });
    this.toast(remember ? "Answer sent and saved as a team decision." : "Answer sent.");
  }
  async dismissQuestion(id: string): Promise<void> { await this.rpc("questions.dismiss", { id }); }
  async pauseAll(): Promise<void> { await this.rpc("supervisor.pauseAll"); this.toast("All agents paused."); }
  async resumeAll(): Promise<void> { await this.rpc("supervisor.resumeAll"); this.toast("Agents resumed."); }
  async pauseAgent(id: string, paused: boolean): Promise<void> { await this.rpc(paused ? "agent.pause" : "agent.resume", { id }); }
  async wakeAgent(id: string, prompt: string): Promise<void> { await this.rpc("agent.wake", { id, prompt }); this.toast("Sent."); }
  async checkinAgent(id: string): Promise<void> { await this.rpc("agent.checkin", { id }); this.toast("Check-in queued."); }
  async updateAgent(id: string, patch: Partial<Agent>): Promise<void> { await this.rpc("agent.update", { id, patch }); }
  async saveAgentFile(id: string, file: keyof AgentFiles, content: string): Promise<void> { await this.rpc("agent.files.set", { id, file, content }); this.toast("Saved."); }
  async cancelRun(id: string): Promise<void> { await this.rpc("run.cancel", { id }); }
  async saveKeys(patch: Record<string, string>): Promise<void> {
    await window.crew.keysSet(patch);
    const providers = await this.rpc<ProviderStatus>("providers.get");
    this.set({ providers, keys: readyMap(providers) });
    this.toast(Object.values(patch).some(Boolean) ? "Key saved." : "Key removed.");
    void this.loadModels(true);
  }
  async draftTeam(description: string, ownerName: string, workspaceRoot: string | null, provider?: Provider, mode: "describe" | "template" = "describe"): Promise<void> {
    this.set({ builderBusy: true });
    try {
      const draft = await this.rpc<TeamDraft>("builder.draft", { description, ownerName, workspaceRoot, provider, mode });
      this.set({ builderDraft: draft });
    } catch (e) {
      this.toast(`Draft failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.set({ builderBusy: false });
    }
  }
  setDraft(draft: TeamDraft | null): void { this.set({ builderDraft: draft }); }
  /**
   * Open a project folder as a team, like an editor opens a directory.
   * If the folder already holds a `.standbye` team we attach to it; if not, we start the
   * new-team flow with that folder already chosen.
   */
  async openFolder(): Promise<void> {
    const dir = await window.crew.pickFolder();
    if (!dir) return;
    const probe = await this.rpc<{ hasTeam: boolean; name: string | null; agentCount: number; alreadyOpen: boolean }>("teams.probeFolder", { path: dir });
    if (!probe.hasTeam) {
      this.set({ pendingWorkspace: dir, sheet: { kind: "onboarding" } });
      this.toast(`No team in that folder yet. Let's make one for ${dir.split("/").pop()}.`);
      return;
    }
    const team = await this.rpc<TeamConfig>("teams.openFolder", { path: dir });
    this.set({ activeTeamId: team.id, route: { name: "home" } });
    await this.refreshAll();
    this.toast(probe.alreadyOpen ? `Switched to ${team.name}.` : `Opened ${team.name}: ${probe.agentCount} agents.`);
  }

  async createTeam(draft: TeamDraft, workspaceRoot: string | null, ownerName: string, git: GitSettings | null = null): Promise<void> {
    const team = await this.rpc<TeamConfig>("teams.create", { draft, workspaceRoot, ownerName, git });
    this.set({ activeTeamId: team.id, sheet: { kind: "none" }, builderDraft: null, pendingWorkspace: null, route: { name: "home" } });
    await this.refreshAll();
    this.toast(`Team "${team.name}" created. First check-ins in about a minute.`);
  }
  // ---------- removing a team ----------

  /** Teams the owner has taken off the list. Loaded on demand, since the switcher is the only place they show. */
  async loadArchived(): Promise<void> {
    try { this.set({ archived: await this.rpc<ArchivedTeam[]>("teams.archived") }); } catch { /* older supervisor */ }
  }
  /**
   * Take a team off the list. Its scheduler stops, so it can no longer wake, run or spend,
   * but every file it owns stays exactly where it is.
   */
  async archiveTeam(id: string): Promise<void> {
    const name = this.state.teams.find((t) => t.id === id)?.name ?? "The team";
    const row = await this.rpc<ArchivedTeam>("teams.archive", { id });
    if (this.state.activeTeamId === id) this.set({ activeTeamId: null, route: { name: "home" } });
    this.set({ sheet: { kind: "none" } });
    await this.refreshAll();
    await this.loadArchived();
    this.toast(row.portable ? `${name} stopped. Its files stay in ${row.dir}.` : `${name} stopped. Put it back any time from the team menu.`);
  }
  /** Put an archived team back to work. */
  async restoreTeam(id: string): Promise<void> {
    try {
      const team = await this.rpc<TeamConfig>("teams.restore", { id });
      this.set({ activeTeamId: team.id, route: { name: "home" } });
      await this.refreshAll();
      await this.loadArchived();
      this.toast(`${team.name} is working again.`);
    } catch (e) {
      await this.loadArchived();
      this.toast(e instanceof Error ? e.message : String(e));
    }
  }
  /** Delete a team and everything it has ever done. There is no undo. */
  async deleteTeam(id?: string): Promise<void> {
    const target = id ?? this.state.activeTeamId;
    if (!target) return;
    const name = this.state.teams.find((t) => t.id === target)?.name
      ?? this.state.archived.find((t) => t.id === target)?.name ?? "The team";
    await this.rpc("teams.delete", { id: target, removeFiles: true });
    if (this.state.activeTeamId === target) this.set({ activeTeamId: null, route: { name: "home" } });
    this.set({ sheet: { kind: "none" } });
    await this.refreshAll();
    await this.loadArchived();
    this.toast(`${name} deleted.`);
  }
}

/** Which providers can run right now, by id — the one thing the rest of the UI asks about keys. */
function readyMap(providers: ProviderStatus): KeyStatus {
  return Object.fromEntries(Object.entries(providers).map(([id, p]) => [id, p.ready]));
}

function readLocal(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLocal(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

export const store = new Store();

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()));
}
