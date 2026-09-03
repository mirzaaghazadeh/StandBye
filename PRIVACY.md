# Privacy

Standbye is a desktop app that runs on your machine, on your keys. This page describes exactly what
leaves it.

## What Standbye collects today

**Nothing.** There is no analytics, no telemetry, no crash reporting and no account. The app has
never phoned home, and this file will be updated in the same commit as the code if that changes.

## Where your data lives

Everything is a file or a row on your own disk, under your platform's app data directory:

| | |
| --- | --- |
| macOS | `~/Library/Application Support/Standbye/` |
| Windows | `%APPDATA%\Standbye\` |
| Linux | `~/.config/Standbye/` |

That directory holds `crew.db` (SQLite: runs, messages, questions, costs), each agent's folder
(`agent.json`, `SOUL.md`, `RULES.md`, `MEMORY.md`, `skills/`) and your team settings. Delete the
directory and nothing of Standbye's remains. Your **API keys** are stored separately, encrypted at
rest by the OS keychain through Electron's `safeStorage` (Keychain on macOS, DPAPI on Windows,
libsecret on Linux).

## What goes out over the network

Only these, all of them the direct result of you running agents:

- **Your model provider.** Prompts, agent files and tool results go to Anthropic or OpenRouter,
  under your own API key or your Claude Code login, exactly as if you had called them yourself.
  Their privacy policy governs what happens there — Standbye is not in the middle.
- **The OpenRouter model catalog** (`openrouter.ai/api/v1/models`), an unauthenticated GET so the
  model picker can list what's available and what it costs.
- **Whatever your agents do.** If an agent runs `git push` or calls a tool that reaches the
  network, that traffic is the agent's, subject to the permission rules you set.

Nothing routes through a Standbye server, because there isn't one.

## Planned: optional usage statistics

We would like to know roughly how many people use Standbye and how long teams stay running, so we
can prioritise sensibly. When that ships it will be **opt-in** — off until you turn it on, asked
once, plainly, with a switch in Settings — and it will send only:

- app version, OS and architecture, and a random install ID you can reset
- counts and coarse durations: runs started, check-ins, days active, escalation rate
- provider *type* (Claude or OpenRouter) and model ID
- error class names, never error messages

It will never send: repository names or paths, file names or contents, prompts or model responses,
agent or team names, memory, skills, questions, answers, hostnames, IP addresses or API keys.

## The hosted provider

Standbye is adding an optional hosted provider — instead of bringing your own key, you subscribe and
select Standbye as the provider. That is a paid service on our infrastructure, so it necessarily
involves an account, billing details handled by our payment processor, and the model traffic for
those requests passing through our endpoint in order to be metered. It will be a distinct, clearly
labelled choice, and picking any other provider keeps everything above true. A separate service
privacy policy will cover it before it launches.

## Contact

Questions, or a correction to this page: **hello@navid.tr**, or open an issue.
