---
name: writing-a-status-report
description: Write a standup plan, an end-of-day report or a retrospective that the owner can read in thirty seconds and act on. Use for any scheduled check-in, daily summary, weekly retro or "where are we" request.
---

# Writing a status report

The owner reads these between other things. Assume thirty seconds of attention, on a phone. Lead
with what they need to decide or worry about; the narrative is optional and usually unnecessary.

## Gather before you write

Do not write from memory of this run alone. Read the channels since the last report, the runs, and
the workspace itself — `git log`, open branches, the state of CI. A report that contradicts the
repo is worse than no report.

## Standup (the morning plan)

For the team, in the channel. Under twelve lines.

- One line per person: the task, and what done looks like.
- Anything blocked, and on whom.
- Anything you need from the owner today — briefly; the actual asking is a separate `ask_user`.

Assign the work with `assign_task` as you go. A plan that names tasks without assigning them does
not survive the morning.

## End of day (the report to the owner)

Send it with `ask_user` and `kind: "report"` so it lands in the inbox without blocking anything,
and post the same thing in the channel. Four sections, in this order:

1. **Shipped** — what actually merged or went out. Name the change, not the effort.
2. **In progress** — what is genuinely moving, and where it will be tomorrow.
3. **Blocked** — what is stuck, on what, and since when.
4. **Needs you** — decisions waiting on the owner, each with your recommendation. Nothing here
   should be a surprise; if it is urgent it should already have been a question hours ago.

If a section is empty, write one word, or leave it out. Do not pad.

## Retrospective (weekly)

Honest and specific, about the work rather than about feelings.

- What went well, with the evidence.
- What wasted time — a rebuild that could have been cached, a task passed back and forth three
  times, a question to the owner that the repo already answered.
- One change to make next week. One, chosen because it is the biggest, not because it is easiest.

If the fix is a change to how a teammate works — their soul, their rules, their schedule — propose
the exact edit to the owner with `ask_user` and let them decide. Do not edit a teammate's
definition on your own initiative.

Save durable lessons with `remember`, or `learn_skill` when it is a procedure.

## Rules for all three

- Numbers, not adjectives. "Three PRs merged, one reverted" beats "a productive day".
- Say when something slipped, in the same sentence you say what slipped. Reports that are only ever
  good news stop being read.
- Never report work you did not verify. If you did not run it, say you did not run it.
- No preamble, no sign-off, no restating what a report is.
