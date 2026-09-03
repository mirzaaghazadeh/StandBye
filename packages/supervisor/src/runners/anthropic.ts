import { createSdkMcpServer, query, tool, type PermissionResult, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderConfig, ProviderSpec, RunStepKind } from "@crew/shared";
import { DEFAULTS } from "../config.js";
import { estimateCostUsd } from "../pricing.js";
import { childPath, providerBaseUrl, providerKey } from "../providers.js";
import { CHECKIN_TOOLS, TEAM_TOOLS, type AnyTeamTool, type ToolContext } from "../tools/team-tools.js";
import { gate } from "./approval.js";
import { pluginSkillId } from "../skills.js";
import { classifyFailure, classifyText, type FailureKind, type Runner } from "./types.js";

/**
 * The Claude runner: the Claude Agent SDK gives us the full Claude Code harness (file tools,
 * bash, search, skills, sessions). The team tools are mounted as an in-process MCP server
 * named "team".
 *
 * It drives every provider in the catalog whose kind is "claude", not just Anthropic's own
 * API. Claude Code reads its endpoint and credentials from the environment, so pointing it at
 * a coding plan that speaks the Anthropic Messages API — or at Bedrock, Vertex or Foundry — is
 * a matter of the variables built in `claudeEnv` below. The harness, the tools, the permission
 * gate and the skills are identical whichever one the agent is on.
 */
export const anthropicRunner: Runner = async (input) => {
  const { crew, agent, run, mode, ctx, signal, spec, config } = input;
  const apiKey = providerKey(spec, crew.keys);
  // Anthropic itself can run on the Claude Code login with no key at all; nobody else can.
  if (spec.auth === "login") {
    if (!apiKey && !crew.hasClaudeLogin()) {
      return { costUsd: 0, inputTokens: 0, outputTokens: 0, text: "", error: "No Anthropic API key and no Claude login found. Add a key in Settings or run `claude` once to sign in.", failure: "auth" };
    }
  } else if (spec.auth === "key" && !apiKey) {
    return { costUsd: 0, inputTokens: 0, outputTokens: 0, text: "", error: `No ${spec.name} API key. Paste one in Settings › Providers.`, failure: "auth" };
  }

  const tools: readonly AnyTeamTool[] =
    mode === "checkin"
      ? [...CHECKIN_TOOLS, ...TEAM_TOOLS.filter((t) => ["list_agents", "read_channel", "team_decisions", "done"].includes(t.name))]
      // `use_skill` is the fallback for models without a skill harness; here the SDK's own
      // Skill tool does the same job with real progressive disclosure, so offering both
      // would just be two ways to open the same file.
      : TEAM_TOOLS.filter((t) => t.name !== "use_skill");
  const team = teamServer(tools, ctx);

  // The agent's user-, team- and agent-scope skills, mounted as a local plugin. Skills are
  // addressed as `skills:<name>`; passing the list rather than "all" keeps Claude Code's own
  // bundled skills out of the context.
  const skills = mode === "checkin" ? [] : crew.skills.usableFor(agent);
  const pluginDir = mode === "checkin" ? null : crew.skills.buildPlugin(agent.id, skills);

  const abort = new AbortController();
  signal.addEventListener("abort", () => abort.abort(), { once: true });

  let text = "";
  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let error: string | undefined;
  let failure: FailureKind | undefined;

  const canUseTool = async (toolName: string, toolInput: Record<string, unknown>): Promise<PermissionResult> => {
    if (toolName.startsWith("mcp__team__")) return { behavior: "allow" };
    // Opening a skill the owner installed is not an action that needs approving; what the
    // skill then asks for still goes through the gate below.
    if (toolName === "Skill") return { behavior: "allow" };
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
        ...(pluginDir ? { plugins: [{ type: "local" as const, path: pluginDir, skipMcpDiscovery: true }] } : {}),
        skills: skills.map((s) => pluginSkillId(s.name)),
        permissionMode: "default",
        canUseTool,
        // Route every file/shell tool through canUseTool so the workspace fence and the team rules always apply.
        allowedTools: [],
        maxTurns: mode === "checkin" ? 8 : DEFAULTS.maxTurns,
        // Claude Code counts this budget at Anthropic's prices. On someone else's endpoint that
        // would stop the run at the wrong number, so there the turn cap is the only ceiling and
        // we enforce the money ourselves from the catalog price.
        ...(spec.id === "anthropic" ? { maxBudgetUsd: mode === "checkin" ? 0.25 : agent.budget.perRunUsd } : {}),
        settingSources: [],
        disallowedTools: mode === "checkin" ? ["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash", "WebFetch", "Task"] : ["Task"],
        env: claudeEnv(spec, config, apiKey),
        abortController: abort,
      },
    });

    for await (const msg of q) {
      handleMessage(crew, run.id, msg, (t) => (text = t));
      if (msg.type === "result") {
        inputTokens = msg.usage?.input_tokens ?? 0;
        outputTokens = msg.usage?.output_tokens ?? 0;
        // Claude Code prices the run against Anthropic's list. On a third-party endpoint that
        // number would be someone else's prices, so price it from the catalog instead.
        costUsd = spec.id === "anthropic" ? msg.total_cost_usd ?? 0 : estimateCostUsd(spec.id, input.model, inputTokens, outputTokens);
        // The CLI reports API failures as text on the result, so classify the text.
        if (msg.subtype !== "success") {
          const detail = "errors" in msg && msg.errors?.length ? msg.errors.join("; ") : "";
          if (msg.subtype === "error_max_turns") { error = `Stopped after ${DEFAULTS.maxTurns} steps without finishing.`; failure = "other"; }
          else if (msg.subtype === "error_max_budget_usd") { error = `Hit the per-run budget ($${agent.budget.perRunUsd}).`; failure = "budget"; }
          else { const f = classifyText(detail || msg.subtype, spec.name); error = f.text; failure = f.kind; }
        } else if (msg.is_error) {
          const f = classifyText(msg.result, spec.name);
          error = f.text;
          failure = f.kind;
        } else {
          text = msg.result || text;
        }
      }
    }
  } catch (e) {
    const f = classifyFailure(e, spec.name);
    error = f.text;
    failure = f.kind;
  }
  return { costUsd, inputTokens, outputTokens, text, error, failure };
};

/**
 * The environment that decides which model endpoint Claude Code talks to.
 *
 * Anthropic itself: pass the key through if there is one, otherwise pass nothing and let the
 * CLI use the Claude login on this Mac.
 *
 * Anyone else: set ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN, and — this is the part that
 * bites — clear ANTHROPIC_API_KEY, or an inherited key silently wins and the run goes to
 * Anthropic on the owner's Anthropic bill instead of to the plan they chose. Claude Code also
 * reaches for a small model of its own for side errands; ANTHROPIC_SMALL_FAST_MODEL points that
 * at a model the third-party endpoint actually has, otherwise every run logs a 404.
 *
 * Bedrock, Vertex and Foundry are the same idea with the vendor's own switch, from the spec.
 */
function claudeEnv(spec: ProviderSpec, config: ProviderConfig, apiKey: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  env.PATH = childPath();

  if (spec.id === "anthropic") {
    if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
    return env;
  }

  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const settings = config.settings ?? {};
  for (const [k, v] of Object.entries(spec.env ?? {})) env[k] = v;

  if (spec.id === "bedrock") {
    if (settings.region) env.AWS_REGION = settings.region;
    if (settings.profile) env.AWS_PROFILE = settings.profile;
    return env;
  }
  if (spec.id === "vertex") {
    if (settings.project) env.ANTHROPIC_VERTEX_PROJECT_ID = settings.project;
    if (settings.region) env.CLOUD_ML_REGION = settings.region;
    return env;
  }

  const base = providerBaseUrl(spec, config);
  if (base) env.ANTHROPIC_BASE_URL = base;
  if (apiKey) env.ANTHROPIC_AUTH_TOKEN = apiKey;
  if (config.checkinModel) env.ANTHROPIC_SMALL_FAST_MODEL = config.checkinModel;
  return env;
}

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
    case "Skill": return ["read", `Skill: ${(p("command") || p("skill") || p("name")).replace(/^skills:/, "")}`];
    default: return ["tool", name];
  }
}
