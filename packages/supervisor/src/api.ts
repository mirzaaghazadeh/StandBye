import { log } from "./log.js";
import { WebSocketServer, WebSocket } from "ws";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AgentConfig, AgentDraft, AgentFiles, GitSettings, Provider, ProviderConfig, PushEvent, RpcRequest, RpcResponse, SkillInstallKind, SkillScope, SkillTarget, TeamConfig, TeamDraft } from "@crew/shared";
import { AgentDraftSchema, PROVIDERS, providerSpec, TeamDraftSchema } from "@crew/shared";
import { probeProvider } from "./providers.js";
import { previewCommand } from "./runners/cli.js";
import { skillOrigins } from "./skills.js";
import { draftTeam } from "./builder.js";
import { defaultGitSettings, gitInfo } from "./git.js";
import type { Crew } from "./crew.js";
import type { Hub } from "./hub.js";
import { listModels } from "./models.js";
import { TEAM_TOOLS, type ToolContext } from "./tools/team-tools.js";
import { DEFAULTS } from "./config.js";

interface Conn {
  ws: WebSocket;
  teamId: string | null;
}

type Handler = (params: any, conn: Conn) => Promise<unknown> | unknown; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Local WebSocket JSON-RPC. Each connection selects a team; team-scoped methods act on it.
 * Events from every team are broadcast with their teamId so the client can filter.
 */
export class Api {
  private readonly wss: WebSocketServer;
  private readonly handlers: Record<string, Handler>;

  constructor(private readonly hub: Hub, port: number, private readonly token: string) {
    this.handlers = this.buildHandlers();
    this.wss = new WebSocketServer({ host: "127.0.0.1", port });
    this.wss.on("connection", (ws, req) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.searchParams.get("token") !== this.token) { ws.close(4001, "bad token"); return; }
      const conn: Conn = { ws, teamId: hub.first()?.crew.id ?? null };
      ws.on("message", (raw) => void this.onMessage(conn, raw.toString()));
      this.send(ws, { event: "teams.updated", data: hub.list() });
    });
    hub.onEvent((e) => this.broadcast(e));
    log(`api listening on ws://127.0.0.1:${port}`);
  }

  close(): void {
    this.wss.close();
  }

  private send(ws: WebSocket, msg: PushEvent | RpcResponse): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
  private broadcast(e: PushEvent): void {
    const payload = JSON.stringify(e);
    for (const c of this.wss.clients) if (c.readyState === WebSocket.OPEN) c.send(payload);
  }

  private async onMessage(conn: Conn, raw: string): Promise<void> {
    let req: RpcRequest;
    try { req = JSON.parse(raw) as RpcRequest; } catch { return; }
    const handler = this.handlers[req.method];
    if (!handler) { this.send(conn.ws, { id: req.id, error: { code: -32601, message: `Unknown method ${req.method}` } }); return; }
    try {
      const result = await handler(req.params ?? {}, conn);
      this.send(conn.ws, { id: req.id, result: result ?? null });
    } catch (e) {
      this.send(conn.ws, { id: req.id, error: { code: -32000, message: e instanceof Error ? e.message : String(e) } });
    }
  }

  private crewFor(conn: Conn): Crew {
    const rt = conn.teamId ? this.hub.get(conn.teamId) : undefined;
    if (!rt) throw new Error("No team selected");
    return rt.crew;
  }
  private rtFor(conn: Conn) {
    const rt = conn.teamId ? this.hub.get(conn.teamId) : undefined;
    if (!rt) throw new Error("No team selected");
    return rt;
  }

  private buildHandlers(): Record<string, Handler> {
    const { hub } = this;
    return {
      // ----- global -----
      /** Keys arrive keyed by provider id; the desktop app holds them in the OS keychain. */
      "keys.set": (p: Record<string, string>) => { hub.setKeys(p); return hub.settingsCrew().keyStatus(); },
      "keys.get": () => hub.settingsCrew().keyStatus(),
      "providers.get": () => hub.settingsCrew().providerStatus(),
      "providers.set": (p: Record<string, Partial<ProviderConfig>>) => hub.settingsCrew().setProviders(p),
      /** The whole catalog, so the settings screen and the model picker need no copy of it. */
      "providers.catalog": () => PROVIDERS,
      /**
       * Try the credentials for one provider and say plainly whether they work. Cheap by
       * design: a model list for an API, `--version` for a CLI, a credentials file for a cloud.
       */
      "providers.test": async (p: { id: string; config?: Partial<ProviderConfig> }) => {
        const crew = hub.settingsCrew();
        return probeProvider(p.id, { ...crew.providerConfig(p.id), ...(p.config ?? {}) }, crew.keys);
      },
      /** The exact command line an agent on a CLI provider will run, for the settings screen. */
      "providers.command": (p: { id: string }) => {
        const spec = providerSpec(p.id);
        if (!spec?.cli) return "";
        const cfg = hub.settingsCrew().providerConfig(p.id);
        return previewCommand(spec, cfg, cfg.defaultModel);
      },
      "models.list": (p: { force?: boolean }) => listModels(hub.settingsCrew(), p.force ?? false),
      "defaults.get": () => DEFAULTS,
      "agents.all": () => hub.allAgents(),

      // ----- teams -----
      "teams.list": () => hub.list(),
      "teams.select": (p: { id: string }, conn) => { if (!hub.get(p.id)) throw new Error(`Unknown team ${p.id}`); conn.teamId = p.id; return hub.get(p.id)!.crew.team; },
      "teams.create": (p: { draft: TeamDraft; workspaceRoot: string | null; ownerName: string; git?: GitSettings | null }, conn) => {
        const draft = TeamDraftSchema.parse(p.draft);
        const rt = hub.createTeam(draft, { workspaceRoot: p.workspaceRoot, ownerName: p.ownerName, git: p.git ?? null });
        conn.teamId = rt.crew.id;
        return rt.crew.team;
      },
      "teams.delete": (p: { id: string; removeFiles?: boolean }, conn) => { hub.deleteTeam(p.id, p.removeFiles ?? true); if (conn.teamId === p.id) conn.teamId = hub.first()?.crew.id ?? null; return conn.teamId; },
      /** Open a project folder. Returns the team it holds, or null so the caller can offer to create one. */
      "teams.openFolder": (p: { path: string }, conn) => {
        const rt = hub.openFolder(p.path);
        if (!rt) return null;
        conn.teamId = rt.crew.id;
        return rt.crew.team;
      },
      // ----- backlog -----
      "backlog.list": (_p, conn) => this.crewFor(conn).backlog.list(),
      "backlog.add": (p: { title: string; detail?: string; rationale?: string; size?: "small" | "medium" | "large" }, conn) =>
        this.crewFor(conn).backlog.add({ ...p, addedBy: "user", status: "ready" }),
      "backlog.update": (p: { id: string; patch: Record<string, unknown> }, conn) => this.crewFor(conn).backlog.update(p.id, p.patch as never),
      "backlog.remove": (p: { id: string }, conn) => { this.crewFor(conn).backlog.update(p.id, { status: "dropped", outcome: "Removed by the owner" }); return true; },

      /** Does this folder already hold a team? Lets the UI choose between opening and creating. */
      "teams.probeFolder": (p: { path: string }) => hub.probeFolder(p.path),
      /** Take a team off the list: it stops working, keeps everything, and can be put back. */
      "teams.archive": (p: { id: string }, conn) => {
        const row = hub.archiveTeam(p.id);
        if (conn.teamId === p.id) conn.teamId = hub.first()?.crew.id ?? null;
        return row;
      },
      "teams.restore": (p: { id: string }, conn) => { const rt = hub.restoreTeam(p.id); conn.teamId = rt.crew.id; return rt.crew.team; },
      "teams.archived": () => hub.archived(),
      "builder.draft": async (p: { description: string; ownerName: string; workspaceRoot: string | null; provider?: Provider; mode?: "describe" | "template" }) =>
        draftTeam(hub.settingsCrew(), { ...p, workspaceSummary: p.workspaceRoot ? summarizeWorkspace(p.workspaceRoot) : undefined }),

      // ----- selected team -----
      "status.get": (_p, conn) => (conn.teamId && hub.get(conn.teamId) ? this.crewFor(conn).status() : emptyStatus(hub)),
      "team.get": (_p, conn) => (conn.teamId ? this.crewFor(conn).team : null),
      "team.update": (p: Partial<TeamConfig>, conn) => { const t = this.crewFor(conn).updateTeam(p); hub.touched(); return t; },
      "supervisor.pauseAll": (_p, conn) => { const { crew, scheduler } = this.rtFor(conn); crew.pausedAll = true; scheduler.queue.cancelAll(); crew.bus.emit("agents.updated", crew.listAgents()); hub.touched(); return crew.status(); },
      "supervisor.resumeAll": (_p, conn) => { const { crew, scheduler } = this.rtFor(conn); crew.pausedAll = false; crew.bus.emit("agents.updated", crew.listAgents()); scheduler.tick(); hub.touched(); return crew.status(); },

      // ----- agents -----
      "agents.list": (_p, conn) => (conn.teamId ? this.crewFor(conn).listAgents() : []),
      /**
       * Hire someone into a team that already exists. Until this, an agent could only be created
       * when the team was first built or by another agent proposing a hire the owner approved —
       * so the owner could not simply add the teammate they knew they wanted.
       */
      "agents.create": (p: { draft: AgentDraft }, conn) => {
        const { crew, scheduler } = this.rtFor(conn);
        const draft = AgentDraftSchema.parse(p.draft);
        if (crew.listAgents().some((a) => a.name.toLowerCase() === draft.name.trim().toLowerCase())) {
          throw new Error(`This team already has someone called ${draft.name}.`);
        }
        const agent = crew.createAgent(draft);
        scheduler.rebuildCrons();
        scheduler.tick();
        hub.touched();
        return agent;
      },
      "agent.get": (p: { id: string }, conn) => this.crewFor(conn).getAgent(p.id),
      "agent.update": (p: { id: string; patch: Partial<AgentConfig> }, conn) => { const { crew, scheduler } = this.rtFor(conn); const a = crew.updateAgent(p.id, p.patch); scheduler.rebuildCrons(); return a; },
      "agent.files.get": (p: { id: string }, conn) => this.crewFor(conn).store.readAgentFiles(p.id),
      "agent.files.set": (p: { id: string; file: keyof AgentFiles; content: string }, conn) => { const crew = this.crewFor(conn); crew.store.writeAgentFile(p.id, p.file, p.content); crew.bus.emit("agent.updated", crew.getAgent(p.id)); return crew.store.readAgentFiles(p.id); },
      "agent.skills.list": (p: { id: string }, conn) => this.crewFor(conn).skills.effectiveFor(this.crewFor(conn).getAgent(p.id)),
      "agent.skills.toggle": (p: { id: string; name: string; enabled: boolean }, conn) => {
        const crew = this.crewFor(conn);
        const current = new Set(crew.getAgent(p.id).disabledSkills ?? []);
        if (p.enabled) current.delete(p.name); else current.add(p.name);
        return crew.updateAgent(p.id, { disabledSkills: [...current].sort() });
      },
      "agent.pause": (p: { id: string }, conn) => { const { crew, scheduler } = this.rtFor(conn); const a = crew.updateAgent(p.id, { paused: true }); if (a.currentRunId) scheduler.queue.cancel(a.currentRunId); return a; },
      "agent.resume": (p: { id: string }, conn) => { const { crew, scheduler } = this.rtFor(conn); const a = crew.updateAgent(p.id, { paused: false }); scheduler.tick(); return a; },
      "agent.delete": (p: { id: string }, conn) => { const { crew, scheduler } = this.rtFor(conn); const a = crew.getAgent(p.id); if (a.currentRunId) scheduler.queue.cancel(a.currentRunId); crew.store.deleteAgent(p.id); crew.bus.emit("agents.updated", crew.listAgents()); hub.touched(); return null; },
      "agent.wake": (p: { id: string; prompt: string }, conn) => this.rtFor(conn).scheduler.queue.enqueue(p.id, { kind: "manual", prompt: p.prompt }),
      "agent.checkin": (p: { id: string }, conn) => this.rtFor(conn).scheduler.queue.enqueue(p.id, { kind: "heartbeat" }),

      // ----- skills -----
      // Scope is part of every call: "user" is the shelf every team sees, "team" this team,
      // "agent" one agent's own. Reads never throw on a missing shelf; writes create it.
      "skills.list": (p: { scope?: SkillScope; ownerId?: string | null }, conn) => {
        const crew = this.crewFor(conn);
        if (p.scope) return crew.skills.list({ scope: p.scope, ownerId: p.ownerId ?? null });
        return crew.skills.all(crew.listAgents().map((a) => a.id));
      },
      "skills.get": (p: SkillTarget & { name: string }, conn) => this.crewFor(conn).skills.list(p).find((s) => s.name === p.name) ?? null,
      "skills.save": (p: SkillTarget & { name: string; description?: string; body?: string; content?: string }, conn) => {
        const crew = this.crewFor(conn);
        const s = p.content !== undefined
          ? crew.skills.saveRaw(p, p.name, p.content)
          : crew.skills.save(p, { name: p.name, description: p.description ?? "", body: p.body ?? "" });
        crew.bus.emit("skills.updated", null);
        return s;
      },
      "skills.delete": (p: SkillTarget & { name: string }, conn) => { const crew = this.crewFor(conn); crew.skills.remove(p, p.name); crew.bus.emit("skills.updated", null); return null; },
      "skills.move": (p: { from: SkillTarget; to: SkillTarget; name: string }, conn) => { const crew = this.crewFor(conn); const s = crew.skills.move(p.from, p.to, p.name); crew.bus.emit("skills.updated", null); return s; },
      "skills.scan": (p: { kind: SkillInstallKind; ref: string; scope: SkillScope; ownerId?: string | null }, conn) => this.crewFor(conn).skills.scan(p.kind, p.ref, { scope: p.scope, ownerId: p.ownerId ?? null }),
      "skills.install": (p: { kind: SkillInstallKind; ref: string; scope: SkillScope; ownerId?: string | null; names?: string[] }, conn) => {
        const crew = this.crewFor(conn);
        const out = crew.skills.install(p.kind, p.ref, { scope: p.scope, ownerId: p.ownerId ?? null }, p.names);
        crew.bus.emit("skills.updated", null);
        return out;
      },
      "skills.update": (p: SkillTarget & { name: string }, conn) => { const crew = this.crewFor(conn); const s = crew.skills.update(p, p.name); crew.bus.emit("skills.updated", null); return s; },
      /** Places on this Mac that already hold Agent Skills — Claude Code's folders and the workspace. */
      "skills.origins": (_p, conn) => skillOrigins(conn.teamId ? this.crewFor(conn).team?.workspaceRoot ?? null : null),

      // ----- channels & messages -----
      "channels.list": (_p, conn) => (conn.teamId ? this.crewFor(conn).listChannels() : []),
      "channels.create": (p: { name: string; purpose?: string; members?: string[] }, conn) => this.crewFor(conn).ensureChannel(p.name, p.purpose ?? "", p.members ?? []),
      "channels.update": (p: { id: string; purpose?: string; members?: string[] }, conn) => this.crewFor(conn).updateChannel(p.id, p),
      "channels.delete": (p: { id: string }, conn) => { this.crewFor(conn).deleteChannel(p.id); return null; },
      "git.info": (p: { path: string | null }) => gitInfo(p.path),
      "git.defaults": (p: { path: string | null }) => defaultGitSettings(gitInfo(p.path)),
      "messages.list": (p: { channelId: string; limit?: number; before?: string }, conn) => this.crewFor(conn).db.listMessages(p.channelId, p.limit ?? 100, p.before),
      "messages.search": (p: { q: string; channelId?: string; authorId?: string; since?: string; limit?: number }, conn) =>
        this.crewFor(conn).db.searchMessages(String(p.q ?? ""), { channelId: p.channelId, authorId: p.authorId, since: p.since, limit: p.limit }),
      "messages.send": (p: { channelId: string; text: string }, conn) => this.crewFor(conn).postMessage({ channel: p.channelId, authorId: "user", text: p.text }),

      // ----- questions -----
      "questions.list": (p: { status?: string; toId?: string; limit?: number }, conn) => (conn.teamId ? this.crewFor(conn).db.listQuestions(p) : []),
      "questions.answer": (p: { id: string; answer: string; remember?: boolean }, conn) => this.crewFor(conn).answerQuestion(p.id, p.answer, "user", p.remember ?? false),
      "questions.dismiss": (p: { id: string }, conn) => this.crewFor(conn).dismissQuestion(p.id),
      "decisions.list": (_p, conn) => (conn.teamId ? this.crewFor(conn).db.listDecisions(100) : []),

      // ----- runs -----
      "runs.list": (p: { agentId?: string; since?: string; limit?: number }, conn) => (conn.teamId ? this.crewFor(conn).db.listRuns(p) : []),
      "run.get": (p: { id: string }, conn) => { const crew = this.crewFor(conn); return { run: crew.db.getRun(p.id), steps: crew.db.listSteps(p.id) }; },
      "run.diff": (p: { id: string }, conn) => this.crewFor(conn).runDiff(p.id),
      "run.cancel": (p: { id: string }, conn) => this.rtFor(conn).scheduler.queue.cancel(p.id),
      "spend.get": (_p, conn) => (conn.teamId ? this.crewFor(conn).spend() : { todayUsd: 0, capUsd: 0, perAgent: {}, checkinsUsd: 0 }),

      // ----- external agents (stdio MCP bridge) -----
      "tools.list": () => TEAM_TOOLS.map((t) => ({ name: t.name, description: t.description })),
      "tools.call": async (p: { teamId?: string; agentId: string; tool: string; args: Record<string, unknown>; runId?: string }, conn) => {
        const rt = p.teamId ? hub.get(p.teamId) : conn.teamId ? hub.get(conn.teamId) : hub.first();
        if (!rt) throw new Error("No team");
        const crew = rt.crew;
        const t = TEAM_TOOLS.find((x) => x.name === p.tool);
        if (!t) throw new Error(`Unknown tool ${p.tool}`);
        const agent = crew.findAgent(p.agentId);
        if (!agent) throw new Error(`Unknown agent ${p.agentId}`);
        let run = p.runId ? crew.db.getRun(p.runId) : undefined;
        if (!run) {
          run = crew.createRun(agent.id, { kind: "manual", prompt: "External session" }, "external");
          crew.updateRun(run, { status: "running", startedAt: new Date().toISOString() });
        }
        const ctx: ToolContext = { crew, agentId: agent.id, run, depth: 0, onDone: (s, st) => { crew.finishRun(run!, st === "noop" ? "noop" : st === "needs_you" ? "needs_you" : "done", s); } };
        // These args come from an external client, not from a runner that already validated them.
        // Checking them here turns a bad call into a message that client can act on, rather than
        // a crash inside a tool handler.
        const parsed = z.object(t.schema).safeParse(p.args ?? {});
        if (!parsed.success) throw new Error(`Bad arguments for ${t.name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message.toLowerCase()}`).join("; ")}`);
        const text = await t.handler(parsed.data as never, ctx);
        return { text, runId: run.id };
      },
    };
  }
}

function emptyStatus(hub: Hub) {
  return { teamId: null, startedAt: hub.startedAt, pausedAll: false, runningRuns: 0, runsToday: 0, keys: hub.settingsCrew().keyStatus(), nextWake: null };
}

function summarizeWorkspace(root: string): string {
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => !e.name.startsWith(".") && e.name !== "node_modules").map((e) => (e.isDirectory() ? e.name + "/" : e.name)).slice(0, 60);
    const readme = ["README.md", "readme.md", "README"].map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
    const head = readme ? fs.readFileSync(readme, "utf8").slice(0, 1500) : "";
    const pkg = fs.existsSync(path.join(root, "package.json")) ? "package.json: " + fs.readFileSync(path.join(root, "package.json"), "utf8").slice(0, 600) : "";
    const py = fs.existsSync(path.join(root, "pyproject.toml")) ? "pyproject.toml: " + fs.readFileSync(path.join(root, "pyproject.toml"), "utf8").slice(0, 600) : "";
    return [`Files: ${entries.join(", ")}`, head && `README:\n${head}`, pkg, py].filter(Boolean).join("\n\n");
  } catch (e) {
    return `Could not read workspace: ${e instanceof Error ? e.message : String(e)}`;
  }
}
