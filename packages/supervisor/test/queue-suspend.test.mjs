// The bug the maintainer team was asked to fix: a run waiting on an owner answer kept its
// concurrency slot, so with maxConcurrentRuns=3 three waiting approvals stalled the whole team.
import test from "node:test";
import assert from "node:assert/strict";
import { Queue } from "../dist/queue.js";
import { DEFAULTS } from "../dist/config.js";
import { makeCrew } from "./helpers.mjs";

test("a run waiting on the owner does not hold a slot", async (t) => {
  const { crew } = makeCrew(t);
  const agents = crew.listAgents();
  const q = new Queue(crew, () => {});

  await t.test("the bridge is what the queue exposes to a blocked run", () => {
    assert.equal(typeof q.suspendSlot, "function");
    assert.equal(typeof q.resumeSlot, "function");
  });

  await t.test("suspending a run that is not running is a no-op, not a crash", () => {
    assert.doesNotThrow(() => q.suspendSlot("no-such-run"));
  });

  await t.test("resuming a run that was never parked resolves rather than hanging", async () => {
    await assert.doesNotReject(() => q.resumeSlot("no-such-run"));
  });

  await t.test("the crew exposes the bridge the scheduler wires in", () => {
    assert.equal(typeof crew.setSlotBridge, "function");
    assert.equal(typeof crew.waitOnOwner, "function");
  });

  await t.test("without a bridge, waiting still works (older teams keep running)", async () => {
    crew.setSlotBridge(null);
    const a = agents[0];
    const qn = crew.askQuestion({ kind: "approval", fromAgentId: a.id, toId: "user", channel: null, title: "ok?", body: "" });
    const waited = crew.waitOnOwner(qn.id, "run-x", 60);
    crew.answerQuestion(qn.id, "yes", "user");
    await assert.doesNotReject(() => waited);
  });

  await t.test("with a bridge, a blocked run parks and unparks around the wait", async () => {
    const seen = [];
    crew.setSlotBridge({ suspend: (id) => seen.push(`suspend:${id}`), resume: async (id) => { seen.push(`resume:${id}`); } });
    const a = agents[0];
    const qn = crew.askQuestion({ kind: "approval", fromAgentId: a.id, toId: "user", channel: null, title: "ok?", body: "" });
    const waited = crew.waitOnOwner(qn.id, "run-y", 2000);
    crew.answerQuestion(qn.id, "yes", "user");
    await waited;
    assert.deepEqual(seen, ["suspend:run-y", "resume:run-y"], "parks before waiting, and always takes its slot back");
  });

  await t.test("the slot is given back even when the wait times out", async () => {
    const seen = [];
    crew.setSlotBridge({ suspend: (id) => seen.push(`suspend:${id}`), resume: async (id) => { seen.push(`resume:${id}`); } });
    const a = agents[0];
    const qn = crew.askQuestion({ kind: "approval", fromAgentId: a.id, toId: "user", channel: null, title: "no answer coming", body: "" });
    await crew.waitOnOwner(qn.id, "run-z", 50).catch(() => {});
    assert.deepEqual(seen, ["suspend:run-z", "resume:run-z"], "a timeout must not leak the slot");
  });

  await t.test("the cap itself is what made this matter", () => {
    assert.ok(DEFAULTS.maxConcurrentRuns >= 1);
  });
});
