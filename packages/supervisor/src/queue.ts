import type { Run, RunTrigger } from "@crew/shared";
import { DEFAULTS } from "./config.js";
import type { Crew } from "./crew.js";
import { executeRun } from "./runner.js";
import { KeepAwake, keepAwakeAllowed } from "./power.js";

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
  private readonly awake: KeepAwake;

  constructor(private readonly crew: Crew, private readonly onEscalate: (agentId: string, reason: string) => void) {
    this.awake = new KeepAwake(() => keepAwakeAllowed(crew.opts.globalDir));
  }

  enqueue(agentId: string, trigger: RunTrigger): Run | null {
    if (this.stopped) return null;
    const agent = this.crew.getAgent(agentId);
    if (agent.paused || this.crew.pausedAll) return null;
    if (this.isDuplicate(agentId, trigger)) return null;
    const run = this.crew.createRun(agentId, trigger, agent.model);
    if (fromOwner(trigger)) this.pending.unshift(run);
    else this.pending.push(run);
    void this.pump();
    return run;
  }

  /**
   * Whether a run may go ahead even though its agent is already busy.
   *
   * An agent works one thing at a time on purpose: two runs editing the same tree is how you get
   * half a change. But being spoken to is not work. The owner writing in a direct chat had to
   * queue behind a task that might run for ten minutes, so the app looked ignored — "waiting for
   * a free slot" under a message that only needed an answer.
   *
   * A direct-chat reply is allowed alongside, because that run is a conversation: it answers from
   * what the agent already knows and is told not to touch the workspace unless actually asked.
   * One at a time, so a burst of messages cannot fan out into a crowd of runs.
   */
  private canReplyWhileBusy(run: Run): boolean {
    if (!isDirectReply(this.crew, run.trigger)) return false;
    for (const id of this.active.keys()) {
      const other = this.crew.db.getRun(id);
      if (other?.agentId === run.agentId && isDirectReply(this.crew, other.trigger)) return false;
    }
    return true;
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
  /** Set by cancelAll() at shutdown: nothing new starts after the team is being torn down. */
  private stopped = false;

  cancelAll(): void {
    this.stopped = true;
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
    this.startRuns();
    this.startDirectReplies();
  }

  /**
   * Answering the owner is not queued behind the team's work, at all.
   *
   * The concurrency cap exists so three agents do not thrash one machine, but it counted a reply
   * in a direct chat against the same three slots — so a restart that resumed three long runs left
   * a "hello" waiting indefinitely with nothing to show for it but "waiting for a free slot".
   * A direct reply is short, conversational and told not to touch the workspace, so it runs above
   * the cap. Bounded so a burst of messages cannot become a crowd of runs.
   */
  private startDirectReplies(): void {
    while (this.directRepliesRunning() < DEFAULTS.maxConcurrentReplies) {
      const idx = this.pending.findIndex((r) => isDirectReply(this.crew, r.trigger) && this.canReplyWhileBusy(r));
      if (idx < 0) return;
      const [run] = this.pending.splice(idx, 1);
      if (!run) return;
      this.launch(run, this.busyAgents.has(run.agentId));
    }
  }

  private directRepliesRunning(): number {
    let n = 0;
    for (const id of this.active.keys()) {
      const r = this.crew.db.getRun(id);
      if (r && isDirectReply(this.crew, r.trigger)) n += 1;
    }
    return n;
  }

  private startRuns(): void {
    while (this.active.size - this.directRepliesRunning() < DEFAULTS.maxConcurrentRuns) {
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
      const idx = this.pending.findIndex((r) => !this.busyAgents.has(r.agentId) || this.canReplyWhileBusy(r));
      if (idx < 0) return;
      const [run] = this.pending.splice(idx, 1);
      if (!run) return;
      // A reply running alongside work does not take the agent; the work run still holds them.
      this.launch(run, this.busyAgents.has(run.agentId));
    }
  }

  /** Start one run. `parallel` means it is riding alongside work its agent is already doing. */
  private launch(run: Run, parallel: boolean): void {
    if (!parallel) this.busyAgents.add(run.agentId);
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
        // The team can be torn down while a run is still going — a closed folder, a stopping
        // supervisor. There is no database left to record the failure in, and nothing to record
        // it for.
        if (this.crew.isClosed) return;
        const r = this.crew.db.getRun(run.id);
        if (r) this.crew.finishRun(r, "failed", String(e instanceof Error ? e.message : e), { error: String(e) });
        this.crew.setAgentRuntime(run.agentId, { status: "failed", statusText: String(e).slice(0, 120), currentRunId: null });
      })
      .finally(() => {
        clearTimeout(timer);
        if (this.crew.isClosed) return;
        this.active.delete(run.id);
        this.awake.set(this.active.size + this.suspended.size);
        // A parallel reply never claimed the agent, so it must not release them either: the
        // work run it ran alongside is still going.
        if (!parallel) this.busyAgents.delete(run.agentId);
        // The run may have ended while parked on an owner answer (timeout, cancel):
        // drop any leftover suspended entry so nothing waits on a dead promise.
        this.settleSlot(run.id);
        void this.pump();
      });
  }
}

/** A message from the owner in their private chat with this agent: a conversation, not a task. */
function isDirectReply(crew: Crew, t: RunTrigger): boolean {
  if (t.kind !== "mention" || t.by !== "user") return false;
  const m = crew.db.getMessage(t.messageId);
  return Boolean(m && crew.db.getChannel(m.channelId)?.kind === "dm");
}

/** The owner's own wake-ups go to the front of the queue; the team's own work waits its turn. */
function fromOwner(t: RunTrigger): boolean {
  return t.kind === "manual" || (t.kind === "mention" && t.by === "user") || (t.kind === "task" && t.from === "user");
}
