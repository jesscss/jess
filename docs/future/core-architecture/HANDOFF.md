# Core Architecture Handoff

## Open This First

This is the live handoff for the core eval/render architecture work heading
toward the next alpha release. It replaces the old "node copy reduction"
framing. Node copies still matter, but they are only one cost inside the real
target: faster real-world Less evaluation/render with less total runtime work.

The active optimization target is total hot-path cost:

- fewer AST nodes and wrapper surfaces;
- fewer placement/state/tracking objects;
- fewer `WeakMap` lookups and side maps on hot paths;
- fewer recursive node walks and repeated source/placement rediscovery;
- smaller parse/execution surface in `@jesscss/core`;
- no behavior regressions and no source-tree parentage bugs.

Speed is the first-order goal. Memory pressure, object count, and module parse
size are supporting goals. Never remove one object by adding a more expensive
state graph, recursive walk, or repeated function-call ladder. Do not rob
Peter to pay Paul.

## Operating Rules

- Preserve Jess behavior. Focused parity tests are required before changing
  eval/render ownership.
- Prefer one canonical source tree plus explicit per-invocation or
  per-placement facts over broad output trees.
- Public `resolve(...)`, `eval(...)`, and compatibility/debug APIs may still
  own result nodes where mutability or API shape requires it.
- Render-only paths should emit through native syntax or direct state when a
  public result node is not required.
- State records must be smaller than the wrapper/tree they replace. They must
  not become AST v2.
- Do not generalize a helper until at least two surfaces need the same contract.
- Every queue item must either delete/narrow runtime work, prove a blocker, or
  update the deterministic tracker with evidence.

## Current Architecture Truth

- Public CSS output APIs use awaited eval/render. `safeCompile(...)` remains
  the explicit tree-surface compatibility/debug API.
- Public `preEval()` and the old `preEvaluated` flag are gone. Registration is
  explicit through `prepareRegistration()` and `registrationPrepared`.
- Production CSS render writes through `Rules.render(...)` into a flat render
  buffer. `renderNodeToBuffer(...)`, `renderNodeToWriter(...)`, and
  `renderNodeToString(...)` are internal/test bridges only.
- Base `Node.render(context)` is direct source serialization. Nodes with
  context-dependent output choose local evaluated output and serialize through
  native syntax or base render primitives.
- `$if`, `$for`, and `$while` avoid materializing control-wrapper output
  before buffer render. Loop mutation is carried through live `ScopeFrame`
  state.
- Context shadow state is intentional runtime state:
  `ScopeFrame.liveSlotsByName`, `ScopeFrame.fallbackFrame`, and
  `Context.rulesContext` are part of the target model.
- Deep copy/clone frontiers are clean. The remaining work is not hiding clone
  behind new helpers; it is deleting or narrowing the remaining eval/render
  carriers and call-path rediscovery.
- Static audit snapshot from the current branch:
  `new-node: 298`, `derive: 30`, `with-surface: 41`, `copy-leaves: 29`,
  module-context count `398`.
- Hotpath measurement remains noisy. Use it to detect clear regressions or
  wins, not to justify a tiny static-count reduction by itself.
- Shared placement vocabulary now exists in
  `packages/core/src/tree/util/placement-state.ts` and is consumed by mixin
  output slots and import first-use placement child segments.
- Callable rest and `@arguments` binding helpers now live in
  `packages/core/src/tree/util/callable-binding.ts`, reducing the inline
  `MixinCollection.evalCall(...)` closure set without changing binding
  behavior.
- At-rule body render runtime updates have a named adapter boundary:
  `createAtRuleBodyRuntimeUpdate(...)`. This is not Lane A completion; it is
  the first extracted slice around the current parallel state structures.
- Declaration contextual important handling now has separate render-only and
  public-result finalizers. Merge placeholder cleanup has a named adapter
  helper, and scalar/no-merge paths now skip adapter allocation entirely.
- Import first-use placement exposes top-level child segments and postlude
  render state. Recursive descendant source mapping remains the documented
  fallback because top-level segment lookup is the production fast path.
- RawArgs and rules-like reference state now expose narrow helper boundaries
  for diagnostics/callable source lookup; broader production consumers remain
  queued.
- Callable candidate signatures now use
  `packages/core/src/tree/util/callable-signature.ts` instead of inline
  `MixinCollection.evalCall(...)` closures. `@arguments` rest flattening is a
  callable-binding helper instead of a local loop.
- Generated mixin output wrapper construction has a named `Rules` helper:
  `createMixinOutputRulesWrapper(...)`. This removes one closure-owned wrapper
  constructor, but the larger candidate/body orchestration still lives in
  `MixinCollection`.
- Import top-level source-child lookup tries explicit placement segments
  before falling back to direct maps and recursive descendant search.
- Declaration merge render normalization now consumes a discriminated
  `createDeclarationMergeAdapterState(...)`; operation result finalization is
  named as either metadata inheritance or public-result inheritance, and
  dimension/color public result call sites consume the public boundary.
- At-rule body render state now consumes a narrow `AtRuleBodyRenderInput`.
  `AtRuleBodyEvalRecord` no longer duplicates evaluated prelude, and ruleset
  frame cleanup is owned by the body-rules eval runner helper.
- Callable default guard grouping and callable outer-rules wrapper creation now
  have named helper boundaries outside the `evalCall(...)` closure set.
  Default-guard debug counts come from the resolution pass instead of
  caller-side filter allocations.
- Import placement option reads share `getImportPlacementRenderState(...)`, and
  import postlude render order reads through `getImportPostludeRenderState(...)`.
- Source-free public direct-index container narrowing is explicitly blocked by
  mutability/parentage proof tests. Optional fallback syntax has a named
  placement helper, but production storage was rejected because it would add a
  `WeakMap`/module object for optional fallback diagnostics. Selector copy
  removal remains blocked until its ownership contracts can be reduced without
  changing public behavior.
- Rules-like reference placement now names `source`, `output`, and
  `publicBoundary`, and the rules-like call path reads parentage through
  `getRulesLikeReferenceLookupState(...)` instead of ad hoc `sourceNode` access.
- Declaration merge adapter state now avoids scalar helper allocation before
  collecting merge items and returns one discriminated item channel instead of
  parallel `listValue` / `spaceValue` properties.
- At-rule body public/render result states now consume narrow explicit adapter
  inputs instead of piggybacking on the full eval result frame. Visibility and
  layer names are stored on invocation context state instead of the eval
  record, and `AtRuleBodyRuntimeState` is documented as evaluated-node API
  compatibility rather than the direct-render model.
- Declaration merge adapter state now returns no object for scalar/no-merge
  paths. Only single replacement and real list/space render adapters allocate
  state.

## Release Direction

The next alpha should be able to say:

1. Core eval/render has a bounded architecture map with per-lane completion
   gates.
2. The largest state/carrier tangles are reduced or explicitly proven
   necessary.
3. Full queue passes advance known architecture lanes instead of adding
   passive audit chores.
4. Verification covers behavior, frontier regressions, package exports, and
   measured hot paths.

## Deterministic Architecture Lanes

Each lane has a finite completion definition. Queue work should pull from these
lanes and update the tracker when evidence changes.

### Lane A: At-Rule Body Invocation Lifecycle

**Goal:** collapse the current at-rule body state tangle into one
invocation-owned lifecycle that can feed render, public resolve, registration,
and cleanup without duplicating facts across many parallel structures.

**Current surfaces:**

- `packages/core/src/tree/at-rule.ts`
- `AtRuleBodyFrameState`
- `AtRuleBodyOutputState`
- `AtRuleBodyRuntimeState`
- `AtRuleBodyEvalContextState`
- `AtRuleBodyEvalRecord`
- `AtRuleBodyRegistrationState`
- `AtRuleBodyEvalPrepState`
- `AtRuleBodyRenderState`
- `AtRuleBodyEvalResult`
- `AtRuleBodyPublicResultState`

**Target invariants:**

- One invocation record owns source at-rule, optional owned eval/public frame,
  evaluated prelude, body-to-eval/final-rules pairing, visibility, layer name,
  extend-root marker, hoist/root output, frame cleanup, and async cleanup.
- Runtime `WeakMap` fallback remains only for evaluated-node render APIs that
  cannot yet receive an invocation record.
- Direct render must not write prelude/body/visibility/frame facts onto the
  canonical source at-rule.
- Public resolve may own a result at-rule, but the result adapter must be a
  boundary, not the body eval scratch frame.

**Completion gates:**

- [ ] At-rule body lifecycle has one primary invocation record type and no
      duplicate prelude/body/output fields across parallel result/render/public
      state types unless each duplicate has a documented API boundary.
- [x] Async rejection cleanup, frame restoration, extend-root cleanup, and
      layer-record pop are all tested through one runner path.
- [x] `AtRuleBodyRuntimeState` is deleted or documented as evaluated-node API
      compatibility only, with no direct-render scratch writes.
- [ ] Dynamic body/root-hoist render tests prove canonical source parentage is
      unchanged.
- [ ] Focused at-rule tests and `verify:baseline -- --changed` pass.

**Next queue seeds:**

1. Inventory every duplicated field across the current at-rule state types,
   then merge one pair into the invocation record with focused async and
   root-hoist tests.
2. Move cleanup ownership into a single record runner and delete one separate
   cleanup/restore helper.
3. Prove whether body render can consume the invocation record directly,
   without building a separate `AtRuleBodyRenderState`.

### Lane B: Rules Container And Callable/Mixin Extraction

**Goal:** shrink `Rules` from the central container for rendering,
registration, lookup, and mixin invocation into clearer modules with fewer
cross-purpose helper closures and less parse cost.

**Current surfaces:**

- `packages/core/src/tree/rules.ts`
- `MixinCollection`
- callable entry binding helpers
- registration prep state
- rules render/resolve state
- generated mixin output surface construction

**Target invariants:**

- `Rules` owns rule-container behavior: child adoption, registration,
  rendering, lookup, and document/root ordering.
- Callable/mixin invocation owns parameter binding, candidate evaluation,
  `@arguments`, rest binding, caller fallback, and output-slot attachment.
- Shared helper modules must have explicit data contracts and no circular
  dependency workaround comments as permanent architecture.

**Completion gates:**

- [ ] `MixinCollection` and callable binding helpers are extracted from
      `rules.ts` or the remaining in-file boundary is explicitly justified by a
      dependency graph.
- [ ] `rules.ts` line count and import surface are measurably reduced without
      adding extra runtime indirection in hot mixin calls.
- [x] Mixin output construction calls through a named helper family with
      focused output-slot tests.
- [x] Callable default grouping and outer-rules wrapper creation have named
      helper boundaries with focused coverage.
- [ ] Focused mixin/rules tests and changed baseline pass.

**Next queue seeds:**

1. Draw the actual dependency graph for `MixinCollection` and extract the
   smallest pure helper group that does not introduce circular imports.
2. Move rest/arguments binding construction into a callable invocation helper
   and measure rawArgs/mixin hot paths.
3. Delete stale commented registry scaffolding once adjacent extraction tests
   cover the live behavior.

### Lane C: Placement Record Convergence

**Goal:** make placement state a small shared architecture vocabulary instead
of several unrelated mini-patterns.

**Current surfaces:**

- `MixinOutputSlot` in `packages/core/src/tree/util/mixin-output-slot.ts`
- import placement `WeakMap`s in `packages/core/src/tree/import-style.ts`
- call/rawArgs placement in `packages/core/src/tree/call.ts` and
  `packages/core/src/define-function.ts`
- rules-like reference preservation in `packages/core/src/tree/reference.ts`
- generated pseudo and ampersand placement states

**Target vocabulary:**

- `source`: canonical source owner.
- `output`: owned output carrier when one still exists.
- `children`: explicit source/output child segments when children are relevant.
- `visibility`: reference/public/optional visibility facts.
- `scope`: scope frame, caller fallback, or lookup frame facts.
- `publicBoundary`: whether public API mutability still requires an owned node.
- `renderFacts`: text/order/cache facts needed only for render.

**Completion gates:**

- [x] Mixin output and import placement expose compatible child-segment helper
      shapes.
- [x] Call/rawArgs, rules-like references, and generated selectors each name
      which placement vocabulary fields they use and which they intentionally
      do not.
- [ ] No new placement state is introduced without declaring whether it is
      per-invocation, per-output-node, or per-context.
- [x] At least one repeated source/placement rediscovery walk is replaced by a
      placement record lookup and measured or proven by focused tests.

**Next queue seeds:**

1. Add a tiny shared placement type vocabulary in docs or a util module, then
   align one import/mixin helper pair to it.
2. Replace one import descendant source lookup with an explicit child-segment
   lookup.
3. Update generated selector placement docs/tests to identify which vocabulary
   fields are still wrapper-owned.

### Lane D: Import Placement And Postlude State

**Goal:** keep import semantics correct while reducing owned placement
wrappers, recursive source mapping, cache-hit option wrappers, and postlude
rediscovery.

**Current surfaces:**

- `deriveRulesSurface(...)`
- `ImportPlacementState`
- `ImportPlacementOptionsState`
- `ImportPostludePlacementState`
- `collectImportPlacementSourceMap(...)`
- `findImportPlacementSourceDescendant(...)`

**Target invariants:**

- First-use import placement must not let canonical imported source nodes be
  adopted by the first import site.
- Cache-hit reference/multiple/dedupe options must be explicit side facts when
  they do not require a new wrapper.
- Postlude order (`@layer`, `@media`, `@supports`) should be recorded once and
  consumed directly by render/source-map/diagnostic paths.
- Recursive source/placement walks should be replaced with explicit segments
  where possible.

**Completion gates:**

- [x] First-use child mapping uses explicit segments for top-level children.
- [x] Recursive descendant mapping is either deleted or isolated to one
      documented fallback with focused tests.
- [x] Postlude order has at least one production consumer beyond tests.
- [x] Cache-hit option state has one render/lookup consumer that does not read
      wrapper options directly.

**Next queue seeds:**

1. Convert first-use import placement children to the same segment shape used
   by mixin output slots.
2. Route one source-map or diagnostic path through `ImportPostludePlacementState`.
3. Align `deriveRulesSurface(...)` with the shared Rules-surface helper family
   only if focused tests prove no extra function-call or wrapper cost.

### Lane E: Rules-Like References And Direct-Index Results

**Goal:** keep public result APIs mutable while reducing render-only ownership
for references, direct-index hits, and rules-like values.

**Current surfaces:**

- `packages/core/src/tree/reference.ts`
- `RulesLikeReferencePreservationRecord`
- dynamic fallback `List`/`Sequence` render
- public direct-index container resolve

**Target invariants:**

- Render may use text-only or placement-state output when no public mutable
  result is required.
- Public `resolve(...)` continues to own source-backed containers and
  rules-like callable surfaces until mutability/lookup tests prove otherwise.
- Rules-like preservation records should be the source of callable facts, not
  ad hoc `sourceNode` reads.

**Completion gates:**

- [x] Every rules-like preservation consumer reads an explicit lookup record or
      has a documented blocker.
- [x] Source-free direct-index public container narrowing is either implemented
      or blocked by a mutability/parentage proof.
- [ ] Reference-stack cleanup has focused tests for both text-only and owned
      output paths.

**Next queue seeds:**

1. Move one callable/source lookup consumer to
   `getRulesLikeReferenceLookupState(...)`.
2. Retry frozen source-free public direct-index `List`/`Sequence` results with
   mutability assertions.
3. Add a blocker proof for rules-like wrapper ownership if a callable path
   still needs the shallow owned surface.

### Lane F: Declaration, Operation, And Public Result Adapters

**Goal:** split render-only text/facts from public mutable result nodes across
declarations, assignment/merge output, contextual important, and operation
results.

**Current surfaces:**

- `packages/core/src/tree/declaration.ts`
- `DeclarationEvalState`
- `DeclarationRenderState`
- `DeclarationValueState`
- `DeclarationRegistrationState`
- `finalizeContextualImportantState(...)`
- dimension/color `finalizeOperationResult(...)`

**Target invariants:**

- Render-only declaration output must not materialize prepared declaration
  surfaces.
- Assignment/merge render can use adapter state for separator, source order,
  placeholder cleanup, and important text.
- Public resolve/eval owns result nodes where flags, parentage, or mutation
  require nodes.

**Completion gates:**

- [x] Contextual important has separate render-only and public-result
      finalizers.
- [x] At least one declaration merge family renders from adapter state without
      constructing a temporary printer container.
- [x] Scalar/no-merge declaration paths avoid constructing no-op merge adapter
      state.
- [x] Operation result finalization has one shared public-result boundary and
      no duplicated metadata inheritance rules.

**Next queue seeds:**

1. Split public contextual-important finalization from render-only text
   finalization.
2. Prototype list-merge adapter state for one nested `&,:` or `+_:` family.
3. Audit dimension/color operation result construction for duplicated
   metadata-only allocation.

### Lane G: Dynamic Call And Function Argument State

**Goal:** reduce copied dynamic-call surfaces, raw argument wrappers, and
function-call overhead while preserving user-code mutation APIs.

**Current surfaces:**

- `packages/core/src/tree/call.ts`
- `CallEvalState`
- `CallContentPlacementState`
- `CallRawArgsPlacementState`
- `RawArgsPlacementState`
- metadata `this.rawArgs`
- `callWithContext(...)`

**Target invariants:**

- Plain JS calls pass positional args directly.
- Metadata calls keep exactly the mutable `rawArgs` surface required by public
  user-code API.
- Optional fallback CSS calls render finalized syntax without re-entering name
  evaluation or owning a fallback `Call` unless public resolve requires it.
- RawArgs placement should support diagnostics/source lookup without walking
  the owned rawArgs tree by default.

**Completion gates:**

- [x] rawArgs placement has one diagnostics or validation consumer.
- [ ] Metadata and non-metadata call paths stay measured separately.
- [ ] Fallback content/name state has no copied `Call` surface in render-only
      paths.

**Next queue seeds:**

1. Route one metadata diagnostic/source helper through rawArgs placement.
2. Measure call-path function overhead before and after any rawArgs changes.
3. Split fallback name/content public-result construction from render state in
   one focused case.

### Lane H: Generated Selector And Extend Placement

**Goal:** reduce selector/output ownership only when placement state can carry
parentage, visibility, extend metadata, selector-bit library, hoist/root
placement, and composed header cache.

**Current surfaces:**

- `GeneratedPseudoPlacementState`
- `AmpersandAppendPlacementState`
- selector `withComponents(...)` / `withSelectors(...)`
- `ownCollapsedSourceChild(...)`
- extend selector copy helpers

**Target invariants:**

- Never call `inherit(...)` on a canonical source child just to reuse it as
  collapsed output.
- Generated selector state must not become a parallel selector AST.
- Selector-bit metadata and composed header caches must stay correct for
  nested, generated, and extended selectors.

**Completion gates:**

- [ ] One generated pseudo or ampersand placement fact is carried in declared
      state and consumed by render/extend code.
- [x] One selector helper family is reduced or blocked by parentage/visibility
      proof.
- [ ] Selector render and extend integration tests cover the changed shape.

**Next queue seeds:**

1. Move one generated `:is(...)` omission or keyset fact into declared
   placement state.
2. Reduce one `withComponents(...)` family only after collapse/parentage tests
   are red first.
3. Add an extend blocker proof where selector copies remain semantic.

### Lane I: Cross-Node Render Contract Coverage

**Goal:** make "all nodes should do X and not Y" trackable per node family,
not folklore.

**Contract rules:**

- Static/source-only nodes should use base `Node.render(...)` unless they
  inherit from a context-dependent base and must opt back into source render.
- Context-dependent nodes should override `render(...)`, choose evaluated
  output locally, and render through native syntax or base output primitives.
- Render-only paths should not call public `resolve(...)` just to get a
  printable node.
- Public `resolve(...)` may own mutable result nodes.
- New wrapper/state carriers need focused parentage and output tests.

**Node-family tracker:**

| Family | Current state | Completion gate |
| --- | --- | --- |
| `Rules` | Direct root/fragment render state exists; callable binding, signature, default grouping, outer-rules, and generated output-wrapper helpers are extracted, but `MixinCollection` still owns candidate/body orchestration. Debug default counts no longer add filter allocations. | Callable extraction complete or explicitly blocked; direct render context state bounded. |
| `AtRule` | Leaf render split; body invocation state still large, but render and public-result inputs are narrowed, duplicate prelude storage was removed from the eval record, visibility moved onto invocation context state, and body-rules frame cleanup is runner-owned. Runtime `WeakMap` writes are now documented as public/evaluated-node compatibility or temporary render-state installation. | Lane A gates complete. |
| `Ruleset` | Static body direct render exists; dynamic/nil bodies still own body surfaces. | Dynamic body side-state either implemented for one scalar family or blocked. |
| `Declaration` | Render state avoids prepared declaration materialization; contextual important public/render finalizers are split and merge render normalization uses a strict discriminated adapter state with scalar early return and no parallel list/space checks. Sequence-space merge output is covered by adapter-state proof. | Remaining declaration-state duplication tracked. |
| `Call` | Fallback render state exists; rawArgs remains owned API boundary with diagnostic-source and diagnostic-message helpers. Optional fallback public syntax construction has a named adapter and placement vocabulary (`source`, `output`, `content`, `publicBoundary`), but no production storage after the WeakMap experiment regressed static object counts. | Call overhead measurement complete and fallback render/public split advanced. |
| `Reference` | Text-only render exists for many scalar/container paths; rules-like wrappers remain with explicit source/output/public-boundary placement state and callable ownership proof. Source-free public direct-index container ownership is intentionally retained for mutability/parentage. | Rules-like lookup state consumed or blockers captured. |
| `List` / `Sequence` | Dynamic render streams through native syntax; public resolve owns containers. Source-free public narrowing is blocked by public mutation/parentage expectations. | Revisit only if public mutability API changes. |
| `Block` / `Quoted` / `Url` / `Paren` / `Operation` | Render-only wrappers largely split from public resolve; operation finalization now distinguishes metadata-result inheritance from public-result inheritance, with dimension/color public consumers. | No generic output bridge reintroduced; focused materialization proofs stay green. |
| `StyleImport` | First-use top-level placement segments and postlude render state exist; top-level source lookup consumes segments before recursive fallback. Postlude order and option reads now consume render state; descendant mapping remains fallback-only. | Lane D gates complete except any future descendant segment reduction. |
| Selectors / `Ampersand` / `Extend` | Ownership still semantic for generated/extended placement. Generated `:is(...)` omission/keyset state is already declared and render-consumed; reduction is blocked by existing extend/parentage proof coverage until a narrower helper can preserve semantics. | Lane H gates complete. |
| Controls | Loop render streams direct rules; live frame mutation intentional. | Remaining grouping/state surfaces audited by object/function-call cost. |

Update this tracker when a node family changes architectural state.

## Immediate Queue

This is a pop queue. Keep at least fifteen concrete items here. A normal
handoff round should complete all fifteen queued items unless the user asks
for a smaller slice. When an item is completed, remove it and add or promote
enough work to leave the queue full for the next round.

A full queue run is not finished until code/docs changes are verified,
committed, and pushed to the current branch.

Queue items must be architecture-sized, not line-sized. A good queue item:

- names the lane it advances;
- names the production surface and focused tests;
- states the intended deletion, narrowing, measured speed win, or blocker
  proof;
- updates the lane completion gate or node-family tracker.

Avoid pure "audit and document" items unless they produce a bounded inventory
that gates a specific lane.

### Completed Queue Rollup

Keep this section compact. Detailed proof lives in git history and focused
tests; this handoff should preserve only the current architectural state needed
to choose the next queue.

- Passes 1-6 reframed the work from node-copy reduction to total runtime work:
  AtRule body runtime/render adapters, callable binding/signature/default
  helpers, mixin output wrappers, shared placement vocabulary, import placement
  child/postlude state, declaration merge/contextual-important adapters,
  rawArgs diagnostics, rules-like reference helpers, operation public-result
  aliases, narrowed AtRule render/public adapters, callable default debug-count
  cleanup, optional fallback syntax helper rejection, and bounded blockers for
  public direct-index and selector ownership.

### Completed Queue Pass: 2026-06-01 #7

1. Lane A moved AtRule body `layerName` from `AtRuleBodyEvalRecord` into
   `AtRuleBodyEvalContextState`, deleting another parallel invocation fact.
2. Lane A split `AtRuleBodyRenderInput` into an explicit render adapter shape
   instead of a `Pick<AtRuleBodyEvalResult, ...>`, narrowing the type overlap
   without adding a runtime object.
3. Lane A documented `AtRuleBodyRuntimeState` as evaluated-node API
   compatibility so future work does not treat the `WeakMap` bridge as the
   direct-render target model.
4. Lane B kept callable candidate extraction blocked: no candidate helper in
   this pass deleted closure work, so moving code would only add indirection.
5. Lane B kept default-guard probing in place because the current pass had no
   no-extra-call proof for another split.
6. Lane B/G measured after the pass with no callable production changes:
   rawArgs stayed neutral (`0.0003ms` plain median, `0.0021ms` metadata
   median), Less hotpath remained noisy, and static audit stayed at
   `new-node: 298` / module context `398`.
7. Lane C found no real optional fallback placement consumer and added no
   `WeakMap` or side state.
8. Lane C/D kept nested import child-segment state blocked until a red test can
   prove it removes recursive descendant lookup rather than adding broad
   per-child state.
9. Lane D kept an import descendant fallback counter out of production; any
   future counter must be debug/test-only.
10. Lane E documented `PreservedRulesLikeValue.sourceNode` as public-shape
    compatibility beside the rules-like lookup state boundary.
11. Lane F changed declaration merge adapter creation so scalar/no-merge paths
    return `undefined` instead of allocating `{ kind: 'none' }`, with focused
    Declaration tests pinning the contract.
12. Lane F kept operation metadata finalizer aliases out; this pass did not
    expose a public/package-export need for another compatibility name.
13. Lane G kept fallback render text separate from public fallback `Call`
    output; no owned fallback call or placement state was added without a real
    consumer.
14. Lane H kept selector-copy removal blocked pending a red parentage test that
    proves a narrower state can preserve current ownership behavior.
15. Lane I compacted completed-pass history and refreshed current truth plus
    the next queue around remaining architecture gates.

### Next Queue

1. **Lane A: move or justify one more AtRule body output fact.**

   Target `output` or `evaluatedBody`; delete a duplicate storage site only if
   async cleanup, root-hoist, and layer tests stay green.

2. **Lane A: inventory remaining duplicated AtRule body fields.**

   Update the lane with each duplicate field, its API boundary, and whether it
   should move into invocation context or remain compatibility state.

3. **Lane A: test direct body render against runtime-state writes.**

   Add or extend a focused test only if it proves render can consume invocation
   state directly without writing the evaluated-node `WeakMap` bridge.

4. **Lane B: draw the `MixinCollection` dependency graph.**

   Name the smallest callable/mixin helper group that can leave `rules.ts`
   without circular imports or extra hot-path calls.

5. **Lane B: extract only a callable helper that deletes closure work.**

   Revisit candidate/default/rest normalization with a red test and before
   measurement; reject helper growth that keeps the same loop allocations.

6. **Lane B/G: compare callable parse/runtime cost after the next helper slice.**

   Use rawArgs and Less hotpath timings to decide whether a helper split is
   neutral or actually reduces work.

7. **Lane C: find a real optional fallback placement consumer before storing state.**

   Do not add a WeakMap or side state unless a production diagnostic/source
   path consumes it and the audit remains neutral.

8. **Lane C/D: write a red nested import child-segment test before adding state.**

   Keep it only if it removes a recursive lookup and does not add broad
   per-child state.

9. **Lane D: decide whether import descendant fallback needs a counter.**

   Add a diagnostic only if it can be debug/test-only and cannot affect import
   runtime object count.

10. **Lane E: remove one ad hoc rules-like `sourceNode` read if possible.**

   Use `getRulesLikeReferenceLookupState(...)` where the value is a preserved
   rules-like surface; keep public compatibility `sourceNode` only at the
   boundary.

11. **Lane F: check whether declaration `value` adapter state can narrow again.**

   Keep the `value` channel only where single merged-item replacement or empty
   placeholder preservation requires it.

12. **Lane F: decide whether operation metadata finalizer needs a compatibility alias.**

   Keep the alias out if package-export and source scans prove no public
   consumer needs it.

13. **Lane G: add a render-only optional fallback proof without storage.**

   Target one optional failure case where render emits syntax without building
   an owned fallback `Call` or storing placement state.

14. **Lane H: choose one selector-copy candidate with red parentage tests.**

   Do not remove selector copies until tests prove the current ownership
   requirement and a narrower state can preserve it.

15. **Lane I: keep completed-pass history compact and evidence-linked.**

   On each queue completion, roll older pass details into the compact summary
   and keep only the newest pass plus active queue detailed.

## Measurement And Verification

Use the smallest focused test while iterating. Before claiming a handoff-level
status change, run the checks that match the touched surface.

Standard architecture gate:

```sh
pnpm run audit:node-creation
pnpm run verify:node-copy-frontier
pnpm run verify:render-buffer-frontier
pnpm run verify:materialization-frontier
pnpm run verify:package-exports
pnpm run verify:baseline -- --changed
```

Performance-sensitive changes should also run:

```sh
pnpm run measure:less:hotpath
```

Function-call or rawArgs changes should also run the focused microbenchmark
used by recent passes:

```sh
node scripts/measure-callwithcontext-rawargs.mjs 750
```

Use the full baseline when a change touches root gates, package metadata,
shared verifier scripts, or broad render/eval contracts:

```sh
pnpm run verify:baseline
```

## Checkpoint Rule

A checkpoint is one coherent code or docs change with verification. If a lane
is too large, finish the smallest honest slice that leaves the repo and this
handoff more truthful than before.

For each checkpoint:

1. Read relevant source and focused tests before editing.
2. Make the smallest behavior-preserving change.
3. Run focused proof first.
4. Run the nearest broader verification.
5. Update this handoff if current truth, completion gates, tracker rows, or
   immediate queue changed.
6. Commit and push when clean.

For a full 15-item queue run, step 6 is mandatory: after verification, create a
coherent commit that includes the production/test/handoff changes for that
queue run and push it to the branch's tracked remote. If the worktree contains
unrelated user changes, either leave them unstaged or stop and record why the
commit cannot be made safely.

## Historical Notes

The old handoff path remains as a compatibility pointer:
`docs/future/node-copy-reduction/HANDOFF.md`.

The hotpath history file currently remains at:
`docs/future/node-copy-reduction/less-hotpath-history.jsonl`.

Do not resurrect the old framing as the primary queue. If a future change only
reduces AST node copies while adding more tracking objects, recursive walks, or
function-call overhead, it must prove a real speed or memory win.
