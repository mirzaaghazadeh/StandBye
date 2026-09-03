---
name: remembering-and-learning
description: Keep what you learned so future runs start ahead — what belongs in remember, what belongs in a skill written with learn_skill, and what belongs nowhere. Use at the end of a run where you worked something out the hard way.
---

# Remembering and learning

You start most runs with no recollection of the last one. What survives is what you wrote down:
your memory notes, and your skills. Both are loaded into or listed in every future prompt, so they
are valuable and they are not free — a memory full of noise makes every later run worse.

## Which one

- **`remember`** — a single durable fact, in one sentence. A convention, a gotcha, a preference of
  the owner, a decision and its reason. It is loaded into every one of your future runs.
- **`learn_skill`** — a procedure with steps, worth following again. Only its name and description
  sit in the prompt; the body is read on demand with `use_skill`. Anything longer than a sentence
  belongs here, not in memory.
- **Neither** — task progress, run summaries, things already written in the repo, things that will
  be false next week.

## Writing a memory note

Facts a teammate could act on, not impressions.

- Good: "The typecheck needs `pnpm --filter @crew/shared build` first or it reports stale errors."
- Good: "The owner wants release notes written before the tag, not after."
- Bad: "Working on the auth refactor." — that is progress, and it will be wrong tomorrow.
- Bad: "The codebase is quite complex." — unactionable.

One fact per call. If you find yourself writing "and", it is probably two notes, or a skill.

## Writing a skill

Write one when you had to work something out and would have to work it out again. Command
sequences for this repo, a checklist for a recurring chore, a pattern that this codebase insists on.

- **name** — short, kebab-case, named for the job. `deploying-the-worker`, not `deployment-notes`.
- **description** — what it does *and when to use it*. This is the only thing a future run sees
  until it opens the skill, so it must be enough to decide on. "Deploys the worker to Fly and
  verifies the health check — use before announcing a release" beats "Deployment info".
- **content** — the steps, in order, with the real commands. Say what to do when a step fails. Keep
  it under sixty lines; if it is longer, it is two skills.
- **scope** — `mine` by default. Use `team` when anyone here would need it, and say so in the
  description. Do not put your personal habits on the team shelf.

Saving the same name replaces the old version, so improving a skill you already have is the normal
way to use this — fix the step that was wrong rather than writing a second, nearly identical skill.

## Check before you write

Read the skills already listed in your prompt. If one nearly covers this, update it instead of
adding a near-duplicate — two skills with overlapping descriptions means every future run picks
wrong half the time.

## At the end of a run

Ask yourself one question: did I learn something today that I would hate to rediscover? If yes,
write it down before calling `done`. If no, do not manufacture something to save.
