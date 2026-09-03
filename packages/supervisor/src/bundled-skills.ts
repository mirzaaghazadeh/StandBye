import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillSource } from "@crew/shared";
import { log } from "./log.js";
import { SOURCE_FILE, copySkillDir, readSkillDir } from "./skills.js";

/**
 * The skills StandBye ships with. They are ordinary Agent Skills folders under
 * `packages/supervisor/skills/`, copied onto the user shelf (`<dataDir>/skills/`) the first time
 * a supervisor starts, so a brand new install has a team that already knows how to review a diff,
 * debug a failure and ask the owner a decent question.
 *
 * After that first copy they are the owner's, not ours. The sync is deliberately timid:
 *
 *   deleted here      → stays deleted. The manifest remembers we installed it once.
 *   edited here       → left alone forever. The copy on disk records the hash we wrote; anything
 *                       else means a person or an agent changed it.
 *   untouched         → refreshed when the shipped version changes, so an app update improves them.
 *   name already used → left alone. A skill the owner installed keeps its name.
 *
 * Nothing here is StandBye-specific to the format: these folders can be copied out and used in
 * Claude Code or anywhere else that reads SKILL.md.
 */

/** Where the shipped folders live, next to dist/ in both the repo and the packaged app. */
export function bundledSkillsDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "skills");
}

/** `<dataDir>/bundled-skills.json` — which of them we have already put on the shelf. */
function manifestFile(dataDir: string): string {
  return path.join(dataDir, "bundled-skills.json");
}

interface Record_ {
  installedAt: string;
  syncedAt: string;
  /** The hash we wrote, so a later edit is visible. Mirrors `.standbye-source.json`'s version. */
  version: string;
}

type Manifest = Record<string, Record_>;

function readManifest(dataDir: string): Manifest {
  try { return JSON.parse(fs.readFileSync(manifestFile(dataDir), "utf8")) as Manifest; } catch { return {}; }
}

function writeManifest(dataDir: string, m: Manifest): void {
  fs.writeFileSync(manifestFile(dataDir), JSON.stringify(m, null, 2));
}

/**
 * A short digest of everything in a skill folder except our own provenance file, so an edit to
 * SKILL.md or to a bundled script is detected but re-recording the source is not.
 */
export function hashSkillDir(dir: string): string {
  const h = crypto.createHash("sha256");
  const walk = (d: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === SOURCE_FILE || e.name === ".DS_Store") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p, prefix + e.name + "/"); continue; }
      h.update(prefix + e.name + "\0");
      try { h.update(fs.readFileSync(p)); } catch { /* unreadable file: the name alone still changes the hash */ }
    }
  };
  walk(dir, "");
  return h.digest("hex").slice(0, 16);
}

/** What the shelf copy claims about itself. null when it was not put there by us. */
function bundledVersionOf(dir: string): string | null {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, SOURCE_FILE), "utf8")) as Partial<SkillSource>;
    return s.kind === "bundled" ? s.version ?? null : null;
  } catch { return null; }
}

export interface BundledSyncResult {
  installed: string[];
  updated: string[];
  /** On the shelf but not ours to touch: the owner edited it, or the name was already taken. */
  kept: string[];
  /** Installed once and since deleted by the owner. We leave it deleted. */
  removed: string[];
}

/**
 * Put the shipped skills on the user shelf. Safe to call on every start; it only writes when
 * something is genuinely new or when an untouched copy is out of date.
 */
export function syncBundledSkills(dataDir: string, from = bundledSkillsDir()): BundledSyncResult {
  const out: BundledSyncResult = { installed: [], updated: [], kept: [], removed: [] };
  if (!fs.existsSync(from)) return out;

  const shelf = path.join(dataDir, "skills");
  const manifest = readManifest(dataDir);
  let dirty = false;
  const now = new Date().toISOString();

  for (const entry of fs.readdirSync(from, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const src = path.join(from, entry.name);
    const skill = readSkillDir(src, "user", null);
    if (!skill || skill.errors.length) { log(`bundled skill ${entry.name} is unusable: ${skill?.errors[0] ?? "no SKILL.md"}`); continue; }

    const dest = path.join(shelf, skill.name);
    const shipped = hashSkillDir(src);
    const record = manifest[skill.name];

    if (!fs.existsSync(dest)) {
      // Never re-add what the owner took off the shelf. Removing a skill is how they say no.
      if (record) { out.removed.push(skill.name); continue; }
      install(shelf, src, dest, shipped, now);
      manifest[skill.name] = { installedAt: now, syncedAt: now, version: shipped };
      dirty = true;
      out.installed.push(skill.name);
      continue;
    }

    const claimed = bundledVersionOf(dest);
    // Either the owner installed something else under this name, or they edited our copy. Theirs now.
    if (claimed === null || claimed !== hashSkillDir(dest)) { out.kept.push(skill.name); continue; }
    if (claimed === shipped) {
      if (record) { manifest[skill.name] = { ...record, syncedAt: now }; dirty = true; }
      continue;
    }
    install(shelf, src, dest, shipped, now);
    manifest[skill.name] = { installedAt: record?.installedAt ?? now, syncedAt: now, version: shipped };
    dirty = true;
    out.updated.push(skill.name);
  }

  if (dirty) writeManifest(dataDir, manifest);
  const said = [
    out.installed.length && `installed ${out.installed.join(", ")}`,
    out.updated.length && `updated ${out.updated.join(", ")}`,
    out.kept.length && `left ${out.kept.length} edited copy(s) alone`,
    out.removed.length && `${out.removed.length} stay removed`,
  ].filter(Boolean);
  if (said.length) log(`bundled skills: ${said.join("; ")}`);
  return out;
}

function install(shelf: string, src: string, dest: string, version: string, now: string): void {
  fs.mkdirSync(shelf, { recursive: true });
  copySkillDir(src, dest);
  const source: SkillSource = { kind: "bundled", ref: null, subpath: null, version, installedAt: now, updatedAt: now };
  fs.writeFileSync(path.join(dest, SOURCE_FILE), JSON.stringify(source, null, 2));
}
