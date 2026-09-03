---
name: making-it-faster
description: Fix a performance problem with evidence rather than instinct — measure first, find where the time actually goes, change one thing, and prove the win. Use when something is slow, when a build or suite is dragging, or before optimising anything.
---

# Making it faster

Nearly all optimisation work that fails, fails for the same reason: it started from a guess about
where the time went. Your intuition about a codebase you did not write is worth very little here.
The measurement is worth everything.

## Say what "fast enough" is first

Write down the number before you start: this page under 200ms at the median, this job under five
minutes, this suite under two. Without a target you cannot tell when to stop, and optimisation with
no stopping condition eats a week.

Ask if it is not given. "Make it faster" is not a target; "the owner is waiting 40 seconds for a
build that used to take 10" is.

## Measure the thing people actually wait for

- Reproduce the slowness in a way you can run repeatedly, with realistic data. A hundred rows will
  not show you the problem that appears at a hundred thousand.
- Record the baseline: several runs, and the spread, not one number. A change inside the noise is
  not a change.
- Measure end to end first, then break it down. Knowing that one call takes 90% of the time is
  worth more than any micro-benchmark.

## Find where the time is

Use a profiler if the language has one. Failing that, time the stages and narrow — the same
halving you would use to find a bug.

Look for the shapes that account for most real slowness before looking at anything clever:

- **Work repeated in a loop** — a query per row, a file opened per iteration, a request per item.
  Batch it.
- **Doing it more than once** — the same computation or fetch repeated because two callers each
  asked for it.
- **Fetching what you do not need** — every column, every row, the whole file.
- **Waiting in series** — independent calls made one after another that could overlap.
- **The wrong data structure** — a linear scan inside a loop, quietly quadratic.
- **Missing an index** — usually the entire answer when a database is involved.

## Change one thing

One change, re-measure, keep it or drop it. Two at once and you will not know which worked, and one
of them may have made it worse.

Prefer the change that removes work over the change that does the same work faster. Not doing the
query at all beats a faster query.

## Prove it and say what it cost

Report the before and after, the conditions you measured under, and what you gave up: more memory,
a cache that can go stale, code that is harder to read, a behaviour that is now approximate. There
is nearly always a trade, and hiding it is how a fast, subtly wrong system gets shipped.

Then check correctness properly. The tests that passed before must still pass — an optimisation
that changes results is a bug with better timing.

## Know when to stop

Stop at the target. Stop when the next win is small and the complexity is large. And if the honest
answer is that the real fix is architectural and out of scope, say that with the measurement behind
it, rather than shaving another five percent to have something to report.
