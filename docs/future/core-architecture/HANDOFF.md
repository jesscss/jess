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
  helper, but render-side merge adapters remain incomplete.
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
- Declaration merge render normalization now consumes
  `createDeclarationMergeAdapterState(...)`; operation public-result
  finalization has a named adapter alias and at least one dimension/color
  public result call site consumes it.
- At-rule body render state now has an invocation-result adapter boundary:
  `createAtRuleBodyRenderState(...)`. `AtRuleBodyEvalResult` remains exported
  because render-state construction still consumes that compatibility shape.
- Callable default guard grouping and callable outer-rules wrapper creation now
  have named helper boundaries outside the `evalCall(...)` closure set.
- Import placement option reads share `getImportPlacementRenderState(...)`, and
  import postlude render order reads through `getImportPostludeRenderState(...)`.
- Source-free public direct-index container narrowing is explicitly blocked by
  mutability/parentage proof tests. Optional fallback public construction and
  selector copy removal likewise remain blocked until their current ownership
  contracts can be reduced without changing public behavior.

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
- [ ] Async rejection cleanup, frame restoration, extend-root cleanup, and
      layer-record pop are all tested through one runner path.
- [ ] `AtRuleBodyRuntimeState` is deleted or documented as evaluated-node API
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
- [ ] Call/rawArgs, rules-like references, and generated selectors each name
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

- [ ] Every rules-like preservation consumer reads an explicit lookup record or
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
| `Rules` | Direct root/fragment render state exists; callable binding, signature, default grouping, outer-rules, and generated output-wrapper helpers are extracted, but `MixinCollection` still owns candidate/body orchestration. | Callable extraction complete or explicitly blocked; direct render context state bounded. |
| `AtRule` | Leaf render split; body invocation state overgrown; render runtime-update and render-state construction have named adapter boundaries. Cleanup remains runner-owned but not collapsed enough to delete state types. | Lane A gates complete. |
| `Ruleset` | Static body direct render exists; dynamic/nil bodies still own body surfaces. | Dynamic body side-state either implemented for one scalar family or blocked. |
| `Declaration` | Render state avoids prepared declaration materialization; contextual important public/render finalizers are split and merge render normalization uses adapter state. Sequence-space merge output is covered by adapter-state proof. | Remaining declaration-state duplication tracked. |
| `Call` | Fallback render state exists; rawArgs remains owned API boundary with diagnostic-source and diagnostic-message helpers. | Call overhead measurement complete and fallback render/public split advanced. |
| `Reference` | Text-only render exists for many scalar/container paths; rules-like wrappers remain with callable-source helper boundary and ownership proof. Source-free public direct-index container ownership is intentionally retained for mutability/parentage. | Rules-like lookup state consumed or blockers captured. |
| `List` / `Sequence` | Dynamic render streams through native syntax; public resolve owns containers. Source-free public narrowing is blocked by public mutation/parentage expectations. | Revisit only if public mutability API changes. |
| `Block` / `Quoted` / `Url` / `Paren` / `Operation` | Render-only wrappers largely split from public resolve; operation finalization has a named public-result alias over the shared metadata boundary and a dimension/color consumer. | No generic output bridge reintroduced; focused materialization proofs stay green. |
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

### Completed Queue Pass: 2026-05-31

This pass completed the first architecture queue against the reframed core
handoff:

1. Lane A extracted `createAtRuleBodyRuntimeUpdate(...)` and covered it with
   focused at-rule state tests.
2. Lane A recorded that cleanup ownership is still not collapsed; the next
   queue keeps this as a runner-lifecycle item instead of pretending this slice
   completed the lane.
3. Lane B extracted callable rest and `@arguments` binding helpers from
   `MixinCollection.evalCall(...)`.
4. Lane B added focused callable binding tests around rest cloning and
   `@arguments` reuse.
5. Lane C added shared placement vocabulary in
   `util/placement-state.ts`.
6. Lane C aligned mixin output child segments with the shared
   `PlacementChildSegment` shape.
7. Lane C added a mixin output placement-record helper and tests.
8. Lane C/D converted import first-use top-level placement to explicit child
   segments.
9. Lane D exposed import postlude render state and covered order/source/output
   facts with tests.
10. Lane E added a rules-like callable-source helper over lookup state.
11. Lane F split contextual important public-result finalization from
    render-only important text.
12. Lane F extracted declaration merge item collection so placeholder cleanup
    has a named adapter boundary.
13. Lane G added rawArgs diagnostic-source state over the existing placement
    record.
14. Lane I updated tracker rows for `Rules`, `AtRule`, `Declaration`, `Call`,
    `Reference`, and `StyleImport`.
15. Cross-lane verification added focused tests for all new helper boundaries.

### Completed Queue Pass: 2026-05-31 #2

This pass completed the second architecture queue. Some large-lane items became
explicit bounded blockers instead of pretending a risky rewrite was complete:

1. Lane A audited cleanup ownership. Frame, extend-root, and layer cleanup are
   already restored through `runBodyEvalInvocation(...)`; deleting more without
   unifying state types would add churn without reducing hot-path work.
2. Lane A kept render/public/eval state merge as a future invocation-record
   slice; current evidence says `AtRuleBodyRuntimeState` remains the
   evaluated-node API compatibility boundary.
3. Lane B extracted callable candidate signature helpers to
   `util/callable-signature.ts`.
4. Lane B moved generated mixin output wrapper construction to
   `createMixinOutputRulesWrapper(...)`.
5. Lane B/G measured callable changes with the rawArgs microbenchmark and
   hotpath command during verification.
6. Lane C/D made import top-level source lookup consume child segments before
   direct-map and recursive-descendant fallback.
7. Lane D confirmed postlude render state is exposed, but no production
   source-map/diagnostic consumer exists yet; this remains queued.
8. Lane D confirmed cache-hit import option state is already isolated in
   `ImportPlacementOptionsState`; replacing wrapper option reads needs a
   narrower production consumer.
9. Lane E searched rules-like reference consumers. There are no additional
   production consumers beyond the helper surface yet; wrapper ownership
   remains the callable mutability boundary.
10. Lane E decided source-free public direct-index container narrowing is
    blocked by public mutability and parentage expectations already covered by
    reference tests.
11. Lane F moved declaration merge render normalization onto
    `createDeclarationMergeAdapterState(...)`.
12. Lane F added `finalizePublicOperationResult(...)` as the named
    public-result operation boundary; dimension/color call sites already share
    `finalizeOperationResult(...)`.
13. Lane G added a rawArgs diagnostic-message source helper over placement
    state.
14. Lane H audited generated selector placement. Generated `:is(...)`
    omission/keyset facts are already declared state and render-consumed;
    selector-copy reduction remains blocked on extend/parentage proof.
15. Lane I updated tracker rows for `Rules`, `AtRule`, `Declaration`, `Call`,
    `Reference`, `List` / `Sequence`, `Operation`, `StyleImport`, and
    selector/extend families.

### Completed Queue Pass: 2026-05-31 #3

This pass completed the third architecture queue and kept the work bounded to
helper/state reductions plus explicit blockers where public behavior still
requires owned nodes:

1. Lane A introduced `createAtRuleBodyRenderState(...)` as the primary
   invocation-result adapter for render-state construction.
2. Lane A documented `AtRuleBodyEvalResult` as the current render-state
   compatibility shape instead of deleting it prematurely.
3. Lane B extracted callable `default()` grouping constants and resolution into
   `util/callable-default-guard.ts`.
4. Lane B moved callable outer-rules wrapper construction to
   `createCallableOuterRules(...)`.
5. Lane B/G re-ran rawArgs and hotpath measurements after callable helper
   extraction during verification.
6. Lane C/D kept recursive import descendant lookup as a documented fallback;
   top-level segment lookup remains the production fast path and adding nested
   state is not yet justified.
7. Lane D routed postlude render order through
   `getImportPostludeRenderState(...)`.
8. Lane D routed import reference/visibility reads through one
   `getImportPlacementRenderState(...)` reader.
9. Lane E added rules-like wrapper ownership coverage through the existing
   shallow owned public-result path.
10. Lane E proved source-free public direct-index containers still need owned
    public results for mutability/parentage safety.
11. Lane F extended declaration merge adapter coverage to sequence-space render
    output.
12. Lane F moved a dimension/color operation path to
    `finalizePublicOperationResult(...)`.
13. Lane G kept optional fallback public construction as a bounded blocker; the
    render-only fallback paths already avoid extra public metadata where tests
    cover them.
14. Lane H kept selector copy removal blocked by existing extend/parentage proof
    coverage rather than replacing selector copies with under-specified state.
15. Lane I updated current truth, lane gates, and node-family tracker rows for
    `Rules`, `AtRule`, `Declaration`, `Reference`, `Operation`, `StyleImport`,
    and selectors.

### Next Queue

1. **Lane A: merge one at-rule duplicate field into the invocation adapter.**

   Target duplicated `evaluatedPrelude`, `evaluatedBody`, or `output` facts
   across render/public/runtime state. Success deletes one duplicate storage
   site or leaves a code-local API-boundary comment with tests.

2. **Lane A: make body render consume less eval-result shape.**

   Narrow `AtRuleBodyEvalResult` so `createAtRuleBodyRenderState(...)` receives
   only the fields render needs. Focused tests: dynamic prelude, root hoist,
   nil body.

3. **Lane A: collapse one body cleanup path into the runner record.**

   Move one frame/extend/layer cleanup fact onto the invocation runner path and
   prove async rejection still restores context.

4. **Lane B: extract callable candidate normalization.**

   Move candidate param/default/rest normalization behind a typed helper only
   if focused default/rest/guard tests remain green and no extra hot-path arrays
   are introduced.

5. **Lane B: reduce debug-only callable counting overhead.**

   Keep default-guard debug counts lazy behind debug mode and verify the normal
   path does not allocate diagnostic arrays.

6. **Lane B/G: measure callable helper parse/runtime cost.**

   Compare rawArgs and Less hotpath timings after the next callable extraction;
   revert or narrow helper growth if it adds cost without deleting closure work.

7. **Lane C: name placement vocabulary for rules-like references.**

   Update code comments or helper names so rules-like records declare source,
   output, scope, and public-boundary fields explicitly.

8. **Lane C/D: prototype one nested import child segment only behind a test.**

   Try a nested ruleset declaration segment. Keep it only if it removes a
   recursive lookup and does not add broader per-child state.

9. **Lane D: remove one direct import placement option read if any remain.**

   Search production `import-style.ts` reads for wrapper option bypasses and
   route one through render state or document why it is not placement state.

10. **Lane E: route one rules-like lookup consumer through explicit state.**

    Replace one `sourceNode`/wrapper inference path with
    `getRulesLikeReferenceLookupState(...)` or capture the exact blocker.

11. **Lane F: narrow declaration merge adapter allocation.**

    Inspect `createDeclarationMergeAdapterState(...)` callers and remove one
    helper array/object allocation from the render-only path if tests stay green.

12. **Lane F: audit remaining operation finalizer call sites.**

    Split render-only vs public-result consumers for `finalizeOperationResult`.
    Move one more public API call to `finalizePublicOperationResult(...)` only
    where metadata ownership is required.

13. **Lane G: split optional fallback public construction in one small case.**

    Pick a single optional JS failure fallback test and add a named
    public-result adapter only if it deletes duplicated name/content handling.

14. **Lane H: identify one selector-copy removal candidate with red tests.**

    Choose one generated selector helper, write parentage/extend tests first,
    then either remove a copy or document the exact metadata that blocks it.

15. **Lane I: update tracker rows from the next code-backed change.**

    Keep tracker updates paired with production/test evidence and avoid adding
    broad stale status sections.

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
