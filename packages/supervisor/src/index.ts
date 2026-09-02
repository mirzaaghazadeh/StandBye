#!/usr/bin/env node
import { parseArgs } from "./config.js";
import { Hub } from "./hub.js";
import { Api } from "./api.js";

const opts = parseArgs(process.argv.slice(2));
const hub = new Hub(opts);
if (process.env.ANTHROPIC_API_KEY) hub.keys.anthropic = process.env.ANTHROPIC_API_KEY;
if (process.env.OPENROUTER_API_KEY) hub.keys.openrouter = process.env.OPENROUTER_API_KEY;

const api = new Api(hub, opts.port, opts.token);

console.error(`[crew] supervisor up · data ${opts.dataDir} · teams ${hub.list().map((t) => `${t.name} (${t.agentCount})`).join(", ") || "(none)"}`);

const shutdown = (): void => {
  console.error("[crew] shutting down");
  hub.stop();
  api.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("disconnect", shutdown);
