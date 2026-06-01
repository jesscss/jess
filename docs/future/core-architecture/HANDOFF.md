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
- At-rule body render now carries evaluated body, hoist, and frame facts only
  through render-local print-state overrides. The old runtime-update adapter
  boundary is gone.
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
- Callable candidate filtering, dedupe, recursion-to-caller rejection, and
  default-last ordering now live in
  `packages/core/src/tree/util/callable-candidate.ts` instead of an inline
  `evalCall(...)` filter/map/sort closure block.
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
- Callable default-guard probing now also lives in
  `packages/core/src/tree/util/callable-default-guard.ts`, so the copied-guard
  cache closure, dual `default()` probe loop, and `isDefault` restoration are
  no longer inline inside `MixinCollection.evalCall(...)`.
- Callable default-candidate bookkeeping now also lives in
  `packages/core/src/tree/util/callable-default-guard.ts`, so defNone
  contribution tracking, pending-default candidate collection, and pending-
  default output flushing are no longer inline state-management blocks inside
  `MixinCollection.evalCall(...)`.
- Callable output aggregation now also lives in
  `packages/core/src/tree/util/callable-output.ts`, so callable output source
  tracking, output-rule collection, and single-vs-wrapper finalization are no
  longer inline state-management blocks inside `MixinCollection.evalCall(...)`.
- Callable ruleset-as-mixin and anonymous detached-ruleset candidate handling
  now also live in `packages/core/src/tree/util/callable-special-case.ts`, so
  the ruleset-placement branch and detached-ruleset unlock/eval branch are no
  longer inline in `MixinCollection.evalCall(...)`.
- Callable candidate output execution now lives in
  `packages/core/src/tree/util/callable-candidate-output.ts`, so recursion
  gating, adopt/eval/adopt cleanup, candidate index restoration, and mixin
  output slot attachment are no longer owned by an inline
  `evaluateCandidateOutput(...)` closure.
- Pending callable default-candidate resolution and execution now also live in
  `packages/core/src/tree/util/callable-default-guard.ts`, so ambiguity
  detection, selected-group iteration, and default-result execution no longer
  sit as a second inline control block at the bottom of `MixinCollection.evalCall(...)`.
- Callable outer-rules reuse/setup now lives in
  `packages/core/src/tree/util/callable-outer-rules.ts`, so wrapper reuse,
  candidate index sync, parent adoption, and optional scope-frame sync are no
  longer owned by an inline `ensureOuterRules(...)` closure inside
  `MixinCollection.evalCall(...)`.
- Callable scope-frame wiring now lives in
  `packages/core/src/tree/util/callable-scope-frame.ts`, so lexical/fallback
  frame assignment, shared-vs-dedicated outer frame selection, and leaky
  caller fallback wiring are no longer owned by one inline block inside
  `MixinCollection.evalCall(...)`.
- Callable live-slot assembly now lives in
  `packages/core/src/tree/util/callable-live-slots.ts`, so param binding slot
  creation, param-var marking, and lazy `@arguments` preparation are no longer
  owned by one inline block inside `MixinCollection.evalCall(...)`.
- Callable guard preparation now lives in
  `packages/core/src/tree/util/callable-guard.ts`, so dynamic-guard copy
  policy, no-param caller-guard prebinding, and on-demand dynamic guard wrapper
  creation are no longer scattered across repeated inline branches inside
  `MixinCollection.evalCall(...)`.
- Callable guard execution now also lives in
  `packages/core/src/tree/util/callable-guard.ts`, so rules-context swapping,
  default-guard probe execution, defNone contribution tracking, and
  pending-default deferral decisions are no longer inline inside
  `MixinCollection.evalCall(...)`.
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
  collecting merge items, returns raw nodes for single replacements, and uses
  one discriminated list/space channel instead of parallel `listValue` /
  `spaceValue` properties.
- At-rule body public/render result states now consume narrow explicit adapter
  inputs instead of piggybacking on the full eval result frame. Visibility,
  layer names, and evaluated body state are stored on invocation context state
  instead of the eval record, and the remaining evaluated-node compatibility
  storage is documented as legacy runtime frames rather than the direct-render
  model.
- `AtRuleBodyEvalResult` now carries the invocation context state reference
  instead of duplicating prelude/body/visibility/output fields onto another
  result object, and its stale `evalFrame` mirror is gone. Public and render
  adapters still own their compatibility shapes at the boundary.
- Direct AtRule render now carries evaluated prelude as a render-local header
  override instead of runtime compatibility state. The remaining runtime-frame
  compatibility storage no longer carries prelude, and direct render consumes
  `AtRuleBodyEvalResult`
  plus a print-state header override instead of routing prelude through a
  dedicated body render adapter.
- `AtRuleBodyRenderState` is gone, and the follow-on render runtime-update
  helper is gone too. Direct render now consumes `AtRuleBodyEvalResult`
  straight into render-local print-state overrides instead of allocating a
  separate compatibility adapter object.
- AtRule body public-result application now writes evaluated body and output
  facts directly onto the owned result node. The public-result runtime-update
  helper is gone; the remaining runtime-frame compatibility storage no longer
  participates in public or direct-render result application.
- AtRule eval now restores prior compatibility runtime state whenever body eval
  throws or rejects, including late post-eval visibility failures. Failed evals
  no longer leak hoist/body `WeakMap` state onto the canonical at-rule.
- AtRule eval now installs only evaluated-node compatibility state
  once on success instead of writing `WeakMap` body/output facts incrementally
  during body evaluation. The body invocation record carries evaluated facts
  until eval completes, and failed eval cleanup no longer depends on mid-flight
  writes.
- AtRule evaluated-node compatibility state no longer nests hoist/frame facts
  under an `output` wrapper. The remaining `WeakMap` record now stores only
  direct `hoistToRoot` / `frames` overrides for legacy evaluated-node APIs.
- Direct AtRule render no longer installs temporary runtime compatibility state
  on the source node. When evaluated body or hoist/frame facts differ from the
  source surface, render derives a temporary owned at-rule and serializes that
  instead; the remaining `WeakMap` usage is evaluated-node compatibility only.
- Evaluated AtRule `render(context)` now also renders through a temporary owned
  at-rule when compatibility state exists, so the render API no longer reads
  evaluated-body compatibility from the source node itself. Remaining
  compatibility consumers are now explicit getters / serialization paths.
- Body-changing AtRule `eval(context)` now returns an owned evaluated at-rule
  surface instead of storing evaluated rules on source-node runtime
  compatibility state.
- Root-only AtRule `eval(context)` outputs that differ only by hoist metadata
  now also return owned evaluated at-rule surfaces instead of writing hoist
  compatibility onto the source node. The remaining AtRule runtime `WeakMap`
  state is now the collapse-nesting/evaluated-render frames path only.
- The remaining AtRule eval-time compatibility state no longer stores a
  separate runtime `hoistToRoot` field. Evaluated-node hoist for that path is
  now derived from stored `frames` plus nestable semantics, so the `WeakMap`
  carries only frame metadata.
- AtRule render/runtime updates for nestable frame-bearing paths no longer
  carry a redundant temporary `hoistToRoot` flag. Temporary render nodes now
  derive hoist from runtime `frames` during application, matching the remaining
  evaluated-node compatibility semantics.
- The remaining AtRule eval-time compatibility `WeakMap` no longer stores a
  `{ frames }` wrapper object. It now stores the frames array directly, so the
  last evaluated-node compatibility path avoids an extra state object while
  preserving the same collapse-nesting semantics.
- The remaining AtRule eval-time compatibility commit no longer allocates a
  temporary runtime-update object just to persist frames. Success now writes
  raw `frames` directly into the compatibility `WeakMap`.
- The remaining AtRule evaluated-render compatibility path no longer allocates
  a temporary `{ frames }` runtime-update object either. When legacy runtime
  frames exist, evaluated render now carries those frame facts through
  render-local print-state overrides, preserving source-node canonical state
  without deriving a temporary owned at-rule for the compatibility path.
- Direct AtRule body render now carries evaluated body and hoist/frame facts
  through the same render-local print-state override surface instead of
  deriving a temporary owned at-rule to host those facts for serialization.
- The targeted Less bubbling bug matrix in
  `packages/jess/test/less/at-rule-bubbling-bugs.test.ts` is now active
  coverage instead of `todo` scaffolding, so the remaining collapse-nesting
  frame blocker is pinned to real wrapper/media/parent-selector cases.
- Declaration merge adapter state now returns no object for scalar/no-merge
  paths, and single replacement paths now return the replacement node directly.
  Only real list/space render adapters allocate merge state.

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
- `AtRuleBodyRuntimeFrames`
- `AtRuleBodyEvalContextState`
- `AtRuleBodyEvalRecord`
- `AtRuleBodyRegistrationState`
- `AtRuleBodyEvalPrepState`
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
      duplicate prelude/body/output fields across parallel result/public
      state types unless each duplicate has a documented API boundary.
- [x] Async rejection cleanup, frame restoration, extend-root cleanup, and
      layer-record pop are all tested through one runner path.
- [x] AtRule runtime compatibility storage is deleted or documented as
      evaluated-node API compatibility only, with no direct-render scratch
      writes.
- [x] Dynamic body/root-hoist render tests prove canonical source parentage is
      unchanged.
- [x] Focused at-rule tests and `verify:baseline -- --changed` pass.

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

**Current dependency graph:**

- `MixinCollection.evalCall(...)` still depends directly on `Rules` instance
  construction, scope-frame wiring, mixin output slot attachment, call-stack
  recursion tracking, guard/default evaluation, candidate execution, and
  parameter live-slot setup.
- Pure helper candidates already outside the closure are callable signatures,
  callable default-group resolution, callable binding value construction,
  callable parameter matching, callable candidate preparation, callable
  default-guard probing, pending default-candidate execution, callable
  candidate output execution, callable outer-rules setup, callable scope-frame
  wiring, callable live-slot assembly, callable guard preparation, callable
  special-case candidate handling, and mixin output wrapper construction.
- The next extractable unit needs either a Rules-owned adapter input or a
  callable-invocation module that accepts Rules construction callbacks.
  Parameter matching, candidate prep, the default probe loop, pending default
  execution, candidate output execution, outer-rules reuse/setup,
  scope-frame wiring, live-slot assembly, guard preparation, output
  aggregation, and special-case candidate handling are now out of the closure;
  the next cut must delete a remaining guard/body orchestration closure
  instead of just renaming it.

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
- [x] Focused mixin/rules tests and changed baseline pass.

**Next queue seeds:**

1. Extract one remaining callable guard/body orchestration unit only if a
   local closure, temporary collection, or callback disappears from
   `MixinCollection.evalCall(...)`.
2. Prefer scope-frame setup or caller/outer-rules setup next; do not split
   them unless a local callback, closure, or temporary collection disappears.
3. Delete stale commented registry scaffolding once adjacent callable
   extraction tests cover the live behavior.

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
| `AtRule` | Leaf render split; body invocation state still large, but render and public-result inputs are narrowed, duplicate prelude storage was removed from the eval record, visibility moved onto invocation context state, body-rules frame cleanup is runner-owned, owned public results now carry body/output facts directly, failed evals restore prior compatibility state instead of leaking `WeakMap` facts, successful eval now installs only remaining frame compatibility state at the boundary instead of writing body/output facts during body evaluation, direct render no longer installs temporary runtime compatibility state on the source node, evaluated `render(context)` no longer reads compatibility body state from the source node itself, body-changing `eval(context)` now returns an owned evaluated at-rule surface, root-only hoist-only eval outputs now return owned results too, the remaining eval-time runtime state no longer stores a separate hoist field, nestable render/runtime updates no longer carry a redundant temporary hoist flag when frames already imply it, the last eval-time compatibility `WeakMap` now stores raw frames instead of a wrapper object, eval-time compatibility commits now write raw frames directly, the evaluated-render compatibility path now carries those frames through render-local print-state overrides instead of temporary wrapper objects or derived owned at-rules, direct body render now carries evaluated body/hoist/frame facts through the same print-state override surface instead of deriving a temporary owned at-rule, and the dead render runtime-update helper is deleted. Runtime `WeakMap` writes are now frame compatibility only, and the hotspot audit no longer reports any render/eval/resolve surface lines. | Lane A gates complete. |
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

- Passes 1-15 reframed the work from node-copy reduction to total runtime work:
  AtRule body runtime/render adapters, callable binding/signature/default
  helpers, mixin output wrappers, shared placement vocabulary, import placement
  child/postlude state, declaration merge/contextual-important adapters,
  rawArgs diagnostics, rules-like reference helpers, operation public-result
  aliases, narrowed AtRule render/public adapters, callable default debug-count
  cleanup, optional fallback syntax helper rejection, declaration scalar merge
  adapter elision, narrowed AtRule eval-result context ownership, source-free
  AtRule body render state, empty/no-op AtRule runtime-update elision, render
  output-update elision, render-local prelude override, AtRule body render
  adapter deletion, and bounded blockers for public direct-index and selector
  ownership.

- Passes 31-34 finished the last big AtRule render/runtime deletions and
  converted the remaining collapse-nesting frame seam into an explicit,
  well-covered blocker. Direct render now uses print-state overrides instead of
  temporary owned at-rules, the dead render runtime-update helper is gone, the
  bubbling bug matrix is active coverage, and a direct-on-node ownership
  attempt is now explicitly rejected because it hung the mixin bubbling path.

### Completed Queue Pass: 2026-06-01 #35

1. Lane B finally deleted a real `MixinCollection` closure block. Callable
   parameter matching moved out of `rules.ts` into
   `packages/core/src/tree/util/callable-param-match.ts`, taking the binding
   `Map`, signature array, named-argument scan, default-fill pass, and rest
   signature logic with it.
2. Lane B kept the runtime contract exact while shrinking the central file.
   `packages/core/src/tree/rules.ts` dropped from 4876 lines at discovery time
   to 4735 lines after the extraction, while mixin matching still preserves the
   same named/default/rest/`@arguments` behavior and the single-required-param
   overload rejection rule.
3. Lane B added focused helper coverage instead of relying only on integration
   fallout. `packages/core/src/tree/util/__tests__/callable-param-match.test.ts`
   now proves named/default/rest binding shape and the extra-positional
   rejection case directly, with the focused `mixin.test.ts` suite still green.
4. Lane B also proved the import edge needed to stay lean. A first draft that
   reached for higher-level declaration imports destabilized the broad baseline,
   so the final helper stays on the lower-level node-type surface instead of
   baking in new circular dependency edges.
5. Lane B/G now has fresh callable measurements on an actual callable slice:
   rawArgs medians stayed at 0.0003ms for plain positional calls and 0.0023ms
   for metadata rawArgs calls, and the full changed baseline stayed green.
6. Lane A stayed intentionally unchanged this pass. The remaining collapse-
   nesting frame seam is still blocked by the focused AtRule suite, the active
   bubbling matrix, and the `media.less` AST serialization proof.
7. Lane I compacted older pass detail, refreshed Lane B truth/queue wording,
   and keeps full queue completion tied to verification, commit, and push.

### Completed Queue Pass: 2026-06-01 #36

1. Lane B deleted another real `MixinCollection` closure block. Callable
   candidate filtering, duplicate-source rejection, default-last ordering, and
   ruleset recursion-to-caller rejection moved out of `rules.ts` into
   `packages/core/src/tree/util/callable-candidate.ts`.
2. Lane B kept the runtime contract exact while shrinking the central file
   again. `packages/core/src/tree/rules.ts` dropped from 4735 lines after pass
   `#35` to 4591 lines in this pass, and the node-creation audit ticked down
   from `rules.ts: 68` / `new-node: 294` / module count `395` to
   `rules.ts: 67` / `new-node: 293` / module count `394`.
3. Lane B added focused helper coverage instead of relying only on integration
   fallout. `packages/core/src/tree/util/__tests__/callable-candidate.test.ts`
   now proves shared-source dedupe plus default-last ordering and the
   ruleset-recurses-to-caller rejection path directly, with the focused
   `mixin.test.ts` suite still green.
4. Lane B/G now has fresh callable measurements on another real callable
   slice: rawArgs medians stayed flat to slightly better at `0.0003ms` for
   plain positional calls and `0.0022ms` for metadata rawArgs calls, while the
   changed baseline stayed green.
5. Lane A stayed intentionally unchanged again. The remaining collapse-nesting
   frame seam is still blocked by the focused AtRule suite, the active
   bubbling matrix, and the `media.less` AST serialization proof.
6. Lane I refreshed the Lane B dependency graph and next queue so the next
   pass targets the remaining default-probe/body-eval orchestration honestly
   instead of pretending candidate prep is still inline.

### Completed Queue Pass: 2026-06-01 #37

1. Lane B deleted another real `MixinCollection` closure block. Callable
   default-guard probing moved out of `packages/core/src/tree/rules.ts` into
   `packages/core/src/tree/util/callable-default-guard.ts`, taking the copied-
   guard cache closure, the two-pass `default()` probe loop, the group
   classification, and `context.isDefault` restoration with it.
2. Lane B kept the runtime contract exact while shrinking the central file
   again. `MixinCollection.evalCall(...)` still owns caller-specific outer-
   rules setup, pending-candidate collection, and candidate body execution,
   but the default-probe branch is now a named helper boundary instead of an
   inline micro-runner.
3. Lane B added focused helper coverage instead of relying only on integration
   fallout. `packages/core/src/tree/util/__tests__/callable-default-guard.test.ts`
   now proves copied-guard reuse, dual probe ordering, result grouping, and
   `isDefault` restoration directly, while the focused `mixin.test.ts` suite
   still covers caller-scope default-guard behavior.
4. Lane A stayed intentionally unchanged again. The remaining collapse-nesting
   frame seam is still blocked by the focused AtRule suite, the active
   bubbling matrix, and the `media.less` AST serialization proof.
5. Lane I refreshed Lane B truth and queue wording so the next pass targets
   candidate execution or scope-frame/body setup instead of re-queuing default
   probe extraction that is now done.

### Completed Queue Pass: 2026-06-01 #38

1. Lane B deleted another real `MixinCollection` closure block. Callable
   candidate output execution moved out of `packages/core/src/tree/rules.ts`
   into `packages/core/src/tree/util/callable-candidate-output.ts`, taking the
   recursion gate, adopt/eval/adopt cleanup, candidate index restoration, and
   mixin-output slot attachment with it.
2. Lane B kept the runtime contract exact while shrinking the central file
   again. `MixinCollection.evalCall(...)` still owns caller-specific
   scope-frame setup, default-candidate collection, and default-resolution
   orchestration, but it no longer owns the candidate body runner inline.
3. Lane B added focused helper coverage instead of relying only on integration
   fallout. `packages/core/src/tree/util/__tests__/callable-candidate-output.test.ts`
   now proves recursion skip behavior and successful mixin-output placement
   attachment directly, while the focused `mixin.test.ts` and
   `mixin-recursion.test.ts` suites still cover the production call paths.
4. Lane A stayed intentionally unchanged again. The remaining collapse-nesting
   frame seam is still blocked by the focused AtRule suite, the active
   bubbling matrix, and the `media.less` AST serialization proof.
5. Lane I refreshed Lane B truth and queue wording so the next pass targets
   scope-frame setup or pending default-candidate execution instead of stale
   candidate-runner wording.

### Completed Queue Pass: 2026-06-01 #39

1. Lane B deleted another real `MixinCollection` closure block. Pending
   callable `default()` resolution and execution moved out of
   `packages/core/src/tree/rules.ts` into
   `packages/core/src/tree/util/callable-default-guard.ts`, taking ambiguity
   detection, selected-group iteration, and default-result execution with it.
2. Lane B kept the runtime contract exact while shrinking the central file
   again. `MixinCollection.evalCall(...)` still owns per-candidate scope-frame
   setup and caller/outer-rules decisions, but it no longer owns the bottom
   default-resolution/control block inline.
3. Lane B added focused helper coverage instead of relying only on integration
   fallout. `packages/core/src/tree/util/__tests__/callable-default-guard.test.ts`
   now proves selected-group execution order and ambiguity throwing directly,
   while the focused `mixin.test.ts` and `mixin-recursion.test.ts` suites keep
   the production default/mixin behavior pinned down.
4. Lane A stayed intentionally unchanged again. The remaining collapse-nesting
   frame seam is still blocked by the focused AtRule suite, the active
   bubbling matrix, and the `media.less` AST serialization proof.
5. Lane I refreshed Lane B truth and queue wording so the next pass targets
   scope-frame setup or caller/outer-rules setup instead of stale pending-
   default wording.

### Completed Queue Pass: 2026-06-01 #40

1. Lane B deleted another real `MixinCollection` closure block. Callable
   outer-rules reuse/setup moved out of `packages/core/src/tree/rules.ts` into
   `packages/core/src/tree/util/callable-outer-rules.ts`, taking wrapper reuse,
   candidate index sync, parent adoption, and optional scope-frame sync with
   it.
2. Lane B kept the runtime contract exact while shrinking the central file to
   4546 lines. `MixinCollection.evalCall(...)` still owns the higher-order
   caller/guard sequencing and scope-frame decisions, but it no longer owns the
   inline `ensureOuterRules(...)` closure.
3. Lane B added focused helper coverage instead of relying only on integration
   fallout. `packages/core/src/tree/util/__tests__/callable-outer-rules.test.ts`
   now proves wrapper reuse, candidate index sync, and opt-out scope-frame
   preservation directly, while the focused `mixin.test.ts` and
   `mixin-recursion.test.ts` suites keep the production mixin/guard paths
   pinned down.
4. Lane A stayed intentionally unchanged again. The remaining collapse-nesting
   frame seam is still blocked by the focused AtRule suite, the active
   bubbling matrix, and the `media.less` AST serialization proof.
5. Lane I refreshed Lane B truth and queue wording so the next pass targets
   caller-guard/scope-frame orchestration instead of stale outer-rules wording.

### Completed Queue Pass: 2026-06-01 #41

1. Lane B deleted another real `MixinCollection` orchestration block. Callable
   scope-frame wiring moved out of `packages/core/src/tree/rules.ts` into
   `packages/core/src/tree/util/callable-scope-frame.ts`, taking lexical/
   fallback frame assignment, dedicated outer-frame creation for prebound param
   guards, shared outer-frame reuse, and leaky caller fallback wiring with it.
2. Lane B kept the runtime contract exact while shrinking the central file to
   4542 lines. `MixinCollection.evalCall(...)` still owns live-slot assembly
   and higher-order caller/guard sequencing, but it no longer owns the inline
   scope-frame assignment block.
3. Lane B added focused helper coverage instead of relying only on integration
   fallout. `packages/core/src/tree/util/__tests__/callable-scope-frame.test.ts`
   now proves shared outer-frame reuse, dedicated prebound guard frame wiring,
   and leaky fallback wiring directly, while the focused `mixin.test.ts` and
   `mixin-recursion.test.ts` suites keep the production mixin/guard paths
   pinned down.
4. Lane A stayed intentionally unchanged again. The remaining collapse-nesting
   frame seam is still blocked by the focused AtRule suite, the active
   bubbling matrix, and the `media.less` AST serialization proof.
5. Lane I refreshed Lane B truth and queue wording so the next pass targets
   live-slot assembly or caller-guard sequencing instead of stale
   scope-frame wording.

### Completed Queue Pass: 2026-06-01 #42

1. Lane B deleted another real `MixinCollection` orchestration block. Callable
   live-slot assembly moved out of `packages/core/src/tree/rules.ts` into
   `packages/core/src/tree/util/callable-live-slots.ts`, taking param binding
   slot creation, param-var marking, and lazy `@arguments` preparation with
   it.
2. Lane B kept the runtime contract exact while shrinking the central file to
   4510 lines. `MixinCollection.evalCall(...)` still owns wrapper/guard
   sequencing, but it no longer owns the inline live-slot / `@arguments`
   setup block.
3. Lane B added focused helper coverage instead of relying only on integration
   fallout. `packages/core/src/tree/util/__tests__/callable-live-slots.test.ts`
   now proves param-var marking, lazy `@arguments` flattening from live slots,
   and node-arg fallback directly, while the focused `mixin.test.ts` and
   `mixin-recursion.test.ts` suites keep the production mixin/guard paths
   pinned down.
4. Lane A stayed intentionally unchanged again. The remaining collapse-nesting
   frame seam is still blocked by the focused AtRule suite, the active
   bubbling matrix, and the `media.less` AST serialization proof.
5. Lane I refreshed Lane B truth and queue wording so the next pass targets
   caller-guard sequencing or another remaining guard/body orchestration block
   instead of stale live-slot wording.

### Completed Queue Pass: 2026-06-01 #43

1. Lane B deleted another real `MixinCollection` orchestration block. Callable
   guard preparation moved out of `packages/core/src/tree/rules.ts` into
   `packages/core/src/tree/util/callable-guard.ts`, taking dynamic guard copy
   policy, no-param caller-guard prebinding, and on-demand dynamic guard
   wrapper creation with it.
2. Lane B kept the runtime contract exact while improving the hotspot audit
   again even though the central file only moved slightly in line count to
   4513 lines. `MixinCollection.evalCall(...)` still owns the higher-order
   pass/fail flow and default-result branching, but it no longer owns the
   repeated inline guard-preparation branches.
3. Lane B added focused helper coverage instead of relying only on integration
   fallout. `packages/core/src/tree/util/__tests__/callable-guard.test.ts`
   now proves dynamic-vs-static/default guard preparation, caller-guard
   prebinding, and dynamic wrapper creation directly, while the focused
   `mixin.test.ts` and `mixin-recursion.test.ts` suites keep the production
   mixin/guard paths pinned down.
4. Lane A stayed intentionally unchanged again. The remaining collapse-nesting
   frame seam is still blocked by the focused AtRule suite, the active
   bubbling matrix, and the `media.less` AST serialization proof.
5. Lane I refreshed Lane B truth and queue wording so the next pass targets
   remaining guard/default-result sequencing or another still-inline
   orchestration block instead of stale guard-prep wording.

### Completed Queue Pass: 2026-06-01 #44

1. Lane B deleted another real `MixinCollection` orchestration block. Callable
   guard execution moved out of `packages/core/src/tree/rules.ts` into
   `packages/core/src/tree/util/callable-guard.ts`, taking rules-context
   swapping, default-guard probe execution, defNone contribution tracking, and
   pending-default deferral decisions with it.
2. Lane B kept the runtime contract exact while shrinking the central file to
   4436 lines. `MixinCollection.evalCall(...)` still owns candidate body
   execution and pending-default output collection, but it no longer owns the
   inline guard pass/fail/default branching itself.
3. Lane B added focused helper coverage instead of relying only on integration
   fallout. `packages/core/src/tree/util/__tests__/callable-guard.test.ts`
   now proves default-guard execution and non-default guard pass handling
   directly, while the focused `mixin.test.ts` and `mixin-recursion.test.ts`
   suites keep the production mixin/guard paths pinned down.
4. Lane A stayed intentionally unchanged again. The remaining collapse-nesting
   frame seam is still blocked by the focused AtRule suite, the active
   bubbling matrix, and the `media.less` AST serialization proof.
5. Lane I refreshed Lane B truth and queue wording so the next pass targets
   pending-default output collection or another still-inline candidate/body
   orchestration block instead of stale guard-execution wording.

### Completed Queue Pass: 2026-06-01 #45

1. Lane B deleted another real `MixinCollection` orchestration block. Pending
   callable default bookkeeping moved out of
   `packages/core/src/tree/rules.ts` into
   `packages/core/src/tree/util/callable-default-guard.ts`, taking defNone
   contribution tracking, pending-default candidate collection, and pending-
   default output flushing with it.
2. Lane B kept the runtime contract exact while shrinking the central file to
   4425 lines. `MixinCollection.evalCall(...)` still owns candidate body
   setup and immediate non-default output execution, but it no longer owns the
   inline pending-default state machine or post-loop flush block.
3. Lane B added focused helper coverage instead of relying only on integration
   fallout. `packages/core/src/tree/util/__tests__/callable-default-guard.test.ts`
   now proves default-state recording and flush behavior directly, while the
   focused `callable-guard`, `mixin`, and `mixin-recursion` suites keep the
   production mixin/default paths pinned down.
4. Lane A stayed intentionally unchanged again. The remaining collapse-nesting
   frame seam is still blocked by the focused AtRule suite, the active
   bubbling matrix, and the `media.less` AST serialization proof.
5. Lane I refreshed Lane B truth and queue wording so the next pass targets
   remaining immediate candidate-output routing or another still-inline
   candidate/body orchestration block instead of stale pending-default wording.

### Completed Queue Pass: 2026-06-01 #46

1. Lane B deleted another real `MixinCollection` orchestration block. Callable
   output aggregation moved out of `packages/core/src/tree/rules.ts` into
   `packages/core/src/tree/util/callable-output.ts`, taking output source
   tracking, output-rule collection, and single-vs-wrapper finalization with
   it.
2. Lane B kept the runtime contract exact while shrinking the central file to
   4397 lines. This pass also improved the static hotspot audit to
   `rules.ts: 61`, `new-node: 288`, and module count `388`. `MixinCollection.evalCall(...)`
   still owns candidate setup and the special-case ruleset / detached-ruleset
   entry branches, but it no longer owns the inline output-state machine.
3. Lane B added focused helper coverage instead of relying only on integration
   fallout. `packages/core/src/tree/util/__tests__/callable-output.test.ts`
   now proves source tracking, empty-output handling, single-output placement,
   and multi-output wrapper finalization directly, while the focused default-
   guard, mixin, and mixin-recursion suites keep the production callable paths
   pinned down.
4. Lane A stayed intentionally unchanged again. The remaining collapse-nesting
   frame seam is still blocked by the focused AtRule suite, the active
   bubbling matrix, and the `media.less` AST serialization proof.
5. Lane I refreshed Lane B truth and queue wording so the next pass targets
   the remaining special-case candidate branches or another still-inline
   candidate/body orchestration block instead of stale output-aggregation
   wording.

### Completed Queue Pass: 2026-06-01 #47

1. Lane B deleted another real `MixinCollection` orchestration block. Callable
   special-case candidate handling moved out of
   `packages/core/src/tree/rules.ts` into
   `packages/core/src/tree/util/callable-special-case.ts`, taking the
   ruleset-as-mixin placement branch and the anonymous detached-ruleset
   unlock/eval branch with it.
2. Lane B kept the runtime contract exact while shrinking the central file to
   4367 lines. The hotspot audit stayed at `rules.ts: 61`, `new-node: 288`,
   `with-surface: 40`, and module count `388`; `derive` ticked to `31` after
   making the special-case surface explicit. `MixinCollection.evalCall(...)`
   still owns immediate candidate setup plus the main body/guard orchestration,
   but it no longer owns the special-case branch pair.
3. Lane B added focused helper coverage instead of relying only on integration
   fallout. `packages/core/src/tree/util/__tests__/callable-special-case.test.ts`
   now proves ruleset-placement output, detached-ruleset unlock/eval behavior,
   and the ordinary-mixin fallthrough directly, while focused `mixin` and
   `call` coverage keeps the production special-case paths pinned down.
4. Lane A stayed intentionally unchanged again. The remaining collapse-nesting
   frame seam is still blocked by the focused AtRule suite, the active
   bubbling matrix, and the `media.less` AST serialization proof.
5. Lane I refreshed Lane B truth and queue wording so the next pass targets
   immediate candidate setup or another still-inline body/guard orchestration
   block instead of stale special-case-branch wording.

### Next Queue

1. **Lane A: collapse cleanup/prep state only if a state record disappears.**

   Do not reshuffle cleanup ownership unless `AtRuleBodyFrameState`,
   `AtRuleBodyEvalPrepState`, or a helper becomes unnecessary.

2. **Lane A: decide whether the last evaluated-node frame compatibility path can shrink again.**

   Public result nodes no longer use runtime compatibility state, the
   hoist/frame wrapper is gone, direct render no longer installs temporary
   compatibility state, evaluated render no longer reads source runtime body
   state, body-changing eval now returns an owned evaluated surface, root-only
   hoist-only eval outputs are owned too, the remaining runtime compatibility
   storage is raw frames only, eval-time compatibility commits now write those
   frames directly, evaluated render no longer allocates a temporary wrapper
   object or derived node for that path, direct body render now uses the same
   print-state override seam instead of temporary owned at-rules, and the dead
   render runtime-update helper is gone. The next deletion must target the
   collapse-nesting frame path itself: either remove the remaining `frames`
   compatibility write/read for one evaluated-node API path, or prove that
   path still needs explicit frame state. Current blocker evidence is concrete:
   deleting the seam regressed the focused collapse-nesting AtRule tests, the
   active bubbling bug matrix in
   `packages/jess/test/less/at-rule-bubbling-bugs.test.ts`, and the
   `media.less` AST serialization proof. A narrower direct-on-node ownership
   attempt also regressed the mixin-at-rule bubbling case badly enough to hang,
   so "move frames from the side map onto the shared source at-rule" is not the
   next safe deletion.

   Failed eval cleanup and incremental eval writes are now covered. The next
   pass should delete a remaining compatibility field or consumer rather than
   add more lifecycle plumbing.

3. **Lane B: extract the next callable unit only if `evalCall(...)` loses another real guard/body closure.**

   Parameter matching, candidate prep, default-probe evaluation, guard
   execution, pending-default bookkeeping, candidate-output execution, and
   output aggregation are out, and outer-rules reuse/setup plus scope-frame
   wiring plus live-slot assembly plus guard preparation plus special-case
   candidate handling are out too. The next callable slice should target
   immediate candidate setup or another body-setup block only if one more
   temporary collection, callback, or closure disappears from
   `MixinCollection`.

4. **Lane B: keep helper extraction honest; do not split candidate execution or scope-frame setup unless local runtime machinery falls.**

   The next cut needs to remove another real local seam such as immediate
   candidate setup or another local orchestration closure. Do not add a helper
   that only rephrases the same body work behind another callback.

5. **Lane B/G: keep measuring callable slices, not AtRule-only work.**

   After any callable helper change, rerun rawArgs and Less hotpaths as
   regression checks. Do not cite those numbers as callable evidence for
   AtRule-only passes.

6. **Lane C: find a real optional fallback placement consumer before storing state.**

   Do not add a WeakMap or side state unless a production diagnostic/source
   path consumes it and the audit remains neutral.

7. **Lane C/D: replace one import recursive descendant lookup only with sparse state.**

   Write the red nested import child-segment test first. Keep the change only if
   it removes a recursive lookup without adding broad per-child state.

8. **Lane D: keep import descendant fallback diagnostics debug-only.**

   Add a counter only if a focused debug/test path needs proof of fallback use
   and the counter cannot affect import runtime object count.

9. **Lane E: reduce rules-like compatibility only with a public-shape proof.**

   If public tests still assert `sourceNode`, keep it. Otherwise remove one
   compatibility read and route lookup state through the preservation record.

10. **Lane F: reduce declaration contextual-important duplication only if render stays allocation-free.**

   The render/public split is intentional today. Try only if render still avoids
   materializing an important flag and public resolve still returns the flag.

11. **Lane F: decide whether operation metadata finalizer needs a compatibility alias.**

   Keep the alias out if package-export and source scans prove no public
   consumer needs it.

12. **Lane G: find the next optional fallback storage candidate outside function calls.**

   Function-call fallback already has no render storage. Check reference/import
   fallback paths before adding any new placement map.

13. **Lane H: choose one selector-copy candidate with red parentage tests.**

   Do not remove selector copies until tests prove the current ownership
   requirement and a narrower state can preserve it.

14. **Lane I: keep completed-pass history compact and evidence-linked.**

   On each queue completion, roll older pass details into the compact summary
   and keep only the newest pass plus active queue detailed.

15. **Lane I: finish every full queue run with verification, commit, and push.**

   A queue pass is not complete until the production/test/handoff diff is
   verified, committed as one coherent change, and pushed on the active branch.

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
