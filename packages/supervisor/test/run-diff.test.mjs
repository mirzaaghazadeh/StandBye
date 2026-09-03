import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeCrew, makeRepo } from "./helpers.mjs";
import { runDiff } from "../dist/git.js";

const g = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
const commit = (cwd, file, body = "hello\n") => {
  fs.writeFileSync(path.join(cwd, file), body);
  g(cwd, "add", ".");
  g(cwd, "commit", "-m", `add ${file}`);
};

test("run.diff: shows what changed in the workspace since the run's base", (t) => {
  const repo = makeRepo(t, []);
  const base = g(repo, "rev-parse", "HEAD");
  commit(repo, "a.txt");

  const d = runDiff(repo, "run1", base);
  assert.equal(d.available, true);
  assert.equal(d.reason, null);
  assert.equal(d.baseHead, base);
  assert.match(d.stat, /a\.txt/);
  assert.match(d.patch, /\+hello/);
});

test("run.diff: same base and HEAD is an available but empty diff", (t) => {
  const repo = makeRepo(t, []);
  const base = g(repo, "rev-parse", "HEAD");
  const d = runDiff(repo, "run1", base);
  assert.deepEqual([d.available, d.stat, d.patch], [true, "", ""]);
});

test("run.diff: no base recorded (pre-recording run) says so instead of guessing", (t) => {
  const repo = makeRepo(t, []);
  const d = runDiff(repo, "run1", null);
  assert.equal(d.available, false);
  assert.match(d.reason, /No base commit was recorded/);
  assert.equal(d.patch, null);
});

test("run.diff: base no longer an ancestor (branch switched) refuses the diff", (t) => {
  const repo = makeRepo(t, []);
  const base = g(repo, "rev-parse", "HEAD");
  g(repo, "checkout", "--orphan", "other"); // parentless: base can never be an ancestor of this HEAD
  g(repo, "commit", "--allow-empty", "-m", "unrelated");
  commit(repo, "other.txt");

  const d = runDiff(repo, "run1", base);
  assert.equal(d.available, false);
  assert.match(d.reason, /no longer an ancestor/);
  assert.equal(d.head, g(repo, "rev-parse", "HEAD"));
});

test("run.diff: workspace that is not a repo is unavailable, not an error", (t) => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "standbye-norepo-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const d = runDiff(dir, "run1", "abc123");
  assert.equal(d.available, false);
  assert.match(d.reason, /not a git repository/);
});

test("crew.runDiff: not-found run, and a recorded base reaches the workspace diff", (t) => {
  const repo = makeRepo(t, []);
  const { crew } = makeCrew(t, { workspaceRoot: repo });
  assert.match(crew.runDiff("nope").reason, /Run not found/);

  // A queued run has no base yet (the runner records it when the run starts).
  const agent = crew.listAgents()[0];
  const run = crew.createRun(agent.id, { kind: "manual", prompt: "test" }, "test-model");
  const d0 = crew.runDiff(run.id);
  assert.match(d0.reason, /No base commit was recorded/);

  // The runner's start step, abbreviated: record base, then the agent commits.
  const base = g(repo, "rev-parse", "HEAD");
  crew.updateRun(run, { status: "running", startedAt: new Date().toISOString(), baseHead: base });
  commit(repo, "feature.txt");
  const d = crew.runDiff(run.id);
  assert.equal(d.available, true);
  assert.equal(d.baseHead, base);
  assert.match(d.patch, /\+hello/);
});
