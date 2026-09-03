---
name: reviewing-for-security
description: Take a security pass over a change — where untrusted input reaches something dangerous, what the authorisation check misses, and what leaks in a log or an error. Use when reviewing code that touches input, auth, files, queries, shell commands or the network.
---

# Reviewing for security

Most real vulnerabilities are ordinary code with one missing check. You are looking for the path
from something a stranger controls to something that matters.

## Follow the untrusted input

Start at the edges — request bodies, query strings, headers, file uploads, webhook payloads, file
names, environment on a shared host, and anything a user typed — and follow each one to where it
lands:

- **into a query** → is it parameterised, or is it string-concatenated? Concatenation is the bug,
  even when the value "obviously" cannot contain a quote.
- **into a shell** → is it an argument array, or a formatted command string? Passing a list of
  arguments is the fix; escaping by hand is not.
- **into a path** → can it contain `..` or an absolute path and escape the directory? Resolve, then
  check the result is still inside where it should be.
- **into HTML or a template** → is it escaped at the point of output?
- **into a URL the server fetches** → can it be pointed at localhost or the cloud metadata service?
- **into a deserializer, a template engine, or `eval`** → this is almost always wrong; ask why.

## Then check authorisation, not just authentication

Knowing who someone is and knowing what they may do are different checks, and the second is the one
that gets forgotten.

- Every handler that acts on an object: does it check this user may touch *this* object, not merely
  that they are logged in?
- Is the check on the server, or only in the interface?
- Does a list endpoint filter by the caller, or return everyone's rows and rely on the client?
- Do identifiers guess easily? Sequential ids plus a missing check is the classic pair.

## Look at what leaks

- Errors returned to the caller with a stack trace, a query, a path or a version in them.
- Log lines carrying tokens, headers, request bodies or personal data.
- Debug endpoints, verbose modes, and default credentials left switched on.
- Timing and messages that distinguish "no such user" from "wrong password" on things worth
  enumerating.

## And at the defaults

- New configuration that ships permissive: open CORS, a wildcard origin, public storage, a disabled
  certificate check, an unauthenticated port.
- A dependency added in the diff — is it maintained, is it the package it claims to be, does the
  name look like a typo of a popular one?
- Crypto invented in the diff. Any hand-rolled hashing, signing or token scheme deserves a
  question, not a nod.

## How to report it

Say the concrete path — the input, the sink, and what an attacker gets — not the category name. "A
report id from the query string goes straight into the file path on line 40, so `?id=../../.env`
reads the environment file" is actionable; "possible path traversal" is a search term.

Rank by what it gives an attacker, not by how clever it is. If it is genuinely serious, take it to
the owner with `ask_user` rather than only leaving a review comment — and follow
`handling-secrets`: describe the hole, never paste a working exploit or a live credential into a
channel.
