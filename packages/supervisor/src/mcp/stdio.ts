#!/usr/bin/env node
/**
 * Standalone team MCP server over stdio. Lets any MCP client (Claude Code, Codex, an editor)
 * join the team as one of its agents: post in channels, ask the owner, take tasks.
 *
 *   CREW_AGENT=kai CREW_PORT=47311 CREW_TOKEN=... crew-team-mcp
 *
 * It is a thin bridge: every tool call is forwarded to the running supervisor over its WebSocket API.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import WebSocket from "ws";
import { z } from "zod";
import { TEAM_TOOLS } from "../tools/team-tools.js";

const port = process.env.CREW_PORT ?? "47311";
const token = process.env.CREW_TOKEN ?? "dev";
const agentId = process.env.CREW_AGENT;
const teamId = process.env.CREW_TEAM; // optional; defaults to the first team
if (!agentId) {
  console.error("CREW_AGENT is required (the agent id this session acts as)");
  process.exit(1);
}

let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`);
const ready = new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString()) as { id?: number; result?: unknown; error?: { message: string } };
  if (typeof msg.id !== "number") return;
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.error) p.reject(new Error(msg.error.message));
  else p.resolve(msg.result);
});

async function rpc<T>(method: string, params: unknown): Promise<T> {
  await ready;
  return new Promise<T>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

let runId: string | undefined;
const server = new McpServer({ name: "crew-team", version: "1.0.0" });
for (const t of TEAM_TOOLS) {
  server.registerTool(t.name, { description: t.description, inputSchema: z.object(t.schema) }, async (args: Record<string, unknown>) => {
    const res = await rpc<{ text: string; runId: string }>("tools.call", { teamId, agentId, tool: t.name, args, runId });
    runId = res.runId;
    return { content: [{ type: "text" as const, text: res.text }] };
  });
}

await server.connect(new StdioServerTransport());
