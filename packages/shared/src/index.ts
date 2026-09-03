import { z } from "zod";

// ---------- Providers & models ----------

export type Provider = "anthropic" | "openrouter";

export const DEFAULT_MODELS: Record<Provider, { main: string; checkin: string }> = {
  anthropic: { main: "claude-opus-5", checkin: "claude-haiku-4-5" },
  openrouter: { main: "z-ai/glm-5.3", checkin: "z-ai/glm-5.3-flash" },
};

// ---------- Models & providers ----------

export interface ModelInfo {
  id: string;
  name: string;
  provider: Provider;
  /** USD per million tokens, null when unknown */
  inputPerM: number | null;
  outputPerM: number | null;
  context: number | null;
  tools: boolean;
  /** e.g. "reasoning", "fast", "cheap" */
  tags: string[];
}

/** Curated Claude models with list prices (USD per million tokens). The supervisor merges the live Models API on top; the site shows this list as-is. */
export const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: "claude-opus-5", name: "Claude Opus 5", provider: "anthropic", inputPerM: 5, outputPerM: 25, context: 1_000_000, tools: true, tags: ["default", "reasoning"] },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5", provider: "anthropic", inputPerM: 2, outputPerM: 10, context: 1_000_000, tools: true, tags: ["balanced"] },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic", inputPerM: 1, outputPerM: 5, context: 200_000, tools: true, tags: ["cheap", "check-ins"] },
  { id: "claude-opus-4-8", name: "Claude Opus 4.8", provider: "anthropic", inputPerM: 5, outputPerM: 25, context: 1_000_000, tools: true, tags: ["reasoning"] },
  { id: "claude-opus-4-7", name: "Claude Opus 4.7", provider: "anthropic", inputPerM: 5, outputPerM: 25, context: 1_000_000, tools: true, tags: [] },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic", inputPerM: 3, outputPerM: 15, context: 1_000_000, tools: true, tags: [] },
  { id: "claude-fable-5-1", name: "Claude Fable 5.1", provider: "anthropic", inputPerM: 10, outputPerM: 50, context: 1_000_000, tools: true, tags: ["most capable", "expensive"] },
];

export interface ProviderConfig {
  enabled: boolean;
  /** Model new agents and the team builder use on this provider */
  defaultModel: string;
  /** Cheap model for check-ins on this provider */
  checkinModel: string;
}

export interface ProviderSettings {
  anthropic: ProviderConfig;
  openrouter: ProviderConfig;
}

export interface ProviderStatus {
  anthropic: ProviderConfig & { hasKey: boolean; hasLogin: boolean; ready: boolean };
  openrouter: ProviderConfig & { hasKey: boolean; ready: boolean };
}

export type BudgetCap = "day" | "hour" | "run";

export interface Budget {
  dailyUsd: number;
  perRunUsd: number;
  /** Optional rolling 60-minute cap */
  hourlyUsd?: number | null;
  /** Which figure the owner thinks in; all three are enforced when set */
  capBy?: BudgetCap;
}

// ---------- Permissions ----------

export type PermissionBehavior = "allow" | "ask" | "block";

export interface PermissionRule {
  /** Tool name or glob, e.g. "Bash(git push*)", "Edit", "mcp__team__*" */
  pattern: string;
  behavior: PermissionBehavior;
  /** Human-readable reason shown in approvals */
  label?: string;
}

// ---------- Agents ----------

export interface CronTrigger {
  name: string;
  /** croner expression, e.g. "0 9 * * 1-5" */
  expr: string;
  prompt: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  provider: Provider;
  model: string;
  /** Cheap model used for check-ins (heartbeats). */
  checkinModel: string;
  heartbeat: {
    everyMinutes: number;
    /** null = around the clock */
    workHours: { start: string; end: string } | null;
  };
  triggers: {
    onMention: boolean;
    cron: CronTrigger[];
  };
  permissions: PermissionRule[];
  budget: Budget;
  channels: string[];
  /** Working directory the agent operates in. Defaults to the team workspace. */
  workspace: string | null;
  color: string;
  paused: boolean;
  createdAt: string;
}

export type AgentStatus = "working" | "needs_you" | "idle" | "paused" | "failed" | "over_budget";

export interface Agent extends AgentConfig {
  status: AgentStatus;
  statusText: string;
  currentRunId: string | null;
  spentTodayUsd: number;
  lastRunAt: string | null;
  nextWakeAt: string | null;
  memoryCount: number;
}

// ---------- Team ----------

/** How the team uses git in its workspace. Only meaningful when the workspace is a git repo. */
export interface GitSettings {
  enabled: boolean;
  /** Branch agents check out and work on. In PR mode they branch off it and open PRs against it. */
  workBranch: string;
  /** pr = feature branches + pull requests via gh; push = commit and push straight to workBranch */
  mode: "pr" | "push";
  devBranch: string | null;
  stagingBranch: string | null;
  productionBranch: string | null;
}

export interface GitInfo {
  isRepo: boolean;
  currentBranch: string | null;
  branches: string[];
  hasRemote: boolean;
  remoteUrl: string | null;
  hasGh: boolean;
}

// ---------- Workspace watcher ----------

/** Kinds of real-world facts the watcher turns into wake-ups. */
export type WatchSource = "commit" | "pr" | "ci" | "files";

/** Per-team watcher config. Polls the workspace locally; there is no inbound webhook. */
export interface WatchSettings {
  enabled: boolean;
  /** Tick cadence in seconds (minimum 30). */
  everySeconds: number;
  /** New commits on the team's branches, and a working tree left dirty. */
  commits: boolean;
  /** Pull request opened / review requested / merged, via `gh`. */
  pullRequests: boolean;
  /** Failed checks, via `gh run list`. */
  ci: boolean;
  /** The owner editing files in the workspace by hand. */
  files: boolean;
  /** Run `git fetch` before looking at branches. Off by default: no surprise network calls. */
  fetch: boolean;
  /** Agent to wake. null = pick one (a reviewer for code events, otherwise the lead). */
  notify: string | null;
}

export function defaultWatchSettings(hasWorkspace: boolean, isRepo: boolean, ghReady: boolean): WatchSettings {
  return {
    enabled: hasWorkspace,
    everySeconds: 60,
    commits: isRepo,
    pullRequests: isRepo && ghReady,
    ci: isRepo && ghReady,
    files: hasWorkspace,
    fetch: false,
    notify: null,
  };
}

/** One fact the watcher noticed. Deduplicated by `key`, so it is recorded at most once. */
export interface WatchEvent {
  key: string;
  source: WatchSource;
  summary: string;
  detail: string;
  /** Agent that was woken, or null when nobody could take it. */
  agentId: string | null;
  at: string;
}

export type GhAvailability = "ready" | "missing" | "unauthenticated" | "no-remote" | "not-github";

export interface WatchStatus {
  /** The team has a workspace on disk. Without one there is nothing to watch. */
  available: boolean;
  isRepo: boolean;
  settings: WatchSettings;
  gh: GhAvailability;
  lastTickAt: string | null;
  nextTickAt: string | null;
  lastError: string | null;
  /** Branch -> last commit the watcher has already accounted for. */
  branchHeads: Record<string, string>;
  /** Most recent facts, newest first. */
  recent: WatchEvent[];
}

export interface TeamConfig {
  id: string;
  name: string;
  charter: string;
  git?: GitSettings | null;
  watch?: WatchSettings | null;
  /** Hard daily cap for the whole team in USD. */
  dailyCapUsd: number;
  /** Max agent-to-agent reply depth for a single thread of mentions. */
  chatDepthCap: number;
  workspaceRoot: string | null;
  ownerName: string;
  createdAt: string;
}

/** One row in the team switcher. Every team has its own folder, database, agents, channels and workspace. */
export interface TeamSummary {
  id: string;
  name: string;
  ownerName: string;
  workspaceRoot: string | null;
  agentCount: number;
  working: number;
  needsYou: number;
  spendTodayUsd: number;
  pausedAll: boolean;
  createdAt: string;
}

export interface Channel {
  id: string;
  name: string;
  purpose: string;
  members: string[];
  /** group = a room everyone listed can post in; dm = the owner's direct chat with one agent (id `dm-<agentId>`) */
  kind: "group" | "dm";
  dmAgentId: string | null;
}

export function dmChannelId(agentId: string): string {
  return `dm-${agentId}`;
}

export type MessageKind = "message" | "system" | "question";

export interface Message {
  id: string;
  channelId: string;
  /** agent id, "user" or "system" */
  authorId: string;
  authorName: string;
  kind: MessageKind;
  text: string;
  mentions: string[];
  /** agent-to-agent reply depth, 0 for user/system/fresh */
  depth: number;
  runId: string | null;
  questionId: string | null;
  createdAt: string;
}

// ---------- Questions / approvals ----------

export type QuestionKind = "question" | "approval" | "hire" | "report";
export type QuestionStatus = "open" | "answered" | "expired" | "dismissed";

export interface Question {
  id: string;
  kind: QuestionKind;
  fromAgentId: string;
  /** "user" or an agent id */
  toId: string;
  channelId: string | null;
  title: string;
  body: string;
  options: string[];
  recommended: string | null;
  defaultAnswer: string | null;
  defaultAt: string | null;
  status: QuestionStatus;
  answer: string | null;
  answeredBy: string | null;
  /** kind-specific data (hire proposal, approval tool input, report body) */
  payload: Record<string, unknown> | null;
  runId: string | null;
  createdAt: string;
  answeredAt: string | null;
}

// ---------- Runs ----------

export type RunTrigger =
  | { kind: "heartbeat" }
  | { kind: "schedule"; name: string; prompt: string }
  | { kind: "mention"; messageId: string; by: string; depth: number }
  /** `event` is set when the workspace watcher raised the task rather than a person or teammate. */
  | { kind: "task"; title: string; details: string; from: string; event?: WatchSource }
  | { kind: "answer"; questionId: string }
  | { kind: "question"; questionId: string; from: string }
  | { kind: "escalated"; reason: string }
  | { kind: "manual"; prompt: string };

export type RunStatus = "queued" | "running" | "done" | "failed" | "needs_you" | "noop" | "cancelled";

export interface Run {
  id: string;
  agentId: string;
  trigger: RunTrigger;
  status: RunStatus;
  summary: string;
  model: string;
  startedAt: string | null;
  finishedAt: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  stepCount: number;
  error: string | null;
  createdAt: string;
}

export type RunStepKind = "read" | "edit" | "run" | "post" | "ask" | "memory" | "tool" | "text" | "git" | "info";

export interface RunStep {
  id: string;
  runId: string;
  at: string;
  kind: RunStepKind;
  text: string;
  detail: string | null;
}

// ---------- Spend ----------

export interface SpendSummary {
  todayUsd: number;
  capUsd: number;
  perAgent: Record<string, number>;
  checkinsUsd: number;
}

// ---------- Keys ----------

export interface KeyStatus {
  anthropic: boolean;
  openrouter: boolean;
}

// ---------- Team builder ----------

export const AgentDraftSchema = z.object({
  name: z.string().describe("Short first name, e.g. Ada"),
  role: z.string().describe("Role title, e.g. Backend engineer"),
  provider: z.enum(["anthropic", "openrouter"]),
  model: z.string().describe("Model id for the provider"),
  soul: z.string().describe("SOUL.md contents: who they are, how they work, how they talk. Markdown, second person."),
  rules: z.array(z.string()).describe("Hard rules the app enforces or the agent must never break"),
  responsibilities: z.array(z.string()).describe("2-4 concrete standing responsibilities"),
  heartbeatMinutes: z.number().int().min(5).max(720),
  dailyBudgetUsd: z.number().min(0.1).max(100),
  hourlyBudgetUsd: z.number().min(0.05).max(50).nullable().optional(),
  perRunBudgetUsd: z.number().min(0.1).max(50).nullable().optional(),
  capBy: z.enum(["day", "hour", "run"]).optional(),
  channels: z.array(z.string()),
  color: z.string().describe("hex background color for the avatar"),
  schedules: z
    .array(z.object({ name: z.string(), expr: z.string().describe("5-field cron, e.g. '0 9 * * 1-5'"), prompt: z.string() }))
    .optional()
    .describe("Recurring duties, e.g. a 09:00 standup for the lead"),
});

export const TeamDraftSchema = z.object({
  name: z.string(),
  charter: z.string().describe("One to three sentences: the standing goal of the team"),
  agents: z.array(AgentDraftSchema).min(1).max(8),
  channels: z.array(
    z.object({
      name: z.string().describe("lowercase, no #"),
      purpose: z.string(),
      members: z.array(z.string()).describe("agent names"),
    }),
  ),
  guardrails: z.array(z.string()).describe("Actions that need the owner's approval"),
  dailyCapUsd: z.number(),
  estimatedDailyUsd: z.object({ low: z.number(), high: z.number() }),
  questionsForOwner: z.array(z.string()).describe("Things the builder was unsure about, phrased as yes/no questions"),
});

export type AgentDraft = z.infer<typeof AgentDraftSchema>;
export type TeamDraft = z.infer<typeof TeamDraftSchema>;

// ---------- RPC ----------

export interface RpcRequest {
  id: number;
  method: string;
  params?: unknown;
}

export interface RpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export type PushEvent = (
  | { event: "teams.updated"; data: TeamSummary[] }
  | { event: "agent.updated"; data: Agent }
  | { event: "agents.updated"; data: Agent[] }
  | { event: "message.created"; data: Message }
  | { event: "question.created"; data: Question }
  | { event: "question.updated"; data: Question }
  | { event: "run.updated"; data: Run }
  | { event: "run.step"; data: RunStep }
  | { event: "team.updated"; data: TeamConfig | null }
  | { event: "spend.updated"; data: SpendSummary }
  | { event: "notify"; data: { title: string; body: string; questionId?: string } }
  | { event: "supervisor.status"; data: SupervisorStatus }
  | { event: "supervisor.reconnected"; data: null }
) & {
  /** Which team the event belongs to; absent for global events (teams.updated) */
  teamId?: string;
};

export interface SupervisorStatus {
  teamId: string | null;
  startedAt: string;
  pausedAll: boolean;
  runningRuns: number;
  runsToday: number;
  keys: KeyStatus;
  nextWake: { agentId: string; at: string } | null;
}

export interface AgentFiles {
  soul: string;
  rules: string;
  memory: string;
}

export interface Skill {
  name: string;
  content: string;
  updatedAt: string;
}
