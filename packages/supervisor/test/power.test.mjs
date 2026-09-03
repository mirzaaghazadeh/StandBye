// A sleeping Mac is a team that is not working. This machine slept a minute after the owner
// stopped touching it, so locking the screen froze every agent mid-run — and a frozen run came
// back as "restarted while active" with its work thrown away.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { KeepAwake } from "../dist/power.js";

const caffeinates = () => {
  try { return execFileSync("pgrep", ["-f", "caffeinate -i -m"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).length; }
  catch { return 0; }
};

test("the machine is held awake only while there is work in flight", async (t) => {
  const before = caffeinates();
  const k = new KeepAwake();
  t.after(() => k.dispose());

  await t.test("nothing is held while the team is idle", () => {
    k.set(0);
    assert.equal(caffeinates(), before, "no assertion for an idle team");
  });

  await t.test("a run in flight holds one", async () => {
    k.set(1);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(caffeinates(), before + (process.platform === "darwin" ? 1 : 0));
  });

  await t.test("more runs do not stack more of them", async () => {
    k.set(3);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(caffeinates(), before + (process.platform === "darwin" ? 1 : 0), "one is enough");
  });

  await t.test("it is let go the moment the last run ends", async () => {
    k.set(0);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(caffeinates(), before, "the Mac may sleep again");
  });

  await t.test("dispose never leaves one behind holding the machine awake for nobody", async () => {
    k.set(2);
    await new Promise((r) => setTimeout(r, 200));
    k.dispose();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(caffeinates(), before);
  });
});
