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
Current pass keeps direct declaration parent-cycle tracking scalar through two
distinct surfaces, audits live-slot map ownership, and tags callable namespace
prefix results with ownership so union append only copies shared/cached arrays.
Current pass propagates callable namespace result ownership through recursive
mixin descent, collapses duplicated direct declaration parent/fallback loops,
and documents `liveSlotsByName` as construction/clone ownership state rather
than the ordinary read path.
Current pass stops caching arrays materialized from scope-frame callable
buckets, moves production live-slot presence checks to `ScopeFrame.hasLiveBindings`,
and keeps recursive direct declaration visited state scalar through two surfaces.
Current pass stops caching direct `findMixinsFast(...)` arrays, centralizes
live-slot owner map cloning behind `copyLiveBindingSlots(...)`, and stores
terminal direct declaration cache states without copying them.

## Active Queue

Complete every item in this queue before committing the next pass.

7fg. [ ] Callable path cache ownership.
Scope: array-key `findMixin(...)`, `findRulesetNamespacePathFast(...)`,
`findMixinNamespacePathFast(...)`, compound-prefix union, and
`lastCallableLookupValue`.
Goal: stop caching one path result that is known owned, or mark path cache
values as shared so later union/append code never has to infer ownership.
Acceptance: namespace, recursive namespace, compound-prefix, terminal
mixin-only, ruleset namespace with args, static callable binding, lint, builds,
aggressive review.

7fh. [ ] Live-slot owner-map mutation narrowing.
Scope: `liveSlotsByName`, `setScopeFrameLiveBinding(...)`, configured imports,
loop/control live bindings, callable scope wiring, clone/derive, and tests that
inspect live slots.
Goal: move one remaining direct mutation/read of `liveSlotsByName` behind a
construction/update API without changing ordinary reads through
`currentBindingsByName`.
Acceptance: mixin params, `@arguments`, import configured variables, iteration
vars, readonly assignment, snapshot/live reads, clone/derive tests, lint,
builds, aggressive review.

7fi. [ ] Direct declaration state object follow-up.
Scope: `MatchState`, `createEmptyState(...)`, `mergeMatch(...)`, recursive cache
storage, readonly propagation, and optional/public candidate handling.
Goal: collapse one `MatchState` allocation or prove the state object is the
smallest safe carrier for public/optional/readonly results across recursion.
Acceptance: parent/fallback circular protection, fallback-frame, source-order,
readonly, property/variable tests, lint, builds, aggressive review.

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

- Latest pass: callable/direct declaration cache narrowing.
- Verdict: accepted as binding/lookup cleanup, not as a speed claim.
- New traversal: none.
- New node/materialization: no nodes. New helper `copyLiveBindingSlots(...)`
  centralizes existing live-slot map clones for construction/clone ownership.
  Direct declaration cache writes now store the terminal `MatchState` object
  directly; each write is immediately followed by return, so the cached object is
  no longer mutated after storage.
- Render path: unchanged.
- Helper/API surface: one internal live-slot copy helper; it replaces repeated
  direct `new Map(liveSlots...)` clones in rules, imports, and callable scope
  wiring.
- Metadata mutations: none.
- Allocation changes: direct `findMixinsFast(...)` result arrays are no longer
  stored in `lastCallableLookupValue`; misses still clear the last cache key.
  Direct declaration cache writes no longer allocate a copied `MatchState`.
- Evidence: focused lint passed; focused lookup suite passed (`7` files,
  `306` passed, `272` skipped). Affected reference/scope/mixin/live-slot subset
  passed (`4` files, `42` passed, `256` skipped). Residue grep and
  `git diff --check` passed. `@jesscss/core` build passed with only the existing
  `js-expr.ts` direct-eval warning. Aggressive review passed with documented
  scoped danger tokens; node-creation audit passed; `jess` build passed.
  One-iteration hotpath smoke passed with usable signal:
  `mixins-guards.less` `24.65ms`, `scope-lookup-stress.less` `75.77ms`. No
  speed claim is made.
