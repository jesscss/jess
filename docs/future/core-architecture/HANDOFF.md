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
  `new-node: 280`, `derive: 29`, `with-surface: 38`, `copy-leaves: 28`,
  module-context count `375`.
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
- Callable eval output finalization now also lives in
  `packages/core/src/tree/util/callable-output.ts`, so pending-default output
  flushing, debug resolution logging, final output sorting, and wrapper/empty
  output selection are no longer the tail orchestration block inside
  `MixinCollection.evalCall(...)`.
- Callable ruleset-as-mixin and anonymous detached-ruleset candidate handling
  now also live in `packages/core/src/tree/util/callable-special-case.ts`, so
  the ruleset-placement branch and detached-ruleset unlock/eval branch are no
  longer inline in `MixinCollection.evalCall(...)`.
- Callable candidate setup state now also lives in
  `packages/core/src/tree/util/callable-candidate-state.ts`, so owned-vs-
  unlocked rules surface selection, mixin-body var visibility wiring, resolved
  param-binding unpacking, and lexical/fallback frame derivation are no longer
  inline in `MixinCollection.evalCall(...)`.
- Callable candidate execution now also lives in
  `packages/core/src/tree/util/callable-candidate-execution.ts`, so live-slot
  setup, scope-frame wiring, guard preparation/evaluation, pending-default
  deferral, and immediate candidate output execution are no longer one inline
  body/guard orchestration block inside `MixinCollection.evalCall(...)`.
- Callable candidate-loop dispatch now also lives in
  `packages/core/src/tree/util/callable-candidate-loop.ts`, so ruleset-
  placement handling, anonymous callable-rules unlock handling, ordinary
  callable-entry setup/dispatch, and per-candidate debug/output wiring are no
  longer the main candidate loop inside `MixinCollection.evalCall(...)`.
- Callable arg evaluation now also lives in
  `packages/core/src/tree/util/callable-args.ts`, so caller-scoped arg
  evaluation, named-arg preservation, rest expansion, and primitive casting
  are no longer inline at the top of `MixinCollection.evalCall(...)`.
- Callable top-level evaluation now also lives in
  `packages/core/src/tree/util/callable-eval.ts`, so caller-scoped arg
  evaluation, candidate resolution, candidate dispatch, and eval-output
  finalization no longer sit inline in `MixinCollection.evalCall(...)`.
- Callable surface construction now also lives in
  `packages/core/src/tree/util/callable-surface.ts`, so callable guard-copy
  policy, callable rules surface creation, wrapper/empty output surface
  creation, root-source lookup, and indexed-child checks no longer live as
  local rules-container helpers.
- Callable entry shape/factory now also lives in
  `packages/core/src/tree/util/callable-entry.ts`, so the synthetic
  `callable-rules` entry type and `callableRulesEntry(...)` constructor no
  longer widen `packages/core/src/tree/rules.ts` just to support helper/test
  consumers and function/call setup.
- Helper-oriented callable surface tests now import directly from
  `packages/core/src/tree/util/callable-surface.ts` instead of through
  `packages/core/src/tree/rules.ts`, so those helper exports no longer widen
  the central rules-container module surface just to serve test consumers.
- Callable entry accessors now also live in
  `packages/core/src/tree/util/callable-entry.ts`, so callable-entry type
  checks plus rules/name/params/guard access no longer sit as local helper
  closures inside `packages/core/src/tree/rules.ts`.
- Callable candidate scan/match now also lives in
  `packages/core/src/tree/util/callable-candidate-match.ts`, so zero-param
  early exits, callable arity/pattern matching, resolved binding collection,
  and ordered eval-candidate preparation are no longer inline at the front of
  `MixinCollection.evalCall(...)`.
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
- AtRule body registration prep now writes `AtRuleBodyRegistrationState`
  directly onto the invocation record, and `AtRuleBodyEvalPrepState` is gone.
  The remaining duplicated lifecycle state is in the registration/result/public
  shapes, not a separate prep carrier.
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

- `MixinCollection` now lives in
  `packages/core/src/tree/util/callable-collection.ts`, and its
  `evalCall(...)` body remains only a thin handoff into
  `packages/core/src/tree/util/callable-eval.ts`; `call.ts`,
  `function.ts`, `reference.ts`, and focused render tests now import the
  class directly from the util module instead of routing through `rules.ts`.
- Ruleset special-case candidate eval owns its own `withRulesContext(...)`
  boundary instead of consuming a Rules-owned evaluation callback from
  `rules.ts`.
- `packages/core/src/tree/rules.ts` no longer re-exports callable surface
  helpers for tests. The remaining callable helper consumers import those
  symbols from `callable-surface.ts` directly, leaving `rules.ts` focused on
  real rule-container/runtime exports.
- `packages/core/src/tree/rules.ts` no longer owns the synthetic callable
  entry shape or factory. `CallableRulesEntry`, `CallableEntry`,
  `MixinEntry`, and `callableRulesEntry(...)` now live in
  `packages/core/src/tree/util/callable-entry.ts`, and the callable helper
  stack plus function/call setup import them there directly.
- Pure helper candidates already outside the closure are callable signatures,
  callable default-group resolution, callable binding value construction,
  callable parameter matching, callable entry access, callable candidate
  preparation, callable arg evaluation, callable candidate scan/match,
  callable default-guard probing, pending default-candidate execution,
  callable candidate output execution, callable outer-rules setup, callable
  scope-frame wiring, callable live-slot assembly, callable guard
  preparation, callable special-case candidate handling, callable candidate
  setup state, callable candidate execution, callable candidate-loop
  dispatch, callable eval output finalization, and mixin output wrapper
  construction.
- Parameter matching, candidate prep, callable-entry access, arg evaluation,
  candidate scan/match, empty-candidate rejection, default-probe evaluation,
  pending default execution, candidate output execution, outer-rules
  reuse/setup, scope-frame wiring, live-slot assembly, guard preparation,
  output aggregation, special-case candidate handling, candidate setup state,
  candidate execution, candidate-loop dispatch, eval-output finalization,
  top-level callable sequencing, callable surface construction, callable entry
  construction, the ruleset special-case eval callback seam, the
  `MixinCollection` residence itself, and the last `rules.ts`
  `MixinCollection` package re-export are now out of `rules.ts`. The
  remaining extractable unit now needs another real Rules-owned callable
  adapter or exported surface to disappear. Test-only callable surface
  re-exports are gone too.

**Completion gates:**

- [x] `MixinCollection` and callable binding helpers are extracted from
      `rules.ts`.
- [x] `rules.ts` line count and import surface are measurably reduced without
      adding extra runtime indirection in hot mixin calls.
- [x] Mixin output construction calls through a named helper family with
      focused output-slot tests.
- [x] Callable default grouping and outer-rules wrapper creation have named
      helper boundaries with focused coverage.
- [x] Focused mixin/rules tests and changed baseline pass.

**Next queue seeds:**

1. Only keep cutting Lane B if a real Rules-owned callable runtime boundary
   shrinks again.
2. Do not split `callable-eval.ts` or `callable-surface.ts` further unless an
   explicit callback, branch, or temporary runtime surface disappears.
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
- [x] Metadata and non-metadata call paths stay measured separately.
- [ ] Fallback content/name state has no copied `Call` surface in render-only
      paths.

**Next queue seeds:**

1. Route one metadata diagnostic/source helper through rawArgs placement.
2. Measure call-path function overhead before and after any rawArgs changes.
3. Split fallback name/content public-result construction from render state in
   one focused case.

**Current measurement truth:**

- `node scripts/measure-callwithcontext-rawargs.mjs 5000` on the current
  branch measured plain positional `callWithContext(...)` at median
  `0.0002ms` / mean `0.0004ms`, and metadata `rawArgs`
  `callWithContext(...)` at median `0.0015ms` / mean `0.0019ms`.
- Recommendation: treat metadata `rawArgs` as the clearly more expensive path,
  but do not churn `define-function.ts` or add new wrapper/state plumbing just
  to shave this microbenchmark. The absolute cost is still tiny, so the next
  Lane G slice should only land if it deletes a real fallback/public state
  surface or shows an end-to-end win in a production call-heavy path.

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
| `Rules` | Direct root/fragment render state exists; callable invocation, candidate scan, guard/default handling, output finalization, entry surfaces, helper-only exports, `MixinCollection` residence, and the old `rules.ts` callable re-export are now outside `rules.ts`. Remaining work only counts when another real `Rules`-owned callable runtime or package surface disappears, or when the remaining boundary is explicitly justified. | Callable extraction complete or explicitly blocked; direct render context state bounded. |
| `AtRule` | Leaf render split; body invocation state is much narrower, render/public adapters are reduced, direct/evaluated render carry compatibility facts through print-state overrides instead of scratch owned nodes, runtime `WeakMap` writes are frame compatibility only, and registration prep now writes the invocation record's registration state directly instead of carrying a separate prep state. The remaining open seam is the evaluated-node collapse-nesting frame path plus the duplicated invocation/body lifecycle state that still spans registration/result/public shapes. Focused proof now pins the frame seam to both evaluated-source `render(context)` and evaluated-source `toTrimmedString()` while source `frames`/`hoistToRoot` stay canonical, and the production serializer still consumes `isHoisted()` / `getRenderFrames()` outside Agent A's write set. | Lane A blocked only on the final frame-compatibility seam and the remaining invocation-record collapse across registration/result/public boundaries; no direct-render scratch state regresses. |
| `Ruleset` | Static body direct render exists; dynamic/nil bodies still own body surfaces. | Dynamic body side-state either implemented for one scalar family or blocked. |
| `Declaration` | Render state avoids prepared declaration materialization; contextual important public/render finalizers are split and merge render normalization uses a strict discriminated adapter state with scalar early return and no parallel list/space checks. Sequence-space merge output is covered by adapter-state proof. | Remaining declaration-state duplication tracked. |
| `Call` | Fallback render state exists; rawArgs remains owned API boundary with diagnostic-source and diagnostic-message helpers. Optional fallback public syntax construction has a named adapter and placement vocabulary (`source`, `output`, `content`, `publicBoundary`), but no production storage after the WeakMap experiment regressed static object counts. | Call overhead measurement complete and fallback render/public split advanced. |
| `Reference` | Text-only render exists for many scalar/container paths; rules-like wrappers remain with explicit source/output/public-boundary placement state and callable ownership proof. Source-free public direct-index container ownership is intentionally retained for mutability/parentage. | Rules-like lookup state consumed or blockers captured. |
| `List` / `Sequence` | Dynamic render streams through native syntax; public resolve owns containers. Source-free public narrowing is blocked by public mutation/parentage expectations. | Revisit only if public mutability API changes. |
| `Block` / `Quoted` / `Url` / `Paren` / `Operation` | Render-only wrappers largely split from public resolve; operation finalization now distinguishes metadata-result inheritance from public-result inheritance, with dimension/color public consumers. | No generic output bridge reintroduced; focused materialization proofs stay green. |
| `StyleImport` | First-use top-level placement segments and postlude render state exist; top-level source lookup consumes segments before recursive fallback, and one nested descendant source lookup now replays a sparse child-segment path instead of depending on the old recursive placement map. Postlude order and option reads now consume render state; recursive descendant lookup remains one documented fallback only. | Lane D gates complete except any future descendant fallback reduction. |
| Selectors / `Ampersand` / `Extend` | Ownership still semantic for generated/extended placement. Generated `:is(...)` omission/keyset state is declared and render-consumed, but the lane still needs one explicit placement-state fact plus render/extend proof before the remaining helper ownership can be called done. | Lane H still open; only close it with a real selector-copy/placement deletion or a focused blocker proof. |
| Controls | Loop render streams direct rules; live frame mutation intentional. | Remaining grouping/state surfaces audited by object/function-call cost. |

Update this tracker when a node family changes architectural state.

## Coordinator Mode

The objective is no longer "finish the next fifteen and restock the queue."
The objective is to keep pulling bounded lane work until every active lane is
either complete or explicitly blocked by focused proof. This handoff should
stay short and operational; detailed pass evidence belongs in git history,
focused tests, and the verification commands below.

### Agent Worktrees

Use persistent worktrees so each agent can keep a stable branch and refresh
from `origin/dev` after its previous change lands.

| Agent | Branch | Worktree | Primary lanes |
| --- | --- | --- | --- |
| Agent A | `feature/core-arch-agent-a` | `/Users/matthew/git/worktrees/jess/core-arch-agent-a` | Lane A |
| Agent B | `feature/core-arch-agent-b` | `/Users/matthew/git/worktrees/jess/core-arch-agent-b` | Lane B, Lane G |
| Agent C | `feature/core-arch-agent-c` | `/Users/matthew/git/worktrees/jess/core-arch-agent-c` | Lanes C, D, E, F, H, I |

Bootstrap or refresh them with:

```sh
./scripts/setup-core-arch-agent-worktrees.sh
```

Refresh rule: after an agent branch lands in `origin/dev`, return to that same
worktree, ensure it is clean, merge `origin/dev`, and reuse it for the next
bounded item.

### Agent Loop

1. Coordinator assigns one bounded backlog item with a disjoint write set.
2. Agent works in its dedicated worktree, runs focused proof first, then the
   nearest broader verification.
3. Agent commits and pushes its branch when the slice is green.
4. After the change lands in `origin/dev`, refresh the same worktree and pull
   the next backlog item.
5. Do not open a new queue document just to narrate progress; update lane
   truth, gates, or blockers only when they materially changed.

### Compact Progress

Recent work removed most inline callable orchestration from `rules.ts`,
reduced `AtRule` render/runtime compatibility to one explicit collapse-nesting
frame blocker seam, activated the bubbling blocker matrix as live proof, and
trimmed the central `Rules` surface enough that further callable work only
counts if another real runtime or package boundary disappears.

## Lane Backlog

### Agent A backlog

1. Delete or conclusively block the last evaluated-node collapse-nesting frame
   compatibility seam in `packages/core/src/tree/at-rule.ts`, with focused
   `at-rule` tests plus the active bubbling matrix.
   Current focused blocker: evaluated-source collapse-nesting serialization
   still needs the compatibility getter path for both `render(context)` and
   `toTrimmedString()` while the source node keeps `frames` /
   `hoistToRoot` undefined, and the serializer consumer lives in
   `packages/core/src/tree/util/serialize-helper.ts` outside Agent A's
   narrow write set.
2. Collapse one duplicated `AtRule` body lifecycle state pair into the primary
   invocation record if and only if a real helper/state surface disappears.
3. Do not move runtime frames onto shared source at-rules and do not add new
   lifecycle plumbing without deleting an existing state shape.

### Agent B backlog

1. Only take another callable slice if a real `Rules`-owned callable runtime
   or package surface shrinks again.
2. If no such slice exists, record why the remaining `rules.ts` callable
   export surface stays instead of splitting helpers for style.
3. Only pursue Lane G fallback/call state if there is a real production
   consumer or a measured speed/function-call win.

### Agent C backlog

1. Lane C/D: replace one remaining import descendant recursive lookup with a
   sparse child-segment path, starting from a red focused test.
2. Lane C: keep placement-state work tied to explicit lifecycle ownership; do
   not add optional-fallback machinery without a production consumer.
3. Lane E: remove one remaining rules-like compatibility read only with public
   mutability/lookup proof.
4. Lane F: shrink one declaration/operation adapter seam only if render stays
   allocation-free and public mutation stays intact.
5. Lane H: land one selector-copy/placement-state deletion or a focused
   blocker proof with parentage/extend coverage first.
6. Lane I: keep this handoff compact and aligned with actual lane truth.

## Pull Queue

Pull the next free item from here; restock only when a lane truthfully changes.

1. Agent A: prove or delete the last `AtRule` evaluated-render frame
   compatibility consumer.
2. Agent A: merge one duplicated `AtRule` lifecycle state pair into the
   invocation record without adding a new adapter.
3. Agent B: find the next real `Rules`-owned callable boundary to delete, or
   explicitly record why the remaining one stays.
4. Agent C: replace one import descendant recursive source lookup with a
   sparse segment lookup.
5. Agent C: delete one rules-like compatibility read with public-shape proof.
6. Agent C: take one selector-copy family through red parentage tests to a
   real blocker proof or deletion.

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
