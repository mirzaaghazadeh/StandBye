import test from "node:test";
import assert from "node:assert/strict";
import { Scheduler } from "../dist/scheduler.js";
import { at, makeCrew } from "./helpers.mjs";

/**
 * Heartbeat timing decides when an idle agent costs anything, so it is worth pinning down.
 * `nextHeartbeat` is called directly with an explicit `now`, which keeps these tests off the
 * wall clock. The scheduler is never `start()`ed, so no timers and no runs.
 */
function scheduler(crew) {
  return new Scheduler(crew);
}
const minutesBetween = (a, b) => (b.getTime() - a.getTime()) / 60_000;

test("heartbeat spacing", async (t) => {
  const { crew } = makeCrew(t);
  const s = scheduler(crew);

  await t.test("a fresh agent checks in a minute after boot, not immediately", () => {
    const now = at(2026, 9, 3, 10, 0);
    const next = s.nextHeartbeat(crew.getAgent("kai"), now);
    assert.equal(minutesBetween(now, next), 1);
  });

  await t.test("after a check-in the next one is a full interval later", () => {
    crew.updateAgent("kai", { heartbeat: { everyMinutes: 30, workHours: { start: "08:00", end: "22:00" } } });
    const last = at(2026, 9, 3, 10, 0);
    crew.db.setAgentState("kai", { lastHeartbeatAt: last.toISOString() });
    const next = s.nextHeartbeat(crew.getAgent("kai"), at(2026, 9, 3, 10, 5));
    assert.equal(minutesBetween(last, next), 30);
  });

  await t.test("a check-in that is already overdue is due now, not in the past", () => {
    const last = at(2026, 9, 3, 10, 0);
    crew.db.setAgentState("kai", { lastHeartbeatAt: last.toISOString() });
    const now = at(2026, 9, 3, 11, 0);
    assert.equal(s.nextHeartbeat(crew.getAgent("kai"), now).getTime(), now.getTime());
  });

  await t.test("the interval has a five minute floor", () => {
    crew.updateAgent("kai", { heartbeat: { everyMinutes: 1, workHours: null } });
    const last = at(2026, 9, 3, 10, 0);
    crew.db.setAgentState("kai", { lastHeartbeatAt: last.toISOString() });
    assert.equal(minutesBetween(last, s.nextHeartbeat(crew.getAgent("kai"), at(2026, 9, 3, 10, 1))), 5);
  });

  await t.test("a paused agent has no next check-in at all", () => {
    crew.updateAgent("kai", { paused: true });
    assert.equal(s.nextHeartbeat(crew.getAgent("kai"), at(2026, 9, 3, 10, 0)), null);
    crew.updateAgent("kai", { paused: false });
  });
});

test("work hours", async (t) => {
  const { crew } = makeCrew(t);
  const s = scheduler(crew);
  const hours = { start: "08:00", end: "22:00" };

  await t.test("inside work hours the check-in stands", () => {
    crew.updateAgent("ada", { heartbeat: { everyMinutes: 30, workHours: hours } });
    const last = at(2026, 9, 3, 14, 0);
    crew.db.setAgentState("ada", { lastHeartbeatAt: last.toISOString() });
    const next = s.nextHeartbeat(crew.getAgent("ada"), at(2026, 9, 3, 14, 5));
    assert.equal(next.getHours(), 14);
    assert.equal(next.getMinutes(), 30);
    assert.equal(next.getDate(), 3);
  });

  await t.test("late at night the agent sleeps until the morning", () => {
    const last = at(2026, 9, 3, 22, 30);
    crew.db.setAgentState("ada", { lastHeartbeatAt: last.toISOString() });
    const next = s.nextHeartbeat(crew.getAgent("ada"), at(2026, 9, 3, 23, 0));
    assert.equal(next.getDate(), 4, "next day");
    assert.equal(next.getHours(), 8);
    assert.equal(next.getMinutes(), 0);
  });

  await t.test("before the day starts it waits for the start, same day", () => {
    const last = at(2026, 9, 3, 3, 0);
    crew.db.setAgentState("ada", { lastHeartbeatAt: last.toISOString() });
    const next = s.nextHeartbeat(crew.getAgent("ada"), at(2026, 9, 3, 6, 0));
    assert.equal(next.getDate(), 3);
    assert.equal(next.getHours(), 8);
  });

  await t.test("without work hours the agent runs around the clock", () => {
    crew.updateAgent("sol", { heartbeat: { everyMinutes: 30, workHours: null } });
    const last = at(2026, 9, 3, 23, 0);
    crew.db.setAgentState("sol", { lastHeartbeatAt: last.toISOString() });
    const next = s.nextHeartbeat(crew.getAgent("sol"), at(2026, 9, 3, 23, 5));
    assert.equal(next.getDate(), 3);
    assert.equal(next.getHours(), 23);
    assert.equal(next.getMinutes(), 30);
  });
});

test("a tick records the next wake-up on every agent", async (t) => {
  const { crew } = makeCrew(t);
  const s = scheduler(crew);
  // Everyone has just checked in, so the tick schedules rather than fires.
  const justNow = new Date().toISOString();
  for (const a of crew.listAgents()) crew.db.setAgentState(a.id, { lastHeartbeatAt: justNow });
  t.after(() => s.queue.cancelAll());

  s.tick();

  for (const a of crew.listAgents()) {
    assert.ok(a.nextWakeAt, `${a.id} knows when it wakes next`);
    assert.ok(new Date(a.nextWakeAt) > new Date(), `${a.id} wakes in the future`);
  }
  assert.ok(crew.status().nextWake, "the status line can name the next wake-up");
});

test("a tick applies question deadlines", async (t) => {
  const { crew } = makeCrew(t);
  const s = scheduler(crew);
  t.after(() => s.queue.cancelAll());
  const justNow = new Date().toISOString();
  for (const a of crew.listAgents()) crew.db.setAgentState(a.id, { lastHeartbeatAt: justNow });

  const q = crew.askQuestion({
    kind: "question", fromAgentId: "kai", toId: "user", channel: null,
    title: "Queue backend?", body: "", defaultAnswer: "SQLite", defaultInMinutes: -5,
  });

  s.tick();

  const after = crew.db.getQuestion(q.id);
  assert.equal(after.status, "answered");
  assert.equal(after.answer, "SQLite");
  assert.equal(after.answeredBy, "default");
});

test("paused teams do not schedule work", async (t) => {
  const { crew } = makeCrew(t);
  const s = scheduler(crew);
  t.after(() => s.queue.cancelAll());
  crew.pausedAll = true;
  s.tick();
  assert.equal(s.queue.pending.length, 0);
  assert.equal(crew.listAgents().every((a) => a.status === "paused"), true);
});
