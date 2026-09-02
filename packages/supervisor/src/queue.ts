import type { Run, RunTrigger } from "@crew/shared";
import { DEFAULTS } from "./config.js";
import type { Crew } from "./crew.js";
import { executeRun } from "./runner.js";

/**
 * One run at a time per agent, a few in parallel across the team.
 * Wake-ups from the owner go to the front. Duplicate wake-ups collapse: a run already sees
 * every new message and open question, so a second queued mention adds nothing.
 * Every run has a hard timeout.
 */
export class Queue {
  private readonly pending: Run[] = [];
  private readonly active = new Map<string, AbortController>(); // runId -> abort
  private readonly busyAgents = new Set<string>();

  constructor(private readonly crew: Crew, private readonly onEscalate: (agentId: string, reason: string) => void) {}

  enqueue(agentId: string, trigger: RunTrigger): Run | null {
    const agent = this.crew.getAgent(agentId);
    if (agent.paused || this.crew.pausedAll) return null;
    if (this.isDuplicate(agentId, trigger)) return null;
    const run = this.crew.createRun(agentId, trigger, agent.model);
    if (fromOwner(trigger)) this.pending.unshift(run);
    else this.pending.push(run);
    void this.pump();
    return run;
  }

  hasQueued(agentId: string): boolean {
    return this.pending.some((r) => r.agentId === agentId);
  }
  isBusy(agentId: string): boolean {
    return this.busyAgents.has(agentId) || this.hasQueued(agentId);
  }
  cancel(runId: string): boolean {
    const i = this.pending.findIndex((r) => r.id === runId);
    if (i >= 0) {
      const [run] = this.pending.splice(i, 1);
      this.crew.finishRun(run!, "cancelled", "Cancelled before it started");
      return true;
    }
    const ac = this.active.get(runId);
    if (ac) { ac.abort("cancelled"); return true; }
    return false;
  }
  cancelAll(): void {
    for (const run of this.pending.splice(0)) this.crew.finishRun(run, "cancelled", "Paused");
    for (const ac of this.active.values()) ac.abort("cancelled");
  }

  private isDuplicate(agentId: string, trigger: RunTrigger): boolean {
    const queued = this.pending.filter((r) => r.agentId === agentId);
    const busy = this.busyAgents.has(agentId);
    switch (trigger.kind) {
      case "heartbeat":
        return busy || queued.length > 0; // anything else already wakes the agent
      case "mention":
        // The owner's message must not be swallowed by a queued agent-to-agent mention: promote instead of skip.
        if (fromOwner(trigger)) {
          const i = this.pending.findIndex((r) => r.agentId === agentId && r.trigger.kind === "mention" && !fromOwner(r.trigger));
          if (i >= 0) { const [r] = this.pending.splice(i, 1); this.crew.finishRun(r!, "cancelled", "Folded into a newer wake-up"); }
          return queued.some((r) => r.trigger.kind === "mention" && fromOwner(r.trigger));
        }
        return queued.some((r) => r.trigger.kind === "mention" || r.trigger.kind === "heartbeat");
      case "question":
      case "answer":
        return queued.some((r) => r.trigger.kind === trigger.kind);
      default:
        return false;
    }
  }

  private async pump(): Promise<void> {
    while (this.active.size < DEFAULTS.maxConcurrentRuns) {
      const idx = this.pending.findIndex((r) => !this.busyAgents.has(r.agentId));
      if (idx < 0) return;
      const [run] = this.pending.splice(idx, 1);
      if (!run) return;
      this.busyAgents.add(run.agentId);
      const ac = new AbortController();
      this.active.set(run.id, ac);
      const minutes = run.trigger.kind === "heartbeat" ? DEFAULTS.checkinTimeoutMinutes : DEFAULTS.runTimeoutMinutes;
      const timer = setTimeout(() => ac.abort(`timeout:${minutes}`), minutes * 60_000);
      void executeRun(this.crew, run.id, ac.signal)
        .then((res) => {
          if (res.escalate) this.onEscalate(run.agentId, res.escalate);
        })
        .catch((e) => {
          const r = this.crew.db.getRun(run.id);
          if (r) this.crew.finishRun(r, "failed", String(e instanceof Error ? e.message : e), { error: String(e) });
          this.crew.setAgentRuntime(run.agentId, { status: "failed", statusText: String(e).slice(0, 120), currentRunId: null });
        })
        .finally(() => {
          clearTimeout(timer);
          this.active.delete(run.id);
          this.busyAgents.delete(run.agentId);
          void this.pump();
        });
    }
  }
}

function fromOwner(t: RunTrigger): boolean {
  return t.kind === "manual" || (t.kind === "mention" && t.by === "user") || (t.kind === "task" && t.from === "user");
}
