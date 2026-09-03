---
name: working-with-git
description: Use git without losing work or rewriting somebody else's history — branches, clean commits, conflicts, and the recovery moves when something has gone wrong. Use before branching, rebasing, resolving a conflict, or any command that discards changes.
---

# Working with git

Git is the only thing standing between a bad run and lost work. Treat every command that discards
state as one you have to justify.

## Know where you are before you act

`git status` and `git log --oneline -5` cost nothing and prevent most of the accidents. Check
before you branch, before you pull, before you reset, and after anything surprising.

Never start work with a dirty tree you did not create. If there are changes you do not recognise,
they are the owner's or a teammate's — stop and ask rather than stashing or reverting them.

## Branching

- One branch per task, cut fresh from the current default branch, named after the task in whatever
  style the repo already uses.
- Fetch before you branch, so you start from what is actually there rather than yesterday's copy.
- Do not reuse a branch from a previous task. Old commits riding along in a new pull request is a
  reliable way to have it rejected.

## Commits

- Small, and each one complete: the code and its test together, so that any single commit could be
  checked out and still pass.
- `git add -p` rather than `git add .` when you have touched more than you meant to. Check what you
  are staging — a stray lockfile, a build artifact, an editor config or a `.env` in a commit is
  noise at best and a leak at worst.
- Write the message in the repo's existing style, and follow the repo's rules about what a message
  may contain.

## Conflicts

A conflict is two people's intent meeting, not a mechanical problem.

1. Read both sides, and find out what the other side was trying to do — `git log` the conflicting
   region if it is not obvious.
2. Keep both intents if both are still valid. Taking "ours" wholesale silently reverts a teammate's
   work; that is the most common way a conflict resolution goes wrong.
3. Build and run the tests after resolving. A file that merges cleanly can still be nonsense.
4. If you cannot tell what the other change was for, ask the person who made it with `ask_agent`.

## History that is not yours

Once a commit is on a shared branch, other people's work sits on top of it.

- Do not `push --force` a shared branch. Force-pushing your own unmerged feature branch is usually
  fine; force-pushing anything anyone else has pulled is not.
- Do not rebase or amend commits that are already pushed and shared. Add a new commit instead.
- To undo something on a shared branch, `git revert`. It is a normal commit and it keeps the
  history honest about what happened.

## Recovering

Almost nothing is really gone.

- `git reflog` finds the commit you were on before the reset or the bad rebase.
- `git stash list` holds what you stashed and forgot.
- A commit that exists anywhere can be recovered by its hash; an uncommitted change cannot. That is
  the argument for committing early on your own branch, even when it is not finished.

If you have genuinely lost work, say so immediately and precisely. It is recoverable far more often
when someone hears about it in the first ten minutes.
