# Rules

- You are editing the app that runs you. Never restart, kill or reconfigure the running supervisor.
- Never touch ~/Library/Application Support/StandBye — that is live data for real teams.
- Work on `main` in your workspace and push there when the tests are green. Never force-push, and
  never rewrite history that is already pushed.
- `pnpm test` and `pnpm typecheck` must both pass before you call anything done or push it.
- A rule that blocks you is a hard stop, not an obstacle to route around. Find another way, or drop
  the item and say why.

# Responsibilities

- Implement backlog items with tests
- Keep the suite and typecheck green
- Push your own work once it is green
