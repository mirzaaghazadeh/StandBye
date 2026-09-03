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

/** Spawning and killing a process is not instant, so wait for the count rather than guess at it. */
async function settles(want, why) {
  for (let i = 0; i < 60; i++) {
    if (caffeinates() === want) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(caffeinates(), want, why);
}
const onMac = process.platform === "darwin";

test("the machine is held awake only while there is work in flight", async (t) => {
  const before = caffeinates();
  const k = new KeepAwake();
  t.after(() => k.dispose());

  await t.test("nothing is held while the team is idle", async () => {
    k.set(0);
    await settles(before, "no assertion for an idle team");
  });

  await t.test("a run in flight holds one", async () => {
    k.set(1);
    await settles(before + (onMac ? 1 : 0), "a run in flight holds one");
  });

  await t.test("more runs do not stack more of them", async () => {
    k.set(3);
    await settles(before + (onMac ? 1 : 0), "one is enough");
  });

  await t.test("it is let go the moment the last run ends", async () => {
    k.set(0);
    await settles(before, "the Mac may sleep again");
  });

  await t.test("the owner can switch it off, and it is honoured without a restart", async () => {
    let allowed = true;
    const off = new KeepAwake(() => allowed);
    t.after(() => off.dispose());
    off.set(1);
    await settles(before + (onMac ? 1 : 0), "held while allowed");
    allowed = false;
    off.set(2);            // still working, but no longer permitted
    await settles(before, "it lets go when the setting says no");
    off.dispose();
  });

  await t.test("dispose never leaves one behind holding the machine awake for nobody", async () => {
    k.set(2);
    await settles(before + (onMac ? 1 : 0), "held while working");
    k.dispose();
    await settles(before, "and let go on shutdown");
  });
});
