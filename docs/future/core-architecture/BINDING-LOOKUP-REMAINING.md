# Binding And Lookup Remaining Work

This is the burn-down inventory for the registryless binding/lookup lane. Keep
`HANDOFF.md` focused on the active queue; update this file only when the total
remaining scope changes.

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
   without allocating the `{ occurrence, readonly }` wrapper. Remaining work is
   isolating the readonly wrapper to cold setDefined assignment and proving
   simple reads do not allocate public materialization wrappers or fallback-only
   details.

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
   Guarded import tests proved prepared arrays cannot be trusted as a blanket
   aggregate miss. Prepared-null entries can skip child reads, covered child
   frames can prove simple exact callable misses without entering the broad
   child crawl, and rendered reference-import callable misses now prepare the
   existing frame parent chain instead of entering the no-frame direct crawl.
   Remaining work is deleting the direct-crawl bridges where facts are complete
   without breaking guarded/configured child surfaces.

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
   bridge. The lane is not done until ordinary static variable, property,
   declaration, index, merge-chain, and stable namespace reads have final
   tests/profiles proving they do not enter fallback ladders, public
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
- `HANDOFF.md` active queue is empty and not reseeded from this file;
- the stale registry/lookup wording grep has no hot-path hits;
- focused lookup tests plus changed baseline gates pass;
- `scope-lookup-stress.less` profile shows old `Rules.find`/registry counters
  empty and direct lookup counters explained;
- any speed claim is backed by stable before/after benchmark evidence.
