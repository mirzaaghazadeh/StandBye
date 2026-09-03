---
name: staying-inside-budget
description: Do the work for what it is worth — spend your run on the thing that was asked, not on re-reading the repo, arguing with a teammate or grinding a stuck task. Use when a job looks large, when you have failed twice already, or when you are about to start something open-ended.
---

# Staying inside budget

Every run costs the owner money, and the app enforces the ceilings: a per-run cap, a daily cap for
you, a daily cap for the team, a turn limit and a wall-clock timeout. Hitting one does not pause
politely — the run is cut off wherever it happens to be. The way to never lose work to a cap is to
plan runs that finish well inside one.

## Spend on the thing that was asked

- Read what you need, not the codebase. Search for the symbol; open the file it is in. Reading
  twenty files to change one is the most common way a run dies at the turn limit.
- Do not re-derive what you already wrote down. Your memory notes and your skills exist so the
  second run is cheaper than the first; if you find yourself rediscovering something, that is a
  sign you should have called `remember` last time.
- Do not restate the plan back to yourself, and do not narrate. Turns spent talking are turns not
  spent working.

## Size the job before you start it

If a task will not fit in one run, say so and split it — a branch with a finished first half and a
clear note about the second is worth far more than a run that was killed mid-edit. Tell whoever
assigned it, with `ask_agent` or in the channel, so the plan changes rather than silently slipping.

Long-running commands count against the clock too. A full end-to-end suite that takes ten minutes
may be most of your run; run the targeted test while you work and the full suite once, at the end.

## Stop before the cap does

Three signals you should finish and hand over rather than push on:

- the same failure three times in a row;
- you are more than halfway through the run and have not made a change yet;
- you are waiting on an approval or an answer that is not coming.

In all three cases: end the run with `done`, say plainly where things stand and what the next run
should do first. `needs_you` if it is the owner's move. An honest stop is cheap; a cut-off run
leaves the workspace half-edited and the next run pays to work out what happened.

## The cheap paths are there to be used

- Check-ins run on a small model and exist to decide whether there is work at all. Let them do that
  job — escalating for real work is correct, escalating to have a look around is not.
- Do not wake teammates you do not need. A mention is a run; a mention of four people is four runs.
- Do not re-run a check that already passed in this run.

## When a cap has been hit

If your budget is gone, the run is refused before it starts and the owner sees why. There is
nothing to work around and nothing to retry — and quietly finding a cheaper provider to keep going
is not your call to make. Leave the state clean so tomorrow starts well.
