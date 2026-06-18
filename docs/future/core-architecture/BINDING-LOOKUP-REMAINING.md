# Binding And Lookup Remaining Work

This is the burn-down inventory for the registryless binding/lookup lane. Keep
this file focused on the active binding queue, remaining scope, completion
gates, and short progress notes that change the next worker's decisions.
`HANDOFF.md` is only the cross-focus router.
`FOCII.md` owns the goal-settable focus prompt.

## Focus Contract

This file owns binding/lookup progress. When a chat/session chooses the
binding/lookup focus, start here after reading `HANDOFF.md` and `FOCII.md`. Do
not move this queue back into `HANDOFF.md`, and do not rewrite `HANDOFF.md`
merely to switch focus between binding and serialization branches.

A full queue pass means burn through every currently safe active item below,
not one micro-edit. If the pass must stop before the queue is drained, record
which item remains, what blocked immediate continuation, and why stopping was
necessary. Before committing a pass, leave 15 sizable unchecked binding tasks
unless this lane is genuinely within 15 tasks of completion.

## Scope Correction

The old `DeclarationRegistry`, `MixinRegistry`, core `FunctionRegistry`, and
`_indexRules()` lookup path are no longer the main target. The remaining work
is to delete registry-shaped behavior that survived the migration:

- fallback ladders after a covered binding/frame lookup;
- recursive rediscovery of child/import facts not yet carried by placement
  state;
- broad version invalidation where a key or family version is enough;
- object-heavy handle/result shapes on hot reference reads;
- child-entry scans where carried surface facts can prove a miss;
- cold `Rules.find*` materialization edges that still leak into hot paths.

Do not count a task as complete because the old registry class is gone. Count it
complete only when the covered simple path proves it does not enter the
fallback bridge, direct child scan, broad invalidation lane, or public
materialization wrapper for that semantic case.

## Active Binding Queue

Complete every item in this queue before committing the next binding/lookup
pass unless a semantic blocker, rejected approach, or unsafe test failure
forces a focused stop.

1. [ ] Finish callable retry-frame bridge deletion where retry frames are
covered. Scope: parent/fallback frame loops in `Rules.findMixin`, fallback
frame `prepareCallableLookupFrame`, recursive namespace starts, and
reference-import fallback frames. Goal: covered retry-frame misses do not keep
walking into broad direct crawls, and disabled parent search does not retry
parent/fallback frames after a narrowed current-frame miss. Acceptance:
parent/fallback callable miss spy tests plus existing fallback hit tests.
Current evidence: `Rules.findMixin(string)` now exits before parent/fallback
retry whenever the caller requested `searchParents: false` and the current
frame produced any miss/uncovered state after the current-frame narrow attempt.
A focused candidate test proves a current compound-prefix candidate does not
climb to parent or fallback exact hits when parent search is disabled.

2. [ ] Extend narrow uncovered-child fallback proof to namespaced
reference-import child surfaces. Scope: the uncovered child-only fallback in
`findMixinsFastForUncoveredCallable`, reference-import siblings, rendered
reference imports, selector-list reference imports, and namespace offsets.
Goal: keep broad search limited to child entries that actually reported
`uncovered`, without losing dynamic positives. Acceptance: covered sibling
child surfaces are not reopened; configured guarded and simple
reference-import guarded calls stay zero-bridge; remaining dynamic positives
still resolve. Current evidence: array-path namespace starts now use the
narrow helper for child-surface misses; unresolved reference-import namespace
starts still fall back when the helper cannot produce candidates.

3. [x] Delete any remaining simple exact callable child scans that are
provably covered by frame facts. Scope: current-frame miss, child-entry family
skip, child-frame covered miss, and terminal mixin-only mode. Goal: avoid
child-surface crawl when the frame already says the family/key cannot hit.
Acceptance: `findMixinsFast` spy tests for simple mixin and mixin-ruleset
misses. Current evidence: focused callable bucket tests prove simple misses
skip `findMixinsFast(...)` when no child surfaces exist, when child frames
cover exact misses, when child surfaces cannot contain exact callables, and
when terminal mixin-only lookup sees ruleset-only child surfaces. Direct
no-frame mixin-only misses skip ruleset-only child surface bridges, prepared
null child entries prevent recursive rediscovery, and ruleset path misses skip
mixin-only child surfaces.

4. [ ] Retry `ReferencePlan` only for source-static facts. Scope:
`_lookupStrategy`, key node identity, read mode, target presence, `inCall`, and
static parent/start shape. Goal: cache repeated preparation only when generated
control/mixin surfaces cannot change the facts. Acceptance: control loop matrix
plus variable/property/function/callable handle tests. Current evidence:
source-static variable/property/function/mixin reads now read an already-written
trivial `RulesLookupHandle` before rebuilding `_lookupStrategy`; contextual
start, read mode, target/filter, leaky/search-scope, interpolated, and
nontrivial handle shapes still fall through to normal preparation. The
source-static read now validates the stored handle fields directly and reuses
the shared freshness tail, so it no longer allocates a temporary
`RulesLookupHandleShape` object just to re-read a covered handle.

5. [ ] Finish reference-import namespace offset coverage. Scope:
namespaced reference-import rulesets, reference-import child surfaces reached
through array-path keys, selector-list reference-import namespaces,
`findMixinNamespacePathFast(...)` unsupported returns, and
`findMixinsFastForUncoveredCallable(...)`. Goal: imported namespace positives
and misses stop reopening generated remainder-array fallback or broad direct
crawl once placement facts prove the surface. Acceptance: reference-import
namespace array-path spies show zero generated remainder-array fallback and
record/eliminate any remaining `findMixinsFast(...)` bridge hits. Current
evidence: uncovered callable child-entry lookup now returns explicit
hit/miss/unsupported states instead of overloading `undefined`.
No-prefix reference-import namespace-start misses use those states to skip both
broad start-key `findMixinsFast(...)` and generated nested array fallback.
Focused synthetic and real import tests cover namespaced reference-import
rulesets, selector-list imported rulesets, and misses staying off direct crawl.
Keep this open for `findMixinNamespacePathFast(...)` unsupported returns,
prefix-heavy ruleset namespace cases, and any imported namespace positive/miss
shape not covered by the current reference-import fixtures.

6. [ ] Extend stable namespace no-fallback proof to imported namespace
surfaces. Scope: namespace path offsets, reference imports, terminal
mixin-only mode, and parameterized terminals. Goal: stable positives stay on
offset paths without breaking Less semantics. Acceptance: Less fixture,
reference-import namespace tests, and bridge spies. Guarded namespace positives
already have zero broad-crawl and zero array-fallback proof.

7. [ ] Prove reference-import declaration/callable misses stay on modeled
frames after retry-frame cleanup. Scope: reference import roots, rendered
reference imports, parent/fallback frames, and optional callable misses. Goal:
no regression to frame-less broad crawl. Acceptance: real reference-import
fixtures plus broad-bridge spies.

8. [x] Move remaining declaration-constraint reference options toward
semantic names or internal constraint construction. Scope:
`ReferenceOptions.requiredDeclarationAssignments`, `excludedDeclarations`, merge
normalization, and tests that construct filtered references. Goal: keep
semantic merge/exclusion behavior without exposing handle/cache-looking knobs.
Acceptance: existing semantic tests for mutable `excludedDeclarations` and
`requiredDeclarationAssignments` stay green, and any renamed/internalized fields
are guarded by `verify:binding-lookup-hot-paths`. Current evidence:
`ReferenceOptions` and `DeclarationFindOptions` now expose semantic
`excludedDeclarations` / `requiredDeclarationAssignments` only. Production
merge assignment uses one mutable `excludedDeclarations` list instead of hidden
scalar getter options, and `verify:binding-lookup-hot-paths` forbids the old
`excludedNodes` / `requiredNormalizedFromAssign` names plus scalar option
fields on the public/direct lookup surfaces.

9. [ ] Run changed-baseline and fix any lookup-owned fallout now that the
ruleset header streaming blocker is repaired. Scope: changed Less/Jess
fixtures, ruleset render interaction with lookup work, and branch-local
failures. Goal: use baseline evidence as a gate again. Acceptance:
`pnpm run verify:baseline -- --changed` either passes or has a lookup-owned
failure recorded with a fix. Current evidence: the changed baseline was rerun
after the generic handle-shape split. It built `@jesscss/core`, entered the
broad core suite, surfaced the same non-lookup render/serialization-family
failures visible in `node-render-buffer.test.ts`, `at-rule.test.ts`, and
`cloning.test.ts`, then stopped producing output while the PTY still reported
a live session. It was interrupted after the child PID was gone rather than
counted as a pass. No visible failure pointed at `reference.ts` handle-shape
behavior; keep this item open until the baseline can finish cleanly or the
non-lookup failures are separated upstream.

10. [ ] Refresh lookup profile and one-iteration hotpath smoke after the next
bridge deletion batch. Scope: `scope-lookup-stress.less`, direct lookup
counters, old registry counters, and smoke timings. Goal: keep counter
evidence current without claiming speed. Acceptance: profile recorded with old
`Rules.find`/registry counters empty and smoke values labeled smoke-only.

11. [ ] Extend namespace frame-chain proof to callable mixin namespaces with
reference-import descendants. Scope: no-param namespace mixins, nested
reference imports inside mixin namespace bodies, fallback frames, and
`findCallableDescendantsWithinMixinNamespaces(...)`. Goal: prevent callable
namespace descendants from falling back to broad direct crawl when child-frame
facts can prove hit/miss. Acceptance: focused mixin/import tests with
`findMixinsFast(...)` spies and union-preserving namespace positives. Current
evidence: two-segment callable namespace descendants now return direct
child-frame hits and stop on child-surface covered misses before nested
`findMixin(...)`. Reference-import descendant modeled misses now return a
definitive empty descendant result and skip both nested `findMixin(...)` and
the older namespace `findMixinsFast(...)` fallback. Reference-import descendant
modeled positives inside namespace mixin bodies now return the direct
child-frame hit and skip both nested `findMixin(...)` and namespace/root
`findMixinsFast(...)` broad crawl. Real evaluated reference-import namespace
mixin bodies now build/read the child frame on the descendant path and skip
both nested `findMixin(...)` and broad `findMixinsFast(...)`; the existing
guard proves ordinary callable lookup still does not build a scope frame merely
to try the shortcut. Never-evaluated import-in-uncalled-mixin namespace
positives are still open and must not be claimed covered, because sync lookup
cannot see async import content until a reference-import preparation edge
exists.

12. [ ] Revisit `findVisibleCallableRulesetPrefixMatches(...)` recursive child
walk after selector-list coverage. Scope: direct child-entry flags,
reference-import child surfaces, selector-list prefix matches, and visited-set
allocation. Goal: skip child recursion when carried flags prove no ruleset
prefix can exist, without losing imported selector-list positives. Acceptance:
focused namespace/import tests plus aggressive review explaining any remaining
visited-set allocation. Current evidence: attempted frame-first
covered-miss/prefix-crawl shortcuts were rejected. `lookupScopeFrameCallable`
misses do not yet model nested/owned selector-body prefixes, and replacing
`getScopeFrame()` with `_scopeFrame` in ruleset namespace ambiguity checks
breaks existing nested compound selector lookups. Do not retry either cut until
selector-body prefix candidates are explicitly carried by callable frame facts.

13. [x] Finish explicit declaration visibility/import no-fallback proof.
Scope: `DeclarationLookupStrategy`, reference-import child entries, import
visibility, and covered declaration/property hits and misses. Goal: ordinary
declaration/property lookup does not widen to child scans or public bridge
behavior when visibility facts are modeled. Acceptance: synthetic import
covered-hit/miss tests plus at least one real reference-import declaration
fixture with bridge spies. Current evidence: the real `@import(reference)`
hit/miss fixture now includes imported property hit and miss reads. Direct
property occurrence lookup finds the imported property and misses a missing
imported property through the direct helper, while the same fixture spies on
`Rules.find(...)` and proves rendered variable hit/miss references plus
rendered property hit/miss references stay off the public declaration bridge.
The fix was source-order handling in direct child-entry lookup: when an earlier
child surface has already passed the parent-level start gate, its internal
lookup must not reuse the later parent `start`. Wrapper nodes without `index`
now derive their containing rules index for the parent gate instead of falling
back to a false miss.

14. [x] Finish property merge-chain output-binding handle identity proof.
Scope: merge normalization, source/output exclusions, same-parent source
ordering slots, and pre/post `bindOutput` identity. Goal: merge-chain property
reads keep using direct occurrences and reject only stale constrained handles.
Acceptance: lower-level handle tests plus real Less merge-chain fixture proof.
Current evidence: focused reference tests prove mutable assignment constraints,
source/output exclusion identity mutation after `bindOutput`, and wider
external exclusion lists staying cold; the real Less merge-chain fixture still
avoids public property/declaration lookup bridges.

15. [x] Finish declaration/property key-versioning dynamic promotion proof.
Scope: `Rules.getDeclarationLookupVersion(key)`, dynamic names, import/rules
promotions, and per-name invalidation. Goal: per-name versions remain freshness
state, not a second registry, and ordinary static reads avoid broad version
invalidation. Acceptance: focused version invalidation tests for dynamic-name
promotion, late import/reference additions, and rules promotion. Current
evidence: static declaration registration now invalidates only the affected
direct declaration bucket/cache entries. A focused reference test proves
unrelated `color`/`missing` direct lookup cache entries and the `color` bucket
survive an `unrelated` static declaration write while the stale `unrelated`
miss is removed. Pending dynamic declarations that become static now bump the
resolved key's declaration lookup version, clear only the resolved key's bucket
and lookup-cache entries, and preserve unrelated miss cache entries. Static
child `Rules` declaration surfaces now collect concrete declaration keys,
invalidate only those per-key declaration buckets/cache entries, and preserve
unrelated cache entries; child surfaces with unresolved `StyleImport`/
reference-import uncertainty still bump the global declaration lookup version
and clear the broad cache. A real style-import eval promotion test proves the
imported `Rules` replacement invalidates only the imported declaration key
after registration prep has populated unrelated direct declaration caches.

16. [x] Audit and slim private declaration-constraint handle snapshots. Scope:
`ReferenceRulesLookupDeclarationConstraints`, `RulesLookupHandleShape`,
source-static declaration/property handle reads, and mutable exclusion/
assignment tests. Goal: keep the private scalar snapshot only if it is cheaper
than a semantic fingerprint or direct pointer comparison, without reintroducing
declaration constraint option plumbing. Acceptance: focused handle tests plus
aggressive review explaining retained scalar fields or deleting them. Current
evidence: the private `excludedDeclarationCount` snapshot is deleted. Handle
freshness now keeps only the declaration-assignment key plus the first two
excluded declaration identities; lists longer than two remain cold, and
focused mutable exclusion/assignment tests prove stale handles are rejected
without the count field.

17. [x] Rename remaining constraint test/prose labels from normalized/excluded-
node wording to declaration assignment/exclusion wording. Scope: focused test
names, tracker text, and guard messages only. Goal: keep future agents from
looking for deleted `excludedNodes` / `requiredNormalizedFromAssign` API while
preserving Less normalized-assignment semantics where that is the actual
declaration option. Acceptance: grep shows old reference-option names only
inside verifier forbidden-token lists or historical notes. Current evidence:
focused reference labels now use declaration assignment/exclusion wording, and
grep shows the old reference-option names only in verifier forbidden-token
lists or tracker/handoff notes describing deleted API.

18. [x] Collapse declaration-handle constraint shape branching where possible.
Scope: `lookupTypeUsesDeclarationConstraints(...)`,
`getRulesLookupHandleDeclarationConstraintShape(...)`,
`prepareRulesLookupShape(...)`, source-static early handle reads, and variable
handles that can carry declaration occurrences. Goal: keep declaration
constraint checks assigned to the declaration/property/variable paths that need
them without making function/callable paths carry generic shape branches.
Acceptance: focused variable/property/declaration/function/callable handle
tests plus no regression in `verify:binding-lookup-hot-paths`. Current
evidence: the old declaration-constraint shape helper is gone,
`prepareRulesLookupShape(...)` now stores only start/local/parent/terminal facts
in `RulesLookupHandleShape`, and declaration constraints are computed into a
separate `ReferenceRulesLookupDeclarationConstraints` object only for
declaration-capable handle paths. Focused variable/property/declaration/
function/callable handle tests, `verify:binding-lookup-hot-paths`, and
`@jesscss/core` build passed.

19. [x] Add explicit proof for handleable two-exclusion mutation edges. Scope:
mutable `excludedDeclarations` arrays with zero, one, and two declaration
slots; transitions from no output to output binding; and mutation between
first/second excluded declarations. Goal: prove the first-two-identity snapshot
is sufficient now that the count snapshot is gone. Acceptance: focused
reference tests covering mutation-to-hit, mutation-to-miss, and cold fallback
for lists longer than two. Current evidence: a focused reference test mutates
zero, first, and second excluded declaration slots and proves each stale handle
is rejected while `excludedDeclarationCount` remains absent; the existing wider
declaration-exclusion test keeps lists longer than two cold.

20. [x] Split declaration-constraint handle shape from generic
`RulesLookupHandleShape`. Scope: shape construction, `prepareRulesLookupShape`,
`readRulesLookupHandle`, source-static handle reads, and handle write helpers.
Goal: keep generic lookup shape to start/local/terminal facts, and pass
declaration constraints only on declaration-capable handle paths without adding
function/callable branches. Acceptance: focused handle tests plus
`verify:binding-lookup-hot-paths`; aggressive review must show fewer generic
shape fields or fewer declaration-constraint branches. Current evidence:
`RulesLookupHandleShape` no longer has `requiredDeclarationAssignmentsKey`,
`excludedDeclaration0`, or `excludedDeclaration1`; handle read/write receives
the declaration-constraint object separately, and function/callable handle
tests still prove ignored declaration options do not get stored or invalidate
their handles. The verifier now fails if declaration constraints move back
into the generic shape.

21. [x] Split source-static handle readers by lookup family instead of
branching through `lookupTypeUsesDeclarationConstraints(...)`. Scope:
`tryReadSourceStaticRulesLookupHandle(...)`, source-static variable/property/
declaration/function/callable reads, and `_lookupStrategy` rebuild avoidance.
Goal: assign the reader/checker for declaration-capable references up front so
function/callable source-static reads do not evaluate declaration-constraint
eligibility or helper branches. Acceptance: focused source-static handle tests
for variable/property/declaration/function/callable reads plus verifier guard
against declaration-constraint checks in the function/callable source-static
reader path. Current evidence: the old generic
`tryReadSourceStaticRulesLookupHandle(...)` is gone. Each lookup strategy now
owns `tryReadSourceStaticHandle`, with declaration/property/variable readers
doing declaration-constraint checks and function/mixin/mixin-ruleset readers
using only common handle freshness. The early read still uses an uncached
strategy lookup, so a source-static cache hit does not rebuild `_lookupStrategy`.
Focused source-static/function/callable handle tests and
`verify:binding-lookup-hot-paths` passed.

22. [x] Move handle eligibility onto lookup strategies instead of the generic
`isRulesLookupHandleEligible(...)` branch ladder. Scope:
`ReferenceLookupStrategy`, per-family handle key eligibility, declaration
constraint handleability, callable array-path eligibility, and read/write
assignment. Goal: choose the family-specific handle policy once with the
lookup strategy, preserving the Chevrotain-style assigned-function direction
and shrinking generic string/type branching on every reference eval.
Acceptance: focused reference strategy/cache tests, handle cold-path tests for
searchScope/leaky/semantic filters, function/callable ignored-constraint
tests, and `verify:binding-lookup-hot-paths`. Current evidence: the old
`isRulesLookupHandleEligible(...)` function is gone. `ReferenceLookupStrategy`
now owns `handleLookupType`, `getHandleValueKey`, optional declaration
constraints, and source-static handle reading. Focused cold-path tests for
searchScope/leaky disqualification, strategy-cache type changes, terminal
mixin-only mode, and ignored declaration constraints stayed green; the verifier
now forbids the old generic eligibility helper and requires strategy-owned
handle policy fields.

23. [x] Collapse `lookupTypeUsesDeclarationConstraints(...)` to declaration
strategy/type guards only. Scope: `prepareRulesLookupShape(...)`,
`readRulesLookupHandle(...)`, declaration handle unions, and declaration
constraint freshness checks. Goal: eliminate remaining generic lookup-type
branching by giving declaration-capable strategies/readers a typed declaration
handle path, while preserving function/callable fast reads. Acceptance:
focused declaration/property/variable/function/callable handle tests plus a
verifier guard that declaration-constraint checks do not run through generic
lookup-type predicates outside declaration-only helpers. Current evidence:
the generic `lookupTypeUsesDeclarationConstraints(...)` predicate is gone.
Handle freshness now uses a declaration-handle type guard/read helper for
declaration/property/variable constraints, while function/callable handle
reads only validate common handle fields. The binding hot-path verifier now
forbids the old generic predicate.

24. [x] Split handle write args or writer functions by family so
function/callable writes do not receive declaration-constraint plumbing. Scope:
`WriteRulesLookupHandleArgs`, `writeVariableRulesLookupHandle`,
`writeDeclarationRulesLookupHandle`, `writeFunctionRulesLookupHandle`,
`writeCallableRulesLookupHandle`, and async writeback in
`lookupResolvedReference(...)`. Goal: avoid passing declaration-only fields to
function/callable writers and make each writer's required inputs match its
handle family. Acceptance: focused async/sync handle write tests for variable,
property/declaration, function, mixin, and mixin-ruleset plus
`verify:binding-lookup-hot-paths`. Current evidence: declaration and variable
handle writers now accept `WriteDeclarationRulesLookupHandleArgs`, the base
writer args reject `declarationConstraints`, and sync/async writeback routes
through one strategy dispatcher that supplies declaration constraints only for
strategies that require them. Function/callable writer bodies do not receive or
read declaration constraint plumbing, and the verifier guards that shape.

25. [x] Split generic handle reads by strategy/family so non-declaration
reads do not receive a declaration-constraint parameter at all. Scope:
`readRulesLookupHandle(...)`, `tryReadSourceStatic*RulesLookupHandle(...)`,
strategy-owned readers, and the sync/async reference lookup read path. Goal:
move from one generic reader with a declaration-only optional argument to
assigned family readers where function/callable read paths cannot even be
called with declaration constraints. Acceptance: focused source-static and
normal handle tests for declaration/property/variable/function/mixin/
mixin-ruleset plus verifier guards against passing declaration constraints to
function/callable readers. Current evidence: the generic
`readRulesLookupHandle(...)` function is gone. Strategy-owned readers now use a
common base freshness reader plus declaration-only, variable, function, and
callable family readers. The normal sync/async lookup path calls declaration
strategies with declaration constraints and calls function/callable/index
readers without that field. The verifier now forbids the old generic reader
and checks that function/callable readers do not read declaration constraints.

26. [x] Remove `preparedDeclarationConstraints` from generic
`RulesReferenceLookupContext` or move it behind declaration-only context state.
Scope: `prepareRulesLookupShape(...)`, `RulesReferenceLookupContext`, lookup
adapters, and declaration writer/read preparation. Goal: keep declaration
constraint state off the generic lookup context when function/callable/index
lookups cannot use it. Acceptance: build, focused handle tests, and verifier
guard that generic lookup context fields do not grow declaration-handle
plumbing. Current evidence: `RulesReferenceLookupContext` no longer has
`preparedDeclarationConstraints`, and `prepareRulesLookupShape(...)` only
stores target rules plus common handle shape. Declaration constraints are
computed in the handle read/write preparation path only when a handleable
declaration strategy needs them. The verifier now fails if generic lookup
context state grows declaration-constraint fields again.

27. [x] Split `ReferenceLookupStrategy` into declaration-capable and
non-declaration handle strategy shapes. Scope: `ReferenceLookupStrategy`,
`requiresHandleDeclarationConstraints`, optional
`getHandleDeclarationConstraints`, read/write dispatch, and strategy constants.
Goal: remove boolean/optional declaration-policy branching from non-declaration
strategies entirely, so the type shape itself proves whether a strategy can
carry declaration constraints. Acceptance: focused handle tests plus verifier
guards that function/callable/index strategies cannot expose declaration
constraint hooks or receive declaration read/write args. Current evidence:
`ReferenceLookupStrategy` is now a union of declaration-capable and plain
strategy shapes. The old `requiresHandleDeclarationConstraints` flag is gone,
declaration hooks live only on declaration/property/variable strategies, and
the verifier rejects declaration hooks on index/function/callable strategy
constants.

28. [x] Audit and slim handle read/write argument object creation in
`lookupResolvedReference(...)`. Scope: `readArgs`, `writeStrategyRulesLookupHandle`,
sync/async writeback, spread calls, and source-static read reuse. Goal: keep
family-specific handle access without trading deleted generic branching for
new hot-path objects or spread-heavy dispatch. Acceptance: focused handle
tests, aggressive review of any retained object/spread allocation, and a
lookup smoke/profile note if the final shape touches measured handle access
allocation. Current evidence: the temporary `readArgs` object and stale
`...readArgs` / `...baseArgs` spread dispatch are gone. The strategy write
dispatcher now takes positional inputs and constructs only the family writer
arg object it actually calls. The verifier rejects the removed temp/spread
shapes. This is code-path/object-shape evidence only, not a measured speed
claim.

29. [x] Decide whether strategy handle reader/writer methods should become
positional instead of object-argument APIs. Scope: `ReadRulesLookupHandleArgs*`,
`WriteRulesLookupHandleArgs*`, family read/write helpers, sync/async
writeback, and source-static readers. Goal: remove the remaining per-read/
per-write argument object allocation if the resulting call shape is simpler
and still type-safe, or document why the current private object boundary is
the cheapest maintainable shape. Acceptance: focused handle tests plus
aggressive review; use a lookup smoke/profile note if the implementation keeps
or removes measured handle-access allocation. Current evidence: the private
`ReadRulesLookupHandleArgs*`, `WriteRulesLookupHandleArgs*`, and
`SourceStaticRulesLookupHandleArgs` object shapes are gone. Strategy
read/write methods, family read/write helpers, source-static readers, and
sync/async writeback now pass positional facts directly. The verifier rejects
the stale object-call and arg-type names. This is handle-allocation
code-path evidence only, not a measured speed claim.

30. [x] Finish source-static `ReferencePlan` retry only for stable facts after
the strategy read/write split. Scope: `_lookupStrategy`, source-static key
identity, target/filter/read-mode/leaky/search-scope disqualifiers, handle
shape, and source-static strategy readers. Goal: prove repeated source-static
references can reuse only stable plan facts without caching generated or live
surface state. Acceptance: control/mixin loop matrix plus variable/property/
function/callable handle tests showing dynamic surfaces still fall through.
Current evidence: source-static readers are strategy-owned positional calls;
the existing stable source-static test proves a written handle can read before
rebuilding `_lookupStrategy`, while the new unstable-facts test proves
read-mode and semantic-filter changes still rebuild the lookup strategy rather
than reusing stale plan facts.

31. [x] Split or prove handle-prep eligibility by strategy so no-handle and
index paths skip generic handle plumbing. Scope:
`getStrategyRulesLookupHandleValueKey(...)`, `prepareRulesLookupShape(...)`,
index strategy, no-source-static strategy, and callers that only need lookup
result preparation. Goal: keep handle access assigned to families that can
actually cache a handle, without running common shape/key/declaration
eligibility work for paths that will always clear or ignore the handle.
Acceptance: verifier guards against reintroducing generic handle eligibility,
focused index/no-handle tests, and aggressive review of any retained common
helper. Current evidence: `ReferenceLookupStrategy` is now split into
handle-capable and no-handle strategy shapes. The index strategy no longer
exposes `readHandle`, `writeHandle`, `getHandleValueKey`,
`tryReadSourceStaticHandle`, or `handleLookupType`; index target reads clear
stale handles directly and skip handle shape/value-key/source-static prep. A
focused test seeds an index reference with a stale variable handle and proves
the index read resolves through typed Rules lookup, clears the handle, and
keeps the index strategy. The verifier now rejects the deleted no-op handle
helpers and any index strategy handle hooks.

32. [x] Audit callable/source-static handle freshness after positional
strategy APIs. Scope: callable version reads, terminal mixin-only mode,
callable value keys, source-static callable/mixin-ruleset readers, and async
writeback. Goal: keep callable handles as one callable entry model while
ensuring the positional call shape did not leave duplicated freshness logic or
generic branching around mixin vs mixin-ruleset. Acceptance: terminal
mixin-only, callable version invalidation, mixin-ruleset cached-reuse, and
source-static callable tests plus verifier coverage for stale split callable
arg shapes. Current evidence: normal function/callable readers and
source-static function/mixin/mixin-ruleset readers now rely on the shared
exact lookup-type/version/shape freshness check instead of repeating local
`handle.lookupType` branches. The verifier rejects those duplicate reader
checks. Existing terminal mixin-only, callable version/cached-reuse,
source-static, and searchScope cold-path tests stayed green.

33. [ ] Revisit callable retry-frame loop after current-frame handle/no-handle
cleanup. Scope: `Rules.findMixin(string)`, retry parent frames, fallback
frames, `searchParents: false`, and `uncovered` reasons `frame`/`key` after
`prepareCallableLookupFrame(...)`. Goal: either prove those uncovered states
cannot survive preparation or delete any parent/fallback retry after the caller
has requested no parent search. Acceptance: focused spy tests for
`searchParents: false` simple callable misses, fallback-frame hits/misses, and
no direct `findMixinsFast(...)` bridge after a covered current-frame miss.
Current evidence: the no-parent retry cut is in place for current-frame
miss/uncovered states, including candidate uncertainty, and focused callable
bucket tests cover fallback hits, fallback misses, and the new no-parent
candidate case. Keep this open for the remaining parent/fallback retry loop
when parent search is enabled.

34. [x] Convert callable uncovered direct-crawl bridge to explicit child-entry
result states. Scope: `findMixinsFastForUncoveredCallable(...)`,
`UncoveredCallableCoverage`, child `lookupScopeFrameCallable(...)` results,
and reference-import child entries. Goal: distinguish `modeled-miss`,
`unmodeled-reference-import`, and `hit` without using `undefined` as both
"no hit" and "must try another bridge". Acceptance: existing
reference-import guarded positives, namespaced reference-import misses,
covered sibling child-surface tests, and verifier/aggressive review proving no
new broad fallback state object is added to the hot simple path. Current
evidence: `UncoveredCallableCoverage` is deleted. The helper now returns
singleton `UNCOVERED_CALLABLE_MISS` / `UNCOVERED_CALLABLE_UNSUPPORTED` states
or direct hit arrays. Callers in no-prefix ruleset namespace starts, simple
prefix resolution, namespace-descendant lookup, retry frames, and
namespace-start lookup distinguish modeled misses from unsupported uncertainty
without a side coverage object. Focused callable bucket tests,
reference-import import fixtures, namespace fast-path tests, binding hot-path
verifier, aggressive review, and core build passed.

35. [x] Collapse remaining uncovered-callable result-state branching where it
is now duplicated across callers. Scope: the repeated
`UNCOVERED_CALLABLE_MISS` / `UNCOVERED_CALLABLE_UNSUPPORTED` checks in
`findRulesetNamespacePathFast(...)`, `findCallableDescendantsWithinMixinNamespaces(...)`,
`findMixin(...)`, and retry/fallback frames. Goal: keep the explicit states
without growing a new helper ladder or branch tax. Acceptance: no new object
state, focused callable/reference-import tests stay green, and aggressive
review explains any retained duplicated checks as cheaper than a wrapper.
Current evidence: modeled miss now reuses one module-level empty `MixinEntry`
array sentinel instead of a second symbol state, so callers branch only on the
unsupported sentinel and use `length` where they need hit-vs-miss behavior.
No wrapper helper was added; retained local unsupported checks are cheaper than
another hot-path function call. A fresh audit rejected replacing the sentinel
with a helper object/wrapper or collapsing back to overloaded `undefined`,
because those options either add a hot call/object or undo the item-34
explicit unsupported state. Focused callable/reference-import tests covering
covered sibling child surfaces, terminal mixin-only misses, ruleset path
family skips, reference-import namespace array-path misses, selector-list
array paths, and evaluated namespace mixin descendants stayed green.

36. [x] Extend imported declaration source-order proof beyond the real
reference fixture. Scope: selector-list reference imports, configured
`with`/`set` child declaration surfaces, nested imported child rules, and
same-parent later child misses. Goal: prove the direct child-entry start gate
covers imported declaration/property hits without reopening public
`Rules.find(...)` or widening same-parent source order. Acceptance: focused
reference/import tests with `Rules.find(...)` spies for selector-list and
configured import declaration hits/misses, plus the same-parent later-child
miss guard staying green. Current evidence: the real reference-import fixture
now covers rendered property hit/miss inside a later nested ruleset plus
selector-list and nested imported child property hits while spying on
`Rules.find(...)`. Configured additive `with` child surfaces and replacement
`set` child surfaces now each render property hits from imported/configured
child declarations without entering the public declaration bridge. Focused
reference tests cover ordinary carried child-entry reuse and same-parent later
child misses.

37. [ ] Design and prove a reference-import preparation edge for never-evaluated
namespace mixin bodies. Scope: style imports inside uncalled no-param namespace
mixins, async import path resolution, registration prep boundaries, and
`findCallableDescendantsWithinMixinNamespaces(...)`. Goal: let callable
namespace lookup see reference-import descendants without evaluating the whole
mixin body or blocking synchronous lookup on unresolved async imports.
Acceptance: a real import-in-uncalled-mixin namespace positive either resolves
without nested `findMixin(...)`/broad `findMixinsFast(...)`, or the tracker
records the semantic reason it must remain a cold async/materialization path.
Current evidence: evaluated namespace mixin bodies now use frame facts, but
never-evaluated bodies remain open because sync lookup cannot see unresolved
import content.

38. [ ] Split selector-body callable prefix facts from recursive prefix crawls.
Scope: selector-list/compound ruleset bodies, reference-import child surfaces,
`findVisibleCallableRulesetPrefixMatches(...)`, and callable frame facts.
Goal: carry enough ruleset-prefix facts on scope frames to skip recursive child
prefix walks where no prefix can exist, without losing selector-list and
compound-prefix positives. Acceptance: focused namespace/import positives and
misses prove prefix lookup avoids child recursion when frame facts cover the
family, and rejected shortcuts from item 12 stay guarded.

39. [x] Move `setDefined` declaration writes fully onto current live binding
cells before occurrence fallback. Scope: `Rules.registerNode(...)`
`setDefined`, `lookupScopeFrameVariable(...)`, readonly checks, direct
declaration occurrence fallback, and current/output binding freshness. Goal:
write to the current live declaration cell when a covered frame binding exists,
and use occurrence lookup only when frame coverage is incomplete or the target
is non-variable declaration behavior. Acceptance: focused `setDefined`
current-cell tests prove covered writes avoid occurrence lookup/public
declaration bridge, readonly errors still come from the live cell, and the
existing fallback path remains for uncovered/non-variable cases. Current
evidence: `Rules.registerNode(...)` now probes the modeled variable frame
before evaluating the assignment RHS, checks live-cell readonly first, and only
then evaluates/writes the live cell. Existing no-crawl proof covers modeled
live binding writes without touching `Rules.value`; a new readonly live-cell
test proves the RHS is not evaluated and direct occurrence crawl is not entered
when the modeled cell rejects the write. A deliberately attempted ordinary
same-scope declaration-current no-crawl proof failed because the current cell
is the `setDefined` node itself and the guard correctly rejects it; that case
must keep using occurrence fallback until declaration-current slots model
assignment targets without treating the assignment as the target.

40. [x] Model same-scope `setDefined` assignment targets without occurrence
fallback. Scope: `ScopeFrame.currentBindingsByName`, declaration buckets that
contain a same-scope `setDefined` node, `blockedSource` handling, and
assignment-target cells. Goal: let ordinary same-scope `$x: ...; $x := ...`
write the prior current declaration cell through frame state instead of
falling back to direct occurrence search. Acceptance: a no-crawl test that
poisons `Rules.value` after frame prep passes for same-scope declarations, and
source-order snapshot reads still see the pre-assignment occurrence. Current
evidence: `prepareScopeFrameDeclarationIndex(...)` now skips static
`VarDeclaration` nodes with `setDefined`, so prebuilt frames keep the prior
declaration cell as current instead of treating the assignment as a declaration
target. Focused `rules.test.ts` proof poisons `Rules.value` after frame prep
and shows same-scope `setDefined` writes the prior declaration cell directly.
Focused `reference.test.ts` proof shows current-cell probes skip assignment
declarations and source-order reads still see the pre-assignment declaration.

41. [x] Split `setDefined` fallback proof by variable/property family after
same-scope assignment targets are modeled. Scope:
`findWritableSetDefinedDeclarationOccurrence(...)`, variable vs property
strategies, readonly imported child surfaces, and non-variable declaration
insertion. Goal: keep occurrence fallback only for property/non-variable or
uncovered dynamic cases, not for modeled variable assignments. Acceptance:
focused tests prove variable covered writes avoid fallback while property
`setDefined` still inserts/reuses declarations with correct readonly and
visibility semantics. Current evidence: variable same-scope `setDefined`
covered by a modeled frame avoids direct occurrence crawl; property
`setDefined` remains on declaration occurrence insertion fallback and a focused
test proves it inserts the concrete property declaration while preserving the
assignment source node.

42. [x] Delete same-scope variable `setDefined` occurrence fallback for covered
frame paths. Scope: `Rules.registerNode(...)`, the post-frame
`findWritableSetDefinedDeclarationOccurrence(...)` fallback, dynamic names, and
uncovered frames. Goal: once a static variable assignment is covered by
declaration frame state, prove the occurrence fallback is unreachable and make
the branch explicit for only uncovered/dynamic variable cases. Acceptance:
focused tests spy/poison the direct occurrence helper path for same-scope and
parent-frame variable writes, while dynamic/uncovered assignments still fall
back correctly. Current evidence: `Rules.registerNode(...)` now treats a
`lookupScopeFrameVariable(...)` covered `miss` as authoritative for static
`VarDeclaration` `setDefined` writes instead of falling through to
`findWritableSetDefinedDeclarationOccurrence(...)`. Focused `rules.test.ts`
proof poisons `Rules.value` and covers modeled same-scope writes,
parent-frame writes, and covered misses; dynamic/uncovered variable writes
still retain the old fallback branch because `uncovered` is the only modeled
non-hit state allowed to continue.

43. [x] Carry readonly imported variable assignment facts into modeled
`setDefined` frame writes. Scope: readonly child/imported Rules entries,
`ScopeFrame.currentBindingsByName`, `findWritableSetDefinedDeclarationOccurrence(...)`,
and import visibility. Goal: reject variable `setDefined` writes against
readonly imported/current cells through frame state instead of relying on
occurrence fallback inheritance. Acceptance: focused import/child rules tests
prove readonly variable assignments fail before occurrence crawl, while
non-readonly imported variables still update through the modeled cell. Current
evidence: `ScopeFrame.assignmentBindingsByName` now carries assignment-only
public child/import variable cells prepared from direct child-entry visibility
facts. Ordinary `lookupScopeFrameVariable(...)` reads do not consult those
cells; the `setDefined` path opts in with `includeAssignmentTargets`. Focused
`rules.test.ts` proofs poison parent/imported/child `Rules.value`, reject
readonly imported assignments before RHS eval, update writable imported
assignments through the modeled source cell, and prove ordinary current reads
still miss assignment-only import cells.

44. [x] Delete variable `setDefined` fallback entry for modeled readonly
import facts after item 43 lands. Scope: the static `VarDeclaration`
`setDefined` branch in `Rules.registerNode(...)`, readonly import/current
cells, and the variable arm of
`findWritableSetDefinedDeclarationOccurrence(...)`. Goal: once readonly
import facts are represented in the frame, the static variable assignment path
should have only modeled hit/readonly/miss/uncovered outcomes before the
property/non-variable fallback. Acceptance: tests prove readonly imported
variables reject through the frame without occurrence crawl, writable imported
variables update through the modeled cell, covered misses throw directly, and
only uncovered dynamic names reach the old variable occurrence fallback.
Current evidence: static `VarDeclaration` `setDefined` now reaches the old
variable occurrence fallback only when `lookupScopeFrameVariable(...)` returns
`uncovered`; modeled live/current, same-scope declaration, parent-frame
declaration, imported writable, imported readonly, and covered miss cases all
return or throw before fallback. The formerly skipped readonly nested child
rules tests are active and green, while the later writable child countercase
still proves readonly is not preserved past a newer writable public variable
surface.

45. [x] Split optional child variable assignment targets from public imported
assignment targets. Scope: optional `VarDeclaration` child visibility,
`ScopeFrame.assignmentBindingsByName`, direct lookup optional match
precedence, and `setDefined` fallback. Goal: carry optional assignment facts
only when direct lookup would use the optional target, without changing
ordinary reads or making public imports wait for optional scans. Acceptance:
focused public-vs-optional child tests prove public wins stay modeled,
optional-only positives either model or explicitly remain uncovered, and
mixed optional/public source-order cases match direct lookup behavior without
recursive fallback on covered public hits. Current evidence:
`ScopeFrame.hasUncoveredAssignmentTargetSurface` now records unmodeled child
variable assignment surfaces separately from modeled public assignment cells.
`lookupScopeFrameVariable(...includeAssignmentTargets)` returns `uncovered`
for optional-only and dynamic assignment targets, so `setDefined` keeps the old
direct fallback for unmodeled assignment semantics instead of throwing a
covered miss. Focused `rules.test.ts` proofs cover unmodeled assignment
fallback updating the optional declaration, and mixed optional/public children
updating the modeled public cell without crawling any parent/optional/public/
child `Rules.value` surface.

46. [x] Replace assignment-target frame prep recursion with carried child
surface summaries where registration already knows the facts. Scope:
`collectPublicChildVariableAssignmentBindings(...)`,
`addDirectDeclarationChildRuleEntry(...)`, late imported Rules registration,
and readonly/current cell reuse. Goal: avoid recursive child surface scans
during frame prep when child entries can carry whether public static variable
assignment cells exist. Acceptance: no behavior change in readonly/import
tests, aggressive review accounts for the removed prep recursion, and focused
counter tests prove dynamic/uncovered children still route to fallback instead
of becoming false covered misses. Current evidence: `RulesEntryLike` now
carries `assignmentBindingsByName` and
`hasUncoveredAssignmentTargetSurface`; direct declaration child entries fill
those facts when entries are collected or added. `prepareScopeFrameAssignmentBindings(...)`
now reads carried entry summaries instead of recursively calling into child
Rules to rediscover public assignment cells. A focused late-registration test
prepares the parent frame before adding a child variable, then proves the
refreshed child-entry summary updates the modeled assignment cell without
crawling parent/public/child `Rules.value`.

47. [x] Collapse unmodeled assignment-target uncertainty into carried child
surface summaries after item 46. Scope:
`ScopeFrame.hasUncoveredAssignmentTargetSurface`, optional/dynamic child/import
`VarDeclaration` visibility, late child registration, and direct lookup
unmodeled precedence. Goal: make unmodeled assignment coverage a carried entry
fact rather than another frame-prep recursive rediscovery step, while still
leaving optional-only or dynamic targets uncovered until/if a modeled
assignment cell exists. Acceptance: item 45 focused tests stay green,
aggressive review shows the recursive rediscovery scan is removed, and mixed
optional/public cases still avoid direct fallback when a public modeled target
exists. Current evidence: the optional-only bit was widened to carried
`hasUncoveredAssignmentTargetSurface`, so optional-only and dynamic public
child variable assignment targets both return `uncovered` before authoritative
miss. Focused `rules.test.ts` proofs cover optional-only fallback, dynamic
public child variables staying uncovered, and public modeled targets still
winning without fallback when optional siblings exist.

48. [x] Rename assignment-target uncovered frame state away from optional
legacy wording everywhere in docs/tests. Scope:
`ScopeFrame.hasUncoveredAssignmentTargetSurface`, tests that describe optional
coverage, and binding tracker wording. Goal: keep the code/document vocabulary
aligned with the widened semantic fact: unmodeled assignment surfaces, not only
optional surfaces. Acceptance: no production behavior change, focused
setDefined tests stay green, and tracker/handoff no longer imply only optional
surfaces can force assignment fallback. Current evidence: production state is
named `hasUncoveredAssignmentTargetSurface`; the focused setDefined test name
now describes unmodeled imported assignment targets; tracker current-evidence
wording now calls the state unmodeled rather than optional-only while retaining
historical optional rows as completed context.

49. [x] Carry assignment target summaries without allocating cloned readonly
maps when only inherited readonly changes. Scope:
`cloneReadonlyAssignmentBindings(...)`, `RulesEntryLike.assignmentBindingsByName`,
readonly import/compose entries, and `setDefined` readonly tests. Goal: avoid
extra Map/cell clones for readonly edge inheritance by carrying effective
readonly at entry construction or by a cheaper readonly-overlay fact.
Acceptance: readonly imported assignments still reject before RHS eval, writable
imports still update modeled cells, aggressive review shows clone allocation is
removed or isolated, and no ordinary read path consults assignment cells.
Current evidence: `cloneReadonlyAssignmentBindings(...)` was deleted. Child
entries now carry `assignmentReadonlyByName` beside canonical
`assignmentBindingsByName`, frames carry the same readonly overlay for
assignment-target hits, and `lookupScopeFrameVariable(...)` reports readonly
on the resolved hit without cloning or mutating the source binding cell.
Focused setDefined/readonly tests stay green.

50. [x] Collapse assignment-target readonly overlay allocation into the
smallest possible carried fact. Scope: `assignmentReadonlyByName` Sets on
`RulesEntryLike` and `ScopeFrame`, inherited readonly imports, direct readonly
cells, and setDefined readonly errors. Goal: keep the no-clone shape from item
49 while proving whether readonly overlays can be represented by a single
entry/frame boolean for all bindings or skipped entirely when cells are already
readonly. Acceptance: focused readonly import tests stay green, aggressive
review either shows the extra Set allocation removed or documents why per-name
readonly is semantically required. Current evidence: the overlay cannot safely
collapse to one whole-summary boolean because a public Rules summary can mix
writable own assignment targets with readonly child-edge targets. Cells that
are directly readonly still carry `cell.readonly`; the sparse
`assignmentReadonlyByName` Set is only for names whose readonly fact comes from
a child/import edge while the canonical source cell stays writable.

51. [x] Delete assignment-target summary recomputation on late child
registration where a single new static variable can patch the carried entry.
Scope: `refreshDirectDeclarationChildEntryAssignmentSummary(...)`,
`registerNode(VarDeclaration)`, static/dynamic child names, and uncovered
surface refresh. Goal: avoid rebuilding an entire child assignment summary
after adding one modeled public variable when the entry can be patched by key,
while still widening to uncovered for dynamic names. Acceptance: late
registration tests prove no parent/public/child `Rules.value` crawl, dynamic
late names still mark uncovered, and aggressive review shows the full summary
rebuild is gone or isolated to dynamic/uncovered cases. Current evidence:
static late child variable registration now patches the matching
`RulesEntryLike` by key, updates the parent frame assignment target only when
that entry wins source order, and marks dynamic public child variables
uncovered without rebuilding the child summary. Focused tests prove late
registration does not rebuild public `Rules.value`, and duplicate public
assignment targets now keep the later target on the no-crawl path.

52. [x] Replace assignment-target summary object allocation with caller-owned
accumulators. Scope: `AssignmentTargetBindingSummary`, recursive summary
collection, child-entry construction, and focused setDefined tests. Goal:
remove the small per-call `{ bindingsByName, readonlyByName }` object while
keeping the canonical cell plus sparse readonly overlay model. Acceptance:
aggressive review no longer flags the summary object allocation, setDefined
tests stay green, and no cloned readonly maps return. Current evidence:
`AssignmentTargetBindingSummary` and `getAssignmentTargetEntrySummary(...)`
were deleted. Assignment target collection now writes directly into existing
`RulesEntryLike` entries or into the destination `ScopeFrame`, preserving
same-Rules later-wins overwrite and reverse child-entry add-if-absent ordering
without allocating a temporary summary object.

53. [x] Patch parent assignment frame state for late static variables without
allocating a frame assignment map when the key is shadowed by current bindings
or a later child entry. Scope:
`refreshDirectDeclarationChildEntryAssignmentSummary(...)`,
`directDeclarationChildEntryWinsAssignmentName(...)`, `ScopeFrame.assignmentBindingsByName`,
and duplicate/late registration tests. Goal: keep the single-key patch path
from allocating assignment storage when the new target cannot be consulted.
Acceptance: tests cover current binding shadow, later child shadow, and winning
late child update while aggressive review explains any remaining Map allocation.
Current evidence: frame assignment target writes now go through
`addFrameAssignmentTargetBinding(...)`, which returns before allocating when a
current binding already shadows the key. Late static child registration only
patches `ScopeFrame.assignmentBindingsByName` when the child entry wins
source-order against later child entries. Focused setDefined tests prove both
current-binding shadow and later-child shadow keep the modeled winning target,
while the earlier winning late-registration proof still updates the new cell.

54. [x] Collapse duplicated assignment child-entry scan between entry targets
and frame targets without reintroducing temporary summary objects. Scope:
`collectPublicChildVariableAssignmentBindingsInto(...)`,
`collectPublicChildVariableAssignmentBindingsIntoFrame(...)`,
`addAssignmentTargetBinding(...)`, and `addFrameAssignmentTargetBinding(...)`.
Goal: avoid maintaining two near-identical child-entry loops while preserving
the frame-specific current-binding shadow skip and no summary-object
allocation. Acceptance: focused setDefined tests stay green, aggressive review
shows no new callback/helper ladder on ordinary lookup, and current-shadow
frame map allocation remains avoided. Current evidence:
`collectPublicChildVariableAssignmentBindingsIntoFrame(...)` was deleted.
`collectPublicChildVariableAssignmentBindingsInto(...)` now writes into either
child-entry targets or the destination `ScopeFrame`, with an optional
frame-shadow guard that skips current bindings before assignment maps allocate.
Focused setDefined tests keep current-shadow and later-child-shadow cases green.

55. [ ] Move assignment target binding cell creation onto declaration
registration/adoption when the declaration is already known static. Scope:
`collectPublicVariableAssignmentBindingsInto(...)`, direct child entry
construction, late static registration patching, and `VarDeclaration` static
registration. Goal: stop allocating fresh assignment-only `BindingCell`
objects during summary collection when registration already has the canonical
declaration and can carry or reuse a cell. Acceptance: focused setDefined tests
stay green, ordinary reads still ignore assignment targets, and aggressive
review accounts for any remaining cell allocation as semantic placement state.

56. [ ] Decide whether assignment target maps can store `BindingEntry`
directly instead of bare `BindingCell`. Scope:
`ScopeFrame.assignmentBindingsByName`, `RulesEntryLike.assignmentBindingsByName`,
`lookupScopeFrameVariable(...includeAssignmentTargets)`, and reference handle
identity. Goal: see if assignment targets can reuse declaration bucket entries
and avoid parallel source-node/value cell construction without making ordinary
reads consult assignment targets. Acceptance: focused setDefined tests stay
green, handle identity remains stable, and the tracker records whether this
unblocks item 55 or is rejected as too much hot-path shape churn.

## Latest Binding Baseline

- `scope-lookup-stress.less` counter evidence improved from
  `declaration.cacheMiss: 16560`, `declaration.childEntryEntered: 11520`,
  `declaration.childEntriesScanned: 10530`, and `declaration.framePrep: 139`
  to `declaration.cacheMiss: 7560`, `declaration.scope.v: 7560`,
  `declaration.childEntriesScanned: 1575`,
  `declaration.childEntryEntered: 1575`,
  `declaration.childEntriesFamilySkip: 5400`,
  `declaration.childEntryFamilySkip: 1575`, and `declaration.framePrep: 1`.
  This is counter evidence only, not a wall-clock speed claim.
- Function handles are per-key; callable handles use
  `Rules.callableLookupVersion`; variable/property/declaration handles use
  per-key declaration versions.
- Static stylesheet `Func` definitions now participate in registration prep
  and write through `Rules.setFunctionBinding(...)`, so function references can
  use the same direct binding/version lane as explicit function bindings.
- Reference variable lookup uses one modeled `live-current` lane. Ancestor
  variable handles track target-frame current binding freshness.
- Callable namespace lookup routes candidate, child-surface, and
  reference-import uncertainty through caller-specific decisions before using
  the old direct-crawl bridge.
- Simple exact callable misses with covered child frames skip the broad
  `findMixinsFast` child crawl; frame-less reference-import placements still
  document the remaining bridge.
- Late child additions update prepared callable child-entry facts for exact
  callable and reference-import child surfaces while invalidating stale
  covered-miss frame state.
- Current pass narrowed `findMixinsFastForUncoveredCallable(...)`: once child
  frames prove a covered miss, an uncovered reference-import or child-surface
  sibling no longer reopens the parent rules' whole child surface. The direct
  fallback now runs only on child `Rules` entries whose frame actually reported
  `uncovered`; a focused mixin test guards covered sibling surfaces.
- `Rules.findVariable(...)`, `findProperty(...)`, `findDeclaration(...)`, and
  `findAnyDeclaration(...)` declaration wrappers are deleted from `Rules`.
  Core tests now import occurrence helpers directly, and the SCSS parser
  baseline asserts AST structure instead of invoking runtime lookup. This
  removes the unreleased public-looking materialization facade rather than
  preserving it for test convenience.
- `ReferenceOptions` and `DeclarationFindOptions` no longer expose scalar
  declaration-exclusion fields or the old `excludedNodes` /
  `requiredNormalizedFromAssign` reference-option names. Production merge
  assignment now carries source/output exclusion as one semantic
  `excludedDeclarations` list; only the private reference handle snapshot keeps
  scalar declaration pointers/counts for freshness comparison.
- `pnpm run verify:binding-lookup-hot-paths` now guards that reference reads,
  selector attribute interpolation, and stylesheet function return lookup use
  occurrence helpers instead of public `Rules.find*` materialization wrappers;
  readonly assignment lookup stays isolated to explicit setDefined helper
  calls, old string-filter `Rules.findDeclaration(...)` calls stay gone, the
  deleted declaration wrapper methods stay off `Rules`, and scalar exclusion
  fields stay out of exported `ReferenceOptions`.
- Configured guarded import positives for replacement `set`, additive `with`,
  and child-surface `set`/`with` now have bridge-spy proof: they resolve
  without calling `findMixinsFast(..., searchParents: false)` for their guarded
  callable keys. The same fixtures include nonmatching guarded calls, so
  configured guarded misses also stay off the direct child-surface bridge for
  those keys.
- Reference-import guarded and default-guarded callable hits/misses now have
  bridge-spy proof: rendered reference-import callable misses and guarded
  reference-import hit/miss pairs avoid broad `Rules.findMixinsFast(...)`
  lookup for their callable keys.
- `Rules.findMixin(..., { searchParents: false })` now stops after the current
  narrowed child/reference bridge when that bridge proves no result. It no
  longer retries parent/fallback frames after a current-frame uncovered miss
  when parent search is explicitly disabled.
- Ruleset namespace, compound-prefix namespace, and mixin-namespace descendant
  direct offset walks now treat `[]` as a definitive miss instead of reopening
  legacy nested array-path fallback. `undefined` remains the unsupported/cold
  fallback signal. Focused mixin tests prove positive namespace paths and
  definite miss paths avoid nested array materialization.
- Source-static variable/property/function/mixin references now try the stored
  rules lookup handle after reference env prep and before `_lookupStrategy`
  rebuild. The early path accepts only trivial source-static handle shapes and
  still uses the normal handle reader for version, live-binding, and occurrence
  freshness.
- Covered variable reference hits/misses no longer route through the private
  `lookupVariableReference(...)` helper. Variable lookup checks scope-frame
  facts before constructing declaration fallback options; covered misses return
  immediately, and unsupported/uncovered cases keep the occurrence fallback.
- Stale design/test references to deleted declaration wrapper facades were
  cleaned up in `BINDING-INDEX-PROPOSAL.md`; remaining grep hits are either the
  direct occurrence helper names or explicit notes that the public-looking
  declaration facades are deleted.
- Guarded namespace positives in the real parser/render fixture now have
  bridge-spy proof: `#guarded > #deeper > .mixin` resolves the plain ruleset,
  silent callable namespace mixin, and defaulted guarded callable namespace
  mixin without `findMixinsFast(...)` broad crawl or nested array fallback.
- Namespaced reference-import array-path lookup no longer reports direct
  `findMixinsFast(...)` bridge hits for `#Namespace` or `.mixin` in the
  positive import-style fixture. `findRulesetNamespacePathFast(...)` now
  prepares the visible callable frame chain, treats child-surface uncertainty
  as covered only when the uncertain child is the same ruleset-prefix body
  already being descended into, and resolves terminal remainders through the
  ruleset body's callable frame/uncovered-child bridge. Focused tests also
  prove a `['#Namespace', '.missing']` miss stays off generated array fallback
  and direct crawl, while a ruleset namespace/callable namespace union still
  returns all candidates.
- Selector-list reference-import namespace array paths use the same covered
  frame route: imported multi-selector rulesets hit and miss without broad
  `findMixinsFast(...)` crawl, and only the authored array-path lookup is
  observed by the nested-array spy.
- The namespace proof helpers were moved from per-call closures into private
  `Rules` methods. This keeps the new frame-chain/prefix-ownership logic out
  of public API while avoiding fresh helper closures on each
  `findRulesetNamespacePathFast(...)` call.
- Array-path namespace starts now route child-surface/reference-import
  uncertainty through `findMixinsFastForUncoveredCallable(...)` before using
  the broad `findMixinsFast(...)` start bridge. Child-surface covered misses
  are terminal for that start; unresolved reference-import starts still fall
  back unless the narrow helper found candidates, preserving dynamic positives.
- Callable namespace descendant lookup now uses the child frame directly for
  two-segment descendant hits and stops on child-surface covered misses before
  calling nested `findMixin(...)`. A focused mixin test guards the covered-miss
  case; reference-import descendant positives inside namespace mixin bodies
  remain unclaimed/open.
- `setDefined` assignment no longer imports or calls exported
  `findVariableDeclarationAssignmentLookup` /
  `findPropertyDeclarationAssignmentLookup` wrappers. The old
  `includeReadonly: true` overload on ordinary occurrence helpers is gone too:
  `setDefined` now calls one setDefined-only apply helper, and ordinary
  `findVariableDeclarationOccurrence(...)` /
  `findPropertyDeclarationOccurrence(...)` stay branch-free occurrence-only
  APIs.
- A read-only audit found hot declaration reference callers already use
  occurrence helpers directly. `verify:binding-lookup-hot-paths` now guards
  that production runtime code under `packages/core/src` does not call public
  `Rules.find*` declaration wrappers, that stale string-family
  `findDeclaration(...)` calls stay out of parser tests too, and that the
  direct declaration lookup export surface remains occurrence helpers plus the
  one setDefined-only apply helper. The old setDefined-only
  `{ occurrence, readonly }` result object is gone; the remaining shape is a
  cold callback closure used to apply the fallback assignment without putting
  family branching back into ordinary reads.
- `pnpm run verify:baseline -- --changed` is usable again but not green on this
  branch: the latest run reached broad render/call/cloning failures in
  `@jesscss/core` and then hung in Vitest workers until interrupted. The
  namespace-focused tests and build for this pass were green; the baseline
  fallout should be triaged separately unless lookup evidence points at one of
  those failures.
- Public `ReferenceOptions.excludedDeclarations` and
  `requiredDeclarationAssignments` have semantic tests that mutate those inputs
  and verify handle invalidation. They are not scalar handle fields.
- Private declaration/property/variable handle snapshots no longer store
  `excludedDeclarationCount`; freshness compares only the declaration-
  assignment key and the first two excluded declaration identities after the
  handleability gate proves lists longer than two stay cold.
- Focused mutation-edge tests prove the first-two excluded declaration identity
  snapshot invalidates handles across zero, one, and two-slot exclusion changes
  without the removed count field.
- Declaration-constraint handle policy is now declaration-only on both reads
  and writes. The generic `lookupTypeUsesDeclarationConstraints(...)` predicate
  is gone; declaration/property/variable handle freshness uses typed
  declaration-handle helpers, and function/callable handle writers do not
  receive declaration constraint fields.
- Rules lookup handle reads are strategy-owned now. The old generic
  `readRulesLookupHandle(...)` shape is gone, function/callable/index readers
  do not accept declaration constraints, and generic
  `RulesReferenceLookupContext` no longer carries declaration-constraint
  scratch state.
- `ReferenceLookupStrategy` now has declaration-capable and plain strategy
  shapes instead of the old declaration-policy boolean flag. Handle read/write
  dispatch no longer builds the extra `readArgs` object or spread-derived
  write args.

## Remaining Work Clusters

### A. Direct Declaration And Property Lookup

1. **Explicit declaration visibility/import modes.**
   `DeclarationLookupStrategy` carries visibility pieces, and direct
   declaration child entries now carry `hasReferenceImportSurface`. Remaining
   work is proving covered import/reference hits and misses do not widen
   ordinary child scans or rediscover visibility by fallback behavior.

2. **Property merge-chain occurrence follow-through.**
   Property lookup returns `DirectDeclarationOccurrence`, and occurrences now
   carry a `slot` for same-parent source ordering. Filtered merge-chain/
   property assignment modes now use typed `requiredDeclarationAssignments`
   constraints instead of a generic merge filter, and source-static typed
   property/declaration constraints are handleable. Merge assignment now carries
   source/output exclusions as one semantic mutable list instead of hidden
   scalar option fields. Wider external declaration-exclusion filters stay
   cold. A real Less merge-chain fixture proves public property/declaration
   lookup bridges stay unused, and focused tests prove pre/post output-binding
   handle identity.

3. **Declaration/property key versioning follow-through.**
   Reference handles now use `Rules.getDeclarationLookupVersion(key)`, but the
   new per-name version map must stay a freshness mechanism, not become a
   second registry. Remaining work is proving dynamic-name/import/rules
   promotions and finishing property/declaration no-fallback proof.

4. **Direct declaration result flattening.**
   `DeclarationLookupStrategy` now carries preselected family predicates.
   Hot occurrence callers return `DirectDeclarationOccurrence | undefined`,
   the old readonly overload option is gone, and the setDefined-only
   `{ occurrence, readonly }` result object has been replaced by an apply-style
   fallback helper. Remaining work is deciding whether the setDefined callback
   closure should collapse further without adding family branching back to
   ordinary reads.

### B. ScopeFrame, Current Cells, And Assignment

1. **Frame-slot identity follow-through.**
   `BindingCell.lookupIdentity` and `ScopeFrame.currentBindingsVersion` now let
   cached variable handles validate without re-reading the current binding map.
   Ancestor variable handles now carry positive current-binding freshness
   facts, and rest arrays no longer duplicate the scalar frame. Remaining work
   is keeping cold object materialization out of simple reads.

2. **Evaluated-value cache prerequisites.**
   Cell/current-pointer lookup identity exists. Evaluated-value caching remains
   out of scope until live-current shadowing, dynamic promotion, and parent
   occurrence freshness are fully modeled and tested.

### C. Callable, Namespace, And Reference Imports

1. **Callable coverage decisions.**
   `lookupScopeFrameCallable(...)` has `hit`, `miss`, and `uncovered` reasons.
   Candidate, child-surface, and reference-import reasons now route through
   caller-specific decisions before generic direct crawl. Prepared child-rule
   entries carry exact callable/mixin/ruleset surface facts and now carry
   reference-import child-surface facts separately from exact callable facts.
   Late additions now update exact callable and reference-import child-entry
   facts without leaving stale covered-miss frame state. Guarded import tests
   proved prepared arrays cannot be trusted as a blanket aggregate miss.
   Prepared-null entries can skip child reads, covered child frames can prove
   simple exact callable misses without entering the broad child crawl, and
   rendered reference-import callable misses now prepare the existing frame
   parent chain instead of entering the no-frame direct crawl. Remaining work is
   deleting the direct-crawl bridges where facts are complete without breaking
   guarded/configured child surfaces.

2. **Parameterized terminal namespace audit.**
   Mixin-ruleset calls with parameters now reject ruleset-only terminal
   candidates while keeping rulesets as namespace containers. Existing tests
   cover recursive namespace terminals, exact ruleset terminal rejection,
   namespace containers, and ruleset-only exclusion. Remaining work is deleting
   any terminal fallback proved redundant by the final namespace no-fallback
   matrix.

3. **Namespace path/remainder allocation.**
   `collectKeyRemainder(...)` and recursive namespace helpers still rebuild
   arrays on cold fallback paths. Positive nested namespace, ruleset namespace,
   and compound-prefix namespace hits now use offsets through
   `findMixinNamespacePathFast`; callable lookup-key remainder string slicing
   has been deleted, namespace result append logic now uses one shared loop, and
   a real Less namespace fixture proves stable namespace positives avoid nested
   array-path fallback calls. Remaining work is eliminating any remaining
   positive-path `collectKeyRemainder(...)` fallback arrays and keeping arrays
   cold for guarded/imported namespaces too.

### D. Reference Handles And Fallback Bridges

1. **ReferencePlan shape.**
   `_lookupStrategy` caches the lookup family, but key normalization, shape
   prep, filters, and handle access are still per-lookup work. Declaration-only
   constraint fields no longer ride on function/callable handles. A broad
   `ReferencePlan` attempt was rejected because generated control surfaces can
   change runtime facts. Retry only for source-static facts that prove they
   delete repeated hot-path preparation.

2. **Leaky/fallback bridges.**
   Shrink fallback cases one by one: declaration fallback frames,
   callable child/reference-import bridges, property filtered fallback, leaky
   rules, and `searchScope` disqualification. Variable lookup now has one
   modeled `live-current` lane instead of a duplicate live-only retry. Active
   `searchScope` and `leakyRules` disqualification now have proof that stale
   handles are cleared and ordinary lookup rebuilds later for variable,
   property, declaration, function, mixin, and mixin-ruleset reads. Synthetic
   import/reference covered-hit and covered-miss tests plus a real
   reference-import declaration fixture now prove public declaration bridges
   stay unused. A real reference-import callable miss fixture now proves the
   frame-less callable miss can stay zero-bridge. Each remaining bridge needs a
   deletion condition and, where possible, a real Less fixture proof.

3. **Final simple-read proof.**
   Ordinary static function, simple mixin, and simple mixin-ruleset handles now
   prove no repeated public callable bridge after the first handle write, and
   simple callable handles also prove no repeated broad `findMixinsFast`
   bridge. Hot variable/property/declaration read paths now use occurrence
   helpers directly; wrapper-returning assignment helpers remain on
   `setDefined`. The lane is not done until ordinary static variable,
   property, declaration, index, merge-chain, and stable namespace reads have
   final tests/profiles proving they do not enter fallback ladders, public
   materialization wrappers, old registry-shaped search, or unnecessary child
   scans.

## Dependency Order

1. Child/import coverage facts: clusters A1, C1.
2. Property and declaration occurrence/versioning: clusters A2, A3.
3. Callable namespace semantics: clusters C1, C2, C3.
4. Handle/plan/object slimming: clusters A4, B1, D1.
5. Bridge deletion and final proof: clusters D2, D3.
6. Evaluated-value caching: cluster B2, only after slot/cell versions exist.

This is not three small passes. It is roughly seven semantic swaths plus final
proof, and some swaths may require more than one commit if tests expose a
semantic split.

## Sub-Agent Task Packets

Use sub-agents for parallel work when available. Give each agent a disjoint
ownership slice and require repo evidence, file paths, and acceptance gates.

- **Declaration explorer/worker:** `direct-rules-lookup.ts`, declaration
  child-surface tests, property merge-chain fixtures, direct lookup counters.
- **Callable explorer/worker:** `rules.ts` callable namespace paths,
  `scope-frame.ts` callable results, callable util tests, namespace/guard tests.
- **Reference-handle explorer/worker:** `reference.ts` handle access/plan
  shape, variable/property/function/callable handle tests.
- **Import/reference explorer/worker:** `import-style.ts`, reference-import
  facts, visibility/import fixtures, fallback spy tests.
- **Verifier/reviewer:** focused Vitest matrix, stale lookup wording grep,
  direct lookup profile, aggressive-cutting self-prosecution.

Workers may edit only their owned slice. They must not revert other agents'
changes. The controller integrates, resolves conflicts, runs gates, updates
handoff, commits, and pushes.

## Completion Criteria

Binding/lookup work is complete only when:

- this inventory has no remaining active cluster;
- the active binding queue above is empty and not reseeded from this inventory;
- the stale registry/lookup wording grep has no hot-path hits;
- focused lookup tests plus changed baseline gates pass;
- `scope-lookup-stress.less` profile shows old `Rules.find`/registry counters
  empty and direct lookup counters explained;
- any speed claim is backed by stable before/after benchmark evidence.
