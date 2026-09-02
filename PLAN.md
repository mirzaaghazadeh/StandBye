# Standbye — 24/7 agent teams on your desktop

BYOK desktop app where you describe a team, the app creates it, and the agents keep
working, talking, asking and learning without manual triggers.

## Architecture

```
apps/desktop            Electron (main + preload) + React renderer (Vite)
packages/supervisor     Long-running Node daemon: SQLite, scheduler, runners, team MCP server, WS API
packages/shared         Types + zod schemas shared by daemon and UI
```

- The **supervisor** is its own process. Electron spawns it and talks to it over a local
  WebSocket JSON-RPC with a per-launch token. Later it can run on a VPS unchanged.
- **Agents are folders**: `agents/<id>/{agent.json, SOUL.md, RULES.md, MEMORY.md, skills/}`.
- **State in SQLite** (`better-sqlite3`): agents, channels, messages, questions, runs, run_steps, events, spend.
- **Three trigger kinds** feed one queue: schedule (cron), event (message mention, question answered, PR/CI later), heartbeat (check-in every N min inside work hours, on a cheap model).
- **Runners** (one per provider, same tool surface):
  - `anthropic` → Claude Agent SDK `query()` with `cwd` = workspace, team tools mounted as an in-process MCP server.
  - `openrouter` (e.g. `z-ai/glm-5.3`) → Vercel AI SDK tool loop with file/bash tools + the same team tools via MCP client.
- **Team MCP server** (`@modelcontextprotocol/sdk`): `post_message`, `read_channel`, `list_agents`, `ask_user`,
  `ask_agent`, `assign_task`, `propose_hire`, `remember`, `report`. Also runnable standalone over stdio so an
  external Claude Code session can join the team.
- **Guardrails enforced by the app, not the model**: permission rules (allow / ask / block) per tool pattern,
  per-agent daily budget, team daily cap, chat depth cap, work hours.
- **Team builder**: description → structured team draft (Claude, structured outputs) → user approves → folders created.

## Milestones

1. ✅ Monorepo, shared types, SQLite schema, supervisor boots and serves the WS API.
2. ✅ Claude runner + team tools over MCP + heartbeat scheduler. Verified live: mention → read workspace → post → ask teammate.
3. ✅ OpenRouter runner (GLM 5.3) with the same tools. Verified live: a GLM agent reviewed code and posted a verdict.
4. ✅ UI from the design: Home, Channel, Inbox, Runs, Agent sheet (incl. Skills), Team builder, manual builder, wizard, menu-bar item, notifications.
5. ✅ Team builder on Anthropic key / Claude login / OpenRouter. Budgets (day/hour/run), permissions, approvals, hire flow, reports.
6. ✅ Keys in keychain, crash recovery, pause all, schedules (standup, report, retro), learn_skill, packaging (.dmg with bundled supervisor).

## Next

- Bundle a Node runtime (or run the supervisor under Electron's utilityProcess with a rebuilt better-sqlite3) so Node isn't required.
- More providers: any OpenAI-compatible base URL (Ollama, LM Studio).
- Inbound events: GitHub webhooks / CI status, file watcher on the workspace.
- Code signing and notarization for distribution.

## Defaults

- Claude model `claude-opus-5`, check-ins on `claude-haiku-4-5`. OpenRouter default `z-ai/glm-5.3`.
- Data dir: `~/Library/Application Support/Standbye` (macOS).
- Work hours 08:00–22:00, heartbeat 30 min, team cap $10/day, agent cap $3/day.
