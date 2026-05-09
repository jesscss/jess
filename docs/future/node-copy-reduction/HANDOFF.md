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
guarded mixin dispatch and param/rest binding. Candidate field reads in
`MixinCollection.evalCall(...)` are centralized behind local helpers now; start
there when replacing them with an explicit ownership surface. Otherwise, target
frozen-copy binding paths only where a focused proof shows the ownership
problem. In `packages/core/src/tree/reference.ts`, `preserveRulesLike` variable
references now return the shallow owned rules-like wrapper directly; do not
reintroduce a deep copy there. Merged declaration reference flattening also
reuses the copied value leaves it is handed instead of copying them again, and
merged declaration references normalize the already-owned evaluated value
directly instead of making one more result copy. Post-eval merged declaration
coalescing in `packages/core/src/tree/rules.ts` now keeps accumulated values
read-only and lets merge composition own the copy boundary instead of recopying
stored/list-flattened leaves. The `Call.evalNode` `sourceNode.parent` repair is
still active because the detached-ruleset non-leaky scope test fails without it.
In `packages/core/src/tree/call.ts`, ordinary JS functions with explicit empty
positional arg lists no longer copy the empty `List`; callbacks that receive the
arg `List` itself still keep the defensive copy. Plain CSS calls with explicit
empty arg lists also skip the empty-list clone during `resolve(context)`;
non-empty calls still use the existing defensive path.

## Work Loop

1. Pick one production seam from `README.md`.
2. Read the relevant source and focused tests before editing.
3. Make the smallest behavior-preserving change.
4. Run the focused proof first.
5. Run the nearest broader verification.
6. Commit and push when the checkpoint is clean.
