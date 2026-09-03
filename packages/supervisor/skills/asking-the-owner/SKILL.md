---
name: asking-the-owner
description: Decide when something is genuinely the owner's call, and then ask it well with ask_user — one-line title, a recommendation, real options, and a default so nothing stalls overnight. Use before escalating anything to the owner, and when writing an approval request or a report.
---

# Asking the owner

The owner is asleep half the time you are working. Every question you file is a thing they have to
read, so ask few and ask well. A good question can be answered from a phone in ten seconds.

## Decide first, ask second

Ask when the answer depends on something only the owner knows: what they want, what it is worth,
who it is for, what risk they will accept. Ask before anything irreversible, anything that spends
outside your budget, and anything your rules require approval for.

Do not ask when you could find out. A question you could have answered by reading the repo, running
the tests, or calling `team_decisions` is a question that wastes their attention and your run.

Before you ask, always:

1. Call `team_decisions` — this may already be settled, and re-asking a settled question is the
   fastest way to be ignored.
2. Ask a teammate first with `ask_agent` if it is a technical matter someone here already knows.

## How to write it

`ask_user` takes a one-line `title` and a `body`. Write both for someone with no context:

- **title** — the actual decision, in one line. "Drop Node 18 support in the next release?" not
  "Question about Node versions".
- **body** — why this came up, what each option costs, and what you recommend. Three to six lines.
  Do not paste a transcript of your run.
- **options** — up to six, each a concrete choice, not "yes/no/maybe". If you cannot write the
  options, you have not thought the question through yet.
- **recommended** — name the one you would pick. Always fill this in. An owner who agrees with you
  is done in one tap.
- **default_answer** and **default_in_minutes** — what happens if nobody answers. This is the field
  that keeps the team moving overnight. Choose the safe, reversible option as the default; never
  default to something you cannot undo.

## Do not block

`ask_user` returns immediately and you get woken when it is answered. That is the normal path: file
the question, then go do something else that does not depend on it.

Set `wait: true` only when the entire run is meaningless without the answer and there is genuinely
nothing else you could be doing. It blocks for up to twenty minutes and then gives up — twenty
minutes of budget spent on nothing.

If the answer blocks you completely, file the question and end the run with `done` and status
`needs_you`. That is honest and it costs nothing.

## Reports are not questions

An update with no decision in it goes as `kind: "report"`. It lands in the inbox, blocks nothing,
and needs no options. Use it for end-of-day summaries, "this shipped", and "this is going to take
longer than I said".

Never dress a report up as a question to make sure it gets read.

## Afterwards

When the owner answers, act on it. If the answer is a standing preference rather than a one-off,
call `remember` so you do not ask again in a week — that is the difference between a teammate and a
recurring interruption.
