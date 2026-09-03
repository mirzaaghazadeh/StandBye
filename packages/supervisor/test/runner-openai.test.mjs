// Failure classification in the OpenAI-compatible runner: whatever the provider throws
// must come back as a RunnerOutput.failure kind the owner can act on (auth, credit,
// rate_limit, ...), never as a generic crash. blocksAgent() marks which kinds are
// owner-actionable; executeRun does not consume out.failure yet, so nothing pauses the
// agent today — the scheduler just re-fails it on the next check-in. Wiring the pause
// into executeRun is the owner's call (asked 2026-09-03).
//
// House rule (test/helpers.mjs): no test may make a network call or a model call.
// globalThis.fetch is stubbed, so the runner runs its real tool loop against an error
// response that never leaves the process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openaiRunner } from "../dist/runners/openai.js";
import { blocksAgent } from "../dist/runners/types.js";

/** A catalog entry as providers.ts would hand one over. */
const SPEC = { id: "custom", name: "Custom OpenAI-compatible", auth: "key", baseUrl: "https://provider.invalid/v1" };

/** Minimal RunnerInput: only what openaiRunner touches before the model call, plus no-op hooks. */
function input(overrides = {}) {
  return {
    crew: { keys: { custom: "sk-test" }, addStep: () => {} },
    agent: { id: "a1", permissions: {}, budget: { perRunUsd: 1 } },
    run: { id: "r1" },
    mode: "checkin",
    model: "stub-model",
    system: "You are a stub.",
    prompt: "Say nothing.",
    ctx: {},
    cwd: process.cwd(),
    signal: new AbortController().signal,
    spec: SPEC,
    config: { settings: { baseUrl: "http://127.0.0.1:9/v1" } },
    ...overrides,
  };
}

/** Run one runner call with fetch stubbed to a fixed status + JSON body. */
async function withFetch(status, body, overrides) {
  const real = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  try {
    return await openaiRunner(input(overrides));
  } finally {
    globalThis.fetch = real;
  }
}

test("openai runner: 401 from the provider classifies as auth and blocks the agent", async () => {
  const out = await withFetch(401, { error: { message: "Invalid API key provided", code: "invalid_api_key" } });
  assert.equal(out.failure, "auth");
  assert.ok(out.error.length > 0);
  assert.equal(blocksAgent(out.failure), true);
});

test("openai runner: 402 from the provider classifies as credit and blocks the agent", async () => {
  const out = await withFetch(402, {
    error: { message: "Insufficient credits: your credit balance is too low.", code: "insufficient_credits" },
  });
  assert.equal(out.failure, "credit");
  assert.ok(out.error.length > 0);
  assert.equal(blocksAgent(out.failure), true);
});

test("openai runner: 429 from the provider classifies as rate_limit, not a blocking failure", async () => {
  const out = await withFetch(429, { error: { message: "Rate limit exceeded: free-model requests per day." } });
  assert.equal(out.failure, "rate_limit");
  assert.equal(blocksAgent(out.failure), false);
});

test("openai runner: 5xx from the provider classifies as provider-side trouble", async () => {
  const out = await withFetch(500, { error: { message: "Internal server error" } });
  assert.equal(out.failure, "provider");
  assert.equal(blocksAgent(out.failure), false);
});

test("openai runner: a saved key is required before any request is attempted", async () => {
  const out = await openaiRunner(input({ crew: { keys: {}, addStep: () => {} } }));
  assert.equal(out.failure, "auth");
  assert.equal(blocksAgent(out.failure), true);
});
