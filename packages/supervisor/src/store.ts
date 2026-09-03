import fs from "node:fs";
import path from "node:path";
import type { AgentConfig, AgentFiles, Channel, TeamConfig } from "@crew/shared";

/**
 * Agents are folders. Everything a person would want to read or edit by hand
 * lives as a file; only runtime state lives in SQLite.
 *
 *   <dataDir>/team.json
 *   <dataDir>/skills/<name>/SKILL.md        skills every agent on this team gets
 *   <dataDir>/agents/<id>/agent.json
 *   <dataDir>/agents/<id>/SOUL.md
 *   <dataDir>/agents/<id>/RULES.md
 *   <dataDir>/agents/<id>/MEMORY.md
 *   <dataDir>/agents/<id>/skills/<name>/SKILL.md
 *
 * Skills themselves are owned by SkillLibrary (skills.ts), because they also live above a
 * single team, in the global dir.
 */
export class Store {
  constructor(readonly dataDir: string) {
    fs.mkdirSync(this.agentsDir, { recursive: true });
  }

  get agentsDir(): string {
    return path.join(this.dataDir, "agents");
  }
  agentDir(id: string): string {
    return path.join(this.agentsDir, id);
  }

  // ---- team ----
  readTeam(): TeamConfig | null {
    const p = path.join(this.dataDir, "team.json");
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as TeamConfig;
  }
  writeTeam(team: TeamConfig): void {
    fs.writeFileSync(path.join(this.dataDir, "team.json"), JSON.stringify(team, null, 2));
  }
  deleteTeam(): void {
    const p = path.join(this.dataDir, "team.json");
    if (fs.existsSync(p)) fs.rmSync(p);
    if (fs.existsSync(this.agentsDir)) fs.rmSync(this.agentsDir, { recursive: true, force: true });
    fs.mkdirSync(this.agentsDir, { recursive: true });
  }

  // ---- agents ----
  listAgentConfigs(): AgentConfig[] {
    if (!fs.existsSync(this.agentsDir)) return [];
    return fs
      .readdirSync(this.agentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(this.agentsDir, d.name, "agent.json")))
      .map((d) => JSON.parse(fs.readFileSync(path.join(this.agentsDir, d.name, "agent.json"), "utf8")) as AgentConfig)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  readAgentConfig(id: string): AgentConfig | null {
    const p = path.join(this.agentDir(id), "agent.json");
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as AgentConfig;
  }
  writeAgentConfig(cfg: AgentConfig): void {
    const dir = this.agentDir(cfg.id);
    fs.mkdirSync(path.join(dir, "skills"), { recursive: true });
    fs.writeFileSync(path.join(dir, "agent.json"), JSON.stringify(cfg, null, 2));
  }
  deleteAgent(id: string): void {
    fs.rmSync(this.agentDir(id), { recursive: true, force: true });
  }

  readAgentFiles(id: string): AgentFiles {
    const dir = this.agentDir(id);
    const read = (f: string) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), "utf8") : "");
    return { soul: read("SOUL.md"), rules: read("RULES.md"), memory: read("MEMORY.md") };
  }
  writeAgentFile(id: string, file: keyof AgentFiles, content: string): void {
    const name = file === "soul" ? "SOUL.md" : file === "rules" ? "RULES.md" : "MEMORY.md";
    fs.mkdirSync(this.agentDir(id), { recursive: true });
    fs.writeFileSync(path.join(this.agentDir(id), name), content);
  }
  appendMemory(id: string, note: string): number {
    const p = path.join(this.agentDir(id), "MEMORY.md");
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const line = `- ${stamp} ${note.trim().replace(/\n+/g, " ")}\n`;
    if (!fs.existsSync(p)) fs.writeFileSync(p, "# Memory\n\nThings learned on the job. Newest at the bottom.\n\n");
    fs.appendFileSync(p, line);
    return this.memoryCount(id);
  }
  memoryCount(id: string): number {
    const p = path.join(this.agentDir(id), "MEMORY.md");
    if (!fs.existsSync(p)) return 0;
    return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.startsWith("- ")).length;
  }
  /** `<agentDir>/skills` — the agent's own shelf, in the Agent Skills folder format. */
  agentSkillsDir(id: string): string {
    return path.join(this.agentDir(id), "skills");
  }
  /** Skills every agent on this team gets. */
  get teamSkillsDir(): string {
    return path.join(this.dataDir, "skills");
  }

  // ---- channels ----
  //
  // The rooms a team talks in are part of how it is set up, so they belong in the team folder
  // next to the agents and travel with the project. What was *said* in them is history: that
  // stays in crew.db, which is git-ignored. Clone a repo and you get the team and its rooms,
  // not a transcript of someone else's week.

  private get channelsFile(): string {
    return path.join(this.dataDir, "channels.json");
  }

  /** The group channels this team is set up with. Direct chats are derived from the agents, so they are not listed. */
  readChannels(): Channel[] {
    try {
      const rows = JSON.parse(fs.readFileSync(this.channelsFile, "utf8")) as Channel[];
      return Array.isArray(rows) ? rows.filter((c) => c && c.kind !== "dm" && typeof c.id === "string") : [];
    } catch {
      return [];
    }
  }

  writeChannels(channels: Channel[]): void {
    const groups = channels
      .filter((c) => c.kind !== "dm")
      .map((c) => ({ id: c.id, name: c.name, purpose: c.purpose, members: c.members, kind: c.kind, dmAgentId: null }));
    fs.writeFileSync(this.channelsFile, JSON.stringify(groups, null, 2) + "\n");
  }
}
