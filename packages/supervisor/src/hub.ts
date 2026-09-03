import { log } from "./log.js";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Agent, ArchivedTeam, GitSettings, PushEvent, TeamDraft, TeamSummary } from "@crew/shared";
import { TEAM_DIR_NAME } from "@crew/shared";
import { Crew, type Keys } from "./crew.js";
import { syncBundledSkills } from "./bundled-skills.js";
import { Scheduler } from "./scheduler.js";
import type { SupervisorOptions } from "./config.js";

interface TeamRuntime {
  crew: Crew;
  scheduler: Scheduler;
  unsubscribe: () => void;
}

/**
 * What a team keeps out of its project's git history. The definition is worth committing — the
 * charter, the agents, their souls, rules, memory and skills — so a teammate who clones the repo
 * gets the team. What is ignored is either this machine's own business (the database, the logs)
 * or regenerated on every run (`.skillset`, the plugin folder of symlinks the Claude runner builds).
 */
const TEAM_IGNORE = ["crew.db", "crew.db-wal", "crew.db-shm", "logs/", "agents/*/.skillset/", ""];

/** Write the team's .gitignore, and top up an older one that predates a rule rather than clobbering it. */
function writeTeamIgnore(dir: string): void {
  const file = path.join(dir, ".gitignore");
  let current: string[] = [];
  try { current = fs.readFileSync(file, "utf8").split("\n"); } catch { /* not written yet */ }
  const missing = TEAM_IGNORE.filter((line) => line && !current.includes(line));
  if (!missing.length && current.length) return;
  fs.writeFileSync(file, [...current.filter((l) => l.trim()), ...missing, ""].join("\n"));
}

/** Rename where we can; fall back to copy-then-remove when the two paths are on different volumes. */
function move(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
  } catch {
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

/** The team id in a folder, without opening its database. Null when the folder holds no readable team. */
function peekId(dir: string): string | null {
  try { return (JSON.parse(fs.readFileSync(path.join(dir, "team.json"), "utf8")) as { id?: string }).id ?? null; } catch { return null; }
}

/**
 * Holds every team. Each team is a folder under <dataDir>/teams/<id> with its own database,
 * agents and workspace, and runs its own scheduler, so all teams keep working at once.
 * Keys and provider settings are shared.
 */
export class Hub {
  readonly keys: Keys = {};
  readonly startedAt = new Date().toISOString();
  private readonly teams = new Map<string, TeamRuntime>();
  private readonly listeners = new Set<(e: PushEvent) => void>();

  /** teamId -> the folder that team's files live in. */
  private readonly dirs = new Map<string, string>();

  constructor(readonly opts: SupervisorOptions) {
    fs.mkdirSync(this.teamsDir, { recursive: true });
    // The shelf every team reads from, seeded before any crew opens it. A failure here must never
    // stop a supervisor from starting: the teams matter, the shipped how-tos are a convenience.
    try { syncBundledSkills(this.opts.dataDir); } catch (e) { log(`could not sync the bundled skills: ${e instanceof Error ? e.message : String(e)}`); }
    this.migrateLegacy();
    this.adoptProjectTeams();
    const archived = new Set(this.archiveIndex().map((a) => a.id));
    for (const d of fs.readdirSync(this.teamsDir, { withFileTypes: true })) {
      const dir = path.join(this.teamsDir, d.name);
      if (!d.isDirectory() || !fs.existsSync(path.join(dir, "team.json"))) continue;
      if (archived.has(peekId(dir) ?? "")) continue; // taken off the list; nothing schedules it
      this.load(dir);
    }
    // Teams that live inside a project folder. The registry only remembers where to look;
    // the folder itself is the source of truth, so a team survives being moved with its repo.
    for (const ws of this.registry()) {
      const dir = path.join(ws, TEAM_DIR_NAME);
      if (!fs.existsSync(path.join(dir, "team.json"))) { log(`workspace ${ws} no longer holds a team; forgetting it`); this.forget(ws); continue; }
      if (archived.has(peekId(dir) ?? "")) continue;
      try { this.load(dir); } catch (e) { log(`could not open the team in ${ws}: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }

  get teamsDir(): string {
    return path.join(this.opts.dataDir, "teams");
  }
  private get registryFile(): string {
    return path.join(this.opts.dataDir, "workspaces.json");
  }
  /** Project folders known to hold a team. */
  private registry(): string[] {
    try { return JSON.parse(fs.readFileSync(this.registryFile, "utf8")) as string[]; } catch { return []; }
  }
  private remember(workspace: string): void {
    const next = [...new Set([...this.registry(), workspace])];
    fs.writeFileSync(this.registryFile, JSON.stringify(next, null, 2));
  }
  private forget(workspace: string): void {
    fs.writeFileSync(this.registryFile, JSON.stringify(this.registry().filter((w) => w !== workspace), null, 2));
  }
  private get archiveFile(): string {
    return path.join(this.opts.dataDir, "archived.json");
  }
  /** Teams the owner removed from the list. Stored as written; `present` is worked out on read. */
  private archiveIndex(): Omit<ArchivedTeam, "present">[] {
    try { return JSON.parse(fs.readFileSync(this.archiveFile, "utf8")) as Omit<ArchivedTeam, "present">[]; } catch { return []; }
  }
  private writeArchive(rows: Omit<ArchivedTeam, "present">[]): void {
    fs.writeFileSync(this.archiveFile, JSON.stringify(rows, null, 2));
  }
  dirOf(id: string): string {
    return this.dirs.get(id) ?? this.archiveIndex().find((a) => a.id === id)?.dir ?? path.join(this.teamsDir, id);
  }
  isPortable(id: string): boolean {
    return path.basename(this.dirOf(id)) === TEAM_DIR_NAME;
  }

  /** A pre-multi-team data dir had team.json, agents/ and crew.db at the root. Move them into teams/<id>/. */
  private migrateLegacy(): void {
    const legacy = path.join(this.opts.dataDir, "team.json");
    if (!fs.existsSync(legacy)) return;
    const team = JSON.parse(fs.readFileSync(legacy, "utf8")) as { id: string };
    const dest = path.join(this.teamsDir, team.id);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of ["team.json", "agents", "crew.db", "crew.db-wal", "crew.db-shm"]) {
      const from = path.join(this.opts.dataDir, f);
      if (fs.existsSync(from)) fs.renameSync(from, path.join(dest, f));
    }
    log(`migrated legacy team ${team.id} into teams/`);
  }

  /**
   * Teams made before teams lived in project folders sit under `<dataDir>/teams/<id>`, which
   * means they only exist on the Mac that made them. Any of them with a workspace is moved into
   * `<workspace>/.standbye` so it belongs to the project like every new team does. A team with
   * no workspace has no project to belong to, so it stays where it is.
   *
   * Nothing is copied on top of anything: a workspace that already holds a team is left alone.
   */
  private adoptProjectTeams(): void {
    if (!fs.existsSync(this.teamsDir)) return;
    for (const entry of fs.readdirSync(this.teamsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const from = path.join(this.teamsDir, entry.name);
      let team: { id?: string; name?: string; workspaceRoot?: string | null };
      try { team = JSON.parse(fs.readFileSync(path.join(from, "team.json"), "utf8")) as typeof team; } catch { continue; }
      const ws = team.workspaceRoot;
      if (!ws || !fs.existsSync(ws) || !fs.statSync(ws).isDirectory()) continue;
      const to = path.join(ws, TEAM_DIR_NAME);
      if (fs.existsSync(to)) { log(`${ws} already has a ${TEAM_DIR_NAME}; leaving ${team.name ?? entry.name} where it is`); continue; }
      try {
        move(from, to);
      } catch (e) {
        log(`could not move ${team.name ?? entry.name} into ${to}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      writeTeamIgnore(to);
      this.remember(ws);
      // An archived team keeps its record, but the record has to point at where it now lives.
      const rows = this.archiveIndex();
      const row = rows.find((a) => a.id === team.id);
      if (row) this.writeArchive(rows.map((a) => (a.id === row.id ? { ...a, dir: to, portable: true } : a)));
      log(`moved team ${team.name ?? entry.name} into ${to}; it now travels with the project`);
    }
  }

  /** Open the team whose files are in `dir`. The id comes from team.json, not from the path. */
  private load(dir: string): TeamRuntime {
    const crew = new Crew({ dataDir: dir, globalDir: this.opts.dataDir, keys: this.keys, api: { port: this.opts.port, token: this.opts.token } });
    const id = crew.id;
    if (!id) { crew.close(); throw new Error(`${dir} has no readable team.json`); }
    const existing = this.teams.get(id);
    if (existing) { crew.close(); return existing; } // already open, e.g. the folder was opened twice
    // However it was reached — restored, or the folder simply opened again — an open team is
    // not an archived one. Clearing it here keeps the two lists from ever disagreeing.
    if (this.archiveIndex().some((a) => a.id === id)) this.writeArchive(this.archiveIndex().filter((a) => a.id !== id));
    // A team in `<workspace>/.standbye` works on the folder it is sitting in, not on whatever
    // absolute path was recorded when it was made. Without this, cloning a repo (or moving it,
    // or opening it on another Mac) would leave the team pointed at the original checkout —
    // agents would read and edit the wrong project while looking perfectly healthy.
    if (path.basename(dir) === TEAM_DIR_NAME) {
      const workspace = path.dirname(dir);
      if (crew.team && crew.team.workspaceRoot !== workspace) {
        log(`team ${crew.team.name} now lives in ${workspace}; repointing it from ${crew.team.workspaceRoot ?? "(none)"}`);
        crew.updateTeam({ workspaceRoot: workspace });
      }
    }
    const scheduler = new Scheduler(crew);
    const unsubscribe = crew.bus.onAny((e) => this.emit({ ...e, teamId: id } as PushEvent));
    const rt = { crew, scheduler, unsubscribe };
    this.teams.set(id, rt);
    this.dirs.set(id, dir);
    scheduler.start();
    return rt;
  }

  /**
   * Open a project folder as a team, the way an editor opens a directory.
   * Returns the team when `<folder>/.standbye` holds one, and null when it does not,
   * which is the caller's cue to offer the new-team flow for that folder.
   */
  /** What is in this folder, without opening anything: used to pick between "open" and "create". */
  probeFolder(workspace: string): { hasTeam: boolean; name: string | null; agentCount: number; alreadyOpen: boolean; isRepo: boolean } {
    const dir = path.join(workspace, TEAM_DIR_NAME);
    const file = path.join(dir, "team.json");
    const isRepo = fs.existsSync(path.join(workspace, ".git"));
    if (!fs.existsSync(file)) return { hasTeam: false, name: null, agentCount: 0, alreadyOpen: false, isRepo };
    let name: string | null = null;
    try { name = (JSON.parse(fs.readFileSync(file, "utf8")) as { name?: string }).name ?? null; } catch { /* unreadable */ }
    const agentsDir = path.join(dir, "agents");
    const agentCount = fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length : 0;
    return { hasTeam: true, name, agentCount, alreadyOpen: [...this.dirs.values()].includes(dir), isRepo };
  }

  openFolder(workspace: string): TeamRuntime | null {
    const dir = path.join(workspace, TEAM_DIR_NAME);
    if (!fs.existsSync(path.join(dir, "team.json"))) return null;
    const already = [...this.dirs.entries()].find(([, d]) => d === dir);
    if (already) return this.teams.get(already[0]) ?? null;
    const rt = this.load(dir);
    this.remember(workspace);
    this.emitTeams();
    return rt;
  }

  // ---------- events ----------

  onEvent(l: (e: PushEvent) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit(e: PushEvent): void {
    for (const l of this.listeners) l(e);
  }
  private emitTeams(): void {
    this.emit({ event: "teams.updated", data: this.list() });
  }

  // ---------- teams ----------

  ids(): string[] {
    return [...this.teams.keys()];
  }
  get(id: string): TeamRuntime | undefined {
    return this.teams.get(id);
  }
  first(): TeamRuntime | undefined {
    return [...this.teams.values()].sort((a, b) => (a.crew.team?.createdAt ?? "").localeCompare(b.crew.team?.createdAt ?? ""))[0];
  }
  list(): TeamSummary[] {
    return [...this.teams.entries()]
      .map(([id, rt]) => {
        const agents = rt.crew.listAgents();
        return {
          id, name: rt.crew.team?.name ?? id, ownerName: rt.crew.team?.ownerName ?? "", workspaceRoot: rt.crew.team?.workspaceRoot ?? null,
          dir: this.dirOf(id), portable: this.isPortable(id),
          agentCount: agents.length, working: agents.filter((a) => a.status === "working").length, needsYou: agents.filter((a) => a.status === "needs_you").length,
          spendTodayUsd: rt.crew.spend().todayUsd, pausedAll: rt.crew.pausedAll, createdAt: rt.crew.team?.createdAt ?? "",
        };
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  /**
   * A team with a workspace is written into `<workspace>/.standbye` so it belongs to the project.
   * One without a workspace has nowhere to belong, so it stays under the app's data dir.
   */
  createTeam(draft: TeamDraft, opts: { workspaceRoot: string | null; ownerName: string; git?: GitSettings | null }): TeamRuntime {
    const id = nanoid(8);
    const portable = Boolean(opts.workspaceRoot);
    const dir = opts.workspaceRoot ? path.join(opts.workspaceRoot, TEAM_DIR_NAME) : path.join(this.teamsDir, id);
    if (portable && fs.existsSync(path.join(dir, "team.json"))) {
      throw new Error(`${opts.workspaceRoot} already has a team. Open the folder instead of creating a second one.`);
    }
    fs.mkdirSync(dir, { recursive: true });
    const crew = new Crew({ dataDir: dir, globalDir: this.opts.dataDir, keys: this.keys, api: { port: this.opts.port, token: this.opts.token } });
    crew.createTeamFromDraft(draft, { ...opts, id });
    crew.close();
    if (portable) {
      // The definition is worth committing; the history and logs are this machine's business.
      writeTeamIgnore(dir);
      this.remember(opts.workspaceRoot!);
    }
    const rt = this.load(dir);
    rt.scheduler.tick();
    this.emitTeams();
    return rt;
  }
  /**
   * `removeFiles: false` closes a project team and forgets where it was, leaving `.standbye`
   * on disk so the folder can be opened again later. That is the right default for something
   * that lives inside the user's own repo.
   */
  deleteTeam(id: string, removeFiles = true): void {
    const dir = this.dirOf(id);
    const portable = this.isPortable(id);
    const rt = this.teams.get(id);
    const workspace = rt?.crew.team?.workspaceRoot ?? this.archiveIndex().find((a) => a.id === id)?.workspaceRoot ?? null;
    if (!rt && !this.archiveIndex().some((a) => a.id === id)) return; // never heard of it
    if (rt) {
      rt.scheduler.stop();
      rt.unsubscribe();
      rt.crew.close();
      this.teams.delete(id);
      this.dirs.delete(id);
    }
    if (workspace && portable) this.forget(workspace);
    this.writeArchive(this.archiveIndex().filter((a) => a.id !== id));
    if (removeFiles) fs.rmSync(dir, { recursive: true, force: true });
    this.emitTeams();
  }

  // ---------- archive ----------

  /** Everything the owner has removed from the list, newest first. */
  archived(): ArchivedTeam[] {
    return this.archiveIndex()
      .map((a) => ({ ...a, present: fs.existsSync(path.join(a.dir, "team.json")) }))
      .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  }

  /**
   * Take a team off the list without touching a byte of its work. Its scheduler stops, so it
   * cannot wake, spend or run in the background, and it stays that way across restarts until
   * the owner puts it back.
   */
  archiveTeam(id: string): ArchivedTeam {
    const rt = this.teams.get(id);
    if (!rt) throw new Error(`Unknown team ${id}`);
    const dir = this.dirOf(id);
    const portable = this.isPortable(id);
    const workspace = rt.crew.team?.workspaceRoot ?? null;
    const row = {
      id, name: rt.crew.team?.name ?? id, dir, workspaceRoot: workspace, portable,
      agentCount: rt.crew.listAgents().length, archivedAt: new Date().toISOString(),
    };
    rt.scheduler.stop();
    rt.unsubscribe();
    rt.crew.close();
    this.teams.delete(id);
    this.dirs.delete(id);
    if (workspace && portable) this.forget(workspace);
    this.writeArchive([...this.archiveIndex().filter((a) => a.id !== id), row]);
    this.emitTeams();
    log(`archived team ${row.name} (${id}); its files stay in ${dir}`);
    return { ...row, present: true };
  }

  /** Put an archived team back on the list. It starts working again from where it left off. */
  restoreTeam(id: string): TeamRuntime {
    const row = this.archiveIndex().find((a) => a.id === id);
    if (!row) throw new Error(`${id} is not archived`);
    if (!fs.existsSync(path.join(row.dir, "team.json"))) {
      this.writeArchive(this.archiveIndex().filter((a) => a.id !== id));
      this.emitTeams();
      throw new Error(`${row.name} is no longer in ${row.dir}. It was moved or deleted, so it has been forgotten.`);
    }
    const rt = this.load(row.dir);
    if (row.portable && row.workspaceRoot) this.remember(row.workspaceRoot);
    this.writeArchive(this.archiveIndex().filter((a) => a.id !== id));
    rt.scheduler.tick();
    this.emitTeams();
    return rt;
  }
  touched(): void {
    this.emitTeams();
  }

  // ---------- cross-team ----------

  allAgents(): { teamId: string; teamName: string; agents: Agent[] }[] {
    return this.list().map((t) => ({ teamId: t.id, teamName: t.name, agents: this.teams.get(t.id)!.crew.listAgents() }));
  }
  setKeys(keys: Keys): void {
    Object.assign(this.keys, keys);
    for (const rt of this.teams.values()) rt.crew.bus.emit("supervisor.status", rt.crew.status());
  }
  /** Provider settings live in the global dir; any crew can read/write them. Use a throwaway crew when there are no teams. */
  settingsCrew(): Crew {
    const any = this.first()?.crew;
    if (any) return any;
    return new Crew({ dataDir: path.join(this.opts.dataDir, ".scratch"), globalDir: this.opts.dataDir, keys: this.keys, api: { port: this.opts.port, token: this.opts.token } });
  }
  stop(): void {
    for (const rt of this.teams.values()) { rt.scheduler.stop(); rt.crew.close(); }
  }
}
