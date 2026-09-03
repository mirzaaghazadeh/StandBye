---
name: building-a-screen
description: Get a designed screen onto the glass without the classic desktop-app faults — a panel that will not fill its window, a popover clipped by its parent, a list that re-renders forever, text in the wrong direction. Use when writing or changing any UI code, and before saying a screen is done.
---

# Building a screen

The bugs here are not logic bugs. The code is right, the data is right, and the window still looks
broken. They are the same handful every time.

## Fill the window, or explain why not

A screen that sizes to its content leaves its footer floating in the middle of an empty window —
the single most common fault, and the easiest to miss on a machine with a small window.

A column that must fill needs **both** `flex: 1` and `min-height: 0`. Without the second, a flex
child refuses to shrink below its content and the scroll happens on the wrong element, or not at
all. The same applies horizontally with `min-width: 0`.

Match how the screens around you attach to the layout. If every other screen returns its toolbar
and body as direct children of the scrolling container, a new one that wraps them in an extra
`div` is a screen that will not fill — the wrapper is an unstyled block and the flex chain stops
there. Check the class you reach for actually exists before trusting it to do something.

## Never scroll the whole window sideways

Wide content — a table, a diff, a code block, a long path — scrolls **inside its own box**, with
`overflow-x: auto` on that box and `min-width: 0` on its flex parent. A horizontal scrollbar on
the window itself is always a bug, and it is caused by one child that refuses to shrink.

Long unbroken strings need `overflow-wrap: anywhere` or a truncation with the full value in a
`title`. A hash, a URL and a file path will all otherwise push the layout wider than the screen.

## Anything that floats goes in a portal

Menus, popovers, pickers, tooltips: render them through a portal with fixed positioning, measured
from the trigger's bounding box. Inside the normal flow they get clipped by the first ancestor
with `overflow: hidden` — which is every scrolling pane — and they will widen the layout when the
window is small. Close on outside click and on Escape, both.

## Do not make the list re-render forever

A selector that builds a new array or object each call returns a new reference every time, and a
subscription that compares by reference will re-render without end. Return the stored value, or a
module-level constant for the empty case. Never `.filter()`, `.map()` or `{...spread}` inside a
selector.

Derive in a memo keyed on what it actually depends on, not on the whole store.

## Text has a direction

Content is written by people and agents in whatever language they use, often mixed — Persian prose
quoting English identifiers is normal. Put `dir="auto"` on each block of user or agent content and
let the browser decide per block. Never set a global direction and never assume left-to-right for
anything you did not write yourself. Code blocks are the exception: those stay `ltr`.

## Every async thing has four endings

Loading, empty, failed, and stale. Write all four before you write the happy path, or you will
ship a screen that shows a spinner for ever when the request rejects. A response that arrives
after a newer one must be dropped, not rendered — keep a sequence number and ignore the stale one.

## Before you call it done

- Open it. Actually look at it — build and run, do not reason about it from the source.
- Resize: narrow, then very wide. Nothing overlaps, nothing clips, no sideways scroll.
- Check the empty state and the error state on purpose; they are the ones nobody sees until a user
  does.
- Read the console. A React key warning or an unhandled rejection is a real bug you can still fix
  cheaply.
- Typecheck. A screen that compiles is not a screen that works, but a screen that does not compile
  is not a screen at all.
