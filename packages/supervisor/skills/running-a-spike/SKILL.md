---
name: running-a-spike
description: Answer an open technical question with a time-boxed throwaway experiment instead of arguing or over-building. Use when the team does not know whether an approach will work, which library to pick, or how much a change would cost.
---

# Running a spike

A spike is an experiment with a deadline. It exists to replace an opinion with a fact, and its
output is a recommendation — not a feature.

## Set it up before you start

Write these four lines down first. If you cannot, you are not ready to spike:

1. **The question**, phrased so it has an answer. "Can we stream responses through the existing
   queue without changing the client?" — not "look into streaming".
2. **What would make it a yes**, and what would make it a no.
3. **The box**: how long, and how much. Say it as a number of minutes or dollars, and honour it.
4. **What you will hand back**: the recommendation and the evidence for it.

## Work like it is disposable, because it is

- Build the smallest thing that answers the question. Hardcode. Skip the tests. Skip the error
  handling. This code is not going to be merged.
- Keep it out of the way — a scratch branch or a scratch folder, never mixed into real work.
- Go straight at the risky part. If a spike is going to fail, you want it to fail in the first ten
  minutes, not the last.

## Stop when the box is empty

When the time or the budget is gone, stop, even mid-thought. An unfinished spike still has an
answer: "we do not know yet, and here is what we learned and what it would take to find out." That
is a legitimate result and it is worth reporting.

## Report it

Report to whoever asked — the lead with `post_message` or `ask_agent`, the owner with `ask_user`
when the decision is theirs. Keep it to:

- the question, restated;
- what you did, in two or three lines;
- what happened, with the numbers or the output;
- your recommendation, and your confidence in it;
- what you did not test.

Recommend one option. A spike that ends in "either could work" has not finished.

## Afterwards

Throw the code away. Reusing spike code is how a hardcoded prototype ends up in production.
Record the finding with `remember`, or with `learn_skill` if it is a procedure the team will repeat,
so nobody spikes the same question twice.
