// Unit tests for the renderer store (apps/desktop/src/renderer/state/store.ts) — pure
// client logic with no electron dependency beyond the `window.crew` bridge and
// `localStorage`, both stubbed here.
//
// Runner: `node --test` with node's native TypeScript type stripping (no test-runner
// dependency; matches the supervisor's node --test convention). Requires node >= 22.18,
// where type stripping is unflagged. `store.ts` imports @crew/shared and react at
// runtime; both resolve through the workspace's normal node_modules.
//
// Each test gets a fresh store module: the class is a singleton and is not exported,
// so a query string on the import URL busts the ESM cache instead of changing
// production code.
import assert from "node:assert/strict";
import { test } from "node:test";
import { dmChannelId } from "@crew/shared";

let cacheBust = 0;
const flush = () => new Promise((r) => setImmediate(r));

/** Build a fresh store with a stubbed window.crew and localStorage. Returns the pieces a test needs. */
async function freshStore(overrides = {}) {
  const rpcLog = [];
  let eventHandler = null;
  const defaults = {
    "teams.list": () => [{ id: "t1", name: "One" }, { id: "t2", name: "Two" }],
    "teams.select": () => null,
    "status.get": () => ({ version: "test" }),
    "providers.get": () => ({ openrouter: { ready: true } }),
    "team.get": () => ({ id: "t1", name: "One" }),
    "agents.list": () => [{ id: "a1", name: "Mina" }, { id: "a2", name: "Arash" }],
    "channels.list": () => [{ id: "general", name: "general" }],
    "questions.list": () => [],
    "runs.list": () => [],
    "spend.get": () => ({ totalUsd: 0 }),
    "models.list": () => ({}),
    "messages.list": () => [],
    "run.get": () => ({ run: null, steps: [] }),
    "agent.wake": () => null,
    ...overrides,
  };
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  globalThis.window = {
    localStorage: globalThis.localStorage,
    crew: {
      keysSet: async () => true,
      pickFolder: async () => null,
      onEvent: (fn) => { eventHandler = fn; return () => {}; },
      onNavigate: (_fn) => () => {},
      rpc: async (method, params) => {
        rpcLog.push({ method, params });
        const fn = overrides[method] ?? defaults[method];
        return fn(params);
      },
    },
  };
  const mod = await import(`../src/renderer/state/store.ts?v=${++cacheBust}`);
  const store = mod.store;
  return {
    store,
    rpcLog,
    storage,
    /** Deliver a pushed event to the store, the way the preloader does. */
    push: (event) => eventHandler(event),
  };
}

test("init: picks the first team, selects it, persists the choice, sets ready", async () => {
  const { store, rpcLog } = await freshStore();
  await store.init();
  await flush();
  assert.equal(store.get().ready, true);
  assert.equal(store.get().activeTeamId, "t1");
  assert.ok(rpcLog.some((c) => c.method === "teams.select" && c.params.id === "t1"));
  assert.ok(rpcLog.some((c) => c.method === "teams.list"));
});

test("init: a remembered team wins over teams[0]", async () => {
  const { store, rpcLog, storage } = await freshStore();
  storage.set("standbye.activeTeam", "t2");
  await store.init();
  await flush();
  assert.equal(store.get().activeTeamId, "t2");
  assert.ok(rpcLog.some((c) => c.method === "teams.select" && c.params.id === "t2"));
});

test("init: no teams yet opens the onboarding sheet", async () => {
  const { store } = await freshStore({ "teams.list": () => [], "team.get": () => null });
  await store.init();
  await flush();
  assert.equal(store.get().sheet.kind, "onboarding");
});

test("events for another team are dropped; same-team events land", async () => {
  const { store, push } = await freshStore();
  await store.init();
  await flush();
  push({ teamId: "t2", event: "message.draft", data: { channelId: "general", text: "hi", done: false } });
  assert.equal(store.get().drafts.general, undefined);
  push({ teamId: "t1", event: "message.draft", data: { channelId: "general", text: "hi", done: false } });
  assert.equal(store.get().drafts.general.text, "hi");
});

test("draft lifecycle: growth replaces, done with text keeps the final text, done empty removes", async () => {
  const { store, push } = await freshStore();
  await store.init();
  await flush();
  push({ teamId: "t1", event: "message.draft", data: { channelId: "general", text: "hel", done: false } });
  push({ teamId: "t1", event: "message.draft", data: { channelId: "general", text: "hello w", done: false } });
  assert.equal(store.get().drafts.general.text, "hello w");
  assert.equal(store.get().drafts.general.done, false);
  // The agent thought better of it: no text, done.
  push({ teamId: "t1", event: "message.draft", data: { channelId: "general", text: "", done: true } });
  assert.equal(store.get().drafts.general, undefined);
  // Final partial text published without a message.created following.
  push({ teamId: "t1", event: "message.draft", data: { channelId: "ops", text: "partial", done: true } });
  assert.equal(store.get().drafts.ops.text, "partial");
});

test("message.created appends, clears that channel's draft, keeps others", async () => {
  const { store, push } = await freshStore();
  await store.init();
  await flush();
  push({ teamId: "t1", event: "message.draft", data: { channelId: "general", text: "d1", done: false } });
  push({ teamId: "t1", event: "message.draft", data: { channelId: "ops", text: "d2", done: false } });
  push({ teamId: "t1", event: "message.created", data: { id: "m1", channelId: "general", createdAt: "t0" } });
  const s = store.get();
  assert.equal(s.messages.general.length, 1);
  assert.equal(s.drafts.general, undefined);
  assert.equal(s.drafts.ops.text, "d2");
});

test("message.created caps a channel's history at 500", async () => {
  const { store, push } = await freshStore();
  await store.init();
  await flush();
  for (let i = 0; i < 501; i++) {
    push({ teamId: "t1", event: "message.created", data: { id: `m${i}`, channelId: "general", createdAt: `t${i}` } });
  }
  const history = store.get().messages.general;
  assert.equal(history.length, 500);
  assert.equal(history[0].id, "m1"); // oldest dropped
  assert.equal(history[499].id, "m500");
});

test("supervisor.reconnected: toast shows, refreshAll re-runs, toast clears after 3.5s", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { store, rpcLog, push } = await freshStore();
  await store.init();
  await flush();
  const selects = rpcLog.filter((c) => c.method === "teams.select").length;
  push({ event: "supervisor.reconnected" });
  assert.equal(store.get().toast, "Reconnected to the supervisor.");
  await flush();
  assert.ok(rpcLog.filter((c) => c.method === "teams.select").length > selects, "refreshAll ran again");
  t.mock.timers.tick(3500);
  assert.equal(store.get().toast, null);
});

test("questions: created prepends, updated replaces in place", async () => {
  const { store, push } = await freshStore();
  await store.init();
  await flush();
  push({ teamId: "t1", event: "question.created", data: { id: "q1", title: "one" } });
  push({ teamId: "t1", event: "question.created", data: { id: "q2", title: "two" } });
  assert.deepEqual(store.get().questions.map((q) => q.id), ["q2", "q1"]);
  push({ teamId: "t1", event: "question.updated", data: { id: "q1", title: "one answered" } });
  const s = store.get();
  assert.equal(s.questions.length, 2);
  assert.equal(s.questions.find((q) => q.id === "q1").title, "one answered");
});

test("runs: updated prepends new runs and updates existing ones without duplicating", async () => {
  const { store, push } = await freshStore();
  await store.init();
  await flush();
  push({ teamId: "t1", event: "run.updated", data: { id: "r1", status: "running" } });
  push({ teamId: "t1", event: "run.updated", data: { id: "r2", status: "running" } });
  assert.deepEqual(store.get().runs.map((r) => r.id), ["r2", "r1"]);
  push({ teamId: "t1", event: "run.updated", data: { id: "r1", status: "done" } });
  const s = store.get();
  assert.equal(s.runs.length, 2);
  assert.equal(s.runs.find((r) => r.id === "r1").status, "done");
});

test("navigate: channel loads its messages; dm selects the agent and loads the dm channel", async () => {
  const { store, rpcLog } = await freshStore({ "messages.list": () => [{ id: "m1", createdAt: "2026-09-03T10:00:00Z" }] });
  await store.init();
  await flush();
  store.navigate({ name: "channel", channelId: "general" });
  await flush();
  assert.ok(rpcLog.some((c) => c.method === "messages.list" && c.params.channelId === "general"));
  assert.equal(store.get().messages.general.length, 1);

  store.navigate({ name: "dm", agentId: "a2" });
  await flush();
  assert.equal(store.get().selectedAgentId, "a2");
  const dmKey = dmChannelId("a2");
  assert.ok(rpcLog.some((c) => c.method === "messages.list" && c.params.channelId === dmKey));
  assert.equal(store.get().messages[dmKey].length, 1);
});

test("markSeen records the last message's createdAt and does not re-set when unchanged", async () => {
  const { store } = await freshStore({ "messages.list": () => [{ id: "m1", createdAt: "2026-09-03T10:00:00Z" }] });
  await store.init();
  await flush();
  store.navigate({ name: "channel", channelId: "general" });
  await flush();
  let sets = 0;
  const unsub = store.subscribe(() => { sets++; });
  store.markSeen("general");
  assert.equal(store.get().seen.general, "2026-09-03T10:00:00Z");
  store.markSeen("general");
  assert.equal(sets, 1); // second call saw nothing new
  unsub();
});

test("sendMessage: names agents as waking, clears them after 12s", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { store, rpcLog } = await freshStore({
    "messages.send": () => ({ id: "m1", channelId: "general", mentions: ["a1"] }),
  });
  await store.init();
  await flush();
  await store.sendMessage("general", "hello @Mina");
  assert.ok(rpcLog.some((c) => c.method === "messages.send" && c.params.text === "hello @Mina"));
  assert.deepEqual(store.get().waking.m1.agentIds, ["a1"]);
  t.mock.timers.tick(12_000);
  assert.equal(store.get().waking.m1, undefined);
});

test("sendMessage: rpc failure toasts and does not fabricate waking state", async () => {
  const { store } = await freshStore({
    "messages.send": () => { throw new Error("boom"); },
  });
  await store.init();
  await flush();
  await store.sendMessage("general", "hello");
  assert.match(store.get().toast, /^Could not send: boom/);
  assert.deepEqual(store.get().waking, {});
});

test("retryMessage: wakes the agent with the failed text", async () => {
  const { store, rpcLog } = await freshStore();
  await store.init();
  await flush();
  await store.retryMessage("a1", "do it again");
  assert.ok(rpcLog.some((c) => c.method === "agent.wake" && c.params.id === "a1" && c.params.prompt === "do it again"));
  assert.equal(store.get().toast, "Asked again.");
});

test("skills.updated bumps the stamp; supervisor.status replaces the status", async () => {
  const { store, push } = await freshStore();
  await store.init();
  await flush();
  const before = store.get().skillsStamp;
  push({ teamId: "t1", event: "skills.updated" });
  push({ teamId: "t1", event: "supervisor.status", data: { version: "next" } });
  assert.equal(store.get().skillsStamp, before + 1);
  assert.equal(store.get().status.version, "next");
});
