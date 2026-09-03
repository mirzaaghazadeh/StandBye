// The prompt is re-sent on every step of a run, so what it contains (and omits) drives the bill.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeCrew, tempDir } from "./helpers.mjs";
import { systemPrompt, runPrompt } from "../dist/prompt.js";
import { clamp } from "../dist/runners/openrouter.js";

test("the system prompt tells an agent where it is", async (t) => {
  const work = tempDir("standbye-ws-");
  fs.mkdirSync(path.join(work, "assets"));
  fs.writeFileSync(path.join(work, "index.html"), "<!doctype html>");
  fs.writeFileSync(path.join(work, "assets", "app.js"), "// app");
  fs.mkdirSync(path.join(work, "node_modules", "junk"), { recursive: true });
  const { crew } = makeCrew(t);
  crew.updateTeam({ workspaceRoot: work });

  const p = systemPrompt(crew, crew.getAgent("kai"), "full");

  await t.test("the absolute path is stated", () => {
    assert.ok(p.includes(work), "an agent that is not told its path goes hunting for it with cd/find");
  });
  await t.test("it says not to go looking", () => {
    assert.match(p, /never go hunting|already in it/i);
  });
  await t.test("the file tree is included", () => {
    assert.ok(p.includes("index.html"), "top-level files");
    assert.ok(p.includes("assets/"), "directories");
    assert.ok(p.includes("app.js"), "one level down");
  });
  await t.test("noise is left out", () => {
    assert.ok(!p.includes("node_modules"), "node_modules would swamp the tree");
  });
  await t.test("it stays small", () => {
    assert.ok(p.length < 12000, `system prompt is ${p.length} chars; it is re-sent on every step`);
  });

  await t.test("no workspace is stated plainly rather than left blank", () => {
    const { crew: c2 } = makeCrew(t);
    c2.updateTeam({ workspaceRoot: null });
    assert.match(systemPrompt(c2, c2.getAgent("kai"), "full"), /no workspace folder/i);
  });
});

test("the run prompt reminds an agent what it already finished", async (t) => {
  const { crew } = makeCrew(t);
  const done = crew.createRun("kai", { kind: "mention", messageId: "m1", by: "ada", depth: 1 }, "m");
  crew.finishRun(done, "done", "Built the landing page and committed it");
  const next = crew.createRun("kai", { kind: "heartbeat" }, "m");

  const p = runPrompt(crew, crew.getAgent("kai"), next);
  await t.test("the earlier summary is there", () => {
    assert.match(p, /already did/i);
    assert.ok(p.includes("Built the landing page"));
  });
  await t.test("the current run is not listed as past work", () => {
    assert.ok(!p.includes(next.id));
  });
  await t.test("a first run says nothing about past work", () => {
    const { crew: c2 } = makeCrew(t);
    const first = c2.createRun("rex", { kind: "heartbeat" }, "m");
    assert.ok(!/already did/i.test(runPrompt(c2, c2.getAgent("rex"), first)));
  });
});

test("long command output is clamped from the middle", async (t) => {
  await t.test("short output is untouched", () => {
    assert.equal(clamp("hello", 100), "hello");
  });
  await t.test("long output keeps the head and the tail", () => {
    const text = "START" + "x".repeat(50_000) + "END";
    const out = clamp(text, 6000);
    assert.ok(out.length < 6500, `clamped to ${out.length}`);
    assert.ok(out.startsWith("START"), "the beginning is usually the answer");
    assert.ok(out.endsWith("END"), "so is the end of a command's output");
    assert.match(out, /characters cut from the middle/);
  });
});
