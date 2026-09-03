// A team with a workspace belongs to that folder: `<workspace>/.standbye`. Opening the folder
// again finds it, so a team travels with the project instead of living only in this Mac's app data.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TEAM_DIR_NAME } from "@crew/shared";
import { Hub } from "../dist/hub.js";
import { soloDevTeam } from "../dist/templates.js";
import { tempDir, PROVIDERS } from "./helpers.mjs";

process.env.CREW_DISABLE_CLAUDE_LOGIN = "1";

function hub(t) {
  const dataDir = tempDir("standbye-hub-");
  const h = new Hub({ dataDir, port: 0, token: "t" });
  t.after(() => { h.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return { h, dataDir };
}
const draft = () => soloDevTeam(PROVIDERS, "Navid", "demo");

test("a team with a workspace is written into the project folder", async (t) => {
  const { h } = hub(t);
  const ws = tempDir("standbye-proj-");
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));

  const rt = h.createTeam(draft(), { workspaceRoot: ws, ownerName: "Navid" });
  const dir = path.join(ws, TEAM_DIR_NAME);

  await t.test("the folder holds the team definition", () => {
    assert.ok(fs.existsSync(path.join(dir, "team.json")));
    assert.ok(fs.existsSync(path.join(dir, "agents", "ada", "SOUL.md")), "souls travel with the project");
  });
  await t.test("history and logs are kept out of git", () => {
    const ignore = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    for (const line of ["crew.db", "logs/"]) assert.match(ignore, new RegExp(line));
  });
  await t.test("it is reported as portable", () => {
    const row = h.list().find((x) => x.id === rt.crew.id);
    assert.equal(row.portable, true);
    assert.equal(row.dir, dir);
  });
  await t.test("a second team in the same folder is refused", () => {
    assert.throws(() => h.createTeam(draft(), { workspaceRoot: ws, ownerName: "Navid" }), /already has a team/);
  });
});

test("a team without a workspace stays in the app's data dir", async (t) => {
  const { h, dataDir } = hub(t);
  const rt = h.createTeam(draft(), { workspaceRoot: null, ownerName: "Navid" });
  const row = h.list().find((x) => x.id === rt.crew.id);
  assert.equal(row.portable, false);
  assert.ok(row.dir.startsWith(path.join(dataDir, "teams")), row.dir);
});

test("opening a folder", async (t) => {
  const { h } = hub(t);
  const ws = tempDir("standbye-proj-");
  const empty = tempDir("standbye-empty-");
  t.after(() => { for (const d of [ws, empty]) fs.rmSync(d, { recursive: true, force: true }); });

  await t.test("a folder with no team probes as empty, so the app can offer to make one", () => {
    const p = h.probeFolder(empty);
    assert.equal(p.hasTeam, false);
    assert.equal(p.agentCount, 0);
    assert.equal(h.openFolder(empty), null, "nothing to open");
  });

  const created = h.createTeam(draft(), { workspaceRoot: ws, ownerName: "Navid" });
  await t.test("a folder with a team probes with its name and size", () => {
    const p = h.probeFolder(ws);
    assert.equal(p.hasTeam, true);
    assert.equal(p.name, created.crew.team.name);
    assert.equal(p.agentCount, 4);
    assert.equal(p.alreadyOpen, true);
  });
  await t.test("opening a team that is already open returns the same one", () => {
    assert.equal(h.openFolder(ws)?.crew.id, created.crew.id);
    assert.equal(h.list().length, 1, "no duplicate");
  });
});

test("a project team survives being closed and reopened", async (t) => {
  const ws = tempDir("standbye-proj-");
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));

  const { h } = hub(t);
  const first = h.createTeam(draft(), { workspaceRoot: ws, ownerName: "Navid" });
  const id = first.crew.id;
  first.crew.postMessage({ channel: "general", authorId: "user", text: "remember me" });

  await t.test("closing it without removing files leaves the folder intact", () => {
    h.deleteTeam(id, false);
    assert.equal(h.list().length, 0, "closed");
    assert.ok(fs.existsSync(path.join(ws, TEAM_DIR_NAME, "team.json")), "but still on disk");
  });
  await t.test("opening the folder again brings back the same team, id and history", () => {
    const again = h.openFolder(ws);
    assert.equal(again.crew.id, id, "same id, because it comes from team.json and not the path");
    assert.equal(again.crew.listAgents().length, 4);
    assert.ok(again.crew.db.listMessages("general").some((m) => m.text === "remember me"), "history came back too");
  });
  await t.test("deleting for real removes the folder", () => {
    h.deleteTeam(id, true);
    assert.equal(fs.existsSync(path.join(ws, TEAM_DIR_NAME)), false);
  });
});

test("a supervisor restart reopens project teams by itself", async (t) => {
  const ws = tempDir("standbye-proj-");
  const dataDir = tempDir("standbye-hub-");
  t.after(() => { for (const d of [ws, dataDir] ) fs.rmSync(d, { recursive: true, force: true }); });

  const first = new Hub({ dataDir, port: 0, token: "t" });
  const id = first.createTeam(draft(), { workspaceRoot: ws, ownerName: "Navid" }).crew.id;
  first.stop();

  const second = new Hub({ dataDir, port: 0, token: "t" });
  t.after(() => second.stop());
  await t.test("it is open again without anyone asking", () => {
    assert.deepEqual(second.list().map((x) => x.id), [id]);
  });
  await t.test("a workspace whose team was deleted behind our back is forgotten quietly", () => {
    second.stop();
    fs.rmSync(path.join(ws, TEAM_DIR_NAME), { recursive: true, force: true });
    const third = new Hub({ dataDir, port: 0, token: "t" });
    t.after(() => third.stop());
    assert.equal(third.list().length, 0);
  });
});

test("a team works on the folder it is actually in", async (t) => {
  // The point of living in the project is that the project can move: a clone, a rename, another
  // Mac. The folder on disk is the truth, never the absolute path written when it was made.
  const dataDir = tempDir("standbye-hub-");
  const original = tempDir("standbye-original-");
  const clone = tempDir("standbye-clone-");
  t.after(() => { for (const d of [dataDir, original, clone]) fs.rmSync(d, { recursive: true, force: true }); });

  const first = new Hub({ dataDir, port: 0, token: "t" });
  const id = first.createTeam(draft(), { workspaceRoot: original, ownerName: "Navid" }).crew.id;
  first.stop();

  // Copy the project somewhere else, the way `git clone` would.
  fs.cpSync(path.join(original, TEAM_DIR_NAME), path.join(clone, TEAM_DIR_NAME), { recursive: true });
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(clone, TEAM_DIR_NAME, "team.json"), "utf8")).workspaceRoot,
    original,
    "the copy still names the folder it came from",
  );

  const h = new Hub({ dataDir: tempDir("standbye-hub2-"), port: 0, token: "t" });
  t.after(() => h.stop());
  const rt = h.openFolder(clone);

  await t.test("opening the copy repoints it at where it now lives", () => {
    assert.equal(rt.crew.id, id, "same team");
    assert.equal(rt.crew.team.workspaceRoot, clone);
  });
  await t.test("and that is written down, so agents run in the right project", () => {
    assert.equal(JSON.parse(fs.readFileSync(path.join(clone, TEAM_DIR_NAME, "team.json"), "utf8")).workspaceRoot, clone);
  });
  await t.test("the original is left exactly as it was", () => {
    assert.equal(JSON.parse(fs.readFileSync(path.join(original, TEAM_DIR_NAME, "team.json"), "utf8")).workspaceRoot, original);
  });
});

test("a clone gets the team's rooms but not its transcript", async (t) => {
  // channels.json is setup and travels; crew.db is history and is git-ignored. Without the
  // first, a cloned team would arrive with agents and nowhere to talk.
  const dataDir = tempDir("standbye-hub-");
  const project = tempDir("standbye-original-");
  const clone = tempDir("standbye-clone-");
  t.after(() => { for (const d of [dataDir, project, clone] ) fs.rmSync(d, { recursive: true, force: true }); });

  const first = new Hub({ dataDir, port: 0, token: "t" });
  const rt = first.createTeam(draft(), { workspaceRoot: project, ownerName: "Navid" });
  rt.crew.ensureChannel("release", "Shipping and release notes", rt.crew.listAgents().map((a) => a.id));
  rt.crew.postMessage({ channel: "release", authorId: "user", text: "a secret about the release", kind: "chat" });
  const before = rt.crew.listChannels().filter((c) => c.kind !== "dm").map((c) => c.id).sort();
  first.stop();

  const teamDir = path.join(project, TEAM_DIR_NAME);
  await t.test("the rooms are written down next to the agents", () => {
    const saved = JSON.parse(fs.readFileSync(path.join(teamDir, "channels.json"), "utf8"));
    assert.deepEqual(saved.map((c) => c.id).sort(), before);
    assert.ok(saved.every((c) => c.kind !== "dm"), "private chats are not part of the setup");
    assert.equal(JSON.stringify(saved).includes("a secret about the release"), false, "and no messages are in there");
  });

  // `git clone` brings the committed files; crew.db is ignored, so it does not come.
  fs.mkdirSync(path.join(clone, TEAM_DIR_NAME), { recursive: true });
  for (const f of ["team.json", "channels.json", "agents", ".gitignore"]) {
    fs.cpSync(path.join(teamDir, f), path.join(clone, TEAM_DIR_NAME, f), { recursive: true });
  }

  const h = new Hub({ dataDir: tempDir("standbye-hub2-"), port: 0, token: "t" });
  t.after(() => h.stop());
  const opened = h.openFolder(clone);

  await t.test("the clone comes up with the same rooms", () => {
    assert.deepEqual(opened.crew.listChannels().filter((c) => c.kind !== "dm").map((c) => c.id).sort(), before);
    assert.equal(opened.crew.listChannels().find((c) => c.id === "release").purpose, "Shipping and release notes");
  });
  await t.test("but with none of what was said in them", () => {
    assert.equal(opened.crew.db.listMessages("release").length, 0);
  });
  await t.test("and everyone still has their own direct chat", () => {
    for (const a of opened.crew.listAgents()) {
      assert.ok(opened.crew.listChannels().some((c) => c.kind === "dm" && c.dmAgentId === a.id), `${a.name} has a DM`);
    }
  });
});
