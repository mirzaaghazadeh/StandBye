---
name: designing-an-interface
description: Design a screen someone can read at a glance and act on without being taught — hierarchy, density, the states you forgot, and copy that says something. Use before building any screen, panel, sheet or empty state, and when a screen "works" but feels wrong.
---

# Designing an interface

Most bad screens are not ugly. They are unreadable: everything the same weight, nothing answering
the question the person actually arrived with. Start from that question.

## Before you draw anything

Say in one sentence what the person is here to find out or do. "What is my team working on?"
"Why did last night cost that much?" If you cannot say it, the screen has no shape yet and any
layout will do — which is why it will be bad.

Then find the one thing on the screen that answers it. That is the only element allowed to be
loud. Everything else supports it or gets out of the way.

## Hierarchy is contrast, not size

Three levels is usually enough: the answer, its supporting detail, and the chrome around them.
Separate them with weight and colour before reaching for size — a 13px semibold label against
12px muted text reads better than 18px against 14px, and stays calm.

- One accent colour, used for the action you want taken and nothing else. An accent on everything
  is an accent on nothing.
- Colour is never the only signal. A red dot and a green dot are the same dot to a colourblind
  reader: pair it with a word or a shape.
- Numbers people compare belong in a monospaced or tabular font, right-aligned, same precision.
  `$0.03` under `$12.40` reads as a column; `$0.0300` and `$12.4` read as noise.

## Density

Desktop users are not on a phone. Tight rows, real information, no card with four words in it.
But density is not clutter: group related things and leave real space *between* groups. A 4px gap
inside a group and a 16px gap between them does more than any divider line.

Whitespace is not empty space — it is what makes the rest legible. The instinct to fill it is
almost always wrong.

## The states you forgot

Every screen has more than the one you designed. Walk them deliberately:

- **Empty** — the first thing a new owner sees. Say what goes here and how to put it there. "No
  tasks yet. Add one, or wait for the team to file one." Not "No data."
- **One item** — does the layout still make sense, or was it designed for twelve?
- **Far too many** — 500 rows. What scrolls, what stays, what gets slow.
- **Loading** — the difference between a spinner and a skeleton is whether the layout jumps when
  the data lands.
- **Failed** — say what failed and what to do. An error the person cannot act on is a dead end.
- **Stale** — the data was right ten minutes ago. Does it say so?
- **Long strings** — a 90-character title, a path, a name in another script. It wraps or it
  truncates with the full value in a tooltip; it never pushes the layout sideways.

## Copy is design

The words are most of the interface. Write them like a person talking to a person:

- Say what happened, not what the system did. "Nothing to release yet" beats "No eligible
  artifacts found".
- Label buttons with the verb of the thing. "Add to board", not "Submit". "Stop team", not "OK".
- Never label a destructive action with a neutral word, and say what will be lost before asking.
- No exclamation marks, no "Oops", no apologising. A calm sentence is more reassuring than
  cheerfulness.

## Motion

Motion earns its place by explaining a change: something appearing, moving, or being replaced.
A 120–180ms ease-out is enough. If a person notices the animation itself, it is too slow. Anything
that loops forever while nothing is happening is a spinner pretending to be progress — show what
is actually going on instead.

## Before you call it done

Look at it the way a stranger would, at the size they will actually use:

- Read only the bold text. Does it tell the story?
- Cover the accent colour. Is the important thing still obvious?
- Make the window narrow, then very wide. Does anything overlap, clip or stretch to nonsense?
- Is there anything on this screen that nobody will ever need? Delete it.
