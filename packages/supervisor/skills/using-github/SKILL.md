---
name: using-github
description: Work the forge from the command line with gh — open and describe a pull request, read review comments, check why CI failed, file and close issues. Use when a task involves a pull request, an issue, or a failing check rather than only local code.
---

# Using GitHub

The `gh` CLI is how you see what the humans see. Check it is there and authenticated before you
plan around it: `gh auth status`. If it is missing or logged out, say so — that is a setup problem
for the owner, not something to work around by scraping the web.

## Reading before writing

Most GitHub work starts with a question, and these answer it:

- `gh pr list` / `gh pr view <n> --comments` — what is open and what reviewers said.
- `gh pr diff <n>` — the change itself, without checking it out.
- `gh pr checks <n>` — which checks failed. Follow with `gh run view <id> --log-failed` to get the
  actual failure rather than guessing from the name.
- `gh issue list --label bug` / `gh issue view <n>` — what has been reported.
- `gh api` when nothing else exposes what you need. Prefer the porcelain commands where they exist.

## Opening a pull request

The description is the part a human reads, so write it for them:

- **What changed**, in a sentence a non-author understands.
- **Why**, or the issue it closes — link it (`Closes #123`) so it closes itself.
- **How you tested it**: the commands you ran and what they printed.
- **What to look at hardest**: the risky hunk, the assumption you made, the thing you were unsure
  about. Reviewers give better reviews when you aim them.

Keep it in the repo's template if there is one. Open it as a draft if it is not ready — a draft is
information, a broken pull request marked ready is noise.

## Responding to review

- Answer every comment, even if the answer is "done" — an unanswered comment reads as ignored.
- Push a fix as a new commit rather than force-pushing over the review, so the reviewer can see
  what changed since they looked.
- Disagree once, with reasoning. Then do what the reviewer asked or take it to the owner.
- Do not resolve a thread you did not act on.

## Issues

- When you file one, make it reproducible: version, steps, what you expected, what happened. An
  issue nobody can reproduce is a note to self.
- Close with the commit or pull request that fixed it, so the trail survives.
- Do not open issues for things you are about to do in the next ten minutes.

## What is not yours

Merging, releasing, changing repository settings, inviting people, and anything that touches
another person's pull request are the owner's, unless your rules say otherwise. Approving a pull
request is a review action — say what you checked; do not approve on the strength of a skim, and
never approve your own.

Comments you post are public and permanent. Write them as if the owner's colleagues will read
them, because they will.
