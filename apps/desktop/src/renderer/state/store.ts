import { useSyncExternalStore } from "react";
import type {
  Agent, AgentFiles, Channel, KeyStatus, Message, ModelInfo, Provider, ProviderConfig, ProviderStatus, PushEvent, Question, Run, RunStep, SpendSummary, SupervisorStatus, TeamConfig, TeamDraft,
} from "@crew/shared";

export type Route =
  | { name: "home" }
  | { name: "inbox"; questionId?: string }
  | { name: "runs"; runId?: string }
  | { name: "channel"; channelId: string }
  | { name: "agent"; agentId: string };

export type Sheet =
  | { kind: "none" }
  | { kind: "onboarding" }
  | { kind: "builder"; mode?: "describe" | "template" }
  | { kind: "manual" }
  | { kind: "keys" }
  | { kind: "agent"; agentId: string; tab?: string }
  | { kind: "wake"; agentId: string };

export interface State {
  ready: boolean;
  error: string | null;
  route: Route;
  sheet: Sheet;
  status: SupervisorStatus | null;
  keys: KeyStatus;
  providers: ProviderStatus | null;
  models: Record<Provider, ModelInfo[]> | null;
  team: TeamConfig | null;
  agents: Agent[];
  channels: Channel[];
  messages: Record<string, Message[]>;
  questions: Question[];
  runs: Run[];
  steps: Record<string, RunStep[]>;
  spend: SpendSummary | null;
  selectedAgentId: string | null;
  builderDraft: TeamDraft | null;
  builderBusy: boolean;
  toast: string | null;
}

const initial: State = {
  ready: false, error: null, route: { name: "home" }, sheet: { kind: "none" }, status: null,
  keys: { anthropic: false, openrouter: false }, providers: null, models: null, team: null, agents: [], channels: [], messages: {}, questions: [], runs: [], steps: {},
  spend: null, selectedAgentId: null, builderDraft: null, builderBusy: false, toast: null,
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
    const [status, keys, providers, team, agents, channels, questions, runs, spend] = await Promise.all([
      this.rpc<SupervisorStatus>("status.get"), window.crew.keysGet(), this.rpc<ProviderStatus>("providers.get"), this.rpc<TeamConfig | null>("team.get"), this.rpc<Agent[]>("agents.list"),
      this.rpc<Channel[]>("channels.list"), this.rpc<Question[]>("questions.list", {}), this.rpc<Run[]>("runs.list", { limit: 200 }), this.rpc<SpendSummary>("spend.get"),
    ]);
    this.set({ status, keys, providers, team, agents, channels, questions, runs, spend, selectedAgentId: this.state.selectedAgentId ?? agents[0]?.id ?? null });
    if (!team && this.state.sheet.kind === "none") this.set({ sheet: { kind: "onboarding" } });
    void this.loadModels();
  }

  async loadModels(force = false): Promise<void> {
    try {
      const models = await this.rpc<Record<Provider, ModelInfo[]>>("models.list", { force });
      this.set({ models });
    } catch (e) {
      this.toast(`Could not load models: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  async setProviders(patch: { anthropic?: Partial<ProviderConfig>; openrouter?: Partial<ProviderConfig> }): Promise<void> {
    const providers = await this.rpc<ProviderStatus>("providers.set", patch);
    this.set({ providers, keys: { anthropic: providers.anthropic.ready, openrouter: providers.openrouter.ready } });
  }

  private onEvent(e: PushEvent): void {
    switch (e.event) {
      case "agents.updated": this.set({ agents: e.data, selectedAgentId: this.state.selectedAgentId && e.data.some((a) => a.id === this.state.selectedAgentId) ? this.state.selectedAgentId : e.data[0]?.id ?? null }); break;
      case "agent.updated": this.set((s) => ({ agents: s.agents.some((a) => a.id === e.data.id) ? s.agents.map((a) => (a.id === e.data.id ? e.data : a)) : [...s.agents, e.data] })); break;
      case "message.created": this.set((s) => ({ messages: { ...s.messages, [e.data.channelId]: [...(s.messages[e.data.channelId] ?? []), e.data].slice(-500) } })); break;
      case "question.created": this.set((s) => ({ questions: [e.data, ...s.questions] })); break;
      case "question.updated": this.set((s) => ({ questions: s.questions.map((q) => (q.id === e.data.id ? e.data : q)) })); break;
      case "run.updated": this.set((s) => ({ runs: s.runs.some((r) => r.id === e.data.id) ? s.runs.map((r) => (r.id === e.data.id ? e.data : r)) : [e.data, ...s.runs] })); break;
      case "run.step": this.set((s) => ({ steps: s.steps[e.data.runId] ? { ...s.steps, [e.data.runId]: [...s.steps[e.data.runId]!, e.data] } : s.steps })); break;
      case "team.updated": this.set({ team: e.data }); if (e.data) void this.rpc<Channel[]>("channels.list").then((channels) => this.set({ channels })); break;
      case "spend.updated": this.set({ spend: e.data }); break;
      case "supervisor.status": this.set({ status: e.data }); break;
      case "notify": break;
    }
  }

  // ---------- navigation ----------

  navigate(route: Route): void {
    this.set({ route });
    if (route.name === "channel") void this.loadMessages(route.channelId);
    if (route.name === "runs" && route.runId) void this.loadSteps(route.runId);
    if (route.name === "agent") this.set({ selectedAgentId: route.agentId });
  }
  navigateByPath(p: string): void {
    const [, a, b] = p.split("/");
    if (a === "inbox") this.navigate({ name: "inbox", questionId: b });
    else if (a === "agent" && b) this.navigate({ name: "agent", agentId: b });
    else if (a === "runs") this.navigate({ name: "runs", runId: b });
    else this.navigate({ name: "home" });
  }
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

  async sendMessage(channelId: string, text: string): Promise<void> { await this.rpc("messages.send", { channelId, text }); }
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
    this.set({ providers, keys: { anthropic: providers.anthropic.ready, openrouter: providers.openrouter.ready } });
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
  async createTeam(draft: TeamDraft, workspaceRoot: string | null, ownerName: string): Promise<void> {
    await this.rpc("team.create", { draft, workspaceRoot, ownerName });
    await this.refreshAll();
    this.set({ sheet: { kind: "none" }, builderDraft: null, route: { name: "home" } });
    this.toast("Team created. First check-ins in about a minute.");
  }
  async deleteTeam(): Promise<void> { await this.rpc("team.delete"); await this.refreshAll(); }
}

export const store = new Store();

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()));
}
