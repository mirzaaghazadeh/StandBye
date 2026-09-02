import type { Run, RunTrigger } from "@crew/shared";
import { DEFAULTS } from "./config.js";
import type { Crew } from "./crew.js";
import { executeRun } from "./runner.js";

/**
 * One run at a time per agent, a few in parallel across the team.
 * Duplicate wake-ups (two heartbeats, the same mention twice) are collapsed.
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
    this.pending.push(run);
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
    if (ac) { ac.abort(); return true; }
    return false;
  }
  cancelAll(): void {
    for (const run of this.pending.splice(0)) this.crew.finishRun(run, "cancelled", "Paused");
    for (const ac of this.active.values()) ac.abort();
  }

  private isDuplicate(agentId: string, trigger: RunTrigger): boolean {
    const same = (t: RunTrigger) => {
      if (t.kind !== trigger.kind) return false;
      if (t.kind === "heartbeat") return true;
      if (t.kind === "mention" && trigger.kind === "mention") return t.messageId === trigger.messageId;
      if (t.kind === "answer" && trigger.kind === "answer") return t.questionId === trigger.questionId;
      if (t.kind === "question" && trigger.kind === "question") return t.questionId === trigger.questionId;
      return false;
    };
    if (this.pending.some((r) => r.agentId === agentId && same(r.trigger))) return true;
    // A heartbeat is pointless while the agent is already doing something.
    if (trigger.kind === "heartbeat" && this.busyAgents.has(agentId)) return true;
    return false;
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
          this.active.delete(run.id);
          this.busyAgents.delete(run.agentId);
          void this.pump();
        });
    }
  }
}
