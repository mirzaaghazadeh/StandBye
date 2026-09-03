#!/usr/bin/env node
// Snapshots this repo's recent git log into src/commits.json for the "StandBye builds StandBye" section.
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
  // Version: the latest v* tag when there is one, otherwise the desktop app's package.json version.
  let version = JSON.parse(fs.readFileSync(path.resolve(path.dirname(out), "../../desktop/package.json"), "utf8")).version;
  let tagged = false;
  try {
    const tag = execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (tag) { version = tag.replace(/^v/, ""); tagged = true; }
  } catch { /* no tag yet */ }
  const head = commits[0] ?? { hash: "", date: "" };
  fs.writeFileSync(out, JSON.stringify({ fetchedAt: new Date().toISOString().slice(0, 10), version, tagged, head: head.hash, headDate: head.date, count, commits }, null, 2) + "\n");
  console.log(`${out}: v${version}${tagged ? " (tag)" : " (package.json)"} at ${head.hash}, ${commits.length} of ${count} commits`);
} catch (e) {
  if (fs.existsSync(out)) console.log(`git unavailable, keeping ${out}`);
  else throw e;
}
