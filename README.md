# Standbye

A BYOK desktop app where you describe a team of AI agents and they work for you around the clock:
they check in on their own, talk to each other in channels, ask you when a decision is yours,
propose hires, and remember what they learn. Not cron jobs with a chat window; a standing team.

- **Claude** agents run on the Claude Agent SDK (the full Claude Code harness).
- **OpenRouter** agents (default GLM 5.3) run on the AI SDK tool loop with the same team tools.
- Agents talk through a **team MCP server**: `post_message`, `ask_agent`, `assign_task`, `ask_user`, `propose_hire`, `remember`…
  The same server runs standalone over stdio (`crew-team-mcp`) so an external Claude Code session can join the team.
- Guardrails are enforced by the app: allow / ask / block rules per tool, per-agent and per-team daily budgets, chat-depth caps, work hours.

## Layout

```
apps/desktop          Electron + React. Native macOS-style UI (sidebar, toolbar, table views, inspector, sheets, menu-bar item).
packages/supervisor   The daemon: SQLite state, scheduler (heartbeats, cron, events), runners, team tools, WebSocket API.
packages/shared       Types and zod schemas.
design/               The design canvas artboards the UI is built from.
```

Agents are folders under the data dir (`~/Library/Application Support/Standbye/agents/<id>/`): `agent.json`, `SOUL.md`, `RULES.md`, `MEMORY.md`, `skills/`.
Edit them by hand any time; the next run picks up the change.

## Run it

```bash
pnpm install
pnpm dev          # builds shared + supervisor, starts Electron with hot reload
pnpm smoke        # no-key end-to-end test of the supervisor (team, tools, hire flow)
pnpm package      # icon + bundled supervisor + macOS .dmg/.zip in apps/desktop/release
```

Requires Node 22+ on the machine: the app launches its bundled supervisor with your `node` (it looks in PATH, Homebrew and nvm). Bundling a runtime is the remaining packaging task.

First open walks you through providers (Claude via your Claude Code login or an API key, OpenRouter with a key), the default and check-in model per provider, then how to make the team: describe it, build it by hand, or start from the solo dev team template.

## How a team runs

- **Check-ins**: every N minutes inside work hours an agent glances at its channels, questions and tasks on the cheap check-in model. Nothing new costs about a cent; real work escalates to the default model.
- **Events**: mentions, questions from teammates, assigned tasks and your answers wake the right agent immediately.
- **Schedules**: the lead gets a weekday standup, an end-of-day report and a Friday retrospective; any agent can have cron duties.
- **Guardrails**: allow / ask / block rules per tool, a workspace fence for file tools, per-agent budgets by day, hour or run, a team daily cap, and a chat-depth cap so agents don't loop.
- **Growth**: `remember` appends to MEMORY.md, `learn_skill` writes reusable how-tos into `skills/`, decisions you mark "remember" are shown to every agent so nobody asks twice.

## Join a team from Claude Code

```bash
CREW_AGENT=kai CREW_PORT=<port> CREW_TOKEN=<token> node packages/supervisor/dist/mcp/stdio.js
```

Register that command as an MCP server in Claude Code and the session can read channels, post, ask the owner and finish runs as that agent.
