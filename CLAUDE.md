# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Standbye: a BYOK macOS desktop app where the user describes a team of AI agents and the agents keep working on a repo around the clock. Agents check in on a schedule, talk to each other in channels, ask the owner when a decision is theirs, propose hires, and save memory and skills. Internal npm scope is `@crew/*`; the product name is Standbye.

## Commands

```bash
pnpm install
pnpm dev            # builds shared + supervisor, then electron-vite dev with hot reload
pnpm typecheck      # tsc across all packages (run this before committing; there is no linter)
pnpm smoke          # no-key end-to-end test of the supervisor (scripts/smoke.mjs)
pnpm package        # icon + bundled supervisor + macOS dmg/zip into apps/desktop/release
pnpm --filter @crew/desktop gui   # Playwright drives the real app and screenshots each screen (apps/desktop/e2e/gui.mjs)
```

- Shared types must be rebuilt before the supervisor or desktop typecheck sees changes: `pnpm --filter @crew/shared build`.
- Live tests that spend money: point OpenRouter at `z-ai/glm-5.3-flash` (`providers.set { openrouter: { defaultModel, checkinModel } }`) on a scratch data dir. The OpenRouter key for tests is in `.env` as `openrouter=…` (git-ignored). Set `CREW_DISABLE_CLAUDE_LOGIN=1` on a supervisor to make sure it never uses the machine's Claude Code login.
- Run the supervisor by hand: `node packages/supervisor/dist/index.js --data <dir> --port <n> --token <t>`; talk to it over WebSocket JSON-RPC (`{id, method, params}`), see `scripts/smoke.mjs` for the client shape.
- Headless UI checks: `CREW_DATA_DIR=<dir> CREW_SCREENSHOT=/path.png CREW_SCREENSHOT_QUIT=1 ./node_modules/.bin/electron .` from `apps/desktop` after `electron-vite build`.

Commit messages never mention Claude, sessions or AI assistance (owner's rule).

## Architecture

Three workspaces: `packages/shared` (types + zod schemas, the contract between the other two), `packages/supervisor` (the daemon), `apps/desktop` (Electron + React UI).

**The supervisor is a separate process.** Electron spawns it with the user's `node` (found via PATH, Homebrew, nvm) and talks over a local WebSocket with a per-launch token. The supervisor writes `supervisor.json` (pid, port, token) into the data dir; a starting app attaches to a live one instead of spawning, and only stops a supervisor it started. Packaging copies a flat, symlink-free supervisor tree into the app bundle (`scripts/deploy-supervisor.mjs` + `apps/desktop/scripts/after-pack.cjs`), because electron-builder drops `node_modules` from extraResources.

**Teams are folders.** `Hub` (`supervisor/src/hub.ts`) loads every `teams/<id>/` under the data dir, each with its own `Crew` (SQLite `crew.db`, `agents/<id>/{agent.json,SOUL.md,RULES.md,MEMORY.md,skills/}`, `team.json`) and its own `Scheduler`. Keys and `providers.json` are global. Events from every crew are re-emitted with a `teamId`; the API (`api.ts`) keeps a selected team per connection and the renderer store filters events to the active team.

**Runs are the unit of work.** `Scheduler` turns time and events into runs: heartbeats every N minutes inside work hours (run on the cheap check-in model; the agent calls `escalate` to get a full run), cron triggers, and bus events (mention → run for each mentioned agent, question to an agent, task hand-off, answer to the asker, default answers when a question's deadline passes, hire approval creates the agent). `Queue` serializes runs per agent with a global concurrency cap and collapses duplicate wake-ups. `runner.ts` builds prompts (`prompt.ts`: soul, rules, team, decisions, memory, skills, plus what's new since the last run), checks budgets, dispatches to a provider runner, and records steps and cost.

**Two runners, one tool surface.** `runners/anthropic.ts` uses the Claude Agent SDK (full Claude Code harness; works on the machine's Claude login when no API key is set) with the team tools mounted as an in-process MCP server. `runners/openrouter.ts` uses the AI SDK `ToolLoopAgent` with the same team tools plus a small workspace file/shell toolset. Both route file and shell tools through `runners/approval.ts`: a workspace fence, then allow/ask/block rules from `permissions.ts`; "ask" files an approval question and blocks the tool call until the owner answers or it times out. `tools/team-tools.ts` is the single definition of what agents can do to each other and to the owner; `mcp/stdio.ts` exposes the same tools as a stdio MCP server that proxies to the API so external clients (Claude Code) can act as a teammate.

**Team builder** (`builder.ts`) turns a description into a `TeamDraft` via whichever backend is ready: Anthropic API key (Messages API JSON schema), Claude Code login (Agent SDK `outputFormat`), or OpenRouter (AI SDK `Output.object`). `templates.ts` holds the solo dev team; drafts are adapted to the providers that are ready and their configured default models.

**Renderer** (`apps/desktop/src/renderer`): one external store (`state/store.ts`, `useSyncExternalStore`) holds everything and receives pushes from the supervisor via preload IPC. Store selectors must return stable references while data loads (use module-level empty constants), or the screen re-renders forever. UI is a native macOS-style kit (`ui/kit.tsx`, `styles.css`): sidebar, toolbar, table rows, inspector, sheets centered in the window. Overlays (model picker, team switcher) render through a portal with fixed positioning so nothing clips or causes horizontal scroll. Screens live in `screens/`; the design they follow is in `design/*.dc.html`.

## Conventions worth knowing

- Every limit is enforced by the app, not the model: permission rules, per-agent budgets (day / rolling hour / per run), team daily cap, chat-depth cap on agent-to-agent mention threads, work hours.
- Reports (`ask_user` with `kind: "report"`) land in the inbox without blocking the agent; questions and approvals do.
- `remember` appends to MEMORY.md, `learn_skill` writes `skills/<name>.md`; both are loaded into every subsequent run. Decisions the owner marks "remember" are shown to all agents so nobody re-asks.
- The template lead ships with three schedules (weekday standup, end-of-day report, Friday retrospective); the builder is told to add the same.
