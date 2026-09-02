import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { TeamDraftSchema, DEFAULT_MODELS, type TeamDraft } from "@crew/shared";
import type { Crew } from "./crew.js";
import { soloDevTeam } from "./templates.js";

export interface BuilderInput {
  description: string;
  ownerName: string;
  workspaceRoot: string | null;
  /** short summary of the workspace (file listing, README head) gathered by the caller */
  workspaceSummary?: string;
}

/**
 * Natural-language team builder: the owner describes what they need, Claude returns a
 * structured team draft (souls, rules, channels, budgets) the owner can edit before creating.
 * Falls back to the built-in solo dev team when no Anthropic key is present.
 */
export async function draftTeam(crew: Crew, input: BuilderInput): Promise<TeamDraft> {
  const template = soloDevTeam(input.ownerName, input.workspaceRoot ? input.workspaceRoot.split("/").pop() ?? "" : "");
  if (!crew.keys.anthropic) return template; // The Messages API needs a key; the Claude login only covers the Claude runner.

  const client = new Anthropic({ apiKey: crew.keys.anthropic });
  const hasOpenRouter = Boolean(crew.keys.openrouter);
  const system = [
    "You design small teams of AI agents that work autonomously, 24/7, for one person. Each agent is a folder with a SOUL.md (persona and working style), RULES.md, and a budget.",
    "Design principles: few agents with clear ownership beat many; every agent has 2-4 standing responsibilities; the lead plans and reports; a reviewer/tester is almost always worth it; docs agent only if the project has docs.",
    `Providers: "anthropic" (models ${DEFAULT_MODELS.anthropic.main} for real work, ${DEFAULT_MODELS.anthropic.checkin} for light roles)${hasOpenRouter ? ` and "openrouter" (model ${DEFAULT_MODELS.openrouter.main}, cheaper, good for review/test/docs roles).` : ". OpenRouter is not configured; use anthropic only."}`,
    "Souls are written in second person, markdown, with sections: who they are, how they work (3-5 bullets), how they talk. Specific to the owner's project. No filler.",
    "Rules are hard constraints the app enforces or the agent must never break. Always include: never push to main without approval; only touch files inside the repo.",
    "Budgets: lead $3-5/day, engineers $2-4, review/docs $0.5-2. Team cap around the sum. Estimate a realistic daily range.",
    "Channels: #general is created automatically. Add 1-3 more only if they carry different conversations.",
    "questionsForOwner: 1-3 yes/no questions about things you deliberately left out or assumed.",
    "Agent names: short, human first names, distinct first letters. Colors: soft pastel hex backgrounds.",
  ].join("\n");

  const user = [
    `Owner: ${input.ownerName || "unknown"}`,
    `Workspace: ${input.workspaceRoot ?? "none connected"}`,
    input.workspaceSummary ? `Workspace summary:\n${input.workspaceSummary}` : "",
    "",
    "What the owner asked for:",
    input.description,
    "",
    "Here is a reference team for a solo developer, to adapt (not copy):",
    JSON.stringify(template, null, 1).slice(0, 6000),
  ].join("\n");

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(TeamDraftSchema) },
  });
  const draft = response.parsed_output;
  if (!draft) throw new Error("The builder returned no usable draft. Try again or start from the template.");
  return draft;
}
