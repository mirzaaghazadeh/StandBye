// The in-app kanban board (backlog AM8o5UM1): the owner files tasks in the app, agents
// file and claim them through tools. These tests cover the supervisor contract the board
// depends on: tasks persist with per-column ordering, the RPC methods validate input
// instead of half-creating, claim/complete guards stop agents stealing each other's work,
// and every mutation pushes `tasks.updated` so open boards stay current.
import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { once } from "node:events";
import WebSocket from "ws";
import { Hub } from "../dist/hub.js";
import { Api } from "../dist/api.js";
import { soloDevTeam } from "../dist/templates.js";
import { tempDir, PROVIDERS } from "./helpers.mjs";

async function connect(t) {
  const dataDir = tempDir("standbye-tasks-");
  const token = crypto.randomBytes(8).toString("hex");
  const hub = new Hub({ dataDir, port: 0, token });
  const api = new Api(hub, 0, token);
  await api.ready;
  const port = api.port;
  assert.ok(port > 0, "the OS-assigned port is known before dialing");
  assert.equal(hub.opts.port, api.port);
  const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${token}`);
  await once(ws, "open");

  const rpc = (method, params, id = crypto.randomUUID()) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`rpc timeout: ${method}`)), 5000);
      const onMsg = (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.id === id) {
          clearTimeout(timer);
          ws.off("message", onMsg);
          if (msg.error) reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      };
      ws.on("message", onMsg);
      ws.send(JSON.stringify({ id, method, params }));
    });

  const { id: teamId } = await rpc("teams.create", {
    draft: soloDevTeam(PROVIDERS, "Navid", "demo"),
    workspaceRoot: null,
    ownerName: "Navid",
  });

  const pushes = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.event) pushes.push(msg);
  });

  t.diagnostic(`tasks test on port ${port}`);
  t.after(() => {
    ws.close();
    api.close();
    hub.stop();
  });
  return { hub, api, ws, rpc, pushes, teamId, db: () => hub.get(teamId).crew.db };
}

test("the board keeps tasks ordered per column and moves append to the target column", async (t) => {
  const { rpc } = await connect(t);

  const a = await rpc("tasks.create", { title: "Fix watcher debounce", detail: "packages/supervisor/src/watcher.ts" });
  const b = await rpc("tasks.create", { title: "Write release notes", column: "doing" });
  const c = await rpc("tasks.create", { title: "Retire the old md task lists" });

  assert.ok(a.id && b.id && c.id && a.id !== b.id, "each task gets a unique id");
  assert.equal(a.column, "todo", "default column is todo");
  assert.equal(a.position, 0, "first todo task sits at position 0");
  assert.equal(c.position, 1, "second todo task appends after it");
  assert.equal(b.position, 0, "doing column counts positions separately");
  assert.equal(a.createdBy, "owner", "owner is the default filer");

  const list = await rpc("tasks.list", {});
  assert.deepEqual(list.map((x) => `${x.column}:${x.position}`), ["todo:0", "todo:1", "doing:0"],
    "list is grouped by column, position ascending inside each");

  // Claim and finish: the same shape agents use via tools.
  const claimed = await rpc("tasks.update", { id: a.id, patch: { assignee: "ada", column: "doing" } });
  assert.equal(claimed.column, "doing");
  assert.equal(claimed.assignee, "ada");
  assert.ok(claimed.updatedAt >= claimed.createdAt, "updatedAt tracks the move");

  const order = await rpc("tasks.list", {});
  assert.deepEqual(order.filter((x) => x.column === "doing").map((x) => x.id), [b.id, a.id],
    "moving appends to the end of the target column");

  const done = await rpc("tasks.update", { id: a.id, patch: { column: "done" } });
  assert.equal(done.column, "done");

  await rpc("tasks.delete", { id: c.id });
  const after = await rpc("tasks.list", {});
  assert.equal(after.length, 2, "delete removes the task");
  assert.ok(!after.find((x) => x.id === c.id));
});

test("bad input is rejected, not half-created", async (t) => {
  const { rpc } = await connect(t);

  await assert.rejects(() => rpc("tasks.create", { title: "  " }), /Title required/, "blank title");
  await assert.rejects(() => rpc("tasks.create", { title: "ok", column: "archived" }), /Unknown board column/, "made-up column");
  const made = await rpc("tasks.create", { title: "survivor" });
  assert.equal((await rpc("tasks.list", {})).length, 1, "rejected creates left nothing behind");

  await assert.rejects(() => rpc("tasks.update", { id: made.id, patch: { column: "later" } }), /Unknown board column/, "update validates too");
  await assert.rejects(() => rpc("tasks.update", { id: "no-such-task", patch: { column: "doing" } }), /No task/);
  await assert.rejects(() => rpc("tasks.delete", { id: "no-such-task" }), /No task/);
});

test("claim and complete guards stop agents stealing each other's work", async (t) => {
  const { rpc, db } = await connect(t);
  const task = db().createTask({ title: "Shared fix", createdBy: "owner" });

  const claimed = db().claimTask(task.id, "ada");
  assert.equal(claimed.assignee, "ada");
  assert.equal(claimed.column, "doing");
  assert.throws(() => db().claimTask(task.id, "bob"), /Already assigned to ada/, "second claimant is refused");

  const done = db().completeTask(task.id, "ada");
  assert.equal(done.column, "done");
  assert.throws(() => db().completeTask(task.id, "bob"), /Assigned to ada, not you/, "an outsider cannot complete ada's task");

  const unowned = db().createTask({ title: "Nobody's yet", createdBy: "owner" });
  const finished = db().completeTask(unowned.id, "bob");
  assert.equal(finished.assignee, "bob", "an unassigned task may be completed by whoever finishes it");

  // Same guards over the RPC surface (what the desktop calls).
  const rpcTask = await rpc("tasks.create", { title: "RPC-level claim", createdBy: "owner" });
  await rpc("tasks.claim", { id: rpcTask.id, agent: "ada" });
  await assert.rejects(() => rpc("tasks.claim", { id: rpcTask.id, agent: "bob" }), /Already assigned to ada/);
  await assert.rejects(() => rpc("tasks.complete", { id: rpcTask.id, agent: "bob" }), /Assigned to ada, not you/);
  const rpcDone = await rpc("tasks.complete", { id: rpcTask.id, agent: "ada" });
  assert.equal(rpcDone.column, "done");
});

test("every mutation pushes tasks.updated so open boards stay current", async (t) => {
  const { rpc, pushes } = await connect(t);
  const first = await rpc("tasks.create", { title: "one" });
  await rpc("tasks.update", { id: first.id, patch: { column: "doing" } });
  await rpc("tasks.delete", { id: first.id });

  const taskPushes = pushes.filter((p) => p.event === "tasks.updated");
  assert.equal(taskPushes.length, 3, "create, update and delete each pushed once");
  assert.ok(Array.isArray(taskPushes[2].data), "push data is the full task list");
  assert.equal(taskPushes[2].data.length, 0, "final push reflects the empty board");
});
