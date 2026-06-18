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

3. [ ] Delete any remaining simple exact callable child scans that are
provably covered by frame facts. Scope: current-frame miss, child-entry family
skip, child-frame covered miss, and terminal mixin-only mode. Goal: avoid
child-surface crawl when the frame already says the family/key cannot hit.
Acceptance: `findMixinsFast` spy tests for simple mixin and mixin-ruleset
misses.

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
record/eliminate any remaining `findMixinsFast(...)` bridge hits.

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
failure recorded with a fix. Current evidence: the changed baseline was run
after the setDefined/direct-declaration cache pass. It built `@jesscss/core`
and then entered the full core test suite, surfaced broader render/string
transport failures (`node-render-buffer.test.ts`, `call.test.ts`, `any.test.ts`,
`cloning.test.ts` in the visible output), and then stopped producing output
while Vitest workers remained active. It was interrupted rather than left
running. No failure in the visible output pointed at the binding lookup files
touched in this pass; keep this item open until the baseline can finish or the
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
positives inside namespace mixin bodies are still open and must not be claimed
covered.

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

13. [ ] Finish explicit declaration visibility/import no-fallback proof.
Scope: `DeclarationLookupStrategy`, reference-import child entries, import
visibility, and covered declaration/property hits and misses. Goal: ordinary
declaration/property lookup does not widen to child scans or public bridge
behavior when visibility facts are modeled. Acceptance: synthetic import
covered-hit/miss tests plus at least one real reference-import declaration
fixture with bridge spies. Current evidence: the real `@import(reference)`
hit/miss fixture now includes an imported property declaration. Direct property
occurrence lookup finds the imported property and misses a missing imported
property through the direct helper, while the same fixture spies on
`Rules.find(...)` and proves rendered variable hit/miss references do not enter
the public declaration bridge. Property references inside later nested rulesets
do not share the same visibility semantics as direct imported property
occurrence lookup, so broader rendered property-reference proof remains open.

14. [x] Finish property merge-chain output-binding handle identity proof.
Scope: merge normalization, source/output exclusions, same-parent source
ordering slots, and pre/post `bindOutput` identity. Goal: merge-chain property
reads keep using direct occurrences and reject only stale constrained handles.
Acceptance: lower-level handle tests plus real Less merge-chain fixture proof.
Current evidence: focused reference tests prove mutable assignment constraints,
source/output exclusion identity mutation after `bindOutput`, and wider
external exclusion lists staying cold; the real Less merge-chain fixture still
avoids public property/declaration lookup bridges.

15. [ ] Finish declaration/property key-versioning dynamic promotion proof.
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
and lookup-cache entries, and preserve unrelated miss cache entries. Nested
`Rules` child declaration surfaces still clear the whole direct declaration
bucket/cache and bump the global declaration lookup version. Style import
promotion remains open.

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

18. [ ] Collapse declaration-handle constraint shape branching where possible.
Scope: `lookupTypeUsesDeclarationConstraints(...)`,
`getRulesLookupHandleDeclarationConstraintShape(...)`,
`prepareRulesLookupShape(...)`, source-static early handle reads, and variable
handles that can carry declaration occurrences. Goal: keep declaration
constraint checks assigned to the declaration/property/variable paths that need
them without making function/callable paths carry generic shape branches.
Acceptance: focused variable/property/declaration/function/callable handle
tests plus no regression in `verify:binding-lookup-hot-paths`.

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

20. [ ] Split declaration-constraint handle shape from generic
`RulesLookupHandleShape`. Scope: shape construction, `prepareRulesLookupShape`,
`readRulesLookupHandle`, source-static handle reads, and handle write helpers.
Goal: keep generic lookup shape to start/local/terminal facts, and pass
declaration constraints only on declaration-capable handle paths without adding
function/callable branches. Acceptance: focused handle tests plus
`verify:binding-lookup-hot-paths`; aggressive review must show fewer generic
shape fields or fewer declaration-constraint branches.

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
