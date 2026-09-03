import test from "node:test";
import assert from "node:assert/strict";
import { Queue } from "../dist/queue.js";
import { makeCrew, waitFor } from "./helpers.mjs";

/**
 * The queue decides who wakes, in what order, and what is a pointless duplicate.
 * Those decisions happen synchronously inside `enqueue`, so the tests below stub `pump`
 * (the part that actually starts a run) and read the pending list directly. That keeps
 * the policy under test and keeps model calls out of it entirely.
 *
 * The last test does let a real run through, with no key configured, to prove the wiring.
 */
function policyQueue(crew) {
  const queue = new Queue(crew, () => {});
  queue.pump = async () => {}; // never execute; we are testing scheduling policy
  return queue;
}
const kinds = (queue) => queue.pending.map((r) => `${r.agentId}:${r.trigger.kind}:${r.trigger.by ?? r.trigger.from ?? ""}`);

const ownerMention = (messageId = "m1") => ({ kind: "mention", messageId, by: "user", depth: 0 });
const teamMention = (messageId = "m2", by = "ada") => ({ kind: "mention", messageId, by, depth: 1 });

test("what the owner sends is never left behind", async (t) => {
  const { crew } = makeCrew(t);

  await t.test("an owner wake-up goes to the front of the queue", () => {
    const q = policyQueue(crew);
    q.enqueue("kai", { kind: "question", questionId: "q1", from: "ada" });
    q.enqueue("kai", { kind: "answer", questionId: "q2" });
    q.enqueue("kai", ownerMention());
    assert.equal(q.pending[0].trigger.by, "user", "the owner is served first");
    assert.equal(q.pending.length, 3);
  });

  await t.test("a queued agent-to-agent mention is folded into the owner's newer one", () => {
    const q = policyQueue(crew);
    const stale = q.enqueue("kai", teamMention("m2", "ada"));
    assert.ok(stale);
    const fresh = q.enqueue("kai", ownerMention("m3"));
    assert.ok(fresh, "the owner's message is not swallowed as a duplicate");
    assert.deepEqual(kinds(q), ["kai:mention:user"], "only the owner's wake-up is left");
    const folded = crew.db.getRun(stale.id);
    assert.equal(folded.status, "cancelled");
    assert.match(folded.summary, /Folded into a newer wake-up/);
  });

  await t.test("two owner messages in a row are one wake-up: the run sees both", () => {
    const q = policyQueue(crew);
    assert.ok(q.enqueue("kai", ownerMention("m4")));
    assert.equal(q.enqueue("kai", ownerMention("m5")), null);
    assert.equal(q.pending.filter((r) => r.agentId === "kai").length, 1);
  });

  await t.test("a manual wake-up is treated as the owner's", () => {
    const q = policyQueue(crew);
    q.enqueue("kai", teamMention("m6"));
    q.enqueue("kai", { kind: "manual", prompt: "look at this" });
    assert.equal(q.pending[0].trigger.kind, "manual");
  });
});

test("duplicate wake-ups collapse", async (t) => {
  const { crew } = makeCrew(t);

  await t.test("a second heartbeat while one is queued is dropped", () => {
    const q = policyQueue(crew);
    assert.ok(q.enqueue("kai", { kind: "heartbeat" }));
    assert.equal(q.enqueue("kai", { kind: "heartbeat" }), null);
    assert.equal(q.pending.length, 1);
  });

  await t.test("a heartbeat is pointless while the agent is already busy", () => {
    const q = policyQueue(crew);
    q.busyAgents.add("kai");
    assert.equal(q.enqueue("kai", { kind: "heartbeat" }), null);
  });

  await t.test("a heartbeat is dropped when any other wake-up is already queued", () => {
    const q = policyQueue(crew);
    q.enqueue("kai", { kind: "answer", questionId: "q9" });
    assert.equal(q.enqueue("kai", { kind: "heartbeat" }), null);
  });

  await t.test("a queued heartbeat does not block a real mention", () => {
    const q = policyQueue(crew);
    q.enqueue("kai", { kind: "heartbeat" });
    assert.ok(q.enqueue("kai", ownerMention("m7")), "the owner still gets through");
  });

  await t.test("agent-to-agent mentions collapse onto each other", () => {
    const q = policyQueue(crew);
    assert.ok(q.enqueue("kai", teamMention("m8", "ada")));
    assert.equal(q.enqueue("kai", teamMention("m9", "rex")), null, "one run reads both messages");
  });

  await t.test("questions and answers collapse per kind but not across kinds", () => {
    const q = policyQueue(crew);
    assert.ok(q.enqueue("sol", { kind: "question", questionId: "q1", from: "ada" }));
    assert.equal(q.enqueue("sol", { kind: "question", questionId: "q2", from: "rex" }), null);
    assert.ok(q.enqueue("sol", { kind: "answer", questionId: "q3" }), "a different kind still wakes it");
  });

  await t.test("each agent has its own queue", () => {
    const q = policyQueue(crew);
    assert.ok(q.enqueue("kai", { kind: "heartbeat" }));
    assert.ok(q.enqueue("ada", { kind: "heartbeat" }), "one agent's queue does not silence another");
  });
});

test("paused agents do not wake", async (t) => {
  const { crew } = makeCrew(t);

  await t.test("a paused agent is skipped", () => {
    const q = policyQueue(crew);
    crew.updateAgent("kai", { paused: true });
    assert.equal(q.enqueue("kai", ownerMention()), null);
    crew.updateAgent("kai", { paused: false });
  });

  await t.test("pause all silences the whole team", () => {
    const q = policyQueue(crew);
    crew.pausedAll = true;
    assert.equal(q.enqueue("ada", ownerMention()), null);
    crew.pausedAll = false;
    assert.ok(q.enqueue("ada", ownerMention()));
  });
});

test("cancelling", async (t) => {
  const { crew } = makeCrew(t);

  await t.test("a queued run can be cancelled before it starts", () => {
    const q = policyQueue(crew);
    const run = q.enqueue("kai", { kind: "heartbeat" });
    assert.equal(q.cancel(run.id), true);
    assert.equal(crew.db.getRun(run.id).status, "cancelled");
    assert.equal(q.cancel("nope"), false);
  });

  await t.test("cancelAll clears everything that has not started", () => {
    const q = policyQueue(crew);
    const a = q.enqueue("kai", ownerMention("x1"));
    const b = q.enqueue("ada", ownerMention("x2"));
    q.cancelAll();
    assert.equal(q.pending.length, 0);
    assert.equal(crew.db.getRun(a.id).status, "cancelled");
    assert.equal(crew.db.getRun(b.id).status, "cancelled");
  });
});

test("a real run with no provider key fails fast and leaves the agent usable", async (t) => {
  const { crew } = makeCrew(t);
  const queue = new Queue(crew, () => {});
  t.after(() => queue.cancelAll());

  const run = queue.enqueue("kai", { kind: "manual", prompt: "say hello" });
  assert.ok(run);

  const finished = await waitFor(() => {
    const r = crew.db.getRun(run.id);
    return r && ["failed", "done", "noop", "cancelled", "needs_you"].includes(r.status) ? r : null;
  });

  assert.equal(finished.status, "failed", "no key means the run cannot do anything");
  assert.ok(finished.error && finished.error.length > 0, "the failure says why");
  assert.ok(finished.finishedAt, "the run is closed out, not left hanging");
  assert.equal(crew.getAgent("kai").currentRunId, null, "the agent is released");
  assert.equal(finished.costUsd, 0, "nothing was spent");
});
