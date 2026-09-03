// The owner speaking to the room and nobody answering is the app looking broken. Agents need an @
// so a passing remark does not wake the team, but that rule was applied to the owner too: "hi guys"
// in #general reached everyone and woke no one.
import test from "node:test";
import assert from "node:assert/strict";
import { makeCrew } from "./helpers.mjs";
import { Scheduler } from "../dist/scheduler.js";

process.env.CREW_DISABLE_CLAUDE_LOGIN = "1";

const wokeFor = (crew, messageId) =>
  crew.db.listRuns({ limit: 20 }).filter((r) => r.trigger.kind === "mention" && r.trigger.messageId === messageId);

test("someone answers the owner in a shared channel", async (t) => {
  const { crew } = makeCrew(t);
  const sched = new Scheduler(crew);
  t.after(() => sched.stop());
  const lead = crew.listAgents().find((a) => /lead|maintainer/i.test(a.role)) ?? crew.listAgents()[0];

  await t.test("an unaddressed message still wakes someone", () => {
    const m = crew.postMessage({ channel: "general", authorId: "user", text: "hi guys", kind: "chat", mentions: [] });
    const woke = wokeFor(crew, m.id);
    assert.equal(woke.length, 1, "exactly one agent picks it up, not the whole room");
  });

  await t.test("it is the lead, so it lands with whoever can delegate", () => {
    const m = crew.postMessage({ channel: "general", authorId: "user", text: "how is it going?", kind: "chat", mentions: [] });
    assert.equal(wokeFor(crew, m.id)[0].agentId, lead.id);
  });

  await t.test("an addressed message still goes to who it names, and nobody else", () => {
    const other = crew.listAgents().find((a) => a.id !== lead.id);
    if (!other) return;
    const m = crew.postMessage({ channel: "general", authorId: "user", text: `@${other.name} take a look`, kind: "chat", mentions: [other.id] });
    const woke = wokeFor(crew, m.id);
    assert.equal(woke.length, 1);
    assert.equal(woke[0].agentId, other.id);
  });

  await t.test("an agent talking to the room does not wake anyone by accident", () => {
    const m = crew.postMessage({ channel: "general", authorId: lead.id, text: "pushed it", kind: "chat", mentions: [] });
    assert.equal(wokeFor(crew, m.id).length, 0, "only the owner gets an answerer");
  });
});

test("a hand-off does not fail on a channel that no longer exists", async (t) => {
  const { crew } = makeCrew(t);
  const agents = crew.listAgents();
  // The state the live team was in: agent.json names a room that is not there.
  for (const a of agents) {
    const cfg = crew.store.readAgentConfig(a.id);
    crew.store.writeAgentConfig({ ...cfg, channels: [...cfg.channels, "dev"] });
  }

  await t.test("the stale name is removed when the team is read", () => {
    crew.reloadFromDisk();
    for (const a of crew.listAgents()) {
      assert.ok(!crew.store.readAgentConfig(a.id).channels.includes("dev"), `${a.name} no longer lists a channel that is gone`);
    }
  });

  await t.test("and posting to the room that is left still works", () => {
    assert.doesNotThrow(() => crew.postMessage({ channel: "general", authorId: agents[0].id, text: "handing over", kind: "chat", mentions: [] }));
  });
});
