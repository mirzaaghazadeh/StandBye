---
name: refactoring-safely
description: Change the shape of code without changing what it does — get a test harness under it first, move in reversible steps, and keep the refactor out of the change that alters behaviour. Use before restructuring, renaming across files, or untangling something to make a feature possible.
---

# Refactoring safely

A refactor is a change that keeps behaviour identical. The moment it also changes behaviour it is
no longer a refactor, and the safety argument for doing it in bulk disappears.

## First, get a harness under it

You need something that tells you when you broke it. Before touching the structure:

- run the existing tests and note exactly what passes;
- if the area is untested, write characterisation tests first — tests that capture what the code
  does today, right or wrong. These are your safety net, not a statement that the behaviour is
  correct;
- if you cannot get a test around it at all, say so before starting. A blind refactor of untested
  code is a gamble with someone else's repo, and it needs the owner's agreement.

## Then move in small, reversible steps

Each step should leave the tests green. Rename, then run. Extract, then run. Move, then run.

- Prefer the mechanical transformation: rename a symbol everywhere, extract a function without
  editing its body, move a file and fix the imports. These are the steps where you are least likely
  to be wrong.
- Do not delete and rewrite. Transform.
- Keep the old thing working until the new one is used everywhere, then remove the old one in its
  own step.

If the tests go red, you know which step did it, because it was the last one.

## Keep it separate from the feature

Refactor, commit, then change behaviour in a second commit. A diff that both moves three hundred
lines and quietly fixes a condition is not reviewable — the reviewer either reads every moved line
or misses the change hidden among them.

If you are refactoring in order to make a feature possible, say that in the commit message so the
next reader knows why the shape changed.

## Know when to stop

- Refactoring code nobody was asked to touch spends the team's budget on your preferences. Restrict
  it to what the task needs.
- If the refactor grows past what fits in one run, stop at the last green step, commit it, and say
  what remains. A half-finished restructure left uncommitted is the worst state to hand over.
- If you discover the design should be different in a way you did not expect, that is a decision,
  not a refactor. Say so and get agreement before continuing.

## Afterwards

Run the full suite, not the subset you were watching. Check the things tests do not catch: public
API names, exported symbols, log lines someone greps for, file paths something else imports. Then
read the whole diff once, looking for the line you changed by accident.
