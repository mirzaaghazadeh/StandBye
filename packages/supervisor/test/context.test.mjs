// Trimming the conversation is the main cost lever in a tool loop, so it has to be exact:
// never touch recent turns, never touch the task, and never rewrite when nothing is worth cutting
// (an unchanged prefix is what lets provider caching hit).
import test from "node:test";
import assert from "node:assert/strict";
import { trimConversation, DEFAULT_TRIM } from "../dist/runners/context.js";

const big = (n = 4000) => "x".repeat(n);
const toolMsg = (id, value) => ({ role: "tool", content: [{ type: "tool-result", toolCallId: id, toolName: "bash", output: { type: "text", value } }] });
const assistant = (id) => ({ role: "assistant", content: [{ type: "tool-call", toolCallId: id, toolName: "bash", input: {} }] });

/** A run of `turns` tool calls, each returning a fat payload. */
function conversation(turns, payload = big()) {
  const out = [{ role: "user", content: "the task" }];
  for (let i = 0; i < turns; i++) { out.push(assistant("c" + i), toolMsg("c" + i, payload)); }
  return out;
}

test("old tool results are replaced, recent ones are not", async (t) => {
  const msgs = conversation(8);
  const out = trimConversation(msgs);
  const value = (m) => m.content[0].output.value;
  const tools = out.filter((m) => m.role === "tool");

  await t.test("the task survives untouched", () => {
    assert.equal(out[0].content, "the task");
  });
  await t.test("the last three turns keep their payload", () => {
    for (const m of tools.slice(-DEFAULT_TRIM.keepRecentTurns)) assert.equal(value(m).length, 4000);
  });
  await t.test("earlier ones are replaced by a stand-in that says what happened", () => {
    for (const m of tools.slice(0, -DEFAULT_TRIM.keepRecentTurns)) {
      assert.match(value(m), /characters dropped/);
      assert.match(value(m), /Re-run the tool/);
      assert.ok(value(m).length < 200);
    }
  });
  await t.test("the tool call itself is still visible to the model", () => {
    assert.equal(out.filter((m) => m.role === "assistant").length, 8, "the model must still see that it ran these");
  });
  await t.test("it is a big saving", () => {
    const size = (a) => JSON.stringify(a).length;
    assert.ok(size(out) < size(msgs) * 0.5, `trimmed to ${Math.round((size(out) / size(msgs)) * 100)}% of the original`);
  });
});

test("it leaves the conversation alone when there is nothing to gain", async (t) => {
  await t.test("a short run is returned by reference, so the cached prefix still matches", () => {
    const msgs = conversation(2);
    assert.equal(trimConversation(msgs), msgs, "same reference means untouched");
  });
  await t.test("small results are not worth replacing", () => {
    const msgs = conversation(8, "ok");
    assert.equal(trimConversation(msgs), msgs);
  });
  await t.test("a conversation with no tool results is untouched", () => {
    const msgs = [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }];
    assert.equal(trimConversation(msgs), msgs);
  });
});

test("trimming is stable when applied repeatedly", async (t) => {
  const once = trimConversation(conversation(8));
  const twice = trimConversation(once);
  await t.test("a second pass changes nothing more", () => {
    assert.deepEqual(twice, once, "otherwise every step would rewrite the prefix and break caching");
  });
});

test("re-reading a file does not pay for the old copy", async (t) => {
  // Measured on a real run: nine reads of four files, one read four times. Every copy but the
  // newest is stale, and each is re-sent on every following step.
  const body = "x".repeat(4000);
  const read = (id, path, value) => ([
    { role: "assistant", content: [{ type: "tool-call", toolCallId: id, toolName: "read_file", input: { path } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: id, toolName: "read_file", output: { type: "text", value } }] },
  ]);
  const messages = [
    { role: "user", content: "wire up the classifier" },
    ...read("a", "src/types.ts", "FIRST" + body),
    ...read("b", "src/openai.ts", "OTHER" + body),
    ...read("c", "src/types.ts", "SECOND" + body),
  ];
  const out = trimConversation(messages);
  const text = JSON.stringify(out);

  await t.test("the newest copy of the file survives in full", () => {
    assert.ok(text.includes("SECOND" + body.slice(0, 50)), "latest read is kept verbatim");
  });
  await t.test("the earlier copy of the same file is dropped", () => {
    assert.ok(!text.includes("FIRST" + body.slice(0, 50)), "the stale copy is gone");
    assert.match(text, /you read src\/types\.ts again later in this run/);
  });
  await t.test("a different file is untouched", () => {
    assert.ok(text.includes("OTHER" + body.slice(0, 50)), "openai.ts was only read once");
  });
  await t.test("nothing changes when every file was read once", () => {
    const once = [{ role: "user", content: "go" }, ...read("a", "src/a.ts", body), ...read("b", "src/b.ts", body)];
    assert.equal(trimConversation(once), once, "same reference, so the cached prefix stays byte-identical");
  });
  await t.test("a windowed read is not superseded by a full one", () => {
    const windowed = [
      { role: "user", content: "go" },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "w", toolName: "read_file", input: { path: "src/big.ts", offset: 200 } }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "w", toolName: "read_file", output: { type: "text", value: "WINDOW" + body } }] },
      ...read("f", "src/big.ts", "FULL" + body),
    ];
    assert.ok(JSON.stringify(trimConversation(windowed)).includes("WINDOW" + body.slice(0, 40)), "the slice is still its own fact");
  });
});
