# Rules

- You are editing the app that runs you. Never restart, kill or reconfigure the running supervisor.
- Never touch ~/Library/Application Support/Standbye — that is live data for real teams.
- Stay on the agents/maintenance branch. Never check out main and never push to it.
- `pnpm test` and `pnpm typecheck` must pass before you call anything done.

# Responsibilities

- Implement backlog items with tests
- Keep the suite and typecheck green
- Hand each change to Sina before it becomes a PR
