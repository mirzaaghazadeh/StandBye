# Contributing to Standbye

Thanks for looking. Standbye is a small codebase with strong opinions, and this page is the short
version of them.

## Getting set up

You need **Node 22+** and **pnpm 10**.

```bash
git clone https://github.com/mirzaaghazadeh/StandBye.git
cd StandBye
pnpm install
pnpm dev            # builds shared + supervisor, starts Electron with hot reload
```

Useful commands:

```bash
pnpm typecheck      # tsc across every package — run this before you push, there is no linter
pnpm test           # unit and integration tests against dist/
pnpm smoke          # no-key end-to-end run of the supervisor
pnpm package        # installers for your current platform, into apps/desktop/release
```

`packages/shared` has to be rebuilt before the other packages typecheck against a change to it:

```bash
pnpm --filter @crew/shared build
```

## How the pieces fit

Three workspaces plus the site. `packages/shared` holds the types and zod schemas that are the
contract between the other two; `packages/supervisor` is the daemon that actually runs agents;
`apps/desktop` is the Electron UI; `apps/web` is the landing page, which imports the desktop UI kit
straight from source so the marketing screenshots are the real components.

The supervisor is a **separate process**, not a module of the app. Electron spawns it with your
`node` and talks to it over a local WebSocket with a per-launch token. If you're changing behaviour,
you're usually changing the supervisor, and you can drive it without the UI at all:

```bash
node packages/supervisor/dist/index.js --data /tmp/crew --port 47300 --token dev
```

`scripts/smoke.mjs` shows the client shape.

There's more architecture detail in [CLAUDE.md](CLAUDE.md) — it's written for AI coding agents, but
it's an accurate map for humans too.

## House rules

- **Every limit is enforced by the app, not the model.** Permission rules, budgets, work hours,
  chat-depth caps. If a guardrail depends on the model choosing to respect it, it isn't a guardrail.
- **`decide()` resolves ties toward the most restrictive rule.** This is deliberate. An equally
  specific `allow` must not beat a `block`.
- **Store selectors must return stable references while data loads.** Use the module-level empty
  constants in `state/store.ts`, or the screen re-renders forever.
- **No horizontal scroll, no clipped popovers.** Overlays render through a portal with fixed
  positioning.
- **Commit messages describe the change**, in the imperative, and never mention the tool that wrote
  them.

## Tests

`pnpm test` runs against built output, so build first (the script does it for you). Tests that spend
real money are opt-in and point at a cheap model — copy `.env.example` to `.env`, put an OpenRouter
key in it, and point the provider at `z-ai/glm-5.3-flash` on a scratch data directory. Never commit
`.env`.

If you're touching the scheduler, the queue, permissions or budgets, add a test. Those four are
where a subtle regression costs somebody real money.

## Pull requests

1. Branch off `main`.
2. Make sure `pnpm typecheck` and `pnpm test` pass.
3. Describe what changed and why. Screenshots for anything visual.
4. Keep it focused — one concern per PR reviews far faster.

By contributing you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE), and you certify the
[Developer Certificate of Origin](https://developercertificate.org/): that you wrote the patch, or
have the right to submit it.

## Reporting things

- **Bugs and features** — [open an issue](https://github.com/mirzaaghazadeh/StandBye/issues/new/choose).
- **Security problems** — do not open an issue; see [SECURITY.md](SECURITY.md).
