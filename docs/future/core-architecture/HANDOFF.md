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
Latest queue pass moves variable reference frame prep to
`getScopeFrame(undefined, false)`, splits unconsumed callable candidates from
child/reference-import uncertainty, and makes covered `setDefined`
VarDeclaration writes target the current live/modeled binding cell first. Tree
occurrence lookup is only the fallback for uncovered or unmodeled cases.
The same pass audited cold `Rules.find*` wrappers and found repo usage still
needs them as thin node-materialization edges. A declaration child-surface
family-bit attempt was rejected: it regressed
`rules.test.ts` `"doesn't preserve readonly later"` during registration-time
`setDefined`, so that work must be redesigned around registration-complete
facts rather than kept as a partial optimization.
Current queue pass splits variable lookup parent-frame auto-wiring from
callable coverage prep, keeps `setDefined` live-binding writes from creating
scope frames just to probe modeled state, and versions callable reference
handles on a callable-surface lane instead of broad `Rules.lookupVersion`.
Callable handles now survive unrelated declaration/function writes and go stale
when callable surfaces change. A reference-import recursive-scan cut was
inspected but not attempted because it still crosses registration/import
semantics.

## Active Queue

Complete every item in this queue before committing the next pass.

1. [ ] Replace callable namespace remainder arrays with an offset/path view.
Scope: `collectKeyRemainder(...)`, `getCallableLookupKeyRemainder(...)`,
recursive namespace lookup, and reference callable handles. Goal: avoid
rebuilding remainder arrays/strings end-to-end; do not add a cache map that
costs more than it saves. Acceptance: repeated array-path lookup proof plus
focused namespace tests.

2. [ ] Split or delete handle-access object allocation. Scope:
`getRulesLookupHandleAccess(...)`, reference handle write/read sites, and
stress profile counters. Goal: remove transient access objects when scalar
locals or existing handle fields are simpler. Acceptance: measured/audited
before-after note; no speed claim without stable signal.

3. [ ] Add explicit direct declaration visibility mode for imports/reference.
Scope: declaration lookup options, reference imports, compose/import
boundaries, and direct child entries. Goal: direct lookup should carry
visibility facts instead of rediscovering them through fallback behavior.
Acceptance: focused import/reference declaration matrix plus fallback spy.

4. [ ] Implement property merge-chain occurrence slots. Scope: property
declaration occurrences, merge metadata, assignment normalization, and property
lookup tests. Goal: delete remaining filtered property fallback without adding
a second name registry. Acceptance: merge-chain fixtures resolve by direct
occurrence lookup.

5. [ ] Prove reference-import callable boundary for namespace lookups. Scope:
reference imports, namespace callable lookup, fallback frames, and covered
misses. Goal: reference-import uncertainty remains conservative but does not
poison covered frame/key misses. Acceptance: namespace/fallback spy tests.

6. [ ] Carry reference-import facts without recursive child-body scans. Scope:
`rulesMayContainReferenceImports(...)`,
`prepareScopeFrameDeclarationIndex(...)`, reference-mode child `Rules`, and
style imports. Goal: carry/adopt the fact once instead of recursively
rediscovering it during lookup prep. Acceptance: focused reference-import
tests plus traversal spy/counter.

7. [ ] Replace positive direct child-entry arrays with sparse carried facts.
Scope: `directChildRuleEntries`, `directDeclarationChildEntries`,
`hasExact*ChildSurface`, and lookup child-entry scans. Goal: avoid building
entry arrays for scopes where per-type child-surface facts can prove the
requested lookup cannot enter. Acceptance: child surface tests plus direct
lookup counter comparison.

8. [ ] Collapse direct declaration strategy object branching. Scope:
`DeclarationLookupStrategy`, `findWithinScopeSurface(...)`, and
variable/property/any declaration callers. Goal: assign lookup functions once
per path instead of branching on strategy fields in the inner crawl.
Acceptance: focused tests plus direct lookup counter comparison.

9. [ ] Split declaration/property handle versioning by lookup key or prove
global versioning is required. Scope: `ReferenceRulesLookupHandle`,
`Rules.lookupVersion`, direct declaration cache keys, variable/property handle
writes, and dynamic-name promotion. Goal: affected declaration invalidation
should not invalidate unrelated declaration/property handles unless a semantic
dependency proves it must. Acceptance: handle stale/fresh tests for affected
and unaffected declaration keys.

10. [ ] Split callable handle versioning by callable key if the broad
callable-surface lane proves noisy. Scope: callable lookup handles,
`callableLookupCache`, child-surface invalidation, and
`Rules.callableLookupVersion`. Goal: keep the current callable-surface version
unless measured/profiled evidence shows same-surface unrelated callable writes
are a real invalidation cost. Acceptance: stale/fresh tests for affected and
unaffected callable keys, or a profile note proving broad callable-surface
versioning is the right tradeoff.

11. [ ] Redesign declaration child-surface family facts around registration
completion. Scope: `registerNode(...)`, `_stampRegistrationMaps(...)`,
`collectDirectDeclarationChildEntries(...)`, and registration-time
`setDefined`. Goal: skip variable/property-impossible child surfaces before
entry allocation without regressing `"doesn't preserve readonly later"`.
Acceptance: allocation spy plus that readonly fixture in the focused gate.

12. [ ] Remove duplicate callable cache/frame invalidation writes after
`callableLookupVersion` split. Scope: `registerNode(...)`,
`callableLookupCache`, `_scopeFrame.callable*` flags, and callable handle
tests. Goal: callable-surface writes invalidate exactly the callable state
they must, while declaration-only writes do not pay callable cache churn.
Acceptance: callable handle tests plus focused callable/frame coverage tests.

13. [ ] Make `setDefined` live-binding writes update only live cells when
declaration cells are not semantically current. Scope: `lookupScopeFrameVariable`
options, `setDefined`, declaration cells, loop/mixin live bindings, and
readonly propagation. Goal: keep the current live-binding target crisp and
avoid treating static declaration buckets as an assignment registry when they
are only fallback tree state. Acceptance: loop/mixin live-binding fixtures plus
static readonly/setDefined fixtures.

14. [ ] Convert callable candidate uncertainty into caller-specific decisions.
Scope: `ScopeFrameCallableLookupResult.reason === 'candidate'`, namespace
lookup, terminal mixin-only lookup, and direct bridge gates. Goal: candidate
uncertainty routes through namespace-specific logic without falling into
child-surface or reference-import bridges. Acceptance: namespace candidate and
terminal mixin-only tests.

15. [ ] Refresh the lookup stress profile after the next child-surface or
handle-version cut that touches direct declaration traversal. Scope:
`scripts/profile-less-benchmark.mjs`, `scope-lookup-stress.less`, direct
declaration counters, and hotpath smoke. Goal: compare
`declaration.childEntriesScanned`, `declaration.childEntryEntered`, and
`Reference.evalNode` after a real direct-declaration structural change.
Acceptance: profile output recorded in this handoff or
`PERFORMANCE-HANDOFF.md`; no speed claim from one-iteration smoke.

## Unfinished-Item Exception

This pass did not complete the full active queue. It completed prior items 10,
12, and 13, and item 15 for the callable-handle slice through the required
profile/hotpath smoke. Prior items 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, and 14
remain because they require broader semantic rewrites or measured allocation
work than could be safely finished after the callable/setDefined changes and
focused gate repair. Immediate continuation stopped to run the full gates,
update this handoff honestly, commit, and push a green slice instead of
leaving mixed lookup semantics uncommitted.

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

- Latest pass: split parent-frame callable prep from variable lookup, kept
  `setDefined` live-binding probing off implicit scope-frame creation, and
  versioned callable handles on `Rules.callableLookupVersion`.
- Verdict: accepted as lookup slimming and handle-invalidation reduction, not
  as a speed claim.
- New traversal: none in production. Tests add spies around `getScopeFrame`,
  `Rules.value`, and public lookup methods.
- New node/materialization: none.
- Render path: unchanged.
- Helper/API surface: no public API added. `Rules.callableLookupVersion` is a
  private invalidation lane for callable handles.
- Metadata mutations: callable-surface registration now mutates
  `callableLookupVersion`; declaration/function-only writes do not.
- Allocation changes: variable lookup no longer asks auto-wired parent frames
  for callable coverage, and `setDefined` fallback variable lookup runs with
  `includeLiveBindings: false` so it does not build scope frames to discover
  fallback declarations.
- Rejected/failed proof: reference-import recursive fact carrying remains
  unfinished; the current recursive scan still crosses registration/import
  semantics and needs a focused pass.
- Aggressive-review tokens: the gate found no production danger token in this
  diff. Test-only tokens are `new JsFunction`, three spy `try` blocks, and the
  `callableCoveragePrep` spy array.
- Evidence: focused eslint passed for touched lookup files/tests. Focused
  reference/rules tests passed (`2` files, `11` passed, `213` skipped). The
  broader focused lookup gate passed (`8` files, `327` passed, `295` skipped).
  Stale registry/lookup wording search returned no matches. `git diff
  --check`, `@jesscss/core` build, aggressive review, node-creation audit, and
  `jess` build passed. Node-creation audit remains `new-node: 306`,
  `with-surface: 39`, `derive: 30`, `copy-leaves: 28`. Stress profile on
  `scope-lookup-stress.less` reported direct declaration counters unchanged at
  `declaration.cacheMiss: 16560`, `declaration.childEntryEntered: 11520`,
  `declaration.childEntriesScanned: 10530`; `Reference.evalNode` was `6528`
  calls / `71.14ms`. One-iteration hotpath smoke is not a speed claim:
  `mixins-guards.less` `28.44ms`, `scope-lookup-stress.less` `98.72ms`.
