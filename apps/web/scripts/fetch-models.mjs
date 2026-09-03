#!/usr/bin/env node
// Snapshots OpenRouter's public catalog into src/openrouter.json for the models section.
// Same filter the supervisor applies (packages/supervisor/src/models.ts): tool-capable, no batch or
// experimental ids. Run `pnpm --filter @crew/web models` and commit the result; the build never
// hits the network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/openrouter.json");
const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(20_000) });
if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
const { data } = await res.json();

const models = data
  .filter((m) => (m.supported_parameters ?? []).includes("tools"))
  .filter((m) => !m.id.endsWith(":batch") && !m.id.startsWith("~"))
  .map((m) => ({
    id: m.id,
    name: m.name,
    vendor: m.id.split("/")[0],
    vendorName: m.name.includes(":") ? m.name.split(":")[0].trim() : m.id.split("/")[0],
    inputPerM: m.pricing?.prompt ? Number(m.pricing.prompt) * 1e6 : null,
    outputPerM: m.pricing?.completion ? Number(m.pricing.completion) * 1e6 : null,
    context: m.context_length ?? null,
    free: m.id.endsWith(":free"),
    reasoning: (m.supported_parameters ?? []).includes("reasoning"),
  }));

const byVendor = new Map();
for (const m of models) {
  // Group by display name so "meta" and "meta-llama" land in one row.
  const v = byVendor.get(m.vendorName) ?? { id: m.vendor, name: m.vendorName, count: 0, free: 0, maxContext: 0, cheapest: null };
  v.count++;
  if (m.free) v.free++;
  v.maxContext = Math.max(v.maxContext, m.context ?? 0);
  if (m.inputPerM !== null && m.inputPerM > 0 && (!v.cheapest || m.inputPerM < v.cheapest.inputPerM)) v.cheapest = { id: m.id, name: m.name.replace(/^[^:]+:\s*/, ""), inputPerM: m.inputPerM, outputPerM: m.outputPerM };
  byVendor.set(m.vendorName, v);
}
const vendors = [...byVendor.values()].sort((a, b) => b.count - a.count);

// Models the site shows by name: the app's defaults plus well-known cheap and flagship options.
const FEATURED = [
  "z-ai/glm-5.3", "z-ai/glm-5.3-flash", "openai/gpt-5.5", "openai/gpt-oss-20b", "moonshotai/kimi-k3", "minimax/minimax-m3",
  "deepseek/deepseek-v4-flash-0731", "qwen/qwen3.7-flash", "mistralai/mistral-nemo", "google/gemma-3-12b-it", "x-ai/grok-build-0.1", "nvidia/nemotron-3-nano-30b-a3b",
];
const featured = FEATURED.map((id) => models.find((m) => m.id === id)).filter(Boolean);

const snapshot = {
  fetchedAt: new Date().toISOString().slice(0, 10),
  catalogTotal: data.length,
  total: models.length,
  free: models.filter((m) => m.free).length,
  reasoning: models.filter((m) => m.reasoning).length,
  vendors,
  featured,
};
fs.writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n");
console.log(`${out}: ${snapshot.total} tool-capable models from ${vendors.length} vendors (${snapshot.free} free)`);
