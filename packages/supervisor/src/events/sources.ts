import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { GhAvailability } from "@crew/shared";

/**
 * Everything the watcher learns about the outside world comes from here: local git,
 * and `gh` when it happens to be installed and signed in. Every function fails soft —
 * a missing tool or a broken repo returns null/empty, never throws.
 */

const GIT_TIMEOUT = 10_000;
const GH_TIMEOUT = 20_000;

export function git(cwd: string, args: string[], timeout = GIT_TIMEOUT): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", timeout, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** `git fetch` can be slow, so it never blocks a tick. */
export function fetchQuiet(cwd: string): Promise<void> {
  return new Promise((resolve) => {
    execFile("git", ["fetch", "--quiet", "--all", "--prune"], { cwd, timeout: 30_000 }, () => resolve());
  });
}

export interface Commit {
  sha: string;
  short: string;
  subject: string;
  author: string;
  at: string;
}

export function branchHead(cwd: string, branch: string): string | null {
  return git(cwd, ["rev-parse", "--verify", "--quiet", branch]) || null;
}

/** Commits reachable from `to` but not `from`, newest first. Capped so a long absence can't blow up a prompt. */
export function commitsBetween(cwd: string, from: string, to: string, limit = 20): Commit[] {
  const out = git(cwd, ["log", `${from}..${to}`, `--max-count=${limit}`, "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI"]);
  if (!out) return [];
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha = "", short = "", subject = "", author = "", at = ""] = line.split("\x1f");
      return { sha, short, subject, author, at };
    });
}

export function countBetween(cwd: string, from: string, to: string): number {
  const out = git(cwd, ["rev-list", "--count", `${from}..${to}`]);
  const n = Number(out);
  return Number.isFinite(n) ? n : 0;
}

/** Porcelain lines for the working tree, or null when git failed. */
export function dirtyFiles(cwd: string): string[] | null {
  const out = git(cwd, ["status", "--porcelain"]);
  if (out === null) return null;
  return out.split("\n").filter(Boolean);
}

// ---------- gh ----------

export function ghAvailability(cwd: string, remoteUrl: string | null): GhAvailability {
  if (!remoteUrl) return "no-remote";
  if (!/github\.com/i.test(remoteUrl)) return "not-github";
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore", timeout: 5000 });
  } catch {
    return "missing";
  }
  try {
    execFileSync("gh", ["auth", "status"], { cwd, stdio: "ignore", timeout: 10_000 });
    return "ready";
  } catch {
    return "unauthenticated";
  }
}

function ghJson<T>(cwd: string, args: string[]): T[] | null {
  try {
    const out = execFileSync("gh", args, { cwd, encoding: "utf8", timeout: GH_TIMEOUT, stdio: ["ignore", "pipe", "ignore"] });
    const parsed: unknown = JSON.parse(out || "[]");
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

export interface PullRequest {
  number: number;
  title: string;
  state: string;
  headRefName: string;
  author?: { login?: string } | null;
  isDraft?: boolean;
  reviewDecision?: string | null;
  url?: string;
  updatedAt?: string;
}

/**
 * Open plus recently closed/merged PRs. Older `gh` builds reject some fields, so we
 * retry with a minimal set rather than losing the source entirely.
 */
export function ghPullRequests(cwd: string, limit = 20): PullRequest[] | null {
  const rich = "number,title,state,headRefName,author,isDraft,reviewDecision,url,updatedAt";
  const plain = "number,title,state,headRefName,url";
  return (
    ghJson<PullRequest>(cwd, ["pr", "list", "--state", "all", "--limit", String(limit), "--json", rich]) ??
    ghJson<PullRequest>(cwd, ["pr", "list", "--state", "all", "--limit", String(limit), "--json", plain])
  );
}

export interface WorkflowRun {
  databaseId: number;
  status: string;
  conclusion: string | null;
  headBranch: string;
  workflowName?: string;
  displayTitle?: string;
  url?: string;
  createdAt?: string;
}

export function ghWorkflowRuns(cwd: string, limit = 20): WorkflowRun[] | null {
  const rich = "databaseId,status,conclusion,headBranch,workflowName,displayTitle,url,createdAt";
  const plain = "databaseId,status,conclusion,headBranch";
  return (
    ghJson<WorkflowRun>(cwd, ["run", "list", "--limit", String(limit), "--json", rich]) ??
    ghJson<WorkflowRun>(cwd, ["run", "list", "--limit", String(limit), "--json", plain])
  );
}

// ---------- file watching ----------

const ALWAYS_IGNORED = [".git", "node_modules", "dist", "build", "out", "target", "vendor", ".next", ".venv", "venv", "__pycache__", ".pytest_cache", ".turbo", ".cache", "coverage", "release"];

/** Path fragments that should never count as a human edit. Cheap prefix/substring matching, no glob engine. */
export function ignoreList(workspace: string): string[] {
  const list = [...ALWAYS_IGNORED];
  try {
    const gitignore = path.join(workspace, ".gitignore");
    if (fs.existsSync(gitignore)) {
      for (const raw of fs.readFileSync(gitignore, "utf8").split("\n")) {
        const line = raw.trim();
        // Only plain names and directories; anything with a glob or negation is skipped rather than half-honoured.
        if (!line || line.startsWith("#") || line.startsWith("!") || /[*?[\]]/.test(line)) continue;
        const name = line.replace(/^\/+|\/+$/g, "");
        if (name && !list.includes(name)) list.push(name);
      }
    }
  } catch { /* unreadable .gitignore is not worth failing over */ }
  return list;
}

export function isIgnoredPath(relative: string, ignores: string[]): boolean {
  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.some((p) => p.startsWith("."))) return true; // dot-dirs and dotfiles: editor state, not work
  return parts.some((p) => ignores.includes(p));
}
