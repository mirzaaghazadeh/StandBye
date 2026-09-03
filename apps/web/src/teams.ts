// Demo teams for the hero: the same app window, different teams. The dev team is the real starter template;
// the others show what a team looks like when it is not about code.
import { defaultModelsFor, type Agent, type AgentStatus, type Provider } from "@crew/shared";
import { agents as devAgents, questions, spentToday, team as devDraft } from "./data";

export type DemoAgent = Agent & { responsibilities: string[] };
export type DemoTeam = {
  id: string;
  name: string;
  tagline: string;
  dailyCapUsd: number;
  hours: string;
  channels: { name: string; members: string[] }[];
  agents: DemoAgent[];
  /** index of the agent shown in the inspector */
  selected: number;
  openQuestions: number;
};

const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();
const inMinutes = (m: number) => new Date(now + m * 60_000).toISOString();

type Spec = {
  name: string; role: string; color: string; provider?: Provider; model?: string; status: AgentStatus; doing: string;
  spent: number; since?: number; every?: number; budget?: number; channels: string[]; does: string[]; memory?: number;
};

function mk(s: Spec): DemoAgent {
  const provider = s.provider ?? "anthropic";
  return {
    id: s.name.toLowerCase(),
    name: s.name,
    role: s.role,
    provider,
    model: s.model ?? defaultModelsFor(provider).main,
    checkinModel: defaultModelsFor(provider).checkin,
    heartbeat: { everyMinutes: s.every ?? 30, workHours: { start: "08:00", end: "20:00" } },
    triggers: { onMention: true, cron: [] },
    permissions: [],
    budget: { dailyUsd: s.budget ?? 3, perRunUsd: 2, hourlyUsd: null, capBy: "day" },
    channels: s.channels,
    workspace: null,
    color: s.color,
    paused: false,
    createdAt: minutesAgo(60 * 24 * 20),
    status: s.status,
    statusText: s.doing,
    currentRunId: s.status === "working" ? `run-${s.name.toLowerCase()}` : null,
    spentTodayUsd: s.spent,
    lastRunAt: minutesAgo(s.since ?? 15),
    nextWakeAt: inMinutes((s.every ?? 30) - ((s.since ?? 15) % (s.every ?? 30))),
    memoryCount: s.memory ?? 6,
    responsibilities: s.does,
  };
}

const chan = (name: string, members: string[]) => ({ name, members });

export const devTeam: DemoTeam = {
  id: "dev",
  name: devDraft.name,
  tagline: "Keeps the repo shipping",
  dailyCapUsd: devDraft.dailyCapUsd,
  hours: "08:00–20:00",
  channels: devDraft.channels.map((c) => chan(c.name, c.members)),
  agents: devAgents.map((a) => ({ ...a, responsibilities: devDraft.agents.find((d) => d.name === a.name)?.responsibilities ?? [] })),
  selected: 1,
  openQuestions: questions.filter((q) => q.status === "open" && q.kind !== "report").length,
};
void spentToday;

export const marketingTeam: DemoTeam = {
  id: "marketing",
  name: "Marketing team",
  tagline: "Content, campaigns and the numbers behind them",
  dailyCapUsd: 8,
  hours: "07:00–19:00",
  channels: [chan("content", ["Mara", "Ivy", "Nell"]), chan("campaigns", ["Mara", "Ivy", "Theo"]), chan("analytics", ["Nell", "Theo"])],
  agents: [
    mk({ name: "Mara", role: "Content lead", color: "#E9D9CF", status: "working", doing: "Drafting Thursday's newsletter", spent: 1.1, since: 6, channels: ["general", "content", "campaigns"], does: ["Weekly newsletter draft by Wednesday", "Editorial calendar in #content", "Brief Ivy and Theo every morning"], memory: 18 }),
    mk({ name: "Theo", role: "SEO", color: "#D7E3DA", provider: "openrouter", status: "working", doing: "Auditing 40 pages for AI search", spent: 0.7, since: 14, channels: ["general", "campaigns", "analytics"], does: ["Monthly audit of every landing page", "Fix titles and schema in PRs", "Track rankings in #analytics"] }),
    mk({ name: "Ivy", role: "Social", color: "#DDDCE8", model: "claude-sonnet-5", status: "needs_you", doing: "Asked: approve the launch thread?", spent: 0.4, since: 21, channels: ["general", "content", "campaigns"], does: ["Three posts a day, scheduled", "Reply to mentions within the hour", "Launch threads need approval"] }),
    mk({ name: "Nell", role: "Analytics", color: "#EFEDE8", model: "claude-haiku-4-5", status: "idle", doing: "Weekly report sent 09:00", spent: 0.06, since: 55, every: 120, budget: 0.5, channels: ["general", "analytics"], does: ["Weekly numbers every Monday", "Flag a drop over 20% the same day"] }),
  ],
  selected: 2,
  openQuestions: 1,
};

export const salesTeam: DemoTeam = {
  id: "sales",
  name: "Sales team",
  tagline: "Pipeline that moves while you sleep",
  dailyCapUsd: 12,
  hours: "06:00–22:00",
  channels: [chan("pipeline", ["Jonah", "Pia", "Omar"]), chan("proposals", ["Omar", "Jonah"]), chan("research", ["Pia"])],
  agents: [
    mk({ name: "Jonah", role: "SDR lead", color: "#E9D9CF", status: "working", doing: "12 follow-ups from yesterday's demos", spent: 2.3, since: 3, every: 15, budget: 5, channels: ["general", "pipeline", "proposals"], does: ["Follow up every demo within 12 hours", "Morning pipeline review in #pipeline", "Hand hot leads to Omar"], memory: 24 }),
    mk({ name: "Pia", role: "Prospect research", color: "#D7E3DA", provider: "openrouter", status: "working", doing: "Building the Q4 list: 140 of 300", spent: 0.9, since: 9, channels: ["general", "pipeline", "research"], does: ["300 qualified accounts per quarter", "One-page brief per target", "Keep the CRM fields clean"] }),
    mk({ name: "Omar", role: "Proposals", color: "#DDDCE8", model: "claude-sonnet-5", status: "needs_you", doing: "Asked: discount for Acme beyond 15%?", spent: 1.2, since: 18, budget: 4, channels: ["general", "pipeline", "proposals"], does: ["Proposal within a day of the call", "Discounts over 15% need approval", "Contract redlines to the owner"] }),
  ],
  selected: 0,
  openQuestions: 2,
};

export const supportTeam: DemoTeam = {
  id: "support",
  name: "Support team",
  tagline: "Every ticket answered, the hard ones escalated",
  dailyCapUsd: 6,
  hours: "around the clock",
  channels: [chan("tickets", ["Sam", "Quinn", "Lee"]), chan("escalations", ["Quinn", "Sam"]), chan("docs", ["Lee"])],
  agents: [
    mk({ name: "Sam", role: "Triage", color: "#D7E3DA", model: "claude-sonnet-5", status: "working", doing: "Sorting 23 overnight tickets", spent: 0.8, since: 2, every: 15, channels: ["general", "tickets", "escalations"], does: ["Every ticket tagged within 15 minutes", "Answer the known ones from the docs", "Escalate anything about money or data"], memory: 31 }),
    mk({ name: "Quinn", role: "Escalations", color: "#E9D9CF", status: "needs_you", doing: "Asked: refund #4412 over policy?", spent: 0.5, since: 11, budget: 3, channels: ["general", "tickets", "escalations"], does: ["Own anything Sam escalates", "Refunds over policy need approval", "Post a daily escalation summary"] }),
    mk({ name: "Lee", role: "Docs", color: "#EFEDE8", model: "claude-haiku-4-5", provider: "anthropic", status: "idle", doing: "Billing FAQ rewritten, 3 tickets fewer", spent: 0.1, since: 48, every: 120, budget: 1, channels: ["general", "docs", "tickets"], does: ["Turn repeat tickets into docs", "Keep the FAQ true to the product"] }),
  ],
  selected: 0,
  openQuestions: 1,
};

export const researchTeam: DemoTeam = {
  id: "research",
  name: "Research team",
  tagline: "Reads everything, runs the experiments, writes it up",
  dailyCapUsd: 15,
  hours: "08:00–20:00",
  channels: [chan("papers", ["Noor", "Hana"]), chan("experiments", ["Felix", "Noor"]), chan("writing", ["Hana", "Noor"])],
  agents: [
    mk({ name: "Noor", role: "Lead researcher", color: "#DDDCE8", status: "working", doing: "Summarising 14 papers on RAG evaluation", spent: 3.4, since: 7, budget: 6, channels: ["general", "papers", "experiments", "writing"], does: ["Weekly reading list with one-paragraph takes", "Decide which ideas get an experiment", "Friday research memo to the owner"], memory: 40 }),
    mk({ name: "Felix", role: "Experiments", color: "#D7E3DA", provider: "openrouter", status: "working", doing: "Re-running the benchmark on GLM 5.3", spent: 1.6, since: 26, budget: 5, channels: ["general", "experiments"], does: ["Reproduce before extending", "Every result in a table with a seed", "Ask before any run over $2"] }),
    mk({ name: "Hana", role: "Writer", color: "#E9D9CF", model: "claude-sonnet-5", status: "idle", doing: "Draft 3 of the survey posted", spent: 0.3, since: 62, every: 60, budget: 2, channels: ["general", "papers", "writing"], does: ["Turn memos into posts", "Cite everything, quote nothing unread"] }),
  ],
  selected: 0,
  openQuestions: 0,
};

export const officeTeam: DemoTeam = {
  id: "office",
  name: "Founder's office",
  tagline: "Inbox, calendar, money and the board deck",
  dailyCapUsd: 5,
  hours: "07:00–23:00",
  channels: [chan("inbox", ["June", "Max"]), chan("finance", ["Rio", "Max"]), chan("calendar", ["June"])],
  agents: [
    mk({ name: "Max", role: "Chief of staff", color: "#E9D9CF", status: "working", doing: "Preparing Monday's board notes", spent: 1.4, since: 5, budget: 3, channels: ["general", "inbox", "finance"], does: ["Monday board notes by Sunday night", "Weekly priorities in #general", "Chase anything stuck for two days"], memory: 27 }),
    mk({ name: "June", role: "Inbox and calendar", color: "#D7E3DA", model: "claude-sonnet-5", status: "working", doing: "Drafted 9 replies, 2 need you", spent: 0.6, since: 12, every: 15, budget: 2, channels: ["general", "inbox", "calendar"], does: ["Draft replies, never send without approval", "Keep the calendar free before 10:00", "Daily inbox summary at 18:00"] }),
    mk({ name: "Rio", role: "Finance", color: "#DDDCE8", provider: "openrouter", status: "needs_you", doing: "Asked: pay the AWS invoice early for 2%?", spent: 0.2, since: 30, every: 120, budget: 1, channels: ["general", "finance"], does: ["Reconcile every invoice against the budget", "Payments need approval", "Cash forecast on the first of the month"] }),
  ],
  selected: 1,
  openQuestions: 3,
};

export const demoTeams: DemoTeam[] = [devTeam, marketingTeam, salesTeam, supportTeam, researchTeam, officeTeam];
