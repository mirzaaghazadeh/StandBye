import test from "node:test";
import assert from "node:assert/strict";
import { makeCrew } from "./helpers.mjs";

function notifyEvents(crew) {
  const seen = [];
  crew.bus.on("notify", (data) => seen.push(data));
  return seen;
}

test("a terminal run failure notifies the owner", (t) => {
  const { crew } = makeCrew(t);
  const seen = notifyEvents(crew);
  const agent = crew.listAgents()[0];

  const run = crew.createRun(agent.id, { kind: "heartbeat" }, "test-model");
  const finished = crew.finishRun(run, "failed", "OpenRouter key rejected — set a valid key with providers.set");

  assert.equal(finished.status, "failed");
  assert.equal(seen.length, 1, "exactly one notify");
  assert.equal(seen[0].title, `${agent.name} run failed`);
  assert.match(seen[0].body, /OpenRouter key rejected/);
  assert.equal(seen[0].runId, finished.id, "runId rides along for the desktop deep-link");
});

test("repeat failures for the same agent are deduped to one notify per hour", (t) => {
  const { crew } = makeCrew(t);
  const seen = notifyEvents(crew);
  const agent = crew.listAgents()[0];

  const first = crew.createRun(agent.id, { kind: "heartbeat" }, "test-model");
  const firstDone = crew.finishRun(first, "failed", "credits exhausted");
  const second = crew.createRun(agent.id, { kind: "heartbeat" }, "test-model");
  const secondDone = crew.finishRun(second, "failed", "credits exhausted again");

  assert.equal(seen.length, 1, "second failure within the hour is silent");
  assert.equal(secondDone.status, "failed", "the run itself is still recorded");
});

test("failures from different agents each notify", (t) => {
  const { crew } = makeCrew(t);
  const seen = notifyEvents(crew);
  const [a, b] = crew.listAgents();

  crew.finishRun(crew.createRun(a.id, { kind: "heartbeat" }, "test-model"), "failed", "boom");
  crew.finishRun(crew.createRun(b.id, { kind: "heartbeat" }, "test-model"), "failed", "bang");

  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map((n) => n.title).sort(), [`${a.name} run failed`, `${b.name} run failed`].sort());
});

test("finished and cancelled runs do not notify", (t) => {
  const { crew } = makeCrew(t);
  const seen = notifyEvents(crew);
  const agent = crew.listAgents()[0];

  crew.finishRun(crew.createRun(agent.id, { kind: "heartbeat" }, "test-model"), "done", "shipped it");
  crew.finishRun(crew.createRun(agent.id, { kind: "heartbeat" }, "test-model"), "cancelled", "owner stopped it");

  assert.equal(seen.length, 0);
});
