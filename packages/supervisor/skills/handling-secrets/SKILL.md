---
name: handling-secrets
description: Keep credentials out of the repo, the logs and your own messages — how to read a secret you need, what to do when you find one committed, and why you never move one somewhere new. Use whenever a task involves an API key, token, password, certificate or connection string.
---

# Handling secrets

You are working unattended in someone's repo with access to their machine's environment. The rule
is simple: secrets are read where they live, used, and never written down anywhere else.

## Getting one you need

- Read it from the environment or from whatever the project already uses — a secret manager, a
  git-ignored `.env`, the CI's variables. Use the mechanism the repo has; do not invent a second
  one.
- If it is not there, stop and ask the owner with `ask_user`. Say which credential, what it is for,
  and where the project should keep it. Do not go hunting through the machine for a key that
  happens to work.
- A missing credential is a legitimate blocker. Report it and do the parts that do not need it.

## Never write one down

Not in code, not in a config file you commit, not in a test fixture, not in a comment, not in a
commit message, not in a channel message, not in a report to the owner, not in a memory note, not
in a skill. Not "temporarily" — a temporary secret in a commit is a permanent secret in the
history.

The same applies to things that are not obviously keys: connection strings with a password in them,
signed URLs, session cookies, private certificates, and the contents of a `.env`.

## Do not log them either

Check what you print. A dump of the environment, a request logged with its headers, an error that
includes the config object — all of these end up in the run log the owner reads and in whatever
that log gets pasted into. When you must show that a value exists, show its shape: the last four
characters, or just "set".

## When you find one committed

This happens, and how you react matters more than who did it.

1. **Do not paste it.** Not into a channel, not into an issue, not into a report. Say where it is,
   not what it is: "there is what looks like a live AWS key in `config/deploy.yml` line 12".
2. **Tell the owner immediately** with `ask_user`. This is urgent and it is theirs: the key has to
   be rotated, and only they can do that.
3. **Do not try to clean the history yourself.** Rewriting shared history is destructive, and it
   does not un-leak a key that has already been pushed. Rotation is the fix; removal is tidying.
4. Add the file to `.gitignore` and, if the repo has one, a secret-scanning hook — that part is
   ordinary work you can just do.

## Do not move secrets around

Do not copy a key from one place to another "so it is easier", do not put a production credential
into a test, do not send one to a service the project does not already use, and do not add a new
external service that needs one without asking. Every copy is a new place it can leak from.

## When you are unsure

If you cannot tell whether something is a secret, treat it as one. The cost of being careful with a
harmless string is nothing; the cost of the reverse is the owner's afternoon.
