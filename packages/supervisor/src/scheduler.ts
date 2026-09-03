import { Cron } from "croner";
import { log } from "./log.js";
import type { Agent } from "@crew/shared";
import { DEFAULTS } from "./config.js";
import type { Crew } from "./crew.js";
import { Queue } from "./queue.js";

/**
 * Turns time and events into runs:
 *  - heartbeats: every N minutes inside work hours, only when idle
 *  - cron triggers per agent
 *  - mentions, tasks, questions and answers from the event bus
 *  - question deadlines (default answers)
 */
export class Scheduler {
  readonly queue: Queue;
  private timer: NodeJS.Timeout | null = null;
  /** Set by stop(). A late bus event must not start work against a team that is shutting down. */
  private stopped = false;
  private crons = new Map<string, Cron[]>();

  constructor(private readonly crew: Crew) {
    this.queue = new Queue(crew, (agentId, reason) => this.queue.enqueue(agentId, { kind: "escalated", reason }));
    // Runs waiting on an owner answer park themselves and free their queue slot.
    this.crew.setSlotBridge({
      suspend: (runId) => this.queue.suspendSlot(runId),
      resume: (runId) => this.queue.resumeSlot(runId),
    });
    this.subscribe();
  }

  start(): void {
    this.rebuildCrons();
    this.resumeInterrupted();
    this.tick();
    this.timer = setInterval(() => this.tick(), 30_000);
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const jobs of this.crons.values()) jobs.forEach((j) => j.stop());
    this.queue.cancelAll();
  }

  /**
   * Start again the runs a restart cut off.
   *
   * The work itself survived — the edits, the commits, the steps are all on disk — so throwing
   * the run away meant an agent ninety steps into a change began the next one with no idea any
   * of it had happened, and either redid it or contradicted it. Each interrupted run is queued
   * again carrying its own id, and the prompt tells the agent what the last attempt got through.
   * The owner's own wake-ups go to the front, so a resume never jumps a person's request.
   */
  private resumeInterrupted(): void {
    const runs = this.crew.interrupted;
    this.crew.interrupted = [];
    for (const run of runs) {
      const agent = this.crew.findAgent(run.agentId);
      if (!agent || agent.paused) continue;
      this.queue.enqueue(run.agentId, { kind: "resumed", runId: run.id, was: run.trigger });
      log(`resuming ${agent.name}'s interrupted run ${run.id}`, { team: this.crew.id ?? undefined, agent: agent.id });
    }
  }

  rebuildCrons(): void {
    for (const jobs of this.crons.values()) jobs.forEach((j) => j.stop());
    this.crons.clear();
    for (const agent of this.crew.listAgents()) {
      const jobs = agent.triggers.cron.map(
        (t) => new Cron(t.expr, { protect: true }, () => { this.queue.enqueue(agent.id, { kind: "schedule", name: t.name, prompt: t.prompt }); }),
      );
      this.crons.set(agent.id, jobs);
    }
  }

  tick(): void {
    if (this.stopped) return;
    // 1. deadlines
    for (const q of this.crew.expireQuestions()) {
      if (q.fromAgentId && q.runId) this.queue.enqueue(q.fromAgentId, { kind: "answer", questionId: q.id });
    }
    // 2. heartbeats
    if (this.crew.pausedAll) return;
    const now = new Date();
    for (const agent of this.crew.listAgents()) {
      const next = this.nextHeartbeat(agent, now);
      this.crew.setAgentRuntimeQuiet(agent.id, { nextWakeAt: next ? next.toISOString() : null });
      if (!next || next > now) continue;
      if (agent.paused || agent.currentRunId || this.queue.isBusy(agent.id)) continue;
      if (agent.status === "over_budget") continue;
      this.queue.enqueue(agent.id, { kind: "heartbeat" });
    }
    this.crew.bus.emit("supervisor.status", this.crew.status());
  }

  private nextHeartbeat(agent: Agent, now: Date): Date | null {
    if (agent.paused) return null;
    const state = this.crew.db.getAgentState(agent.id);
    const every = Math.max(5, agent.heartbeat.everyMinutes || DEFAULTS.heartbeatMinutes) * 60_000;
    const last = state.lastHeartbeatAt ? new Date(state.lastHeartbeatAt).getTime() : 0;
    let candidate = new Date(Math.max(now.getTime(), last + every));
    if (!state.lastHeartbeatAt) candidate = new Date(now.getTime() + 60_000); // first check-in a minute after boot
    const wh = agent.heartbeat.workHours;
    if (!wh) return candidate;
    const [sh, sm] = wh.start.split(":").map(Number);
    const [eh, em] = wh.end.split(":").map(Number);
    const startMin = (sh ?? 8) * 60 + (sm ?? 0);
    const endMin = (eh ?? 22) * 60 + (em ?? 0);
    const mins = candidate.getHours() * 60 + candidate.getMinutes();
    if (mins >= startMin && mins < endMin) return candidate;
    const next = new Date(candidate);
    if (mins >= endMin) next.setDate(next.getDate() + 1);
    next.setHours(sh ?? 8, sm ?? 0, 0, 0);
    return next;
  }

  /**
   * Who picks up an unaddressed message from the owner in a shared channel: the lead if they are
   * in it, otherwise whoever is. Direct chats already have an obvious answerer and never come here.
   */
  private whoAnswersFor(channelId: string): string | null {
    const channel = this.crew.db.getChannel(channelId);
    if (!channel || channel.kind === "dm") return null;
    const inRoom = this.crew.listAgents().filter((a) => !a.paused && (channel.members.includes(a.id) || a.channels.includes(channelId)));
    if (!inRoom.length) return null;
    const lead = inRoom.find((a) => /\blead\b|maintainer/i.test(a.role));
    return (lead ?? inRoom[0])!.id;
  }

  private subscribe(): void {
    const { crew, queue } = this;

    // The team can change under us: the owner edits a soul or a schedule in their editor, or drops
    // a whole agent folder in by hand. Rebuild the crons so a changed schedule takes effect now,
    // and tick so an agent that has just appeared gets its first check-in rather than waiting.
    crew.bus.on("agents.updated", () => {
      if (this.stopped) return;
      this.rebuildCrons();
      this.tick();
    });

    crew.bus.on("message.created", (m) => {
      if (m.kind === "system") return;
      const cap = crew.team?.chatDepthCap ?? DEFAULTS.chatDepthCap;
      for (const agentId of m.mentions) {
        if (agentId === m.authorId) continue;
        const agent = crew.findAgent(agentId);
        if (!agent || !agent.triggers.onMention) continue;
        if (m.authorId !== "user" && m.depth >= cap) continue;
        // Task hand-offs use the mention path too, but carry the task title
        if (/^@[\w-]+ task: /i.test(m.text) && m.authorId !== "user") {
          const [title, ...rest] = m.text.replace(/^@[\w-]+ task: /i, "").split("\n");
          queue.enqueue(agentId, { kind: "task", title: title ?? "Task", details: rest.join("\n"), from: m.authorId });
        } else {
          queue.enqueue(agentId, { kind: "mention", messageId: m.id, by: m.authorId, depth: m.authorId === "user" ? 0 : m.depth });
        }
      }

      // The owner speaking to the room and nobody answering is the app looking broken. Agents need
      // an @ so a passing remark does not wake the whole team, but that rule was applied to the
      // owner too: "hi guys" in #general reached everyone and woke no one. Someone answers now —
      // the lead where there is one, so it lands with the person who can delegate it.
      if (m.authorId === "user" && m.mentions.length === 0) {
        const answerer = this.whoAnswersFor(m.channelId);
        if (answerer) queue.enqueue(answerer, { kind: "mention", messageId: m.id, by: "user", depth: 0 });
      }
    });

    crew.bus.on("question.created", (q) => {
      if (q.toId !== "user" && q.kind === "question") {
        queue.enqueue(q.toId, { kind: "question", questionId: q.id, from: q.fromAgentId });
      }
    });

    crew.bus.on("question.updated", (q) => {
      if (q.status !== "answered") return;
      // hire approval → create the teammate
      if (q.kind === "hire" && /^approve/i.test(q.answer ?? "") && q.payload) {
        const p = q.payload as { name: string; role: string; provider: "anthropic" | "openrouter"; model?: string; dailyBudgetUsd?: number; soul?: string };
        if (!crew.findAgent(p.name)) {
          const agent = crew.createAgent({
            name: p.name, role: p.role, provider: p.provider, model: p.model ?? "", dailyBudgetUsd: p.dailyBudgetUsd ?? 2,
            soul: p.soul || `# ${p.name}, ${p.role}\n\nYou are ${p.name}, the ${p.role} on this team. Proposed by ${crew.findAgent(q.fromAgentId)?.name ?? "a teammate"} because: ${q.body}`,
            rules: [], responsibilities: [q.body], heartbeatMinutes: DEFAULTS.heartbeatMinutes, channels: ["general"], color: "#DDDCE8",
          });
          crew.postMessage({ channel: "general", authorId: "system", kind: "system", text: `${agent.name} joined the team as ${agent.role}.` });
          crew.bus.emit("agents.updated", crew.listAgents());
          this.rebuildCrons();
        }
      }
      // wake the asker unless the answer was consumed by a waiting tool call
      const asker = crew.findAgent(q.fromAgentId);
      if (!asker) return;
      if (asker.currentRunId && asker.currentRunId === q.runId) return;
      if (q.kind === "approval" || q.kind === "report") return; // approvals only matter to the run that asked; reports need no follow-up
      queue.enqueue(asker.id, { kind: "answer", questionId: q.id });
    });

    crew.bus.on("agent.updated", () => { /* cron changes are applied via rebuildCrons() from the API */ });
  }
}
