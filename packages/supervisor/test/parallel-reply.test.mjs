// Being spoken to is not work. The owner writing in a direct chat used to queue behind whatever
// the agent was doing — "waiting for a free slot" under a message that only needed an answer —
// so a busy agent looked like it was ignoring you.
import test from "node:test";
import assert from "node:assert/strict";
import { Queue } from "../dist/queue.js";
import { makeCrew } from "./helpers.mjs";

process.env.CREW_DISABLE_CLAUDE_LOGIN = "1";

/** Put a run in flight without letting it actually reach a model. */
function occupy(q, crew, agentId) {
  const run = crew.createRun(agentId, { kind: "task", title: "long job", details: "…", from: "user" }, "m");
  crew.updateRun(run, { status: "running" });
  q.active.set(run.id, new AbortController());
  q.busyAgents.add(agentId);
  return run;
}

function dm(crew, agentId, text) {
  const channel = crew.listChannels().find((c) => c.kind === "dm" && c.dmAgentId === agentId);
  return crew.postMessage({ channel: channel.id, authorId: "user", text, kind: "chat", mentions: [agentId] });
}

test("a direct message is answered while the agent is still working", async (t) => {
  const { crew } = makeCrew(t);
  const agent = crew.listAgents()[0];
  const q = new Queue(crew, () => {});
  t.after(() => q.cancelAll());

  const working = occupy(q, crew, agent.id);
  const msg = dm(crew, agent.id, "quick question");

  await t.test("the reply is not left queued behind the work", () => {
    const reply = crew.createRun(agent.id, { kind: "mention", messageId: msg.id, by: "user", depth: 0 }, "m");
    assert.equal(q.canReplyWhileBusy(reply), true, "it may run alongside");
  });

  await t.test("but a second message does not open a second lane", () => {
    const another = dm(crew, agent.id, "and another thing");
    const first = crew.createRun(agent.id, { kind: "mention", messageId: msg.id, by: "user", depth: 0 }, "m");
    q.active.set(first.id, new AbortController());
    crew.updateRun(first, { status: "running" });
    const second = crew.createRun(agent.id, { kind: "mention", messageId: another.id, by: "user", depth: 0 }, "m");
    assert.equal(q.canReplyWhileBusy(second), false, "one conversation at a time");
  });

  await t.test("the agent still counts as busy, so nothing else wakes them", () => {
    assert.equal(q.isBusy(agent.id), true);
  });

  await t.test("the work run is untouched", () => {
    assert.equal(crew.db.getRun(working.id).status, "running");
  });
});

test("only a direct chat gets the parallel lane", async (t) => {
  const { crew } = makeCrew(t);
  const agent = crew.listAgents()[0];
  const q = new Queue(crew, () => {});
  t.after(() => q.cancelAll());
  occupy(q, crew, agent.id);

  await t.test("a mention in a group channel waits its turn — that is work", () => {
    const m = crew.postMessage({ channel: "general", authorId: "user", text: `@${agent.name} ship it`, kind: "chat", mentions: [agent.id] });
    const run = crew.createRun(agent.id, { kind: "mention", messageId: m.id, by: "user", depth: 0 }, "m");
    assert.equal(q.canReplyWhileBusy(run), false);
  });

  await t.test("a teammate's direct message is not the owner's, and waits", () => {
    const channel = crew.listChannels().find((c) => c.kind === "dm" && c.dmAgentId === agent.id);
    const m = crew.postMessage({ channel: channel.id, authorId: "someone", text: "hi", kind: "chat", mentions: [agent.id] });
    const run = crew.createRun(agent.id, { kind: "mention", messageId: m.id, by: "someone", depth: 0 }, "m");
    assert.equal(q.canReplyWhileBusy(run), false);
  });

  await t.test("a check-in waits too", () => {
    const run = crew.createRun(agent.id, { kind: "heartbeat" }, "m");
    assert.equal(q.canReplyWhileBusy(run), false);
  });
});

test("being answered never waits on the team's work capacity", async (t) => {
  // Three long runs used to fill every slot, so a "hello" in a direct chat sat queued with
  // nothing to show for it. A reply runs above the cap.
  const { crew } = makeCrew(t);
  const agents = crew.listAgents();
  const q = new Queue(crew, () => {});
  t.after(() => q.cancelAll());

  // Saturate the machine the way a restart that resumed three runs does.
  for (const a of agents.slice(0, 3)) occupy(q, crew, a.id);

  await t.test("the cap really is full", () => {
    assert.equal(q.active.size, 3);
    assert.equal(q.active.size - q.directRepliesRunning(), 3, "all three are work");
  });

  await t.test("a fourth agent's direct reply still gets to run", () => {
    const idle = agents.find((a) => !q.busyAgents.has(a.id));
    assert.ok(idle, "there is an agent not already working");
    const channel = crew.listChannels().find((c) => c.kind === "dm" && c.dmAgentId === idle.id);
    const m = crew.postMessage({ channel: channel.id, authorId: "user", text: "hello?", kind: "chat", mentions: [idle.id] });
    const run = crew.createRun(idle.id, { kind: "mention", messageId: m.id, by: "user", depth: 0 }, "m");
    assert.equal(q.canReplyWhileBusy(run), true, "not blocked by its own agent");
    q.launch(run, false);
    assert.ok(q.active.has(run.id), "it started despite the cap being full");
  });

  await t.test("but replies are bounded too, so a burst is not a crowd", () => {
    assert.ok(q.directRepliesRunning() <= 2, "at most two conversations at once");
  });
});
