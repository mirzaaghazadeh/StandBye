import { z } from "zod";
import type { Run } from "@crew/shared";
import { dmChannelId } from "@crew/shared";
import type { Crew } from "../crew.js";
import { DEFAULTS } from "../config.js";
import { normalizeSkillName } from "../skills.js";

/**
 * The team tools: how an agent talks to teammates and to the owner.
 * One definition, mounted three ways: as an in-process MCP server for the Claude Agent SDK,
 * as AI SDK tools for OpenRouter models, and as a stdio MCP server for external agents.
 */

export interface ToolContext {
  crew: Crew;
  agentId: string;
  run: Run;
  /** current agent-to-agent depth of the conversation this run is part of */
  depth: number;
  /** set when the agent calls `done` so the runner can stop the loop */
  onDone?: (summary: string, status: "done" | "noop" | "needs_you") => void;
  onEscalate?: (reason: string) => void;
}

export interface TeamToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  schema: S;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<string>;
}

function def<S extends z.ZodRawShape>(t: TeamToolDef<S>): TeamToolDef<S> {
  return t;
}

export const TEAM_TOOLS = [
  def({
    name: "list_agents",
    description: "List your teammates: name, role, status and what they are doing. Use names with @ to address them.",
    schema: {},
    handler: async (_args, ctx) => {
      const agents = ctx.crew.listAgents();
      const owner = ctx.crew.team?.ownerName ?? "the owner";
      const lines = agents.map((a) => `- ${a.name} (${a.role}) · ${a.status}${a.statusText ? ": " + a.statusText : ""}${a.id === ctx.agentId ? " · this is you" : ""}`);
      lines.push(`- ${owner} · the human owner. Reach them with ask_user; they answer in their own time.`);
      return lines.join("\n");
    },
  }),
  def({
    name: "read_channel",
    description: "Read the latest messages in a channel.",
    schema: { channel: z.string().describe("Channel name, e.g. general or backend"), limit: z.number().int().min(1).max(100).optional() },
    handler: async ({ channel, limit }, ctx) => {
      const c = ctx.crew.db.getChannel(channel);
      if (!c) return `No channel named ${channel}. Channels: ${ctx.crew.listChannels().map((x) => x.name).join(", ")}`;
      const msgs = ctx.crew.db.listMessages(c.id, limit ?? 30);
      if (msgs.length === 0) return `#${c.name} is empty.`;
      return msgs.map((m) => `[${m.createdAt.slice(5, 16).replace("T", " ")}] ${m.authorName}: ${m.text}`).join("\n");
    },
  }),
  def({
    name: "post_message",
    description:
      "Post a message to a channel. Mention a teammate with @Name to get their attention; they will read it and reply when it concerns them. Keep it short and specific. Don't post progress chatter; post decisions, questions, results and hand-offs.",
    schema: { channel: z.string(), text: z.string().min(1).max(4000) },
    handler: async ({ channel, text }, ctx) => {
      const agent = ctx.crew.getAgent(ctx.agentId);
      const target = ctx.crew.db.getChannel(channel);
      if (target?.kind === "dm" && target.dmAgentId !== ctx.agentId) return `#${target.name} is ${ctx.crew.findAgent(target.dmAgentId ?? "")?.name ?? "someone else"}'s private chat with the owner. Use your own direct chat (#${dmChannelId(ctx.agentId)}) or a team channel.`;
      if (!target && !agent.channels.includes(channel.replace(/^#/, "").toLowerCase())) {
        ctx.crew.ensureChannel(channel, "", [ctx.agentId]);
      }
      const mentions = ctx.crew.parseMentions(text);
      const cap = ctx.crew.team?.chatDepthCap ?? DEFAULTS.chatDepthCap;
      const depth = ctx.depth + 1;
      const m = ctx.crew.postMessage({ channel, authorId: ctx.agentId, text, runId: ctx.run.id, depth });
      ctx.crew.addStep(ctx.run.id, "post", `#${m.channelId}: ${text.slice(0, 120)}`);
      if (mentions.length && depth >= cap) {
        return `Posted to #${m.channelId}. Note: this thread has gone back and forth ${depth} times, so mentioned teammates will NOT be woken again. If you still need a decision, use ask_user.`;
      }
      return `Posted to #${m.channelId}${mentions.length ? ` and notified ${mentions.join(", ")}` : ""}.`;
    },
  }),
  def({
    name: "ask_user",
    description:
      "Ask the owner something only they can decide, or request approval. Give options, say which you recommend, and give a sensible default so work is not blocked forever. The owner answers in their own time; this call returns immediately unless wait is true. Keep working on something else meanwhile.",
    schema: {
      title: z.string().max(140).describe("The question in one line"),
      body: z.string().max(4000).describe("Why you're asking and what you recommend; for a report, the report itself"),
      options: z.array(z.string()).max(6).optional(),
      recommended: z.string().optional(),
      default_answer: z.string().optional().describe("Used automatically if the owner doesn't answer in time"),
      default_in_minutes: z.number().int().min(5).max(1440).optional(),
      wait: z.boolean().optional().describe("Block until answered (max 20 min). Only when you truly cannot continue."),
      kind: z.enum(["question", "report"]).optional().describe("report = an update that needs no decision; it lands in the owner's inbox without blocking anything"),
    },
    handler: async (args, ctx) => {
      const agent = ctx.crew.getAgent(ctx.agentId);
      const channel = agent.channels.find((c) => c !== "general" && !c.startsWith("dm-")) ?? "general";
      if (args.kind === "report") {
        const r = ctx.crew.askQuestion({ kind: "report", fromAgentId: ctx.agentId, toId: "user", channel: null, title: args.title, body: args.body, options: ["Got it"], runId: ctx.run.id });
        ctx.crew.addStep(ctx.run.id, "post", `Report to ${ctx.crew.team?.ownerName ?? "the owner"}: ${args.title}`);
        return `Report ${r.id} delivered to the owner's inbox.`;
      }
      const q = ctx.crew.askQuestion({
        kind: "question", fromAgentId: ctx.agentId, toId: "user", channel, title: args.title, body: args.body,
        options: args.options, recommended: args.recommended ?? null, defaultAnswer: args.default_answer ?? null,
        defaultInMinutes: args.default_in_minutes ?? null, runId: ctx.run.id,
      });
      ctx.crew.addStep(ctx.run.id, "ask", `Asked ${ctx.crew.team?.ownerName ?? "the owner"}: ${args.title}`);
      if (args.wait) {
        const answer = await ctx.crew.waitOnOwner(q.id, ctx.run.id, DEFAULTS.approvalTimeoutMinutes * 60_000);
        if (answer !== null) return `Answer: ${answer}`;
        if (q.defaultAnswer) return `No answer within ${DEFAULTS.approvalTimeoutMinutes} minutes. Proceed with your default: ${q.defaultAnswer}`;
        return `No answer yet. Do what you can without it and finish; you'll be woken when they answer.`;
      }
      return `Question ${q.id} filed. You will be woken when it is answered${q.defaultAt ? `; default "${q.defaultAnswer}" applies at ${q.defaultAt.slice(11, 16)}` : ""}.`;
    },
  }),
  def({
    name: "ask_agent",
    description: "Ask a teammate a direct question. They get woken and answer in the channel. Prefer this over long @mention threads.",
    schema: { agent: z.string().describe("Teammate name"), question: z.string().max(2000), channel: z.string().optional() },
    handler: async ({ agent, question, channel }, ctx) => {
      const target = ctx.crew.findAgent(agent);
      if (!target) return `No teammate named ${agent}. Use list_agents.`;
      if (target.id === ctx.agentId) return "That's you.";
      const me = ctx.crew.getAgent(ctx.agentId);
      const ch = channel ?? me.channels.find((c) => target.channels.includes(c) && c !== "general") ?? "general";
      const q = ctx.crew.askQuestion({ kind: "question", fromAgentId: ctx.agentId, toId: target.id, channel: ch, title: question.split("\n")[0]!.slice(0, 140), body: question, runId: ctx.run.id });
      ctx.crew.addStep(ctx.run.id, "ask", `Asked ${target.name}: ${q.title}`);
      return `Asked ${target.name} in #${ch}. You'll be woken with their answer.`;
    },
  }),
  def({
    name: "answer_question",
    description: "Answer a question a teammate asked you (you were given its id when woken).",
    schema: { question_id: z.string(), answer: z.string().max(4000) },
    handler: async ({ question_id, answer }, ctx) => {
      const q = ctx.crew.db.getQuestion(question_id);
      if (!q) return `No question ${question_id}.`;
      if (q.toId !== ctx.agentId) return `Question ${question_id} was not addressed to you.`;
      ctx.crew.answerQuestion(question_id, answer, ctx.agentId);
      ctx.crew.addStep(ctx.run.id, "post", `Answered ${ctx.crew.findAgent(q.fromAgentId)?.name ?? q.fromAgentId}: ${answer.slice(0, 120)}`);
      return "Answered.";
    },
  }),
  def({
    name: "assign_task",
    description: "Hand a concrete task to a teammate. They are woken with it. Include what done looks like.",
    schema: { agent: z.string(), title: z.string().max(140), details: z.string().max(4000) },
    handler: async ({ agent, title, details }, ctx) => {
      const target = ctx.crew.findAgent(agent);
      if (!target) return `No teammate named ${agent}.`;
      const me = ctx.crew.getAgent(ctx.agentId);
      const ch = me.channels.find((c) => target.channels.includes(c) && c !== "general") ?? "general";
      ctx.crew.postMessage({ channel: ch, authorId: ctx.agentId, text: `@${target.name} task: ${title}\n${details}`, runId: ctx.run.id, depth: 0 });
      ctx.crew.bus.emit("notify", { title: `${me.name} → ${target.name}`, body: title });
      ctx.crew.addStep(ctx.run.id, "post", `Assigned to ${target.name}: ${title}`);
      return `Assigned "${title}" to ${target.name}.`;
    },
  }),
  def({
    name: "propose_hire",
    description: "Propose a new teammate when the team is missing a role. The owner approves or declines. Explain the gap with evidence.",
    schema: {
      name: z.string(), role: z.string(), reason: z.string().max(2000),
      provider: z.enum(["anthropic", "openrouter"]).optional(), model: z.string().optional(), daily_budget_usd: z.number().optional(),
      soul: z.string().max(4000).optional().describe("Draft SOUL.md for the new teammate"),
    },
    handler: async (args, ctx) => {
      const q = ctx.crew.askQuestion({
        kind: "hire", fromAgentId: ctx.agentId, toId: "user", channel: "general", title: `Hire ${args.name} as ${args.role}`, body: args.reason,
        options: ["Approve", "Decline"], recommended: "Approve",
        payload: { name: args.name, role: args.role, provider: args.provider ?? "anthropic", model: args.model, dailyBudgetUsd: args.daily_budget_usd ?? 2, soul: args.soul ?? "" },
        runId: ctx.run.id,
      });
      ctx.crew.addStep(ctx.run.id, "ask", `Proposed hire: ${args.name} (${args.role})`);
      return `Hire proposal ${q.id} sent to the owner.`;
    },
  }),
  def({
    name: "remember",
    description: "Save something you learned that will matter next time: a convention, a decision, a gotcha, a preference of the owner. One sentence. Don't save task progress.",
    schema: { note: z.string().min(5).max(500) },
    handler: async ({ note }, ctx) => {
      const n = ctx.crew.store.appendMemory(ctx.agentId, note);
      ctx.crew.addStep(ctx.run.id, "memory", note);
      ctx.crew.setAgentRuntime(ctx.agentId, {});
      return `Remembered (${n} notes).`;
    },
  }),
  def({
    name: "use_skill",
    description:
      "Open one of your skills and follow it. The skills listed in your prompt show only a name and a description; this returns the actual steps. Read the skill before doing the work it covers.",
    schema: { name: z.string().min(1).max(64).describe("The skill's name, exactly as listed in your prompt") },
    handler: async ({ name }, ctx) => {
      const agent = ctx.crew.getAgent(ctx.agentId);
      const wanted = normalizeSkillName(name);
      const skill = ctx.crew.skills.find(agent, wanted);
      if (!skill) {
        const have = ctx.crew.skills.usableFor(agent).map((s) => s.name);
        return `No skill named "${wanted}". ${have.length ? `You have: ${have.join(", ")}.` : "You have no skills."}`;
      }
      ctx.crew.addStep(ctx.run.id, "read", `Skill: ${skill.name}`);
      const files = skill.files.length
        ? `\n\n---\nBundled files you can read or run, under \`${skill.dir}\`:\n${skill.files.map((f) => `- ${f}`).join("\n")}`
        : "";
      return `# Skill: ${skill.name}\n${skill.description}\n\n${skill.body}${files}`;
    },
  }),
  def({
    name: "learn_skill",
    description:
      "Save a reusable how-to you worked out, so next time (and teammates) can follow it without rediscovering it: a checklist, a command sequence, a pattern for this codebase. Markdown, under 60 lines. Use a short kebab-case name; saving the same name replaces it.",
    schema: {
      name: z.string().min(2).max(64),
      description: z.string().min(10).max(400).describe("What it does and when to use it. This is all a future run sees until it opens the skill, so make it specific."),
      content: z.string().min(20).max(6000),
      scope: z.enum(["mine", "team"]).optional().describe("mine = only you (default). team = every agent on this team, for something anyone here would need."),
    },
    handler: async ({ name, description, content, scope }, ctx) => {
      const target = scope === "team" ? { scope: "team" as const } : { scope: "agent" as const, ownerId: ctx.agentId };
      const s = ctx.crew.skills.save(target, { name, description, body: content, source: { kind: "learned" } });
      ctx.crew.addStep(ctx.run.id, "memory", `Learned skill: ${s.name}`);
      ctx.crew.bus.emit("agent.updated", ctx.crew.getAgent(ctx.agentId));
      ctx.crew.bus.emit("skills.updated", null);
      return `Skill "${s.name}" saved${scope === "team" ? " for the whole team" : ""}. From now on it is listed in your prompt; open it with use_skill.`;
    },
  }),
  def({
    name: "team_decisions",
    description: "List decisions the owner has already made so you don't ask again.",
    schema: {},
    handler: async (_args, ctx) => {
      const d = ctx.crew.db.listDecisions(30);
      if (!d.length) return "No recorded decisions yet.";
      return d.map((x) => `- ${x.title} → ${x.answer} (${x.by}, ${x.createdAt.slice(0, 10)})`).join("\n");
    },
  }),
  def({
    name: "done",
    description:
      "Finish this run. Call it exactly once at the end with a one-line summary of what you did (or 'Nothing new' if there was nothing to do). Status: done = did work, noop = nothing needed doing, needs_you = blocked on the owner.",
    schema: { summary: z.string().max(300), status: z.enum(["done", "noop", "needs_you"]).optional() },
    handler: async ({ summary, status }, ctx) => {
      ctx.onDone?.(summary, status ?? "done");
      return "Run finished. Stop now; do not call any more tools.";
    },
  }),
] as const;

export const CHECKIN_TOOLS = [
  def({
    name: "escalate",
    description: "There is real work to do. Hand off to your full model with a one-line reason. Call this instead of doing the work yourself.",
    schema: { reason: z.string().max(300) },
    handler: async ({ reason }, ctx) => {
      ctx.onEscalate?.(reason);
      return "Escalated. Stop now; do not call any more tools.";
    },
  }),
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTeamTool = TeamToolDef<any>;
