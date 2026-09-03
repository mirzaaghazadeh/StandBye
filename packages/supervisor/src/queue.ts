import type { Run, RunTrigger } from "@crew/shared";
import { DEFAULTS } from "./config.js";
import type { Crew } from "./crew.js";
import { executeRun } from "./runner.js";
import { KeepAwake } from "./power.js";

/**
 * One run at a time per agent, a few in parallel across the team.
 * Wake-ups from the owner go to the front. Duplicate wake-ups collapse: a run already sees
 * every new message and open question, so a second queued mention adds nothing.
 * Every run has a hard timeout.
 * A run blocked on an owner answer parks itself (suspendSlot) to free its slot for other
 * runs; when the answer arrives it re-enters FIFO, ahead of fresh pending runs.
 */
export class Queue {
  private readonly pending: Run[] = [];
  private readonly active = new Map<string, AbortController>(); // runId -> abort
  private readonly busyAgents = new Set<string>();
  // Runs parked while their agent waits on an owner answer (needs_you): their concurrency
  // slot is freed but the run itself keeps executing. Map insertion order is the FIFO
  // re-entry order; `resolve` is set once the run wants its slot back.
  private readonly suspended = new Map<string, { ac: AbortController; resolve?: () => void }>();
  /** The machine must not sleep out from under a run that is half-way through a change. */
  private readonly awake = new KeepAwake();

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
    const parked = this.suspended.get(runId);
    if (parked) {
      this.suspended.delete(runId);
      parked.resolve?.();
      parked.ac.abort("cancelled");
      return true;
    }
    const ac = this.active.get(runId);
    if (ac) { ac.abort("cancelled"); return true; }
    return false;
  }
  cancelAll(): void {
    for (const run of this.pending.splice(0)) this.crew.finishRun(run, "cancelled", "Paused");
    for (const s of this.suspended.values()) {
      s.resolve?.();
      s.ac.abort("cancelled");
    }
    this.suspended.clear();
    for (const ac of this.active.values()) ac.abort("cancelled");
    this.awake.dispose();
  }

  /**
   * Park a run that is waiting on an owner answer: its concurrency slot goes back to the
   * pool so other runs can use it. The agent stays busy (the run is still executing) and
   * the abort controller moves with the run, so timeouts and cancel() still reach it.
   */
  suspendSlot(runId: string): void {
    const ac = this.active.get(runId);
    if (!ac) return;
    this.active.delete(runId);
    this.suspended.set(runId, { ac }); // Map order = FIFO re-entry
    void this.pump();
  }

  /**
   * A parked run got its answer and wants its slot back. Resolves once `pump` has
   * re-granted the slot — parked runs re-enter FIFO (oldest parked first) and ahead of
   * fresh pending runs — or immediately if the run was settled/cancelled while parked.
   */
  resumeSlot(runId: string): Promise<void> {
    const parked = this.suspended.get(runId);
    if (!parked) return Promise.resolve();
    return new Promise<void>((resolve) => {
      parked.resolve = resolve;
      void this.pump();
    });
  }

  /** A parked run is gone without resuming (cancelled, timed out, finished): drop it. */
  settleSlot(runId: string): void {
    const parked = this.suspended.get(runId);
    if (!parked) return;
    this.suspended.delete(runId);
    parked.resolve?.();
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
      // A parked run whose owner answer arrived gets its slot back before any fresh
      // pending run: it is mid-work, and FIFO by suspension order.
      const resumed = [...this.suspended.entries()].find(([, s]) => s.resolve);
      if (resumed) {
        const [runId, parked] = resumed;
        this.suspended.delete(runId);
        this.active.set(runId, parked.ac);
        parked.resolve?.();
        continue;
      }
      const idx = this.pending.findIndex((r) => !this.busyAgents.has(r.agentId));
      if (idx < 0) return;
      const [run] = this.pending.splice(idx, 1);
      if (!run) return;
      this.busyAgents.add(run.agentId);
      const ac = new AbortController();
      this.active.set(run.id, ac);
      this.awake.set(this.active.size + this.suspended.size);
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
          this.awake.set(this.active.size + this.suspended.size);
          this.busyAgents.delete(run.agentId);
          // The run may have ended while parked on an owner answer (timeout, cancel):
          // drop any leftover suspended entry so nothing waits on a dead promise.
          this.settleSlot(run.id);
          void this.pump();
        });
    }
  }
}

function fromOwner(t: RunTrigger): boolean {
  return t.kind === "manual" || (t.kind === "mention" && t.by === "user") || (t.kind === "task" && t.from === "user");
}
