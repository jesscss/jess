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
still resolve.

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
plus variable/property/function/callable handle tests.

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

7. [ ] Confirm scalar excluded-node handle invalidation after output binding.
Scope: merge normalization scalar getters, handle shape before/after
`bindOutput`, and stale occurrence invalidation. Goal: prove scalar exclusion
identity changes exactly when the output declaration is bound. Acceptance:
lower-level/materialization-aware handle test; do not use the rejected
render-level `Reference.eval` spy shape.

8. [ ] Prove reference-import declaration/callable misses stay on modeled
frames after retry-frame cleanup. Scope: reference import roots, rendered
reference imports, parent/fallback frames, and optional callable misses. Goal:
no regression to frame-less broad crawl. Acceptance: real reference-import
fixtures plus broad-bridge spies.

9. [ ] Move remaining declaration-constraint reference options toward
semantic names or internal constraint construction. Scope:
`ReferenceOptions.requiredNormalizedFromAssign`, `excludedNodes`, merge
normalization, and tests that construct filtered references. Goal: keep
semantic merge/exclusion behavior without exposing handle/cache-looking knobs.
Acceptance: existing semantic tests for mutable `excludedNodes` and
`requiredNormalizedFromAssign` stay green, and any renamed/internalized fields
are guarded by `verify:binding-lookup-hot-paths`.

10. [ ] Reduce or justify the remaining setDefined readonly result object.
Scope: `findSetDefinedDeclarationReadonlyOccurrence`, readonly propagation,
`setDefined`, and the `{ occurrence, readonly }` allocation. Goal: avoid a
general wrapper-looking result shape if setDefined can write through a tighter
cold helper without reintroducing ordinary-read branching. Acceptance:
setDefined/live binding tests, build, and hot-path guard stay green.

11. [ ] Delete or further isolate cold `Rules.find*` declaration wrappers that
only tests use. Scope: `findVariable`, `findProperty`, `findDeclaration`,
`findAnyDeclaration`, and remaining test helper call sites. Goal: keep public
materialization wrappers out of hot runtime and avoid preserving unreleased
surfaces solely because tests call them. Acceptance: either wrappers are
deleted with tests moved to occurrence helpers, or the tracker records the
specific cold utility reason they remain.

12. [ ] Run changed-baseline and fix any lookup-owned fallout now that the
ruleset header streaming blocker is repaired. Scope: changed Less/Jess
fixtures, ruleset render interaction with lookup work, and branch-local
failures. Goal: use baseline evidence as a gate again. Acceptance:
`pnpm run verify:baseline -- --changed` either passes or has a lookup-owned
failure recorded with a fix.

13. [ ] Refresh lookup profile and one-iteration hotpath smoke after the next
bridge deletion batch. Scope: `scope-lookup-stress.less`, direct lookup
counters, old registry counters, and smoke timings. Goal: keep counter
evidence current without claiming speed. Acceptance: profile recorded with old
`Rules.find`/registry counters empty and smoke values labeled smoke-only.

14. [ ] Extend namespace frame-chain proof to callable mixin namespaces with
reference-import descendants. Scope: no-param namespace mixins, nested
reference imports inside mixin namespace bodies, fallback frames, and
`findCallableDescendantsWithinMixinNamespaces(...)`. Goal: prevent callable
namespace descendants from falling back to broad direct crawl when child-frame
facts can prove hit/miss. Acceptance: focused mixin/import tests with
`findMixinsFast(...)` spies and union-preserving namespace positives.

15. [ ] Revisit `findVisibleCallableRulesetPrefixMatches(...)` recursive child
walk after selector-list coverage. Scope: direct child-entry flags,
reference-import child surfaces, selector-list prefix matches, and visited-set
allocation. Goal: skip child recursion when carried flags prove no ruleset
prefix can exist, without losing imported selector-list positives. Acceptance:
focused namespace/import tests plus aggressive review explaining any remaining
visited-set allocation.

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
- `Rules.findDeclaration(...)` no longer takes a string declaration-family
  branch. Variable callers use `findVariable(...)`, properties use
  `findDeclaration(...)`/`findProperty(...)`, and `findAnyDeclaration(...)`
  remains the explicit combined cold wrapper.
- `ReferenceOptions` no longer exports scalar declaration-exclusion handle
  fields (`excludedNode0`, `excludedNode1`, `excludedNodesLength`). Internal
  lookup still reads them through a declaration-constraint view when present.
- `pnpm run verify:binding-lookup-hot-paths` now guards that reference reads,
  selector attribute interpolation, and stylesheet function return lookup use
  occurrence helpers instead of public `Rules.find*` materialization wrappers;
  readonly assignment lookup stays isolated to explicit setDefined helper
  calls, old string-filter `Rules.findDeclaration(...)` calls stay gone, and
  scalar exclusion fields stay out of exported `ReferenceOptions`.
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
- `setDefined` assignment no longer imports or calls exported
  `findVariableDeclarationAssignmentLookup` /
  `findPropertyDeclarationAssignmentLookup` wrappers. The old
  `includeReadonly: true` overload on ordinary occurrence helpers is gone too:
  `setDefined` now calls one setDefined-only readonly occurrence helper, and
  ordinary `findVariableDeclarationOccurrence(...)` /
  `findPropertyDeclarationOccurrence(...)` stay branch-free occurrence-only
  APIs.
- A read-only audit found hot declaration reference callers already use
  occurrence helpers directly. `verify:binding-lookup-hot-paths` now guards
  that production runtime code under `packages/core/src` does not call public
  `Rules.find*` declaration wrappers, that stale string-family
  `findDeclaration(...)` calls stay out of parser tests too, and that the
  direct declaration lookup export surface remains occurrence helpers plus the
  one setDefined-only readonly helper. The remaining assignment wrapper shape
  is limited to the `setDefined` readonly fallback: the
  `{ occurrence, readonly }` result is returned only from that helper and
  should be reduced further only if doing so removes surface without putting
  family branching back into ordinary reads.
- `pnpm run verify:baseline -- --changed` is usable again but not green on this
  branch: the latest run reached broad render/call/cloning failures in
  `@jesscss/core` and then hung in Vitest workers until interrupted. The
  namespace-focused tests and build for this pass were green; the baseline
  fallout should be triaged separately unless lookup evidence points at one of
  those failures.
- Remaining public `ReferenceOptions.excludedNodes` and
  `requiredNormalizedFromAssign` have semantic tests that mutate those inputs
  and verify handle invalidation. They are not scalar handle fields, but their
  names still need a follow-up API-shape decision.

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
   property assignment modes now use typed `requiredNormalizedFromAssign`
   constraints instead of a generic merge filter, and source-static typed
   property/declaration constraints are handleable. Merge assignment now carries
   source/output exclusions as scalar fields instead of a temporary array.
   Wider external excluded-node filters stay cold. A real Less merge-chain
   fixture now proves public property/declaration lookup bridges stay unused.
   Remaining work is proving pre/post output-binding handle identity.

3. **Declaration/property key versioning follow-through.**
   Reference handles now use `Rules.getDeclarationLookupVersion(key)`, but the
   new per-name version map must stay a freshness mechanism, not become a
   second registry. Remaining work is proving dynamic-name/import/rules
   promotions and finishing property/declaration no-fallback proof.

4. **Direct declaration result flattening.**
   `DeclarationLookupStrategy` now carries preselected family predicates.
   Hot occurrence callers now return `DirectDeclarationOccurrence | undefined`
   without allocating the `{ occurrence, readonly }` wrapper, and the old
   readonly overload option is gone. Remaining work is deciding whether the
   two explicit setDefined readonly helpers should collapse further without
   adding family branching back to ordinary reads.

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
