// models.list feeds the AddTeammate sheet and the model picker. Regression: the OpenRouter
// spec had no catalogUrl, so providerCatalogUrl() returned "" and modelsFor() bailed to the
// 2-model curated list before ever reaching openRouterModels() — the picker showed OpenRouter
// with exactly 2 models instead of the live tool-capable catalog (Navid, 4 Sep 2026, v0.2.0).
// The fetch stub keeps this offline, per the house rule.
import test from "node:test";
import assert from "node:assert/strict";
import { PROVIDERS as PROVIDER_SPECS } from "@crew/shared";
import { listModels } from "../dist/models.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";

const LIVE = {
  data: [
    {
      id: "vendor/live-a",
      name: "Live A",
      context_length: 200000,
      pricing: { prompt: "0.000001", completion: "0.000002" },
      supported_parameters: ["tools", "reasoning"],
    },
    {
      id: "vendor/live-b:free",
      name: "Live B Free",
      context_length: 32000,
      pricing: { prompt: "0", completion: "0" },
      supported_parameters: ["tools"],
    },
    {
      id: "vendor/batched:batch",
      name: "Batched",
      context_length: 32000,
      pricing: { prompt: "0", completion: "0" },
      supported_parameters: ["tools"],
    },
    {
      id: "vendor/no-tools",
      name: "No Tools",
      context_length: 32000,
      pricing: { prompt: "0", completion: "0" },
      supported_parameters: [],
    },
  ],
};

test("openrouter enumerates its live catalog, not just the curated fallback", async (t) => {
  const calls = [];
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u === OPENROUTER_URL) {
      return new Response(JSON.stringify(LIVE), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected catalog fetch: ${u}`);
  };

  const crew = { providers: { openrouter: { enabled: true } }, keys: { openrouter: "sk-or-test" } };
  const models = await listModels(crew, true); // force: bypass the module-level cache

  const ids = models.openrouter.map((m) => m.id);
  assert.ok(ids.includes("vendor/live-a"), `live tool-capable model missing: ${ids.join(",")}`);
  assert.ok(!ids.includes("vendor/batched:batch"), ":batch ids should be filtered");
  assert.ok(!ids.includes("vendor/no-tools"), "models without tools support should be filtered");

  // Curated ids still merge in ahead of the live ones.
  const openrouterSpec = PROVIDER_SPECS.find((s) => s.id === "openrouter");
  for (const curated of openrouterSpec.models) {
    assert.ok(ids.includes(curated.id), `curated model ${curated.id} dropped`);
  }

  const free = models.openrouter.find((m) => m.id === "vendor/live-b:free");
  assert.ok(free, "free live model missing");
  assert.ok(free.tags.includes("free"), "free tag should come from pricing");

  // A provider whose catalog fetch fails falls back to its curated list rather than throwing.
  const anthropicSpec = PROVIDER_SPECS.find((s) => s.id === "anthropic");
  assert.equal(models.anthropic.length, anthropicSpec.models.length);
  assert.ok(calls.filter((u) => u === OPENROUTER_URL).length === 1, "openrouter catalog fetched exactly once");
});
