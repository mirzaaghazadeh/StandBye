import Anthropic from "@anthropic-ai/sdk";
import type { ModelInfo, Provider } from "@crew/shared";
import type { Crew } from "./crew.js";

/**
 * Model catalog, grouped by provider. Anthropic models come from a curated list (prices included)
 * merged with the live Models API when a key is present; OpenRouter models come from its public
 * catalog, filtered to tool-capable ones. Cached for an hour.
 */

const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: "claude-opus-5", name: "Claude Opus 5", provider: "anthropic", inputPerM: 5, outputPerM: 25, context: 1_000_000, tools: true, tags: ["default", "reasoning"] },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5", provider: "anthropic", inputPerM: 2, outputPerM: 10, context: 1_000_000, tools: true, tags: ["balanced"] },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic", inputPerM: 1, outputPerM: 5, context: 200_000, tools: true, tags: ["cheap", "check-ins"] },
  { id: "claude-opus-4-8", name: "Claude Opus 4.8", provider: "anthropic", inputPerM: 5, outputPerM: 25, context: 1_000_000, tools: true, tags: ["reasoning"] },
  { id: "claude-opus-4-7", name: "Claude Opus 4.7", provider: "anthropic", inputPerM: 5, outputPerM: 25, context: 1_000_000, tools: true, tags: [] },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic", inputPerM: 3, outputPerM: 15, context: 1_000_000, tools: true, tags: [] },
  { id: "claude-fable-5-1", name: "Claude Fable 5.1", provider: "anthropic", inputPerM: 10, outputPerM: 50, context: 1_000_000, tools: true, tags: ["most capable", "expensive"] },
];

interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
  architecture?: { output_modalities?: string[] };
}

let cache: { at: number; byProvider: Record<Provider, ModelInfo[]> } | null = null;
const TTL = 60 * 60 * 1000;

export async function listModels(crew: Crew, force = false): Promise<Record<Provider, ModelInfo[]>> {
  if (cache && !force && Date.now() - cache.at < TTL) return cache.byProvider;
  const [anthropic, openrouter] = await Promise.all([anthropicModels(crew), openRouterModels()]);
  cache = { at: Date.now(), byProvider: { anthropic, openrouter } };
  return cache.byProvider;
}

async function anthropicModels(crew: Crew): Promise<ModelInfo[]> {
  const list = [...ANTHROPIC_MODELS];
  if (!crew.keys.anthropic) return list;
  try {
    const client = new Anthropic({ apiKey: crew.keys.anthropic });
    const known = new Set(list.map((m) => m.id));
    for await (const m of client.models.list()) {
      if (known.has(m.id) || /-\d{8}$/.test(m.id)) continue; // dated snapshots duplicate the aliases
      list.push({ id: m.id, name: m.display_name, provider: "anthropic", inputPerM: null, outputPerM: null, context: null, tools: true, tags: [] });
    }
  } catch (e) {
    console.error(`[models] anthropic list failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return list;
}

async function openRouterModels(): Promise<ModelInfo[]> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data: OpenRouterModel[] };
    return json.data
      .filter((m) => (m.supported_parameters ?? []).includes("tools"))
      .filter((m) => !m.id.endsWith(":batch") && !m.id.startsWith("~"))
      .map((m): ModelInfo => {
        const inP = m.pricing?.prompt ? Number(m.pricing.prompt) * 1e6 : null;
        const outP = m.pricing?.completion ? Number(m.pricing.completion) * 1e6 : null;
        const tags: string[] = [];
        if (m.id.endsWith(":free")) tags.push("free");
        if (inP !== null && inP > 0 && inP < 0.5) tags.push("cheap");
        if ((m.supported_parameters ?? []).includes("reasoning")) tags.push("reasoning");
        return { id: m.id, name: m.name, provider: "openrouter", inputPerM: inP, outputPerM: outP, context: m.context_length ?? null, tools: true, tags };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    console.error(`[models] openrouter list failed: ${e instanceof Error ? e.message : String(e)}`);
    return [
      { id: "z-ai/glm-5.3", name: "Z.AI: GLM 5.3", provider: "openrouter", inputPerM: null, outputPerM: null, context: 1_310_720, tools: true, tags: ["default"] },
      { id: "z-ai/glm-5.3-flash", name: "Z.AI: GLM 5.3 Flash", provider: "openrouter", inputPerM: null, outputPerM: null, context: 1_310_720, tools: true, tags: ["cheap"] },
    ];
  }
}
