// Removing a team from the list is an off switch, not a delete. A team on the list can wake,
// run and spend on its own; an archived one cannot, and stays that way across restarts —
// but every byte of its work is still there when the owner puts it back.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TEAM_DIR_NAME } from "@crew/shared";
import { Hub } from "../dist/hub.js";
import { soloDevTeam } from "../dist/templates.js";
import { tempDir, PROVIDERS } from "./helpers.mjs";

process.env.CREW_DISABLE_CLAUDE_LOGIN = "1";

function hub(t, dataDir = tempDir("standbye-hub-")) {
  const h = new Hub({ dataDir, port: 0, token: "t" });
  t.after(() => { try { h.stop(); } catch { /* already stopped */ } });
  return { h, dataDir };
}
const draft = () => soloDevTeam(PROVIDERS, "Navid", "demo");

test("archiving a project team", async (t) => {
  const { h, dataDir } = hub(t);
  const project = tempDir("standbye-project-");
  t.after(() => { for (const d of [dataDir, project]) fs.rmSync(d, { recursive: true, force: true }); });

  const rt = h.createTeam(draft(), { workspaceRoot: project, ownerName: "Navid" });
  const id = rt.crew.id;
  const agentCount = rt.crew.listAgents().length;

  const row = h.archiveTeam(id);
  await t.test("it leaves the live list, so nothing can schedule it", () => {
    assert.ok(!h.list().some((x) => x.id === id));
    assert.equal(h.get(id), undefined);
  });
  await t.test("it is recorded with enough to show and to find it again", () => {
    assert.equal(row.present, true);
    assert.equal(row.portable, true);
    assert.equal(row.agentCount, agentCount);
    assert.equal(row.dir, path.join(project, TEAM_DIR_NAME));
    assert.equal(h.archived().length, 1);
  });
  await t.test("its work is untouched on disk", () => {
    assert.ok(fs.existsSync(path.join(project, TEAM_DIR_NAME, "team.json")));
    assert.ok(fs.existsSync(path.join(project, TEAM_DIR_NAME, "agents")));
  });

  await t.test("restoring puts the same team back, with its agents", () => {
    const back = h.restoreTeam(id);
    assert.equal(back.crew.id, id);
    assert.equal(back.crew.listAgents().length, agentCount);
    assert.ok(h.list().some((x) => x.id === id));
    assert.equal(h.archived().length, 0, "it is no longer archived");
  });
});

test("an archived team stays off after a restart", async (t) => {
  const project = tempDir("standbye-project-");
  const dataDir = tempDir("standbye-hub-");
  t.after(() => { for (const d of [dataDir, project]) fs.rmSync(d, { recursive: true, force: true }); });

  const first = new Hub({ dataDir, port: 0, token: "t" });
  const id = first.createTeam(draft(), { workspaceRoot: project, ownerName: "Navid" }).crew.id;
  first.archiveTeam(id);
  first.stop();

  const { h } = hub(t, dataDir);
  await t.test("the supervisor does not quietly bring it back", () => {
    assert.equal(h.list().length, 0);
    assert.equal(h.get(id), undefined);
  });
  await t.test("it is still listed as archived, and still there", () => {
    const rows = h.archived();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, id);
    assert.equal(rows[0].present, true);
  });
  await t.test("restoring after the restart works", () => {
    assert.equal(h.restoreTeam(id).crew.id, id);
    assert.equal(h.archived().length, 0);
  });
});

test("a team that lives in the app's data dir archives too", async (t) => {
  const { h, dataDir } = hub(t);
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const id = h.createTeam(draft(), { workspaceRoot: null, ownerName: "Navid" }).crew.id;

  h.archiveTeam(id);
  await t.test("it is off the list but its folder survives", () => {
    assert.equal(h.list().length, 0);
    assert.ok(fs.existsSync(path.join(h.teamsDir, id, "team.json")));
    assert.equal(h.archived()[0].portable, false);
  });
  await t.test("and it can come back, since there is no folder to reopen by hand", () => {
    assert.equal(h.restoreTeam(id).crew.id, id);
  });
});

test("archiving is not deleting", async (t) => {
  const { h, dataDir } = hub(t);
  const project = tempDir("standbye-project-");
  t.after(() => { for (const d of [dataDir, project]) fs.rmSync(d, { recursive: true, force: true }); });
  const id = h.createTeam(draft(), { workspaceRoot: project, ownerName: "Navid" }).crew.id;
  h.archiveTeam(id);

  await t.test("deleting an archived team removes its folder and its record", () => {
    h.deleteTeam(id, true);
    assert.equal(fs.existsSync(path.join(project, TEAM_DIR_NAME)), false);
    assert.equal(h.archived().length, 0);
  });
  await t.test("restoring one that is gone reports it plainly and forgets it", () => {
    const other = h.createTeam(draft(), { workspaceRoot: project, ownerName: "Navid" });
    const otherId = other.crew.id;
    h.archiveTeam(otherId);
    fs.rmSync(path.join(project, TEAM_DIR_NAME), { recursive: true, force: true });
    assert.equal(h.archived()[0].present, false, "the app can see it has gone missing");
    assert.throws(() => h.restoreTeam(otherId), /moved or deleted/);
    assert.equal(h.archived().length, 0, "and it is not left dangling");
  });
});

test("an archived project folder can still be opened by hand", async (t) => {
  const { h, dataDir } = hub(t);
  const project = tempDir("standbye-project-");
  t.after(() => { for (const d of [dataDir, project]) fs.rmSync(d, { recursive: true, force: true }); });
  const id = h.createTeam(draft(), { workspaceRoot: project, ownerName: "Navid" }).crew.id;
  h.archiveTeam(id);

  await t.test("probing still finds the team in the folder", () => {
    const probe = h.probeFolder(project);
    assert.equal(probe.hasTeam, true);
    assert.equal(probe.alreadyOpen, false);
  });
  await t.test("opening the folder brings it back and clears the archive record", () => {
    assert.equal(h.openFolder(project).crew.id, id);
    assert.equal(h.archived().some((a) => a.id === id), false, "it must not be both open and archived");
  });
});
