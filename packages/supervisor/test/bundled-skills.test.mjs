// The skills Standbye ships with land on the user shelf on first start — and then belong to the
// owner. The sync must never undo a deletion, never overwrite an edit, and never take a name
// somebody else's skill already has.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PROVIDERS, tempDir } from "./helpers.mjs";
import { bundledSkillsDir, hashSkillDir, syncBundledSkills } from "../dist/bundled-skills.js";
import { readSkillDir, readSkillRoot } from "../dist/skills.js";
import { Crew } from "../dist/crew.js";
import { soloDevTeam } from "../dist/templates.js";
import { systemPrompt } from "../dist/prompt.js";
import { TEAM_TOOLS } from "../dist/tools/team-tools.js";

const shelfOf = (dataDir) => path.join(dataDir, "skills");
const tool = (name) => TEAM_TOOLS.find((t) => t.name === name);
const toolCtx = (crew, agentId) => ({ crew, agentId, run: crew.createRun(agentId, { kind: "manual", prompt: "t" }, "m"), depth: 0 });

/**
 * A crew laid out the way the Hub lays one out: the team in its own folder, the user shelf in the
 * app's data dir. `makeCrew` in the helpers points both at one directory, which collapses the two
 * shelves into the same folder — fine for most tests, but it would hide whether a shipped skill
 * actually crosses from the global shelf into a team.
 */
function makeTeam(t) {
  const dataDir = tempDir();
  const teamDir = path.join(dataDir, "teams", "team1");
  fs.mkdirSync(teamDir, { recursive: true });
  const crew = new Crew({ dataDir: teamDir, globalDir: dataDir, keys: {} });
  crew.createTeamFromDraft(soloDevTeam(PROVIDERS, "Navid", "demo"), { workspaceRoot: null, ownerName: "Navid", id: "team1", git: null });
  t.after(() => {
    try { crew.close(); } catch { /* already closed */ }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return { crew, dataDir };
}

test("what we ship is a valid skill library", () => {
  const skills = readSkillRoot(bundledSkillsDir(), "user", null);
  assert.ok(skills.length >= 20, `expected the shipped set, got ${skills.length}`);
  for (const s of skills) {
    assert.deepEqual(s.errors, [], `${s.name}: ${s.errors.join(" ")}`);
    // The description is the whole of what a run sees until it opens the skill, so it has to say
    // what the skill does *and* when to reach for it.
    assert.ok(s.description.length >= 60, `${s.name} has a description too thin to choose by`);
    assert.ok(s.description.length <= 400, `${s.name}'s description is a paragraph; the body is where that goes`);
    assert.ok(s.body.length > 400, `${s.name} has no real instructions`);
  }
  assert.equal(new Set(skills.map((s) => s.name)).size, skills.length, "two shipped skills share a name");

  // Every agent carries this catalog in every prompt, so its size is a running cost, not a one-off.
  const catalog = skills.map((s) => `- ${s.name} (everyone): ${s.description}`).join("\n");
  assert.ok(catalog.length < 8000, `the shipped catalog is ${catalog.length} chars of every prompt`);
});

test("first start seeds the user shelf", (t) => {
  const dataDir = tempDir();
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const first = syncBundledSkills(dataDir);
  assert.ok(first.installed.length >= 8);
  assert.deepEqual(first.updated, []);
  assert.deepEqual(first.removed, []);

  const onShelf = readSkillRoot(shelfOf(dataDir), "user", null);
  assert.equal(onShelf.length, first.installed.length);
  assert.equal(onShelf[0].source.kind, "bundled");
  assert.ok(onShelf[0].source.version);
  assert.ok(fs.existsSync(path.join(dataDir, "bundled-skills.json")));

  // Starting again changes nothing.
  const second = syncBundledSkills(dataDir);
  assert.deepEqual([second.installed, second.updated, second.kept, second.removed], [[], [], [], []]);
});

test("a skill the owner deleted stays deleted", (t) => {
  const dataDir = tempDir();
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const { installed } = syncBundledSkills(dataDir);
  const victim = installed[0];
  fs.rmSync(path.join(shelfOf(dataDir), victim), { recursive: true, force: true });

  const again = syncBundledSkills(dataDir);
  assert.deepEqual(again.removed, [victim]);
  assert.equal(fs.existsSync(path.join(shelfOf(dataDir), victim)), false);
});

test("an edited copy is never overwritten, even when what we ship moves on", (t) => {
  const dataDir = tempDir();
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const bundle = tempDir("standbye-bundle-");
  t.after(() => fs.rmSync(bundle, { recursive: true, force: true }));

  const put = (body) => {
    const dir = path.join(bundle, "reviewing-code");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: reviewing-code\ndescription: Review a change properly. Use when reviewing a pull request or a branch.\n---\n\n${body}\n`);
  };

  put("Read the diff.");
  assert.deepEqual(syncBundledSkills(dataDir, bundle).installed, ["reviewing-code"]);

  const file = path.join(shelfOf(dataDir), "reviewing-code", "SKILL.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8") + "\nAlso run it.\n");

  put("Read the diff, then run it.");
  const after = syncBundledSkills(dataDir, bundle);
  assert.deepEqual(after.kept, ["reviewing-code"]);
  assert.deepEqual(after.updated, []);
  assert.match(fs.readFileSync(file, "utf8"), /Also run it\./);
});

test("an untouched copy is refreshed when the shipped version changes", (t) => {
  const dataDir = tempDir();
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const bundle = tempDir("standbye-bundle-");
  t.after(() => fs.rmSync(bundle, { recursive: true, force: true }));

  const put = (body) => {
    const dir = path.join(bundle, "running-a-spike");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: running-a-spike\ndescription: Answer an open question with a time-boxed experiment. Use when the team does not know if an approach works.\n---\n\n${body}\n`);
  };

  put("Box it at an hour.");
  syncBundledSkills(dataDir, bundle);
  const before = readSkillDir(path.join(shelfOf(dataDir), "running-a-spike"), "user", null);

  put("Box it at an hour, then recommend one option.");
  assert.deepEqual(syncBundledSkills(dataDir, bundle).updated, ["running-a-spike"]);

  const after = readSkillDir(path.join(shelfOf(dataDir), "running-a-spike"), "user", null);
  assert.match(after.body, /recommend one option/);
  assert.notEqual(after.source.version, before.source.version);
  assert.equal(after.source.version, hashSkillDir(path.join(bundle, "running-a-spike")));
  // Provenance is not part of the hash, or writing it would look like an edit next time.
  assert.equal(after.source.version, hashSkillDir(after.dir));
});

test("a skill the owner already installed keeps its name", (t) => {
  const dataDir = tempDir();
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const bundle = tempDir("standbye-bundle-");
  t.after(() => fs.rmSync(bundle, { recursive: true, force: true }));

  fs.mkdirSync(path.join(bundle, "getting-oriented"), { recursive: true });
  fs.writeFileSync(path.join(bundle, "getting-oriented", "SKILL.md"), "---\nname: getting-oriented\ndescription: Ours. Use when starting in a new repo.\n---\n\nOurs.\n");

  const mine = path.join(shelfOf(dataDir), "getting-oriented");
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, "SKILL.md"), "---\nname: getting-oriented\ndescription: Mine, installed from GitHub. Use when starting in a new repo.\n---\n\nMine.\n");

  const out = syncBundledSkills(dataDir, bundle);
  assert.deepEqual(out.kept, ["getting-oriented"]);
  assert.match(fs.readFileSync(path.join(mine, "SKILL.md"), "utf8"), /Mine\./);
});

// ---------------------------------------------------------------- do the agents actually get them?
//
// Seeding the shelf is only half the job. What matters is that a real agent on a real team is
// offered them, can open one, and is not paying for the bodies in every prompt.

test("every seeded skill is offered to every agent on a team", (t) => {
  const { crew, dataDir } = makeTeam(t);
  const shipped = syncBundledSkills(dataDir).installed;

  for (const agent of crew.listAgents()) {
    const usable = crew.skills.usableFor(agent).map((s) => s.name);
    for (const name of shipped) assert.ok(usable.includes(name), `${name} is on the shelf but not offered to ${agent.name}`);
  }
  // They live on the global shelf, so one copy serves every team rather than being duplicated in.
  assert.ok(crew.skills.usableFor(crew.getAgent("kai")).every((s) => s.scope === "user"));
  assert.deepEqual(crew.skills.list({ scope: "team" }), [], "nothing was copied into the team folder");
});

test("the prompt carries the catalog, not the bodies", (t) => {
  const { crew, dataDir } = makeTeam(t);
  syncBundledSkills(dataDir);
  const agent = crew.getAgent("kai");
  const p = systemPrompt(crew, agent, "full");

  for (const s of crew.skills.usableFor(agent)) {
    assert.ok(p.includes(s.name), `${s.name} is not listed in the prompt`);
    assert.ok(p.includes(s.description), `${s.name}'s description is missing, which is how the agent picks it`);
    // The first heading of the body is a cheap proxy for "the whole file got pasted in".
    const heading = s.body.split("\n").find((l) => l.startsWith("# "));
    if (heading) assert.ok(!p.includes(heading), `${s.name}'s body leaked into the prompt`);
  }
  assert.match(p, /use_skill/);
});

test("use_skill opens a shipped skill and returns its steps", async (t) => {
  const { crew, dataDir } = makeTeam(t);
  syncBundledSkills(dataDir);
  const ctx = toolCtx(crew, "kai");

  const out = await tool("use_skill").handler({ name: "shipping-a-change" }, ctx);
  assert.match(out, /# Skill: shipping-a-change/);
  assert.match(out, /Before you touch a file/, "the actual steps came back");
  assert.ok(out.length > 1000, "a stub came back instead of the skill");

  // The name an agent reads in its prompt is the name that opens it.
  for (const s of crew.skills.usableFor(crew.getAgent("kai"))) {
    const r = await tool("use_skill").handler({ name: s.name }, ctx);
    assert.ok(!r.startsWith("No skill named"), `${s.name} is listed but does not open`);
  }
});

test("the Claude runner mounts them as a plugin", (t) => {
  const { crew, dataDir } = makeTeam(t);
  syncBundledSkills(dataDir);
  const agent = crew.getAgent("kai");

  const dir = crew.skills.buildPlugin(agent.id, crew.skills.usableFor(agent));
  assert.ok(dir, "no plugin folder was built");
  const mounted = fs.readdirSync(path.join(dir, "skills"));
  for (const s of crew.skills.usableFor(agent)) assert.ok(mounted.includes(s.name), `${s.name} was not mounted`);
  // Linked, not copied, so editing a skill in the app changes what the next run reads.
  assert.ok(fs.existsSync(path.join(dir, "skills", "reviewing-code", "SKILL.md")));
});

test("the owner's per-agent off switch still wins", (t) => {
  const { crew, dataDir } = makeTeam(t);
  syncBundledSkills(dataDir);
  const agent = { ...crew.getAgent("kai"), disabledSkills: ["running-a-spike"] };

  const usable = crew.skills.usableFor(agent).map((s) => s.name);
  assert.ok(!usable.includes("running-a-spike"), "a shipped skill must be switchable off like any other");
  assert.ok(usable.includes("reviewing-code"), "and turning one off must not take the rest with it");
});

test("a missing bundle is not an error", (t) => {
  const dataDir = tempDir();
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const out = syncBundledSkills(dataDir, path.join(dataDir, "nope"));
  assert.deepEqual(out, { installed: [], updated: [], kept: [], removed: [] });
});
