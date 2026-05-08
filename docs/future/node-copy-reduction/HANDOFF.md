# Node Copy Reduction — Handoff

## Start Here

Read this file and [README.md](./README.md). Do not look for stage trackers in
this folder; they were removed because they preserved stale architecture and
false status.

## Rules

- Preserve Jess behavior.
- Work from repo evidence first.
- Prefer small, verifiable production changes.
- Do not weaken tests or fixture expectations to make migration work look done.
- Do not introduce broad new runtime abstractions without multiple focused
  proofs and a clear owner.
- Do not use `sourceParent` to smuggle invocation scope.
- Treat `Context.rulesContext`, `ScopeFrame.fallbackFrame`, deep clone, and
  materialization as suspect surfaces, not automatic bugs.
- When a red only appears in `packages/jess/test/less/all-less.test.ts`, prefer
  a parser-accurate focused core repro first when practical.
- Update these docs only when the active frontier or rule set changes.

## Current Status

`packages/jess/test/less/all-less.test.ts` was green at the last pushed
baseline. Core focused proofs cover the formerly-live
`.Person(person, "Male"); .person.sayGender();` closure shape in
`packages/core/src/tree/__tests__/mixin.test.ts`.

The next useful runtime work is still in `packages/core/src/tree/rules.ts`:
guarded mixin dispatch and param/rest binding. Start by reducing direct
candidate field reads or frozen-copy binding paths only where a focused proof
shows the ownership problem.

## Work Loop

1. Pick one production seam from `README.md`.
2. Read the relevant source and focused tests before editing.
3. Make the smallest behavior-preserving change.
4. Run the focused proof first.
5. Run the nearest broader verification.
6. Commit and push when the checkpoint is clean.
