#!/usr/bin/env node
// No-key smoke test for the supervisor: boots on a scratch dir, creates the template team,
// exercises the API, the tool layer (via tools.call) and the hire flow. No model calls.
// Usage: node scripts/smoke.mjs
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "standbye-smoke-"));
const port = 47300 + Math.floor(Math.random() * 500);
const proc = spawn(process.execPath, [path.join(root, "packages/supervisor/dist/index.js"), "--data", dataDir, "--port", String(port), "--token", "t"], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "", CREW_DISABLE_CLAUDE_LOGIN: "1" } });
let stderr = "";
proc.stderr.on("data", (d) => (stderr += d));
await new Promise((r) => setTimeout(r, 1200));

const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=t`);
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let id = 1;
const pending = new Map();
const events = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (typeof m.id === "number") { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  else events.push(m.event);
});
const rpc = (method, params = {}) => new Promise((resolve, reject) => { const i = id++; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " · " + detail : ""}`); if (!ok) failed++; };

try {
  const status = await rpc("status.get");
  check("status", status.runsToday === 0 && status.teamId === null);
  const draft = await rpc("builder.draft", { description: "", ownerName: "Navid", workspaceRoot: null, mode: "template" });
  check("template draft", draft.agents.length === 4, draft.agents.map((a) => a.name).join(","));
  check("lead has schedules", (draft.agents[0].schedules ?? []).length === 3);
  const created = await rpc("teams.create", { draft, workspaceRoot: null, ownerName: "Navid" });
  check("team created", Boolean(created.id));
  const second = await rpc("teams.create", { draft: { ...draft, name: "Second team", agents: draft.agents.slice(0, 1) }, workspaceRoot: "/tmp", ownerName: "Navid" });
  check("second team has its own workspace", second.workspaceRoot === "/tmp" && second.id !== created.id);
  const teams = await rpc("teams.list");
  check("two teams listed", teams.length === 2 && teams.find((t) => t.id === second.id)?.agentCount === 1);
  await rpc("teams.select", { id: created.id });
  const agents = await rpc("agents.list");
  check("agents created", agents.length === 4 && agents.every((a) => a.status === "idle" || a.status === "over_budget"));
  check("cron mapped", agents.find((a) => a.id === "ada").triggers.cron.length === 3);
  const channels = await rpc("channels.list");
  check("channels", channels.map((c) => c.name).sort().join(",") === "backend,general,reviews");
  const files = await rpc("agent.files.get", { id: "kai" });
  check("agent files", files.soul.startsWith("# Kai") && files.rules.includes("Rules"));

  // Tool layer through the external bridge path (no model involved).
  const post = await rpc("tools.call", { agentId: "ada", tool: "post_message", args: { channel: "general", text: "@Kai please look at the queue design" } });
  check("post_message", /Posted to #general/.test(post.text), post.text);
  await new Promise((r) => setTimeout(r, 1500));
  const runs = await rpc("runs.list");
  const kaiRun = runs.find((r) => r.agentId === "kai" && r.trigger.kind === "mention");
  check("mention woke Kai", Boolean(kaiRun), kaiRun ? kaiRun.status + " · " + (kaiRun.error ?? "") : "no run");
  check("run failed cleanly without keys", kaiRun?.status === "failed" && /key|login/i.test(kaiRun.error ?? ""));

  const ask = await rpc("tools.call", { agentId: "kai", tool: "ask_user", args: { title: "SQLite or Postgres?", body: "One box.", options: ["SQLite", "Postgres"], recommended: "SQLite", default_answer: "SQLite", default_in_minutes: 60 }, runId: post.runId });
  check("ask_user", /filed/.test(ask.text), ask.text);
  let qs = await rpc("questions.list", { status: "open" });
  const q = qs.find((x) => x.title === "SQLite or Postgres?");
  check("question open with default", q && q.defaultAt && q.toId === "user");
  await rpc("questions.answer", { id: q.id, answer: "SQLite", remember: true });
  const decisions = await rpc("decisions.list");
  check("decision remembered", decisions.some((d) => d.answer === "SQLite"));

  const hire = await rpc("tools.call", { agentId: "ada", tool: "propose_hire", args: { name: "Vera", role: "Reviewer", reason: "Six PRs a day, Rex is swamped.", provider: "openrouter", daily_budget_usd: 1 } });
  check("propose_hire", /proposal/.test(hire.text), hire.text);
  qs = await rpc("questions.list", { status: "open" });
  const h = qs.find((x) => x.kind === "hire");
  await rpc("questions.answer", { id: h.id, answer: "Approve" });
  await new Promise((r) => setTimeout(r, 500));
  const after = await rpc("agents.list");
  check("hire approved creates agent", after.some((a) => a.id === "vera" && a.provider === "openrouter"));

  const skill = await rpc("tools.call", { agentId: "kai", tool: "learn_skill", args: { name: "Run tests", content: "# Run tests\n\n1. `pytest -x` locally first.\n2. Never rely on CI to find the first failure." } });
  check("learn_skill", /saved/.test(skill.text));
  const skills = await rpc("agent.skills.list", { id: "kai" });
  check("skills listed", skills.length === 1 && skills[0].name === "run-tests");

  const report = await rpc("tools.call", { agentId: "ada", tool: "ask_user", args: { title: "End of day", body: "Nothing shipped, smoke test only.", kind: "report" } });
  check("report to inbox", /delivered/.test(report.text));
  const rex = (await rpc("agents.list")).find((a) => a.id === "ada");
  check("report does not block the agent", rex.status !== "needs_you");

  await rpc("supervisor.pauseAll");
  check("pause all", (await rpc("agents.list")).every((a) => a.status === "paused"));
  await rpc("supervisor.resumeAll");
  await rpc("teams.select", { id: second.id });
  check("other team unaffected", (await rpc("agents.list")).every((a) => a.status !== "paused"));
  await rpc("teams.delete", { id: second.id });
  check("team deleted", (await rpc("teams.list")).length === 1);
  check("events carry teamId", events.some((e) => e === "message.created"));
  check("events flowed", ["message.created", "question.created", "run.updated", "agents.updated"].every((e) => events.includes(e)), [...new Set(events)].join(","));
} catch (e) {
  failed++;
  console.error("FAIL", e);
} finally {
  ws.close();
  proc.kill("SIGTERM");
  fs.rmSync(dataDir, { recursive: true, force: true });
}
if (failed) { console.error(`\n${failed} check(s) failed`); if (stderr) console.error(stderr.slice(-2000)); process.exit(1); }
console.log("\nall good");
