// A "what are you working on?" took 28 seconds and ~17,500 input tokens, because the run was given
// the whole working apparatus — the file tree, the conventions, the backlog, the skills catalogue,
// every file and shell tool — to type two sentences.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeCrew, tempDir } from "./helpers.mjs";
import { systemPrompt } from "../dist/prompt.js";

process.env.CREW_DISABLE_CLAUDE_LOGIN = "1";
const tok = (s) => Math.round(s.length / 4);

test("answering the owner does not carry the whole working apparatus", async (t) => {
  const work = tempDir("standbye-reply-");
  fs.writeFileSync(`${work}/CLAUDE.md`, "# CLAUDE.md\n\nRun `pnpm test` before committing.\n");
  const { crew } = makeCrew(t, { workspaceRoot: work });
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const agent = crew.listAgents()[0];
  crew.backlog.add({ title: "Something on the board", rationale: "because", addedBy: "user", status: "ready" });

  const full = systemPrompt(crew, agent, "full");
  const reply = systemPrompt(crew, agent, "reply");

  await t.test("it is a fraction of a working prompt", () => {
    assert.ok(tok(reply) < tok(full) / 3, `reply ${tok(reply)} vs full ${tok(full)} tokens`);
  });

  await t.test("none of the things that only help you do work are in it", () => {
    for (const junk of ["# Your workspace", "this project's own instructions", "pnpm test` before committing", "Something on the board", "# Your skills", "Git workflow"]) {
      assert.ok(!reply.includes(junk), `a reply does not need: ${junk}`);
    }
  });

  await t.test("it still knows who it is and what it has been doing", () => {
    assert.match(reply, new RegExp(agent.name));
    assert.match(reply, /What you have been doing/);
    assert.match(reply, /is talking to you/);
  });

  await t.test("it is told to answer from what it knows, not go looking", () => {
    assert.match(reply, /Do not go and look things up, read files or run commands/);
  });

  await t.test("and to hand over when it is really work", () => {
    assert.match(reply, /call `escalate`/);
    assert.match(reply, /Answering a question is not work/);
  });

  await t.test("a working run still gets everything", () => {
    for (const needed of ["# Your workspace", "Something on the board", "this project's own instructions"]) {
      assert.ok(full.includes(needed), `a full run keeps: ${needed}`);
    }
  });
});
