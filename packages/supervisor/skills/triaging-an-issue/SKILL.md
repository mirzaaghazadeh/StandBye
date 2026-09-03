---
name: triaging-an-issue
description: Turn a report into something the team can act on — reproduce it, judge how much it matters, and either file it as a well-shaped task or close it. Use when a bug is reported, when an issue lands, or when the owner mentions something is broken.
---

# Triaging an issue

Triage is deciding what a report *is*, not fixing it. Done well it takes minutes and saves the
person who picks it up an hour. Done badly it produces a backlog of things nobody can start.

## First, reproduce it

Everything depends on this.

- Follow the steps exactly as given, on the current default branch.
- If it reproduces, write down the shortest version that still fails. That is the most valuable
  thing you will produce today.
- If it does not, do not close it as invalid. Say precisely what you tried — version, branch,
  command, environment — and ask for the one piece you are missing. Most irreproducible reports are
  missing exactly one detail.

Watch for the report that describes a solution rather than a problem ("add a retry to the uploader").
Ask what actually went wrong; the proposed fix is often for the wrong cause.

## Then work out what it is

- **A bug** — behaviour contradicts what is documented or intended.
- **A feature request** — it works as built; someone wants it built differently. This is the
  owner's call, not the team's; do not start it because it seemed small.
- **A question** — answer it, and if the answer should have been obvious, the real fix is a
  documentation change.
- **Not our problem** — a dependency, the environment, someone else's service. Say where it
  actually lives and what you checked to know that.

## Then judge how much it matters

Two axes, and be honest about both:

- **Impact**: data loss, a security hole, or everyone blocked, versus one person mildly annoyed.
- **Frequency**: every request, or one unusual combination.

Anything touching data, money, credentials or the security of the project skips the queue and goes
to the owner with `ask_user` rather than into a list. Everything else is ordinary work — do not
inflate it to get attention.

## Then file it properly

A triaged issue a teammate can start on has: the reproduction, the observed behaviour, the expected
behaviour, where you think it lives, and what done looks like. Add what you ruled out, so the next
person does not repeat your first twenty minutes.

If it is small and you are already holding all the context, fixing it now is usually cheaper than
writing it down — but only if it genuinely is small, and it still goes through review like anything
else.

## Closing things

Close a duplicate by pointing at the original. Close something fixed by pointing at the change that
fixed it. Do not close something because it is old, and do not close something because you disagree
that it matters — that is the owner's decision. Say why, every time; a silently closed report is
how people stop reporting.
