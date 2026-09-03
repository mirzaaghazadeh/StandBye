import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { GitInfo, GitSettings, PermissionRule, RunDiff } from "@crew/shared";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** Workspace HEAD, or null when there is nothing to measure a run against (not a repo, git missing,
 * bare/empty repo). Every caller treats null as "no diff available", never as a guess. */
export function gitHead(cwd: string): string | null {
  try {
    return git(cwd, ["rev-parse", "HEAD"]);
  } catch {
    return null;
  }
}

/** The per-run diff: what changed in the workspace between the run's recorded base and its HEAD.
 * Refuses to show a diff when the recorded base is no longer an ancestor of HEAD (the agent
 * switched branches or rebased mid-run), because that diff would splice unrelated work. */
export function runDiff(cwd: string, runId: string, baseHead: string | null): RunDiff {
  const unavailable = (reason: string, head: string | null = null): RunDiff =>
    ({ runId, available: false, reason, baseHead, head, stat: null, patch: null });
  if (!baseHead) return unavailable("No base commit was recorded when this run started.");
  const head = gitHead(cwd);
  if (!head) return unavailable("The workspace is not a git repository.");
  if (head === baseHead) return { runId, available: true, reason: null, baseHead, head, stat: "", patch: "" };
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", baseHead, head], { cwd, stdio: "ignore", timeout: 10_000 });
  } catch {
    return unavailable("The agent switched branches or rebased mid-run, so the recorded base is no longer an ancestor of HEAD.", head);
  }
  const range = `${baseHead}..${head}`;
  return {
    runId, available: true, reason: null, baseHead, head,
    stat: git(cwd, ["diff", range, "--stat"]),
    patch: git(cwd, ["diff", range]),
  };
}

/** What the app needs to know about a workspace before offering git settings. */
export function gitInfo(workspace: string | null): GitInfo {
  const empty: GitInfo = { isRepo: false, currentBranch: null, branches: [], hasRemote: false, remoteUrl: null, hasGh: false };
  if (!workspace || !fs.existsSync(path.join(workspace, ".git"))) return empty;
  try {
    const currentBranch = git(workspace, ["rev-parse", "--abbrev-ref", "HEAD"]) || null;
    const local = git(workspace, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]).split("\n").filter(Boolean);
    const remote = git(workspace, ["for-each-ref", "--format=%(refname:short)", "refs/remotes/"]).split("\n").filter(Boolean).map((b) => b.replace(/^[^/]+\//, "")).filter((b) => b !== "HEAD");
    const branches = [...new Set([...local, ...remote])].sort((a, b) => (a === currentBranch ? -1 : b === currentBranch ? 1 : a.localeCompare(b)));
    let remoteUrl: string | null = null;
    try { remoteUrl = git(workspace, ["remote", "get-url", "origin"]) || null; } catch { /* no remote */ }
    let hasGh = false;
    try { execFileSync("gh", ["--version"], { stdio: "ignore", timeout: 5000 }); hasGh = true; } catch { /* no gh */ }
    return { isRepo: true, currentBranch, branches, hasRemote: Boolean(remoteUrl), remoteUrl, hasGh };
  } catch {
    return { ...empty, isRepo: true };
  }
}

/** Sensible defaults from the branches that exist. */
export function defaultGitSettings(info: GitInfo): GitSettings | null {
  if (!info.isRepo) return null;
  const has = (n: string) => info.branches.includes(n);
  const main = has("main") ? "main" : has("master") ? "master" : info.currentBranch ?? "main";
  const dev = has("dev") ? "dev" : has("develop") ? "develop" : has("development") ? "development" : main;
  return {
    enabled: true,
    workBranch: dev,
    mode: info.hasRemote && info.hasGh ? "pr" : "push",
    devBranch: dev,
    stagingBranch: has("staging") ? "staging" : null,
    productionBranch: has("production") ? "production" : has("prod") ? "prod" : main !== dev ? main : null,
  };
}

/** Permission rules that make the git settings binding, whatever the agent's own rules say. */
export function gitRules(g: GitSettings | null | undefined): PermissionRule[] {
  if (!g || !g.enabled) return [];
  // Force pushes lose to nothing, so they go first and are never overridden by a branch rule.
  const rules: PermissionRule[] = [
    { pattern: "Bash(git push --force*)", behavior: "block", label: "Force push" },
    { pattern: "Bash(git push -f*)", behavior: "block", label: "Force push" },
  ];
  for (const b of [g.productionBranch, g.stagingBranch]) if (b) rules.push({ pattern: `Bash(git push*${b}*)`, behavior: "block", label: `Push to ${b}` }, { pattern: `Bash(git checkout ${b}*)`, behavior: "ask", label: `Check out ${b}` });
  if (g.mode === "pr") {
    if (g.devBranch) rules.push({ pattern: `Bash(git push*${g.devBranch}*)`, behavior: "block", label: `Direct push to ${g.devBranch} (use a PR)` });
    if (g.workBranch !== g.devBranch) rules.push({ pattern: `Bash(git push*${g.workBranch}*)`, behavior: "block", label: `Direct push to ${g.workBranch} (use a PR)` });
    rules.push({ pattern: "Bash(gh pr merge*)", behavior: "ask", label: "Merge a pull request" });
    rules.push({ pattern: "Bash(git push*)", behavior: "allow" }); // feature branches
  } else {
    rules.push({ pattern: `Bash(git push*${g.workBranch}*)`, behavior: "allow" });
    rules.push({ pattern: "Bash(git push*)", behavior: "ask", label: "Push to another branch" });
  }
  return rules;
}

/** The git section of every agent's system prompt. */
export function gitPrompt(g: GitSettings | null | undefined, owner: string): string {
  if (!g || !g.enabled) return "";
  const lines = [
    "# Git workflow (enforced by the app)",
    `Work on branch \`${g.workBranch}\`. If you are not on it, \`git checkout ${g.workBranch}\` first.`,
    // You are not the only one here. A person may have pushed overnight, and on a team every
    // other agent is committing to the same branch — so a run that starts from a stale checkout
    // rebuilds work that already exists, or lands a change on top of code it never saw.
    `Start every run up to date: \`git pull --rebase\`. Someone else — ${owner}, or a teammate working right now — may have pushed since you last looked.`,
    "Before you push, pull --rebase again and re-run the tests. If the push is rejected, pull and try again; never force.",
    "If a rebase conflicts and you are not certain how to resolve it, stop: leave the tree clean, say what conflicted, and pick something else. A wrong merge is worse than a late one.",
  ];
  if (g.mode === "pr") {
    lines.push(`Never commit to \`${g.workBranch}\` directly: create a short-lived branch from it, commit there, push it, and open a pull request against \`${g.workBranch}\` with \`gh pr create\`. Ask ${owner} before merging.`);
  } else {
    lines.push(`Commit on \`${g.workBranch}\` in small steps and push it when tests pass.`);
  }
  const protectedBranches = [g.stagingBranch, g.productionBranch].filter((b): b is string => Boolean(b));
  if (protectedBranches.length) lines.push(`Never push to ${protectedBranches.map((b) => `\`${b}\``).join(" or ")}. Promotions to those branches are ${owner}'s decision; propose them with ask_user.`);
  if (g.devBranch && g.devBranch !== g.workBranch) lines.push(`\`${g.devBranch}\` is the integration branch; changes reach it through pull requests only.`);
  return lines.join("\n");
}
