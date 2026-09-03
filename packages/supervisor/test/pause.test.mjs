// Stopping the team, both ways.
//
// "Pause all" is the emergency stop: everything ends where it stands. "Pause when idle" is the
// everyday one: nothing new starts and the pause lands by itself once the runs already going have
// finished. The tests below hold the queue to three promises — a wind-down starts nothing, it
// finishes on its own, and either kind of pause can be undone without restarting the supervisor.
import test from "node:test";
import assert from "node:assert/strict";
import { Crew } from "../dist/crew.js";
import { Queue } from "../dist/queue.js";
import { makeCrew, waitFor } from "./helpers.mjs";

/** A queue that schedules but never executes: these tests are about policy, not model calls. */
function policyQueue(crew) {
  const queue = new Queue(crew, () => {});
  queue.pump = async () => {};
  return queue;
}

test("pause when idle starts nothing new and pauses itself once nothing is running", async (t) => {
  const { crew } = makeCrew(t);

  await t.test("with nothing running it is simply a pause", () => {
    const q = policyQueue(crew);
    crew.pauseWhenIdle = true;
    assert.equal(q.pauseWhenIdle(), true, "there was nothing to wait for");
    assert.equal(crew.pausedAll, true);
    assert.equal(crew.pauseWhenIdle, false, "the wind-down is over, not still pending");
    crew.pausedAll = false;
  });

  await t.test("queued work is dropped, running work is left to finish", () => {
    const q = policyQueue(crew);
    q.enqueue("kai", { kind: "heartbeat" });
    const queued = q.enqueue("ada", { kind: "heartbeat" });
    // Stand in for a run that is already going: it is the count of things in flight that decides
    // whether the pause has to wait, and the same predicate runs when a real run ends.
    q.active.set("run-in-flight", new AbortController());

    crew.pauseWhenIdle = true;
    assert.equal(q.pauseWhenIdle(), false, "one run is still going, so the pause waits");
    assert.equal(q.pending.length, 0, "nothing that had not started is left queued");
    assert.equal(crew.db.getRun(queued.id).status, "cancelled");
    assert.equal(crew.pausedAll, false, "not paused yet — something is still running");
    assert.equal(crew.status().pausePending, true);

    assert.equal(q.enqueue("kai", { kind: "heartbeat" }), null, "nothing new starts while winding down");
    assert.equal(q.enqueue("kai", { kind: "mention", messageId: "m1", by: "user", depth: 0 }), null, "not even the owner's own wake-up");

    q.active.delete("run-in-flight");
    assert.equal(q.pauseWhenIdle(), true, "the last run finished, so the pause lands");
    assert.equal(crew.pausedAll, true);
    assert.equal(crew.pauseWhenIdle, false);
    crew.pausedAll = false;
  });

  await t.test("an agent with nothing in flight already reads as stopped", () => {
    const q = policyQueue(crew);
    q.active.set("run-in-flight", new AbortController());
    crew.pauseWhenIdle = true;
    const kai = crew.getAgent("kai");
    assert.equal(kai.status, "paused");
    assert.equal(kai.statusText, "Stopping · no new work");
    q.active.delete("run-in-flight");
    crew.pauseWhenIdle = false;
  });
});

test("a wind-down survives a restart, because a half-stopped team must not start itself", (t) => {
  const { crew, dataDir } = makeCrew(t);
  crew.pauseWhenIdle = true;
  assert.equal(crew.team.pauseWhenIdle, true, "it is written to team.json, not held in memory");

  const reopened = new Crew({ dataDir, globalDir: dataDir, keys: {} });
  t.after(() => { try { reopened.close(); } catch { /* already closed */ } });
  assert.equal(reopened.pauseWhenIdle, true);
  assert.equal(reopened.stopping, true);
});

test("a paused team can be resumed; only a shutdown is final", async (t) => {
  const { crew } = makeCrew(t);

  await t.test("pause all, then resume, and the queue takes work again", () => {
    const q = policyQueue(crew);
    crew.pausedAll = true;
    q.cancelAll();
    assert.equal(q.enqueue("kai", { kind: "heartbeat" }), null, "paused means paused");

    crew.pausedAll = false;
    assert.ok(q.enqueue("kai", { kind: "heartbeat" }), "resuming actually resumes");
  });

  await t.test("shutdown is the one that never takes work again", () => {
    const q = policyQueue(crew);
    q.shutdown();
    assert.equal(q.enqueue("kai", { kind: "heartbeat" }), null);
  });
});

test("the pause lands when the last real run ends", async (t) => {
  const { crew } = makeCrew(t);
  const queue = new Queue(crew, () => {});
  t.after(() => queue.shutdown());

  // enqueue → launch is synchronous, so the run is in flight the moment this returns. With no
  // provider key it fails fast, which is all this needs: a run that ends on its own.
  const run = queue.enqueue("kai", { kind: "manual", prompt: "say hello" });
  assert.ok(run);
  assert.equal(queue.inFlight(), 1);

  crew.pauseWhenIdle = true; // the owner asks to stop while that run is going
  assert.equal(crew.pausedAll, false, "the run in flight is not cut off");

  await waitFor(() => (crew.pausedAll ? true : null));
  assert.equal(crew.pauseWhenIdle, false, "the wind-down completed rather than staying pending");
  assert.equal(crew.status().pausedAll, true);
  assert.equal(crew.status().pausePending, false);
});
