import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Agent, Message, Question, Run, RunTrigger } from "@crew/shared";
import type { Crew } from "./crew.js";
import { gitPrompt } from "./git.js";

const IGNORED = new Set([".git", "node_modules", "dist", "build", ".next", "__pycache__", ".venv", "venv", ".DS_Store"]);

/**
 * Where the agent is and what is in front of it.
 *
 * Without this an agent opens every run by hunting for its own working directory
 * (`cd /workspace 2>/dev/null || cd ~; pwd; ls -la; find ...`). In one measured build that
 * guesswork was 17 of 75 shell commands, and every one of them re-sent the whole conversation.
 * Handing over the path, the branch and a shallow tree costs ~150 tokens once per run.
 */
function workspaceContext(agent: Agent, crew: Crew): string {
  const root = agent.workspace ?? crew.team?.workspaceRoot ?? null;
  if (!root || !fs.existsSync(root)) {
    return "# Your workspace\nThis team has no workspace folder, so you have no files to work on. Say so rather than looking for one.";
  }
  const lines = [`# Your workspace`, `\`${root}\` — you are already in it; every relative path resolves from there, so never go hunting for it with \`cd\` or \`find\`. You cannot read or write outside it.`];
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    lines.push(`Git: on \`${branch}\`, working tree ${dirty ? `dirty (${dirty.split("\n").length} file(s) changed)` : "clean"}.`);
  } catch { /* not a repo */ }
  const tree = shallowTree(root);
  if (tree.length) lines.push("Files:", ...tree.map((f) => `- ${f}`));
  return lines.join("\n");
}

/** A two-level listing, capped, so the agent can see the shape of the project without running `ls -R`. */
function shallowTree(root: string, limit = 60): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string, depth: number): void => {
    if (depth > 1 || out.length >= limit) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
      if (out.length >= limit) { out.push("… (truncated)"); return; }
      if (IGNORED.has(e.name) || e.name.startsWith(".")) continue;
      if (e.isDirectory()) { out.push(prefix + e.name + "/"); walk(path.join(dir, e.name), prefix + "  ", depth + 1); }
      else out.push(prefix + e.name);
    }
  };
  walk(root, "", 0);
  return out;
}

/** Build the system prompt for an agent: soul, rules, team, memory, how the tools work. */
export function systemPrompt(crew: Crew, agent: Agent, mode: "full" | "checkin"): string {
  const files = crew.store.readAgentFiles(agent.id);
  const team = crew.team;
  const owner = team?.ownerName ?? "the owner";
  const teammates = crew
    .listAgents()
    .filter((a) => a.id !== agent.id)
    .map((a) => `- ${a.name}, ${a.role}`)
    .join("\n");
  const channels = crew
    .listChannels()
    .filter((c) => agent.channels.includes(c.id))
    .map((c) => (c.kind === "dm" ? `- #${c.name}: your direct chat with ${owner}. Only the two of you see it. When ${owner} writes to you there, answer there.` : `- #${c.name}: ${c.purpose}`))
    .join("\n");
  const skills = crew.store.listSkills(agent.id);
  const decisions = crew.db.listDecisions(15);

  const parts = [
    files.soul || `# ${agent.name}\n\nYou are ${agent.name}, ${agent.role} on ${owner}'s team.`,
    "",
    workspaceContext(agent, crew),
    "",
    "# Your team",
    `You work for ${owner}, a human who is not always around. Team charter: ${team?.charter ?? "(none)"}`,
    "Teammates:",
    teammates || "- (none yet)",
    "Channels you're in:",
    channels || "- #general",
    "",
    files.rules ? files.rules : "",
    "",
    gitPrompt(team?.git, owner),
    "",
    "# How this works",
    "You are woken by a trigger (a check-in, a mention, a task, an answer, a schedule). Each wake-up is one run.",
    "You have tools to talk to the team (post_message, ask_agent, assign_task), to reach the owner (ask_user, propose_hire), and to keep notes (remember).",
    `Rules like "ask before pushing to main" are enforced by the app: a blocked action returns an error, an "ask" action files an approval with ${owner} and waits.`,
    "Never fake progress. If you cannot do something, say so in the channel and finish.",
    "Don't chatter. Post when you have a decision, a question, a result, or a hand-off. Answer teammates directly and briefly.",
    "Never post an acknowledgement, a thank-you, a status echo, or a message whose only content is that you agree. Every message you post wakes someone and costs money, so if a teammate's message needs no action from you, do nothing and finish the run.",
    "Do not re-litigate settled work. If something is already committed and passing, leave it alone unless it is broken or the owner asks.",
    "When a decision belongs to the owner, ask once with options and a default, then keep working on something else.",
    "Always end a run by calling `done` with a one-line summary.",
    "",
    decisions.length ? "# Decisions already made (do not re-ask)\n" + decisions.map((d) => `- ${d.title} → ${d.answer}`).join("\n") : "",
    "",
    files.memory ? "# Your memory\n" + tail(files.memory, 40) : "",
    "",
    skills.length ? "# Your skills\n" + skills.map((s) => `## ${s.name}\n${s.content}`).join("\n\n") : "",
  ];

  if (mode === "checkin") {
    parts.push(
      "",
      "# This is a check-in",
      "You are running on a small, cheap model. Your only job is to decide whether anything needs your full attention.",
      "Read what's new below. If something needs real work (a task, a mention that needs an answer, an answered question, a failing build), call `escalate` with the reason.",
      "If nothing needs you, call `done` with status noop and summary 'Nothing new'. Do not do the work yourself here.",
    );
  }
  return parts.filter((p) => p !== undefined).join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Build the user prompt for a run from its trigger plus everything new since the agent last looked. */
export function runPrompt(crew: Crew, agent: Agent, run: Run): string {
  const state = crew.db.getAgentState(agent.id);
  const fresh = crew.db.messagesSince(agent.channels, state.lastSeenMessageAt, 60).filter((m) => m.authorId !== agent.id || m.kind === "system");
  const openForMe = crew.db.listQuestions({ toId: agent.id, status: "open" });
  const answeredMine = crew.db
    .listQuestions({ status: "answered", limit: 50 })
    .filter((q) => q.fromAgentId === agent.id && q.answeredAt && q.answeredAt > (state.lastHeartbeatAt ?? ""));
  const owner = crew.team?.ownerName ?? "the owner";

  const sections: string[] = [`Now: ${new Date().toLocaleString()}`, "", triggerText(crew, run.trigger, owner)];

  // What this agent itself already finished. Without it an agent re-explores work it completed an
  // hour ago and reports "already done" as if it were news: two wasted runs in one measured build.
  const mine = crew.db
    .listRuns({ agentId: agent.id, limit: 6 })
    .filter((r) => r.id !== run.id && r.summary && (r.status === "done" || r.status === "needs_you"));
  if (mine.length) {
    sections.push("", "## What you already did (do not redo or re-verify this)", ...mine.map((r) => `- ${hhmm(r.createdAt)}: ${r.summary}`));
  }

  if (fresh.length) {
    sections.push("", "## New messages in your channels", ...fresh.map(formatMessage));
  }
  if (openForMe.length) {
    sections.push("", "## Questions waiting for your answer (use answer_question with the id)", ...openForMe.map((q) => `- [${q.id}] from ${crew.findAgent(q.fromAgentId)?.name ?? q.fromAgentId}: ${q.title}${q.body && q.body !== q.title ? " — " + q.body : ""}`));
  }
  if (answeredMine.length) {
    sections.push("", "## Answers to questions you asked", ...answeredMine.map((q) => `- "${q.title}" → ${q.answer} (${q.answeredBy === "user" ? owner : q.answeredBy === "default" ? "default applied" : crew.findAgent(q.answeredBy!)?.name ?? q.answeredBy})`));
  }
  if (!fresh.length && !openForMe.length && !answeredMine.length && run.trigger.kind === "heartbeat") {
    sections.push("", "Nothing new in your channels and no open questions.");
  }
  return sections.join("\n");
}

function triggerText(crew: Crew, t: RunTrigger, owner: string): string {
  switch (t.kind) {
    case "heartbeat":
      return "## Check-in\nLook at what's new. If something needs you, handle it; if not, say so and finish.";
    case "schedule":
      return `## Scheduled: ${t.name}\n${t.prompt}`;
    case "mention": {
      const m = crew.db.getMessage(t.messageId);
      return `## You were mentioned by ${crew.findAgent(t.by)?.name ?? (t.by === "user" ? owner : t.by)} in #${m?.channelId ?? "?"}\n${m ? formatMessage(m) : ""}\nRespond in that channel if a response is needed, or do the work.`;
    }
    case "task":
      return `## Task from ${crew.findAgent(t.from)?.name ?? (t.from === "user" ? owner : t.from)}: ${t.title}\n${t.details}\nDo it. Report the result in the channel where it was assigned.`;
    case "answer": {
      const q = crew.db.getQuestion(t.questionId);
      return `## Your question was answered\n"${q?.title}" → ${q?.answer}\nContinue the work that was waiting on this.`;
    }
    case "question": {
      const q = crew.db.getQuestion(t.questionId);
      return `## ${crew.findAgent(t.from)?.name ?? t.from} asked you a question\n[${t.questionId}] ${q?.title}${q?.body && q.body !== q.title ? "\n" + q.body : ""}\nAnswer with answer_question (question_id "${t.questionId}"). Look things up first if you need to.`;
    }
    case "escalated":
      return `## Your check-in found work to do\nReason: ${t.reason}\nDo it now.`;
    case "manual":
      return `## Message from ${owner}\n${t.prompt}`;
  }
}

function hhmm(iso: string): string {
  return iso.slice(11, 16);
}

function formatMessage(m: Message): string {
  return `- [${m.createdAt.slice(11, 16)}] ${m.authorName} in #${m.channelId}: ${m.text}`;
}

function tail(text: string, lines: number): string {
  const all = text.split("\n");
  return all.slice(Math.max(0, all.length - lines)).join("\n");
}

export function describeQuestion(q: Question): string {
  return `${q.title}${q.body ? "\n" + q.body : ""}`;
}
