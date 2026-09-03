---
name: updating-dependencies
description: Upgrade packages without breaking the build or importing something nobody vetted — read the changelog, move in separate steps, and prove it still works. Use when updating a dependency, responding to a security advisory, or adding a new package.
---

# Updating dependencies

Every upgrade is somebody else's code entering the project. It is ordinary work, but it is the kind
where a green build is not the same as a safe change.

## One at a time, and separately

- A security patch is its own change. A routine bump is its own change. A major version is its own
  change, and usually its own task.
- Never mix a dependency update into a feature. When something breaks a week later, the first
  question is "what changed", and a diff that did two things cannot answer it.
- Update the lockfile in the same commit as the manifest, always. A manifest and lockfile that
  disagree is a build that works for you and nobody else.

## Read before you upgrade

Look at the changelog or release notes for every version you are crossing, not just the one you are
landing on.

- Breaking changes, deprecations, and anything about defaults changing.
- For a major version, find the migration guide. If there is not one, that is information about the
  package.
- Check the package is still maintained: when was the last release, are issues answered.

If the update needs code changes, make them in the same change and say so in the message.

## Prove it still works

The test suite passing is necessary and not sufficient.

1. Full suite, typecheck, lint — the repo's own commands.
2. Run the thing the dependency is actually used for. Tests often mock exactly the part that broke.
3. Check the build output where it matters: bundle size for a client dependency, startup time for a
   server one.
4. Read the lockfile diff. One package bumped should not quietly bring in thirty transitive
   changes; if it did, say so.

## Security advisories

Do the smallest upgrade that fixes it, and do it first — before the routine bumps that were queued
behind it.

If the fix requires a major version and a migration, that is a decision about time, so bring it to
the owner with `ask_user`: what the advisory is, whether the project is actually exposed to it
(often it is not — the vulnerable path may be unused), and what the two options cost.

## Adding something new

Before adding a package, check the project does not already have one that does this, and that the
standard library does not. Then look at what you are importing: maintenance, size, transitive
dependencies, licence, and whether the name is a near-miss of a more popular package.

Adding a dependency is a long-term commitment on someone else's behalf. For anything substantial,
ask rather than decide.

## If it goes wrong

Revert the upgrade rather than patching around it under time pressure. Then say what broke, with
the error, so the next attempt starts informed.
