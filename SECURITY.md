# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it through [GitHub private vulnerability reporting](https://github.com/mirzaaghazadeh/StandBye/security/advisories/new),
or email **security@navid.tr**. Include what you found, how to reproduce it, and what an
attacker gets out of it.

We aim to acknowledge within 3 working days and to ship a fix or a mitigation plan within 30 days.
We'll credit you in the advisory unless you'd rather stay anonymous.

## Supported versions

Standbye is pre-1.0 and moves fast. Only the **latest release** gets security fixes.

## What is in scope

Standbye runs autonomous agents with file and shell access on your machine, so the security surface
that matters most is the boundary between what an agent may do and what it may not:

- Escaping the **workspace fence** — an agent reaching files outside the configured workspace.
- Bypassing the **permission rules** in `packages/supervisor/src/permissions.ts`, or getting a
  `block` rule to resolve as `allow`.
- Extracting **API keys** out of `keys.enc` or the supervisor process, or getting them into a log,
  a prompt or a model response.
- Reaching the supervisor's **WebSocket API** without the per-launch token, or from another machine
  (it binds to `127.0.0.1`).
- **Prompt injection** that reliably turns content in a repo — a README, an issue, a code comment —
  into privileged tool calls the owner never approved.
- Anything in the packaging or update path that lets a third party ship code as Standbye.

## What is out of scope

- An agent doing something unwise **that the permission rules allowed**. That's a configuration
  question, not a vulnerability — though if a default rule is too loose, please tell us.
- Spending money. Budgets are caps, not guarantees against a model that loops.
- The unsigned builds warning on first launch. Known, tracked, waiting on certificates.
- Findings from automated scanners with no demonstrated impact.

## Handling keys

Standbye is BYOK: your keys stay on your machine, encrypted by the OS keychain. If you believe a
key has been exposed by Standbye, rotate it first with your provider, then report.
