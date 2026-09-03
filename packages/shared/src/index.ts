import { z } from "zod";
import { PROVIDERS, providerSpec } from "./providers.js";

export * from "./providers.js";

// ---------- Providers & models ----------

/**
 * A provider id from the catalog in providers.ts, e.g. "anthropic", "codex", "ollama".
 * It is a plain string on purpose: adding a provider must not mean touching this file,
 * and an agent whose provider was removed from the catalog still has to load.
 */
export type Provider = string;

/** Every provider's out-of-the-box model choices, keyed by provider id. */
export const DEFAULT_MODELS: Record<Provider, { main: string; checkin: string }> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p.defaults]),
);

/** Same, but safe for a provider id that is not in the catalog (an old agent.json, say). */
export function defaultModelsFor(id: Provider): { main: string; checkin: string } {
  return DEFAULT_MODELS[id] ?? { main: "", checkin: "" };
}

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
export const ANTHROPIC_MODELS: ModelInfo[] = providerSpec("anthropic")?.models ?? [];

export interface ProviderConfig {
  enabled: boolean;
  /** Model new agents and the team builder use on this provider */
  defaultModel: string;
  /** Cheap model for check-ins on this provider */
  checkinModel: string;
  /**
   * Values for the spec's extra fields: a base URL, an AWS region, a GCP project.
   * Nothing secret goes here — keys live in the OS keychain, not in providers.json.
   */
  settings?: Record<string, string>;
  /** Owner's override of how a coding-agent CLI is invoked, when a vendor changes its flags. */
  cli?: { bin?: string; args?: string[] };
}

export type ProviderSettings = Record<Provider, ProviderConfig>;

/** A provider's config plus everything the app worked out about whether it can actually run. */
export interface ProviderState extends ProviderConfig {
  /** An API key is saved (or present in the environment). */
  hasKey: boolean;
  /** A login on this Mac covers it — today only the Claude Code login. */
  hasLogin: boolean;
  /** The CLI binary was found on PATH; null for providers that are not CLIs. */
  cliPath: string | null;
  /** Every required field in the spec has a value. */
  configured: boolean;
  /** Switched on and able to run right now. */
  ready: boolean;
  /** Why it is not ready, in one line the owner can act on. Empty when ready. */
  blocker: string;
}

export type ProviderStatus = Record<Provider, ProviderState>;

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
  /**
   * Skills this agent should not be offered, by name. Everything in scope is on by default,
   * so turning one off is the exception the owner records, not a list they have to maintain.
   */
  disabledSkills?: string[];
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
  /** How far the team may go on its own. Defaults to "pr". */
  autonomy?: Autonomy;
  /**
   * The owner stopped the whole team. Saved with the team rather than held in memory: pausing
   * something and finding it running again after a restart is the opposite of what pause means.
   */
  paused?: boolean;
  /**
   * The owner asked to stop, but not mid-sentence: nothing new starts, and the team pauses for
   * real once the work already in flight has finished. Saved for the same reason `paused` is —
   * a supervisor that restarts in the middle of winding down must carry on winding down.
   */
  pauseWhenIdle?: boolean;
  createdAt: string;
}

/**
 * How much the team decides for itself.
 *
 * This is the owner's dial, not the model's: every level is enforced by the app the same way
 * permissions and budgets are, so an agent cannot talk its way past it.
 *
 *  - `propose`  find work and rank it, but ask before writing any of it. A person is in the loop
 *               for every item.
 *  - `pr`       pick work off the backlog and build it on a branch, ending in a pull request.
 *               Nothing reaches a protected branch without the owner. The default.
 *  - `auto`     pick, build and land work on the team's own work branch without asking. Staging
 *               and production are still gated by the git rules.
 */
export type Autonomy = "propose" | "pr" | "auto";

export const AUTONOMY_LABEL: Record<Autonomy, string> = {
  propose: "Propose only",
  pr: "Build, then open a pull request",
  auto: "Build and land it",
};

/** One line the owner can read in Settings, and the agents are told verbatim. */
export const AUTONOMY_RULE: Record<Autonomy, string> = {
  propose: "Find work and write it to the backlog, but do not write code for an item until the owner says yes. Ask with ask_user.",
  pr: "Take work off the backlog and build it on its own branch, ending in a pull request for the owner. Never merge it yourself and never push to a protected branch.",
  auto: "Take work off the backlog, build it, and land it on the team's work branch once the tests pass. Do not ask the owner anything — decide, and record what you decided. A rule set to \"ask\" passes without asking at this level; a rule set to \"block\" still blocks.",
};

// ---------- Backlog ----------

/**
 * Where an item is up to. A team that decides its own work needs somewhere for an idea to live
 * between being noticed and being built — otherwise every idea is lost at the end of the run
 * that had it.
 */
export type BacklogStatus = "idea" | "ready" | "claimed" | "in_review" | "done" | "dropped";

export interface BacklogItem {
  id: string;
  title: string;
  /** What it actually is, concretely enough for someone else to pick up. */
  detail: string;
  /** The case for doing it: what is wrong or missing today, and who it hurts. */
  rationale: string;
  status: BacklogStatus;
  /** Agent id, or "user" when the owner added it. */
  addedBy: string;
  /** Who is building it now. */
  claimedBy: string | null;
  /** The lead's ordering; lower is sooner. */
  rank: number;
  size: "small" | "medium" | "large";
  /** Set once it is being built. */
  branch: string | null;
  pr: string | null;
  /** Filled in when it is finished or dropped, so the reason survives. */
  outcome: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A team lives in a folder. When it has a workspace the folder is `<workspace>/.standbye`,
 * so the team travels with the project and can be committed and shared; otherwise it sits
 * under the app's data dir.
 */
export const TEAM_DIR_NAME = ".standbye";

/**
 * How the app names itself to a provider that shows the owner which app made a call.
 * OpenRouter's activity log is the one that matters today: it prints the title and links the
 * URL, so without these every run the owner pays for is an anonymous line in their dashboard.
 */
export const APP_NAME = "StandBye";
export const APP_URL = "https://standbye.navid.tr";

/**
 * How far along the app is in updating itself. `available` means we found a newer release and have
 * not fetched it; `ready` means the new version is on disk, verified, and one restart away.
 */
export type UpdateStage = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

/** The newer release, as much of it as the owner needs to decide. */
export interface UpdateRelease {
  /** The tag with any leading `v` stripped, e.g. `0.2.0`. */
  version: string;
  name: string;
  /** The release notes, as GitHub markdown. */
  notes: string;
  /** The release page, for when we cannot install it ourselves. */
  url: string;
  publishedAt: string | null;
  /** The file this machine would install, when the release has one it can use. */
  assetName: string | null;
  assetSize: number;
}

export interface UpdateState {
  stage: UpdateStage;
  /** The version running right now. */
  current: string;
  release: UpdateRelease | null;
  /** 0..1 while downloading. */
  progress: number;
  error: string | null;
  /** When we last reached GitHub, whatever the answer was. */
  checkedAt: string | null;
  /**
   * Whether this build can replace itself. False for a dev run, for a Linux `.deb`, and for any
   * release with no file matching this platform and architecture — there the release page is all
   * we can honestly offer.
   */
  canInstall: boolean;
  autoUpdate: boolean;
}

/** One row in the team switcher. Every team has its own folder, database, agents, channels and workspace. */
export interface TeamSummary {
  id: string;
  name: string;
  ownerName: string;
  workspaceRoot: string | null;
  /** Where the team's own files live. */
  dir: string;
  /** True when that folder is `<workspace>/.standbye` rather than the app's data dir. */
  portable: boolean;
  agentCount: number;
  working: number;
  needsYou: number;
  spendTodayUsd: number;
  pausedAll: boolean;
  /** Winding down: no new work is started, and the pause lands when the last run finishes. */
  pausePending: boolean;
  createdAt: string;
}

/**
 * A team the owner has taken off the list. Its files are untouched; it simply is not open,
 * so nothing schedules it and it cannot spend anything. Being on the live list is what
 * makes a team able to work in the background, so removing it from that list is the off switch.
 */
export interface ArchivedTeam {
  id: string;
  name: string;
  /** The folder still holding its database and agents. */
  dir: string;
  workspaceRoot: string | null;
  portable: boolean;
  agentCount: number;
  archivedAt: string;
  /** False when the folder has since been moved or deleted, so the app can offer to forget it. */
  present: boolean;
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

/** A message an agent is part-way through writing. Replaced by the real message when it lands. */
export interface MessageDraft {
  runId: string;
  agentId: string;
  channelId: string;
  /** Everything written so far, not just the newest piece. */
  text: string;
  /** True when the agent stopped writing: either the message is about to land, or it was abandoned. */
  done: boolean;
}

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
  | { kind: "manual"; prompt: string }
  /**
   * A run that was cut off — the machine slept, the app quit, the supervisor was restarted —
   * picked up again with what it had already done. `runId` is the run that was interrupted.
   */
  | { kind: "resumed"; runId: string; was: RunTrigger };

export type RunStatus = "queued" | "running" | "done" | "failed" | "needs_you" | "noop" | "cancelled";

export interface Run {
  id: string;
  agentId: string;
  trigger: RunTrigger;
  status: RunStatus;
  summary: string;
  model: string;
  /** Workspace HEAD when the run started, from one rev-parse where the steps open. Null when the
   * workspace is not a git repo or the run predates recording; run.diff refuses to guess without it. */
  baseHead: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  stepCount: number;
  error: string | null;
  createdAt: string;
}

/** Result of run.diff: what changed in the workspace between the run's recorded base and its HEAD.
 * Unavailable means we will not show a diff rather than show a wrong one (branch switched, rebased,
 * no repo, or the run predates base recording). An available empty diff means the run made no commits. */
export interface RunDiff {
  runId: string;
  available: boolean;
  reason: string | null;
  baseHead: string | null;
  head: string | null;
  /** Output of `git diff <base>..HEAD --stat` ("" when the diff is empty). */
  stat: string | null;
  /** Full `git diff <base>..HEAD` patch ("" when the diff is empty). */
  patch: string | null;
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

/** Which providers can run right now, by provider id. Never the keys themselves. */
export type KeyStatus = Record<Provider, boolean>;

// ---------- Team builder ----------

export const AgentDraftSchema = z.object({
  name: z.string().describe("Short first name, e.g. Ada"),
  role: z.string().describe("Role title, e.g. Backend engineer"),
  provider: z.string().describe("Provider id from the catalog, e.g. anthropic, openrouter, codex"),
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
  /**
   * An agent is writing a message right now. The text grows as the model produces it, so a
   * channel can show the reply arriving instead of a spinner. Always followed by the real
   * `message.created` (or by `done: true` with no message, if the agent changed its mind).
   */
  | { event: "message.draft"; data: MessageDraft }
  /** What an agent is reasoning about right now, for the line that would otherwise be a spinner. */
  | { event: "run.thinking"; data: { runId: string; agentId: string; text: string } }
  | { event: "question.created"; data: Question }
  | { event: "question.updated"; data: Question }
  | { event: "run.updated"; data: Run }
  | { event: "run.step"; data: RunStep }
  | { event: "team.updated"; data: TeamConfig | null }
  | { event: "spend.updated"; data: SpendSummary }
  | { event: "tasks.updated"; data: Task[] }
  | { event: "skills.updated"; data: null }
  | { event: "notify"; data: { title: string; body: string; questionId?: string; runId?: string } }
  | { event: "supervisor.status"; data: SupervisorStatus }
  | { event: "supervisor.reconnected"; data: null }
) & {
  /** Which team the event belongs to; absent for global events (teams.updated) */
  teamId?: string;
};

export const TASK_COLUMNS = ["todo", "doing", "done"] as const;
export type TaskColumn = (typeof TASK_COLUMNS)[number];

/** One card on the team's shared task board: the work list both the owner and the agents file into. */
export interface Task {
  id: string;
  column: TaskColumn;
  title: string;
  detail: string | null;
  /** Agent id the card is assigned to, or null when nobody has picked it up. */
  assignee: string | null;
  /** "owner", or the id of the agent that filed it. */
  createdBy: string;
  /** Order within the column; lower shows higher. */
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** Fields a client may change on a task; ids, authorship and timestamps are the supervisor's. */
export const TaskPatchSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  detail: z.string().max(4000).nullable().optional(),
  column: z.enum(TASK_COLUMNS).optional(),
  assignee: z.string().max(120).nullable().optional(),
});
export type TaskPatch = z.infer<typeof TaskPatchSchema>;

export interface SupervisorStatus {
  teamId: string | null;
  startedAt: string;
  pausedAll: boolean;
  /**
   * A pause is on its way: nothing new starts, and `pausedAll` flips as soon as the runs still
   * going have finished. `runningRuns` is how many the owner is waiting on.
   */
  pausePending: boolean;
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

// ---------- Skills ----------

/**
 * Skills follow the Agent Skills standard (agentskills.io): a folder named after the skill,
 * holding a SKILL.md with `name` and `description` frontmatter, plus optional scripts/,
 * references/ and assets/. That means a skill written here works in Claude Code, and a skill
 * written for Claude Code works here.
 *
 * Three scopes, most specific wins when names collide:
 *   user  <dataDir>/skills/<name>/               every agent on every team
 *   team  <dataDir>/teams/<id>/skills/<name>/    every agent on that team
 *   agent <dataDir>/teams/<id>/agents/<id>/skills/<name>/
 */
export type SkillScope = "user" | "team" | "agent";

export const SKILL_SCOPES: SkillScope[] = ["user", "team", "agent"];

/** Where a skill came from, so the app can re-pull it later and show provenance. */
export type SkillSourceKind = "manual" | "learned" | "folder" | "zip" | "git" | "claude-code" | "bundled";

export interface SkillSource {
  kind: SkillSourceKind;
  /** Git URL, folder path or zip path. null for skills written in the app or by an agent. */
  ref: string | null;
  /** Subfolder inside the source that holds this skill, when it wasn't at the root. */
  subpath: string | null;
  /** Commit actually installed, for git sources. */
  version: string | null;
  installedAt: string;
  updatedAt: string;
}

export interface Skill {
  scope: SkillScope;
  /** Team id for team scope, agent id for agent scope, null for user scope. */
  ownerId: string | null;
  name: string;
  description: string;
  /** The whole SKILL.md, frontmatter included — what the editor shows. */
  content: string;
  /** Just the instructions, without the frontmatter — what a model reads. */
  body: string;
  /** Absolute path of the skill folder. */
  dir: string;
  /** Bundled files (scripts/, references/, assets/, …) relative to `dir`. */
  files: string[];
  license: string | null;
  compatibility: string | null;
  allowedTools: string | null;
  metadata: Record<string, string>;
  source: SkillSource;
  updatedAt: string;
  /** Why this skill is not usable. A skill with errors is never handed to an agent. */
  errors: string[];
}

/** A skill as it reaches one agent, after shadowing and the agent's own on/off switch. */
export interface EffectiveSkill extends Skill {
  enabled: boolean;
  /** Scopes that define the same name but lose to this one. */
  shadowed: SkillScope[];
}

/** Which shelf a skill sits on. */
export interface SkillTarget {
  scope: SkillScope;
  /** Required for team and agent scope; ignored for user scope. */
  ownerId?: string | null;
}

export type SkillInstallKind = "folder" | "zip" | "git" | "claude-code";

/** One installable skill found in a source, shown for review before anything is copied. */
export interface SkillCandidate {
  name: string;
  description: string;
  /** Path inside the source. "" when the source folder is itself the skill. */
  subpath: string;
  files: number;
  errors: string[];
  /** A skill of the same name already on the target shelf. */
  conflictsWith: SkillScope | null;
}

export interface SkillSourceScan {
  kind: SkillInstallKind;
  ref: string;
  /** Commit the scan resolved to, for git sources. */
  version: string | null;
  candidates: SkillCandidate[];
}

/** A place on this Mac that already holds Agent Skills — Claude Code's own folders. */
export interface SkillOrigin {
  label: string;
  path: string;
  count: number;
}
