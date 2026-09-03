#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "./config.js";
import { Hub } from "./hub.js";
import { Api } from "./api.js";
import { closeLog, initLog, log, logPath } from "./log.js";

const opts = parseArgs(process.argv.slice(2));
initLog(opts.dataDir);
// Advertise this instance so the desktop app (or a second launch) attaches instead of starting another supervisor.
const lockFile = path.join(opts.dataDir, "supervisor.json");
try {
  const prev = JSON.parse(fs.readFileSync(lockFile, "utf8")) as { pid: number; port: number };
  if (prev.pid !== process.pid && isAlive(prev.pid)) {
    log(`another supervisor (pid ${prev.pid}) already serves ${opts.dataDir} on port ${prev.port}; exiting`);
    process.exit(3);
  }
} catch { /* no lock */ }
fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, port: opts.port, token: opts.token, startedAt: new Date().toISOString() }), { mode: 0o600 });

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
const hub = new Hub(opts);
if (process.env.ANTHROPIC_API_KEY) hub.keys.anthropic = process.env.ANTHROPIC_API_KEY;
if (process.env.OPENROUTER_API_KEY) hub.keys.openrouter = process.env.OPENROUTER_API_KEY;

const api = new Api(hub, opts.port, opts.token);

log(`supervisor up · node ${process.version} · pid ${process.pid} · data ${opts.dataDir} · log ${logPath()} · teams ${hub.list().map((t) => `${t.name} (${t.agentCount})`).join(", ") || "(none)"}`);

const shutdown = (): void => {
  log("shutting down");
  hub.stop();
  api.close();
  closeLog();
  try { if ((JSON.parse(fs.readFileSync(lockFile, "utf8")) as { pid: number }).pid === process.pid) fs.rmSync(lockFile); } catch { /* ignore */ }
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("disconnect", shutdown);
