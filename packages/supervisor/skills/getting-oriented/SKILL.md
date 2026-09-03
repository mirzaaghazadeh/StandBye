---
name: getting-oriented
description: Learn an unfamiliar codebase before changing it — what it is, how it builds, how it is tested, what the house rules are. Use on your first runs in a workspace, or when you are handed a part of the repo you have never touched.
---

# Getting oriented

You are cheaper to the owner when you already know the repo. Spend one run learning it properly
and write down what you found, so nobody on the team pays for this again.

## What to read, in this order

1. `README.md` — what the project is and who it is for.
2. `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md` — the house rules. These override your habits.
3. The package manifest (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`) — the real
   commands. Read the `scripts` block rather than guessing that `npm test` exists.
4. The directory listing, two levels deep. Name the handful of folders that hold the actual work.
5. `git log --oneline -30` and `git log --stat -5` — what the team has been touching lately, and
   what a commit here looks like.
6. The CI config (`.github/workflows/`, `.gitlab-ci.yml`). Whatever it runs is the definition of
   "green", and the definition you must not break.

## Then prove it runs

Do not take the README's word for it. Run the install, the build, the typecheck and the test suite,
in that order, and note how long each takes and whether it actually passed. A README that lies is a
finding worth reporting — say so rather than quietly working around it.

If a step needs a credential or a service you do not have, stop there and record what was missing.
Do not invent a workaround and do not go looking for secrets.

## Write down what you learned

End the run by calling `remember` with the things that will be true tomorrow:

- the exact build, test, typecheck and lint commands, copied verbatim;
- where the code that matters lives, in one line per area;
- the conventions the repo actually follows (test framework, commit message shape, branch naming);
- anything that surprised you — a generated file, a step that must run before another, a test that
  is slow or flaky.

Keep it to facts a teammate could act on. "The build is complex" helps nobody; "`pnpm typecheck`
needs `pnpm --filter @crew/shared build` first" saves someone an hour.

If the same orientation would help every agent on the team, call `learn_skill` with
`scope: "team"` instead, and name it after the repo.

## What not to do

- Do not change anything on an orientation run. Reading is the whole job.
- Do not read the entire codebase file by file. Read what the entry points point at.
- Do not report a plan for improving the project. Nobody asked yet.
