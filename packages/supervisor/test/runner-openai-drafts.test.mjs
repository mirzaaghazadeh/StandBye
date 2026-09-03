// Mid-stream failures inside a streamed post_message used to strand the desktop's
// "writing…" draft: the store (apps/desktop/src/renderer/state/store.ts) only clears a
// draft on message.created or a done:true message.draft, and the runner's drafting map
// lived inside the try where the catch could not reach it. Here the SSE stream emits
// tool-input-start for post_message, two argument deltas, then an error part — no
// network, the response comes from a stubbed fetch (see test/helpers.mjs) — and the
// assertions cover the catch's sweep (done:true with the partial text) and a second run
// on the same runner instance starting from a clean map.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openaiRunner } from "../dist/runners/openai.js";

const SPEC = { id: "custom", name: "Custom OpenAI-compatible", auth: "key", baseUrl: "https://provider.invalid/v1" };

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

// One chat.completion.chunk SSE event per call, the wire format @ai-sdk/openai-compatible parses.
const sse = (delta) =>
  `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", created: 1756900000, model: "stub", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;

/** post_message tool call: start, two argument deltas growing the message text, then a mid-stream error part. */
function streamBody(channel, textA, textB) {
  const events = [
    sse({ role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "post_message", arguments: "" } }] }),
    sse({ tool_calls: [{ index: 0, function: { arguments: `{"channel":"${channel}","text":"${textA}` } }] }),
    sse({ tool_calls: [{ index: 0, function: { arguments: `${textB}"}` } }] }),
    `data: ${JSON.stringify({ error: { message: "rate limit exceeded mid-stream", type: "server_error" } })}\n\n`,
    "data: [DONE]\n\n",
  ];
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < events.length) controller.enqueue(encoder.encode(events[i++]));
      else controller.close();
    },
  });
}

function streamingFetch(channel, textA, textB) {
  return async () => new Response(streamBody(channel, textA, textB), { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

/** Record every message.draft the runner publishes on crew.bus. */
function recordingCrew() {
  const drafts = [];
  return { drafts, crew: { keys: { custom: "sk-test" }, addStep: () => {}, bus: { emit: (event, data) => { if (event === "message.draft") drafts.push(data); } } } };
}

test("mid-stream error sweeps a half-written post_message draft with done:true, and the next run starts clean", async () => {
  const { drafts, crew } = recordingCrew();
  const real = globalThis.fetch;
  try {
    // Run 1: draft in channel "general" dies mid-stream.
    globalThis.fetch = streamingFetch("general", "hel", "lo world");
    const out1 = await openaiRunner(input({ crew, run: { id: "r1" } }));
    assert.equal(out1.failure, "rate_limit");
    // Run 2, same instance, different channel: must see only its own drafts.
    globalThis.fetch = streamingFetch("ops", "o", "ps");
    const out2 = await openaiRunner(input({ crew, run: { id: "r2" } }));
    assert.equal(out2.failure, "rate_limit");
  } finally {
    globalThis.fetch = real;
  }

  const sweep1 = drafts.filter((d) => d.channelId === "general" && d.done);
  assert.equal(sweep1.length, 1, `expected exactly one done:true sweep for "general", got ${JSON.stringify(drafts)}`);
  assert.deepEqual(sweep1[0], { runId: "r1", agentId: "a1", channelId: "general", text: "hello world", done: true });

  const live1 = drafts.filter((d) => d.channelId === "general" && !d.done);
  assert.deepEqual(live1.map((d) => d.text), ["hel", "hello world"], "streaming loop should publish each growth before the error");

  const ops = drafts.filter((d) => d.channelId === "ops");
  assert.deepEqual(ops.filter((d) => d.done), [{ runId: "r2", agentId: "a1", channelId: "ops", text: "ops", done: true }], "run 2 should sweep its own draft and nothing from run 1");
  assert.deepEqual(ops.filter((d) => !d.done).map((d) => d.text), ["o", "ops"]);

  // The sweep is terminal: nothing may publish after it for the same channel.
  const lastGeneral = drafts.map((d, i) => (d.channelId === "general" ? i : -1)).filter((i) => i >= 0).pop();
  assert.ok(drafts.slice(lastGeneral + 1).every((d) => d.channelId !== "general"), "events for a swept channel must not continue after done:true");
});
