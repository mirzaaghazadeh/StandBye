// The chatter ceiling: money is capped by budgets, churn is capped by runs per hour.
import test from "node:test";
import assert from "node:assert/strict";
import { makeCrew } from "./helpers.mjs";
import { DEFAULTS } from "../dist/config.js";

/** Backdate nothing: insert finished runs "now" so they land inside the rolling hour. */
function fakeRuns(crew, agentId, n) {
  for (let i = 0; i < n; i++) {
    const run = crew.createRun(agentId, { kind: "mention", messageId: `m${i}`, by: "ada", depth: 1 }, "test-model");
    crew.finishRun(run, "done", "chatter");
  }
}

test("an agent that keeps being woken by teammates is throttled", async (t) => {
  const { crew } = makeCrew(t);

  await t.test("under the ceiling it may run", () => {
    fakeRuns(crew, "kai", DEFAULTS.maxRunsPerHour - 1);
    assert.equal(crew.budgetAllows("kai").ok, true);
  });

  await t.test("at the ceiling a teammate can no longer wake it", () => {
    fakeRuns(crew, "kai", 1);
    const v = crew.budgetAllows("kai");
    assert.equal(v.ok, false);
    assert.match(v.reason, /woken \d+ times this hour/);
  });

  await t.test("the owner is never refused", () => {
    assert.equal(crew.budgetAllows("kai", true).ok, true, "a direct instruction overrides the ceiling");
  });

  await t.test("other agents are unaffected", () => {
    assert.equal(crew.budgetAllows("rex").ok, true);
  });

  await t.test("cancelled runs do not count towards it", () => {
    const { crew: c2 } = makeCrew(t);
    for (let i = 0; i < DEFAULTS.maxRunsPerHour + 5; i++) {
      const run = c2.createRun("kai", { kind: "heartbeat" }, "m");
      c2.finishRun(run, "cancelled", "paused");
    }
    assert.equal(c2.budgetAllows("kai").ok, true, "runs that never happened should not throttle anyone");
  });
});
