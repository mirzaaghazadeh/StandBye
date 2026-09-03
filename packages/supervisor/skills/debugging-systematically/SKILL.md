---
name: debugging-systematically
description: Get from a symptom to a fix without guessing — reproduce it, narrow it, prove the cause, then fix it and leave a regression test. Use when something is failing, flaky, or behaving differently than expected.
---

# Debugging systematically

Guessing is expensive. Every guess costs a run, and a wrong guess that happens to make the symptom
go away leaves the bug in place. Work down this list instead.

## 1. Reproduce it

Find the shortest command that fails, every time, and write it down. If you cannot reproduce it,
you cannot fix it — say so and go get what you need: the exact input, the log, the version, the
steps. A bug report with no reproduction is a question, not a task.

If it only fails sometimes, run it in a loop and record the failure rate. "Flaky" is a measurement,
not a diagnosis — order dependence, a real race, a clock, and a shared fixture all look the same
until you count.

## 2. Read the actual error

The whole stack trace, the first failure rather than the last, and the line it names. Most of the
time the answer is in the output you skimmed past.

## 3. Narrow it

Cut the search space in half, repeatedly:

- **In the code:** delete or stub out half the path. Does it still fail?
- **In history:** if it used to work, `git log` the files involved and `git bisect` if the range is
  wide. A commit is a very short explanation.
- **In the data:** shrink the input until removing one more thing makes the failure disappear.

Stop when you have the smallest case that still fails. That case is your test.

## 4. Prove the cause

Before you change anything, be able to finish this sentence: "it fails because X, and I know that
because Y." If Y is "it seemed likely", you are still guessing. Add the log line, print the value,
check the assumption.

Say it out loud in your summary, so a reviewer can disagree with your reasoning rather than only
with your patch.

## 5. Fix the cause, not the symptom

- A retry around a race is not a fix.
- A `try/except` that swallows the error is not a fix.
- Widening a type until the error stops is not a fix.

If the real fix is out of scope and a workaround is genuinely the right call for now, say that
explicitly, and leave a note saying what the real fix is.

## 6. Leave a regression test

Turn the smallest failing case into a test. Confirm it fails on the old code and passes on the new.
A fix with no test invites the same bug back.

## When you are stuck

After three failed hypotheses, stop and write down what you know: the reproduction, what you ruled
out and how, and what you would try next. Then ask a teammate with `ask_agent` or the owner with
`ask_user`. Handing over a narrowed problem is real progress; burning the budget on attempt four is
not.
