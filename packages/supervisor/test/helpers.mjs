// Shared setup for the supervisor tests.
//
// Everything runs against the COMPILED output in ../dist, so the tests need no extra
// tooling: `tsc` then `node --test`. No test may make a network call or a model call —
// CREW_DISABLE_CLAUDE_LOGIN keeps the Claude runner from picking up this machine's login,
// and no API key is ever set, so any run that does reach a provider fails instantly.
process.env.CREW_DISABLE_CLAUDE_LOGIN = "1";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Crew } from "../dist/crew.js";
import { soloDevTeam } from "../dist/templates.js";

/** Provider settings the template draft is built from. Not written to disk; the crew falls back to its own defaults. */
export const PROVIDERS = {
  anthropic: { enabled: true, defaultModel: "claude-opus-5", checkinModel: "claude-haiku-4-5" },
  openrouter: { enabled: true, defaultModel: "z-ai/glm-5.3", checkinModel: "z-ai/glm-5.3-flash" },
};

/** realpath so macOS /var vs /private/var never breaks a path comparison. */
export function tempDir(prefix = "standbye-test-") {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
}

/**
 * A crew on its own throwaway data dir, with the template team unless `withTeam: false`.
 * Registers cleanup on the test context.
 */
export function makeCrew(t, { withTeam = true, ownerName = "Navid", workspaceRoot = null, git = null } = {}) {
  const dataDir = tempDir();
  const crew = new Crew({ dataDir, globalDir: dataDir, keys: {} });
  if (withTeam) {
    crew.createTeamFromDraft(soloDevTeam(PROVIDERS, ownerName, "demo"), { workspaceRoot, ownerName, id: "team1", git });
  }
  t.after(() => {
    try { crew.close(); } catch { /* already closed */ }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return { crew, dataDir };
}

/** A real git repo with `main` plus the branches asked for, so gitInfo() has something true to read. */
export function makeRepo(t, branches = ["dev", "staging"], { remote = false } = {}) {
  const dir = tempDir("standbye-repo-");
  const g = (...args) => execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
  g("init", "-b", "main");
  g("config", "user.email", "test@example.com");
  g("config", "user.name", "Standbye Test");
  g("config", "commit.gpgsign", "false");
  g("commit", "--allow-empty", "-m", "init");
  for (const b of branches) g("branch", b);
  if (remote) g("remote", "add", "origin", "https://example.invalid/acme/demo.git");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Record a finished run with a cost, so the budget guards have something to count. */
export function spend(crew, agentId, costUsd) {
  const run = crew.createRun(agentId, { kind: "manual", prompt: "test" }, "test-model");
  return crew.updateRun(run, { status: "done", costUsd, finishedAt: new Date().toISOString() });
}

/** Wait until `check()` is true, or throw. Only used where the queue really executes a run. */
export async function waitFor(check, { timeout = 4000, step = 25 } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const v = check();
    if (v) return v;
    await new Promise((r) => setTimeout(r, step));
  }
  throw new Error("waitFor timed out");
}

/** Local-time Date, so work-hour assertions hold in any timezone. */
export function at(y, mo, d, h, mi = 0) {
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}
