import test from "node:test";
import assert from "node:assert/strict";
import { defaultGitSettings, gitInfo, gitPrompt, gitRules } from "../dist/git.js";
import { decide } from "../dist/permissions.js";
import { makeRepo, tempDir } from "./helpers.mjs";

test("gitInfo: reads a real repo", async (t) => {
  const repo = makeRepo(t, ["dev", "staging"]);
  const info = gitInfo(repo);
  assert.equal(info.isRepo, true);
  assert.equal(info.currentBranch, "main");
  assert.deepEqual([...info.branches].sort(), ["dev", "main", "staging"]);
  assert.equal(info.branches[0], "main", "the current branch is listed first");
  assert.equal(info.hasRemote, false);
  assert.equal(info.remoteUrl, null);
  assert.equal(typeof info.hasGh, "boolean");
});

test("gitInfo: a remote is picked up", async (t) => {
  const repo = makeRepo(t, [], { remote: true });
  const info = gitInfo(repo);
  assert.equal(info.hasRemote, true);
  assert.match(info.remoteUrl, /acme\/demo\.git$/);
});

test("gitInfo: a plain folder or no folder is not a repo", async (t) => {
  const dir = tempDir("standbye-plain-");
  t.after(() => { /* tempDir cleanup */ });
  const info = gitInfo(dir);
  assert.equal(info.isRepo, false);
  assert.deepEqual(info.branches, []);
  assert.equal(gitInfo(null).isRepo, false);
});

test("defaultGitSettings: guesses the workflow from the branches that exist", async (t) => {
  await t.test("main + dev + staging", () => {
    const repo = makeRepo(t, ["dev", "staging"]);
    const g = defaultGitSettings(gitInfo(repo));
    assert.equal(g.enabled, true);
    assert.equal(g.workBranch, "dev", "agents work on dev when it exists");
    assert.equal(g.devBranch, "dev");
    assert.equal(g.stagingBranch, "staging");
    assert.equal(g.productionBranch, "main");
    assert.equal(g.mode, "push", "no remote means no pull requests");
  });

  await t.test("main only: nothing to protect, work on main", () => {
    const repo = makeRepo(t, []);
    const g = defaultGitSettings(gitInfo(repo));
    assert.equal(g.workBranch, "main");
    assert.equal(g.devBranch, "main");
    assert.equal(g.stagingBranch, null);
    assert.equal(g.productionBranch, null, "main is the work branch, so it is not also production");
  });

  await t.test("develop and prod are recognised too", () => {
    const repo = makeRepo(t, ["develop", "prod"]);
    const g = defaultGitSettings(gitInfo(repo));
    assert.equal(g.workBranch, "develop");
    assert.equal(g.productionBranch, "prod");
  });

  await t.test("not a repo means no settings", () => {
    assert.equal(defaultGitSettings(gitInfo(null)), null);
  });
});

test("gitRules: the settings are enforced, not just suggested", async (t) => {
  const base = { enabled: true, workBranch: "dev", devBranch: "dev", stagingBranch: "staging", productionBranch: "main" };

  await t.test("disabled or missing settings add no rules", () => {
    assert.deepEqual(gitRules(null), []);
    assert.deepEqual(gitRules({ ...base, enabled: false }), []);
  });

  await t.test("push mode: work branch allowed, protected branches blocked", () => {
    const rules = gitRules({ ...base, mode: "push" });
    const d = (command) => decide(rules, "Bash", { command }).behavior;
    assert.equal(d("git push origin dev"), "allow");
    assert.equal(d("git push origin main"), "block", "production is never pushed");
    assert.equal(d("git push origin staging"), "block");
    assert.equal(d("git push origin feature-x"), "ask", "any other branch asks");
    assert.equal(d("git push --force origin dev"), "block", "force push always loses to nothing");
    assert.equal(d("git push -f origin dev"), "block");
    assert.equal(d("git checkout main"), "ask");
    assert.equal(d("git checkout staging"), "ask");
  });

  await t.test("pr mode: the work branch is blocked so changes go through a pull request", () => {
    const rules = gitRules({ ...base, mode: "pr" });
    const d = (command) => decide(rules, "Bash", { command }).behavior;
    assert.equal(d("git push origin dev"), "block", "no direct push in PR mode");
    assert.equal(d("git push origin main"), "block");
    assert.equal(d("git push origin staging"), "block");
    assert.equal(d("git push -u origin feat/search"), "allow", "feature branches are how work moves");
    assert.equal(d("gh pr merge 12 --squash"), "ask", "merging is the owner's call");
    assert.equal(d("git push --force origin feat/search"), "block");
  });

  await t.test("a work branch separate from dev is protected too", () => {
    const rules = gitRules({ ...base, workBranch: "release", mode: "pr" });
    const d = (command) => decide(rules, "Bash", { command }).behavior;
    assert.equal(d("git push origin release"), "block");
    assert.equal(d("git push origin dev"), "block");
  });

  await t.test("labels explain the block in the UI", () => {
    const rules = gitRules({ ...base, mode: "push" });
    assert.equal(decide(rules, "Bash", { command: "git push origin main" }).rule.label, "Push to main");
    assert.equal(decide(rules, "Bash", { command: "git push --force origin dev" }).rule.label, "Force push");
  });
});

test("gitPrompt: tells the agent the workflow in words", async (t) => {
  const base = { enabled: true, workBranch: "dev", devBranch: "dev", stagingBranch: "staging", productionBranch: "main" };

  await t.test("nothing when git is off", () => {
    assert.equal(gitPrompt(null, "Navid"), "");
    assert.equal(gitPrompt({ ...base, enabled: false }, "Navid"), "");
  });

  await t.test("pr mode names the branch, the PR flow and the owner", () => {
    const p = gitPrompt({ ...base, mode: "pr" }, "Navid");
    assert.match(p, /Work on branch `dev`/);
    assert.match(p, /pull request/i);
    assert.match(p, /gh pr create/);
    assert.match(p, /Navid/);
    assert.match(p, /Never push to `staging` or `main`/);
  });

  await t.test("push mode says commit and push instead", () => {
    const p = gitPrompt({ ...base, mode: "push" }, "Navid");
    assert.match(p, /Commit on `dev`/);
    assert.doesNotMatch(p, /gh pr create/);
    assert.match(p, /Never push to `staging` or `main`/);
  });

  await t.test("an integration branch behind the work branch is explained", () => {
    const p = gitPrompt({ ...base, workBranch: "feature-base", mode: "pr" }, "Navid");
    assert.match(p, /`dev` is the integration branch/);
  });

  await t.test("no protected branches, no warning", () => {
    const p = gitPrompt({ enabled: true, workBranch: "main", devBranch: "main", stagingBranch: null, productionBranch: null, mode: "push" }, "Navid");
    assert.doesNotMatch(p, /Never push to/);
  });
});
