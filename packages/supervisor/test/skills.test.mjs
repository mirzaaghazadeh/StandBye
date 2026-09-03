// Skills are the Agent Skills format (agentskills.io), so a skill from Claude Code or GitHub
// has to work here unchanged — and what an agent learned before the folder format has to survive.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeCrew, tempDir } from "./helpers.mjs";
import { parseFrontmatter, renderSkillMd, normalizeSkillName, parseGitRef, findSkillDirs, readSkillDir } from "../dist/skills.js";
import { systemPrompt } from "../dist/prompt.js";
import { TEAM_TOOLS } from "../dist/tools/team-tools.js";

/** Write a skill folder the way any other tool in the ecosystem would. */
function putSkill(root, name, { description = `Does ${name}. Use when testing ${name}.`, body = `Step 1. Do the ${name} thing.`, extra = {} } = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`);
  for (const [file, content] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

const toolCtx = (crew, agentId) => ({ crew, agentId, run: crew.createRun(agentId, { kind: "manual", prompt: "t" }, "m"), depth: 0 });
const tool = (name) => TEAM_TOOLS.find((t) => t.name === name);

test("frontmatter parsing covers what the spec allows", async (t) => {
  await t.test("the two required fields", () => {
    const { data, body, found } = parseFrontmatter("---\nname: pdf\ndescription: Handles PDFs.\n---\n\nDo the thing.\n");
    assert.equal(found, true);
    assert.equal(data.name, "pdf");
    assert.equal(data.description, "Handles PDFs.");
    assert.equal(body, "Do the thing.");
  });

  await t.test("optional fields, including the nested metadata map", () => {
    const { data } = parseFrontmatter(
      "---\nname: pdf\ndescription: d\nlicense: Apache-2.0\ncompatibility: Requires python\nallowed-tools: Bash(git:*) Read\nmetadata:\n  author: example-org\n  version: \"1.0\"\n---\n\nbody\n",
    );
    assert.equal(data.license, "Apache-2.0");
    assert.equal(data.compatibility, "Requires python");
    assert.equal(data["allowed-tools"], "Bash(git:*) Read");
    assert.deepEqual(data.metadata, { author: "example-org", version: "1.0" });
  });

  await t.test("block scalars, which real skills in the wild use for long descriptions", () => {
    const { data } = parseFrontmatter("---\nname: pdf\ndescription: >-\n  Extracts text from PDFs.\n  Use when the user mentions a PDF.\n---\n\nbody\n");
    assert.equal(data.description, "Extracts text from PDFs. Use when the user mentions a PDF.");
  });

  await t.test("a list where the spec wants a string", () => {
    const { data } = parseFrontmatter("---\nname: a\ndescription: d\nallowed-tools:\n  - Read\n  - Grep\n---\n\nbody\n");
    assert.equal(data["allowed-tools"], "Read Grep");
  });

  await t.test("no frontmatter at all is reported, not guessed at", () => {
    const { found, body } = parseFrontmatter("# Just markdown\n\nSteps.");
    assert.equal(found, false);
    assert.equal(body, "# Just markdown\n\nSteps.");
  });

  await t.test("what we render, we can read back", () => {
    const md = renderSkillMd({ name: "deploy", description: "Ships the app.", metadata: { author: "navid" } }, "1. Run make.");
    const { data, body } = parseFrontmatter(md);
    assert.equal(data.name, "deploy");
    assert.equal(data.description, "Ships the app.");
    assert.deepEqual(data.metadata, { author: "navid" });
    assert.equal(body, "1. Run make.");
  });

  await t.test("angle brackets never reach the frontmatter", () => {
    // The spec warns about this: they can inject instructions into the system prompt.
    const md = renderSkillMd({ name: "x", description: "Use <system>now</system> always" }, "body");
    assert.ok(!md.split("---")[1].includes("<"), md);
  });
});

test("names follow the spec", () => {
  assert.equal(normalizeSkillName("Deploy The App"), "deploy-the-app");
  assert.equal(normalizeSkillName("PDF  --  processing!"), "pdf-processing");
  assert.equal(normalizeSkillName("-leading-and-trailing-"), "leading-and-trailing");
});

test("a skill folder is read with its metadata and its bundled files", (t) => {
  const root = tempDir("standbye-skills-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  putSkill(root, "release", { extra: { "scripts/build.sh": "#!/bin/sh\n", "references/API.md": "# API\n" } });

  const s = readSkillDir(path.join(root, "release"), "user", null);
  assert.equal(s.name, "release");
  assert.deepEqual(s.errors, []);
  assert.deepEqual(s.files.sort(), ["references/API.md", "scripts/build.sh"]);
  assert.ok(s.body.includes("Step 1"));
  assert.ok(!s.body.includes("---"), "the body handed to a model has no frontmatter in it");
});

test("a skill that would waste a run is reported instead of used", (t) => {
  const root = tempDir("standbye-skills-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "nodesc"), { recursive: true });
  fs.writeFileSync(path.join(root, "nodesc", "SKILL.md"), "---\nname: nodesc\n---\n\nbody\n");
  fs.mkdirSync(path.join(root, "mismatch"), { recursive: true });
  fs.writeFileSync(path.join(root, "mismatch", "SKILL.md"), "---\nname: something-else\ndescription: d\n---\n\nbody\n");

  assert.match(readSkillDir(path.join(root, "nodesc"), "user", null).errors.join(" "), /description/i);
  assert.match(readSkillDir(path.join(root, "mismatch"), "user", null).errors.join(" "), /does not match the folder/i);
});

test("skills resolve agent over team over user", async (t) => {
  const { crew, dataDir } = makeCrew(t);
  const agent = crew.getAgent("kai");
  const userRoot = path.join(dataDir, "skills");
  const teamRoot = path.join(dataDir, "skills"); // makeCrew uses one dir for both global and team
  fs.mkdirSync(userRoot, { recursive: true });
  putSkill(userRoot, "shared", { description: "The user-wide version." });
  putSkill(userRoot, "only-user");
  putSkill(crew.store.agentSkillsDir(agent.id), "shared", { description: "Kai's sharper version." });
  putSkill(crew.store.agentSkillsDir(agent.id), "only-kai");
  assert.equal(userRoot, teamRoot);

  const effective = crew.skills.effectiveFor(agent);
  const shared = effective.find((s) => s.name === "shared");

  await t.test("the most specific scope wins", () => {
    assert.equal(shared.scope, "agent");
    assert.equal(shared.description, "Kai's sharper version.");
  });
  await t.test("what it shadows is recorded, so the UI can say so", () => {
    assert.ok(shared.shadowed.includes("user"));
  });
  await t.test("skills from every scope are present exactly once", () => {
    assert.deepEqual(effective.map((s) => s.name).sort(), ["only-kai", "only-user", "shared"]);
  });

  await t.test("another agent does not see the first agent's own shelf", () => {
    const other = crew.listAgents().find((a) => a.id !== agent.id);
    if (!other) return;
    assert.ok(!crew.skills.effectiveFor(other).some((s) => s.name === "only-kai"));
  });
});

test("the owner can switch one skill off for one agent", (t) => {
  const { crew, dataDir } = makeCrew(t);
  const agent = crew.getAgent("kai");
  fs.mkdirSync(path.join(dataDir, "skills"), { recursive: true });
  putSkill(path.join(dataDir, "skills"), "noisy");

  assert.ok(crew.skills.usableFor(agent).some((s) => s.name === "noisy"));
  const updated = crew.updateAgent(agent.id, { disabledSkills: ["noisy"] });
  assert.ok(!crew.skills.usableFor(updated).some((s) => s.name === "noisy"), "a disabled skill must not reach the run");
  assert.ok(crew.skills.effectiveFor(updated).some((s) => s.name === "noisy" && s.enabled === false), "but it stays visible in the app, switched off");
});

test("skills an agent learned before the folder format are not lost", (t) => {
  const { crew } = makeCrew(t);
  const agent = crew.getAgent("kai");
  const shelf = crew.store.agentSkillsDir(agent.id);
  fs.mkdirSync(shelf, { recursive: true });
  fs.writeFileSync(path.join(shelf, "deploy-staging.md"), "Run make deploy, then check the health endpoint.\n");

  const skills = crew.skills.list({ scope: "agent", ownerId: agent.id });
  const deploy = skills.find((s) => s.name === "deploy-staging");

  assert.ok(deploy, "the old flat file should have become a skill folder");
  assert.deepEqual(deploy.errors, []);
  assert.ok(deploy.body.includes("make deploy"));
  assert.ok(deploy.description.length > 0, "a description is salvaged so the skill is still findable");
  assert.ok(fs.existsSync(path.join(shelf, "deploy-staging", "SKILL.md")));
  assert.ok(!fs.existsSync(path.join(shelf, "deploy-staging.md")), "the old file is moved, not duplicated");
});

test("installing from a folder", async (t) => {
  const { crew } = makeCrew(t);
  const src = tempDir("standbye-src-");
  t.after(() => fs.rmSync(src, { recursive: true, force: true }));
  putSkill(path.join(src, "skills"), "alpha", { extra: { "scripts/run.sh": "echo hi\n" } });
  putSkill(path.join(src, "skills"), "beta");
  fs.mkdirSync(path.join(src, "skills", "broken"), { recursive: true });
  fs.writeFileSync(path.join(src, "skills", "broken", "SKILL.md"), "no frontmatter here\n");

  await t.test("a scan shows what is there before anything is copied", () => {
    const scan = crew.skills.scan("folder", src, { scope: "team" });
    assert.deepEqual(scan.candidates.map((c) => c.name).sort(), ["alpha", "beta", "broken"]);
    assert.ok(scan.candidates.find((c) => c.name === "broken").errors.length);
    assert.equal(crew.skills.list({ scope: "team" }).length, 0, "scanning must not install");
  });

  await t.test("installing copies the whole folder and records where it came from", () => {
    const out = crew.skills.install("folder", src, { scope: "team" });
    assert.deepEqual(out.installed.map((s) => s.name).sort(), ["alpha", "beta"]);
    assert.equal(out.skipped.length, 1, "the broken one is skipped with a reason");
    const alpha = crew.skills.list({ scope: "team" }).find((s) => s.name === "alpha");
    assert.deepEqual(alpha.files, ["scripts/run.sh"], "bundled resources come with it");
    assert.equal(alpha.source.kind, "folder");
    assert.equal(alpha.source.ref, src);
  });

  await t.test("a second install can pick just one skill", () => {
    const { crew: c2 } = makeCrew(t);
    const out = c2.skills.install("folder", src, { scope: "user" }, ["beta"]);
    assert.deepEqual(out.installed.map((s) => s.name), ["beta"]);
  });

  await t.test("a scan flags a name already on the shelf", () => {
    const scan = crew.skills.scan("folder", src, { scope: "team" });
    assert.equal(scan.candidates.find((c) => c.name === "alpha").conflictsWith, "team");
  });

  await t.test("a folder source is read live, so what is on disk now is what installs", () => {
    const { crew: c3 } = makeCrew(t);
    c3.skills.scan("folder", src, { scope: "team" });
    fs.rmSync(path.join(src, "skills", "beta"), { recursive: true, force: true });
    assert.deepEqual(c3.skills.install("folder", src, { scope: "team" }, ["beta"]).installed, []);
    putSkill(path.join(src, "skills"), "beta");
  });
});

test("a folder that is itself one skill installs as that skill", (t) => {
  const { crew } = makeCrew(t);
  const src = tempDir("standbye-src-");
  t.after(() => fs.rmSync(src, { recursive: true, force: true }));
  const dir = putSkill(src, "solo");
  const out = crew.skills.install("folder", dir, { scope: "team" });
  assert.deepEqual(out.installed.map((s) => s.name), ["solo"]);
});

test("git refs are read the way people paste them", () => {
  assert.deepEqual(parseGitRef("anthropics/skills"), { url: "https://github.com/anthropics/skills.git", branch: null, subpath: null });
  assert.deepEqual(parseGitRef("anthropics/skills/document-skills/pdf"), { url: "https://github.com/anthropics/skills.git", branch: null, subpath: "document-skills/pdf" });
  assert.deepEqual(parseGitRef("https://github.com/anthropics/skills/tree/main/document-skills/pdf"), { url: "https://github.com/anthropics/skills.git", branch: "main", subpath: "document-skills/pdf" });
  assert.deepEqual(parseGitRef("https://github.com/owner/repo.git#v2"), { url: "https://github.com/owner/repo.git", branch: "v2", subpath: null });
  assert.deepEqual(parseGitRef("git@github.com:owner/repo.git"), { url: "git@github.com:owner/repo.git", branch: null, subpath: null });
  assert.throws(() => parseGitRef("not a repo at all"), /not a repository/);
});

test("skill folders are found wherever a source keeps them", (t) => {
  const root = tempDir("standbye-find-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  putSkill(path.join(root, "skills"), "one", { extra: { "assets/nested/deep.md": "x" } });
  putSkill(path.join(root, "plugin", "skills"), "two");
  fs.mkdirSync(path.join(root, "node_modules", "junk"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "junk", "SKILL.md"), "---\nname: junk\ndescription: d\n---\nx");

  const found = findSkillDirs(root).map((d) => path.basename(d));
  assert.deepEqual(found.sort(), ["one", "two"]);
});

test("the prompt lists skills without pasting them in", (t) => {
  const { crew, dataDir } = makeCrew(t);
  fs.mkdirSync(path.join(dataDir, "skills"), { recursive: true });
  putSkill(path.join(dataDir, "skills"), "release-checklist", {
    description: "Ships a release. Use before tagging.",
    body: "A very long body ".repeat(400),
  });
  const agent = crew.getAgent("kai");

  const p = systemPrompt(crew, agent, "full");
  assert.ok(p.includes("release-checklist"), "the name is listed");
  assert.ok(p.includes("Use before tagging"), "so is the description, which is how the agent picks it");
  assert.ok(!p.includes("A very long body A very long body"), "the body stays on disk until the agent opens it");
  assert.match(p, /use_skill/, "the agent is told how to open one");

  const native = systemPrompt(crew, agent, "full", { hasNativeSkillTool: true });
  assert.ok(!native.includes("release-checklist"), "the Claude runner lists them itself; saying it twice is paid for twice");
});

test("use_skill hands over the steps", async (t) => {
  const { crew, dataDir } = makeCrew(t);
  fs.mkdirSync(path.join(dataDir, "skills"), { recursive: true });
  putSkill(path.join(dataDir, "skills"), "release-checklist", { body: "1. Tag it.\n2. Push it.", extra: { "scripts/tag.sh": "x" } });
  const ctx = toolCtx(crew, "kai");

  const out = await tool("use_skill").handler({ name: "release-checklist" }, ctx);
  assert.ok(out.includes("1. Tag it."));
  assert.ok(out.includes("scripts/tag.sh"), "bundled files are named so the agent can open them");

  const missing = await tool("use_skill").handler({ name: "no-such-thing" }, ctx);
  assert.match(missing, /No skill named "no-such-thing"/);
  assert.ok(missing.includes("release-checklist"), "and it says what there is instead");

  const disabled = crew.updateAgent("kai", { disabledSkills: ["release-checklist"] });
  assert.match(await tool("use_skill").handler({ name: "release-checklist" }, toolCtx(crew, disabled.id)), /No skill named/);
});

test("learn_skill writes a real skill on the shelf the agent chose", async (t) => {
  const { crew } = makeCrew(t);
  const ctx = toolCtx(crew, "kai");

  await tool("learn_skill").handler({ name: "Reset The DB", description: "Wipes and reseeds the dev database. Use when migrations diverge.", content: "1. Drop it.\n2. Seed it." }, ctx);
  const mine = crew.skills.list({ scope: "agent", ownerId: "kai" });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].name, "reset-the-db", "a model's title case is normalised into a legal name");
  assert.deepEqual(mine[0].errors, [], "what an agent writes must be valid, or it silently stops being used");
  assert.equal(mine[0].source.kind, "learned");
  assert.equal(crew.skills.list({ scope: "team" }).length, 0);

  await tool("learn_skill").handler({ name: "deploy", description: "How this team deploys. Use before shipping.", content: "1. Run make deploy.", scope: "team" }, ctx);
  assert.deepEqual(crew.skills.list({ scope: "team" }).map((s) => s.name), ["deploy"]);
});

test("the Claude runner gets a plugin folder it can load", (t) => {
  const { crew, dataDir } = makeCrew(t);
  fs.mkdirSync(path.join(dataDir, "skills"), { recursive: true });
  putSkill(path.join(dataDir, "skills"), "alpha");
  putSkill(crew.store.agentSkillsDir("kai"), "beta");
  const agent = crew.getAgent("kai");

  const dir = crew.skills.buildPlugin(agent.id, crew.skills.usableFor(agent));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, ".claude-plugin", "plugin.json"), "utf8"));
  assert.equal(manifest.name, "skills", "skills are addressed as skills:<name>");
  for (const name of ["alpha", "beta"]) {
    assert.ok(fs.existsSync(path.join(dir, "skills", name, "SKILL.md")), `${name} should be loadable from the plugin`);
  }

  crew.skills.remove({ scope: "agent", ownerId: agent.id }, "beta");
  const rebuilt = crew.skills.buildPlugin(agent.id, crew.skills.usableFor(agent));
  assert.ok(!fs.existsSync(path.join(rebuilt, "skills", "beta")), "a removed skill must not linger in the plugin folder");
  assert.equal(crew.skills.buildPlugin(agent.id, []), null, "no skills means no plugin to mount");
});

test("a skill can be promoted from one agent to the whole team", (t) => {
  const { crew } = makeCrew(t);
  putSkill(crew.store.agentSkillsDir("kai"), "handy", { extra: { "references/notes.md": "n" } });

  const moved = crew.skills.move({ scope: "agent", ownerId: "kai" }, { scope: "team" }, "handy");
  assert.equal(moved.scope, "team");
  assert.deepEqual(moved.files, ["references/notes.md"]);
  assert.equal(crew.skills.list({ scope: "agent", ownerId: "kai" }).length, 0, "it moves, it does not fork");

  const again = crew.skills.move({ scope: "team" }, { scope: "team" }, "handy");
  assert.equal(again.name, "handy", "moving a skill onto its own shelf must not delete it");
  assert.equal(crew.skills.list({ scope: "team" }).length, 1);
});

test("a skill name cannot escape its shelf", (t) => {
  const { crew, dataDir } = makeCrew(t);
  crew.skills.remove({ scope: "team" }, "../../agents");
  assert.ok(fs.existsSync(path.join(dataDir, "agents")), "a traversal in the name must not delete the agents folder");
});
