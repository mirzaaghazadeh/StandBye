#!/usr/bin/env node
// Snapshots this repo's recent git log into src/commits.json for the "Standbye builds Standbye" section.
// Run `pnpm --filter @crew/web commits` and commit the result. Without a .git directory (the Docker build)
// the existing snapshot is kept, so the build never depends on git.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/commits.json");
try {
  const raw = execFileSync("git", ["log", "-n", "14", "--format=%h%x1f%ad%x1f%s", "--date=short"], { encoding: "utf8" });
  const commits = raw.trim().split("\n").map((l) => { const [hash, date, subject] = l.split("\x1f"); return { hash, date, subject }; });
  const count = Number(execFileSync("git", ["rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim());
  fs.writeFileSync(out, JSON.stringify({ fetchedAt: new Date().toISOString().slice(0, 10), count, commits }, null, 2) + "\n");
  console.log(`${out}: ${commits.length} of ${count} commits`);
} catch (e) {
  if (fs.existsSync(out)) console.log(`git unavailable, keeping ${out}`);
  else throw e;
}
