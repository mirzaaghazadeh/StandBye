// A run the owner pays for should be identifiable as Standbye in their provider's dashboard.
// OpenRouter reads HTTP-Referer and X-Title and shows the title, linked, beside every request.
import test from "node:test";
import assert from "node:assert/strict";
import { generateText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APP_NAME, APP_URL } from "@crew/shared";
import { ATTRIBUTION_HEADERS } from "../dist/providers.js";

test("the attribution headers are the two OpenRouter reads", () => {
  assert.deepEqual(ATTRIBUTION_HEADERS, { "HTTP-Referer": APP_URL, "X-Title": APP_NAME });
  assert.match(ATTRIBUTION_HEADERS["HTTP-Referer"], /^https:\/\//, "the log links this, so it has to be a real URL");
  assert.ok(ATTRIBUTION_HEADERS["X-Title"].length > 0);
});

test("they reach the wire on a real call", async (t) => {
  const real = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (url, init) => {
    sent = { url: String(url), headers: new Headers(init?.headers) };
    return new Response(
      JSON.stringify({
        id: "gen-1", model: "z-ai/glm-5.3", object: "chat.completion", created: 0,
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  t.after(() => { globalThis.fetch = real; });

  // Built exactly as the runner and the team builder build it.
  const model = createOpenRouter({ apiKey: "sk-or-test", headers: ATTRIBUTION_HEADERS })("z-ai/glm-5.3");
  await generateText({ model, prompt: "hi" });

  assert.ok(sent, "no request was made");
  assert.match(sent.url, /openrouter\.ai/);
  assert.equal(sent.headers.get("http-referer"), APP_URL);
  assert.equal(sent.headers.get("x-title"), APP_NAME);
  // The key still has to get there; attribution must not have displaced it.
  assert.equal(sent.headers.get("authorization"), "Bearer sk-or-test");
});
