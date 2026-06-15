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
  `Rules` lookup and return hit or miss without old lookup bridges.
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
Recent passes moved simple callable/declaration lookup toward `ScopeFrame` and
direct `Rules` search, removed old lookup bridges from covered paths, and
stopped caching arrays produced by direct callable lookup.
Latest pass deletes the dead last-callable cache surface, removes the raw
`copyLiveBindingSlots(...)` helper, keeps live binding writes synchronized
through `setScopeFrameLiveBinding(...)`, and names immutable direct-declaration
miss states separately from mutable traversal state.
Current passes store declaration occurrence identity inside direct declaration
cache records, share those occurrence records with reference handles, delete
the dead `RuntimeVarBinding` model, and use callable frame facts for guarded
and recursive namespace paths before direct crawl.
Latest passes make direct Rules/index and variable reference fallback return
declaration occurrences, delete the unreachable direct `Rules` target branch,
move selector attribute and setDefined internals off node-returning lookup
helpers, move function return lookup to occurrences, and consume
parent/fallback callable covered misses before direct crawl.
Variable reference handles now have a variable-specific cached value type that
excludes bare nodes.
Reference result types are split by lookup family: declaration/property
references return declaration occurrences, variable references return live
binding handles or declaration occurrences, callable references return callable
families, and direct target/index lookup is the only remaining broad node
result lane. `Rules.find*` is now the cold node-materialization edge for direct
declarations; `direct-rules-lookup.ts` exports occurrence-returning helpers
only.
Rules lookup handles now use a generic cached-miss sentinel; the scope-frame
variable miss sentinel is only for live variable lookup. Reference lookup now
selects a lookup-family strategy once and uses that for rules lookup and handle
write validation. Callable frame uncovered results carry `frame`, `key`, or
`child-surface` reason; direct callable crawl is gated to child-surface state.
Reference lookup strategy selection is cached on the `Reference` node and
guarded by the current lookup type. Callable namespace lookups now treat
non-child-surface uncovered frame results as covered misses instead of falling
through to direct crawl.
The reference strategy cache now uses a single node slot; the strategy object
carries its own lookup type for stale-type checks.
Last full gate smoke was usable but not a speed claim:
`mixins-guards.less` `30.37ms`, `scope-lookup-stress.less` `84.79ms`.
Latest queue pass finished the prior handle/callable/direct-declaration queue:
new source changes added public `Rules.findVariable` cold-path proof for
covered variable handles and deleted dead handle writer call fields after
`handleAccess` became the selected shape. Existing production tests/code
covered the remaining stale items: separate callable miss surface facts,
no-frame child-surface pruning, dynamic pending promotion, array-path handle
identity, and registryless public `Rules.find*` cold paths.
Current queue pass moved readonly assignment lookup off option mutation,
deleted redundant callable frame-coverage writes, and purged stale registry
fallback wording from the active handoff. Items that require broader semantic
modeling were carried forward as new concrete tasks below.

## Active Queue

Complete every item in this queue before committing the next pass.

7iq. [ ] Dynamic pending declaration coverage gets an affected-key model.
Scope: `ScopeFrame.pendingDeclarationNames`, interpolated/static promotion, and
static miss tests.
Goal: unaffected static-key misses stop without broad uncovered fallback while
affected or unknown dynamic names remain conservative.
Acceptance: tests cover unaffected miss, affected unresolved name, and
promotion.

7ir. [ ] Callable reference-import visibility becomes a frame fact.
Scope: `_hasReferenceImports`, callable miss coverage, import/reference tests.
Goal: covered callable misses should not enter direct crawl just to rediscover
reference import surfaces.
Acceptance: direct-crawl spy around reference-import callable miss.

7is. [ ] Guarded callable uncertainty has a named uncovered reason.
Scope: `ScopeFrameCallableLookupResult`, guarded mixins/rulesets, callable
tests.
Goal: distinguish guard/candidate uncertainty from child-surface uncertainty.
Acceptance: guarded cases route uncovered; unguarded misses skip bridge.

7it. [ ] Parameterized namespace handles prove terminal mixin-only reuse.
Scope: callable reference handles, `terminalMixinOnly`, namespace call tests.
Goal: repeated parameterized namespace calls reuse handles only for matching
terminal mode.
Acceptance: wrong-mode handle rejected; same-mode repeated call skips lookup.

7iu. [ ] Array-path callable handles avoid repeated remainder construction.
Scope: `collectKeyRemainder(...)`, `getCallableLookupKeyRemainder(...)`, and
namespace handle tests.
Goal: stable array-path handles carry enough identity to avoid repeated
remainder work after warmup.
Acceptance: counter/spy proof or emitted no-op proof.

7iv. [ ] Handle access allocation shape gets a keep/delete decision.
Scope: `getRulesLookupHandleAccess(...)`, read/write call sites, emitted
output, and hotpath smoke.
Goal: decide whether the transient access object should become scalar locals or
strategy-specific read/write paths.
Acceptance: emitted/benchmark evidence; no speed claim without stable signal.

7iw. [ ] Direct declaration strategy branching gets a measured target.
Scope: `DeclarationLookupStrategy`, `findWithinScopeSurface(...)`, and
diagnostic profile counters.
Goal: decide which strategy/filter branches are hot enough to split.
Acceptance: profile/counter evidence recorded before source churn.

7ix. [ ] Function binding invalidation is key-scoped or proven global.
Scope: `setFunctionBinding(...)`, reference handles, function tests.
Goal: avoid invalidating unrelated function handles unless global invalidation
is required.
Acceptance: keyed invalidation or no-op proof with tests.

7iy. [ ] Assignment target lookup tries modeled current cells first.
Scope: `assignScopeFrameVariable(...)`, set-defined eval, readonly tests.
Goal: covered static `:=` writes should mutate current cells before source
occurrence fallback.
Acceptance: spy proves occurrence lookup is skipped for modeled cells.

7iz. [ ] Direct declaration child traversal gets unrelated-surface spy proof.
Scope: `directDeclarationChildEntries`, `canEnterRulesEntryForLookup(...)`, and
declaration child tests.
Goal: carried visibility should prevent entering child rules that cannot
contain the requested declaration family.
Acceptance: focused spy test.

7ja. [ ] ScopeFrame callable bucket preparation avoids redundant cache writes.
Scope: `prepareCallableLookupFrame(...)`, `getCallableEntriesForKey(...)`, and
emitted output.
Goal: prove the early-return shape stays smaller/cleaner after build.
Acceptance: emitted audit plus focused callable tests.

7jb. [ ] Benchmark leash is refreshed for the next hot lookup target.
Scope: `PERFORMANCE-HANDOFF.md`, hotpath fixtures, lookup smoke/profile.
Goal: pick the next measured lookup target from current counters.
Acceptance: target and command recorded without smoke speed claims.

7jc. [ ] Property merge-chain occurrence slots are designed before coding.
Scope: `BINDING-INDEX-PROPOSAL.md`, property lookup, merge-chain tests.
Goal: avoid adding a second registry-like map for merge-chain properties.
Acceptance: design note with deletion condition and test target.

7jd. [ ] Import/reference declaration visibility becomes an explicit direct
lookup mode.
Scope: import/reference declaration lookup options and import tests.
Goal: stop using fallback side effects to rediscover visibility.
Acceptance: focused import/reference declaration tests and fallback spy.

7je. [ ] Performance handoff stale registry language is split into historical
versus active sections.
Scope: `PERFORMANCE-HANDOFF.md`.
Goal: keep historical registry evidence while preventing active guidance from
suggesting deleted registry paths still exist.
Acceptance: active sections use current direct/frame terminology.

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
rg -n "ReferenceLookupOptions|registryless|registry-utils|register\\('function'|findFunctionDirect|ReferenceFindOptions|stale registry|registry-backed|registry can find|findDeclaration\\([^,]+, undefined|Parameters<Rules\\['findMixinsFast'\\]>|RULES_LOOKUP_ADAPTERS|\\bRulesLookupAdapter\\b|lookupFunctionReference|lookupCallableReference|currentFrameHasNoMixinChildSurface|buildDeclarationReferenceLookupOptions|buildCallableReferenceLookupOptions|lastCallableLookup|copyLiveBindingSlots" packages/core/src packages/jess-plugin-less/src packages/language-service/src packages/scss-parser/test/baseline.test.ts
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

- Latest pass: readonly assignment lookup now reads explicit direct-declaration
  lookup state instead of a mutated options out-param; callable frame
  preparation skips redundant coverage writes once key/mode coverage is known;
  active handoff wording no longer describes covered lookup as registry
  fallback work; the next queue was reseeded with remaining real tasks.
- Verdict: accepted as binding/lookup cleanup, not as a speed claim.
- New traversal: none.
- New node/materialization: none.
- Render path: unchanged.
- Helper/API surface: two occurrence-plus-readonly direct lookup helpers were
  added for assignment, while assignment stopped relying on mutation of
  `DeclarationFindOptions`. No public API was added.
- Metadata mutations: none.
- Allocation changes: no nodes or materialized lookup-result arrays added. The
  typed direct lookup result object replaces an options out-param for assignment
  lookup; this pass does not claim allocation reduction.
- Aggressive-review tokens: the typed direct lookup result object is semantic
  lookup state for readonly propagation. The assignment lookup options object
  replaces the prior mutable local options object and is not a new traversal or
  materialized lookup result.
- Evidence: focused eslint passed. Focused lookup tests passed (`6` files,
  `306` passed, `285` skipped). Residue grep had no matches; `git diff
  --check`, `@jesscss/core` build, aggressive review with scoped danger tokens
  prosecuted, node-creation audit, `jess` build, and
  one-iteration hotpath smoke all passed. Smoke was usable but not a speed
  claim: `mixins-guards.less` `30.37ms`, `scope-lookup-stress.less` `84.79ms`.
