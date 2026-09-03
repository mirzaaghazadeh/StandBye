// A sleeping Mac is a team that is not working: this machine sleeps a minute after the owner stops
// touching it, so locking the screen froze every agent mid-run.
//
// This asserts on the object's own state rather than counting `caffeinate` processes on the
// machine. Counting them was a mistake: a real supervisor running alongside the suite holds one
// too, so every assertion waited out its timeout and the whole suite hung for three minutes.
import test from "node:test";
import assert from "node:assert/strict";
import { KeepAwake } from "../dist/power.js";

const onMac = process.platform === "darwin";

test("the machine is held awake only while there is work in flight", async (t) => {
  const k = new KeepAwake();
  t.after(() => k.dispose());

  await t.test("nothing is held while the team is idle", () => {
    k.set(0);
    assert.equal(k.holding, false);
  });

  await t.test("a run in flight holds it", () => {
    k.set(1);
    assert.equal(k.holding, onMac, onMac ? "held on macOS" : "nothing to hold elsewhere");
  });

  await t.test("more runs do not stack more of them", () => {
    k.set(3);
    assert.equal(k.holding, onMac);
  });

  await t.test("it is let go the moment the last run ends", () => {
    k.set(0);
    assert.equal(k.holding, false);
  });

  await t.test("dispose leaves nothing behind", () => {
    k.set(2);
    k.dispose();
    assert.equal(k.holding, false);
  });
});

test("the owner can switch it off, and it is honoured without a restart", async (t) => {
  let allowed = true;
  const k = new KeepAwake(() => allowed);
  t.after(() => k.dispose());

  k.set(1);
  assert.equal(k.holding, onMac, "held while allowed");

  allowed = false;
  k.set(2); // still working, but no longer permitted
  assert.equal(k.holding, false, "it lets go when the setting says no");

  allowed = true;
  k.set(1);
  assert.equal(k.holding, onMac, "and takes it back when allowed again");
});

test("a real process is what backs it", { skip: !onMac }, async (t) => {
  // One narrow check that this is not just a boolean: the child is spawned and reaped.
  const k = new KeepAwake();
  t.after(() => k.dispose());
  k.set(1);
  assert.equal(k.holding, true);
  k.dispose();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(k.holding, false, "the child is gone, not merely forgotten");
});
