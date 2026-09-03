// Teams made before teams lived in project folders sit in the app's data dir, which means they
// only exist on the Mac that made them. On startup each one with a workspace moves into
// `<workspace>/.standbye`, so it belongs to the project like every new team does.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TEAM_DIR_NAME } from "@crew/shared";
import { Hub } from "../dist/hub.js";
import { soloDevTeam } from "../dist/templates.js";
import { tempDir, PROVIDERS } from "./helpers.mjs";

process.env.CREW_DISABLE_CLAUDE_LOGIN = "1";

const draft = () => soloDevTeam(PROVIDERS, "Navid", "demo");

/**
 * A team sitting in `<dataDir>/teams/<id>` with a workspace, exactly as an older StandBye
 * left it: the workspace is recorded in team.json but nothing was ever written into it.
 */
function legacyTeam(dataDir, workspaceRoot) {
  const h = new Hub({ dataDir, port: 0, token: "t" });
  const rt = h.createTeam(draft(), { workspaceRoot: null, ownerName: "Navid" });
  const id = rt.crew.id;
  const agents = rt.crew.listAgents().length;
  h.stop();
  const file = path.join(dataDir, "teams", id, "team.json");
  const team = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...team, workspaceRoot }, null, 2));
  fs.writeFileSync(path.join(dataDir, "workspaces.json"), "[]"); // it was never a project team
  return { id, agents };
}

test("an old team moves into its project folder on startup", async (t) => {
  const dataDir = tempDir("standbye-hub-");
  const project = tempDir("standbye-project-");
  t.after(() => { for (const d of [dataDir, project]) fs.rmSync(d, { recursive: true, force: true }); });
  const { id, agents } = legacyTeam(dataDir, project);

  const h = new Hub({ dataDir, port: 0, token: "t" });
  t.after(() => { try { h.stop(); } catch { /* stopped */ } });

  await t.test("its files are now in the project, not the app's data dir", () => {
    assert.ok(fs.existsSync(path.join(project, TEAM_DIR_NAME, "team.json")));
    assert.ok(fs.existsSync(path.join(project, TEAM_DIR_NAME, "agents")));
    assert.equal(fs.existsSync(path.join(dataDir, "teams", id)), false, "nothing is left behind to load twice");
  });
  await t.test("it opened, with the same id and the same agents", () => {
    assert.ok(h.list().some((x) => x.id === id));
    assert.equal(h.get(id).crew.listAgents().length, agents);
  });
  await t.test("the switcher now shows it as living with the project", () => {
    const row = h.list().find((x) => x.id === id);
    assert.equal(row.portable, true);
    assert.equal(row.dir, path.join(project, TEAM_DIR_NAME));
  });
  await t.test("its database is git-ignored, its definition is not", () => {
    assert.match(fs.readFileSync(path.join(project, TEAM_DIR_NAME, ".gitignore"), "utf8"), /crew\.db/);
  });
  await t.test("opening the project folder finds it", () => {
    assert.equal(h.probeFolder(project).hasTeam, true);
  });
});

test("a move only happens when it is safe", async (t) => {
  await t.test("a team with no workspace stays in the app's data dir", () => {
    const dataDir = tempDir("standbye-hub-");
    t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
    const first = new Hub({ dataDir, port: 0, token: "t" });
    const id = first.createTeam(draft(), { workspaceRoot: null, ownerName: "Navid" }).crew.id;
    first.stop();

    const h = new Hub({ dataDir, port: 0, token: "t" });
    t.after(() => h.stop());
    assert.ok(fs.existsSync(path.join(dataDir, "teams", id, "team.json")));
    assert.equal(h.list().find((x) => x.id === id).portable, false);
  });

  await t.test("a workspace that already holds a team is never written over", () => {
    const dataDir = tempDir("standbye-hub-");
    const project = tempDir("standbye-project-");
    t.after(() => { for (const d of [dataDir, project]) fs.rmSync(d, { recursive: true, force: true }); });
    const { id } = legacyTeam(dataDir, project);
    // Someone else's team is already in that folder.
    fs.mkdirSync(path.join(project, TEAM_DIR_NAME), { recursive: true });
    fs.writeFileSync(path.join(project, TEAM_DIR_NAME, "team.json"), JSON.stringify({ id: "other", name: "Theirs" }));

    const h = new Hub({ dataDir, port: 0, token: "t" });
    t.after(() => h.stop());
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, TEAM_DIR_NAME, "team.json"), "utf8")).id, "other", "theirs is untouched");
    assert.ok(fs.existsSync(path.join(dataDir, "teams", id, "team.json")), "ours stays where it was");
  });

  await t.test("a workspace that no longer exists is left alone", () => {
    const dataDir = tempDir("standbye-hub-");
    const project = tempDir("standbye-project-");
    t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
    const { id } = legacyTeam(dataDir, project);
    fs.rmSync(project, { recursive: true, force: true });

    const h = new Hub({ dataDir, port: 0, token: "t" });
    t.after(() => h.stop());
    assert.ok(fs.existsSync(path.join(dataDir, "teams", id, "team.json")));
    assert.ok(h.list().some((x) => x.id === id), "and it still runs");
  });
});

test("moving is done once, not on every start", async (t) => {
  const dataDir = tempDir("standbye-hub-");
  const project = tempDir("standbye-project-");
  t.after(() => { for (const d of [dataDir, project]) fs.rmSync(d, { recursive: true, force: true }); });
  const { id, agents } = legacyTeam(dataDir, project);

  const first = new Hub({ dataDir, port: 0, token: "t" });
  first.stop();
  const second = new Hub({ dataDir, port: 0, token: "t" });
  t.after(() => second.stop());

  assert.equal(second.list().filter((x) => x.id === id).length, 1, "it is opened once, not twice");
  assert.equal(second.get(id).crew.listAgents().length, agents, "and its work came through intact");
});

test("what a team folder does and does not commit", async (t) => {
  const dataDir = tempDir("standbye-hub-");
  const project = tempDir("standbye-project-");
  t.after(() => { for (const d of [dataDir, project]) fs.rmSync(d, { recursive: true, force: true }); });
  const h = new Hub({ dataDir, port: 0, token: "t" });
  t.after(() => h.stop());
  const rt = h.createTeam(draft(), { workspaceRoot: project, ownerName: "Navid" });
  const dir = path.join(project, TEAM_DIR_NAME);
  const ignore = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");

  await t.test("the team's own skills shelf lives with the project", () => {
    rt.crew.skills.save({ scope: "team" }, { name: "release-checklist", description: "How we ship", body: "1. tests\n" });
    assert.ok(fs.existsSync(path.join(dir, "skills", "release-checklist", "SKILL.md")));
    assert.ok(!/^skills\//m.test(ignore), "so it is committed, not ignored");
  });

  await t.test("an agent's own skills shelf travels with it", () => {
    const agentId = rt.crew.listAgents()[0].id;
    rt.crew.skills.save({ scope: "agent", ownerId: agentId }, { name: "my-way", description: "Personal notes", body: "notes\n" });
    assert.ok(fs.existsSync(path.join(dir, "agents", agentId, "skills", "my-way", "SKILL.md")));
  });

  await t.test("the generated .skillset is kept out of the repo", () => {
    const agentId = rt.crew.listAgents()[0].id;
    const built = rt.crew.skills.buildPlugin(agentId, rt.crew.skills.list({ scope: "agent", ownerId: agentId }));
    assert.ok(built, "the Claude runner builds one");
    assert.ok(built.startsWith(dir), "and it lands inside the team folder");
    assert.match(ignore, /agents\/\*\/\.skillset\//, "which is exactly why it is ignored");
  });

  await t.test("the database and logs stay on this machine", () => {
    for (const line of ["crew.db", "crew.db-wal", "crew.db-shm", "logs/"]) assert.ok(ignore.includes(line), `${line} is ignored`);
  });
});
