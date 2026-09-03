---
name: fixing-a-red-build
description: Handle a broken default branch or failing CI — establish what broke and when, get the branch green the fastest safe way, then fix it properly. Use the moment you notice main is red or the suite fails for reasons that are not yours.
---

# Fixing a red build

A red default branch blocks everyone on the team. It outranks whatever you were doing.

## First, be sure

Run the failing check yourself before you announce anything. A CI failure caused by a dead network,
an expired token, or a full disk is a different problem with a different owner, and calling it a
code break wastes the team's morning.

Say plainly what you observed: the command, the failure, and whether it reproduces locally.

## Then find the boundary

Find the last commit where the check passed and the first where it failed. `git log` on the touched
files, or `git bisect` when the range is wide. Name the commit and the person who made it — not to
assign blame, but because they can usually explain it in one line.

Tell the team in the channel they watch, with the failing test name and the suspect commit. One
message, with evidence. Do not speculate about the cause in public before you have the boundary.

## Get green before you get clever

Two paths, and the choice is about time:

- **Revert** when the break is not obvious within a few minutes, when the author is not around, or
  when the change is large. Reverting is not an insult; it is the cheap, reversible option that
  unblocks everyone. Then fix it properly on a branch.
- **Fix forward** when the cause is plain and the fix is small — a missed rename, a wrong import,
  a fixture that needs updating.

Either way, the change that makes main green is small, targeted, and reviewed like any other. Do
not bundle unrelated cleanup into a hotfix.

## Reverting is still a change the owner may need to approve

Your rules probably forbid pushing to the default branch without approval, and an emergency does
not repeal them. If you need to push a revert and cannot, use `ask_user` with a one-line title, the
evidence, a recommendation, and a `default_answer` so it resolves even if the owner is asleep.

## Afterwards

- Add the test or check that would have caught it. A break that CI could not see is a gap in CI.
- Call `remember` if the cause was a trap the team will hit again — a step that must run first, a
  dependency that is not pinned, a test that depends on the clock.
- If the break came from a habit rather than a mistake, raise it at the retrospective rather than
  in the moment.

## What not to do

- Do not disable, skip, or delete the failing test to get green. That is not green.
- Do not rewrite shared history to hide the bad commit.
- Do not sit on a red branch quietly because you assume someone else noticed.
