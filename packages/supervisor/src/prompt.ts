import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Agent, Autonomy, Message, Question, Run, RunTrigger } from "@crew/shared";
import { AUTONOMY_RULE } from "@crew/shared";
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
  const conventions = projectConventions(root);
  if (conventions) lines.push("", conventions);
  return lines.join("\n");
}

/**
 * How the team decides its own work, and how far it may go with it.
 *
 * This is the difference between a team that waits to be told and one that runs itself. The
 * backlog is the memory: without somewhere for an idea to live between being noticed and being
 * built, every idea dies with the run that had it, and each morning starts from nothing.
 *
 * The limit is the owner's dial, enforced by the app like permissions and budgets — it is stated
 * here so an agent knows where it stands, not so it can choose.
 */
function autonomySection(crew: Crew, agent: Agent, owner: string): string {
  const level: Autonomy = crew.team?.autonomy ?? "pr";
  const lead = isLead(agent);
  const board = crew.backlog.summary();
  const lines = [
    "# Deciding what to do",
    `${owner} is not always here. Between them asking for things, it is on you to notice what this project needs and to keep the backlog honest.`,
    `What you may do without asking: ${AUTONOMY_RULE[level]}`,
    "The backlog is how work survives between runs. add_idea when you notice something real; list_backlog before you start anything, so you do not repeat a teammate; claim_item before you build; finish_item when it is done, in review, or not worth doing.",
    "An idea needs a case: what is wrong or missing today and who it hurts. \"Add tests\" is not an idea; \"approval.ts has no test for the deadlock we just fixed, so it can silently come back\" is.",
    "Do not invent work to look busy. A quiet day where nothing needed doing is a good day, and saying so costs the team nothing.",
  ];
  if (lead) {
    lines.push(
      `You are the lead, so ranking is yours: decide what actually serves the charter next with rank_backlog, mark it ready, and hand it out with assign_task. Ask ${owner} only when the call is genuinely theirs — money, product direction, or anything irreversible.`,
    );
  }
  if (level === "auto") {
    lines.push(
      `Nobody is waiting to answer you. Do not use ask_user to ask a question — there is no one to answer it, and the run would stall until it timed out. Decide it yourself, do the smaller safer version when you are unsure, and write the decision and your reasoning into the backlog item or your memory so ${owner} can see afterwards what you chose and why.`,
      `Keep ${owner} informed rather than consulted: ask_user with kind "report" does not block, and a short note in #general costs nothing.`,
      "A rule set to block is still a hard stop. Do not try to work around one; find another way or drop the item and say why.",
    );
  }
  if (level === "propose") {
    lines.push(`Because the team is set to propose-only, do not write code for a backlog item until ${owner} has said yes to that item.`);
  }
  if (board) lines.push("", "## The backlog right now", board);
  return lines.join("\n");
}

/**
 * What an idle check-in should do with itself.
 *
 * A check-in that finds nothing new used to answer "nothing new" and stop, which is most
 * wake-ups — and it is exactly the moment an agent has time to notice what the project needs.
 * The rule here is deliberately narrow: escalate when there is real work waiting, or when the
 * backlog is empty and nobody has looked lately. Otherwise stop. A check-in runs on the cheap
 * model and cannot do the work itself; its only job is to decide whether the full model should.
 */
function idleWork(crew: Crew, agent: Agent): string {
  const ready = crew.backlog.open().filter((i) => i.status === "ready" && !i.claimedBy);
  const mine = crew.backlog.open().filter((i) => i.claimedBy === agent.id);
  if (mine.length) {
    return `You still own ${mine.map((i) => `[${i.id}] ${i.title}`).join(", ")}. Escalate and finish it.`;
  }
  if (ready.length) {
    const top = ready[0]!;
    return `The backlog has work ready and unclaimed: [${top.id}] ${top.title}. Escalate to pick it up.`;
  }
  if (!crew.backlog.open().length) {
    return "The backlog is empty. If you have not looked lately, escalate to go and find what this project needs — read the recent commits, the failing or missing tests, the TODOs, the rough edges you have hit yourself — and write what you find down with add_idea. If you looked recently and found nothing, just finish.";
  }
  return "Everything on the backlog is either unranked or already taken, so there is nothing for you to start. Finish.";
}

/** The lead is whoever the team calls one; teams built from the template have exactly one. */
function isLead(agent: Agent): boolean {
  return /\blead\b|maintainer/i.test(agent.role);
}

/** Files a repo uses to tell a newcomer how to work in it, best first. */
const CONVENTION_FILES = ["CLAUDE.md", "AGENTS.md", "CONTRIBUTING.md", ".cursorrules"];
const CONVENTIONS_MAX = 3000;

/**
 * Hand the agent the project's own house rules instead of making it go and find them.
 *
 * Measured on a real task: about half the run's steps were orientation — locating the tests,
 * working out how they are run, and reading CLAUDE.md for the conventions — and that whole
 * detour is repeated on every task, in every run, forever. Here it rides in the system prompt,
 * which is the stable prefix the provider caches, so it is paid for roughly once per run
 * instead of costing an uncached tool result plus the step that fetched it.
 */
function projectConventions(root: string): string {
  for (const name of CONVENTION_FILES) {
    const file = path.join(root, name);
    let body: string;
    try {
      if (!fs.statSync(file).isFile()) continue;
      body = fs.readFileSync(file, "utf8").trim();
    } catch { continue; }
    if (!body) continue;
    const clipped = body.length > CONVENTIONS_MAX;
    const text = clipped ? body.slice(0, CONVENTIONS_MAX).replace(/\n[^\n]*$/, "") : body;
    return [
      `# ${name} — this project's own instructions`,
      "Written by the owner for whoever works here. Follow it; you do not need to go and read it again.",
      clipped ? `(first ${CONVENTIONS_MAX} characters; read \`${name}\` yourself if you need the rest)` : "",
      "",
      text,
    ].filter(Boolean).join("\n");
  }
  return "";
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

/**
 * The skills this agent can reach, as a catalog: name, scope and description only.
 *
 * The bodies stay on disk until the agent decides a skill applies — that is the whole point of
 * the Agent Skills format, and the difference between 150 tokens per run and every how-to the
 * team has ever written. `hasNativeSkillTool` is true for the Claude runner, which mounts the
 * same skills as a plugin and lists them itself, so we would only be saying it twice.
 */
function skillsCatalog(crew: Crew, agent: Agent, hasNativeSkillTool: boolean): string {
  if (hasNativeSkillTool) return "";
  const skills = crew.skills.usableFor(agent);
  if (!skills.length) return "";
  const where = { user: "everyone", team: "this team", agent: "yours" } as const;
  return [
    "# Your skills",
    "How-tos you can open when one applies. Call `use_skill` with the name to read the steps — don't work from the description alone, and don't rediscover what a skill already covers.",
    ...skills.map((s) => `- ${s.name} (${where[s.scope]}): ${s.description}`),
  ].join("\n");
}

/** Build the system prompt for an agent: soul, rules, team, memory, how the tools work. */
export function systemPrompt(crew: Crew, agent: Agent, mode: "full" | "checkin" | "reply", opts: { hasNativeSkillTool?: boolean } = {}): string {
  const files = crew.store.readAgentFiles(agent.id);
  const team = crew.team;
  const owner = team?.ownerName ?? "the owner";
  if (mode === "checkin") return checkinPrompt(agent, files, owner);
  if (mode === "reply") return replyPrompt(crew, agent, files, owner);
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
    autonomySection(crew, agent, owner),
    "",
    decisions.length ? "# Decisions already made (do not re-ask)\n" + decisions.map((d) => `- ${d.title} → ${d.answer}`).join("\n") : "",
    "",
    files.memory ? "# Your memory\n" + tail(files.memory, 40) : "",
    "",
    skillsCatalog(crew, agent, opts.hasNativeSkillTool ?? false),
  ];

  return parts.filter((p) => p !== undefined).join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Answering the owner in their private chat.
 *
 * Measured: a "what are you working on?" took 28 seconds and ~17,500 input tokens, because it was
 * given the whole working apparatus — the file tree, the project's conventions, the backlog, the
 * skills catalogue, the git workflow, and every file and shell tool — to type two sentences. None
 * of that helps someone answer a question about what they are doing.
 *
 * So a reply gets what a person needs to answer: who they are, what they have been doing, what
 * they remember, and the conversation. If the message turns out to be real work, it escalates —
 * the same move a check-in makes, and for the same reason.
 */
function replyPrompt(crew: Crew, agent: Agent, files: { soul?: string; rules?: string; memory?: string }, owner: string): string {
  const identity = (files.soul ?? "").split(/\n\s*\n/).find((p) => p.trim() && !p.trim().startsWith("#"))?.trim();
  const recent = crew.db
    .listRuns({ agentId: agent.id, limit: 5 })
    .filter((r) => r.summary && (r.status === "done" || r.status === "needs_you"))
    .map((r) => `- ${hhmm(r.createdAt)}: ${r.summary}`);
  return [
    `You are ${agent.name}, ${agent.role} on ${owner}'s team.`,
    identity ?? "",
    "",
    `# ${owner} is talking to you`,
    "This is your private chat. Answer them, then finish — that is the whole run.",
    "Reply from what you already know: what you have been doing is below, and your memory is further down. Do not go and look things up, read files or run commands to answer a question about your own work.",
    "Be brief and specific. No status echoes, no preamble.",
    "",
    `If they are actually asking for work — a change, an investigation, something that needs the code — call \`escalate\` with a one-line reason instead of answering. That hands it to your full self, with the workspace and the tools. Answering a question is not work; being asked to fix something is.`,
    "",
    recent.length ? "# What you have been doing\n" + recent.join("\n") : "# What you have been doing\nNothing yet.",
    "",
    files.memory ? "# Your memory\n" + tail(files.memory, 25) : "",
  ].filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * A check-in is the most frequent run there is — every agent, every heartbeat, all day — and it
 * makes exactly one decision: does this need the full model? It therefore gets the smallest
 * prompt that can make that decision, not the full one with a note on the end.
 *
 * What it leaves out matters as much as what it keeps. A check-in holds only `escalate` and
 * `done`, so describing post_message, ask_agent, remember or the skills catalogue does not just
 * cost tokens on the hottest path in the app — it invites a small model to call a tool it has
 * not been given and waste the whole run. The workspace tree, the team roster, the git workflow
 * and the decision log are all for doing work, and a check-in never does work.
 */
function checkinPrompt(agent: Agent, files: { soul?: string; rules?: string }, owner: string): string {
  // The soul's first paragraph is who they are; the rest is how they work, which is not needed
  // to notice that something is waiting.
  const identity = (files.soul ?? "").split(/\n\s*\n/).find((p) => p.trim() && !p.trim().startsWith("#"))?.trim();
  return [
    `You are ${agent.name}, ${agent.role} on ${owner}'s team.`,
    identity ?? "",
    "",
    "# This is a check-in",
    "You are running on a small, cheap model, and you have exactly two tools: `escalate` and `done`. You cannot post, message anyone, read files or run commands here — do not try.",
    "Your only job is to decide whether what is new below needs your full attention.",
    "Escalate when there is real work: a task assigned to you, a mention that needs an answer, a question that was answered, a failing build, a review waiting on you. Call `escalate` with a one-line reason and stop.",
    "Otherwise call `done` with status noop and summary 'Nothing new'. Nothing new is the normal answer, and it is a good one — it costs the team nothing.",
    "Never do the work here, and never guess at what happened; if you need to look at anything to decide, that is itself a reason to escalate.",
  ].filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n");
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
    sections.push("", "Nothing new in your channels and no open questions.", idleWork(crew, agent));
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
      const who = crew.findAgent(t.by)?.name ?? (t.by === "user" ? owner : t.by);
      // A direct chat is a conversation, not a work order. Measured: "hi" in a DM sent the agent
      // off to run `git log` and `git status` before answering, three model round-trips and 41
      // seconds to say hello. Someone talking to you expects an answer first.
      const dm = m && crew.db.getChannel(m.channelId)?.kind === "dm";
      if (dm && t.by === "user") {
        return [
          `## ${owner} wrote to you directly`,
          m ? formatMessage(m) : "",
          `Answer ${owner} with post_message to #${m?.channelId ?? "your direct chat"}, then finish.`,
          "This is a conversation. Reply from what you already know — you have your memory and what you last did, above.",
          `Only look something up or touch the workspace if ${owner} actually asked for something that needs it; do not go and check the repo before saying hello.`,
        ].filter(Boolean).join("\n");
      }
      return `## You were mentioned by ${who} in #${m?.channelId ?? "?"}\n${m ? formatMessage(m) : ""}\nRespond in that channel if a response is needed, or do the work.`;
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
    case "resumed": {
      // The work is still on disk; only the conversation was lost. Say what the last attempt got
      // through so the agent continues it instead of starting the same change a second time.
      const steps = crew.db.listSteps(t.runId);
      const did = steps
        .filter((s) => s.kind !== "text" && s.kind !== "info")
        .slice(-14)
        .map((s) => `- ${s.kind}: ${String(s.text ?? "").slice(0, 140).replace(/\n/g, " ")}`);
      return [
        "## You were part-way through this when the app stopped",
        triggerText(crew, t.was, owner).replace(/^## /, "### What you had been asked to do: "),
        "",
        did.length ? "### What that run got through, in order\n" + did.join("\n") : "That run had not done anything yet.",
        "",
        "Nothing was rolled back: any file it edited is still edited and any commit it made is still there. Check the working tree first (`git status`, `git log --oneline -3`) and carry on from where it stopped — do not start the same change again.",
      ].join("\n");
    }
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
