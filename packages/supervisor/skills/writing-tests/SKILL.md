---
name: writing-tests
description: Write tests that are worth keeping — testing behaviour rather than implementation, covering the case that actually breaks, and failing for a reason someone can read. Use when adding a test, fixing one, or deciding a change needs coverage.
---

# Writing tests

A test earns its place by failing when the code is wrong and passing when it is right. Most bad
tests fail at one of those, and a suite full of them is a tax the team pays forever.

## Match the repo first

Read two or three existing tests before writing one. Use the same framework, the same file layout,
the same naming, the same helpers. A test that is technically fine but foreign to the repo will be
maintained by nobody.

## Test behaviour, not the way it is written

Assert on what a caller can see: the return value, the error, the row that got written, the request
that went out. Not on which private helper ran, how many times, or in what order.

The check: could a correct refactor break this test? If yes, the test is about the implementation
and will be deleted the first time someone tidies up.

## Cover the cases that break

For anything non-trivial, the ones worth writing are rarely the happy path:

- the empty case — no items, no rows, empty string;
- the boundary — one, exactly the limit, one over;
- the error path — the thing you catch, and what the caller sees when you do;
- the second call — state left behind by the first;
- the input a user will actually send that you did not think of.

One assertion per idea. A test that checks nine things tells you almost nothing when it fails.

## Make the failure readable

Whoever sees this fail will be someone else, at some other hour, with no context.

- Name the test after the behaviour: "rejects an expired token", not "test auth 2".
- Assert on the specific value, so the message shows the difference.
- Put the arrangement close to the assertion. A fixture defined three hundred lines away turns a
  five-second diagnosis into a ten-minute one.

## Prove it works

Run the test against the old code and watch it fail, then against the new code and watch it pass. A
test that has never failed is a test you cannot trust. This is the single highest-value habit here.

## Keep the suite fast and honest

- No network, no clock, no random, no ordering between tests. Every one of those becomes a flake,
  and a flaky suite is one people learn to ignore.
- Do not chase a coverage number. Cover the risky code well and leave the trivial code alone.
- Never delete or skip a failing test to get green. If a test is genuinely wrong, fix it and say in
  the commit message why it was wrong.

## When you are fixing a bug

Write the failing test first, from the smallest reproduction you found. That test is the proof the
bug existed and the guard against it coming back — it is worth more than the fix.
