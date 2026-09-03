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
  let updateHandler = null;
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
      onUpdate: (fn) => { updateHandler = fn; return () => {}; },
      // The snapshot override doubles as the bridge's initial value (store.ts reads it
      // via window.crew.updates.get(), not rpc).
      updates: { get: async () => (overrides["updates.get"] ? overrides["updates.get"]() : null) },
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
    /** The search page size the store asks the supervisor about (used by the search tests). */
    SEARCH_PAGE: mod.SEARCH_PAGE,
    rpcLog,
    storage,
    /** Deliver a pushed event to the store, the way the preloader does. */
    push: (event) => eventHandler(event),
    /** Deliver a pushed update-state snapshot from the main process. */
    pushUpdate: (u) => updateHandler(u),
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

test("update state: init fetches it, main-process pushes replace it", async () => {
  const { store, pushUpdate } = await freshStore({ "updates.get": () => ({ phase: "idle" }) });
  await store.init();
  await flush();
  assert.deepEqual(store.get().update, { phase: "idle" });
  pushUpdate({ phase: "downloading", progress: 40 });
  assert.equal(store.get().update.phase, "downloading");
});

test("navigateByPath: settings/updates opens the keys sheet on the updates tab", async () => {
  const { store } = await freshStore();
  await store.init();
  await flush();
  store.navigateByPath("/settings/updates");
  assert.equal(store.get().sheet.kind, "keys");
  assert.equal(store.get().sheet.tab, "updates");
});

// ── search ───────────────────────────────────────────────────────────────────

test("searchMessages queries the supervisor and stores the results for the channel", async () => {
  const { store, rpcLog, SEARCH_PAGE } = await freshStore({
    "messages.search": () => [{ id: "m9", text: "found it" }],
  });
  await store.searchMessages("general", "deploy");
  assert.ok(rpcLog.some((c) => c.method === "messages.search" && c.params.q === "deploy" && c.params.channelId === "general"));
  // One extra result is requested so a full page can be labelled as truncated.
  assert.ok(rpcLog.some((c) => c.method === "messages.search" && c.params.limit === SEARCH_PAGE + 1));
  assert.deepEqual(store.get().search, {
    channelId: "general",
    q: "deploy",
    results: [{ id: "m9", text: "found it" }],
    busy: false,
    error: null,
    truncated: false,
  });
});

test("searchMessages caps the page at 50 and flags that more matches exist", async () => {
  const { store, SEARCH_PAGE } = await freshStore({
    // 51 hits: the page is full and there are more — shown as 50 rows with truncated set.
    "messages.search": () => Array.from({ length: SEARCH_PAGE + 1 }, (_, i) => ({ id: `m${i}`, text: `hit ${i}` })),
  });
  await store.searchMessages("general", "deploy");
  const search = store.get().search;
  assert.equal(search.results.length, SEARCH_PAGE);
  assert.equal(search.truncated, true);
  assert.equal(search.error, null);
  assert.equal(search.busy, false);
});

test("searchMessages: exactly 50 matches is a full page but not truncated", async () => {
  const { store, SEARCH_PAGE } = await freshStore({
    "messages.search": () => Array.from({ length: SEARCH_PAGE }, (_, i) => ({ id: `m${i}`, text: `hit ${i}` })),
  });
  await store.searchMessages("general", "deploy");
  assert.equal(store.get().search.results.length, SEARCH_PAGE);
  assert.equal(store.get().search.truncated, false);
});

test("searchMessages with a blank query turns search off and never calls the supervisor", async () => {
  const { store, rpcLog } = await freshStore({
    "messages.search": () => [],
  });
  await store.searchMessages("general", "deploy");
  await store.searchMessages("general", "   ");
  assert.equal(rpcLog.filter((c) => c.method === "messages.search").length, 1);
  assert.equal(store.get().search, null);
});

test("searchMessages: the newest query wins — a slow response to an older one is dropped", async () => {
  const gates = [];
  const { store } = await freshStore({
    "messages.search": (p) => new Promise((resolve) => gates.push(() => resolve([{ id: "m1", text: p.q }]))),
  });
  const first = store.searchMessages("general", "alpha");
  const second = store.searchMessages("general", "alpha beta");
  gates[1](); // the newer query resolves first
  await second;
  assert.deepEqual(store.get().search.results, [{ id: "m1", text: "alpha beta" }]);
  gates[0](); // the older query lands last and must not overwrite it
  await first;
  assert.deepEqual(store.get().search.results, [{ id: "m1", text: "alpha beta" }]);
});

test("searchMessages: a failed query records the error instead of reading as zero matches", async () => {
  const { store } = await freshStore({
    "messages.search": () => { throw new Error("boom"); },
  });
  await store.searchMessages("general", "deploy");
  assert.deepEqual(store.get().search, { channelId: "general", q: "deploy", results: [], busy: false, error: "boom", truncated: false });
});

test("searchMessages: a response landing after refreshAll is dropped, not restored over the reset", async () => {
  let release;
  const { store } = await freshStore({
    "messages.search": () => new Promise((res) => { release = res; }),
  });
  const pending = store.searchMessages("general", "deploy"); // in flight across the reset
  await store.refreshAll(); // what a team switch or supervisor.reconnected runs
  assert.equal(store.get().search, null);
  release([{ id: "m1", text: "deploy notes" }]);
  await pending;
  assert.equal(store.get().search, null); // the stale response must not resurrect search
});

test("loadRunDiff caches per run; refetch bypasses the cache", async () => {
  let calls = 0;
  const { store } = await freshStore({
    "run.diff": () => {
      calls += 1;
      return { runId: "r1", available: true, reason: null, baseHead: "aa", head: "bb", stat: " 1 file changed", patch: "diff --git a/f b/f\n" };
    },
  });
  await store.loadRunDiff("r1");
  await store.loadRunDiff("r1"); // cached: no second RPC
  assert.equal(calls, 1);
  assert.equal(store.get().runDiffs["r1"].patch, "diff --git a/f b/f\n");
  await store.loadRunDiff("r1", true); // refetch bypasses
  assert.equal(calls, 2);
  assert.equal(store.get().runDiffs["r1"].available, true);
});

test("loadRunDiff: a failing RPC stores an unavailable diff instead of throwing", async () => {
  const { store } = await freshStore({
    "run.diff": () => { throw new Error("unknown method: run.diff"); },
  });
  await store.loadRunDiff("r1"); // must not reject
  const d = store.get().runDiffs["r1"];
  assert.equal(d.available, false);
  assert.ok(d.reason.includes("run.diff"));
  assert.equal(d.patch, null);
});

test("switchTeam drops cached run diffs so another team's diff never shows", async () => {
  const { store } = await freshStore({
    "run.diff": () => ({ runId: "r1", available: true, reason: null, baseHead: "aa", head: "bb", stat: "", patch: "+x" }),
  });
  await store.loadRunDiff("r1");
  assert.ok(store.get().runDiffs["r1"]);
  await store.switchTeam("t2");
  assert.deepEqual(store.get().runDiffs, {});
});

test("createAgent hires one agent into the current team via agents.create, closes the sheet and refreshes", async () => {
  const { store, rpcLog } = await freshStore({
    "agents.create": ({ draft }) => ({ id: "a9", name: draft.name, status: "idle" }),
  });
  store.set({ sheet: { kind: "add-agent" } });
  await store.createAgent({
    name: "Rex", role: "Reviewer", provider: "anthropic", model: "test-model", soul: "Careful reviewer.",
    rules: ["Ask before pushing"], responsibilities: ["Review diffs"], heartbeatMinutes: 45,
    dailyBudgetUsd: 3, channels: ["general"], color: "#D7E3DA",
  });
  assert.deepEqual(rpcLog.find((e) => e.method === "agents.create"), {
    method: "agents.create",
    params: { draft: {
      name: "Rex", role: "Reviewer", provider: "anthropic", model: "test-model", soul: "Careful reviewer.",
      rules: ["Ask before pushing"], responsibilities: ["Review diffs"], heartbeatMinutes: 45,
      dailyBudgetUsd: 3, channels: ["general"], color: "#D7E3DA",
    } },
  });
  assert.equal(store.get().sheet.kind, "none");
});

test("draftTeammate drafts one teammate via builder.draftTeammate and returns the draft", async () => {
  const draft = {
    name: "Quill", role: "Editor", provider: "openai", model: "test-model",
    soul: "Polishes prose.", rules: ["Never invent quotes"], responsibilities: ["Edit posts"],
    heartbeatMinutes: 60, dailyBudgetUsd: 2, perRunBudgetUsd: 0.5, hourlyBudgetUsd: null, capBy: "per-run",
    channels: ["general"], color: "#CBD5E1",
  };
  const { store, rpcLog } = await freshStore({
    "builder.draftTeammate": ({ description, ownerName, provider }) => ({
      ...draft,
      soul: `Drafter saw: ${description} (${ownerName}, via ${provider})`,
    }),
  });
  const got = await store.draftTeammate("A careful editor", "Navid", "anthropic");
  assert.deepEqual(rpcLog.find((e) => e.method === "builder.draftTeammate"), {
    method: "builder.draftTeammate",
    params: { description: "A careful editor", ownerName: "Navid", provider: "anthropic" },
  });
  assert.equal(got.name, "Quill");
  assert.equal(got.soul, "Drafter saw: A careful editor (Navid, via anthropic)");
});
