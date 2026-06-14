# Core Architecture Handoff

This is the active runbook for Jess core architecture work. Keep it short:
enough to make the next LLM choose the right work, and no more.

Use the doc split:

- `HANDOFF.md`: current focus, active queue, gates, and handoff discipline.
- `AGGRESSIVE-CUTTING-REVIEW.md`: patch-shape rules and rejection criteria.
- `PERFORMANCE-HANDOFF.md`: benchmark protocol and performance evidence.
- `NODE-REWRITE-TRACKER.md`: node-family rewrite status.
- `BINDING-INDEX-PROPOSAL.md`: binding/index design target.

## Focus

Active mode: **registryless lookup and binding slimming**.

This worktree is for deleting registry-style lookup plumbing and simplifying
`Rules.find*`, direct declaration lookup, callable lookup, reference handles,
and `ScopeFrame` binding paths. Do not switch to serialization, selector,
render/materialization, node-copy, or broad cutting work unless the user
explicitly redirects the branch.

Goal:

- one canonical source tree;
- direct tree/frame lookup instead of a separate lookup registry;
- live binding state and static binding buckets where they remove lookup work;
- cold materialization only for public APIs or real semantic ownership;
- fewer hot-path objects, arrays, scans, helper calls, and fallback bridges.

Do not preserve an unreleased or self-invented public-looking lookup method
for compatibility alone. If repo usage does not need it and the user has not
approved it as API, delete or reshape it.

## Working Rules

- Work from repo evidence first.
- A "full queue pass" means all active queue items below, not one micro-edit.
- Queue items must be whole tasks. Do not create one-line queue items.
- Before ending a pass, seed the next queue with real binding/lookup tasks.
- Keep completed history out of this file. Replace old done items with a short
  baseline note only when it helps the next worker.
- Use focused tests while iterating, then run gates before commit.
- Claim speed only from proper before/after measurement. One-iteration
  hotpath runs are smoke only.
- Commit and push after a completed queue pass. Use `--no-verify` for commit
  and push in this branch because hooks have previously looped.

## Current Architecture Baseline

Registryless lookup is the active runtime direction.

- Covered simple callable lookup should resolve from `ScopeFrame` or direct
  `Rules` lookup and return hit or miss without registry fallback.
- Uncovered or complex shapes may route to direct tree search, but each bridge
  needs a deletion condition.
- Direct declaration lookup is per `Rules` and per key. It skips dynamic and
  `setDefined` declaration names until promotion/registration makes them safe.
- Callable lookup coverage is key-specific. An unprepared callable key is
  `uncovered`; a prepared key with no hits is a covered miss.
- Reference lookup carries prepared target shape when the target `Rules`
  identity is known.
- Current miss sentinel: `null` inside existing direct declaration and
  callable lookup maps means the key was prepared and missed. Absent key means
  uncovered.
- Current prepared shape helper:
  - `prepareRulesLookupShape(...)`

Recent baseline commit: `054fc959` trimmed this handoff to active guidance.
Latest pass moved callable miss coverage onto `ScopeFrame`, removed the dead
direct-declaration uncovered sentinel, and narrowed fully indexed callable
child-surface checks. Last full gate smoke was usable but not a speed claim:
`mixins-guards.less` `28.20ms`, `scope-lookup-stress.less` `88.23ms`.
Current pass collapses current binding wrappers into direct `BindingCell`
entries, deletes Reference declaration pass-through wrappers, and skips a
terminal mixin-only exact-ruleset namespace probe.
Current pass makes direct declaration recursion state lazy, reads runtime live
ownership from the current binding cell, and avoids a namespace remainder array
for two-segment mixin namespace descent.
Current pass narrows parent-cycle tracking to scalar-first state, removes
`@arguments` live-slot map lookups, and reuses existing no-parent callable
options in namespace descent.

## Active Queue

Complete every item in this queue before committing the next pass.

7eu. [ ] Direct declaration parent-state scalarization follow-up.
Scope: `findDeclarationWithStrategy(...)`, fallback traversal, readonly
propagation, and parent-step preservation.
Goal: determine whether the scalar-first parent tracker can also avoid Set
promotion for the common two-scope parent case without weakening circular
protection.
Acceptance: parent/fallback circular protection, fallback-frame, source-order,
readonly, property/variable tests, lint, builds, aggressive review.

7ev. [ ] ScopeFrame live-slot storage ownership audit.
Scope: `liveSlotsByName`, `currentBindingsByName`, `BindingCell.live`,
`resetDerivedState(...)`, configured imports, and callable scope wiring.
Goal: choose the next safe reduction in dual live-slot storage, or document the
remaining semantic owner that requires `liveSlotsByName` as a separate map.
Acceptance: mixin params, `@arguments`, import configured variables, iteration
vars, readonly assignment, snapshot/live reads, clone/derive tests, lint,
builds, aggressive review.

7ew. [ ] Callable namespace union-copy audit.
Scope: compound-prefix union, namespace mixin descent, `resolvedOwned`,
`compoundUnionOwned`, and cached callable result ownership.
Goal: remove or narrow one result-array copy in namespace lookup without
mutating cached/shared result arrays or changing namespace/ruleset precedence.
Acceptance: namespace, recursive namespace, compound-prefix, terminal
mixin-only, ruleset namespace with args, import/reference tests, lint, builds,
aggressive review.

## Backlog Sources

When the active queue is empty, pull the next binding/lookup task from:

- `BINDING-INDEX-PROPOSAL.md` for the larger binding-index migration agenda.
- `PERFORMANCE-HANDOFF.md` for measured lookup/profile follow-ups.
- `AGGRESSIVE-CUTTING-REVIEW.md` for rejected patch shapes to avoid.

Keep only the selected next tasks here. Do not copy backlog history or old
evidence into this file.

## Gates

Use focused commands first. Current usual focused set:

```sh
pnpm exec eslint packages/core/src/tree/util/direct-rules-lookup.ts packages/core/src/tree/reference.ts packages/core/src/tree/rules.ts packages/core/src/tree/scope-frame.ts
pnpm --filter @jesscss/core exec vitest src/tree/__tests__/reference.test.ts src/tree/__tests__/mixin.test.ts src/tree/__tests__/call.test.ts src/tree/__tests__/rules.test.ts src/tree/__tests__/import-style.test.ts src/tree/__tests__/control.test.ts --run --testNamePattern "leaky|function|fallback|static function binding|static callable binding|mixin-ruleset calls with args|namespace fast path|ScopeFrame callable buckets|terminal mixin-only|rulesVisibility|readonly|findAnyDeclaration|iteration vars|import|nested mixin-ruleset|recursive namespace|callable cache|handle|ruleset path|compound-prefix|namespace union|source-order|property|variable|semanticFilter|dynamic|setDefined|ambient" --reporter=dot
```

Before commit, run:

```sh
rg -n "ReferenceLookupOptions|registryless|registry-utils|register\\('function'|findFunctionDirect|ReferenceFindOptions|stale registry|registry-backed|registry can find|findDeclaration\\([^,]+, undefined|Parameters<Rules\\['findMixinsFast'\\]>|RULES_LOOKUP_ADAPTERS|\\bRulesLookupAdapter\\b|lookupFunctionReference|lookupCallableReference|currentFrameHasNoMixinChildSurface|buildDeclarationReferenceLookupOptions|buildCallableReferenceLookupOptions" packages/core/src packages/jess-plugin-less/src packages/language-service/src packages/scss-parser/test/baseline.test.ts
git diff --check
pnpm --filter @jesscss/core build
pnpm run verify:aggressive-cutting-review
pnpm run audit:node-creation
pnpm --filter jess build
pnpm run measure:less:hotpath -- --fixture tests-unit/mixins-guards/mixins-guards.less --fixture scripts/fixtures/less-hotpath/scope-lookup-stress.less --iterations 1
```

Use `pnpm run verify:baseline -- --changed` when the touched area needs a
broader fixture gate.

## Handoff Update Rule

At the end of a pass:

1. Replace completed queue items with one concise baseline note if needed.
2. Seed only the next active binding/lookup queue.
3. Keep this file small. Pointers to backlog docs are good; copied backlog
   content is not. If old evidence matters, put it in the commit or
   `PERFORMANCE-HANDOFF.md`, not here.
4. Keep `Aggressive Cutting Self-Prosecution` to the latest pass only.

## Aggressive Cutting Self-Prosecution

- Latest pass: parent-cycle scalar state and live-slot lookup trim.
- Verdict: accepted as binding/lookup cleanup, not as a speed claim.
- New traversal: no new recursion. `@arguments` still loops its param cells, but
  now reads a carried cell array directly instead of looking each one up by name
  in `liveSlotsByName`.
- New node/materialization: no nodes. `paramCells` is deferred binding-slot
  state for `@arguments`; it reuses the same `BindingCell` objects stored in the
  live-slot map and replaces later per-argument map lookups.
- Render path: unchanged.
- Helper/API surface: none added.
- Metadata mutations: none. The runtime initial-target check now reads
  `currentBindingsByName.get(key)?.live` instead of probing `liveSlotsByName`.
- Allocation changes: parent-cycle tracking stays scalar for one-scope lookups
  and promotes to a `Set` only on the second distinct parent/fallback surface.
  Callable namespace descent reuses existing `searchParents:false` options
  instead of cloning an equivalent options object.
- Evidence: focused lint passed; focused lookup suite passed (`6` files,
  `306` passed, `272` skipped). Affected reference/scope/mixin/live-slot subset
  passed (`4` files, `42` passed, `256` skipped). Binding residue grep and
  `git diff --check` passed; `@jesscss/core` build passed with only the
  existing `js-expr.ts` direct-eval warning; aggressive review passed with
  documented scoped danger tokens; node-creation audit passed; `jess` build
  passed; one-iteration hotpath smoke passed with usable signal:
  `mixins-guards.less` `27.37ms`, `scope-lookup-stress.less` `81.52ms`. No
  speed claim is made.
