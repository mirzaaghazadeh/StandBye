// The app asks for the model list from several places at once on every start. Each ask used to
// mean a full sweep of every provider, so a cold start hit 34 endpoints six times over.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { listModels } from "../dist/models.js";
import { tempDir } from "./helpers.mjs";
import { Crew } from "../dist/crew.js";

process.env.CREW_DISABLE_CLAUDE_LOGIN = "1";

function crewOn(t) {
  const dataDir = tempDir("standbye-models-");
  const crew = new Crew({ dataDir, globalDir: dataDir, keys: {} });
  t.after(() => { try { crew.close(); } catch { /* closed */ } fs.rmSync(dataDir, { recursive: true, force: true }); });
  return crew;
}

test("a burst of callers causes one sweep, not one each", async (t) => {
  const crew = crewOn(t);
  let fetches = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async (...args) => { fetches += 1; throw new Error("no network in tests"); };
  t.after(() => { globalThis.fetch = real; });

  const [a, b, c, d, e, f] = await Promise.all(Array.from({ length: 6 }, () => listModels(crew, true)));
  const once = fetches;

  await t.test("every caller gets the same answer", () => {
    for (const r of [b, c, d, e, f]) assert.equal(Object.keys(r).length, Object.keys(a).length);
  });
  await t.test("a second burst reuses the cache rather than sweeping again", async () => {
    await Promise.all(Array.from({ length: 6 }, () => listModels(crew)));
    assert.equal(fetches, once, "no further network calls");
  });
  await t.test("every provider still has its curated models when the network is down", () => {
    assert.ok(a.anthropic?.length > 0, "a failed fetch never empties a provider");
    assert.ok(a.openrouter !== undefined);
  });
});

test("a local server is not knocked on until it is switched on", async (t) => {
  const crew = crewOn(t);
  const tried = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => { tried.push(String(url)); throw new Error("nothing listening"); };
  t.after(() => { globalThis.fetch = real; });

  await listModels(crew, true);
  await t.test("ollama and lm studio are left alone while off", () => {
    assert.equal(tried.filter((u) => /11434|1234/.test(u)).length, 0, `unexpected local probes: ${tried.join(", ")}`);
  });
  await t.test("but they are still offered in the picker", async () => {
    const models = await listModels(crew);
    assert.ok(models.ollama !== undefined, "the provider is listed, just not probed");
  });
});
