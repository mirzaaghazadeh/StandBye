import { log } from "./log.js";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Agent, GitSettings, PushEvent, TeamDraft, TeamSummary } from "@crew/shared";
import { Crew, type Keys } from "./crew.js";
import { Scheduler } from "./scheduler.js";
import type { SupervisorOptions } from "./config.js";

interface TeamRuntime {
  crew: Crew;
  scheduler: Scheduler;
  unsubscribe: () => void;
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

  constructor(readonly opts: SupervisorOptions) {
    fs.mkdirSync(this.teamsDir, { recursive: true });
    this.migrateLegacy();
    for (const d of fs.readdirSync(this.teamsDir, { withFileTypes: true })) {
      if (d.isDirectory() && fs.existsSync(path.join(this.teamsDir, d.name, "team.json"))) this.load(d.name);
    }
  }

  get teamsDir(): string {
    return path.join(this.opts.dataDir, "teams");
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

  private load(id: string): TeamRuntime {
    const crew = new Crew({ dataDir: path.join(this.teamsDir, id), globalDir: this.opts.dataDir, keys: this.keys });
    const scheduler = new Scheduler(crew);
    const unsubscribe = crew.bus.onAny((e) => this.emit({ ...e, teamId: id } as PushEvent));
    const rt = { crew, scheduler, unsubscribe };
    this.teams.set(id, rt);
    scheduler.start();
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
          agentCount: agents.length, working: agents.filter((a) => a.status === "working").length, needsYou: agents.filter((a) => a.status === "needs_you").length,
          spendTodayUsd: rt.crew.spend().todayUsd, pausedAll: rt.crew.pausedAll, createdAt: rt.crew.team?.createdAt ?? "",
        };
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  createTeam(draft: TeamDraft, opts: { workspaceRoot: string | null; ownerName: string; git?: GitSettings | null }): TeamRuntime {
    const id = nanoid(8);
    const dir = path.join(this.teamsDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const crew = new Crew({ dataDir: dir, globalDir: this.opts.dataDir, keys: this.keys });
    crew.createTeamFromDraft(draft, { ...opts, id });
    crew.close();
    const rt = this.load(id);
    rt.scheduler.tick();
    this.emitTeams();
    return rt;
  }
  deleteTeam(id: string): void {
    const rt = this.teams.get(id);
    if (!rt) return;
    rt.scheduler.stop();
    rt.unsubscribe();
    rt.crew.close();
    this.teams.delete(id);
    fs.rmSync(path.join(this.teamsDir, id), { recursive: true, force: true });
    this.emitTeams();
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
    return new Crew({ dataDir: path.join(this.opts.dataDir, ".scratch"), globalDir: this.opts.dataDir, keys: this.keys });
  }
  stop(): void {
    for (const rt of this.teams.values()) { rt.scheduler.stop(); rt.crew.close(); }
  }
}
