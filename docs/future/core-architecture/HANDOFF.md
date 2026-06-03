# Core Architecture Handoff

## Open This First

This is the live handoff for the core eval/render architecture work heading
toward the next alpha release.

Read this document as:

1. what state we can honestly claim today;
2. what remaining work still matters for alpha;
3. what is no longer important enough to dominate the queue.

It replaces the old "node copy reduction" framing. Node copies still matter,
but they are only one cost inside the real target: faster real-world Less
evaluation/render with less total runtime work.

The honest stake in the ground now:

- resolve/render is no longer the main story; it is mostly the substrate;
- most major eval/render architecture splits are in place and holding;
- the remaining architecture work is narrower cleanup, simplification, and
  measured deletion work, not an open-ended rewrite;
- the project should now bias toward getting back to a credible alpha state,
  using architecture work to support that goal instead of replacing it.

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

## Alpha Stake

If we are honest about where Jess is today:

- the broad resolve/render separation work is mostly done;
- the repo is no longer waiting on one giant architecture breakthrough;
- remaining work is about bounded cleanup, measured runtime improvement,
  correctness confidence, and getting back to a credible alpha state.

What should count as progress now:

- deleting one real remaining state/helper seam;
- landing measured runtime or allocation wins on hot paths;
- tightening correctness/confidence around known risky surfaces;
- clarifying which remaining issues are true release blockers versus optional
  cleanup.

What should not count as progress now:

- purity churn around source identity or clone avoidance by itself;
- reopening broad resolve/render philosophy debates without a concrete win;
- adding machinery just to defend an internal ideal with no alpha payoff.

## Current Remaining Work

This is the short list that should drive queue work:

1. Lane A: complete unless a future slice deletes another real AtRule
   body/result copy seam or shows a measured hot-path win.
2. Lane C/H/F: the current placement-vocabulary, selector-copy, and
   operation-result helper seams are closed. Reopen only for another real
   helper/state deletion or measured hot-path win.
3. Lane E: rules-like/direct-index public ownership is blocked by the current
   mutability and parentage contract; only reopen if that public API changes
   or a new focused proof deletes a real owned-result branch.
4. Lane G: only continue call-path work when rawArgs diagnostics, function-call
   overhead, or another measured runtime path improves; the fallback `Call`
   ownership item is done.
5. Queue status: no active pull-queue items remain. Future work should restock
   from a concrete alpha blocker, measured regression, or real helper/state
   deletion candidate.
6. Alpha confidence: keep verification and measured-runtime truth ahead of
   theoretical neatness.

## Not Current Blockers

These should not be treated as queue-stopping blockers right now:

- AtRule collapse-nesting frame ownership: the source-node `WeakMap` path is
  already gone.
- public `resolve(...)` fallback-`Call` ownership: optional fallback public
  results now resolve to finalized text output instead of an owned fallback
  `Call`.
- extend-generated selector ownership: allowed when it keeps architecture
  simple; do not contort the runtime to avoid every copy.

## Where We Are

Jess is no longer in the phase where the main question is "can we separate
render from public resolve/eval without breaking everything?" We largely did
that. The remaining questions are narrower:

- what small number of architecture seams still buy real speed, memory, or
  simplicity;
- what cleanup is still needed to make the runtime model understandable and
  stable;
- what has to happen now to call the next alpha honest.

That means queue work should stop acting like every remaining ownership or
copy seam is existential. If a seam is just an implementation choice with no
meaningful product, perf, or model payoff, it should not dominate the queue.

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

The section below is reference material, not the primary queue driver. Keep
it accurate, but do not mistake it for the short list of remaining work.

- Public CSS output uses awaited eval/render; `safeCompile(...)` remains the
  explicit tree-surface compatibility/debug API.
- Production CSS render writes through `Rules.render(...)` into a flat render
  buffer. Public result ownership remains allowed only where API shape or
  mutability still requires it.
- The broad render/public-result split is in place across the high-risk node
  families: controls, declarations, calls, references, imports, and at-rules.
- The biggest recent deletions are already landed: `preEval()`,
  `preEvaluated`, the AtRule frame `WeakMap`, the rules-like side-map/helper
  seam, the legacy nested-`sourceNode` freeze branch, and a long tail of
  inline callable/mixin orchestration closures moved out of `rules.ts`.
- AtRule body eval no longer wraps invocation state in a separate
  `AtRuleBodyEvalResult`; the invocation record now carries the result node
  directly.
- Shared runtime state that is still intentional includes
  `Context.rulesContext`, `ScopeFrame.liveSlotsByName`, and
  `ScopeFrame.fallbackFrame`.
- Public optional fallback calls no longer create owned fallback `Call`
  surfaces for public eval/resolve. They resolve to finalized text output
  while render still emits finalized syntax directly.
- Selector/extend placement now shares one selector-copy boundary for
  implicit selector placement, extend application, extend-root processing,
  walk-and-consume extension, and public extend-record materialization.
- Public operation result finalization now exports the same shared operation
  metadata finalizer instead of calling through a delegating wrapper.
- The remaining work is not “find more places to hide copies.” It is:
   preserving the narrowed architecture, deleting only still-real helper seams,
   and proving whether any current owned public-result boundary can disappear
   without regressions.
- Static audit snapshot on the current branch:
  `new-node: 277`, `derive: 29`, `with-surface: 38`, `copy-leaves: 27`,
  module-context count `370`.
- Hotpath measurement is still noisy. Use it to confirm clear wins/regressions,
  not to justify tiny static-count changes by themselves.

## Release Direction

The next alpha should be able to say:

1. Core eval/render is stable enough that it is no longer the primary risk
   center for the release.
2. The largest remaining state/carrier tangles are either reduced further or
   clearly bounded in the handoff.
3. Queue work advances alpha readiness first, with architecture cleanup used
   where it materially improves speed, confidence, or runtime clarity.
4. Verification covers behavior, frontier regressions, package exports,
   measured hot paths, and the specific surfaces we still consider risky.

## How To Use This Handoff Now

Use this document to do three things:

1. Finish the remaining high-signal architecture cleanup that still buys real
   runtime or model wins.
2. Refuse low-value churn where "fewer copies" or "fewer wrappers" is no
   longer translating into meaningful progress.
3. Keep the queue pointed at alpha-state confidence rather than perpetual
   internal purity work.

## Deterministic Architecture Lanes

Each lane has a finite completion definition. Queue work should pull from these
lanes and update the tracker when evidence changes.

### Lane A: At-Rule Body Invocation Lifecycle

**Goal:** collapse the current at-rule body state tangle into one
invocation-owned lifecycle that can feed render, public resolve, registration,
and cleanup without duplicating facts across many parallel structures.

**Current surfaces:**

- `packages/core/src/tree/at-rule.ts`
- `AtRuleBodyOutputState`
- `AtRuleBodyEvalRecord`
- `AtRuleBodyRegistrationState`

**Target invariants:**

- One invocation record owns source at-rule, optional owned eval/public frame,
  evaluated prelude, body-to-eval/final-rules pairing, visibility, layer name,
  extend-root marker, hoist/root output, frame cleanup, and async cleanup.
- Collapse-nesting frame facts must stay on owned evaluated results or
  render-local print state, not source-node side maps.
- Direct render must not write prelude/body/visibility/frame facts onto the
  canonical source at-rule.
- Public resolve may own a result at-rule, but the result adapter must be a
  boundary, not the body eval scratch frame.

**Completion gates:**

- [x] At-rule body lifecycle has one primary invocation record type and no
      duplicate prelude/body/output carriers beyond documented public-boundary
      writes.
- [x] Async rejection cleanup, frame restoration, extend-root cleanup, and
      layer-record pop are all tested through one runner path.
- [x] AtRule runtime compatibility storage is deleted; no direct/evaluated
      render path depends on a source-node `WeakMap` frame fallback.
- [x] Dynamic body/root-hoist render tests prove canonical source parentage is
      unchanged.
- [x] Focused AtRule/extend tests, full `@jesscss/core` tests, and
      `@jesscss/core` build pass.

**Next queue seeds:**

1. Keep render/public state honest: do not reintroduce an adapter object just
   to shuttle invocation facts into the final owned `AtRule`.
2. AtRule follow-up only counts if it deletes another real body/result copy
   seam or produces a measured hot-path win. The lifecycle-state duplication
   queue item is complete.

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
- [x] No new placement state is introduced without declaring whether it is
      per-invocation, per-output-node, or per-context.
- [x] At least one repeated source/placement rediscovery walk is replaced by a
      placement record lookup and measured or proven by focused tests.

**Next queue seeds:**

1. Done: `placement-state.ts` provides the shared child-segment/record
   vocabulary, with import and mixin placement consumers plus focused tests.
2. Future placement work must declare lifecycle ownership before adding any
   new placement-state field.
3. Generated selector placement is documented in Lane H; reopen only if a
   wrapper-owned field can move into declared state while deleting a helper
   seam or improving measured runtime.

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

1. Keep import placement state on sparse child segments and postlude facts;
   do not reintroduce recursive descendant lookup machinery.
2. Route one source-map or diagnostic path through `ImportPostludePlacementState`.
3. Align `deriveRulesSurface(...)` with the shared Rules-surface helper family
   only if focused tests prove no extra function-call or wrapper cost.

### Lane E: Rules-Like References And Direct-Index Results

**Goal:** keep public result APIs mutable while reducing render-only ownership
for references, direct-index hits, and rules-like values.

**Current surfaces:**

- `packages/core/src/tree/reference.ts`
- dynamic fallback `List`/`Sequence` render
- public direct-index container resolve

**Target invariants:**

- Render may use text-only or placement-state output when no public mutable
  result is required.
- Public `resolve(...)` continues to own source-backed containers and
  rules-like callable surfaces until mutability/lookup tests prove otherwise.
- Rules-like callable facts should travel on the owned shallow surface itself;
  do not keep a side-map when the public surface already carries the source.

**Completion gates:**

- [x] Every rules-like preservation consumer either uses the owned public
      surface directly or has a documented blocker.
- [x] Source-free direct-index public container narrowing is either implemented
      or blocked by a mutability/parentage proof.
- [x] Reference-stack cleanup has focused tests for both text-only and owned
      output paths, including preserved rules-like surfaces.

**Next queue seeds:**

1. Done: rules-like consumers use owned public-surface facts directly; the
   source-helper/side-map seam and legacy nested-`sourceNode` freeze branch
   are gone.
2. Blocked: source-free public direct-index `List`/`Sequence` ownership stays
   until public mutability/parentage expectations change.
3. Preserved rules-like surfaces already have focused proof for canonical
   frozen sources plus balanced `referenceStack` cleanup.

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

1. Done: public contextual-important finalization is split from render-only
   text finalization.
2. Done: declaration merge adapter state covers list/space render output while
   scalar/no-merge paths skip no-op adapter state.
3. Done: dimension/color public operation results now use the shared operation
   metadata finalizer export directly, with no delegating wrapper hop.

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
- Optional fallback CSS calls render and public-resolve finalized syntax
  without re-entering name evaluation or owning a fallback `Call`.
- RawArgs placement should support diagnostics/source lookup without walking
  the owned rawArgs tree by default.

**Completion gates:**

- [x] rawArgs placement has one diagnostics or validation consumer.
- [x] Metadata and non-metadata call paths stay measured separately.
- [x] Fallback content/name state has no copied `Call` surface in render-only
      paths or optional fallback public eval/resolve.

**Next queue seeds:**

1. Route one metadata diagnostic/source helper through rawArgs placement.
2. Measure call-path function overhead before and after any rawArgs changes.
3. Do not reopen fallback public-result ownership unless a concrete regression
   appears; optional fallback eval/resolve now returns finalized text output
   instead of an owned fallback `Call`.

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

- [x] One generated pseudo or ampersand placement fact is carried in declared
      state and consumed by render/extend code.
- [x] One selector helper family is reduced or blocked by parentage/visibility
      proof.
- [x] Selector render and extend integration tests cover the changed shape.

**Next queue seeds:**

1. Reduce one `withComponents(...)` family only after collapse/parentage tests
   are red first.
2. Add an extend blocker proof where selector copies remain semantic.
3. Move one remaining generated `:is(...)` keyset or parentage fact into
   declared placement state only if it deletes another helper seam.

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
| `Rules` | Direct root/fragment render state exists; callable invocation, candidate scan, guard/default handling, output finalization, entry surfaces, helper-only exports, `MixinCollection` residence, and the old `rules.ts` callable re-export are now outside `rules.ts`. The remaining callable-specific `rules.ts` logic is registry/index ownership (`mixinsByName`, `findMixinsFast(...)`, registration), which is the intended rule-container boundary rather than an extraction seam. | Callable extraction complete; direct render context state bounded. |
| `AtRule` | Leaf render split; body invocation state is much narrower, render/public adapters are reduced, direct render carries transient facts through print-state overrides, registration prep writes registration state onto the invocation record, nested `@layer` registration reads layer names from the invocation record, `AtRuleBodyFrameState` is gone, the duplicated `contextState.evalFrame` mirror is gone, the separate `AtRuleBodyEvalResult` wrapper is gone, the public-result adapter input/state layer is gone, the nested `AtRuleBodyEvalContextState` carrier is gone, and cleanup ownership now lives directly in the invocation runner. The evaluated-frame `WeakMap` seam is now deleted: collapse-nesting eval returns owned frame-bearing AtRules while the source remains `frames`/`hoistToRoot` neutral, and body ownership keeps the evaluated extend root shared with `processExtends()`. | Lane A lifecycle-state collapse is complete. Only reopen AtRule for a real body/result copy deletion or measured hot-path win. |
| `Ruleset` | Static body direct render exists; dynamic/nil bodies still own body surfaces. | Dynamic body side-state either implemented for one scalar family or blocked. |
| `Declaration` | Render state avoids prepared declaration materialization; contextual important public/render finalizers are split and merge render normalization uses a strict discriminated adapter state with scalar early return, no parallel list/space checks, and no redundant source `value` field. Sequence-space merge output is covered by adapter-state proof. | Remaining declaration-state duplication tracked. |
| `Call` | Fallback render state exists; rawArgs remains owned API boundary with diagnostic-source and diagnostic-message helpers. Optional fallback public eval/resolve now returns finalized text output instead of constructing an owned fallback `Call`, and render-only optional JS failures with `contentNode` also emit direct fallback syntax. The dead optional-fallback helper export is gone from the tree surface. No production storage was added after the WeakMap experiment regressed static object counts. | Fallback `Call` ownership deletion complete; only revisit call work for rawArgs diagnostics or measured overhead. |
| `Reference` | Text-only render exists for many scalar/container paths; rules-like wrappers remain as shallow owned public surfaces with callable ownership proof, but the separate rules-like preservation side-map is gone. Detached rules-like calls now recover lexical parentage from the owned surface's public `sourceNode` instead of a helper/side-map read, direct callable preservation now pops `referenceStack` on the owned-output path, and focused proof pins preserved rules-like surfaces to frozen canonical sources with balanced `referenceStack` cleanup. The legacy nested-`sourceNode` freeze branch is also gone, so rules-like freezing now acts only on the canonical source value that the shallow owned surface captures. Source-free public direct-index container ownership is intentionally retained for mutability/parentage. | Lane E queue cleared; reopen only for a public API change or a real owned-result branch deletion. |
| `List` / `Sequence` | Dynamic render streams through native syntax; public resolve owns containers. Source-free public narrowing is blocked by public mutation/parentage expectations. | Revisit only if public mutability API changes. |
| `Block` / `Quoted` / `Url` / `Paren` / `Operation` | Render-only wrappers largely split from public resolve; operation finalization now keeps the public export name as an alias of the shared metadata finalizer, deleting the prior delegating wrapper while preserving dimension/color public consumers. | Lane F queue cleared; no generic output bridge reintroduced; focused materialization proofs stay green. |
| `StyleImport` | First-use top-level placement segments and postlude render state exist; nested descendant source lookup now also replays sparse child-segment paths instead of depending on the old recursive placement map. Postlude order and option reads now consume render state, and the old recursive descendant lookup is off the live production helper path. | Lane D gates complete unless a future change deletes more placement state without reintroducing recursive lookup. |
| Selectors / `Ampersand` / `Extend` | Ownership still semantic for generated/extended placement. Generated `:is(...)` omission state is now declared at construction time and consumed by selector render plus the ampersand/extend parent-list paths, removing the render-time arg-shape fallback read. Integration proof now covers both exact and `all` extend against the generated omission shape. Generated extend output may own wrapper/copy structure when that keeps placement and parentage simple; do not preserve source-node identity at the cost of harder architecture unless a measured regression justifies it. Selector placement copying now uses one shared boundary across implicit selector placement, extend application, extend-root processing, walk-and-consume extension, and extend-record materialization; the duplicate local clone/assert helpers are gone. | Lane H simplification slice complete. Only reopen for another real helper/state deletion or measured selector/extend hot-path win. |
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

Recent work deleted the AtRule evaluated-frame `WeakMap`, moved
collapse-nesting frame facts onto owned eval results, preserved nested
wrapper/media and extend parity, deleted the rules-like reference side-map and
legacy nested-`sourceNode` freeze branch, deleted fallback `Call` ownership in
render and optional fallback public eval/resolve by returning finalized text
output, deleted the separate AtRule eval-result wrapper by carrying the result
node on the invocation record, deleted the separate public-result adapter
input/state layer plus the extra cleanup/restore helper, flattened AtRule body
eval context facts into the invocation record, and reclassified the
selector-copy seam as simplification work instead of a protected blocker.
The latest selector/extend pass centralized the owned selector-copy boundary
and deleted duplicate local clone/assert helpers from extend application,
extend-root processing, walk-and-consume extension, and extend-record
materialization.

## Lane Backlog

### Agent A backlog

1. Done: the evaluated-node collapse-nesting frame compatibility seam in
   `packages/core/src/tree/at-rule.ts` is deleted. Coverage: focused
   `at-rule` ownership/render/serialize tests, nested wrapper/media proofs,
   `media.less` AST serialization, extend collapse parity, full core tests,
   and core build.
2. Done: the separate public-result adapter input/state layer is gone. Public
   result application now reads directly from invocation state plus the owned
   target node.
3. Done: cleanup ownership is now in the invocation runner; the extra
   cleanup/restore helper is deleted.
4. Done: the nested `AtRuleBodyEvalContextState` carrier is deleted. Prelude,
   body, output, visibility, layer, frame-cleanup, and extend-root facts now
   live directly on `AtRuleBodyEvalRecord`.
5. AtRule follow-up backlog: only revisit owned body/result copying if we can
   delete another real container-copy seam. Current owned collapse-nesting
   results already share inert leaves and shallow-copy `frames`; do not turn
   this into speculative churn unless a measurable or structural deletion is
   available.

### Agent B backlog

1. Lane B is effectively complete. Only reopen it if a real `Rules`-owned
   callable runtime or package surface disappears.
2. Done: optional fallback public eval/resolve no longer owns fallback `Call`
   output. Reopen Lane G only for rawArgs diagnostics, measured function-call
   overhead, or a concrete fallback text regression.

### Agent C backlog

1. Done: Lane C placement-state vocabulary is in `placement-state.ts` and used
   by import/mixin placement consumers with focused proof.
2. Done/blocked: Lane E rules-like compatibility seams are narrowed to owned
   public-surface facts; source-free public direct-index ownership stays
   blocked by mutability/parentage expectations.
3. Done: Lane F operation result finalization now has one shared finalizer
   export and no public wrapper hop.
4. Done: Lane H selector-copy simplification centralized the owned selector
   copy boundary in `selector-utils` and removed duplicate clone/assert helper
   bodies from extend application, extend-root processing, walk-and-consume
   extension, and public extend-record materialization.
5. Lane H follow-up: generated extend output may own wrapper/copy structure when that
   keeps parentage and placement straightforward. Do not spend architecture
   complexity defending source-node identity unless a measured regression
   demands it. Reopen this lane for real simplification, not purity churn.
6. Lane I: keep this handoff compact and aligned with actual lane truth.

## Pull Queue

The previous five-item pull queue is cleared honestly:
- item 1 is done (AtRule frame-storage `WeakMap` deleted; owned eval result
  carries collapse-nesting frames)
- item 2 is done (`contextState.evalFrame` mirror removed)
- item 3 is done (rules-like side-map/helper seam removed)
- item 4 is reopened as a selector-copy simplification candidate
- item 5 is done (public optional fallback eval/resolve returns finalized text
  output instead of an owned fallback `Call`)

No active pull items remain. Restock only when a lane truthfully changes.

1. Agent A: done. The last `AtRule` runtime-frame storage consumer is deleted;
   only reopen if a source-node frame side map reappears.
2. Agent A: done. The public-result wrapper/state layer is deleted; only
   reopen this slot if another real `AtRule` lifecycle carrier disappears.
3. Agent A: done. The separate `AtRuleBodyEvalResult` wrapper is deleted; the
   invocation record now carries the result node directly.
4. Agent A: done. Cleanup ownership now lives in the invocation runner; the
   extra cleanup/restore helper is deleted.
5. Agent C: only retry rules-like/public-mutation work if a real owned-result
   or compatibility branch disappears beyond the side-map/helper seam and the
   nested-`sourceNode` freeze branch already removed.
6. Agent C: done. Selector-copy simplification centralized the owned selector
   placement copy boundary and deleted duplicate local clone/assert helper
   bodies from the extend modules.
7. Agent A: done. The nested AtRule body eval context carrier is deleted; only
   reopen Lane A for a real body/result copy deletion or measured hot-path win.
8. Agent C: done/cleared. Lane E/F was audited: Lane F deleted the operation
   public wrapper hop; Lane E remains blocked by public mutability/parentage
   expectations rather than an active queue item.
9. Agent B: done. Optional fallback public eval/resolve now returns finalized
   text output instead of an owned fallback `Call`; focused proof covers
   source-backed content, dynamic source-free content, JS optional failures,
   source parentage, zero `deriveCall` fallback construction, Less fixture
   comment trivia, and `default()` guard comparisons.
10. Agent C: done. Lane F operation result finalization now aliases the public
    export to the shared metadata finalizer, deleting the delegating wrapper
    while preserving dimension/color public result semantics.

Current pull queue is clear. Restock only from a concrete alpha blocker,
measured regression, or a new proof-backed helper/state deletion candidate.

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

Latest checkpoint: Lane F operation finalization now aliases the public export
to the shared metadata finalizer; the pull queue is clear. Verified with
focused operation/dimension/color/declaration tests, full core tests, Less
fixture data, node-creation audit, diff check, and baseline verification during
push.

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
