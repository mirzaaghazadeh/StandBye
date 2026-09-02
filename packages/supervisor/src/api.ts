import { WebSocketServer, WebSocket } from "ws";
import fs from "node:fs";
import path from "node:path";
import type { AgentConfig, AgentFiles, PushEvent, RpcRequest, RpcResponse, TeamDraft } from "@crew/shared";
import { TeamDraftSchema } from "@crew/shared";
import { draftTeam } from "./builder.js";
import type { Crew } from "./crew.js";
import type { Scheduler } from "./scheduler.js";
import { TEAM_TOOLS, type ToolContext } from "./tools/team-tools.js";
import { DEFAULTS } from "./config.js";

type Handler = (params: any) => Promise<unknown> | unknown; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Local WebSocket JSON-RPC. The desktop app is one client; the stdio MCP bridge is another. */
export class Api {
  private readonly wss: WebSocketServer;
  private readonly handlers: Record<string, Handler>;

  constructor(private readonly crew: Crew, private readonly scheduler: Scheduler, port: number, private readonly token: string) {
    this.handlers = this.buildHandlers();
    this.wss = new WebSocketServer({ host: "127.0.0.1", port });
    this.wss.on("connection", (ws, req) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.searchParams.get("token") !== this.token) { ws.close(4001, "bad token"); return; }
      ws.on("message", (raw) => void this.onMessage(ws, raw.toString()));
      this.send(ws, { event: "supervisor.status", data: crew.status() });
    });
    crew.bus.onAny((e) => this.broadcast(e));
    console.error(`[crew] api listening on ws://127.0.0.1:${port}`);
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

  private async onMessage(ws: WebSocket, raw: string): Promise<void> {
    let req: RpcRequest;
    try { req = JSON.parse(raw) as RpcRequest; } catch { return; }
    const handler = this.handlers[req.method];
    if (!handler) { this.send(ws, { id: req.id, error: { code: -32601, message: `Unknown method ${req.method}` } }); return; }
    try {
      const result = await handler(req.params ?? {});
      this.send(ws, { id: req.id, result: result ?? null });
    } catch (e) {
      this.send(ws, { id: req.id, error: { code: -32000, message: e instanceof Error ? e.message : String(e) } });
    }
  }

  private buildHandlers(): Record<string, Handler> {
    const { crew, scheduler } = this;
    const q = scheduler.queue;
    return {
      // ----- status & keys -----
      "status.get": () => crew.status(),
      "keys.set": (p: { anthropic?: string; openrouter?: string }) => { crew.setKeys(p); return crew.keyStatus(); },
      "keys.get": () => crew.keyStatus(),
      "supervisor.pauseAll": () => { crew.pausedAll = true; q.cancelAll(); crew.bus.emit("agents.updated", crew.listAgents()); return crew.status(); },
      "supervisor.resumeAll": () => { crew.pausedAll = false; crew.bus.emit("agents.updated", crew.listAgents()); scheduler.tick(); return crew.status(); },

      // ----- team -----
      "team.get": () => crew.team,
      "team.update": (p: Partial<AgentConfig> & Record<string, unknown>) => crew.updateTeam(p),
      "team.create": (p: { draft: TeamDraft; workspaceRoot: string | null; ownerName: string }) => {
        const draft = TeamDraftSchema.parse(p.draft);
        const team = crew.createTeamFromDraft(draft, { workspaceRoot: p.workspaceRoot, ownerName: p.ownerName });
        scheduler.rebuildCrons();
        scheduler.tick();
        return team;
      },
      "team.delete": () => { q.cancelAll(); crew.store.deleteTeam(); crew.db.deleteAllChannels(); crew.team = null; crew.bus.emit("team.updated", null); crew.bus.emit("agents.updated", []); return null; },
      "builder.draft": async (p: { description: string; ownerName: string; workspaceRoot: string | null }) =>
        draftTeam(crew, { ...p, workspaceSummary: p.workspaceRoot ? summarizeWorkspace(p.workspaceRoot) : undefined }),

      // ----- agents -----
      "agents.list": () => crew.listAgents(),
      "agent.get": (p: { id: string }) => crew.getAgent(p.id),
      "agent.update": (p: { id: string; patch: Partial<AgentConfig> }) => { const a = crew.updateAgent(p.id, p.patch); scheduler.rebuildCrons(); return a; },
      "agent.files.get": (p: { id: string }) => crew.store.readAgentFiles(p.id),
      "agent.files.set": (p: { id: string; file: keyof AgentFiles; content: string }) => { crew.store.writeAgentFile(p.id, p.file, p.content); crew.bus.emit("agent.updated", crew.getAgent(p.id)); return crew.store.readAgentFiles(p.id); },
      "agent.pause": (p: { id: string }) => { const a = crew.updateAgent(p.id, { paused: true }); if (a.currentRunId) q.cancel(a.currentRunId); return a; },
      "agent.resume": (p: { id: string }) => { const a = crew.updateAgent(p.id, { paused: false }); scheduler.tick(); return a; },
      "agent.delete": (p: { id: string }) => { const a = crew.getAgent(p.id); if (a.currentRunId) q.cancel(a.currentRunId); crew.store.deleteAgent(p.id); crew.bus.emit("agents.updated", crew.listAgents()); return null; },
      "agent.wake": (p: { id: string; prompt: string }) => q.enqueue(p.id, { kind: "manual", prompt: p.prompt }),
      "agent.checkin": (p: { id: string }) => q.enqueue(p.id, { kind: "heartbeat" }),

      // ----- channels & messages -----
      "channels.list": () => crew.listChannels(),
      "messages.list": (p: { channelId: string; limit?: number; before?: string }) => crew.db.listMessages(p.channelId, p.limit ?? 100, p.before),
      "messages.send": (p: { channelId: string; text: string }) => crew.postMessage({ channel: p.channelId, authorId: "user", text: p.text }),

      // ----- questions -----
      "questions.list": (p: { status?: string; toId?: string; limit?: number }) => crew.db.listQuestions(p),
      "questions.answer": (p: { id: string; answer: string; remember?: boolean }) => crew.answerQuestion(p.id, p.answer, "user", p.remember ?? false),
      "questions.dismiss": (p: { id: string }) => crew.dismissQuestion(p.id),
      "decisions.list": () => crew.db.listDecisions(100),

      // ----- runs -----
      "runs.list": (p: { agentId?: string; since?: string; limit?: number }) => crew.db.listRuns(p),
      "run.get": (p: { id: string }) => ({ run: crew.db.getRun(p.id), steps: crew.db.listSteps(p.id) }),
      "run.cancel": (p: { id: string }) => q.cancel(p.id),
      "spend.get": () => crew.spend(),

      // ----- external agents (stdio MCP bridge) -----
      "tools.list": () => TEAM_TOOLS.map((t) => ({ name: t.name, description: t.description })),
      "tools.call": async (p: { agentId: string; tool: string; args: Record<string, unknown>; runId?: string }) => {
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
        const text = await t.handler(p.args as never, ctx);
        return { text, runId: run.id };
      },
      "defaults.get": () => DEFAULTS,
    };
  }
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
