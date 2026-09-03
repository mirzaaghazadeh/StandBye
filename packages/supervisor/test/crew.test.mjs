import test from "node:test";
import assert from "node:assert/strict";
import { dmChannelId } from "@crew/shared";
import fs from "node:fs";
import path from "node:path";
import { makeCrew, spend } from "./helpers.mjs";
import { Crew } from "../dist/crew.js";

test("creating a team from the template draft", async (t) => {
  const { crew } = makeCrew(t);

  await t.test("the team is stored and readable", () => {
    assert.equal(crew.id, "team1");
    assert.equal(crew.team.ownerName, "Navid");
    assert.match(crew.team.name, /dev team/);
    assert.ok(crew.team.charter.length > 20);
    assert.equal(crew.team.git, null);
    assert.equal(crew.team.dailyCapUsd, 10);
  });

  await t.test("every agent in the draft exists with a soul, rules and memory on disk", () => {
    const ids = crew.listAgents().map((a) => a.id);
    assert.deepEqual(ids, ["ada", "kai", "rex", "sol"]);
    for (const id of ids) {
      const files = crew.store.readAgentFiles(id);
      assert.ok(files.soul.trim().length > 50, `${id} has a soul`);
      assert.match(files.rules, /# Rules/);
      assert.match(files.rules, /# Responsibilities/);
      assert.match(files.memory, /# Memory/);
    }
    assert.match(crew.store.readAgentFiles("kai").soul, /^# Kai/);
  });

  await t.test("agents carry the provider, model and budget from the draft", () => {
    const kai = crew.getAgent("kai");
    assert.equal(kai.provider, "anthropic");
    assert.equal(kai.model, "claude-opus-5");
    assert.equal(kai.checkinModel, "claude-haiku-4-5");
    assert.equal(kai.budget.dailyUsd, 3);
    const rex = crew.getAgent("rex");
    assert.equal(rex.provider, "openrouter", "the template mixes providers");
    assert.equal(rex.model, "z-ai/glm-5.3");
  });

  await t.test("the lead's schedules become cron triggers", () => {
    const ada = crew.getAgent("ada");
    assert.equal(ada.triggers.cron.length, 3);
    const names = ada.triggers.cron.map((c) => c.name);
    assert.ok(names.includes("Standup"));
    assert.ok(names.every((n, i) => ada.triggers.cron[i].expr.split(" ").length === 5), "5-field cron expressions");
    assert.equal(crew.getAgent("kai").triggers.cron.length, 0, "only the lead is scheduled");
  });

  await t.test("group channels from the draft, plus one direct chat per agent", () => {
    const channels = crew.listChannels();
    const groups = channels.filter((c) => c.kind === "group").map((c) => c.id).sort();
    assert.deepEqual(groups, ["backend", "general", "reviews"]);
    const dms = channels.filter((c) => c.kind === "dm").map((c) => c.id).sort();
    assert.deepEqual(dms, ["dm-ada", "dm-kai", "dm-rex", "dm-sol"]);
    const dmKai = channels.find((c) => c.id === dmChannelId("kai"));
    assert.equal(dmKai.dmAgentId, "kai");
    assert.deepEqual(dmKai.members, ["kai"]);
    assert.ok(crew.getAgent("kai").channels.includes("dm-kai"), "the agent lists its own direct chat");
    assert.ok(crew.getAgent("kai").channels.includes("general"));
  });

  await t.test("a system message announces the team", () => {
    const msgs = crew.db.listMessages("general", 10);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].kind, "system");
    assert.match(msgs[0].text, /created/);
  });
});

test("messages and mentions", async (t) => {
  const { crew } = makeCrew(t);

  await t.test("@Name and @id both resolve, unknown names do not", () => {
    assert.deepEqual(crew.parseMentions("@Kai please look"), ["kai"]);
    assert.deepEqual(crew.parseMentions("@kai please look"), ["kai"]);
    assert.deepEqual(crew.parseMentions("@Nobody hello"), []);
    assert.deepEqual(crew.parseMentions("email me at x@example.com"), [], "an email address is not a mention");
    assert.deepEqual(crew.parseMentions("@Kai and @Rex").sort(), ["kai", "rex"]);
    assert.deepEqual(crew.parseMentions("@Kai @Kai"), ["kai"], "deduplicated");
  });

  await t.test("a group message only reaches the agents it names", () => {
    const m = crew.postMessage({ channel: "backend", authorId: "user", text: "hello everyone" });
    assert.deepEqual(m.mentions, []);
    assert.equal(m.authorName, "Navid");
  });

  await t.test("in a direct chat, the owner never needs an @", () => {
    const m = crew.postMessage({ channel: "dm-kai", authorId: "user", text: "how are the tests looking?" });
    assert.deepEqual(m.mentions, ["kai"]);
  });

  await t.test("a direct chat does not auto-address when the agent is the author", () => {
    const m = crew.postMessage({ channel: "dm-kai", authorId: "kai", text: "all green" });
    assert.deepEqual(m.mentions, []);
    assert.equal(m.authorName, "Kai");
  });

  await t.test("a mention inside a direct chat still resolves, without duplicating the owner", () => {
    const m = crew.postMessage({ channel: "dm-kai", authorId: "user", text: "@Rex should look too" });
    assert.deepEqual(m.mentions.sort(), ["kai", "rex"]);
  });

  await t.test("posting to a channel that does not exist throws", () => {
    assert.throws(() => crew.postMessage({ channel: "nope", authorId: "user", text: "x" }), /Unknown channel/);
  });
});

test("questions, defaults and decisions", async (t) => {
  const { crew } = makeCrew(t);

  await t.test("a question with a default gets a deadline and shows up in its channel", () => {
    const q = crew.askQuestion({
      kind: "question", fromAgentId: "kai", toId: "user", channel: "backend",
      title: "SQLite or Postgres?", body: "One box, no ops team.",
      options: ["SQLite", "Postgres"], recommended: "SQLite", defaultAnswer: "SQLite", defaultInMinutes: 60,
    });
    assert.equal(q.status, "open");
    assert.ok(q.defaultAt, "a default answer sets a deadline");
    const minutesOut = (new Date(q.defaultAt) - new Date(q.createdAt)) / 60_000;
    assert.ok(Math.abs(minutesOut - 60) < 1, `deadline is about an hour out, got ${minutesOut}`);
    const posted = crew.db.listMessages("backend", 10).at(-1);
    assert.equal(posted.kind, "question");
    assert.equal(posted.questionId, q.id);
    assert.equal(crew.getAgent("kai").status, "needs_you", "the asker is shown as blocked");
  });

  await t.test("no default answer means no deadline, and it waits forever", () => {
    const q = crew.askQuestion({ kind: "question", fromAgentId: "ada", toId: "user", channel: null, title: "Ship it?", body: "" });
    assert.equal(q.defaultAt, null);
  });

  await t.test("a report does not block the agent who filed it", () => {
    crew.setAgentRuntime("sol", { status: "idle", statusText: "" });
    crew.askQuestion({ kind: "report", fromAgentId: "sol", toId: "user", channel: null, title: "End of day", body: "Docs updated." });
    assert.notEqual(crew.getAgent("sol").status, "needs_you");
  });

  await t.test("answering closes the question and posts the answer back", () => {
    const q = crew.askQuestion({ kind: "question", fromAgentId: "rex", toId: "user", channel: "reviews", title: "Merge #142?", body: "", options: ["Yes", "No"] });
    const answered = crew.answerQuestion(q.id, "Yes", "user");
    assert.equal(answered.status, "answered");
    assert.equal(answered.answer, "Yes");
    assert.equal(answered.answeredBy, "user");
    assert.ok(answered.answeredAt);
    assert.match(crew.db.listMessages("reviews", 10).at(-1).text, /Merge #142\?": Yes/);
  });

  await t.test("answering twice is a no-op, not an error", () => {
    const q = crew.askQuestion({ kind: "question", fromAgentId: "rex", toId: "user", channel: null, title: "Twice?", body: "" });
    crew.answerQuestion(q.id, "first", "user");
    const again = crew.answerQuestion(q.id, "second", "user");
    assert.equal(again.answer, "first");
  });

  await t.test("remember records a team decision every agent can read", () => {
    const q = crew.askQuestion({ kind: "question", fromAgentId: "kai", toId: "user", channel: null, title: "Tailwind or plain CSS?", body: "" });
    crew.answerQuestion(q.id, "Tailwind", "user", true);
    const decisions = crew.db.listDecisions();
    assert.ok(decisions.some((d) => d.title === "Tailwind or plain CSS?" && d.answer === "Tailwind" && d.by === "user"));
  });

  await t.test("a passed deadline applies the default answer", () => {
    // A negative delay puts the deadline in the past, which is what the scheduler tick would find later.
    const q = crew.askQuestion({
      kind: "question", fromAgentId: "kai", toId: "user", channel: null,
      title: "Queue backend?", body: "", defaultAnswer: "SQLite", defaultInMinutes: -1,
    });
    assert.ok(new Date(q.defaultAt) < new Date());
    const expired = crew.expireQuestions();
    assert.ok(expired.some((x) => x.id === q.id));
    const after = crew.db.getQuestion(q.id);
    assert.equal(after.status, "answered");
    assert.equal(after.answer, "SQLite");
    assert.equal(after.answeredBy, "default");
    assert.deepEqual(crew.expireQuestions(), [], "nothing left to expire the second time");
  });

  await t.test("dismissing closes a question without an answer", () => {
    const q = crew.askQuestion({ kind: "question", fromAgentId: "kai", toId: "user", channel: null, title: "Never mind", body: "" });
    const d = crew.dismissQuestion(q.id);
    assert.equal(d.status, "dismissed");
    assert.equal(d.answer, null);
  });

  await t.test("waitForAnswer resolves when the owner answers, and null when it times out", async () => {
    const q = crew.askQuestion({ kind: "approval", fromAgentId: "kai", toId: "user", channel: null, title: "Push to main?", body: "" });
    const waiting = crew.waitForAnswer(q.id, 2000);
    crew.answerQuestion(q.id, "Approve", "user");
    assert.equal(await waiting, "Approve");

    const q2 = crew.askQuestion({ kind: "approval", fromAgentId: "kai", toId: "user", channel: null, title: "Another?", body: "" });
    assert.equal(await crew.waitForAnswer(q2.id, 50), null);
  });
});

test("budget guards", async (t) => {
  const { crew } = makeCrew(t);

  await t.test("an agent with room to spend is allowed", () => {
    assert.deepEqual(crew.budgetAllows("kai"), { ok: true });
  });

  await t.test("the daily cap stops the agent", () => {
    crew.updateAgent("kai", { budget: { dailyUsd: 1, perRunUsd: 2, hourlyUsd: null, capBy: "day" } });
    spend(crew, "kai", 1.5);
    const v = crew.budgetAllows("kai");
    assert.equal(v.ok, false);
    assert.match(v.reason, /daily budget/);
    assert.deepEqual(crew.budgetAllows("ada"), { ok: true }, "only the agent that spent is stopped");
    assert.equal(crew.getAgent("kai").status, "over_budget");
  });

  await t.test("the hourly cap stops the agent even when the day has room", () => {
    crew.updateAgent("rex", { budget: { dailyUsd: 100, perRunUsd: 2, hourlyUsd: 0.5, capBy: "hour" } });
    spend(crew, "rex", 0.75);
    const v = crew.budgetAllows("rex");
    assert.equal(v.ok, false);
    assert.match(v.reason, /hourly budget/);
  });

  await t.test("spending outside the last hour does not count against the hourly cap", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    assert.equal(crew.db.spentSince("rex", twoHoursAgo) >= 0.75, true);
    const inFiveMinutes = new Date(Date.now() + 5 * 60_000).toISOString();
    assert.equal(crew.db.spentSince("rex", inFiveMinutes), 0, "nothing was spent after now");
  });

  await t.test("the team cap stops everyone", () => {
    crew.updateTeam({ dailyCapUsd: 1 });
    crew.updateAgent("ada", { budget: { dailyUsd: 100, perRunUsd: 2, hourlyUsd: null, capBy: "day" } });
    const v = crew.budgetAllows("ada");
    assert.equal(v.ok, false);
    assert.match(v.reason, /Team daily cap/);
  });

  await t.test("a provider switched off stops its agents", () => {
    crew.updateTeam({ dailyCapUsd: 1000 });
    crew.setProviders({ anthropic: { enabled: false } });
    const v = crew.budgetAllows("ada");
    assert.equal(v.ok, false);
    // The reason names the provider the way the owner sees it in Settings, not by its id.
    assert.match(v.reason, /Claude is turned off/);
    assert.deepEqual(crew.budgetAllows("rex").ok, false, "rex is over its hourly cap, not its provider");
    crew.setProviders({ anthropic: { enabled: true } });
  });
});

test("spend accounting", async (t) => {
  const { crew } = makeCrew(t);
  spend(crew, "kai", 0.25);
  spend(crew, "ada", 0.75);

  await t.test("per agent and per team totals", () => {
    const s = crew.spend();
    assert.ok(Math.abs(s.todayUsd - 1) < 1e-9);
    assert.ok(Math.abs(s.perAgent.kai - 0.25) < 1e-9);
    assert.ok(Math.abs(s.perAgent.ada - 0.75) < 1e-9);
    assert.equal(s.capUsd, 10);
  });

  await t.test("check-ins are counted separately so idling is visible", () => {
    const run = crew.createRun("sol", { kind: "heartbeat" }, "cheap-model");
    crew.updateRun(run, { status: "noop", costUsd: 0.01 });
    assert.ok(crew.db.checkinSpendToday() > 0);
    assert.ok(crew.db.checkinSpendToday() < 0.02, "only the heartbeat run counts");
  });

  await t.test("the agent's spend shows up on the agent record", () => {
    assert.ok(Math.abs(crew.getAgent("kai").spentTodayUsd - 0.25) < 1e-9);
  });
});

test("restart recovery", async (t) => {
  const { crew, dataDir } = makeCrew(t);
  const run = crew.createRun("kai", { kind: "manual", prompt: "x" }, "m");
  crew.updateRun(run, { status: "running", startedAt: new Date().toISOString() });
  crew.close();

  const { Crew } = await import("../dist/crew.js");
  const reopened = new Crew({ dataDir, globalDir: dataDir, keys: {} });
  t.after(() => { try { reopened.close(); } catch { /* ignore */ } });

  await t.test("a run left running by a crash is closed out, not left hanging", () => {
    const after = reopened.db.getRun(run.id);
    assert.equal(after.status, "failed");
    assert.match(after.error, /picked up again in a new run/);
    assert.ok(after.finishedAt);
  });

  await t.test("and it is handed back so the work is not thrown away", () => {
    assert.ok(reopened.interrupted.some((r) => r.id === run.id), "the interrupted run is offered for resuming");
  });

  await t.test("the team and its agents come back", () => {
    assert.equal(reopened.team.id, "team1");
    assert.deepEqual(reopened.listAgents().map((a) => a.id), ["ada", "kai", "rex", "sol"]);
  });
});

test("pausing a team outlives the app being closed", async (t) => {
  // It used to be a field in memory only, so quitting and reopening quietly started a paused
  // team back up — the one thing a pause must never do.
  const { crew, dataDir } = makeCrew(t);

  await t.test("a fresh team is not paused", () => {
    assert.equal(crew.pausedAll, false);
  });

  await t.test("pausing is written down, not just remembered", () => {
    crew.pausedAll = true;
    assert.equal(crew.pausedAll, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "team.json"), "utf8")).paused, true);
  });

  await t.test("it is still paused after a restart", () => {
    crew.close();
    const reopened = new Crew({ dataDir, globalDir: dataDir, keys: {} });
    t.after(() => { try { reopened.close(); } catch { /* closed */ } });
    assert.equal(reopened.pausedAll, true, "a paused team must not quietly start working again");
    for (const a of reopened.listAgents()) assert.equal(a.status, "paused", `${a.name} shows as paused`);
  });

  await t.test("resuming is written down too", () => {
    const c = new Crew({ dataDir, globalDir: dataDir, keys: {} });
    c.pausedAll = false;
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "team.json"), "utf8")).paused, false);
    c.close();
    const again = new Crew({ dataDir, globalDir: dataDir, keys: {} });
    t.after(() => { try { again.close(); } catch { /* closed */ } });
    assert.equal(again.pausedAll, false);
  });
});
