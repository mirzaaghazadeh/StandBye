// The prompt is re-sent on every step of a run, so what it contains (and omits) drives the bill.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeCrew, tempDir } from "./helpers.mjs";
import { systemPrompt, runPrompt } from "../dist/prompt.js";
import { clamp } from "../dist/runners/workspace.js";

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

test("a check-in gets the smallest prompt that can make its one decision", async (t) => {
  const { crew } = makeCrew(t);
  const agent = crew.listAgents()[0];
  const full = systemPrompt(crew, agent, "full");
  const checkin = systemPrompt(crew, agent, "checkin");

  await t.test("it is far smaller than a full run's", () => {
    assert.ok(checkin.length < full.length / 2, `check-in ${checkin.length} vs full ${full.length}`);
  });

  await t.test("it never advertises a tool the check-in does not have", () => {
    // A check-in holds only `escalate` and `done`. Naming the others invites a small model to
    // call one and burn the run.
    for (const tool of ["post_message", "ask_agent", "assign_task", "ask_user", "remember", "use_skill", "propose_hire"]) {
      assert.ok(!checkin.includes(tool), `check-in prompt must not mention ${tool}`);
    }
  });

  await t.test("it still says who they are and what to decide", () => {
    assert.ok(checkin.includes(agent.name));
    assert.match(checkin, /escalate/);
    assert.match(checkin, /done/);
  });

  await t.test("the things only a working run needs are left out", () => {
    assert.ok(!checkin.includes("# Your team"), "no roster");
    assert.ok(!checkin.includes("Git workflow"), "no git workflow");
    assert.ok(!/# Your workspace/.test(checkin), "no workspace tree");
  });

  await t.test("a full run still gets all of it", () => {
    for (const section of ["# Your team", "# How this works", "post_message"]) {
      assert.ok(full.includes(section), `full run keeps ${section}`);
    }
  });
});

test("the project's own house rules ride in the cached prompt", async (t) => {
  // Measured on a real task: about half the steps were orientation, including a step spent
  // reading CLAUDE.md. That detour repeats on every run, so the rules belong in the prefix.
  const work = tempDir("standbye-conv-");
  fs.writeFileSync(path.join(work, "CLAUDE.md"), "# CLAUDE.md\n\nRun `pnpm test` before committing. Never mention AI in a commit message.\n");
  const { crew } = makeCrew(t, { workspaceRoot: work });
  const agent = crew.listAgents()[0];
  const sys = systemPrompt(crew, agent, "full");

  await t.test("the rules are in the prompt already", () => {
    assert.match(sys, /pnpm test` before committing/);
    assert.match(sys, /CLAUDE\.md — this project's own instructions/);
  });
  await t.test("and the agent is told not to go and fetch them again", () => {
    assert.match(sys, /you do not need to go and read it again/);
  });
  await t.test("a check-in does not carry them, since it never does the work", () => {
    assert.ok(!systemPrompt(crew, agent, "checkin").includes("pnpm test` before committing"));
  });

  await t.test("a very long one is clipped rather than sent whole", () => {
    const big = tempDir("standbye-conv2-");
    fs.writeFileSync(path.join(big, "AGENTS.md"), "# Rules\n\n" + "policy line\n".repeat(2000));
    const { crew: c2 } = makeCrew(t, { workspaceRoot: big });
    const s2 = systemPrompt(c2, c2.listAgents()[0], "full");
    assert.match(s2, /AGENTS\.md — this project's own instructions/);
    assert.match(s2, /read `AGENTS\.md` yourself if you need the rest/);
    assert.ok(s2.length < 12000, `prompt stayed bounded, was ${s2.length}`);
  });

  await t.test("a project with no such file is unaffected", () => {
    const bare = tempDir("standbye-conv3-");
    const { crew: c3 } = makeCrew(t, { workspaceRoot: bare });
    assert.ok(!systemPrompt(c3, c3.listAgents()[0], "full").includes("this project's own instructions"));
  });
});

test("a direct message is a conversation, not a work order", async (t) => {
  // Measured: "hi" in a DM sent the agent to run `git log` and `git status` before answering —
  // three model round-trips and 41 seconds to say hello.
  const { crew } = makeCrew(t);
  const agent = crew.listAgents()[0];
  const dm = crew.listChannels().find((c) => c.kind === "dm" && c.dmAgentId === agent.id);
  const msg = crew.postMessage({ channel: dm.id, authorId: "user", text: "hi", kind: "chat", mentions: [agent.id] });
  const run = crew.createRun(agent.id, { kind: "mention", messageId: msg.id, by: "user", depth: 0 }, "m");
  const p = runPrompt(crew, agent, run);

  await t.test("it is framed as the owner talking to them", () => {
    assert.match(p, /wrote to you directly/);
    assert.match(p, /This is a conversation/);
  });
  await t.test("it says answer first, and do not go poking at the repo", () => {
    assert.match(p, /do not go and check the repo before saying hello/);
    assert.match(p, /Only look something up or touch the workspace if .* actually asked/);
  });

  await t.test("a mention in a group channel still means do the work", () => {
    const gm = crew.postMessage({ channel: "general", authorId: "user", text: `@${agent.name} ship it`, kind: "chat", mentions: [agent.id] });
    const gr = crew.createRun(agent.id, { kind: "mention", messageId: gm.id, by: "user", depth: 0 }, "m");
    const gp = runPrompt(crew, agent, gr);
    assert.match(gp, /Respond in that channel if a response is needed, or do the work/);
    assert.ok(!gp.includes("This is a conversation"));
  });
});
