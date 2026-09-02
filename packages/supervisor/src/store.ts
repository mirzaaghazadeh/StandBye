import fs from "node:fs";
import path from "node:path";
import type { AgentConfig, AgentFiles, Skill, TeamConfig } from "@crew/shared";

/**
 * Agents are folders. Everything a person would want to read or edit by hand
 * lives as a file; only runtime state lives in SQLite.
 *
 *   <dataDir>/team.json
 *   <dataDir>/agents/<id>/agent.json
 *   <dataDir>/agents/<id>/SOUL.md
 *   <dataDir>/agents/<id>/RULES.md
 *   <dataDir>/agents/<id>/MEMORY.md
 *   <dataDir>/agents/<id>/skills/
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
  listSkills(id: string): Skill[] {
    const dir = path.join(this.agentDir(id), "skills");
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => ({ name: f.replace(/\.md$/, ""), content: fs.readFileSync(path.join(dir, f), "utf8"), updatedAt: fs.statSync(path.join(dir, f)).mtime.toISOString() }));
  }
  writeSkill(id: string, name: string, content: string): Skill {
    const dir = path.join(this.agentDir(id), "skills");
    fs.mkdirSync(dir, { recursive: true });
    const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "skill";
    fs.writeFileSync(path.join(dir, safe + ".md"), content.trim() + "\n");
    return { name: safe, content: content.trim() + "\n", updatedAt: new Date().toISOString() };
  }
  deleteSkill(id: string, name: string): void {
    const p = path.join(this.agentDir(id), "skills", name + ".md");
    if (fs.existsSync(p)) fs.rmSync(p);
  }
}
