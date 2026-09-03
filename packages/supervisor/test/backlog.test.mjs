// A team that finds its own work needs somewhere for an idea to live between being noticed and
// being built. Without it every idea dies with the run that had it, and each morning starts over.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AUTONOMY_RULE, TEAM_DIR_NAME } from "@crew/shared";
import { Backlog } from "../dist/backlog.js";
import { systemPrompt, runPrompt } from "../dist/prompt.js";
import { Hub } from "../dist/hub.js";
import { soloDevTeam } from "../dist/templates.js";
import { makeCrew, tempDir, PROVIDERS } from "./helpers.mjs";

process.env.CREW_DISABLE_CLAUDE_LOGIN = "1";

test("the backlog keeps work alive between runs", async (t) => {
  const dir = tempDir("standbye-backlog-");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const b = new Backlog(dir);

  await t.test("it starts empty and says so without throwing", () => {
    assert.deepEqual(b.list(), []);
    assert.equal(b.summary(), "");
    assert.equal(b.hasReadyWork(), false);
  });

  const first = b.add({ title: "Test the approval deadlock", detail: "queue.ts suspendSlot", rationale: "it can silently come back", addedBy: "mina" });
  const second = b.add({ title: "Wire the workspace watcher", rationale: "nothing notices a failed build", addedBy: "arash", size: "large" });

  await t.test("a new idea goes to the back, so nobody jumps the queue by thinking of it last", () => {
    assert.ok(second.rank > first.rank);
    assert.deepEqual(b.list().map((i) => i.id), [first.id, second.id]);
  });

  await t.test("it survives being written and read again — the point of the whole thing", () => {
    const reopened = new Backlog(dir);
    assert.equal(reopened.list().length, 2);
    assert.equal(reopened.get(first.id).rationale, "it can silently come back");
  });

  await t.test("it is a file in the team folder, so it travels and can be reviewed in a diff", () => {
    assert.ok(fs.existsSync(path.join(dir, "backlog.json")));
    assert.match(fs.readFileSync(path.join(dir, "backlog.json"), "utf8"), /approval deadlock/);
  });

  await t.test("two agents cannot build the same thing twice", () => {
    b.claim(first.id, "arash");
    assert.throws(() => b.claim(first.id, "sina"), /already being done by arash/);
    assert.equal(b.get(first.id).status, "claimed");
  });

  await t.test("the one who owns it can claim it again without a fuss", () => {
    assert.doesNotThrow(() => b.claim(first.id, "arash"));
  });

  await t.test("finishing records what actually happened", () => {
    b.update(first.id, { status: "done", outcome: "queue-suspend.test.mjs, 9 tests" });
    assert.equal(b.get(first.id).status, "done");
    assert.match(b.get(first.id).outcome, /9 tests/);
    assert.ok(!b.open().some((i) => i.id === first.id), "done work leaves the board");
  });

  await t.test("finished work cannot be picked up again", () => {
    assert.throws(() => b.claim(first.id, "sina"), /already done/);
  });

  await t.test("ranking decides what happens next", () => {
    b.update(second.id, { status: "ready", rank: 1 });
    assert.equal(b.hasReadyWork(), true);
    assert.match(b.summary(), /Wire the workspace watcher/);
  });
});

test("agents are told what they may decide alone", async (t) => {
  const work = tempDir("standbye-auto-");
  const { crew } = makeCrew(t, { workspaceRoot: work });
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const lead = crew.listAgents().find((a) => /lead|maintainer/i.test(a.role)) ?? crew.listAgents()[0];

  await t.test("the default is build-then-open-a-pull-request", () => {
    assert.match(systemPrompt(crew, lead, "full"), new RegExp(AUTONOMY_RULE.pr.slice(0, 40)));
  });

  await t.test("propose-only says plainly not to write code yet", () => {
    crew.updateTeam({ autonomy: "propose" });
    const p = systemPrompt(crew, lead, "full");
    assert.match(p, /do not write code for a backlog item until/);
  });

  await t.test("full autonomy drops that line", () => {
    crew.updateTeam({ autonomy: "auto" });
    const p = systemPrompt(crew, lead, "full");
    assert.ok(!p.includes("do not write code for a backlog item until"));
    assert.match(p, new RegExp(AUTONOMY_RULE.auto.slice(0, 40)));
  });

  await t.test("the lead is told ranking is theirs, and a teammate is not", () => {
    crew.updateTeam({ autonomy: "pr" });
    assert.match(systemPrompt(crew, lead, "full"), /ranking is yours/);
    const other = crew.listAgents().find((a) => a.id !== lead.id);
    if (other) assert.ok(!systemPrompt(crew, other, "full").includes("ranking is yours"));
  });

  await t.test("the board itself rides in the prompt, so nobody has to go and read the file", () => {
    crew.backlog.add({ title: "Ship the release notes", rationale: "nobody knows what changed", addedBy: "user", status: "ready" });
    assert.match(systemPrompt(crew, lead, "full"), /Ship the release notes/);
  });

  await t.test("a check-in stays lean and carries none of it", () => {
    const c = systemPrompt(crew, lead, "checkin");
    assert.ok(!c.includes("Ship the release notes"));
    assert.ok(!c.includes("add_idea"));
  });
});

test("an idle check-in looks for work instead of napping", async (t) => {
  const { crew } = makeCrew(t);
  const agent = crew.listAgents()[0];
  // A real idle check-in is one where nothing is new. Fresh teams carry the "team created"
  // notice, so mark everything seen first, the way a first heartbeat would.
  const idle = () => {
    crew.db.setAgentState(agent.id, { lastSeenMessageAt: new Date(Date.now() + 1000).toISOString() });
    return runPrompt(crew, agent, crew.createRun(agent.id, { kind: "heartbeat" }, "m"));
  };

  await t.test("an empty backlog is a reason to go and find something", () => {
    assert.match(idle(), /backlog is empty.*escalate to go and find what this project needs/is);
  });

  await t.test("ready and unclaimed work is a reason to escalate and take it", () => {
    const item = crew.backlog.add({ title: "Fix the flaky scheduler test", rationale: "it fails on teardown", addedBy: "user", status: "ready" });
    assert.match(idle(), new RegExp(`\\[${item.id}\\] Fix the flaky scheduler test`));
  });

  await t.test("work you already own outranks anything else", () => {
    const mine = crew.backlog.add({ title: "Half-finished refactor", rationale: "started it yesterday", addedBy: agent.id, status: "ready" });
    crew.backlog.claim(mine.id, agent.id);
    assert.match(idle(), /You still own .*Half-finished refactor.*Escalate and finish it/s);
  });

  await t.test("when everything is taken, it says so and stops", () => {
    for (const i of crew.backlog.open()) crew.backlog.update(i.id, { status: "claimed", claimedBy: "someone-else" });
    assert.match(idle(), /nothing for you to start\. Finish\./);
  });
});

test("the backlog travels with the project", async (t) => {
  const dataDir = tempDir("standbye-hub-");
  const project = tempDir("standbye-project-");
  const clone = tempDir("standbye-clone-");
  t.after(() => { for (const d of [dataDir, project, clone]) fs.rmSync(d, { recursive: true, force: true }); });

  const hub = new Hub({ dataDir, port: 0, token: "t" });
  const rt = hub.createTeam(soloDevTeam(PROVIDERS, "Navid", "demo"), { workspaceRoot: project, ownerName: "Navid" });
  rt.crew.backlog.add({ title: "Something worth doing", rationale: "because", addedBy: "mina", status: "ready" });
  hub.stop();

  const teamDir = path.join(project, TEAM_DIR_NAME);
  await t.test("it is not git-ignored — the plan is worth committing", () => {
    const ignore = fs.readFileSync(path.join(teamDir, ".gitignore"), "utf8");
    assert.ok(!/backlog/.test(ignore));
  });

  await t.test("a clone comes up knowing what the team was going to do next", () => {
    for (const f of ["team.json", "agents", "backlog.json", ".gitignore"]) {
      fs.cpSync(path.join(teamDir, f), path.join(clone, TEAM_DIR_NAME, f), { recursive: true });
    }
    const h2 = new Hub({ dataDir: tempDir("standbye-hub2-"), port: 0, token: "t" });
    t.after(() => h2.stop());
    const opened = h2.openFolder(clone);
    assert.equal(opened.crew.backlog.open()[0].title, "Something worth doing");
  });
});
