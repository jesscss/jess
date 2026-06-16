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
   `DeclarationLookupStrategy` carries visibility pieces, but import/reference
   mode is not yet a complete first-class direct lookup mode. Covered
   import/reference declaration hits and misses should carry visibility facts
   instead of discovering them by fallback behavior.

2. **Property merge-chain occurrence slots.**
   Property lookup returns `DirectDeclarationOccurrence`, but filtered
   merge-chain/property assignment modes still need occurrence slots that carry
   merge metadata and assignment normalization. Delete the remaining filtered
   fallback for modeled property modes rather than shadowing it.

3. **Declaration/property key versioning.**
   Variable/property/declaration handles still depend on broad
   `Rules.lookupVersion`. Split key/family versions only when the affected-key
   semantics are clear enough to prove unrelated writes keep cached handles
   fresh.

4. **Direct declaration strategy flattening.**
   After child-entry scans are under control, collapse
   `DeclarationLookupStrategy` object branching by assigning the lookup
   functions and constants once per typed path.

### B. ScopeFrame, Current Cells, And Assignment

1. **Frame-slot identity.**
   Current variable handles are `ScopeFrameVariableBindingHandle` objects and
   declaration hits are `DirectDeclarationOccurrence` objects. The end state is
   closer to frame plus slot/cell identity, with cold object materialization
   only where a public/cold API needs it.

2. **Cell/current-pointer versions.**
   `BindingCell` has value state but not explicit value/current-pointer
   versions. Evaluated-value caching stays out of scope until those versions
   exist. Lookup identity caching can proceed first.

### C. Callable, Namespace, And Reference Imports

1. **Callable coverage decisions.**
   `lookupScopeFrameCallable(...)` has `hit`, `miss`, and `uncovered` reasons.
   Finish caller-specific handling for `candidate`, `child-surface`, and
   `reference-import` so ordinary covered misses stop before direct crawl.

2. **Parameterized terminal namespace lookup.**
   Mixin-ruleset calls with parameters should keep rulesets as namespace
   containers but reject exact ruleset terminals at the terminal segment when
   only mixins can satisfy the call.

3. **Namespace path/remainder allocation.**
   `collectKeyRemainder(...)`, `getCallableLookupKeyRemainder(...)`, and
   recursive namespace helpers still rebuild arrays/strings. Replace with an
   offset/path view after namespace semantics are stable.

### D. Reference Handles And Fallback Bridges

1. **ReferencePlan shape.**
   `_lookupStrategy` caches the lookup family, but key normalization, shape
   prep, filters, and handle access are still per-lookup work. Promote stable
   static reference facts into a small plan shape only when it deletes repeated
   hot-path preparation.

2. **Leaky/fallback bridges.**
   Shrink fallback cases one by one: variable live-only fallback, declaration
   fallback frames, callable child/reference-import bridges, leaky rules, and
   `searchScope` disqualification. Each bridge needs a deletion condition and a
   covered-hit/miss spy.

3. **Final simple-read proof.**
   The lane is not done until ordinary static variable, property, declaration,
   function, simple callable, and stable namespace reads have tests/profiles
   proving they do not enter fallback ladders, public materialization wrappers,
   old registry-shaped search, or unnecessary child scans.

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
