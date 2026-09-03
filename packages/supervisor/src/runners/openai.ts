import { ToolLoopAgent, isStepCount, tool, type LanguageModel, type ToolSet } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { trimConversation } from "./context.js";
import { log } from "../log.js";
import { DEFAULTS } from "../config.js";
import { estimateCostUsd } from "../pricing.js";
import { providerBaseUrl, providerKey } from "../providers.js";
import { CHECKIN_TOOLS, TEAM_TOOLS, type AnyTeamTool, type ToolContext } from "../tools/team-tools.js";
import { workspaceTools } from "./workspace.js";
import { classifyFailure, type FailureKind, type Runner } from "./types.js";

/**
 * The runner for every OpenAI-compatible endpoint: OpenRouter, the labs' own APIs, the
 * inference clouds, and a model running on this Mac. One AI SDK tool loop, the same team
 * tools as the Claude runner, plus the workspace file/shell toolset, gated by the same rules.
 *
 * The only thing that varies between providers is the base URL, the key and how usage comes
 * back, so this file has no vendor names in it beyond OpenRouter's own SDK — which we keep
 * because it is the one provider that reports the exact dollar cost of a call.
 */
export const openaiRunner: Runner = async (input) => {
  const { crew, agent, run, mode, ctx, signal, cwd, spec, config } = input;

  const apiKey = providerKey(spec, crew.keys);
  const baseURL = providerBaseUrl(spec, config);
  if (!baseURL) {
    return fail(`${spec.name} has no base URL. Set one in Settings › Providers.`, "auth");
  }
  if (spec.auth === "key" && !apiKey) {
    return fail(`No ${spec.name} API key. Paste one in Settings › Providers.`, "auth");
  }
  if (!input.model) {
    return fail(`No model set for ${spec.name}. Pick one in this agent's settings.`, "model");
  }

  // OpenRouter's own provider is worth keeping for one reason: it returns the real cost of the
  // call, so budgets are exact rather than estimated from a price table.
  const openrouter = spec.id === "openrouter";
  const model: LanguageModel = openrouter
    ? createOpenRouter({ apiKey })(input.model, { usage: { include: true } })
    : createOpenAICompatible({ name: spec.id, baseURL, apiKey: apiKey || undefined, includeUsage: true })(input.model);

  const teamTools: readonly AnyTeamTool[] =
    mode === "checkin"
      ? [...CHECKIN_TOOLS, ...TEAM_TOOLS.filter((t) => ["list_agents", "read_channel", "team_decisions", "done"].includes(t.name))]
      : TEAM_TOOLS;

  let finished = false;
  const wrappedCtx: ToolContext = {
    ...ctx,
    onDone: (s, st) => { finished = true; ctx.onDone?.(s, st); },
    onEscalate: (r) => { finished = true; ctx.onEscalate?.(r); },
  };

  const tools: ToolSet = {};
  for (const t of teamTools) {
    tools[t.name] = tool({
      description: t.description,
      inputSchema: z.object(t.schema),
      execute: async (args: Record<string, unknown>) => {
        try { return await t.handler(args as never, wrappedCtx); }
        catch (e) { return `Error: ${e instanceof Error ? e.message : String(e)}`; }
      },
    });
  }
  if (mode === "full") Object.assign(tools, workspaceTools(wrappedCtx, cwd, agent.permissions));

  let text = "";
  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0; // input tokens the provider served from its cache rather than re-reading
  let error: string | undefined;
  let failure: FailureKind | undefined;

  try {
    const loop = new ToolLoopAgent({
      model,
      instructions: input.system,
      tools,
      stopWhen: [isStepCount(mode === "checkin" ? 6 : DEFAULTS.maxTurns), () => finished],
      // The whole conversation is re-sent every step, so old tool-result payloads are the
      // single biggest cost in a long run. Drop the bodies once the model has moved on.
      prepareStep: ({ messages }) => ({ messages: trimConversation(messages) }),
      onStepFinish: (step) => {
        const meta = (step as { providerMetadata?: { openrouter?: { usage?: { cost?: number } } } }).providerMetadata;
        const reported = Number(meta?.openrouter?.usage?.cost ?? 0);
        const stepIn = step.usage?.inputTokens ?? 0;
        const stepOut = step.usage?.outputTokens ?? 0;
        // Everyone but OpenRouter tells us tokens, not money, so price them from the catalog.
        costUsd += reported || estimateCostUsd(spec.id, input.model, stepIn, stepOut);
        inputTokens += stepIn;
        outputTokens += stepOut;
        cachedTokens += step.usage?.inputTokenDetails?.cacheReadTokens ?? 0;
        if (step.text?.trim()) { text = step.text.trim(); crew.addStep(run.id, "text", text); }
        for (const call of step.toolCalls ?? []) {
          if (!(call.toolName in tools) || teamTools.some((t) => t.name === call.toolName)) continue;
          const inp = (call.input ?? {}) as Record<string, unknown>;
          crew.addStep(run.id, call.toolName === "bash" ? (/^git\b/.test(String(inp.command)) ? "git" : "run") : call.toolName.startsWith("write") || call.toolName.startsWith("edit") ? "edit" : "read", String(inp.command ?? inp.path ?? inp.pattern ?? ""), JSON.stringify(inp).slice(0, 4000));
        }
        if (costUsd > agent.budget.perRunUsd) { finished = true; error = `Per-run budget ($${agent.budget.perRunUsd}) exceeded`; failure = "budget"; }
      },
    });
    const result = await loop.generate({ prompt: input.prompt, abortSignal: signal });
    if (result.text?.trim()) text = result.text.trim();
  } catch (e) {
    const f = classifyFailure(e, spec.name);
    error = f.text;
    failure = f.kind;
  }
  // Cache hits are the difference between paying for the prefix once and paying every step,
  // so record the ratio: it is the number that tells us whether any of this is working.
  if (inputTokens > 0) {
    log(`run finished · ${spec.id} in=${inputTokens} cached=${cachedTokens} (${Math.round((cachedTokens / inputTokens) * 100)}%) out=${outputTokens} cost=$${costUsd.toFixed(4)}`, { agent: agent.id, run: run.id });
  }
  return { costUsd, inputTokens, outputTokens, cachedTokens, text, error, failure };
};

function fail(error: string, failure: FailureKind) {
  return { costUsd: 0, inputTokens: 0, outputTokens: 0, text: "", error, failure };
}
