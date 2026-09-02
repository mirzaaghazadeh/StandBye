import { createSdkMcpServer, query, tool, type PermissionResult, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RunStepKind } from "@crew/shared";
import { DEFAULTS } from "../config.js";
import { CHECKIN_TOOLS, TEAM_TOOLS, type AnyTeamTool, type ToolContext } from "../tools/team-tools.js";
import { gate } from "./approval.js";
import type { Runner } from "./types.js";

/**
 * Claude runner: the Claude Agent SDK gives us the full Claude Code harness (file tools, bash,
 * search, sessions). The team tools are mounted as an in-process MCP server named "team".
 */
export const anthropicRunner: Runner = async (input) => {
  const { crew, agent, run, mode, ctx, signal } = input;
  // With an API key we pass it through; without one the Claude Code CLI uses the Claude login on this machine.
  const apiKey = crew.keys.anthropic;
  if (!apiKey && !crew.hasClaudeLogin()) return { costUsd: 0, inputTokens: 0, outputTokens: 0, text: "", error: "No Anthropic API key and no Claude login found. Add a key in Settings or run `claude` once to sign in." };

  const tools: readonly AnyTeamTool[] =
    mode === "checkin"
      ? [...CHECKIN_TOOLS, ...TEAM_TOOLS.filter((t) => ["list_agents", "read_channel", "team_decisions", "done"].includes(t.name))]
      : TEAM_TOOLS;
  const team = teamServer(tools, ctx);

  const abort = new AbortController();
  signal.addEventListener("abort", () => abort.abort(), { once: true });

  let text = "";
  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let error: string | undefined;

  const canUseTool = async (toolName: string, toolInput: Record<string, unknown>): Promise<PermissionResult> => {
    if (toolName.startsWith("mcp__team__")) return { behavior: "allow" };
    const v = await gate(ctx, agent.permissions, toolName, toolInput, input.cwd);
    return v.ok ? { behavior: "allow" } : { behavior: "deny", message: v.message };
  };

  try {
    const q = query({
      prompt: input.prompt,
      options: {
        cwd: input.cwd,
        model: input.model,
        systemPrompt: { type: "custom", prompt: input.system },
        mcpServers: { team },
        permissionMode: "default",
        canUseTool,
        // Route every file/shell tool through canUseTool so the workspace fence and the team rules always apply.
        allowedTools: [],
        maxTurns: mode === "checkin" ? 8 : DEFAULTS.maxTurns,
        maxBudgetUsd: mode === "checkin" ? 0.25 : agent.budget.perRunUsd,
        settingSources: [],
        disallowedTools: mode === "checkin" ? ["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash", "WebFetch", "Task"] : ["Task"],
        env: { ...process.env, ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
        abortController: abort,
      },
    });

    for await (const msg of q) {
      handleMessage(crew, run.id, msg, (t) => (text = t));
      if (msg.type === "result") {
        costUsd = msg.total_cost_usd ?? 0;
        inputTokens = msg.usage?.input_tokens ?? 0;
        outputTokens = msg.usage?.output_tokens ?? 0;
        if (msg.subtype !== "success") error = `${msg.subtype}${"errors" in msg && msg.errors?.length ? ": " + msg.errors.join("; ") : ""}`;
        else if (msg.is_error) error = msg.result;
        else text = msg.result || text;
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return { costUsd, inputTokens, outputTokens, text, error };
};

function teamServer(tools: readonly AnyTeamTool[], ctx: ToolContext) {
  return createSdkMcpServer({
    name: "team",
    version: "1.0.0",
    instructions: "Talk to your team and the owner. Finish every run with `done`.",
    tools: tools.map((t) =>
      tool(t.name, t.description, t.schema, async (args) => {
        try {
          const out = await t.handler(args as never, ctx);
          return { content: [{ type: "text", text: out }] };
        } catch (e) {
          return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
        }
      }),
    ),
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function handleMessage(crew: { addStep: (runId: string, kind: RunStepKind, text: string, detail?: string | null) => void }, runId: string, msg: SDKMessage, setText: (t: string) => void): void {
  if (msg.type !== "assistant") return;
  const content: any[] = (msg as any).message?.content ?? [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      setText(block.text);
      crew.addStep(runId, "text", block.text.trim());
    } else if (block.type === "tool_use") {
      const name: string = block.name ?? "";
      const inp: Record<string, unknown> = block.input ?? {};
      if (name.startsWith("mcp__team__")) continue; // the tool handlers log their own steps
      const [kind, text] = describeTool(name, inp);
      crew.addStep(runId, kind, text, JSON.stringify(inp).slice(0, 4000));
    }
  }
}

export function describeTool(name: string, inp: Record<string, unknown>): [RunStepKind, string] {
  const p = (k: string) => (typeof inp[k] === "string" ? (inp[k] as string) : "");
  switch (name) {
    case "Read": return ["read", p("file_path")];
    case "Glob": return ["read", `glob ${p("pattern")}`];
    case "Grep": return ["read", `grep ${p("pattern")}`];
    case "Edit": case "MultiEdit": case "Write": case "NotebookEdit": return ["edit", p("file_path")];
    case "Bash": {
      const cmd = p("command");
      return [/^git\b/.test(cmd) ? "git" : "run", cmd];
    }
    case "WebFetch": return ["read", p("url")];
    case "WebSearch": return ["read", `search ${p("query")}`];
    default: return ["tool", name];
  }
}
