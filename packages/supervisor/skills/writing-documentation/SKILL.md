---
name: writing-documentation
description: Write docs that stay true to the code — README, reference, release notes and comments that answer what a reader actually needs. Use when behaviour changed, when a README no longer matches, or when you are asked to document something.
---

# Writing documentation

Documentation that lies is worse than none: it costs the reader time and then costs them trust.
Everything below follows from that.

## Write for someone at a specific moment

Before writing, name the reader and what they are trying to do. Somebody installing this for the
first time needs different words than somebody debugging it at midnight. A page that tries to serve
both serves neither.

Then answer their question in the first paragraph. Background, history and rationale go below, if
at all.

## Get it from the code, not from the old docs

Read the implementation. Run the command you are about to document and paste what it actually
printed. Check the flag still exists, the default is still what the page claims, and the example
still works. Copying a stale sentence forward is how documentation rots.

If the code and the docs disagree, that is a finding — say which one you think is wrong rather than
quietly picking one.

## Shape

- Short sentences. Concrete nouns. Present tense.
- One working example beats three paragraphs of description. Make it copy-pasteable and make it the
  simplest case, not the most impressive.
- Say what something is for before how to use it.
- Document the failure too: what the common error means and what to do about it. That is the
  paragraph people arrive from a search engine to find.
- No marketing, no "simply", no "just". If a step is easy, it does not need saying; if it is not,
  the word is an insult.

## Keep it near the code

Update the docs in the same change as the behaviour, not in a follow-up that never comes. If the
change is behind a flag or not released, say so in the docs rather than describing the future as if
it were the present.

Delete documentation for things that no longer exist. Removing a lying page is real work, and it is
usually higher value than adding a new one.

## Comments in code

Only where the code cannot speak for itself: why this approach and not the obvious one, what
constraint forces this ordering, what the surprising value is for. Do not narrate what the next
line does — that comment goes stale and adds nothing.

## Release notes

Written for someone deciding whether to upgrade.

- Lead with anything that breaks, and say exactly what to change.
- Then what is new, in the user's words rather than the changelog's.
- Then fixes worth knowing about.
- Leave out internal refactors nobody outside the repo can see.

## When you do not understand it

Ask the person who wrote it one precise question with `ask_agent`. Do not guess and do not hedge
the sentence until it is technically unfalsifiable — vague documentation is how a wrong page
survives review.
