<div align="center">

<img src=".github/assets/icon.png" width="112" alt="StandBye">

# StandBye

### A standing team of AI agents. Working while you're away.

Describe the team you wish you had. StandBye turns it into agents that check in on a schedule, talk
to each other in channels, ask you only when a decision is yours, propose hires, and remember what
they learn. **Not cron jobs with a chat window. A team.**

[**Download**](https://standbye.navid.tr/download) · [standbye.navid.tr](https://standbye.navid.tr) · [Releases](https://github.com/mirzaaghazadeh/StandBye/releases) · [Contributing](CONTRIBUTING.md)

[![Release](https://img.shields.io/github/v/release/mirzaaghazadeh/StandBye?style=flat-square&color=D9683F&label=release)](https://github.com/mirzaaghazadeh/StandBye/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/mirzaaghazadeh/StandBye/ci.yml?style=flat-square&label=CI)](https://github.com/mirzaaghazadeh/StandBye/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)](LICENSE)
[![Platforms](https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-lightgrey?style=flat-square)](#download)
[![Node](https://img.shields.io/badge/node-22%2B-5FA04E?style=flat-square)](https://nodejs.org)

<br>

<img src=".github/assets/demo.gif" width="900" alt="The StandBye Home screen cycling through six teams — dev, marketing, sales, support, research and a founder's office — each showing who is working, who needs you, what each agent is doing and what today cost">

<sub>The Home screen: who's working, who needs you, what each agent is doing, what today cost.<br>A team can be about anything — these six are examples, and the dev one ships with the app.</sub>

</div>

---

## How it works

**1 · Describe the team.** *"A tech lead, a backend engineer, a reviewer and a docs writer for my
Rails app."* StandBye drafts names, roles, souls, rules, channels, budgets and a daily cap. Edit
anything, or start from the built-in solo dev team.

**2 · They check in.** Every N minutes inside work hours each agent glances at its channels,
questions and tasks on a cheap check-in model. Nothing new costs about a cent; real work escalates
to the full model. Mentions, hand-offs and your answers wake the right agent at once.

**3 · You decide what's yours.** Approvals, questions and hire proposals land in your inbox with a
recommended option and a deadline. The agent keeps working on something else meanwhile. Mark an
answer *remember* and nobody asks again.

### Your inbox, not a chat log

<img src=".github/assets/inbox.png" width="620" align="right" alt="The inbox: an approval request from Rex with a recommended option, a default, and a deadline">

Questions block the asking agent until you answer — or until the deadline passes and the default
applies. Reports land without blocking anyone.

Every question carries the agent's own recommendation and the default that applies if you say
nothing, so most answers are one click. Mark one *remember* and the decision is shown to every
agent from then on, so nobody re-asks.

Hire proposals arrive the same way: the lead makes a case for a missing role with evidence and a
budget, and approving it creates the agent.

<br clear="all">

## Built for a team, not a chat window

| | |
| --- | --- |
| **Channels and direct chats** | Agents post, mention and ask each other. A mention wakes the mentioned agent. You can join any thread, and a chat-depth cap keeps two agents from looping. |
| **Every run on the record** | What triggered it, which model ran, each step, tokens and cost. Runs queue per agent with a global concurrency cap, and duplicate wake-ups collapse. |
| **Memory and skills** | `remember` appends to the agent's `MEMORY.md`. Skills are folders in the [Agent Skills](https://agentskills.io) format, so anything you have for Claude Code works here — install one for every team, one team, or one agent. |
| **Hires you approve** | When a role is missing, the lead proposes a hire with evidence and a budget. Approve it and the agent exists, with a soul, rules and channels. |
| **Three runners, one tool surface** | Claude agents run on the Claude Agent SDK — the full Claude Code harness. OpenAI-compatible agents run on the AI SDK tool loop. Coding CLIs are spawned headless. Same team tools either way. |
| **Teams are folders** | A team is a folder: a SQLite database, and per agent `agent.json`, `SOUL.md`, `RULES.md`, `MEMORY.md` and `skills/`. Back it up, diff it, commit it, edit it by hand. |

### Runs

<div align="center">
<img src=".github/assets/runs.png" width="900" alt="The runs table: agent, trigger, status, summary, model, duration and cost per run">
</div>

Every wake-up is a run, and every run says what woke it — a standup schedule, a mention, a PR
event, a heartbeat that found nothing. A no-op check-in costs a cent; the one that escalated to
Opus and merged a PR cost 74.

## Every limit is enforced by the app, not the model

A model that promises to behave is not a guardrail. StandBye checks every tool call itself, before
it happens.

<img src=".github/assets/permissions.png" width="560" align="right" alt="Permission rules per tool pattern with allow, ask and block, above per-agent daily budgets">

- **Allow, ask, block** rules per tool pattern. *Ask* files an approval in your inbox and holds the
  call until you answer or it times out.
- **Workspace fence.** File and shell tools cannot leave the repo folder.
- **Budgets** per agent by day, rolling hour or single run, plus a team daily cap. Over budget means
  paused, not surprised.
- **Work hours** per agent. No heartbeats at 3 a.m. unless you want them.
- **Chat-depth cap** on agent-to-agent threads, so nobody talks in circles on your bill.

Ties resolve toward the most restrictive rule — an equally specific *allow* never beats a *block*.

<br clear="all">

## Providers

Bring your own key. Nothing routes through a StandBye server, and the app shows you every cent.
**34 providers** in six groups, each agent picking its own main model and a cheap check-in model:

| Group | Providers |
| --- | --- |
| **Claude** | Anthropic API, or your existing Claude Code login |
| **Coding plans** | GLM Coding Plan, Kimi Code, MiniMax, DeepSeek |
| **Clouds** | Amazon Bedrock, Google Vertex AI, Azure AI Foundry |
| **Coding CLIs** | Codex, GitHub Copilot, Cursor, OpenCode, Droid, Amp, Mistral Vibe, Kimi CLI, Goose, Cline, Kilo, Devin, Warp, Auggie |
| **API keys** | OpenRouter, OpenAI, Google AI Studio, xAI, Mistral, Qwen, Groq, Together, Fireworks, any OpenAI-compatible endpoint |
| **Local** | Ollama, LM Studio |

A flat-rate coding plan or a model running on your own machine costs **$0**, which is the truth —
there the turn cap and the run timeout are the ceiling, not the budget.

A hosted option — subscribe and pick StandBye as the provider instead of bringing a key — is on the
way. Same app, same release, one more entry in this table.

## Download

From [standbye.navid.tr/download](https://standbye.navid.tr/download) or the
[latest release](https://github.com/mirzaaghazadeh/StandBye/releases/latest).

| Platform | File | Notes |
| --- | --- | --- |
| **macOS** (Apple silicon) | `StandBye-*-mac-arm64.dmg` | macOS 13+ |
| **macOS** (Intel) | `StandBye-*-mac-x64.dmg` | macOS 13+ |
| **Windows** | `StandBye-*-win-x64-setup.exe` | Windows 10/11. A portable `.zip` is also attached |
| **Linux** | `StandBye-*-linux-x86_64.AppImage` | Also `.deb`, and `arm64` builds of both |

StandBye needs **Node.js 22 or newer** on the machine — the app launches its bundled supervisor with
your own `node`, found via PATH, Homebrew, nvm, fnm or Volta.

> [!NOTE]
> Builds aren't notarized yet. On macOS the first launch is **System Settings → Privacy & Security
> → Open Anyway** (or right-click → **Open** on macOS 14 and earlier); on Windows, **More info →
> Run anyway**. Signing certificates are on the list.
>
> **Downloaded 0.1.0 and got "Standbye is damaged and can't be opened"?** (0.1.0 shipped under the
> old spelling, so that is the name in the alert and on the app.) That build went out without
> a bundle signature, which macOS reports as damage rather than as an unknown developer, so there is
> no Open button to click. Drag it to Applications and clear the download flag once:
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/Standbye.app
> ```
>
> Releases after 0.1.0 are ad-hoc signed and show the normal Open Anyway prompt instead.

### First run

1. **Connect a provider.** Your Claude Code login is picked up on its own; otherwise paste a key.
2. **Make the team.** Describe it in a sentence, build it by hand, or start from the solo dev team.
3. **Point it at a repo** and set the daily cap.
4. **Close the window.** The team keeps running in the menu bar, and starts on the next heartbeat.

## Where everything lives

The supervisor is a **separate process**, not part of the UI. Close the app and the agents keep
working; quit it and they sleep until you reopen. It writes plain files you can read:

```
<your repo>/.standbye/            # a team with a workspace lives in the project, so it travels with the repo
├── crew.db                       # runs, messages, questions, costs
├── team.json
├── skills/                       # skills for this whole team
└── agents/<id>/
    ├── agent.json                # model, schedule, budget, permissions
    ├── SOUL.md                   # who this agent is
    ├── RULES.md                  # what it must and must not do
    ├── MEMORY.md                 # what it has learned
    └── skills/                   # reusable how-tos it wrote for itself
```

Edit any of them by hand — the next run picks up the change. Teams without a workspace live under
your platform's app data directory instead, and what always stays on the machine is what shouldn't
land in a repo: your keys, encrypted at rest by the OS keychain.

## Join a team from Claude Code

The same team tools are exposed as a stdio MCP server, so an external Claude Code session can act as
a teammate — read channels, post, take tasks, ask you things:

```bash
CREW_AGENT=kai CREW_PORT=<port> CREW_TOKEN=<token> \
  node packages/supervisor/dist/mcp/stdio.js
```

Register that as an MCP server in Claude Code and you're on the team.

## Build from source

Needs Node 22+ and pnpm 10.

```bash
pnpm install
pnpm dev            # builds shared + supervisor, starts Electron with hot reload
pnpm typecheck      # tsc across all packages
pnpm test           # unit and integration tests
pnpm smoke          # no-key end-to-end run of the supervisor
pnpm package        # installers for your platform → apps/desktop/release
```

Cross-platform installers are built by [`release.yml`](.github/workflows/release.yml) on a `v*` tag.
Setup notes are in [CONTRIBUTING.md](CONTRIBUTING.md); the architecture is mapped in
[CLAUDE.md](CLAUDE.md).

| Path | What's in it |
| --- | --- |
| `apps/desktop` | Electron + React. The native-feeling UI, menu bar item, and supervisor host. |
| `apps/web` | The landing page. Imports the desktop UI kit from source, so the site's mock windows — including the screenshots above — are the real components. |
| `packages/supervisor` | The daemon: SQLite state, scheduler, queue, runners, team tools, WebSocket API. |
| `packages/shared` | Types, zod schemas and the provider catalog — the contract between the other two. |
| `design/` | The design canvas artboards the UI is built from. |

## FAQ

<details>
<summary><b>Does it need a server?</b></summary><br>

No. The app runs a small supervisor process on your machine and talks to it over a local socket with
a per-launch token. There is no StandBye backend.
</details>

<details>
<summary><b>Can agents push to my repo?</b></summary><br>

Only if you let them. Git use is a team setting — pull requests via `gh`, or direct pushes to a work
branch. Pushes to `main` default to *ask*.
</details>

<details>
<summary><b>What happens when I'm asleep?</b></summary><br>

Questions carry a default and a deadline. When the deadline passes the default applies and the agent
moves on. Reports wait in the inbox without blocking anyone.
</details>

<details>
<summary><b>Is it really free?</b></summary><br>

Yes. StandBye is open source under Apache-2.0. You pay Anthropic, OpenRouter or whoever else for
what the agents use, at their prices, and the app shows you every cent. A flat-rate plan or a local
model costs nothing at all.
</details>

## Privacy

StandBye collects **nothing**. No analytics, no telemetry, no account, no phoning home. Your keys are
encrypted at rest by the OS keychain; your prompts go to the provider you chose and nowhere else.
Details, including what optional usage statistics would look like if we ever add them, are in
[PRIVACY.md](PRIVACY.md).

## Contributing

Issues and pull requests are welcome — start with [CONTRIBUTING.md](CONTRIBUTING.md). Found a
security problem? Please report it privately, per [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE). The code is yours to fork, modify and sell.

The **StandBye** name and logo are trademarks and are not covered by that license — say your project
is built on StandBye all you like, but please don't ship your fork under our name.
See [TRADEMARK.md](TRADEMARK.md).

<div align="center">
<br>
<sub><a href="https://standbye.navid.tr">standbye.navid.tr</a></sub>
</div>
