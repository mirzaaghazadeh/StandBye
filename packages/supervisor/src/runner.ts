import type { Agent, Run } from "@crew/shared";
import type { Crew } from "./crew.js";
import { gitRules } from "./git.js";
import { runPrompt, systemPrompt } from "./prompt.js";
import { anthropicRunner } from "./runners/anthropic.js";
import { openrouterRunner } from "./runners/openrouter.js";
import type { Runner } from "./runners/types.js";
import type { ToolContext } from "./tools/team-tools.js";

const RUNNERS: Record<string, Runner> = { anthropic: anthropicRunner, openrouter: openrouterRunner };

export interface ExecuteResult {
  run: Run;
  escalate?: string;
}

/** Execute one queued run end to end: budget check, prompts, provider loop, bookkeeping. */
export async function executeRun(crew: Crew, runId: string, signal: AbortSignal): Promise<ExecuteResult> {
  let run = crew.db.getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  const agent = crew.getAgent(run.agentId);

  const t = run.trigger;
  const fromOwner = t.kind === "manual" || (t.kind === "mention" && t.by === "user") || (t.kind === "task" && t.from === "user") || t.kind === "answer";
  const budget = crew.budgetAllows(agent.id, fromOwner);
  if (!budget.ok) {
    return { run: crew.finishRun(run, "cancelled", budget.reason ?? "Budget reached") };
  }
  const runner = RUNNERS[agent.provider];
  if (!runner) return { run: crew.finishRun(run, "failed", `No runner for provider ${agent.provider}`) };

  const mode: "full" | "checkin" = run.trigger.kind === "heartbeat" ? "checkin" : "full";
  const model = mode === "checkin" ? agent.checkinModel || agent.model : agent.model;
  const startedAt = new Date().toISOString();
  run = crew.updateRun(run, { status: "running", startedAt, model });
  crew.setAgentRuntime(agent.id, { status: "working", statusText: describeTrigger(run), currentRunId: run.id });

  let summary = "";
  let doneStatus: "done" | "noop" | "needs_you" | null = null;
  let escalate: string | undefined;
  const depth = run.trigger.kind === "mention" ? run.trigger.depth : 0;
  const ctx: ToolContext = {
    crew, agentId: agent.id, run, depth,
    onDone: (s, st) => { summary = s; doneStatus = st; },
    onEscalate: (r) => { escalate = r; },
  };

  const cwd = agent.workspace ?? crew.team?.workspaceRoot ?? crew.opts.dataDir;
  // Team-level git rules come first so they win over the agent's own rules.
  const effective: Agent = { ...agent, permissions: [...gitRules(crew.team?.git), ...agent.permissions] };
  const out = await runner({
    crew, agent: effective, run, mode, model, cwd, signal,
    system: systemPrompt(crew, agent, mode),
    prompt: runPrompt(crew, agent, run),
    ctx,
  });

  crew.db.setAgentState(agent.id, { lastSeenMessageAt: startedAt, ...(run.trigger.kind === "heartbeat" ? { lastHeartbeatAt: startedAt } : {}) });

  const stepCount = crew.db.listSteps(run.id).length;
  const base: Partial<Run> = { costUsd: out.costUsd, inputTokens: out.inputTokens, outputTokens: out.outputTokens, stepCount };
  let finished: Run;
  if (signal.aborted) {
    const reason = String(signal.reason ?? "");
    const why = reason.startsWith("timeout:") ? `Stopped after ${reason.slice(8)} minutes (run timeout)` : "Cancelled";
    finished = crew.finishRun(run, reason.startsWith("timeout:") ? "failed" : "cancelled", summary || why, { ...base, error: reason.startsWith("timeout:") ? why : null });
  } else if (out.error) {
    finished = crew.finishRun(run, "failed", summary || out.text.slice(0, 200) || out.error, { ...base, error: out.error });
  } else if (escalate) {
    finished = crew.finishRun(run, "done", `Escalated: ${escalate}`, base);
  } else if (doneStatus === "noop") {
    finished = crew.finishRun(run, "noop", summary || "Nothing new", base);
  } else if (doneStatus === "needs_you") {
    finished = crew.finishRun(run, "needs_you", summary, base);
  } else {
    finished = crew.finishRun(run, "done", summary || out.text.slice(0, 200) || "Finished", base);
  }

  const stillWaiting = crew.db.listQuestions({ status: "open" }).some((q) => q.fromAgentId === agent.id && q.toId === "user" && q.kind !== "report");
  const failed = finished.status === "failed";
  crew.setAgentRuntime(agent.id, {
    status: failed ? "failed" : stillWaiting ? "needs_you" : "idle",
    statusText: failed ? (finished.error ?? "").slice(0, 120) : stillWaiting ? "Waiting for you" : "",
    currentRunId: null,
  });
  return { run: finished, escalate };
}

export function describeTrigger(run: Run): string {
  const t = run.trigger;
  switch (t.kind) {
    case "heartbeat": return "Checking in";
    case "schedule": return t.name;
    case "mention": return "Replying to a mention";
    case "task": return t.title;
    case "answer": return "Continuing after your answer";
    case "question": return "Answering a teammate";
    case "escalated": return t.reason;
    case "manual": return t.prompt.slice(0, 80);
  }
}
