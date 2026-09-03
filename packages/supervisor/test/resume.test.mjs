// A restart used to throw away everything a run had done: an agent ninety steps into a change
// began the next one knowing none of it had happened. The work is on disk — only the
// conversation was lost — so the run is picked up again and told what it got through.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeCrew, tempDir } from "./helpers.mjs";
import { Crew } from "../dist/crew.js";
import { Scheduler } from "../dist/scheduler.js";
import { runPrompt } from "../dist/prompt.js";

process.env.CREW_DISABLE_CLAUDE_LOGIN = "1";

test("a run cut off by a restart is picked up again", async (t) => {
  const { crew, dataDir } = makeCrew(t);
  const agent = crew.listAgents()[0];
  const run = crew.createRun(agent.id, { kind: "task", title: "Wire the watcher", details: "sources.ts", from: "user" }, "m");
  crew.updateRun(run, { status: "running" });
  crew.addStep(run.id, "read", "packages/supervisor/src/events/sources.ts");
  crew.addStep(run.id, "edit", "packages/supervisor/src/scheduler.ts");
  crew.addStep(run.id, "run", "pnpm test");
  crew.close();

  const reopened = new Crew({ dataDir, globalDir: dataDir, keys: {} });
  t.after(() => { try { reopened.close(); } catch { /* closed */ } });

  await t.test("the interrupted run is handed over, not silently dropped", () => {
    assert.equal(reopened.interrupted.length, 1);
    assert.equal(reopened.interrupted[0].id, run.id);
  });

  await t.test("its error says it was picked up, not that it failed on its own", () => {
    assert.match(reopened.db.getRun(run.id).error, /picked up again in a new run/);
  });

  const sched = new Scheduler(reopened);
  t.after(() => sched.stop());
  sched.start();

  await t.test("the scheduler queues a resumed run for that agent", () => {
    const resumed = reopened.db.listRuns({ agentId: agent.id, limit: 5 }).find((r) => r.trigger.kind === "resumed");
    assert.ok(resumed, "a resumed run was queued");
    assert.equal(resumed.trigger.runId, run.id);
    assert.equal(resumed.trigger.was.kind, "task", "it remembers what it had been asked to do");
  });

  await t.test("the agent is told what the last attempt got through", () => {
    const resumed = reopened.db.listRuns({ agentId: agent.id, limit: 5 }).find((r) => r.trigger.kind === "resumed");
    const p = runPrompt(reopened, reopened.getAgent(agent.id), resumed);
    assert.match(p, /You were part-way through this when the app stopped/);
    assert.match(p, /Wire the watcher/, "the original task is restated");
    assert.match(p, /sources\.ts/, "and what it had read");
    assert.match(p, /edit: packages\/supervisor\/src\/scheduler\.ts/, "and what it had edited");
    assert.match(p, /do not start the same change again/);
  });

  await t.test("it is told the tree was not rolled back", () => {
    const resumed = reopened.db.listRuns({ agentId: agent.id, limit: 5 }).find((r) => r.trigger.kind === "resumed");
    assert.match(runPrompt(reopened, reopened.getAgent(agent.id), resumed), /Nothing was rolled back/);
  });
});

test("nothing is resumed when there is nothing to resume", async (t) => {
  const { crew, dataDir } = makeCrew(t);
  crew.close();
  const reopened = new Crew({ dataDir, globalDir: dataDir, keys: {} });
  t.after(() => { try { reopened.close(); } catch { /* closed */ } });
  assert.deepEqual(reopened.interrupted, []);
});

test("a paused agent's interrupted run is left alone", async (t) => {
  const { crew, dataDir } = makeCrew(t);
  const agent = crew.listAgents()[0];
  const run = crew.createRun(agent.id, { kind: "heartbeat" }, "m");
  crew.updateRun(run, { status: "running" });
  crew.updateAgent(agent.id, { paused: true });
  crew.close();

  const reopened = new Crew({ dataDir, globalDir: dataDir, keys: {} });
  t.after(() => { try { reopened.close(); } catch { /* closed */ } });
  const sched = new Scheduler(reopened);
  t.after(() => sched.stop());
  sched.start();
  assert.ok(!reopened.db.listRuns({ agentId: agent.id, limit: 5 }).some((r) => r.trigger.kind === "resumed"), "a paused agent stays stopped");
});
