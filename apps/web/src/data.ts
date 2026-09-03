import { defaultModelsFor, type Agent, type AgentDraft, type AgentStatus, type ProviderSettings, type Question, type Run, type TeamDraft } from "@crew/shared";
import { soloDevTeam } from "@templates";

export const GITHUB = "https://github.com/mirzaaghazadeh/StandBye";
export const DOWNLOAD = `${GITHUB}/releases/latest`;

// The same starter team the app ships with, on the default models.
const providers: ProviderSettings = {
  anthropic: { enabled: true, defaultModel: defaultModelsFor("anthropic").main, checkinModel: defaultModelsFor("anthropic").checkin },
  openrouter: { enabled: true, defaultModel: defaultModelsFor("openrouter").main, checkinModel: defaultModelsFor("openrouter").checkin },
};
export const team: TeamDraft = soloDevTeam(providers, "", "your repo");

const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();
const inMinutes = (m: number) => new Date(now + m * 60_000).toISOString();

type Live = { status: AgentStatus; statusText: string; spent: number; since: number; next: number; running?: boolean; memoryCount: number };
const live: Record<string, Live> = {
  Ada: { status: "working", statusText: "Writing the standup plan", spent: 1.42, since: 4, next: 30, running: true, memoryCount: 12 },
  Kai: { status: "working", statusText: "PR #218: queue retry budget", spent: 2.05, since: 11, next: 30, running: true, memoryCount: 9 },
  Rex: { status: "needs_you", statusText: "Asked: merge #214?", spent: 0.6, since: 23, next: 30, memoryCount: 5 },
  Sol: { status: "idle", statusText: "Docs current", spent: 0.08, since: 52, next: 68, memoryCount: 3 },
};

function agentFrom(d: AgentDraft, i: number): Agent {
  const l = live[d.name] ?? { status: "idle", statusText: "", spent: 0, since: 60, next: 60, memoryCount: 0 };
  return {
    id: d.name.toLowerCase(),
    name: d.name,
    role: d.role,
    provider: d.provider,
    model: d.model,
    checkinModel: defaultModelsFor(d.provider).checkin,
    heartbeat: { everyMinutes: d.heartbeatMinutes, workHours: { start: "08:00", end: "20:00" } },
    triggers: { onMention: true, cron: d.schedules ?? [] },
    permissions: [],
    budget: { dailyUsd: d.dailyBudgetUsd, perRunUsd: 2, hourlyUsd: null, capBy: d.capBy ?? "day" },
    channels: d.channels,
    workspace: null,
    color: d.color,
    paused: false,
    createdAt: minutesAgo(60 * 24 * 12 + i),
    status: l.status,
    statusText: l.statusText,
    currentRunId: l.running ? `run-${d.name.toLowerCase()}` : null,
    spentTodayUsd: l.spent,
    lastRunAt: minutesAgo(l.since),
    nextWakeAt: inMinutes(l.next),
    memoryCount: l.memoryCount,
  };
}

export const agents: Agent[] = team.agents.map(agentFrom);
export const spentToday = agents.reduce((s, a) => s + a.spentTodayUsd, 0);

export const runs: Run[] = [
  { id: "r1", agentId: "ada", trigger: { kind: "schedule", name: "Standup", prompt: "" }, status: "running", summary: "Standup: read #backend, drafting today's plan", model: defaultModelsFor("anthropic").main, startedAt: minutesAgo(4), finishedAt: null, costUsd: 0.31, inputTokens: 41_200, outputTokens: 1_900, stepCount: 6, error: null, createdAt: minutesAgo(4) },
  { id: "r2", agentId: "kai", trigger: { kind: "mention", messageId: "m1", by: "ada", depth: 1 }, status: "running", summary: "Fix retry budget check, add test, open PR", model: defaultModelsFor("anthropic").main, startedAt: minutesAgo(11), finishedAt: null, costUsd: 0.88, inputTokens: 122_000, outputTokens: 6_400, stepCount: 19, error: null, createdAt: minutesAgo(11) },
  { id: "r3", agentId: "rex", trigger: { kind: "task", title: "Review #214", details: "", from: "watcher", event: "pr" }, status: "needs_you", summary: "Reviewed #214: one flaky test, asked to merge", model: defaultModelsFor("openrouter").main, startedAt: minutesAgo(26), finishedAt: minutesAgo(23), costUsd: 0.12, inputTokens: 38_000, outputTokens: 2_100, stepCount: 9, error: null, createdAt: minutesAgo(26) },
  { id: "r4", agentId: "sol", trigger: { kind: "heartbeat" }, status: "noop", summary: "Nothing new since 13:40", model: defaultModelsFor("anthropic").checkin, startedAt: minutesAgo(52), finishedAt: minutesAgo(52), costUsd: 0.01, inputTokens: 6_800, outputTokens: 90, stepCount: 1, error: null, createdAt: minutesAgo(52) },
  { id: "r5", agentId: "kai", trigger: { kind: "escalated", reason: "Open PR waiting" }, status: "done", summary: "Merged the queue fairness PR, CI green", model: defaultModelsFor("anthropic").main, startedAt: minutesAgo(95), finishedAt: minutesAgo(81), costUsd: 0.74, inputTokens: 98_000, outputTokens: 4_300, stepCount: 14, error: null, createdAt: minutesAgo(95) },
];

export function triggerLabel(t: Run["trigger"]): string {
  switch (t.kind) {
    case "schedule": return t.name.toLowerCase();
    case "task": return t.event ?? "task";
    default: return t.kind;
  }
}

export const questions: Question[] = [
  { id: "q1", kind: "approval", fromAgentId: "rex", toId: "user", channelId: null, title: "Merge #214 after the flaky test fix?", body: "All 212 tests pass locally. The flaky one (queue.fairness) passed 10/10 after Kai's fix. Merging touches main, which your rules mark as ask.", options: ["Merge it", "Wait for one more green CI run", "Don't merge"], recommended: "Merge it", defaultAnswer: "Wait for one more green CI run", defaultAt: inMinutes(38), status: "open", answer: null, answeredBy: null, payload: null, runId: "r3", createdAt: minutesAgo(23), answeredAt: null },
  { id: "q2", kind: "hire", fromAgentId: "ada", toId: "user", channelId: null, title: "Add a frontend engineer?", body: "Three of the last five tasks touched the renderer and Kai spent 40% of his budget there. A frontend engineer on Sonnet 5 at $3/day would take that over.", options: ["Hire", "Not now"], recommended: "Hire", defaultAnswer: "Not now", defaultAt: inMinutes(600), status: "open", answer: null, answeredBy: null, payload: null, runId: "r1", createdAt: minutesAgo(9), answeredAt: null },
  { id: "q3", kind: "report", fromAgentId: "ada", toId: "user", channelId: null, title: "End of day", body: "Shipped: queue fairness, typing indicator. Blocked: nothing. Needs you: one merge approval.", options: [], recommended: null, defaultAnswer: null, defaultAt: null, status: "open", answer: null, answeredBy: null, payload: null, runId: null, createdAt: minutesAgo(60 * 20), answeredAt: null },
];

export const rules = [
  { pattern: "Edit, Write inside the repo", behavior: "allow" as const, label: "Workspace fence" },
  { pattern: "Bash(git push*)", behavior: "ask" as const, label: "Push to main" },
  { pattern: "Bash(pnpm test*)", behavior: "allow" as const, label: "Run the suite" },
  { pattern: "Bash(rm -rf*)", behavior: "block" as const, label: "Never" },
  { pattern: "Bash(curl*)", behavior: "ask" as const, label: "External services" },
];

