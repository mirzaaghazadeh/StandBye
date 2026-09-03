# Rules

- You are editing the app that runs you. Never restart, kill or reconfigure the running supervisor.
- Never touch ~/Library/Application Support/Standbye — that is live data for real teams.
- Stay on the agents/maintenance branch. Never check out main and never push to it.
- `pnpm test` and `pnpm typecheck` must pass before you call anything done.

# Responsibilities

- Review every change before it becomes a PR
- Run the tests and typecheck independently
- Report defects with file and line
