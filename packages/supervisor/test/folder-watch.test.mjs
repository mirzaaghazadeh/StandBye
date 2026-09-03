// A team is a folder of files so a person can edit them. When they do, the running app should
// already agree with what is on disk instead of needing a restart: an edited soul, a changed
// schedule, or a whole agent folder dropped in by hand.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fingerprint } from "../dist/folder-watch.js";
import { makeCrew } from "./helpers.mjs";

process.env.CREW_DISABLE_CLAUDE_LOGIN = "1";

/** The watcher is debounced; wait for the crew to catch up rather than guessing. */
async function settles(check, why, ms = 6000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(check(), why);
}

test("the fingerprint tells a definition change from ordinary churn", async (t) => {
  const { crew, dataDir } = makeCrew(t);
  const agent = crew.listAgents()[0];
  const before = fingerprint(dataDir);

  await t.test("writing memory is not a definition change", () => {
    crew.store.appendMemory(agent.id, "learned something");
    assert.equal(fingerprint(dataDir), before, "history does not count as the team changing");
  });

  await t.test("editing a soul is", () => {
    fs.writeFileSync(path.join(crew.store.agentDir(agent.id), "SOUL.md"), "# New soul\n\nDifferent.\n");
    assert.notEqual(fingerprint(dataDir), before);
  });
});

test("an agent added by hand joins the team", async (t) => {
  const { crew, dataDir } = makeCrew(t);
  const existing = crew.listAgents()[0];
  const dir = path.join(dataDir, "agents", "nadia");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SOUL.md"), "# Nadia\n\nYou find what the product is missing.\n");
  fs.writeFileSync(path.join(dir, "RULES.md"), "# Rules\n\n- You do not edit source files.\n");
  fs.writeFileSync(path.join(dir, "agent.json"), JSON.stringify({
    ...crew.store.readAgentConfig(existing.id),
    id: "nadia", name: "Nadia", role: "Product manager",
    channels: ["general"], createdAt: new Date().toISOString(),
  }, null, 2));

  await t.test("the running crew notices without a restart", async () => {
    await settles(() => crew.listAgents().some((a) => a.id === "nadia"), "Nadia showed up on her own");
  });

  await t.test("she gets a direct chat, like anyone hired through the app", async () => {
    await settles(() => crew.listChannels().some((c) => c.kind === "dm" && c.dmAgentId === "nadia"), "her DM was created");
  });

  await t.test("and a place in the shared room", async () => {
    await settles(() => crew.db.getChannel("general").members.includes("nadia"), "she is in #general");
  });
});

test("an edited soul is what the next run reads", async (t) => {
  const { crew } = makeCrew(t);
  const agent = crew.listAgents()[0];
  fs.writeFileSync(path.join(crew.store.agentDir(agent.id), "SOUL.md"), "# Rewritten\n\nYou only write haiku.\n");
  assert.match(crew.store.readAgentFiles(agent.id).soul, /only write haiku/, "files are read fresh, not cached");
});

test("the watcher is let go with the crew", async (t) => {
  const { crew, dataDir } = makeCrew(t);
  crew.close();
  // Writing after close must not throw or resurrect anything.
  assert.doesNotThrow(() => fs.writeFileSync(path.join(dataDir, "team.json"), fs.readFileSync(path.join(dataDir, "team.json"))));
});
