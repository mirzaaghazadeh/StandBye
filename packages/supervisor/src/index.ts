#!/usr/bin/env node
import { parseArgs } from "./config.js";
import { Crew } from "./crew.js";
import { Scheduler } from "./scheduler.js";
import { Api } from "./api.js";

const opts = parseArgs(process.argv.slice(2));
const crew = new Crew(opts);
if (process.env.ANTHROPIC_API_KEY) crew.keys.anthropic = process.env.ANTHROPIC_API_KEY;
if (process.env.OPENROUTER_API_KEY) crew.keys.openrouter = process.env.OPENROUTER_API_KEY;

const scheduler = new Scheduler(crew);
const api = new Api(crew, scheduler, opts.port, opts.token);
scheduler.start();

console.error(`[crew] supervisor up · data ${opts.dataDir} · team ${crew.team?.name ?? "(none)"} · agents ${crew.listAgents().length}`);

const shutdown = (): void => {
  console.error("[crew] shutting down");
  scheduler.stop();
  api.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("disconnect", shutdown);
