import { ToolLoopAgent, isStepCount, parsePartialJson, tool, type LanguageModel, type ToolSet } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { trimConversation } from "./context.js";
import { log } from "../log.js";
import { DEFAULTS } from "../config.js";
import { estimateCostUsd } from "../pricing.js";
import { ATTRIBUTION_HEADERS, providerBaseUrl, providerKey } from "../providers.js";
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
  // call, so budgets are exact rather than estimated from a price table. The attribution headers
  // are what make this run show up as StandBye in the owner's OpenRouter activity log.
  const openrouter = spec.id === "openrouter";
  const model: LanguageModel = openrouter
    ? createOpenRouter({ apiKey, headers: ATTRIBUTION_HEADERS })(input.model, { usage: { include: true } })
    : createOpenAICompatible({ name: spec.id, baseURL, apiKey: apiKey || undefined, includeUsage: true })(input.model);

  // What each shape of run can actually do. Handing a conversation the file and shell tools does
  // not help it answer a question — it costs tokens, slows the first token down, and invites the
  // model to go rummaging instead of replying.
  const teamTools: readonly AnyTeamTool[] =
    mode === "checkin"
      ? [...CHECKIN_TOOLS, ...TEAM_TOOLS.filter((t) => ["list_agents", "read_channel", "team_decisions", "done"].includes(t.name))]
      : mode === "reply"
        ? [...CHECKIN_TOOLS, ...TEAM_TOOLS.filter((t) => ["post_message", "read_channel", "list_agents", "remember", "done"].includes(t.name))]
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

  // Lives above the try so the catch can sweep half-finished drafts when the stream dies.
  const drafting = new Map<string, { channelId: string; json: string; sent: string }>();
  let thinking = "";
  let thoughtAt = 0;
  try {
    const loop = new ToolLoopAgent({
      model,
      instructions: input.system,
      tools,
      stopWhen: [isStepCount(mode === "checkin" ? 6 : mode === "reply" ? 8 : DEFAULTS.maxTurns), () => finished],
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
    // Stream rather than generate, so a reply can be watched as it is written. An agent's
    // message to a channel is the *input* to `post_message`, not free text, so what we follow
    // is the tool call being composed: the model emits its arguments as JSON deltas, and the
    // `text` field of that half-finished JSON is the message so far.
    const result = await loop.stream({ prompt: input.prompt, abortSignal: signal });
    for await (const part of result.fullStream) {
      // A streamed run reports provider trouble as a part rather than by rejecting, so without
      // this an expired key or an empty balance would arrive as a nameless "other" failure and
      // the agent would never be paused for it.
      if (part.type === "error") throw part.error;
      // Models that reason out loud emit it before anything else happens. Showing it is the
      // difference between a spinner and watching someone think: the wait is the same, but you
      // can see it is working on your question rather than stuck.
      if (part.type === "reasoning-delta") {
        thinking += part.text ?? "";
        const now = Date.now();
        if (now - thoughtAt > 400 && thinking.trim()) {
          thoughtAt = now;
          crew.bus.emit("run.thinking", { runId: run.id, agentId: agent.id, text: lastSentence(thinking) });
        }
        continue;
      }
      if (part.type === "tool-input-start") {
        if (part.toolName === "post_message") drafting.set(part.id, { channelId: "", json: "", sent: "" });
        continue;
      }
      if (part.type === "tool-input-delta") {
        const d = drafting.get(part.id);
        if (!d) continue;
        d.json += part.delta;
        const { value } = await parsePartialJson(d.json);
        const draft = value as { channel?: unknown; text?: unknown } | undefined;
        if (typeof draft?.channel === "string") d.channelId = draft.channel;
        const so_far = typeof draft?.text === "string" ? draft.text : "";
        // Only publish real growth: a partial parse can flap while a string is being escaped.
        if (so_far.length > d.sent.length && d.channelId) {
          d.sent = so_far;
          crew.bus.emit("message.draft", { runId: run.id, agentId: agent.id, channelId: d.channelId, text: so_far, done: false });
        }
        continue;
      }
      if (part.type === "tool-input-end") {
        const d = drafting.get(part.id);
        if (d?.channelId) crew.bus.emit("message.draft", { runId: run.id, agentId: agent.id, channelId: d.channelId, text: d.sent, done: true });
        drafting.delete(part.id);
      }
    }
    const finalText = await result.text;
    if (finalText?.trim()) text = finalText.trim();
  } catch (e) {
    // A mid-stream failure inside a streamed post_message strands the half-written draft: the
    // desktop only clears it on message.created or a done:true draft, so without this sweep the
    // "writing…" bubble stays until reload. Close every unfinished draft the way tool-input-end
    // would have — done:true, with everything written so far.
    for (const d of drafting.values()) {
      if (d.channelId) crew.bus.emit("message.draft", { runId: run.id, agentId: agent.id, channelId: d.channelId, text: d.sent, done: true });
    }
    drafting.clear();
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

/**
 * What it is thinking about *now*, not the whole train of thought.
 *
 * Reasoning arrives as fragments and accumulates without limit, so the line has to be the tail
 * rather than the lot: the last sentence where there is one, otherwise the last stretch of it,
 * trimmed at a word so it does not cut mid-syllable.
 */
function lastSentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const parts = clean.split(/(?<=[.!?])\s+/).filter((p) => p.trim());
  const tail = (parts[parts.length - 1] ?? clean).trim();
  if (tail.length <= 140) return tail;
  const cut = tail.slice(-140);
  return "…" + cut.slice(cut.indexOf(" ") + 1);
}

function fail(error: string, failure: FailureKind) {
  return { costUsd: 0, inputTokens: 0, outputTokens: 0, text: "", error, failure };
}
