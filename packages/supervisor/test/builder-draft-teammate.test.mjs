// draftTeammate: describing a single teammate for an existing team (BuilderSheet "Describe"
// for one agent). Error paths are deterministic: provider readiness and team selection are
// checked before anything costs money. The happy path stubs the OpenRouter endpoint the way
// the real API answers, so the whole call → parse → adaptAgent pipeline runs for real.
import assert from "node:assert/strict";
import test from "node:test";
import { PROVIDERS } from "@crew/shared";
import { draftTeammate } from "../dist/builder.js";
import { makeCrew } from "./helpers.mjs";

const draftJson = {
  name: "Quinn",
  role: "Release manager",
  provider: "openrouter",
  model: "z-ai/glm-5.3-flash",
  soul: "You are Quinn. You cut releases and own the changelog.",
  rules: ["Never push to main without approval", "Only touch files inside the repo"],
  responsibilities: ["Cut releases", "Triage regressions"],
  heartbeatMinutes: 60,
  dailyBudgetUsd: 2,
  perRunBudgetUsd: 0.5,
  capBy: "day",
  channels: ["general"],
  color: "#D7E3DA",
};

function stubOpenRouter(t, calls) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(
      JSON.stringify({
        id: "cmpl-test",
        object: "chat.completion",
        created: 1,
        model: "z-ai/glm-5.3-flash",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify(draftJson) },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }),
      { headers: { "content-type": "application/json" } },
    );
  };
  t.after(() => {
    globalThis.fetch = real;
  });
}

test("draftTeammate refuses before spending anything when no provider is ready", async (t) => {
  const { crew } = await makeCrew(t, { withTeam: true });
  crew.setProviders(Object.fromEntries(PROVIDERS.map((spec) => [spec.id, { enabled: false }])));
  await assert.rejects(
    () => draftTeammate(crew, { description: "a release manager", ownerName: "Navid" }),
    /No provider is ready to draft a teammate/,
  );
});

test("draftTeammate refuses the provider the owner asked for when it is not ready", async (t) => {
  const { crew } = await makeCrew(t, { withTeam: true });
  crew.setProviders({ openrouter: { enabled: true, defaultModel: "z-ai/glm-5.3-flash" } });
  crew.keys.openrouter = "test-key";
  await assert.rejects(
    () => draftTeammate(crew, { description: "a release manager", ownerName: "Navid", provider: "groq" }),
    /Groq is not ready/,
  );
});

test("draftTeammate refuses when no team is open", async (t) => {
  const { crew } = await makeCrew(t, { withTeam: false });
  crew.setProviders({ openrouter: { enabled: true, defaultModel: "z-ai/glm-5.3-flash" } });
  crew.keys.openrouter = "test-key";
  await assert.rejects(
    () => draftTeammate(crew, { description: "a release manager", ownerName: "Navid" }),
    /No team is selected/,
  );
});

test("draftTeammate drafts one teammate through the ready provider", async (t) => {
  const { crew } = await makeCrew(t, { withTeam: true });
  // openrouter is the only ready provider, so the draft goes through it regardless of
  // catalog order or defaults (ollama is ready by default and would otherwise be picked).
  crew.setProviders({
    ...Object.fromEntries(PROVIDERS.map((spec) => [spec.id, { enabled: false }])),
    openrouter: { enabled: true, defaultModel: "z-ai/glm-5.3-flash" },
  });
  crew.keys.openrouter = "test-key";
  const calls = [];
  stubOpenRouter(t, calls);
  const draft = await draftTeammate(crew, { description: "a release manager", ownerName: "Navid" });

  assert.equal(draft.name, "Quinn");
  assert.equal(draft.provider, "openrouter");
  assert.equal(draft.model, "z-ai/glm-5.3-flash");
  assert.deepEqual(draft.responsibilities, draftJson.responsibilities);

  // exactly one LLM call, and the prompt carries the ask plus the team's context
  assert.equal(calls.length, 1);
  const body = JSON.stringify(calls[0].body);
  assert.match(body, /release manager/);
  assert.match(body, /Quinn|release/); // team context: existing agents and channels are named
  assert.equal(calls[0].body.model, "z-ai/glm-5.3-flash");
});
