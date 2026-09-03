// Adding a teammate to a team that already exists (owner-reported gap, backlog DoOgAEf8).
// The desktop "Add agent…" sheet calls the `agents.create` RPC; these tests cover the
// supervisor contract it depends on: the agent lands on the existing team, joins the
// channels that already exist, gets a DM channel, is scheduled, and duplicates/invalid
// drafts are rejected instead of half-creating.
import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import WebSocket from "ws";
import { Hub } from "../dist/hub.js";
import { Api } from "../dist/api.js";
import { soloDevTeam } from "../dist/templates.js";
import { PROVIDERS, tempDir } from "./helpers.mjs";

/** Wire up a hub + API on a scratch data dir and return an RPC client plus the hub. */
async function connect(t) {
  const dataDir = tempDir("standbye-agents-create-");
  const port = 18000 + Math.floor(Math.random() * 2000);
  const token = crypto.randomBytes(8).toString("hex");
  const hub = new Hub({ dataDir, port, token });
  const api = new Api(hub, port, token);
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
          msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
        }
      };
      ws.on("message", onMsg);
      ws.send(JSON.stringify({ id, method, params }));
    });

  t.after(() => {
    ws.close();
    api.close();
    hub.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return { rpc, hub };
}

const draft = (overrides = {}) => ({
  ...soloDevTeam(PROVIDERS, "Navid", "demo").agents[0],
  name: "Mina",
  ...overrides,
});

// One-agent team, so assertions don't depend on how many agents the template ships.
const teamDraft = () => ({ ...soloDevTeam(PROVIDERS, "Navid", "demo"), agents: [draft()] });

test("agents.create adds a teammate to an existing team", async (t) => {
  const { rpc, hub } = await connect(t);

  // A team with one agent already exists.
  const team = await rpc("teams.create", { draft: teamDraft(), workspaceRoot: null, ownerName: "Navid" });
  assert.equal((await rpc("agents.list")).length, 1);

  // Add a second teammate to the same team.
  const created = await rpc("agents.create", {
    draft: draft({
      name: "Sina",
      role: "Reviewer and QA",
      soul: "Test what changed.",
      responsibilities: ["review PRs"],
      heartbeatMinutes: 120,
      dailyBudgetUsd: 3,
    }),
  });
  assert.ok(created.id && created.name === "Sina", "returns the created agent");

  const after = await rpc("agents.list");
  assert.equal(after.length, 2);
  assert.ok(after.some((a) => a.name === "Sina"), "new agent is on the existing team, not a new one");

  // Joins the channels that already exist: #general plus a DM channel of their own.
  const channels = await rpc("channels.list");
  const general = channels.find((c) => c.name === "general");
  assert.ok(general.members.includes(created.id), "created agent is a member of #general");
  const dm = channels.find((c) => c.kind === "dm" && c.dmAgentId === created.id);
  assert.ok(dm, "created agent has a DM channel");

  // Scheduled: the scheduler holds cron jobs for the new agent.
  const rt = hub.get(team.id);
  assert.ok(rt.scheduler.crons.has(created.id), "new agent has cron jobs scheduled");

  // Persisted, so a restart keeps the teammate.
  assert.ok(rt.crew.getAgent(created.id), "created agent persisted");
});

test("agents.create rejects a duplicate name and an invalid draft", async (t) => {
  const { rpc } = await connect(t);
  await rpc("teams.create", { draft: teamDraft(), workspaceRoot: null, ownerName: "Navid" });

  await assert.rejects(rpc("agents.create", { draft: draft({ name: "Mina" }) }), /Mina/, "duplicate name is rejected");
  await assert.rejects(rpc("agents.create", { draft: { name: "" } }), /Invalid input/, "invalid draft is rejected by the schema");
  assert.equal((await rpc("agents.list")).length, 1, "no half-created agent remains");
});