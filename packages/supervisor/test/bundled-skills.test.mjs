// The skills Standbye ships with land on the user shelf on first start — and then belong to the
// owner. The sync must never undo a deletion, never overwrite an edit, and never take a name
// somebody else's skill already has.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempDir } from "./helpers.mjs";
import { bundledSkillsDir, hashSkillDir, syncBundledSkills } from "../dist/bundled-skills.js";
import { readSkillDir, readSkillRoot } from "../dist/skills.js";

const shelfOf = (dataDir) => path.join(dataDir, "skills");

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

test("a missing bundle is not an error", (t) => {
  const dataDir = tempDir();
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const out = syncBundledSkills(dataDir, path.join(dataDir, "nope"));
  assert.deepEqual(out, { installed: [], updated: [], kept: [], removed: [] });
});
