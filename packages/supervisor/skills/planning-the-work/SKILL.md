---
name: planning-the-work
description: Turn a goal into tasks a teammate can actually finish — sized to one run, with a definition of done, an owner and an order. Use when you are given something large, when you run the standup, or when the team is busy but nothing is shipping.
---

# Planning the work

A plan exists to make the next person's decision easy. If a teammate reads your task and still has
to ask what to build, it was not a plan.

## Start from the outcome

Write the goal in one sentence, in the owner's terms, not the implementation's: "the API returns
results in under a second for the top ten queries", not "add caching". Then work backwards. If you
cannot state the goal that way, you do not understand the ask yet — go and ask.

Check what already exists before you plan around it. Half of most plans is already in the repo.

## Cut it into tasks

A good task:

- **fits one run.** If it needs more, it is two tasks. Splitting is not optional — the app cuts a
  run off at its cap wherever it happens to be.
- **has a definition of done** you could check without the author present: this test passes, this
  command prints this, this endpoint returns this.
- **has one owner.** Two people on one task means neither is on it.
- **stands alone, or names what it waits on.** Say the order explicitly rather than hoping.

Cut along seams the code already has. A task that touches nine files across four areas is usually
one task pretending, and it will collide with everyone else's work.

## Sequence it honestly

Put first the thing that most likely proves the plan wrong. If a spike is needed to know whether
the approach works, that is task one and everything after it is provisional — say so, rather than
laying out five confident tasks built on an assumption nobody has tested.

Then look at what can happen in parallel and what genuinely cannot. Two agents editing the same
file is not parallelism.

## Hand it out

Assign with `assign_task` — one task, one person, the definition of done in the details. Post the
plan in the channel so everyone sees the shape, and keep it under a dozen lines. A plan nobody
reads is worse than none.

Match the task to the teammate. Give review work to the reviewer, docs to the writer. Ignoring the
roles the owner set up wastes what they built.

## Then follow up

A plan is not finished when it is posted.

- Check what actually moved before planning again. Re-planning without reading is how a team spends
  a week producing plans.
- If a task has not moved by the next check-in, find out why with `ask_agent` — blocked, too big,
  or badly described are three different fixes.
- When the plan is wrong, change it and say that you changed it. Quietly dropping a task teaches
  the team that tasks are optional.

## What is not yours

Deciding what the project is for, what it is worth, and what risk is acceptable is the owner's.
Bring them the plan and a recommendation with `ask_user` when the choice is theirs — but bring one
plan, not a menu.
