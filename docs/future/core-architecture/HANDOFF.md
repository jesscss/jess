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
- Do not call a pass complete after one or a few queue items. If any active
  queue item remains unfinished at wrap-up, explicitly explain in the handoff
  and final response why it was not finished and why you could not immediately
  continue into it before stopping.
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
Current queue pass folds pending dynamic declaration collection into
`prepareScopeFrameDeclarationIndex(...)`, so cold scope-frame declaration prep
does not rescan `Rules.value` just to populate `pendingDeclarationNames`.
An attempted child-entry no-surface shortcut was rejected by import/optional
scope tests because `hasDirectChildRuleSurface` is not yet a complete proof for
all prepared/imported child surfaces. The refreshed stress profile still points
at direct declaration child-entry work: `declaration.cacheMiss` `16560`,
`declaration.childEntryEntered` `11520`, and
`declaration.childEntriesScanned` `10530`.
Latest queue pass makes scope-frame variable lookup key-aware for unresolved
declaration-name state. Static unresolved declaration names now only uncover
lookups for their own key; unrelated misses can stay covered. Still-dynamic
names remain conservative and uncover lookup because resolving them belongs to
registration/eval, not `ScopeFrame` lookup.
Current queue pass makes resolved dynamic-name promotion invalidate direct
declaration bucket/cache state by resolved key instead of dropping all direct
declaration maps. `Rules.lookupVersion` still increments because reference
handles are versioned at the whole-rules level.
Latest queue pass splits function binding versioning from broad
`Rules.lookupVersion`. Function handles now compare against per-function-key
versions, so unrelated declaration/callable changes and unrelated function
registrations do not invalidate cached function handles.

## Active Queue

Complete every item in this queue before committing the next pass.

1. [ ] Split guarded callable candidate uncertainty from child/reference
uncertainty. Scope: guarded mixins/rulesets,
`ScopeFrameCallableLookupResult`, and direct crawl bridges. Goal: guarded
candidates route conservatively without poisoning covered child-surface
misses. Acceptance: guarded uncovered reason plus unguarded covered miss tests.

2. [ ] Reuse callable namespace remainders for array-path handles. Scope:
`collectKeyRemainder(...)`, `getCallableLookupKeyRemainder(...)`, and
array-key mixin references. Goal: warm namespace lookup should not rebuild the
same remainder arrays/strings. Acceptance: counter or spy proof on repeated
array-path lookup.

3. [ ] Split or delete handle-access object allocation. Scope:
`getRulesLookupHandleAccess(...)`, reference handle write/read sites, and
stress profile counters. Goal: remove transient access objects when scalar
locals or existing handle fields are simpler. Acceptance: measured/audited
before-after note; no speed claim without stable signal.

4. [ ] Try assignment through modeled current cells before occurrence fallback.
Scope: `assignScopeFrameVariable(...)`, `setDefined` eval, readonly cells, and
declaration occurrence fallback. Goal: covered `:=` writes mutate modeled
cells without source lookup when readonly semantics are represented.
Acceptance: occurrence spy proves the covered current-cell path skips direct
declaration lookup.

5. [ ] Add explicit direct declaration visibility mode for imports/reference.
Scope: declaration lookup options, reference imports, compose/import
boundaries, and direct child entries. Goal: direct lookup should carry
visibility facts instead of rediscovering them through fallback behavior.
Acceptance: focused import/reference declaration matrix plus fallback spy.

6. [ ] Implement property merge-chain occurrence slots. Scope: property
declaration occurrences, merge metadata, assignment normalization, and property
lookup tests. Goal: delete remaining filtered property fallback without adding
a second name registry. Acceptance: merge-chain fixtures resolve by direct
occurrence lookup.

7. [ ] Prove reference-import callable boundary for namespace lookups. Scope:
reference imports, namespace callable lookup, fallback frames, and covered
misses. Goal: reference-import uncertainty remains conservative but does not
poison covered frame/key misses. Acceptance: namespace/fallback spy tests.

8. [ ] Carry reference-import facts without recursive child-body scans. Scope:
`rulesMayContainReferenceImports(...)`,
`prepareScopeFrameDeclarationIndex(...)`, reference-mode child `Rules`, and
style imports. Goal: carry/adopt the fact once instead of recursively
rediscovering it during lookup prep. Acceptance: focused reference-import
tests plus traversal spy/counter.

9. [ ] Narrow callable miss coverage recomputation to callable callers only.
Scope: `getScopeFrame(..., false)`, `prepareCallableLookupFrame(...)`, and
callable miss coverage flags. Goal: variable lookup never computes callable
coverage; callable lookup computes it once per needed key/frame. Acceptance:
spy tests for both paths.

10. [ ] Replace positive direct child-entry arrays with sparse carried facts.
Scope: `directChildRuleEntries`, `directDeclarationChildEntries`,
`hasExact*ChildSurface`, and lookup child-entry scans. Goal: avoid building
entry arrays for scopes where per-type child-surface facts can prove the
requested lookup cannot enter. Acceptance: child surface tests plus direct
lookup counter comparison.

11. [ ] Collapse direct declaration strategy object branching. Scope:
`DeclarationLookupStrategy`, `findWithinScopeSurface(...)`, and
variable/property/any declaration callers. Goal: assign lookup functions once
per path instead of branching on strategy fields in the inner crawl.
Acceptance: focused tests plus direct lookup counter comparison.

12. [ ] Audit and thin cold `Rules.find*` node-materialization wrappers.
Scope: `Rules.findDeclaration`, `findVariable`, `findProperty`,
`findAnyDeclaration`, call sites, and package exports. Goal: keep only the
cold materialization edges repo usage needs, without compatibility-only
wrappers. Acceptance: rg-backed call-site audit plus focused tests.

13. [ ] Add declaration child-surface bit facts by lookup family. Scope:
child `Rules` registration, `rulesVisibility`, variable/property lookup, and
`collectDirectDeclarationChildEntries(...)`. Goal: skip child surfaces that
cannot contain the requested declaration family before entry allocation.
Acceptance: variable/property child-surface spy tests plus stress counters.

14. [ ] Split declaration/property handle versioning by lookup key or prove
global versioning is required. Scope: `ReferenceRulesLookupHandle`,
`Rules.lookupVersion`, direct declaration cache keys, variable/property handle
writes, and dynamic-name promotion. Goal: affected declaration invalidation
should not invalidate unrelated declaration/property handles unless a semantic
dependency proves it must. Acceptance: handle stale/fresh tests for affected
and unaffected declaration keys.

15. [ ] Split callable handle versioning by callable key or prove global
versioning is required. Scope: callable lookup handles,
`callableLookupCache`, child-surface invalidation, and `Rules.lookupVersion`.
Goal: unrelated declaration/function writes should not invalidate callable
handles when callable surfaces are unchanged. Acceptance: stale/fresh tests
for affected and unaffected callable keys.

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
2. If any active queue item was not completed, record a short explicit
   unfinished-item exception: which item remains, what blocked immediate
   continuation, and why stopping was necessary.
3. Seed only the next active binding/lookup queue. Do not reseed in a way that
   hides unfinished active queue work.
4. The new active queue must contain exactly 15 real binding/lookup tasks,
   numbered `1` through `15`; reseeding itself is not a queue item.
5. Keep this file small. Pointers to backlog docs are good; copied backlog
   content is not. If old evidence matters, put it in the commit or
   `PERFORMANCE-HANDOFF.md`, not here.
6. Keep `Aggressive Cutting Self-Prosecution` to the latest pass only.

## Aggressive Cutting Self-Prosecution

- Latest pass: split function reference handle invalidation onto per-function
  key versions. `setFunctionBinding(...)` no longer increments
  `Rules.lookupVersion`; it bumps a function version lane and the specific
  registered function key.
- Verdict: accepted as key-scoped handle invalidation for function lookups, not
  as a speed claim.
- New traversal: none.
- New node/materialization: none.
- Render path: unchanged.
- Helper/API surface: two private handle-version helpers were added inside
  `reference.ts`; no public API was added.
- Metadata mutations: `Rules` now tracks `functionLookupVersion` plus
  `functionLookupVersionsByName`. Function binding registration mutates only
  those function lanes and the existing function map.
- Allocation changes: function-version maps are allocated only when functions
  are registered through `setFunctionBinding(...)`, which already allocates or
  mutates the function binding map.
- Rejected/failed proof: declaration/property and callable handles still use
  broad `lookupVersion`; those remain separate queue items because they need
  affected-key semantic tests for declaration/callable surfaces.
- Aggressive-review tokens: current diff adds no production traversal. The
  flagged maps are explicit function binding version state and are tied to
  `setFunctionBinding(...)`, not ordinary variable/property lookup.
- Evidence: focused eslint passed for touched lookup files/tests. Focused
  function-handle tests passed (`2` files, `7` passed, `226` skipped). The
  focused lookup gate passed (`8` files, `320` passed, `295` skipped). Stale
  registry/lookup wording search returned no matches. `git diff --check`,
  `@jesscss/core` build, aggressive review, node-creation audit, `jess` build,
  stress profile, and hotpath smoke passed. Node-creation audit is now
  `new-node: 305`, `with-surface: 39`, `derive: 30`, `copy-leaves: 28`; the
  increase is the function-version map state. Stress profile reported
  unchanged direct lookup counters led by `declaration.cacheMiss` `16560`,
  `declaration.childEntryEntered` `11520`, and
  `declaration.childEntriesScanned` `10530`; `Reference.evalNode` was `6528`
  calls / `65.56ms`. One-iteration hotpath smoke is not a speed claim:
  `mixins-guards.less` `31.05ms`, `scope-lookup-stress.less` `81.69ms`.
