import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { CliSpec, ProviderConfig, ProviderSpec } from "@crew/shared";
import { DEFAULTS } from "../config.js";
import { log } from "../log.js";
import { childPath, findBin } from "../providers.js";
import { clamp } from "./workspace.js";
import { classifyText, type FailureKind, type Runner } from "./types.js";

/**
 * The runner for coding agents somebody else wrote: Codex, Copilot, Cursor, OpenCode, Droid,
 * Amp and the rest. This is how a ChatGPT plan or a Copilot seat becomes a teammate — their CLI
 * already holds the login, so the owner pays their existing subscription and nothing per run.
 *
 * Two things make it work:
 *
 *  - The CLI runs in headless mode with the run prompt, in the team's workspace. It brings its
 *    own file and shell tools, its own model and its own sandbox; we do not gate its tools,
 *    because we are not in the loop. The workspace is still the only directory it is pointed at,
 *    and the run timeout still stops it.
 *
 *  - Where the CLI can take an MCP server on the command line, we hand it the team's stdio MCP
 *    bridge, so it can read channels, mention teammates, ask the owner and finish with `done`
 *    exactly like a Claude agent. Where it cannot, the run is one-shot: whatever it printed
 *    becomes the run summary. The settings screen says which of the two an agent will get.
 *
 * Invocation lives in the catalog and is editable by the owner, because a vendor changing a
 * flag should be a thirty-second fix in Settings, not a release.
 */
export const cliRunner: Runner = async (input) => {
  const { crew, agent, run, mode, ctx, signal, cwd, spec, config } = input;
  const cli = spec.cli;
  if (!cli) return fail(`${spec.name} has no CLI defined.`, "other");

  const bin = config.cli?.bin || cli.bin;
  const resolved = findBin(bin);
  if (!resolved) return fail(`${bin} is not installed. ${cli.install}`, "auth");

  // A check-in on someone else's CLI would spawn a whole agent process to answer "anything new?",
  // which is neither cheap nor fast. Run the check-in prompt anyway but with the short timeout,
  // and let the escalation path do the real work.
  const timeoutMs = (mode === "checkin" ? DEFAULTS.checkinTimeoutMinutes : DEFAULTS.runTimeoutMinutes) * 60_000;

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "standbye-cli-"));
  let mcpArgs: string[] = [];
  try {
    mcpArgs = cli.mcp ? mcpArguments(cli, scratch, crew.id ?? "", agent.id, crew.api) : [];
  } catch (e) {
    log(`could not build an MCP config for ${bin}: ${e instanceof Error ? e.message : String(e)}`, { agent: agent.id, run: run.id });
  }

  const template = config.cli?.args ?? cli.args;
  const prompt = fullPrompt(input.system, input.prompt, Boolean(cli.mcp));
  // MCP flags go first: `codex -c … exec …` and friends want their globals before the subcommand.
  const args = [...mcpArgs, ...substitute(template, { prompt, model: cli.fixedModel ? "" : input.model, cwd })];

  crew.addStep(run.id, "info", `${bin} ${cli.mcp ? "with the team tools" : "(output only — this CLI cannot call team tools)"}`);

  let out = "";
  let stderr = "";
  let flushed = 0;
  let steps = 0;
  const flush = (force = false) => {
    // Show the owner what it is saying as it goes, without turning a chatty CLI into 500 rows.
    const pending = out.slice(flushed);
    if (!pending.trim()) return;
    if (!force && pending.length < 1200) return;
    if (steps >= 40) return;
    crew.addStep(run.id, "text", clamp(pending.trim(), 4000));
    flushed = out.length;
    steps++;
  };

  const code = await new Promise<number | string>((resolve) => {
    const child = spawn(resolved, args, {
      cwd,
      env: { ...process.env, PATH: childPath(), STANDBYE_AGENT: agent.id, STANDBYE_TEAM: crew.id ?? "", NO_COLOR: "1", CI: "1" },
      stdio: ["pipe", "pipe", "pipe"] as const,
    });
    const timer = setTimeout(() => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 5_000); }, timeoutMs);
    const onAbort = () => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 5_000); };
    signal.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (b: Buffer) => { out += b.toString(); flush(); });
    child.stderr.on("data", (b: Buffer) => { stderr += b.toString(); });
    // Close stdin at once: a CLI that would otherwise wait for interactive input gets EOF and
    // falls back to its headless path instead of hanging until the run timeout.
    child.stdin.end();

    child.on("error", (e) => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); resolve(e.message); });
    child.on("close", (c) => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); resolve(c ?? 0); });
  });

  flush(true);
  fs.rmSync(scratch, { recursive: true, force: true });

  const text = clamp(out.trim(), 8000);
  let error: string | undefined;
  let failure: FailureKind | undefined;
  if (typeof code === "string") {
    error = `Could not start ${bin}: ${code}`;
    failure = "other";
  } else if (code !== 0) {
    const detail = clamp(stderr.trim() || out.trim(), 2000);
    const f = classifyText(detail || `exit ${code}`, spec.name);
    // A CLI that is not logged in exits non-zero with a message about auth; classifyText finds it.
    error = `${bin} exited ${code}. ${f.text}`;
    failure = f.kind;
  }

  // Without MCP the CLI never called `done`, so the run would otherwise finish as "Finished"
  // with nothing in it. Its own last words are the best summary we have.
  if (!cli.mcp && !error) {
    const summary = lastParagraph(out) || "Ran with no output.";
    ctx.onDone?.(summary, out.trim() ? "done" : "noop");
  }

  // These runs are paid for by the owner's subscription, not per token, so there is no cost to
  // record. The turn ceiling and the run timeout are what bound them.
  return { costUsd: 0, inputTokens: 0, outputTokens: 0, text, error, failure };
};

// ---------------------------------------------------------------- prompt

function fullPrompt(system: string, prompt: string, hasTeamTools: boolean): string {
  const tail = hasTeamTools
    ? "You are connected to your team through the `team` MCP server. Use it to read channels, message teammates and ask the owner. Finish by calling `done` with a one-line summary."
    : "You are not connected to the team's tools on this run. Do the work, then end your output with a single short paragraph summarising what you did — that paragraph is what your team will see.";
  return `${system}\n\n---\n\n${prompt}\n\n---\n\n${tail}`;
}

/** The last non-empty paragraph of the output, which is where a CLI puts its conclusion. */
function lastParagraph(out: string): string {
  const paras = out.trim().split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return clamp(paras[paras.length - 1] ?? "", 400);
}

// ---------------------------------------------------------------- MCP wiring

interface ApiEndpoint { port: number; token: string }

/** Absolute path to the stdio MCP bridge that ships with the supervisor. */
function bridgePath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "mcp", "stdio.js");
}

/**
 * The command a CLI should run to reach this team, as the given agent. It is the same bridge
 * the Settings screen tells you to register in Claude Code by hand.
 */
function bridgeServer(teamId: string, agentId: string, api: ApiEndpoint) {
  return {
    command: process.execPath,
    args: [bridgePath()],
    env: { CREW_AGENT: agentId, CREW_TEAM: teamId, CREW_PORT: String(api.port), CREW_TOKEN: api.token },
  };
}

function mcpArguments(cli: CliSpec, scratch: string, teamId: string, agentId: string, api: ApiEndpoint | undefined): string[] {
  if (!cli.mcp || !api) return [];
  const server = bridgeServer(teamId, agentId, api);
  if (cli.mcp.format === "codex") {
    // Codex takes dotted config overrides rather than a file.
    return [
      cli.mcp.flag, `mcp_servers.team.command=${server.command}`,
      cli.mcp.flag, `mcp_servers.team.args=[${JSON.stringify(server.args[0])}]`,
      cli.mcp.flag, `mcp_servers.team.env={${Object.entries(server.env).map(([k, v]) => `${JSON.stringify(k)}=${JSON.stringify(v)}`).join(",")}}`,
    ];
  }
  const json = JSON.stringify({ mcpServers: { team: server } });
  if (cli.mcp.format === "json") return [cli.mcp.flag, json];
  const file = path.join(scratch, "mcp.json");
  fs.writeFileSync(file, json, { mode: 0o600 });
  return [cli.mcp.flag, file];
}

// ---------------------------------------------------------------- argument templates

/**
 * Fill `{prompt}`, `{model}` and `{cwd}` in the catalog's argument list. An argument whose
 * placeholder resolves to nothing disappears, and so does the flag in front of it — that is how
 * `--model {model}` vanishes for a CLI that picks its own model.
 */
export function substitute(template: string[], values: { prompt: string; model: string; cwd: string }): string[] {
  const out: string[] = [];
  for (const arg of template) {
    const placeholder = /^\{(prompt|model|cwd)\}$/.exec(arg);
    if (placeholder) {
      const v = values[placeholder[1] as keyof typeof values];
      if (v) out.push(v);
      else if (out.length && /^--?[a-zA-Z]/.test(out[out.length - 1] ?? "")) out.pop(); // drop the orphaned flag
      continue;
    }
    out.push(arg.replace(/\{(prompt|model|cwd)\}/g, (_, k: string) => values[k as keyof typeof values]));
  }
  return out;
}

function fail(error: string, failure: FailureKind) {
  return { costUsd: 0, inputTokens: 0, outputTokens: 0, text: "", error, failure };
}

/** Exported for the settings screen: the exact command line an agent on this provider will run. */
export function previewCommand(spec: ProviderSpec, config: ProviderConfig, model: string): string {
  if (!spec.cli) return "";
  const bin = config.cli?.bin || spec.cli.bin;
  const args = substitute(config.cli?.args ?? spec.cli.args, { prompt: "<the run prompt>", model: spec.cli.fixedModel ? "" : model, cwd: "<workspace>" });
  return [bin, ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(" ");
}
