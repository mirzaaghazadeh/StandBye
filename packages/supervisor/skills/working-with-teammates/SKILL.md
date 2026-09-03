---
name: working-with-teammates
description: Talk to the rest of the team so it moves work forward rather than filling channels — when to post, when to ask a named teammate, how to hand off a task, and how not to end up in a loop of replies. Use before posting in a channel, assigning work, or answering a mention.
---

# Working with teammates

Every message you post can wake someone up and cost a run. Talk like that is true.

## Pick the right tool

- **`post_message`** — something the channel needs to know: a decision, a result, a heads-up.
  Mentioning a teammate wakes them, so mention only the people who must act.
- **`ask_agent`** — a direct question for one named teammate. This is almost always better than a
  mention thread: it goes to one person, they get woken once, and the answer comes back to you.
- **`assign_task`** — work you want someone else to own. Not a suggestion, not a discussion.
- **`answer_question`** — reply to a question someone asked you. Answer it and stop; do not open a
  new thread inside the answer.
- **`list_agents`** — when you are not sure who does what. Guessing a name wastes a round trip.

## Say less, but say it fully

One message that contains everything beats three that trickle. A useful message has: what happened,
what it means for the reader, and what you want from them — or explicitly nothing, if you are just
recording it.

Do not post to show you are working. Your runs are visible; narration is not needed. Do not
acknowledge, do not thank, do not agree — an agreement that carries no new information is a wake-up
you charged someone for.

## Handing work over

When you assign or hand off a task, include what the next person cannot easily reconstruct:

- what done looks like, concretely;
- where things stand right now — branch name, files touched, what already passes;
- what you tried that did not work, so they do not repeat it;
- anything you were told by the owner that constrains the answer.

Write it so someone can start without asking you a question. If they have to ask, the hand-off was
incomplete.

## Do not talk in circles

Agent-to-agent threads have a depth limit for a reason: two agents can politely refine a plan until
the day's budget is gone. Guard against it yourself.

- Two exchanges on the same point is the limit. If you still disagree, one of you decides, or you
  take it to the owner with `ask_user` — briefly, with both positions and a recommendation.
- Never reply solely to signal that you read something.
- If a thread has stopped producing new information, end it and go do the work.

## Disagreeing

Disagree once, with evidence, to the person concerned rather than to the channel. If they hold
their position and it is their area, it is their call — say you disagree, note why, and move on.
Escalate to the owner only when the cost of being wrong is real.

## Reading before writing

Call `read_channel` before you post into a conversation that has been running. Answering a question
someone answered an hour ago is the most common way to waste a run.
