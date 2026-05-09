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

The latest runtime pass in `packages/core/src/tree/rules.ts` narrowed the main
mixin clone boundaries without removing the owned eval surfaces that still
matter. Param binding reuses already-evaluated or static childless scalar
values with no source location instead of copying them just to create a live
slot. Resolving live-slot values also reuses those scalar leaves, including
children of copied source-free `@arguments`/rest containers; source-backed
values and containers still use the defensive copy path. Static guards are
proven copy-free, dynamic guards still use an owned copy surface, and default
guard probing reuses that copied guard across both `default()` states. Ruleset
call and ordinary mixin body clones reuse childless source-free scalar leaves;
the rules containers and non-leaf nodes still get owned eval surfaces. Detached
ruleset unlock is covered as an intentionally shallow clone boundary. Merged
declaration composition now uses the shared reusable-leaf copy traversal, so
source-free scalar leaves are not copied again while the output still gets its
own list/sequence/rules containers. In `packages/core/src/tree/reference.ts`,
`preserveRulesLike` variable
references now return the shallow owned rules-like wrapper directly; do not
reintroduce a deep copy there. Childless static fallback values with no source
location also resolve directly; copied fallback and declaration reference
containers keep an owned surface while reusing source-free scalar leaves.
Source-backed fallbacks, defaults, and non-leaf nodes still use the defensive
copy path. Merged declaration reference
flattening also reuses the copied value leaves it is handed instead of copying
them again, and merged declaration references normalize the already-owned
evaluated value directly instead of making one more result copy. Post-eval
merged declaration coalescing in `packages/core/src/tree/rules.ts` now keeps
accumulated values read-only and lets merge composition own the copy boundary
instead of recopying stored/list-flattened leaves. The `Call.evalNode`
`sourceNode.parent` repair is still active because the detached-ruleset
non-leaky scope test fails without it. In `packages/core/src/tree/call.ts`,
ordinary JS functions with explicit empty positional arg lists no longer copy
the empty `List`; copied positional and callback arg containers now reuse
source-free scalar leaves while keeping an owned arg-list surface. Plain string
CSS calls now build evaluated `resolve(context)` output directly instead of
deep-cloning the whole call first; nested argument containers still get a local
copied eval surface when needed so source argument containers stay canonical.
Derived empty mixin wrapper surfaces in
`packages/core/src/tree/rules.ts` are constructed directly instead of
shallow-cloning non-empty body rules and clearing them, avoiding parent churn on
cloned body children while preserving rule options and function registry
ownership. `$for` aggregate and zero-iteration output wrappers in
`packages/core/src/tree/control.ts` are also constructed directly now; the
per-iteration body wrapper still uses the existing shallow wrapper path because
it owns the live-slot `ScopeFrame` for that iteration. Source-free scalar
`$for` iteration values bind without being copied or cloned first.

## Work Loop

1. Pick one production seam from `README.md`.
2. Read the relevant source and focused tests before editing.
3. Make the smallest behavior-preserving change.
4. Run the focused proof first.
5. Run the nearest broader verification.
6. Commit and push when the checkpoint is clean.
