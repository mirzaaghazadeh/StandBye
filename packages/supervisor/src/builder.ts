import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { generateText, Output } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { AgentDraftSchema, PROVIDERS, providerLabel, providerSpec, TeamDraftSchema, type Agent, type AgentDraft, type Provider, type ProviderStatus, type TeamConfig, type TeamDraft } from "@crew/shared";
import { ATTRIBUTION_HEADERS, providerBaseUrl, providerKey } from "./providers.js";
import type { Crew } from "./crew.js";
import { soloDevTeam } from "./templates.js";

export interface BuilderInput {
  description: string;
  ownerName: string;
  workspaceRoot: string | null;
  /** short summary of the workspace (file listing, README head) gathered by the caller */
  workspaceSummary?: string;
  /** which provider drafts the team; defaults to the preferred ready provider */
  provider?: Provider;
  /** "template" returns the built-in team adapted to the configured providers, no model call */
  mode?: "describe" | "template";
}

/**
 * Natural-language team builder. The owner describes what they need; a model returns a
 * structured team draft (souls, rules, channels, budgets) the owner edits before creating.
 *
 * Which backend does the drafting depends on the provider it is asked for:
 *  - Anthropic API key            → Messages API with a JSON schema output
 *  - Claude Code login            → Agent SDK query() with a JSON schema output (no tools)
 *  - any OpenAI-compatible key    → AI SDK generateText with Output.object
 *  - anything else (a coding CLI, a cloud) → the template, adapted
 *
 * A coding-agent CLI could draft a team too, but shelling out to somebody's agent and hoping
 * for clean JSON is a worse first-run experience than the template, which is instant and always
 * works. The drafted team can still put agents on those providers; only the drafting is limited.
 */
export async function draftTeam(crew: Crew, input: BuilderInput): Promise<TeamDraft> {
  const status = crew.providerStatus();
  const template = soloDevTeam(crew.providers, input.ownerName, input.workspaceRoot ? input.workspaceRoot.split("/").pop() ?? "" : "");
  const provider = input.provider ?? pickDrafter(crew, status);
  if (input.mode === "template" || !provider) return adaptToProviders(template, status);

  const spec = providerSpec(provider);
  const cfg = status[provider];
  if (!spec || !cfg?.ready) throw new Error(`${providerLabel(provider)} is not ready. ${cfg?.blocker ?? "Turn it on in Settings."}`);

  const system = systemPrompt(crew, status);
  const user = userPrompt(input, template);
  const key = providerKey(spec, crew.keys);

  let draft: TeamDraft;
  if (provider === "anthropic" && key) draft = await viaAnthropicApi(key, cfg.defaultModel, system, user, TeamDraftSchema);
  else if (spec.kind === "claude" && cfg.hasLogin) draft = await viaClaudeLogin(cfg.defaultModel, system, user, TeamDraftSchema);
  else if (spec.kind === "openai") draft = await viaOpenAiCompatible(spec.id, providerBaseUrl(spec, cfg), key, cfg.defaultModel, system, user, TeamDraftSchema);
  else return adaptToProviders(template, status);
  return adaptToProviders(draft, status);
}

/** The ready providers, with the only model ids the model may put in the draft. */
function readyProviderLines(status: ProviderStatus): string[] {
  return PROVIDERS.flatMap((p) => {
    const cfg = status[p.id];
    if (!cfg?.ready) return [];
    const models = cfg.defaultModel === cfg.checkinModel ? `model ${cfg.defaultModel}` : `default model ${cfg.defaultModel} for real work, ${cfg.checkinModel} for light roles`;
    return [`"${p.id}" (${p.name}): ${models}`];
  });
}

export interface TeammateInput {
  /** What the owner needs the new teammate to do. */
  description: string;
  ownerName: string;
  /** Ask a specific provider to draft; defaults to the first ready drafter. */
  provider?: Provider;
}

/**
 * Drafts ONE teammate to join an existing team. Same drafter backends as draftTeam, but the
 * model sees the current team (names, roles, channels) so the draft fills a gap instead of
 * duplicating someone who is already there. There is deliberately no template fallback: a
 * template cannot know what this team is missing, so with no ready drafter this throws and
 * the UI falls back to the manual form.
 */
export async function draftTeammate(crew: Crew, input: TeammateInput): Promise<AgentDraft> {
  const status = crew.providerStatus();
  const provider = input.provider ?? pickDrafter(crew, status);
  if (!provider) throw new Error("No provider is ready to draft a teammate. Turn on a provider in Settings, or fill the form by hand.");
  const spec = providerSpec(provider);
  const cfg = status[provider];
  if (!spec || !cfg?.ready) throw new Error(`${providerLabel(provider)} is not ready. ${cfg?.blocker ?? "Turn it on in Settings."}`);
  if (!crew.team) throw new Error("No team is selected — open a team first.");

  const system = teammateSystemPrompt(status);
  const user = teammateUserPrompt(input, crew.team, crew.listAgents(), crew.db.listChannels());  const key = providerKey(spec, crew.keys);

  let draft: AgentDraft;
  if (provider === "anthropic" && key) draft = await viaAnthropicApi<AgentDraft>(key, cfg.defaultModel, system, user, AgentDraftSchema);
  else if (spec.kind === "claude" && cfg.hasLogin) draft = await viaClaudeLogin<AgentDraft>(cfg.defaultModel, system, user, AgentDraftSchema);
  else if (spec.kind === "openai") draft = await viaOpenAiCompatible<AgentDraft>(spec.id, providerBaseUrl(spec, cfg), key, cfg.defaultModel, system, user, AgentDraftSchema);
  else throw new Error(`${providerLabel(provider)} cannot draft. Turn on a provider that can, or fill the form by hand.`);
  return adaptAgent(draft, status, readyFallback(status));
}

function teammateSystemPrompt(status: ProviderStatus): string {
  return [
    "You design exactly ONE AI teammate to add to an existing team of AI agents that works autonomously for one person. Return a single agent draft, never a team.",
    "Design principles: the teammate fills a gap the existing team leaves; it must not duplicate what an existing agent already owns; give it 2-4 standing responsibilities; write it as a peer with clear ownership, not a helper.",
    `Available providers and the ONLY model ids you may use: ${readyProviderLines(status).join("; ")}.`,
    "Souls are written in second person, markdown, with sections: who they are, how they work (3-5 bullets), how they talk. Specific to the owner's project. No filler.",
    "Rules are hard constraints the app enforces or the agent must never break. Always include: never push to main without approval; only touch files inside the repo.",
    "Budgets in USD per day: engineers 2-4, review/docs 0.5-2. Estimate a realistic per-run budget of at most 2.",
    "Channels: reuse the existing channel names wherever the conversation fits there; add a new channel only if the teammate carries a genuinely different conversation.",
    "schedules: only when a duty is truly periodic (e.g. weekly release notes); otherwise none.",
    "The name must not collide with an existing agent name and must have a distinct first letter from all of them. Colors: soft pastel hex backgrounds like #E9D9CF, #D7E3DA, #DDDCE8, #F3E4C8, #D9E6EE.",
    "Return only the JSON object.",
  ].join("\n");
}

function teammateUserPrompt(input: TeammateInput, team: TeamConfig, agents: Agent[], channels: { name: string }[]): string {
  return [
    `Owner: ${input.ownerName || "unknown"}`,
    `Team: ${team.name}${team.charter ? ` — ${team.charter}` : ""}`,
    "",
    "Current teammates (do not duplicate their duties, names or first letters):",
    ...agents.map((a) => `- ${a.name}: ${a.role} (${a.provider} / ${a.model})`),
    "",
    `Existing channels: ${channels.map((c) => `#${c.name}`).join(", ")}`,
    "",
    "The teammate the owner wants:",
    input.description,
  ].join("\n");
}

/** The best provider to write the draft with: one that can return structured JSON, Claude first. */
function pickDrafter(crew: Crew, status: ProviderStatus): Provider | null {
  const canDraft = (id: string) => {
    const spec = providerSpec(id);
    return status[id]?.ready && (id === "anthropic" || spec?.kind === "openai");
  };
  if (canDraft("anthropic")) return "anthropic";
  const preferred = crew.preferredProvider();
  if (preferred && canDraft(preferred)) return preferred;
  return PROVIDERS.map((p) => p.id).find(canDraft) ?? null;
}

function systemPrompt(crew: Crew, status: ProviderStatus): string {
  // Only providers that are actually ready are offered to the model, with their configured
  // models, so it can never draft a team that cannot run.
  const providers = readyProviderLines(status);
  return [
    "You design small teams of AI agents that work autonomously, 24/7, for one person. Each agent is a folder with a SOUL.md (persona and working style), RULES.md, and a budget.",
    "Design principles: few agents with clear ownership beat many; every agent has 2-4 standing responsibilities; the lead plans and reports; a reviewer/tester is almost always worth it; a docs agent only if the project has docs.",
    `Available providers and the ONLY model ids you may use: ${providers.join("; ")}.`,
    "Souls are written in second person, markdown, with sections: who they are, how they work (3-5 bullets), how they talk. Specific to the owner's project. No filler.",
    "Rules are hard constraints the app enforces or the agent must never break. Always include: never push to main without approval; only touch files inside the repo.",
    "Budgets in USD per day: lead 3-5, engineers 2-4, review/docs 0.5-2. Team cap around the sum. Estimate a realistic daily range.",
    "Channels: #general is created automatically. Add 1-3 more only if they carry different conversations. Members are agent names.",
    "questionsForOwner: 1-3 yes/no questions about things you deliberately left out or assumed.",
    "schedules: give the lead a weekday 09:00 standup, a weekday 18:00 end-of-day report to the owner, and a Friday 17:00 retrospective (5-field cron; prompts say exactly what to read and post). Other agents get schedules only when a duty is truly periodic (e.g. docs release notes weekly).",
    "Agent names: short human first names with distinct first letters. Colors: soft pastel hex backgrounds like #E9D9CF, #D7E3DA, #DDDCE8, #F3E4C8, #D9E6EE.",
    "Return only the JSON object.",
  ].join("\n");
}

function userPrompt(input: BuilderInput, template: TeamDraft): string {
  return [
    `Owner: ${input.ownerName || "unknown"}`,
    `Workspace: ${input.workspaceRoot ?? "none connected"}`,
    input.workspaceSummary ? `Workspace summary:\n${input.workspaceSummary}` : "",
    "",
    "What the owner asked for:",
    input.description,
    "",
    "Reference team for a solo developer, to adapt (not copy):",
    JSON.stringify(template, null, 1).slice(0, 6000),
  ].join("\n");
}

async function viaAnthropicApi<T>(apiKey: string, model: string, system: string, user: string, schema: z.ZodType<T>): Promise<T> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.parse({
    model, max_tokens: 16000, thinking: { type: "adaptive" }, system,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(schema) },
  });
  if (!response.parsed_output) throw new Error("The builder returned no usable draft. Try again or start from the template.");
  return response.parsed_output;
}

async function viaClaudeLogin<T>(model: string, system: string, user: string, schema: z.ZodType<T>): Promise<T> {
  let out: unknown;
  let error: string | undefined;
  const q = query({
    prompt: user,
    options: {
      model, systemPrompt: { type: "custom", prompt: system }, maxTurns: 3, settingSources: [],
      disallowedTools: ["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch", "Task", "Read", "Glob", "Grep"],
      outputFormat: { type: "json_schema", schema: draftJsonSchema(schema) },
      env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
    },
  });
  for await (const msg of q) {
    if (msg.type === "result") {
      if (msg.subtype === "success") out = msg.structured_output ?? tryJson(msg.result);
      else error = msg.subtype;
    }
  }
  if (error) throw new Error(`Claude could not draft the team (${error}).`);
  const parsed = schema.safeParse(out);
  if (!parsed.success) throw new Error("Claude returned a draft the app could not read. Try again.");
  return parsed.data;
}

async function viaOpenAiCompatible<T>(id: string, baseURL: string, apiKey: string, model: string, system: string, user: string, schema: z.ZodType<T>): Promise<T> {
  if (!baseURL) throw new Error(`${providerLabel(id)} has no base URL set.`);
  if (!model) throw new Error(`${providerLabel(id)} has no default model set. Pick one in Settings › Providers.`);
  const provider = id === "openrouter"
    ? createOpenRouter({ apiKey, headers: ATTRIBUTION_HEADERS })
    : createOpenAICompatible({ name: id, baseURL, apiKey: apiKey || undefined });
  const { output } = await generateText({
    model: provider(model),
    system,
    prompt: user,
    output: Output.object({ schema }),
  });
  if (!output) throw new Error("The model returned no usable draft. Try again or pick another model.");
  return output;
}

/** JSON schema for the draft without the `$schema` header, which the Claude Code validator rejects. */
function draftJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...schema2 } = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown> & { $schema?: string };
  return schema2;
}

function tryJson(text: string): unknown {
  try { return JSON.parse(text); } catch { const m = /\{[\s\S]*\}/.exec(text); if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } } return undefined; }
}

/**
 * Make sure every agent lands on a provider that is ready, with that provider's configured model
 * when the model is unknown. A draft that names a provider the owner has not set up — or that a
 * model invented — is quietly moved to one that works rather than failing at the first run.
 */
function adaptToProviders(draft: TeamDraft, status: ProviderStatus): TeamDraft {
  const fallback = readyFallback(status);
  return { ...draft, agents: draft.agents.map((a) => adaptAgent(a, status, fallback)) };
}

/** The provider every unknown model lands on when its own provider is not ready. */
function readyFallback(status: ProviderStatus): Provider | null {
  return status.anthropic?.ready ? "anthropic" : PROVIDERS.map((p) => p.id).find((id) => status[id]?.ready) ?? null;
}

function adaptAgent(a: AgentDraft, status: ProviderStatus, fallback: Provider | null): AgentDraft {
  const provider = status[a.provider]?.ready ? a.provider : fallback ?? a.provider;
  const cfg = status[provider];
  if (!cfg) return a;
  const model = provider === a.provider && a.model ? a.model : cfg.defaultModel;
  return { ...a, provider, model };
}
