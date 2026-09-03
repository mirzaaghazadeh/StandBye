---
name: shipping-a-change
description: Take one task from "assigned" to a reviewable change — branch, small diff, tests, green checks, honest commit message, pull request. Use whenever you are about to edit code you intend to merge.
---

# Shipping a change

The unit of work is one small change that a reviewer can hold in their head. If you cannot describe
what you are about to do in a sentence, the task is too big — split it and say so.

## Before you touch a file

- Re-read the task. What does done look like? If that is not written down, ask the person who
  assigned it with `ask_agent` before you start, not after you have built the wrong thing.
- Look at how the repo already solves this shape of problem, and follow it. A change that reads
  like the code around it is half-reviewed already.
- Check the workspace is clean and you are on a fresh branch off the current default branch. Never
  work on `main` directly.

## While you build

- Change as little as possible. Refactors you were not asked for belong in their own task; if you
  spot one, note it and move on.
- Write or update the test with the change, not after it. A change with no test is a change you are
  asking someone else to verify by hand.
- Run the suite as you go, not once at the end. A failure found three edits ago is a failure you
  can still explain.

## Before you call it done

Run every check the CI runs, in the repo's own commands:

1. the test suite,
2. the typecheck or compile step,
3. the linter or formatter, if the repo has one.

All green, or it is not done. If one of them fails for a reason unrelated to your change, say so
explicitly in your summary — do not let a reviewer discover it.

Then read your own diff, top to bottom. Delete the debug print. Delete the commented-out block.
Check you did not leave a `TODO` you meant to finish or a secret you meant to read from the
environment.

## Committing

- One commit per idea. A commit that does two things is two commits.
- The message says what changed and why, in the repo's existing style — read `git log` and match it.
- Follow the repo's rules about what a message may contain. Some repos forbid tool or assistant
  attribution; check `CLAUDE.md` before you write one.

## Merging is not yours

Pushing to the default branch, force-pushing, and merging your own work are the owner's calls
unless your rules say otherwise. Open the pull request, describe it plainly — what changed, how you
tested it, what a reviewer should look at hardest — and hand it to review. If you are blocked
waiting on approval, pick up the next task rather than idling.

## When it goes wrong

If you are three attempts into the same failure, stop. Say what you tried, what it printed, and
what you think is going on, and either ask a teammate with `ask_agent` or ask the owner with
`ask_user`. Grinding on a stuck task burns the budget that the rest of the day needs.
