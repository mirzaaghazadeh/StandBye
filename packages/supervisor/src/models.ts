import { logError } from "./log.js";
import { PROVIDERS, type ModelInfo, type Provider, type ProviderConfig, type ProviderSpec } from "@crew/shared";
import { learnPrices } from "./pricing.js";
import { providerCatalogUrl, providerKey } from "./providers.js";
import type { Crew } from "./crew.js";

/**
 * The model catalog, one list per provider.
 *
 * Every provider starts from the curated list in its catalog entry — that is what the picker
 * shows before anything is configured, and it carries the prices we bill against. On top of
 * that, a provider that offers a model list and has credentials gets asked for the live one,
 * so a new model shows up without an app release.
 *
 * Providers are fetched in parallel and independently: one endpoint being down or one key being
 * wrong leaves every other provider's list intact. Cached for an hour.
 */

let cache: { at: number; byProvider: Record<Provider, ModelInfo[]> } | null = null;
/** The fetch that is already running, so a burst of callers waits on one instead of starting its own. */
let inflight: Promise<Record<Provider, ModelInfo[]>> | null = null;
const TTL = 60 * 60 * 1000;

/**
 * The app asks for this from several places at once on every start — each window, each team
 * select, each reconnect — and they all arrive before the first fetch fills the cache. Without
 * the single-flight below that was one full sweep of every provider per caller: six sweeps of
 * 34 endpoints on a cold start, six 401s against a wrong key, six timeouts per local server.
 */
export async function listModels(crew: Crew, force = false): Promise<Record<Provider, ModelInfo[]>> {
  if (cache && !force && Date.now() - cache.at < TTL) return cache.byProvider;
  if (inflight && !force) return inflight;
  inflight = (async () => {
    const settings = crew.providers;
    const pairs = await Promise.all(
      PROVIDERS.map(async (spec): Promise<[string, ModelInfo[]]> => [spec.id, await modelsFor(spec, settings[spec.id], crew)]),
    );
    cache = { at: Date.now(), byProvider: Object.fromEntries(pairs) };
    return cache.byProvider;
  })();
  try { return await inflight; } finally { inflight = null; }
}

async function modelsFor(spec: ProviderSpec, config: ProviderConfig | undefined, crew: Crew): Promise<ModelInfo[]> {
  const curated = spec.models.map((m) => ({ ...m, provider: spec.id }));
  // A CLI picks from whatever its own account has; there is no list to fetch, and asking it
  // would mean spawning a process on every settings screen.
  if (spec.kind === "cli") return curated;

  const base = providerCatalogUrl(spec, config);
  if (!base) return curated;
  const key = providerKey(spec, crew.keys);
  // Local servers need no key. Everyone else: no key, no list — and no pointless 401 either.
  if (spec.auth === "key" && !key) return curated;
  // A local server needs no key, so nothing above stops us knocking on a port that has nothing
  // behind it. Ask only once the owner has switched it on, or every refresh waits out a timeout
  // for a server that was never running.
  if (spec.auth === "none" && !config?.enabled) return curated;

  try {
    const live = spec.id === "openrouter" ? await openRouterModels() : await openAiStyleModels(spec, base, key);
    if (!live.length) return curated;
    const known = new Set(curated.map((m) => m.id));
    const merged = [...curated, ...live.filter((m) => !known.has(m.id))];
    learnPrices(spec.id, merged);
    return merged;
  } catch (e) {
    logError(`${spec.id} model list failed: ${e instanceof Error ? e.message : String(e)}`);
    return curated;
  }
}

// ---------------------------------------------------------------- OpenAI-style /models

interface OpenAiModel {
  id: string;
  display_name?: string;
  name?: string;
  context_length?: number;
  context_window?: number;
  max_context_length?: number;
}

/**
 * `GET {base}/models`, which OpenAI, Google, xAI, Mistral, Groq, Together, Fireworks, DeepSeek,
 * Ollama and LM Studio all serve, and which Anthropic serves with its own headers. It says
 * nothing about prices or tool support, so the entries stay unpriced and the curated list above
 * is what the owner sees first.
 */
async function openAiStyleModels(spec: ProviderSpec, base: string, key: string): Promise<ModelInfo[]> {
  const anthropicNative = spec.id === "anthropic";
  const headers: Record<string, string> = anthropicNative
    ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
    : key ? { authorization: `Bearer ${key}` } : {};
  const res = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { data?: OpenAiModel[] };
  return (json.data ?? [])
    // Dated Claude snapshots duplicate the aliases the curated list already has.
    .filter((m) => !(anthropicNative && /-\d{8}$/.test(m.id)))
    .map((m): ModelInfo => ({
      id: m.id,
      name: m.display_name ?? m.name ?? m.id,
      provider: spec.id,
      inputPerM: null,
      outputPerM: null,
      context: m.context_length ?? m.context_window ?? m.max_context_length ?? null,
      tools: true,
      tags: [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- OpenRouter

interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
}

/** OpenRouter's public catalog, filtered to models that can actually call tools. No key needed. */
async function openRouterModels(): Promise<ModelInfo[]> {
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
}
