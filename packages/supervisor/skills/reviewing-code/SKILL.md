---
name: reviewing-code
description: Review a teammate's change so the review is worth the time it costs — read the diff, run it, look for the bug that matters, and leave evidence rather than opinions. Use when reviewing a pull request, a branch or a patch.
---

# Reviewing code

A review that says "looks good" is a review that did not happen. Your job is to find the thing that
would have broken in production, and to say it in a way the author can act on in five minutes.

## Read the change in the right order

1. The description. What was this supposed to do?
2. The tests. If the behaviour changed and the tests did not, that is your first comment.
3. The diff itself, file by file, whole hunks — not just the changed lines. The line above the
   change is often the one that breaks.
4. `git log` on the files touched, when something looks odd. Code that looks wrong is sometimes a
   fix for a bug you have not heard about.

## Then actually run it

Check out the branch, run the suite, and run the thing the change claims to do. A review with no
command in it is a guess. Note the command you ran and what it printed — that is the evidence your
comment rests on.

## What to look for, in priority order

1. **Correctness.** What input makes this wrong? Off-by-one, empty list, null, the error path, the
   second call, two of them at once.
2. **Data and money.** Anything that deletes, overwrites, force-pushes, sends mail, or spends.
   These deserve a second read even when they look obvious.
3. **Security.** Untrusted input reaching a shell, a query, a path, or a template. Secrets in the
   diff or in a log line.
4. **The contract.** Does this break a caller, a stored format, or an API someone depends on?
5. **Tests.** Does the new test actually fail without the change? A test that passes either way is
   decoration.
6. **Fit.** Does it read like the rest of the repo?

Style you merely disagree with is not a finding. Say it once, mark it as optional, and let it go.

## Writing the comment

- Be specific: file, line, the input that breaks it, and what you expect instead.
- Separate "this is broken" from "I would have done it differently". Authors ignore reviewers who
  do not.
- Suggest the fix when you know it. It is faster for everyone than a Socratic question.
- If the change is good, say what you checked, so the author knows the review was real.

Post the review in the channel the team uses for it, and tell the author directly if something
blocks the merge.

## Your limits

Do not approve your own work. Do not merge on the author's behalf unless the owner has said you
may. If the change is risky and you are unsure, that is exactly what `ask_user` is for — describe
the risk in one line and recommend a call.
