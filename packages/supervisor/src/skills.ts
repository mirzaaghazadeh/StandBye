import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type {
  EffectiveSkill, Skill, SkillCandidate, SkillInstallKind, SkillOrigin, SkillScope, SkillSource, SkillSourceKind, SkillSourceScan, SkillTarget,
} from "@crew/shared";
import { log } from "./log.js";

/**
 * Skills, in the Agent Skills format (agentskills.io): one folder per skill, holding a
 * SKILL.md whose YAML frontmatter carries `name` and `description`, plus whatever
 * scripts/, references/ and assets/ it needs. Nothing here is StandBye-specific, so a skill
 * from Claude Code or a GitHub repo drops straight in, and a skill written here can be
 * copied out and used anywhere else.
 *
 * The point of the format is progressive disclosure: only the name and the description are
 * in the agent's prompt. The body is read when the agent decides the skill applies — by the
 * Claude runner's own Skill tool, or by `use_skill` on any other model.
 */

const IGNORED_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", ".DS_Store"]);
const RESOURCE_LIMIT = 200;
/** Provenance we keep beside SKILL.md. Dotted so it never looks like part of the skill. */
export const SOURCE_FILE = ".standbye-source.json";

// ---------------------------------------------------------------- frontmatter

export interface Frontmatter {
  [key: string]: string | Record<string, string>;
}

/**
 * Split a SKILL.md into frontmatter and body.
 *
 * Deliberately a small YAML subset — scalars, block scalars and a one-level map — rather than
 * a YAML dependency: that is the whole of what the Agent Skills spec allows in frontmatter,
 * and anything richer would be a file we should reject rather than quietly accept.
 */
export function parseFrontmatter(text: string): { data: Frontmatter; body: string; found: boolean } {
  const norm = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(norm);
  if (!m) return { data: {}, body: norm.trim(), found: false };
  const data: Frontmatter = {};
  const lines = (m[1] ?? "").split("\n");
  let i = 0;
  const peek = (): string => lines[i] ?? "";
  while (i < lines.length) {
    const line = lines[i] ?? "";
    i++;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1] ?? "";
    const rest = (kv[2] ?? "").trim();

    if (/^[|>][-+]?$/.test(rest)) {
      const fold = rest.startsWith(">");
      const block: string[] = [];
      while (i < lines.length && (peek().trim() === "" || /^\s/.test(peek()))) block.push(lines[i++] ?? "");
      const indents = block.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length);
      const indent = indents.length ? Math.min(...indents) : 0;
      data[key] = block.map((l) => l.slice(indent)).join(fold ? " " : "\n").trim();
      continue;
    }
    if (rest === "") {
      // Either a nested map (metadata:) or a block list (allowed-tools:\n  - Read).
      const map: Record<string, string> = {};
      const items: string[] = [];
      while (i < lines.length && /^\s+\S/.test(peek())) {
        const child = (lines[i] ?? "").trim();
        i++;
        const item = /^-[ \t]+(.*)$/.exec(child);
        if (item) { items.push(unquote(item[1] ?? "")); continue; }
        const cm = /^([A-Za-z0-9_.-]+):[ \t]*(.*)$/.exec(child);
        if (cm) map[cm[1] ?? ""] = unquote(cm[2] ?? "");
      }
      data[key] = items.length ? items.join(" ") : map;
      continue;
    }
    if (rest.startsWith("[") && rest.endsWith("]")) {
      data[key] = rest.slice(1, -1).split(",").map((s) => unquote(s.trim())).filter(Boolean).join(" ");
      continue;
    }
    data[key] = unquote(rest);
  }
  return { data, body: norm.slice(m[0].length).trim(), found: true };
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Write frontmatter back out. Values are put on one line, so newlines and the angle brackets the spec warns about are stripped. */
export function renderSkillMd(fm: { name: string; description: string; license?: string | null; compatibility?: string | null; allowedTools?: string | null; metadata?: Record<string, string> }, body: string): string {
  const lines = ["---", `name: ${oneLine(fm.name)}`, `description: ${oneLine(fm.description)}`];
  if (fm.license) lines.push(`license: ${oneLine(fm.license)}`);
  if (fm.compatibility) lines.push(`compatibility: ${oneLine(fm.compatibility)}`);
  if (fm.allowedTools) lines.push(`allowed-tools: ${oneLine(fm.allowedTools)}`);
  const meta = Object.entries(fm.metadata ?? {}).filter(([, v]) => v);
  if (meta.length) {
    lines.push("metadata:");
    for (const [k, v] of meta) lines.push(`  ${k}: ${oneLine(v)}`);
  }
  lines.push("---", "", body.trim(), "");
  return lines.join("\n");
}

/** The spec forbids angle brackets in frontmatter: they can inject instructions into the system prompt. */
function oneLine(v: string): string {
  return v.replace(/\s+/g, " ").replace(/[<>]/g, "").trim();
}

// ---------------------------------------------------------------- names

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSkillName(name: string): boolean {
  return name.length > 0 && name.length <= 64 && NAME_RE.test(name);
}

/** Turn anything a person or a model typed into a legal skill name. */
export function normalizeSkillName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .replace(/-$/, "");
}

// ---------------------------------------------------------------- reading

/** List the bundled files of a skill, relative to its folder, so the model can be told what it may open. */
function bundledFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, prefix: string, depth: number): void => {
    if (depth > 3 || out.length >= RESOURCE_LIMIT) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= RESOURCE_LIMIT) return;
      if (IGNORED_DIRS.has(e.name) || e.name.startsWith(".") || (depth === 0 && e.name === "SKILL.md")) continue;
      if (e.isDirectory()) walk(path.join(d, e.name), prefix + e.name + "/", depth + 1);
      else out.push(prefix + e.name);
    }
  };
  walk(dir, "", 0);
  return out;
}

function readSource(dir: string, fallbackKind: SkillSourceKind, mtime: string): SkillSource {
  const p = path.join(dir, SOURCE_FILE);
  if (fs.existsSync(p)) {
    try {
      const s = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<SkillSource>;
      return {
        kind: (s.kind ?? fallbackKind) as SkillSourceKind, ref: s.ref ?? null, subpath: s.subpath ?? null,
        version: s.version ?? null, installedAt: s.installedAt ?? mtime, updatedAt: s.updatedAt ?? mtime,
      };
    } catch { /* fall through to the default */ }
  }
  return { kind: fallbackKind, ref: null, subpath: null, version: null, installedAt: mtime, updatedAt: mtime };
}

function writeSource(dir: string, source: SkillSource): void {
  fs.writeFileSync(path.join(dir, SOURCE_FILE), JSON.stringify(source, null, 2));
}

/** Read one skill folder. Returns null when there is no SKILL.md; a skill with problems comes back with `errors` set. */
export function readSkillDir(dir: string, scope: SkillScope, ownerId: string | null): Skill | null {
  const file = path.join(dir, "SKILL.md");
  if (!fs.existsSync(file)) return null;
  let raw: string;
  let updatedAt: string;
  try {
    raw = fs.readFileSync(file, "utf8");
    updatedAt = fs.statSync(file).mtime.toISOString();
  } catch { return null; }

  const folder = path.basename(dir);
  const { data, body, found } = parseFrontmatter(raw);
  const errors: string[] = [];
  if (!found) errors.push("No YAML frontmatter. A skill needs `---` delimited `name` and `description` at the top of SKILL.md.");

  // The folder name is what every loader keys on, so it wins over a frontmatter name that disagrees.
  const name = isValidSkillName(folder) ? folder : normalizeSkillName(str(data.name) ?? folder);
  if (!isValidSkillName(name)) errors.push(`"${folder}" is not a usable skill name (lowercase letters, numbers and single hyphens).`);
  const declared = str(data.name);
  if (declared && declared !== name) errors.push(`Frontmatter name "${declared}" does not match the folder "${folder}".`);

  const description = str(data.description) ?? "";
  if (!description) errors.push("No `description`. Agents pick a skill by its description, so a skill without one is never used.");
  if (description.length > 1024) errors.push("The description is longer than the 1024 characters the format allows.");
  if (!body) errors.push("SKILL.md has no instructions under the frontmatter.");

  const metadata = typeof data.metadata === "object" && data.metadata !== null ? (data.metadata as Record<string, string>) : {};

  return {
    scope, ownerId, name, description, content: raw, body, dir,
    files: bundledFiles(dir),
    license: str(data.license), compatibility: str(data.compatibility), allowedTools: str(data["allowed-tools"]),
    metadata,
    source: readSource(dir, "manual", updatedAt),
    updatedAt, errors,
  };
}

/** Every skill on one shelf, by folder name. */
export function readSkillRoot(root: string, scope: SkillScope, ownerId: string | null): Skill[] {
  if (!fs.existsSync(root)) return [];
  const out: Skill[] = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const s = readSkillDir(path.join(root, e.name), scope, ownerId);
    if (s) out.push(s);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- discovering skills in a source

/** Find every skill folder inside a directory: the folder itself, `skills/<name>/`, or a repo full of them. */
export function findSkillDirs(root: string, maxDepth = 4): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth || found.length >= 200) return;
    if (fs.existsSync(path.join(dir, "SKILL.md"))) { found.push(dir); return; } // its subfolders are resources
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || IGNORED_DIRS.has(e.name)) continue;
      if (e.name.startsWith(".") && e.name !== ".claude") continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return found.sort();
}

// ---------------------------------------------------------------- fetching a source

export interface FetchedSource {
  /** Local directory holding the skills. */
  dir: string;
  version: string | null;
  cleanup: () => void;
}

/**
 * Put a source on local disk. Folders and Claude Code's own directories are used in place;
 * git repos are cloned shallow and zips are expanded into a temp dir that the caller drops.
 */
export function fetchSource(kind: SkillInstallKind, ref: string): FetchedSource {
  if (kind === "folder" || kind === "claude-code") {
    const dir = path.resolve(expandHome(ref));
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`${dir} is not a folder`);
    return { dir, version: null, cleanup: () => undefined };
  }
  if (kind === "zip") {
    const file = path.resolve(expandHome(ref));
    if (!fs.existsSync(file)) throw new Error(`${file} does not exist`);
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "standbye-skill-zip-"));
    try {
      execFileSync("unzip", ["-q", "-o", file, "-d", dest], { stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
    } catch (e) {
      fs.rmSync(dest, { recursive: true, force: true });
      throw new Error(`Could not unpack ${path.basename(file)}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { dir: unwrapSingleFolder(dest), version: null, cleanup: () => fs.rmSync(dest, { recursive: true, force: true }) };
  }

  const { url, branch, subpath } = parseGitRef(ref);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "standbye-skill-git-"));
  try {
    execFileSync("git", ["clone", "--depth", "1", "--quiet", ...(branch ? ["--branch", branch] : []), url, dest], { stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
  } catch (e) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw new Error(`Could not clone ${url}: ${lastLine(e)}`);
  }
  let version: string | null = null;
  try { version = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: dest, encoding: "utf8", timeout: 10_000 }).trim(); } catch { /* shallow clone without a head is still usable */ }
  const dir = subpath ? path.join(dest, subpath) : dest;
  if (!fs.existsSync(dir)) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw new Error(`${url} has no path "${subpath}"`);
  }
  return { dir, version, cleanup: () => fs.rmSync(dest, { recursive: true, force: true }) };
}

/**
 * Accept every form a person is likely to paste:
 *   anthropics/skills                                     → the repo
 *   anthropics/skills/document-skills/pdf                 → one skill in it
 *   https://github.com/owner/repo/tree/main/skills/pdf    → the GitHub page they were looking at
 *   git@github.com:owner/repo.git#v2                      → an explicit ref
 */
export function parseGitRef(ref: string): { url: string; branch: string | null; subpath: string | null } {
  let rest = ref.trim();
  let branch: string | null = null;
  const hash = rest.lastIndexOf("#");
  if (hash > 0) { branch = rest.slice(hash + 1) || null; rest = rest.slice(0, hash); }
  rest = rest.replace(/\.git\/?$/, (m) => (m.endsWith("/") ? ".git" : m));

  const web = /^https?:\/\/(github\.com|gitlab\.com)\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(?:tree|blob|-\/tree|-\/blob)\/([^/]+)(?:\/(.*))?)?\/?$/.exec(rest);
  if (web) {
    return { url: `https://${web[1]}/${web[2]}/${web[3]}.git`, branch: branch ?? web[4] ?? null, subpath: web[5] ? decodeURIComponent(web[5]) : null };
  }
  if (/^(https?:\/\/|git@|ssh:\/\/)/.test(rest)) return { url: rest, branch, subpath: null };

  const short = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)(?:\/(.+))?$/.exec(rest);
  if (short) return { url: `https://github.com/${short[1]}/${short[2]}.git`, branch, subpath: short[3] ?? null };
  throw new Error(`"${ref}" is not a repository. Use owner/repo, a GitHub URL, or a git URL.`);
}

/** A zip of a skill usually holds one top-level folder; step into it so paths line up. */
function unwrapSingleFolder(dir: string): string {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith("__MACOSX") && !e.name.startsWith("."));
  const only = entries.length === 1 ? entries[0] : undefined;
  if (only?.isDirectory() && !fs.existsSync(path.join(dir, "SKILL.md"))) return path.join(dir, only.name);
  return dir;
}

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

function lastLine(e: unknown): string {
  const text = e instanceof Error ? `${(e as { stderr?: Buffer }).stderr?.toString() ?? ""}\n${e.message}` : String(e);
  return text.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "unknown error";
}

// ---------------------------------------------------------------- copying

export function copySkillDir(from: string, to: string): void {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter: (src) => !IGNORED_DIRS.has(path.basename(src)) && path.basename(src) !== SOURCE_FILE,
  });
}

// ---------------------------------------------------------------- the library

export interface SkillRoots {
  /** Shared by every team. */
  user: string;
  /** This team. null for a crew with no team folder of its own. */
  team: string | null;
  teamId: string | null;
  /** `<agentDir>/skills` */
  agent: (agentId: string) => string;
  /** `<agentDir>` — where the generated plugin folder goes. */
  agentDir: (agentId: string) => string;
}

/**
 * Every skill this team can see, across the three scopes, plus install and upkeep.
 * One instance per Crew; the user shelf is shared because it lives in the global dir.
 */
export class SkillLibrary {
  /**
   * The source most recently fetched. Scanning and then installing is one action to the owner,
   * so holding the clone between them saves a second trip to the network and pins a git or zip
   * source to the commit they were shown. A folder on disk is read in place and stays live.
   */
  private recent: { key: string; fetched: FetchedSource; at: number } | null = null;
  private static readonly REUSE_MS = 5 * 60_000;

  constructor(private readonly roots: SkillRoots) {
    for (const root of [roots.user, roots.team]) if (root) migrateFlatSkills(root);
  }

  private open(kind: SkillInstallKind, ref: string, fresh = false): FetchedSource {
    const key = `${kind}:${ref}`;
    if (!fresh && this.recent?.key === key && Date.now() - this.recent.at < SkillLibrary.REUSE_MS) return this.recent.fetched;
    this.recent?.fetched.cleanup();
    this.recent = { key, fetched: fetchSource(kind, ref), at: Date.now() };
    return this.recent.fetched;
  }

  /** Drop the held clone. Called when the crew closes; a missed call only leaves a temp folder. */
  dispose(): void {
    this.recent?.fetched.cleanup();
    this.recent = null;
  }

  /** Absolute path of a shelf. Creating it is the caller's job; reads tolerate it being absent. */
  rootFor(target: SkillTarget): string {
    if (target.scope === "user") return this.roots.user;
    if (target.scope === "team") {
      if (!this.roots.team) throw new Error("This team has no folder yet");
      return this.roots.team;
    }
    if (!target.ownerId) throw new Error("An agent-scope skill needs an agent id");
    return this.roots.agent(target.ownerId);
  }

  /** Every folder a run may read from, so the workspace fence can let skill resources through. */
  readableRoots(): string[] {
    return [this.roots.user, this.roots.team].filter((r): r is string => Boolean(r));
  }

  list(target: SkillTarget): Skill[] {
    const root = this.rootFor(target);
    if (target.scope === "agent") migrateFlatSkills(root);
    return readSkillRoot(root, target.scope, target.scope === "team" ? this.roots.teamId : target.scope === "agent" ? target.ownerId ?? null : null);
  }

  /** The whole library for this team: user shelf, team shelf, and each agent's own. */
  all(agentIds: string[]): Skill[] {
    const out = [...this.list({ scope: "user" })];
    if (this.roots.team) out.push(...this.list({ scope: "team" }));
    for (const id of agentIds) out.push(...this.list({ scope: "agent", ownerId: id }));
    return out;
  }

  /**
   * What one agent actually gets. Agent beats team beats user on the same name, so an agent
   * can keep a sharper version of a shared skill without anyone editing the shared one.
   */
  effectiveFor(agent: { id: string; disabledSkills?: string[] }): EffectiveSkill[] {
    const disabled = new Set(agent.disabledSkills ?? []);
    const byName = new Map<string, EffectiveSkill>();
    for (const scope of ["user", "team", "agent"] as SkillScope[]) {
      if (scope === "team" && !this.roots.team) continue;
      for (const s of this.list({ scope, ownerId: agent.id })) {
        const prev = byName.get(s.name);
        byName.set(s.name, { ...s, enabled: !disabled.has(s.name), shadowed: prev ? [...prev.shadowed, prev.scope] : [] });
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The set an agent is actually offered on a run: in scope, switched on, and not broken. */
  usableFor(agent: { id: string; disabledSkills?: string[] }): EffectiveSkill[] {
    return this.effectiveFor(agent).filter((s) => s.enabled && s.errors.length === 0);
  }

  find(agent: { id: string; disabledSkills?: string[] }, name: string): EffectiveSkill | undefined {
    return this.usableFor(agent).find((s) => s.name === name);
  }

  /** Create or replace a skill from the app or from `learn_skill`. */
  save(target: SkillTarget, input: { name: string; description: string; body: string; license?: string | null; metadata?: Record<string, string>; source?: Partial<SkillSource> }): Skill {
    const name = normalizeSkillName(input.name);
    if (!isValidSkillName(name)) throw new Error(`"${input.name}" cannot be used as a skill name`);
    const root = this.rootFor(target);
    const dir = path.join(root, name);
    const existing = readSkillDir(dir, target.scope, target.ownerId ?? null);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), renderSkillMd({ name, description: input.description, license: input.license, metadata: input.metadata }, input.body));
    const now = new Date().toISOString();
    writeSource(dir, {
      kind: input.source?.kind ?? existing?.source.kind ?? "manual",
      ref: input.source?.ref ?? existing?.source.ref ?? null,
      subpath: input.source?.subpath ?? existing?.source.subpath ?? null,
      version: input.source?.version ?? existing?.source.version ?? null,
      installedAt: existing?.source.installedAt ?? now,
      updatedAt: now,
    });
    return readSkillDir(dir, target.scope, target.ownerId ?? null)!;
  }

  /** Save raw SKILL.md text as typed in the editor, so a hand-written frontmatter survives verbatim. */
  saveRaw(target: SkillTarget, name: string, content: string): Skill {
    const safe = normalizeSkillName(name);
    if (!isValidSkillName(safe)) throw new Error(`"${name}" cannot be used as a skill name`);
    const dir = path.join(this.rootFor(target), safe);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), content.endsWith("\n") ? content : content + "\n");
    const skill = readSkillDir(dir, target.scope, target.ownerId ?? null)!;
    writeSource(dir, { ...skill.source, updatedAt: new Date().toISOString() });
    return readSkillDir(dir, target.scope, target.ownerId ?? null)!;
  }

  remove(target: SkillTarget, name: string): void {
    const root = this.rootFor(target);
    const dir = path.resolve(root, normalizeSkillName(name));
    // Never let a crafted name walk out of the shelf it belongs to.
    if (path.dirname(dir) !== path.resolve(root)) throw new Error(`"${name}" is not a skill on that shelf`);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  /** Move a skill between shelves — an agent's own how-to promoted to the team, say. */
  move(from: SkillTarget, to: SkillTarget, name: string): Skill {
    const safe = normalizeSkillName(name);
    const src = path.join(this.rootFor(from), safe);
    if (!fs.existsSync(src)) throw new Error(`No skill "${safe}" to move`);
    const dest = path.join(this.rootFor(to), safe);
    // Moving a skill onto the shelf it is already on would copy it over itself and then delete it.
    if (path.resolve(src) === path.resolve(dest)) return readSkillDir(src, to.scope, to.ownerId ?? null)!;
    const source = readSkillDir(src, from.scope, from.ownerId ?? null)?.source;
    copySkillDir(src, dest);
    if (source) writeSource(dest, { ...source, updatedAt: new Date().toISOString() });
    fs.rmSync(src, { recursive: true, force: true });
    return readSkillDir(dest, to.scope, to.ownerId ?? null)!;
  }

  /** Look inside a source without installing anything, so the owner sees what they are about to get. */
  scan(kind: SkillInstallKind, ref: string, target: SkillTarget): SkillSourceScan {
    const fetched = this.open(kind, ref);
    const onShelf = new Set(this.list(target).map((s) => s.name));
    const candidates: SkillCandidate[] = findSkillDirs(fetched.dir).map((dir) => {
      const s = readSkillDir(dir, target.scope, target.ownerId ?? null)!;
      return {
        name: s.name, description: s.description,
        subpath: path.relative(fetched.dir, dir),
        files: s.files.length, errors: s.errors,
        conflictsWith: onShelf.has(s.name) ? target.scope : null,
      };
    });
    return { kind, ref, version: fetched.version, candidates };
  }

  /** Copy skills out of a source onto a shelf. `names` limits it; omitted means everything valid. */
  install(kind: SkillInstallKind, ref: string, target: SkillTarget, names?: string[], fresh = false): { installed: Skill[]; skipped: { name: string; reason: string }[] } {
    const fetched = this.open(kind, ref, fresh);
    const installed: Skill[] = [];
    const skipped: { name: string; reason: string }[] = [];
    const root = this.rootFor(target);
    fs.mkdirSync(root, { recursive: true });
    const dirs = findSkillDirs(fetched.dir);
    if (!dirs.length) throw new Error("No SKILL.md found in that source.");
    const now = new Date().toISOString();
    for (const dir of dirs) {
      const found = readSkillDir(dir, target.scope, target.ownerId ?? null)!;
      if (names && !names.includes(found.name)) continue;
      if (found.errors.length) { skipped.push({ name: found.name, reason: found.errors[0] ?? "unusable" }); continue; }
      const dest = path.join(root, found.name);
      copySkillDir(dir, dest);
      writeSource(dest, { kind, ref, subpath: path.relative(fetched.dir, dir) || null, version: fetched.version, installedAt: now, updatedAt: now });
      installed.push(readSkillDir(dest, target.scope, target.ownerId ?? null)!);
    }
    log(`installed ${installed.length} skill(s) from ${kind} ${ref} into ${target.scope}`);
    return { installed, skipped };
  }

  /** Re-pull one installed skill from wherever it came from. */
  update(target: SkillTarget, name: string): Skill {
    const skill = readSkillDir(path.join(this.rootFor(target), normalizeSkillName(name)), target.scope, target.ownerId ?? null);
    if (!skill) throw new Error(`No skill "${name}" on that shelf`);
    const { kind, ref } = skill.source;
    if (kind === "bundled") throw new Error(`"${name}" ships with StandBye and updates when the app does. Edit it here and it stays yours.`);
    if (!ref || kind === "manual" || kind === "learned") throw new Error(`"${name}" was written here, so there is nothing to update it from.`);
    // Always refetch: "update" is a request for whatever is there now, not for a held copy.
    const out = this.install(kind as SkillInstallKind, ref, target, [skill.name], true);
    const fresh = out.installed[0];
    if (!fresh) throw new Error(out.skipped[0]?.reason ?? `"${name}" is no longer in ${ref}`);
    return fresh;
  }

  /**
   * Build the plugin folder the Claude Agent SDK loads, one per agent. Skills are linked, not
   * copied, so editing a skill in the app changes what the next run sees. Falls back to copying
   * where symlinks are not allowed.
   */
  buildPlugin(agentId: string, skills: Skill[]): string | null {
    if (!skills.length) return null;
    const dir = path.join(this.roots.agentDir(agentId), ".skillset");
    const skillsDir = path.join(dir, "skills");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: PLUGIN_NAME, version: "1.0.0", description: "Skills this agent has been given." }, null, 2));
    for (const s of skills) {
      const link = path.join(skillsDir, s.name);
      try { fs.symlinkSync(s.dir, link, "dir"); }
      catch { try { fs.cpSync(s.dir, link, { recursive: true, dereference: true }); } catch { /* skip the one skill, keep the rest */ } }
    }
    return dir;
  }
}

/** The plugin the Claude runner mounts. Its skills are addressed as `skills:<name>`. */
export const PLUGIN_NAME = "skills";

export function pluginSkillId(name: string): string {
  return `${PLUGIN_NAME}:${name}`;
}

/**
 * Skills used to be single files (`skills/<name>.md`) with no metadata. Fold them into the
 * folder format on first read so nothing an agent learned before this release is lost.
 */
export function migrateFlatSkills(root: string): void {
  if (!fs.existsSync(root)) return;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".md") || e.name === "SKILL.md") continue;
    const name = normalizeSkillName(e.name.replace(/\.md$/, ""));
    if (!isValidSkillName(name)) continue;
    const from = path.join(root, e.name);
    const dir = path.join(root, name);
    try {
      const raw = fs.readFileSync(from, "utf8");
      const { data, body, found } = parseFrontmatter(raw);
      fs.mkdirSync(dir, { recursive: true });
      const description = str(data.description) ?? firstLine(body) ?? `How to ${name.replace(/-/g, " ")}.`;
      fs.writeFileSync(path.join(dir, "SKILL.md"), found ? raw : renderSkillMd({ name, description }, body));
      writeSource(dir, { kind: "learned", ref: null, subpath: null, version: null, installedAt: fs.statSync(from).mtime.toISOString(), updatedAt: new Date().toISOString() });
      fs.rmSync(from);
      log(`migrated skill ${name} to the folder format`);
    } catch (err) {
      log(`could not migrate skill ${e.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** A one-sentence description salvaged from a skill body that never had one. */
function firstLine(body: string): string | null {
  const line = body.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
  return line ? line.replace(/[<>]/g, "").slice(0, 300) : null;
}

// ---------------------------------------------------------------- what is already on this Mac

/**
 * Places this Mac already keeps Agent Skills. Claude Code uses the same format, so anything
 * the owner installed there can be brought in with one click instead of hunted down by path.
 */
export function skillOrigins(workspaceRoot?: string | null): SkillOrigin[] {
  const home = os.homedir();
  const roots: { label: string; path: string }[] = [
    { label: "Claude Code — your skills", path: path.join(home, ".claude", "skills") },
  ];
  const pluginsDir = path.join(home, ".claude", "plugins");
  if (fs.existsSync(pluginsDir)) {
    for (const marketplace of safeDirs(pluginsDir)) {
      if (marketplace === "repos" || marketplace === ".trash") continue;
      const mp = path.join(pluginsDir, marketplace);
      if (fs.existsSync(path.join(mp, "skills"))) roots.push({ label: `Claude Code plugin — ${marketplace}`, path: path.join(mp, "skills") });
      for (const plugin of safeDirs(mp)) {
        const p = path.join(mp, plugin, "skills");
        if (fs.existsSync(p)) roots.push({ label: `Claude Code plugin — ${plugin}`, path: p });
      }
    }
  }
  if (workspaceRoot) {
    const p = path.join(workspaceRoot, ".claude", "skills");
    if (fs.existsSync(p)) roots.push({ label: "This workspace — .claude/skills", path: p });
  }
  return roots
    .map((r) => ({ ...r, count: fs.existsSync(r.path) ? findSkillDirs(r.path, 2).length : 0 }))
    .filter((r) => r.count > 0);
}

function safeDirs(dir: string): string[] {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name); } catch { return []; }
}
