import test from "node:test";
import assert from "node:assert/strict";
import { makeCrew } from "./helpers.mjs";

test("creating a channel", async (t) => {
  const { crew } = makeCrew(t);

  await t.test("a display name becomes a safe id, and members join it", () => {
    const c = crew.ensureChannel("Frontend Work", "The UI", ["kai", "rex"]);
    assert.equal(c.id, "frontend-work");
    assert.equal(c.name, "frontend-work");
    assert.equal(c.purpose, "The UI");
    assert.equal(c.kind, "group");
    assert.equal(c.dmAgentId, null);
    assert.ok(crew.getAgent("kai").channels.includes("frontend-work"), "the agent's own channel list follows");
    assert.ok(crew.getAgent("rex").channels.includes("frontend-work"));
    assert.ok(!crew.getAgent("ada").channels.includes("frontend-work"), "non-members are untouched");
  });

  await t.test("a leading # and odd characters are cleaned up", () => {
    assert.equal(crew.ensureChannel("#Design/Review!").id, "design-review");
  });

  await t.test("creating the same channel twice returns the existing one", () => {
    const first = crew.ensureChannel("dupe", "first", ["kai"]);
    const second = crew.ensureChannel("dupe", "second", []);
    assert.equal(second.id, first.id);
    assert.equal(second.purpose, "first", "the existing channel is not overwritten");
  });

  await t.test("a name that would collide with a direct chat is refused", () => {
    assert.throws(() => crew.ensureChannel("dm-kai"), /another channel name/);
    assert.throws(() => crew.ensureChannel("!!!"), /another channel name/);
  });
});

test("editing a channel", async (t) => {
  const { crew } = makeCrew(t);
  crew.ensureChannel("frontend", "UI", ["kai"]);

  await t.test("adding a member updates that agent", () => {
    crew.updateChannel("frontend", { members: ["kai", "sol"] });
    assert.ok(crew.getAgent("sol").channels.includes("frontend"));
    assert.ok(crew.getAgent("kai").channels.includes("frontend"));
  });

  await t.test("removing a member takes the channel off their list", () => {
    crew.updateChannel("frontend", { members: ["sol"] });
    assert.ok(!crew.getAgent("kai").channels.includes("frontend"));
    assert.ok(crew.getAgent("sol").channels.includes("frontend"));
  });

  await t.test("the purpose can change without touching membership", () => {
    const c = crew.updateChannel("frontend", { purpose: "Everything the user sees" });
    assert.equal(c.purpose, "Everything the user sees");
    assert.deepEqual(c.members, ["sol"]);
  });

  await t.test("a direct chat or a missing channel cannot be edited", () => {
    assert.throws(() => crew.updateChannel("dm-kai", { purpose: "x" }), /Unknown channel/);
    assert.throws(() => crew.updateChannel("ghost", { purpose: "x" }), /Unknown channel/);
  });
});

test("deleting a channel", async (t) => {
  const { crew } = makeCrew(t);
  crew.ensureChannel("temporary", "", ["kai", "ada"]);

  await t.test("the channel goes and every agent forgets it", () => {
    crew.deleteChannel("temporary");
    assert.ok(!crew.listChannels().some((c) => c.id === "temporary"));
    assert.ok(!crew.getAgent("kai").channels.includes("temporary"));
    assert.ok(!crew.getAgent("ada").channels.includes("temporary"));
  });

  await t.test("general and direct chats are protected", () => {
    assert.throws(() => crew.deleteChannel("general"), /can't be deleted/);
    assert.throws(() => crew.deleteChannel("dm-kai"), /can't be deleted/);
    assert.throws(() => crew.deleteChannel("nope"), /can't be deleted/);
    assert.ok(crew.listChannels().some((c) => c.id === "general"));
    assert.ok(crew.listChannels().some((c) => c.id === "dm-kai"));
  });
});

test("direct chats are created for agents that predate them", async (t) => {
  const { crew, dataDir } = makeCrew(t);
  // Simulate an older team: drop the DM row, keep the agent.
  crew.db.deleteChannel("dm-sol");
  crew.updateAgent("sol", { channels: ["general"] });
  assert.ok(!crew.listChannels().some((c) => c.id === "dm-sol"));
  crew.close();

  const { Crew } = await import("../dist/crew.js");
  const reopened = new Crew({ dataDir, globalDir: dataDir, keys: {} });
  t.after(() => { try { reopened.close(); } catch { /* ignore */ } });

  const dm = reopened.listChannels().find((c) => c.id === "dm-sol");
  assert.ok(dm, "the direct chat is restored on boot");
  assert.equal(dm.kind, "dm");
  assert.equal(dm.dmAgentId, "sol");
  assert.ok(reopened.getAgent("sol").channels.includes("dm-sol"));
});
