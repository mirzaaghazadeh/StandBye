---
name: working-unattended
description: Take a run from "nothing was assigned to me" to a pushed, tested change without asking anyone. Use on a check-in that found no new messages, on an escalation from one, or any time you are choosing your own work.
---

# Working unattended

Nobody is coming. There is no one to unblock you, confirm a judgement call, or notice that you
stalled — so the failure mode here is not doing the wrong thing, it is doing nothing and reporting
that you were waiting.

## Pick one thing

Read the backlog before anything else. In order:

1. Something you already claimed. Finish it before starting anything new — a half-built item that
   nobody owns is worse than an empty board.
2. The top `ready` item nobody has claimed. `claim_item` it first. If the claim is refused, a
   teammate got there first: take the next one, do not race them.
3. If the board is empty, go and find work. Read the last ten commits, run the tests, look at what
   is untested, and use the product the way the owner would. File what you find with `add_idea`
   and a real case for it, then claim the best one.

One item per run. A run that ships one small thing beats a run that half-does three.

## Do it

Small diff, tests that would have caught the bug, everything green before you push:

- Build what the tests read (`pnpm --filter @crew/shared build`, then the supervisor) — the suite
  runs against `dist/`, so an unbuilt change tests the old code and passes for the wrong reason.
- Run the whole suite, not just your file. You are about to push without review.
- Typecheck. There is no linter to catch you.
- If the tests were already red when you started, that is the work. Say so and fix that instead.

## Decide, then write down why

Every question you would have asked, you now answer yourself. When you are unsure, take the
smaller, more reversible option: a narrower fix, a flag defaulted off, a test before a refactor.

Record the decision where it will be found later — in the backlog item's outcome, in your memory
with `remember`, and in the commit message. "Chose X over Y because Z" costs one line and saves
the owner reverse-engineering your reasoning from a diff.

## Know when to stop

Stop and leave it clean rather than pushing something you are unsure of:

- A change that would need the owner's judgement about product direction or money. Drop the item,
  say why, and pick something else.
- A rule that blocked you. It is a hard stop, not an obstacle to route around.
- Tests you cannot get green. Push nothing, `finish_item` as dropped with what you learned, and
  leave the tree as you found it.

A quiet run that found nothing worth doing is a good outcome. Say so and finish.

## Close the loop

`finish_item` with what actually happened, then a short note in `#general`. Use `ask_user` with
kind `report` if the owner should see it — that does not block. Never end a run without calling
`done`.
