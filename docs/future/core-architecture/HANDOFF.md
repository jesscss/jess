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

`_indexRules()` is legacy lookup-indexing debt. Do not add new lookup
dependencies on it. Runtime lookup should crawl the canonical tree directly
and consult evaluated/live binding state only when that state already exists.

## Working Rules

- Work from repo evidence first.
- A "full queue pass" means all active queue items below, not one micro-edit.
- Queue items must be whole tasks. Do not create one-line queue items.
- Before ending a pass, seed the next queue with exactly 15 real
  binding/lookup tasks.
- Queue numbering is always plain `1` through `15`. Do not preserve old queue
  IDs, ticket-like labels, or historical numbering.
- Reseeding the next queue is mandatory closeout work, not one of the 15 queue
  items.
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
Latest queue pass names callable reference-import uncertainty as a
`ScopeFrame` fact, keeps that path conservative instead of treating it as a
covered child-surface miss, proves direct property lookup skips child rules
whose visibility cannot contain properties, refreshes the active lookup
benchmark leash, and records the property merge-chain occurrence-slot target.
Dynamic pending declaration affected-key precision, keyed function invalidation,
assignment current-cell-first writes, and handle allocation splitting remain
larger semantic/measured cuts, not micro-edits.
Latest queue pass adds handle-shape proof for stale lookup-type rejection and
terminal mixin-only rejection, prebuilds the direct property child-visibility
spy so it tests traversal instead of setup, and records that the
`benchmark-v39.less` profile no longer exercises the lookup counters needed
for direct declaration strategy splitting.
Current queue pass removes the broad `_indexRules()` prep from variable
lookup's scope-frame path. `getScopeFrame(..., false)` now builds only the
static variable declaration buckets and cheap reference-import facts needed by
variable lookup, so variable-family child visibility can skip child `Rules`
without indexing or entering their bodies. The pass also adds readonly
provenance coverage for static declaration cells and makes
`profile-less-benchmark.mjs --fixture ... --compat=false` produce lookup
counters for `scope-lookup-stress.less`.
Latest queue pass removes `findFunction(...)`'s `_indexRules()` call because
function lookup is a live/evaluated binding-map parent walk, then adds direct
declaration crawl counters to the lookup stress profile. `_indexRules()` is
now explicitly documented as legacy lookup debt, not the target architecture.
Current queue pass removes the remaining production `_indexRules()` calls from
callable ruleset path helpers. Exact and compound-prefix ruleset namespace
lookup now reverse-scan the current tree and use carried child-surface flags
without building broad indexes.
Latest queue pass deletes the legacy `_indexRules()` method, `_indexing`, and
`rulesIndexed` state entirely. Direct child-surface lookup now relies on direct
tree scans and carried child-surface flags rather than indexed/unindexed
sentinels.

## Active Queue

Complete every item in this queue before committing the next pass.

1. [ ] Key pending dynamic declaration uncertainty by affected name when
possible. Scope: `pendingDeclarationNames`, promoted static names, and
`lookupScopeFrameVariable(...)`. Goal: a pending declaration only uncovers a
miss when it can still affect the requested key. Acceptance: tests for
unaffected miss, promoted static hit, and still-dynamic unresolved name.

2. [ ] Split guarded callable candidate uncertainty from child/reference
uncertainty. Scope: guarded mixins/rulesets,
`ScopeFrameCallableLookupResult`, and direct crawl bridges. Goal: guarded
candidates route conservatively without poisoning covered child-surface
misses. Acceptance: guarded uncovered reason plus unguarded covered miss tests.

3. [ ] Reuse callable namespace remainders for array-path handles. Scope:
`collectKeyRemainder(...)`, `getCallableLookupKeyRemainder(...)`, and
array-key mixin references. Goal: warm namespace lookup should not rebuild the
same remainder arrays/strings. Acceptance: counter or spy proof on repeated
array-path lookup.

4. [ ] Decide whether handle-access objects can become scalar locals. Scope:
`getRulesLookupHandleAccess(...)`, reference handle write/read sites, and
stress profile counters. Goal: remove transient access objects when scalar
state is simpler and measured neutral/better. Acceptance: emitted audit plus
profile note; no speed claim without stable signal.

5. [ ] Make function binding invalidation key-scoped or prove global invalidity.
Scope: `setFunctionBinding(...)`, `lookupVersion`, function reference handles,
and plugin function tests. Goal: unrelated function registrations should not
invalidate cached function hits unless unavoidable. Acceptance: keyed
invalidation or documented failing-proof with tests.

6. [ ] Try assignment through modeled current cells before occurrence fallback.
Scope: `assignScopeFrameVariable(...)`, `setDefined` eval, readonly cells, and
declaration occurrence fallback. Goal: covered `:=` writes mutate modeled
cells without source lookup when readonly semantics are represented.
Acceptance: occurrence spy proves the covered current-cell path skips direct
declaration lookup.

7. [ ] Add explicit direct declaration visibility mode for imports/reference.
Scope: declaration lookup options, reference imports, compose/import
boundaries, and direct child entries. Goal: direct lookup should carry
visibility facts instead of rediscovering them through fallback behavior.
Acceptance: focused import/reference declaration matrix plus fallback spy.

8. [ ] Implement property merge-chain occurrence slots. Scope: property
declaration occurrences, merge metadata, assignment normalization, and property
lookup tests. Goal: delete remaining filtered property fallback without adding
a second name registry. Acceptance: merge-chain fixtures resolve by direct
occurrence lookup.

9. [ ] Prove reference-import callable boundary for namespace lookups. Scope:
reference imports, namespace callable lookup, fallback frames, and covered
misses. Goal: reference-import uncertainty remains conservative but does not
poison covered frame/key misses. Acceptance: namespace/fallback spy tests.

10. [ ] Carry reference-import facts without recursive child-body scans. Scope:
`rulesMayContainReferenceImports(...)`,
`prepareScopeFrameDeclarationIndex(...)`, reference-mode child `Rules`, and
style imports. Goal: carry/adopt the fact once instead of recursively
rediscovering it during lookup prep. Acceptance: focused reference-import
tests plus traversal spy/counter.

11. [ ] Narrow callable miss coverage recomputation to callable callers only.
Scope: `getScopeFrame(..., false)`, `prepareCallableLookupFrame(...)`, and
callable miss coverage flags. Goal: variable lookup never computes callable
coverage; callable lookup computes it once per needed key/frame. Acceptance:
spy tests for both paths.

12. [ ] Replace direct child-entry arrays with carried sparse facts where safe.
Scope: `directChildRuleEntries`, `directDeclarationChildEntries`,
`hasExact*ChildSurface`, and lookup child-entry scans. Goal: avoid building
entry arrays for scopes with no relevant child surface. Acceptance: child
surface tests plus stress counter comparison.

13. [ ] Collapse direct declaration strategy object branching. Scope:
`DeclarationLookupStrategy`, `findWithinScopeSurface(...)`, and
variable/property/any declaration callers. Goal: assign lookup functions once
per path instead of branching on strategy fields in the inner crawl.
Acceptance: focused tests plus direct lookup counter comparison.

14. [ ] Make public cold `Rules.find*` wrappers thinner or delete unused ones.
Scope: `Rules.findDeclaration`, `findVariable`, `findProperty`,
`findAnyDeclaration`, call sites, and package exports. Goal: keep only the
cold materialization edges repo usage needs. Acceptance: rg-backed call-site
audit plus focused tests.

15. [ ] Run a measured direct lookup counter pass after the next source cuts.
Scope: `profile-less-benchmark.mjs`,
`scripts/fixtures/less-hotpath/scope-lookup-stress.less`, and
`PERFORMANCE-HANDOFF.md`. Goal: use direct counters to choose the next
highest-work lookup surface. Acceptance: profile output recorded; one-off
smoke remains explicitly non-speed evidence.

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
3. The new active queue must contain exactly 15 real binding/lookup tasks,
   numbered `1` through `15`; reseeding itself is not a queue item.
4. Keep this file small. Pointers to backlog docs are good; copied backlog
   content is not. If old evidence matters, put it in the commit or
   `PERFORMANCE-HANDOFF.md`, not here.
5. Keep `Aggressive Cutting Self-Prosecution` to the latest pass only.

## Aggressive Cutting Self-Prosecution

- Latest pass: deleted `_indexRules()`, `_indexing`, and `rulesIndexed`, then
  removed direct lookup guards that used indexed/unindexed state as a proxy for
  child-surface facts. `registerNode(...)` now carries nested extend facts
  directly.
- Verdict: accepted as registry/index architecture deletion, not as a speed
  claim.
- New traversal: added `rulesMayContainExtends(...)`, a recursive metadata
  predicate used only when registering child `Rules` so extend render facts
  survive without the broad indexer. Direct lookup traversal did not grow; it
  now scans/caches child entries directly instead of checking `rulesIndexed`.
- New node/materialization: none.
- Render path: unchanged.
- Helper/API surface: deleted `_indexRules()` instead of adding public API.
- Metadata mutations: removed `rulesIndexed` and `_indexing` mutations.
- Allocation changes: none.
- Rejected/failed proof: none so far in this pass.
- Aggressive-review tokens: current diff adds no routine error-control tokens.
  The flagged loops are the new `rulesMayContainExtends(...)` metadata scan and
  the existing child-entry scan now starting from `0` instead of
  `rulesIndexed`. Test-only `rules([])` setup appears in `rules-flags.test.ts`.
- Evidence: focused no-index/child-surface tests passed (`4` files, `23`
  passed, `368` skipped), then the full focused lookup gate passed (`8` files,
  `327` passed, `285` skipped). `rg "_indexRules|_indexing|rulesIndexed"
  packages/core/src packages/jess-plugin-less/src packages/language-service/src
  -g "*.ts"` now reports only no-index assertions in tests. Focused eslint,
  `git diff --check`, aggressive review, `@jesscss/core` build,
  node-creation audit, `jess` build, stress profile, and hotpath smoke passed.
  Node-creation audit improved to `new-node: 302`, `with-surface: 39`,
  `derive: 30`, `copy-leaves: 28`. Stress profile reported
  `Reference.evalNode` `6528` calls / `66.46ms`. One-iteration hotpath smoke
  is not a speed claim: `mixins-guards.less` `24.00ms`,
  `scope-lookup-stress.less` `91.41ms`.
