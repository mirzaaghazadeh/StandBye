// The folder flow as the desktop app actually performs it: over the websocket, through Api.
// folder.test.mjs proves the Hub does the right thing; this proves the app can reach it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";
import { TEAM_DIR_NAME } from "@crew/shared";
import { Hub } from "../dist/hub.js";
import { Api } from "../dist/api.js";
import { soloDevTeam } from "../dist/templates.js";
import { tempDir, PROVIDERS } from "./helpers.mjs";

process.env.CREW_DISABLE_CLAUDE_LOGIN = "1";

const PORT = 47311;
const TOKEN = "folder-rpc-token";

/** A live supervisor plus a client speaking the same JSON-RPC the renderer speaks. */
async function connect(t) {
  const dataDir = tempDir("standbye-rpc-");
  const hub = new Hub({ dataDir, port: PORT, token: TOKEN });
  const api = new Api(hub, PORT, TOKEN);
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}?token=${TOKEN}`);
  const pending = new Map();
  const events = [];
  let seq = 0;

  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.id == null) { events.push(msg); return; }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  t.after(() => {
    ws.close();
    api.close();
    hub.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return { rpc, events };
}

const draft = () => soloDevTeam(PROVIDERS, "Navid", "demo");

test("the folder flow over the wire", async (t) => {
  const { rpc } = await connect(t);
  const project = tempDir("standbye-project-");
  const blank = tempDir("standbye-blank-");
  t.after(() => { for (const d of [project, blank]) fs.rmSync(d, { recursive: true, force: true }); });

  await t.test("a folder with no team probes empty, so the app can offer to make one", async () => {
    const probe = await rpc("teams.probeFolder", { path: blank });
    assert.equal(probe.hasTeam, false);
    assert.equal(probe.alreadyOpen, false);
  });

  await t.test("opening that folder answers null rather than failing", async () => {
    assert.equal(await rpc("teams.openFolder", { path: blank }), null);
  });

  let team;
  await t.test("a team created with a workspace lands in <workspace>/.standbye", async () => {
    team = await rpc("teams.create", { draft: draft(), workspaceRoot: project, ownerName: "Navid" });
    assert.ok(team.id);
    assert.ok(fs.existsSync(path.join(project, TEAM_DIR_NAME, "team.json")));
    assert.match(fs.readFileSync(path.join(project, TEAM_DIR_NAME, ".gitignore"), "utf8"), /crew\.db/);
  });

  await t.test("the switcher is told where it lives and that it travels with the project", async () => {
    const mine = (await rpc("teams.list")).find((x) => x.id === team.id);
    assert.equal(mine.portable, true);
    assert.equal(mine.dir, path.join(project, TEAM_DIR_NAME));
  });

  await t.test("the project folder now probes with the team's name and size", async () => {
    const probe = await rpc("teams.probeFolder", { path: project });
    assert.equal(probe.hasTeam, true);
    assert.equal(probe.name, team.name);
    assert.ok(probe.agentCount > 0);
    assert.equal(probe.alreadyOpen, true);
  });

  await t.test("archiving it stops the team but leaves the folder untouched", async () => {
    await rpc("teams.delete", { id: team.id, removeFiles: false });
    assert.ok(!(await rpc("teams.list")).some((x) => x.id === team.id), "it is off the list, so nothing wakes it");
    assert.ok(fs.existsSync(path.join(project, TEAM_DIR_NAME, "team.json")), "its work is still on disk");
  });

  await t.test("opening the folder again brings back the very same team", async () => {
    const back = await rpc("teams.openFolder", { path: project });
    assert.equal(back.id, team.id);
    assert.equal(back.name, team.name);
  });

  await t.test("a second team cannot be created in a folder that already has one", async () => {
    await assert.rejects(() => rpc("teams.create", { draft: draft(), workspaceRoot: project, ownerName: "Navid" }), /already has a team/);
  });

  await t.test("deleting for real takes the folder with it", async () => {
    await rpc("teams.delete", { id: team.id, removeFiles: true });
    assert.equal(fs.existsSync(path.join(project, TEAM_DIR_NAME)), false);
    assert.equal(await rpc("teams.openFolder", { path: project }), null);
  });
});
