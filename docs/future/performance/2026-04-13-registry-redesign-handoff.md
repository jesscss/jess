# Registry Redesign — Handoff

Date: `2026-04-13`
Branch: `dev`
Checkpoint commit: `5103bbc6` (`Fix rules indentation`)

## Priority Reset

Recent work cleaned up `reference.ts`, but that is **not** the highest-leverage
performance frontier anymore.

The benchmark and architecture audits still point to four larger cost centers:

1. **shared-tree eval/render isolation completion (Slice 13c + Track 5 follow-through)** —
   the broad renderKey/fork runtime is now gone, but imported-tree sharing and
   the remaining buffered-render work still need to fully harden the
   "one canonical tree, no forks" target.
2. **serializer backtracking / buffered render (Track 5)** — the audit shows
   `OutputWriter.mark/getSince/restore/capture` are still huge runtime costs.
   Moving toward typed render buffers and deferred selector finalization is a
   higher priority than more `Reference` cleanup.
   Guardrail: this does **not** mean "skip the evaluated-node step and print
   strings straight from source nodes." The target is "no retained full
   evaluated tree": evaluate one node, produce the immediate evaluated/derived
   node, allow visitor/rewrite replacement there, then serialize it
   immediately unless a deferred structure truly needs to keep it.
   Additional guardrail: `PrintOptions` is transitional, not target
   architecture. As eval and render collapse, live render/session state should
   move onto the singleton `Context` and be managed with save/restore there,
   not normalized as a permanent copied-options layer.
3. **clone / copy / materialization pressure** — `Node.clone` / `Node.copy`
   remain hot in the benchmark and should be treated as architectural debt, not
   acceptable runtime infrastructure.
4. **remaining generic registry/query overhead in `Rules` / registries** — the
   lookup fast paths were worth building, but further performance wins should
   now live primarily in `rules.ts`, `registry-utils.ts`, and render/storage
   ownership, not in more local `Reference` grooming.

Related transitional smell to keep in mind:

- `attachSelectorBitLibrary(...)` is not target architecture. It exists because
  some selector fragments are still created/copied in detached states and then
  asked for keyset behavior before normal parent/source/tree inheritance has
  reattached `keySetLibrary`. Note it as debt; do not expand the pattern unless
  a local bridge is unavoidable.

Practical rule for the next agent:

- do **not** keep iterating on `reference.ts` unless it directly unblocks one of
  the four items above
- prefer planning / narrowing Slice 13 and Track 5 against the actual hot files
  (`serialize-helper.ts`, `print.ts`, renderKey-bearing eval nodes) before
  spending more time on lookup-node cleanup
- use the benchmark evidence in
  [2026-04-13-less-benchmark-audit.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-less-benchmark-audit.md)
  and
  [2026-04-13-registry-architecture-audit.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-registry-architecture-audit.md)
  to justify the next slice

## Work Checklist

### Track 1 — Registry Bypass (Transition Slices)

- [x] Slices 1–4 — mixin params → `RuntimeVarBinding` cells; params bypass declaration registry
- [x] Slice 5 — `varsByName` fast map on `Rules`; lexical variable lookup bypasses declaration registry
- [x] Slice 6 — `ScopeFrame` introduced alongside registry; `buildScopeFrame` / `resolveFrameCell` in `scope-frame.ts`
- [x] Slice 7 — `mixinsByName` fast map on `Rules`; static-named mixin lookup bypasses `MixinRegistry.find`
- [x] Slice 8 — Wire `ScopeFrame` parent chain at mixin call time; `outerRules.scopeFrame.liveSlotsByName` carries params; `resolveFrameCell` finds them via frame chain with call-site parent
- [x] Slice 9 — `liveSlotsByName` frame-chain walk is the primary mixin param lookup path in `performLookup`; `runtimeVarBindings` kept as fallback; only `liveSlotsByName` walked (not `declarationBucketsByName`) to preserve Less definition-site semantics for lexical vars
- [x] Slice 10 — Retire `runtimeVarBindings`; `@arguments` joins `liveSlotsByName`; `buildScopeFrame` accepts optional live slots; proof tests updated to behavioral assertions
- [x] Slice 11 — `getScopeFrame()` auto-wires parent frame by walking node parent chain; inner rules within mixin body inherit `outerRules.scopeFrame` as parent; `reference.ts` live-slot walk uses clean `frame.parent` chain
- [x] Slice 12a — Extend `findVarDeclarationFast` with `beforeIndex` for positional variable lookups
- [x] Slice 12b — Delete `resolution: 'linear'`; remove `beforeIndex` from `findVarDeclarationFast`; strip linear branches from `performLookup`, `toTrimmedString`, and `declaration.ts`; delete the linear-specific test in `rules.test.ts`
- [x] Slice 13 — Delete fork/renderKey system from the active node/runtime path
  Current status, compressed:
  - Completed leaf-node deletions: `selector-pseudo.ts`, `selector-attr.ts`, `operation.ts`, `interpolated.ts`, `selector-compound.ts`, `selector-complex.ts`, `selector-list.ts`, `paren.ts`, `quoted.ts`, `sequence.ts`, `declaration.ts`, `extend.ts`, `mixin.ts`, and `at-rule.ts` no longer store eval results on nodes keyed by `renderKey`; they now return original-or-derived nodes and read serializer output from canonical `value`.
  - Completed serializer-local deletions: declaration / extend / leaf at-rule emission no longer depend on per-leaf renderKey serializer state; `Ruleset.getHeaderString()` no longer rewrites stored selector state just to print filtered/reference-mode headers; root/uncomposed ruleset renders no longer populate node-level composed-selector cache slots.
  - Completed live-state moves: active composed-selector cache lives on session render state instead of `Ruleset`; `Node.render()` reuses `context.printState`; serializer stack/frame/flag changes are managed on live render state with save/restore instead of cloned session objects; lookup render keys now resolve from `options.context` first and no longer cross through serializer helpers; serializer flattening now takes the inherited live render key from the active session/render call instead of treating `Rules._renderKey` as an implicit default, no longer falls back to `Rules._renderKey` at the top-level flatten entry point, no longer propagates the fake `CANONICAL` sentinel as if it were a live render key, and no longer carries a per-entry render key bag through the flattened walk just to hand the already-active session key back to leaf emission; serializer child/container emission no longer pushes the same render key back onto the session stack when it is already active; `serializeRulesContainerInternal()` now captures the active session/render key once per container render instead of repeatedly rereading it through `options.context` across child emission; `Rules` wrapper rendering now captures that same live key once per wrapper render instead of rereading `options.context` through the hot path, while also refusing to push the fake `CANONICAL` sentinel onto the live render-key stack; the composed-selector cache is no longer keyed by render key at all, only by `Ruleset`, because serializer composition no longer varies by live render-key state; and parent lookup is now canonical-only, with `getParent(renderKey)` / `_parentForks` deleted from `node-base.ts`.
  - Completed lookup deletion: `FindOptions.renderKey` is gone. Lookup no longer threads render-key state through ad hoc option bags.
  - Completed lookup cleanup: `registry-utils.ts` no longer consults `Context` for a live render key during parent-scope walks. Remaining Track 1 render-key/fork work is now concentrated in `node-base.ts` fork storage, not in lookup-side option routing.
  - Completed serializer deletion: `PrintOptions.renderKey` fallback is gone, serializer-side `Rules` / `Ruleset` render-key pushes are gone, flattened serializer entries no longer carry per-entry render-key baggage, the public `EVAL` render-key sentinel is gone, `Node.getValue(renderKey)` is gone from the public node surface, `_renderKey` and `_childForks` are gone from `Node`, `Node.set(..., renderKey)` is gone, and the composed-selector cache is no longer keyed by render key at all.
  - Completed cleanup cuts: dead `ruleset-trace` / discarded `processPrePost('pre', ...)` header-path work is gone; `Node.preEval()` / `evalNode()` use context-owned traversal helpers; `Reference` no longer injects redundant lookup render keys; `Rules.flatRulesWithKeys()` is gone, with serializer traversal now carrying inherited live render context directly instead of materializing parallel node/key arrays on `Rules`; mixin / ruleset-as-mixin / `$for` output no longer reassigns `_renderKey` after eval when the same wrapper instance already carried that live key into evaluation, `$for` no longer rewrites `_renderKey` onto a post-eval replacement wrapper, and the `ruleset-as-mixin` deep-clone path, the ordinary mixin-call wrapper path, and the per-iteration `$for` wrapper path no longer assign or push render keys at all; `Ruleset.getHeaderString()` and hoisted-ruleset carrier composition no longer consult render keys to choose forked selector data during print and now always read the canonical `Ruleset` value during serialization, and `Ruleset.evalNode()` no longer routes field writes through a fork-aware branch at all; `Node._visitValues(...)` no longer carries an unused renderKey fork path; `Node.forEachNode(...)` is no longer exposed as a general node API surface and now mutates only the active canonical value tree during eval instead of bouncing through `set(..., renderKey)` branches; `Node.toTrimmedString()` no longer threads a dead renderKey argument into `_visitValues(...)`; `Node.getValue()` now exits immediately on the canonical/no-render-key path instead of dragging that case through the larger fork guard; `Node.getParent(renderKey)` and `_parentForks` are gone entirely, so parent traversal is canonical-only again; `Node.set()` no longer re-reads `this.value` when entering the forked branch, and an existing forked-object update no longer bounces back through `getValue(renderKey)` just to fetch the same fork again; the no-op `Node.reconcileRenderKeyState(...)` shim is gone; `Node.setForContext(...)` is gone; `Context.pushRenderKey(...)` / `popRenderKey()`, the internal render-key stack, and the temporary single `context.renderKey` field are all gone from runtime; `getActiveRenderKey(...)` is gone; and the print-layer render-key push/pop helpers are gone.
  - Guardrails: `Context` remains the singleton eval/render session; `PrintOptions` is transitional and should keep shrinking; `&` is live contextual selector state, not canonical node state; end-state nodes should be very light, effectively immutable templates that evaluate-and-serialize in one step into the active output buffers, with object-shaped deferred output kept only where later passes still need structure (mainly selector/extend work).
  - Result: the active renderKey/fork runtime is gone from `Node`, `Context`, lookup, serializer state, wrapper transport, and node eval/storage. Remaining Track 1 work is no longer generic renderKey deletion; it is import-sharing validation (Slice 13c) plus any narrowly-discovered cleanup still coupled to the old model.
- [x] Slice 13b — Wire `$for` loop iteration variables through `ScopeFrame` / `liveSlotsByName` (same as mixin params, Slices 8–11). `$for` no longer materializes synthetic loop `VarDeclaration`s just to transport `value` / `key` / `index`; per-iteration wrapper `Rules` now get a `scopeFrame` with those bindings in `liveSlotsByName`, and loop-var references resolve without declaration-registry lookup. The loop body still uses renderKey for shared-node mutation isolation, so this slice removes declaration-shaped binding transport but does **not** make `$for` fully fork-free by itself.
- [ ] Slice 13c — Finish converging mixins, imports, and `$for` on canonical-tree + binding-frame evaluation
  Current status, compressed:
  - Completed import-side convergence: imported trees now evaluate canonically on first use across `@compose`, plain mutable `@import`, protected `mutable:false`, implicit `_dedupe`, and explicit `reference: true` flows; plain CSS imports return an empty `Rules` result because output is carried by `topImports`; imported `Rules.sourceNode` provenance is bound once; no-op `with/set` keeps the imported tree directly; variable-only configured imports now bind through `ScopeFrame.liveSlotsByName` with declaration lookup able to surface those live slots; replacement-configured imports stay on shallow imported `Rules` surfaces instead of synthetic top-level `Rules.create([])` shells; inline and evaluated import postludes now derive from imported surfaces instead of rebuilding fresh wrapper shells.
  - Completed mixin-side convergence: `Mixin.preEval()` stays canonical unless the mixin name is actually interpolated; static regular mixin bodies now use shallow wrapper clones; params-only calls bind directly on the cloned body `Rules`; static guard probes no longer take defensive deep-copy tiers or dead outer wrappers; simple/named/rest parameter transport and `@arguments` now reuse bound nodes directly except where list/sequence normalization really needs a local copy; detached ruleset calls derive from the original `Rules` surface instead of rebuilding synthetic `Rules.create(...)` shells.
  - Completed `$for` convergence: iteration vars live in `ScopeFrame.liveSlotsByName`; per-iteration wrappers derive from the canonical loop body instead of rebuilding empty shells; zero-, single-, and multi-iteration outputs now derive from the loop-body surface instead of returning synthetic `Rules.create([])` wrappers; emitted loop-output `Rules` no longer retain iteration-local `scopeFrame` bindings after eval.
  - Remaining seam for the next pass block: delete the last structural shells that still exist only to carry output shape or special lookup surfaces. In practice this means dynamic/default-guard mixin outer wrappers, multi-output mixin carriers, additive non-variable import child-surface wrappers, and any remaining postlude carrier shells that are not yet rooted in the imported/candidate `Rules` surface.
  Guardrail: mixins, imports, and `$for` are the same architectural class. They
  should all evaluate canonical trees against runtime binding frames, differing
  only in which bindings they install and which parent frame they chain to.
  `clonedEval(...)`, `preserveOriginalNodes`, and `maybeClone(...)` are legacy
  debt from the older clone-before-mutate model and should be deleted, not
  normalized into the redesign.
  Current narrowing: declaration assignment normalization no longer uses
  `value.maybeClone(context)` at all, and `List.operate('+')` /
  `Sequence.operate('+')` now build explicit derived results instead of
  depending on session-gated `maybeClone(...)` behavior.
  Additional narrowing: detached-ruleset calls now derive from the original
  `Rules` surface instead of rebuilding a fresh `Rules.create(n.value,
  n.options)` shell before evaluation.
  Additional narrowing: detached `Collection` calls now stay on the
  `Collection` surface too, instead of degrading to a fresh plain `Rules`
  wrapper before evaluation.
  Additional narrowing: dynamic/default guard wrappers are now guard-only
  lookup surfaces. Param/body evaluation stays on the cloned body `Rules`,
  with the temporary wrapper only carrying the guard scope that must not see
  body declarations.
  Additional narrowing: plain CSS imports and optional/reference import misses
  now return derived empty `Rules` surfaces rooted in the active importer
  context instead of synthetic `Rules.create([])` placeholder shells.
  Additional narrowing: param-bearing mixin calls no longer allocate an
  `outerRules` wrapper just because a guard exists; that wrapper is now reserved
  for dynamic/default guard cases that actually need a separate lookup surface.
  Additional narrowing: `Collection.preEval()` and `$for.preEval()` no longer
  route through `maybeClone(...)` just to mark `preEvaluated`; those paths now
  stay on the canonical node.
  Additional narrowing: the base `Node.preEval()` fallback no longer routes
  through `maybeClone(...)`; `Rules.preEval()` stays canonical, `Ruleset.preEval()`
  now returns a derived wrapper instead of mutating the canonical source node in
  place, and `AtRule.preEval()` now only derives when pre-eval actually changes
  the at-rule shape so static-name at-rules stay canonical when their child
  rules do; mixin arguments now
  evaluate through ordinary eval/binding flow instead of `clonedEval(...)`;
  nested `@layer` parent/name tracking is now source-node aware so those
  derived `AtRule` wrappers do not break same-layer extend visibility; and the
  legacy `maybeClone(...)` / `clonedEval(...)` /
  `preserveOriginalNodes` helpers are deleted from the runtime.
- [x] Slice 14 — Retire `DeclarationRegistry` hot path for variable lookups; once all callers confirmed to go through `findVarDeclarationFast` / `liveSlotsByName`, remove the `targetRules.find('declaration', ...)` fallback for `type === 'variable'`
  Current status: `findVarDeclarationFast` now reads per-scope `ScopeFrame.declarationBucketsByName` instead of `Rules.varsByName`, while still walking outward via the `Rules` parent/sourceParent chain (not `frame.parent`, which is reserved for live slots). `getScopeFrame()` now auto-indexes previously untouched scopes, `registerNode()` keeps existing frame buckets in sync for runtime-added static `VarDeclaration`s, and the fast path now recurses through static parent-visible child `Rules` surfaces instead of punting all such lookups to `DeclarationRegistry`. Core proofs now cover import/compose child-scope hits without `DeclarationRegistry.find`.
  Current parser reality: both the current Jess parser and the Less parser still emit static `VarDeclaration` names for normal syntax; dynamic-name `VarDeclaration`s appear to be hand-built/API-only right now rather than a common frontend path. `findVarDeclarationFast` only promotes `pendingDynamicDecls` entries into the static buckets when their names have already become static on the node. If a dynamic declaration name is still dynamic at reference time, lookup does not try to resolve it; the reference stays synchronous, misses normally, and retry ownership remains with the surrounding `Rules` eval queue. The remaining direct `Rules.find('declaration', ..., 'VarDeclaration')` uses are outside the `Reference(type='variable')` hot path.
  Future exploration note: one alternative would be dependency-tracked wakeups for unresolved refs (nodes register which names they are waiting on, then retry when those names are later registered). That may allow earlier failure/reporting, but it is intentionally out of scope for this redesign. The current model stays simpler: reference lookup is synchronous, and retry scheduling remains the responsibility of `Rules` evaluation.
- [x] Slice 15 — Retire `MixinRegistry` hot path; `findMixinFast` already covers static-name Mixin lookups; verify no Ruleset-as-mixin gaps, then drop the `targetRules.find('mixin', ...)` fallback for the static-string case
  Current status: static-string callable lookup now lives behind `Rules.find('mixin', ...)` itself via `findMixinsFast`, instead of `Reference` branching around the lookup API. Plain `Reference(type='mixin')` hits and misses therefore skip `MixinRegistry.find` once scopes are indexed, and already-registered interpolated simple names do too. `Reference(type='mixin-ruleset')` stays on that same callable mixin surface and now also fast-paths already-registered interpolated simple names, plain simple-name misses, exact callable ruleset array-path hits when no namespace start exists, pure nested no-arg mixin namespace array paths, pure ruleset namespace array paths when no mixin candidate is involved, compound-prefix callable ruleset precedence when a longer array path resolves through a ruleset chain, definite array-path namespace misses when the callable surface is provably dead, a terminal callable ruleset under a resolved static namespace chain, and nested compound/complex callable ruleset segments under a ruleset namespace prefix. Plain `type='mixin'` array-path lookups now ignore ruleset ambiguity entirely and stay on the mixin namespace path; only `mixin-ruleset` preserves ruleset-side ambiguity handling. Required-arg intermediate namespace hops are now treated as definite misses unless a competing compound-prefix ruleset chain actually resolves, in which case that ruleset-side path wins without `MixinRegistry.find`. Lookup itself stays synchronous: if callable names are still dynamic, they are not resolved here and should be retried by the surrounding `Rules` eval queue. The remaining `MixinRegistry` fallbacks are therefore the genuinely ambiguous / legacy `mixin-ruleset` cases where neither the mixin namespace path nor the ruleset-side exact/prefix walkers can resolve the array path decisively. In practice that still includes local authored ampersand-descendant array-path lookups and mixin-output namespace prefixes. It is not modeled as a separate ruleset lookup path.
- [x] Slice 16 — Retire `RulesetRegistry` and remove the speculative standalone ruleset lookup surface
  Current status: `RulesetRegistry` is gone, and the speculative standalone ruleset lookup surface was removed with it. Extend roots keep their own per-root `Ruleset` sets directly, while callable ruleset-shaped things continue to resolve only through the mixin/callable surface (`mixin-ruleset` -> `find('mixin', ...)`). There is no separate `Rules.find('ruleset', ...)` path anymore.
- [ ] Cleanup slice — Extract the shared `Reference` lookup algorithm and move type-specific logic behind lookup-surface adapters
  Current status: this cleanup progressed far enough that `Reference.evalNode()`
  is now mostly orchestration over extracted helpers/adapters rather than a
  single giant type-switch. That cleanup was worthwhile, but it is now
  **de-prioritized** relative to Slice 13 / 13c and Track 5. The remaining
  `Reference` work should happen only when it directly supports shared
  lookup-surface ownership in `Rules`, runtime binding generalization, or the
  renderKey/buffered-render transition. Do not keep polishing `reference.ts`
  just because it is locally tractable.
- [ ] `FunctionRegistry` optimization — keep as plugin API but change granularity from per-`Rules` to per-stylesheet: one global registry for built-ins/plugins; one stylesheet-level registry created on demand when `registerFunction()` is called within a stylesheet; stylesheet registry falls through to global; `@compose` children see only the global (not the parent stylesheet registry); `@import` children see the parent stylesheet registry; O(1) lookup in common case (no stylesheet-local functions), O(depth of stylesheet registries between call site and global) otherwise — in practice 1-2 hops, never the full Rules-node depth

### Track 2 — Node Shape: Direct Instance Fields

Replace the current `value = Proxy({ name, value, ... })` pattern with direct typed class fields on each node class (e.g. `decl.name`, `decl.value`). Stable V8 hidden classes, no per-node Proxy allocation, no Proxy intercept cost.

- [ ] Audit all node classes for field shape (`declaration.ts`, `ruleset.ts`, `mixin.ts`, etc.)
- [ ] Migrate fields off `value` proxy to direct class properties with explicit `adopt()` calls
- [ ] Update all call sites in `core`, `fns`, parsers, and plugins to use new field accessors
- [ ] Update `less-compat` adapter layer to map old `value.name` / `value.value` paths to new fields
- [ ] Remove `value` proxy infrastructure from `Node` base class once all subclasses migrated

### Track 3 — Less-Compat Adapter Layer

Replace the transparent `Proxy`-based compat shim with explicit typed adapter classes (e.g. `LessRuleset`, `LessDeclaration`). V8-inlineable getters, no per-node Proxy, explicit API surface.

- [ ] Design adapter class interface for each Less-exposed node type
- [ ] Implement adapter classes (`jess-plugin-less-compat` package)
- [ ] Replace `isLessProxy` / `getJessNodeFromProxy` checks with `instanceof` guards
- [ ] Remove the `Proxy` factory from the compat layer
- [ ] Verify Less compatibility suite still green after switch

### Track 4 — Whitespace / Trivia Token Proposal

Replace `pre`/`post` string fields on nodes with an offset-keyed `TriviaMap`. Static declaration names become plain strings (not `Any` nodes), which simplifies static-vs-dynamic detection in `ScopeFrame` and removes a Proxy allocation per declaration.

- [ ] Finalize `TriviaMap` design (keyed by source offset); see `docs/future/whitespace-token-proposal.md`
- [ ] Remove `pre`/`post` from `Node` base class
- [ ] Migrate trivia storage to `TriviaMap` in serialization path
- [ ] Static `name` fields on `VarDeclaration`, `Declaration`, `Mixin` become plain `string` (not `Any`)
- [ ] Update `ScopeFrame` / `varsByName` / `mixinsByName` to key directly on `string` without `.valueOf()` call

### Track 5 — Pre-Eval Elimination (Buffered Render)

Registry redesign (Track 1) and direct instance fields (Track 2) are prerequisites.

**Open design question (exploratory): priority queue vs linear render with deferred misses.**
Before this track hardens, decide empirically whether to keep the existing
priority-queue staging (classify children, evaluate in bucket order, requeue on
resolution) or switch to a single source-order render that streams strings and
queues `PendingRefSlot` placeholder segments for unresolved lookups, draining
them at the end of each `Rules` walk. The segmented buffer below already
requires deferred finalization for extends / `@media` bubbling / reference
imports; a pending-ref segment reuses that machinery rather than adding a
second ordering source of truth. Static bucket pre-population from
`_indexRules` means forward refs usually resolve on first touch, so the miss
list is expected to be small or empty in the common case. See
[pre-eval-elimination.md](/Users/matthew/git/oss/jess/docs/future/pre-eval-elimination.md)
("Open Question: Priority Queue vs Linear Render With Deferred Misses") for
the full tradeoff and the measurements to take before committing.

**Key design constraint: extends and `@import (reference)` require deferred selector finalization.**
A true single-pass top-to-bottom render cannot know at the time it encounters `.a {}` whether
a later `.b:extend(.a) {}` will augment its selector, or whether a reference-imported ruleset
needs to surface at all. The solution is a *buffered render with typed segments* — most output
is strings, but selector-bearing nodes push structured segments that are finalized in a cheap
post-step.

#### Buffer segment types

```ts
type Segment = string | RulesetBlock | MergeSlot

interface RulesetBlock {
  selector: SelectorSet   // live reference, not yet stringified
  body: Segment[]         // recursively nested
  isReference: boolean    // from @import (reference) — suppress unless activated by extend
  extendRoot: ExtendRoot  // which root this ruleset is reachable from (baked in at push time)
}

interface MergeSlot {
  property: string        // +: and +_: — needs all same-property decls within scope before finalizing
  segments: Segment[]
}
```

#### Extend side table (collected during the render pass)

```ts
interface ExtendRecord {
  targetSelector: SelectorSet   // what's being targeted
  extendRoot: ExtendRoot        // which root the :extend() lives in
  sourceBlock: RulesetBlock     // block whose selector gets augmented
}
```

#### Post-step (pure function, no AST access)

For each `RulesetBlock` in the buffer:
1. **Selector match** — walk-and-consume / `selector-match-core` against `ExtendRecord.targetSelector`
   (same algorithm, but operating on already-resolved `SelectorSet` objects, not AST nodes)
2. **Root visibility** — `record.extendRoot` can reach `block.extendRoot`
   (same predicate as `extend-roots.ts`, but purely over two `ExtendRoot` values baked in at push time)
3. **Reference visibility** — `block.isReference` blocks inclusion unless matched by steps 1+2

The post-step is `(Segment[], ExtendRecord[]) → string` — no registry queries, no live context,
no AST traversal. Straightforward to test in isolation.

#### Checklist

- [ ] **Decide eval shape** (priority queue vs linear render with deferred misses — see Open design question above). Spike both against the Less benchmark and jess corpus; gate the rest of this checklist on the result. If Shape B (linear + `PendingRefSlot`) wins, revise the segment and post-step sections accordingly before implementation.
- [ ] Add `_hasExtends` and `_hasReferenceImports` flags to `Rules` during `_indexRules`
  Current status: `Rules` now carries local structural `_hasExtends` and `_hasReferenceImports`
  flags as Track 5 prep. They are maintained during `registerNode(...)`, survive
  evaluated import wrapping, and currently reflect the local `Rules` surface
  (e.g. direct extend nodes, direct reference-mode child wrappers / reference
  imports). This is enough to start gating later render work on a per-container
  basis, but it is **not yet** the full transitive import-graph / whole-file
  segmented-render decision described below.
  - **`@compose`**: flags are per-file, set at that file's own index time — each file is a
    closed rendering unit; children cannot affect parents at all (parents pass state *down*
    to children only via `mutable: true`); flat/segmented decision is independent per file
  - **`@import`**: flags must be propagated transitively up the import graph after the full
    graph is resolved; any file in the graph having an extend forces the combined root into
    segmented mode; the only static optimization available is the transitive flag itself —
    deeper static analysis is not tractable (selector matching is undecidable under
    interpolation); per-file caching requires migrating to `@compose`
- [ ] Design `Segment` / `RulesetBlock` / `HoistBlock` / `MergeSlot` / `ExtendRecord` types
- [ ] Implement flat-mode `RenderBuffer` (common case: no extends, no reference imports — pure `string[]`, no segment allocation, no post-step)
- [ ] Implement segmented-mode `RenderBuffer` (has extends or reference imports)
- [ ] Implement `render(ctx, buf: RenderBuffer)` on each node type; flat mode pushes strings directly
- [ ] Migrate extend collection from AST walk to render-pass side table population
- [ ] Implement post-step: selector finalization, extend application, reference visibility
- [ ] Migrate `extend-roots.ts` reachability logic to pure `ExtendRoot × ExtendRoot` predicate
- [ ] Remove `evalNode` / `preEval` / `toTrimmedString` from node base class once all node types migrated
- [ ] Verify end-to-end output parity with pre-existing test baselines

## Read This First

### Must Read For This Slice

1. [AGENTS.md](/Users/matthew/git/oss/jess/AGENTS.md)
2. [2026-04-13-registry-redesign-proposal.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-registry-redesign-proposal.md)
3. [2026-04-13-registry-architecture-audit.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-registry-architecture-audit.md)
4. [packages/core/src/tree/rules.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts)
5. [packages/core/src/tree/reference.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/reference.ts)
6. [packages/core/src/tree/__tests__/mixin.test.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/__tests__/mixin.test.ts)

### Background Context Only

Read these only if you need the broader performance story or canonical-tree
constraints behind the current design:

- [2026-04-13-less-benchmark-audit.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-less-benchmark-audit.md)
- [2026-04-13-less-benchmark-investigation-tickets.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-less-benchmark-investigation-tickets.md)
- [docs/future/node-copy-reduction/README.md](/Users/matthew/git/oss/jess/docs/future/node-copy-reduction/README.md)
- [docs/future/node-copy-reduction/HANDOFF.md](/Users/matthew/git/oss/jess/docs/future/node-copy-reduction/HANDOFF.md)

## What Was Started

The first implementation slice targets one specific architectural mistake:

- mixin-call params and `@arguments` were being materialized as `VarDeclaration`
  nodes
- those synthetic declarations were pushed into a wrapper `Rules`
- variable lookup then rediscovered them through generic declaration-registry
  search

That is exactly the wrong shape described in the redesign proposal.

The first cut changed that by making wrapper-scope param values available as
direct runtime bindings instead of wrapper-inserted declaration nodes.

The second cut removed another declaration-shaped transport step:

- mixin matching no longer rewrites matched `Any(role=property)` params into
  fake `VarDeclaration`s
- mixin matching no longer rewrites matched `Rest` params into fake
  `VarDeclaration`s just to carry values forward
- matching now carries:
  - runtime binding records for actual lookup
  - a separate `List<Node>` signature for recursion detection

The third cut removed the copied-and-mutated param list itself:

- mixin matching now reads original param definitions directly
- bound/default/rest values are cloned only for binding/signature payloads
- matching no longer mutates copied param nodes to transport values

The fourth cut removed a now-dead shallow `mixin.copy()` in candidate matching:

- candidate matching no longer makes a shallow mixin copy just to carry
  resolved params
- resolved binding records are keyed directly by the original matched mixin

The fifth cut adds a `varsByName` fast map on `Rules` for direct lexical
`VarDeclaration` lookup, bypassing the full declaration-registry machinery for
the dominant hot case (ordinary contextual variable lookup):

- `Rules.varsByName: Map<string, VarDeclaration[]> | undefined` — `undefined`
  means not yet indexed; an empty `Map` means indexed with no vars
- populated incrementally by `registerNode` as nodes are pushed
- also initialized at the start of `_indexRules()` for scopes that never had
  nodes pushed directly
- reset to `undefined` in `clone()` so cloned scopes re-index fresh
- `findVarDeclarationFast(startRules, name, filter)` in `reference.ts` walks
  `.parent ?? .sourceParent` (same as `findRuntimeVarBinding`), checks
  `varsByName` at each `Rules` scope, bails if any scope is not yet indexed
  (causing the caller to fall through to full registry which warms it up)
- called between the `findRuntimeVarBinding` check and the full `targetRules.find`
  in `performLookup` for `type === 'variable'`
- proof test added: a no-param mixin referencing `@base-color` 3 times asserts
  `declarationHits.length <= 1` — only the first lookup hits the registry; the
  second and third use the fast path

## Files Changed

- [packages/core/src/tree/rules.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts)
- [packages/core/src/tree/reference.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/reference.ts)
- [packages/core/src/tree/__tests__/mixin.test.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/__tests__/mixin.test.ts)

## Current Dirty Diff

### `rules.ts`

Added a lightweight runtime binding mechanism on `Rules`:

- `RuntimeVarBinding`
- `rules.runtimeVarBindings`
- `setRuntimeVarBinding(name, binding)`
- `findRuntimeVarBinding(name)`

Mixin invocation wrapper behavior changed:

- param wrapper scope still exists
- param AST nodes are still preserved for AST/debugging compatibility
- but wrapper params are no longer pushed into `outerRules` as lookupable
  declarations
- instead, wrapper params are registered via `outerRules.setRuntimeVarBinding(...)`
- `@arguments` is also registered as a runtime binding instead of a synthetic
  `VarDeclaration`
- matched `Any(role=property)` params now stay non-declaration-shaped during
  matching
- matched `Rest` params now stay non-declaration-shaped during matching
- recursion detection still gets a stable signature list, but that signature is
  now separate from the runtime binding transport
- matching no longer copies the whole params list before binding
- matching no longer mutates copied param nodes just to carry bound/default
  values
- matching no longer shallow-copies mixin candidates just to associate resolved
  params with them

### `reference.ts`

Variable lookup now checks runtime bindings before declaration lookup, and
then the `varsByName` fast path before the full registry:

- in `performLookup(...)`, variable lookup on `Rules` does:
  1. `targetRules.findRuntimeVarBinding(key)` first (mixin params)
  2. `findVarDeclarationFast(targetRules, key, filter)` second (lexical vars)
  3. full `targetRules.find('declaration', ...)` third (fallback / warm-up)

`findVarDeclarationFast` is a module-level function that:

- walks `.parent ?? .sourceParent` up the scope chain
- checks `scope.varsByName` at each `Rules` node
- returns `undefined` immediately if any scope is not yet indexed (warm-up
  fallback)
- stops at non-classic-import boundaries (same policy as full registry)

Reference evaluation also learned how to evaluate a runtime binding:

- evaluate the bound value
- copy/freeze the result similarly to declaration lookup
- preserve `pre` / `post`
- use `sourceNode` for recursion protection when available

### `mixin.test.ts`

The focused mixin suite was updated to match the new intended model:

- live params no longer render as emitted `$var: ...;` declarations
- mixin behavior still resolves those params correctly
- rest params and nested param lookups still work

This is an intentional semantic shift in output visibility for synthetic param
bindings.

## What Passed

Focused core verification is green:

```sh
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts
```

That now includes a core-only guardrail proving:

- mixin-call param bindings
- default param bindings
- rest param bindings
- `@arguments`

resolve successfully without hitting `Rules.find('declaration', ...)` for those
names.

After the second slice, this is still green:

```sh
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts
```

After the third and fourth slices, this is still green:

```sh
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts
```

After the fifth slice, this is still green (34 tests):

```sh
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts
```

Workspace dependency build is green:

```sh
pnpm --filter jess... build
```

Direct full benchmark render through the linked Less facade:

```sh
node -e 'const fs=require("node:fs"); const less=require("/Users/matthew/git/oss/less.js/packages/less"); const file="/Users/matthew/git/oss/less.js/packages/less/benchmark/benchmark.less"; const src=fs.readFileSync(file,"utf8"); less.render(src,{filename:file}).then(out=>{console.log("ok", out.css.length)}).catch(err=>{console.error(JSON.stringify({message:err.message, filename:err.filename, line:err.line, column:err.column, extract:err.extract}, null, 2)); process.exit(1);});'
```

Observed result:

- `ok 0` — confirmed pre-existing at clean commit `51291e2f` (before any session
  changes); slices 1–5 neither introduce nor worsen this. Treat as pre-existing
  harness integration debt; investigation is not the next step for this slice.

## What Is Still Broken

The old Less-facade benchmark harness investigation is no longer the primary
next step for this slice.

The redesign work should continue in `core`, with focused proofs and targeted
instrumentation there first.

The performance harness path is still not trustworthy for this slice:

This command currently fails:

```sh
node scripts/profile-less-benchmark.mjs --file=benchmark.less
```

Observed failure:

- `'size' is not defined`

Important narrowing:

- the failure does **not** reproduce in direct `less.render(...)` of the full
  benchmark file
- a tiny imported-mixin default-param repro also works in direct `less.render`
- so this looks like a harness-path mismatch, not a confirmed runtime
  regression in the main render path

## Harness Status

The harness failure is now treated as secondary tooling debt, not the main
driver of the redesign.

What is known:

- full `less.render(...)` of the benchmark file succeeds
- full `less.render(...)` with `math: 'always'` also succeeds
- importing `core`, `less-parser`, or `jess` alone does not reproduce the
  harness failure

So the failure is likely in the instrumentation setup itself, not the first
runtime-binding cut.

## Likely Cause Of The Remaining Failure

The most likely cause is that the profiling harness is exercising a slightly
different execution environment than the main Less facade path:

- different plugin setup
- different compiler entrypoint
- different option surface
- or different import/context plumbing

The current `'size' is not defined` symptom points at imported Less mixin
default-param access, but only in the harness path.

Do **not** assume the runtime-binding cut itself is wrong until the harness path
is made faithful to the real benchmark execution path.

## Why "No Forks, No Mutations" Is Possible

The fork/renderKey system exists because the current engine is **two-pass**:

```
pass 1 — eval:       walk the tree, evaluate each node, store results on the node
pass 2 — serialize:  walk the tree again, read stored results, build CSS string
```

Between pass 1 and pass 2, results must be stored somewhere. Nodes are that somewhere. When the same mixin body is called twice with different params, both calls would overwrite each other's stored results — so `renderKey` forks each node into per-call storage.

**The target model collapses both passes into one:**

```
one pass — render:   walk the tree as a read-only template,
                     resolve references against the active ScopeFrame on the fly,
                     write output directly to the output buffer
```

Nothing is stored on the node. The node is a description of what to render. Two calls to the same mixin body walk the same template with different `ScopeFrame`s and write to different positions in the output buffer. No intermediate storage. No fork.

The two-function API (from the proposal's "How Each Node Type Renders" section):

- `render(node, ctx) → void` — for output-producing nodes; writes directly to `ctx.outputBuffer`; never stores on the AST
- `resolve(node, ctx) → Node` — for value-returning contexts (function arguments, guard conditions, key resolution); evaluates without writing; result is used immediately then garbage-collected

For example, an `Operation` in the new model:

```
render(op, ctx):
  left  = resolve(op.left, ctx)   // → Color, Dimension, etc. — discarded after use
  right = resolve(op.right, ctx)
  result = compute(left, op.operator, right)
  ctx.outputBuffer.append(result.valueOf())
  // result is GC'd — never stored on any AST node
```

No `op.set('result', result, renderKey)`. No per-call fork. Just compute → write → discard.

**Current status**: the Track 1 slices (1–12b) have built the prerequisite for this by making all *variable and param lookups* context-driven via `ScopeFrame`/`varsByName`. The *structural evaluation* changes (Operation, Interpolated, SelectorPseudo, etc.) are the remaining work in Track 1 (Slice 13, fork/renderKey deletion) and depend on Track 5 (buffered render) for the full one-pass architecture.

One explicit guardrail for the remaining `Ampersand` work:

- treat `&` like a live contextual selector binding
- the binding source is the current parent selector / selector context, not
  `liveSlotsByName`
- but the ownership rule is the same as other live state: it belongs in the
  captured live context or a short-lived derived node, never on the canonical
  source `Ampersand` node
- this matters because extends can change the effective parent selector later,
  so `&` must resolve against the current live selector view rather than an
  earlier stored snapshot

See: proposal "How Each Node Type Renders" (~line 347) and "Materialization Boundaries" (~line 398) for the full model.

---

## Resolution Strategy Architecture

`ReferenceOptions.resolution` now has two modes:

| Mode | Meaning | When used |
|------|---------|-----------|
| `'contextual'` (default) | **Contextual** — ordinary refs use contextual scope lookup. | All ordinary variable and property lookups |
| `'live'` | Resolve using the call site's live lookup position. | Jess `$~var` syntax inside mixin bodies |

`'linear'` (formerly Jess `$^var` syntax) has been deleted. It is not used in Less
or in any shipped Jess syntax, and the merge-declaration case that was incorrectly
using it should be handled through explicit live lookup, not the default contextual mode.

### Variable lookup order in `performLookup` (type === 'variable')

1. **`liveSlotsByName` frame-chain walk** — covers mixin params and `@arguments`
   (populated at call time into the `ScopeFrame`; walks `frame.parent` chain which
   is the call-site chain, not the node-parent chain)
2. **`findVarDeclarationFast` fast path** — covers ordinary lexical vars when
   `opts.ignoreParentScopeStart` is true (the normal case); walks `varsByName`
   on each `Rules` ancestor via node-parent chain; bails if any scope is not yet
   indexed (falls through to full registry which warms it up)
3. **`targetRules.find('declaration', ...)` full registry** — fallback for
   unindexed scopes and edge cases; also warms up `varsByName` and `mixinsByName`
   for future fast-path hits

### Key constraint: `liveSlotsByName` vs `declarationBucketsByName`

Only `liveSlotsByName` is safe to walk via the call-site frame chain. Lexical
vars in `declarationBucketsByName` follow Less **definition-site** semantics —
walking them via the call-site chain would return wrong values (call-site
definitions instead of definition-site definitions). The frame chain is therefore
used only for live param slots; lexical vars go through `findVarDeclarationFast`
which uses the node-parent chain (definition site).

## Bootstrap Closure Bug Fix (Session 2026-04-13)

This session fixed a correctness bug that was blocking the Bootstrap benchmark: mixin body
local variables were inaccessible inside detached rulesets passed to other mixins.

### Pattern being fixed

```less
#table-row-variant(@state, @background) {
  @hover-background: darken(@background, 5%);       // local body var
  .table-hover .table-@{state} {
    #hover({ background-color: @hover-background; }); // closure over @hover-background
  }
}
```

### Root cause

In `MixinCollection.evalCall`, anonymous-mixin candidates (no `name`/`params`/`guard`) are
processed via the "anonymous mixin path". The path shallow-cloned the body (`unlocked`) and
pushed it to `outputRules` **unevaluated**. When `Call.evalNode` later called
`result.eval(context)` on the containing `&:hover` Ruleset, a deep-clone (from
`evaluateCandidateOutput`'s `clonedEval` context) overwrote `unlocked.parent` via `adopt()`,
breaking the parent chain that led back to the outer mixin body's registry where
`@hover-background` was registered.

### Fix (anonymous mixin path in `rules.ts`)

Evaluate `unlocked` immediately while the call-site parent chain is intact:

```typescript
// Before: push unevaluated
outputRules.push(unlocked);

// After: evaluate immediately, push result
const evaledUnlocked = unlocked.eval(context);
unlocked = (isThenable(evaledUnlocked) ? await evaledUnlocked : evaledUnlocked) as Rules;
outputRules.push(unlocked);
```

`unlocked.parent` walks up through `candidate.parent` (the args List of the outer mixin call)
→ the outer Call → the calling mixin's body Rules → the `Ruleset` that called `#hover` →
cbody (`Rules` of the outer mixin) — which has `@hover-background` in its registry.
After evaluation `unlocked` is static, so the subsequent `result.eval(context)` pass is a
no-op for it.

### Tests added

Two regression tests added to `mixin.test.ts`:

- `resolves local mixin body variable inside a detached ruleset passed to another mixin (closure)`
- `resolves local mixin body variable inside a detached ruleset when call is nested in a child ruleset`

Both pass. Full core suite: **1165 passed, 22 skipped** (no new failures).

### Reference.ts fast-path fix

During this session a stale edit was found in `reference.ts` that accidentally removed the
early return in the `findMixinFast` path:

```typescript
// Before (correct, at HEAD):
if (fast.length > 0) {
  return fast;  // skips MixinRegistry.find — the point of the fast path
}

// After bad edit:
// early return removed, always fell through to MixinRegistry.find
```

Restored to original behavior. The `mixinsByName fast path (slice 7)` test verifies this.

---

## Next Step

Track 1 is no longer about outer renderKey plumbing. That runtime is gone.

What remains:

1. Reclassify Slice 13 in this doc from “active deletion seam” to “completed,
   with import-sharing caveat tracked separately in Slice 13c”.
2. Audit shared imported-AST behavior under the new canonical-only node model
   and either close Slice 13c or narrow it to the exact remaining import path.
3. Keep the handoff compressed: remove stale references to `_renderKey`,
   `_childForks`, `getValue(renderKey)`, and wrapper renderKey transport as if
   they are still live work.

Do not reintroduce node-local fork machinery under a different name. If a pass
does not make the source tree lighter or move eval/serialization closer to the
session-owned buffer model, it is probably not a Track 1 pass.

## Constraints To Preserve

- Keep one canonical `Rules.value` array.
- Do not introduce cloning/materialization as a lookup strategy.
- Do not reintroduce wrapper `VarDeclaration` insertion just to make lookup
  work.
- Preserve the direct render behavior that is currently green.
- Keep the next cut narrow and measurable.

## Useful Commands

Focused test:

```sh
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts
```

Build dependency chain:

```sh
pnpm --filter jess... build
```

Direct benchmark render sanity check:

```sh
node -e 'const fs=require("node:fs"); const less=require("/Users/matthew/git/oss/less.js/packages/less"); const file="/Users/matthew/git/oss/less.js/packages/less/benchmark/benchmark.less"; const src=fs.readFileSync(file,"utf8"); less.render(src,{filename:file}).then(out=>{console.log("ok", out.css.length)}).catch(err=>{console.error(JSON.stringify({message:err.message, filename:err.filename, line:err.line, column:err.column, extract:err.extract}, null, 2)); process.exit(1);});'
```

Current failing harness check:

```sh
node scripts/profile-less-benchmark.mjs --file=benchmark.less
```

## Current Worktree State

At the time of this handoff, the uncommitted files are:

- [packages/core/src/tree/rules.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts) — `getScopeFrame()` now auto-indexes previously untouched scopes; runtime `VarDeclaration` registration keeps existing `declarationBucketsByName` buckets in sync without duplicating entries
- [packages/core/src/tree/reference.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/reference.ts) — `findVarDeclarationFast` now reads per-scope `ScopeFrame.declarationBucketsByName` instead of `Rules.varsByName`, while preserving outward walk on the `Rules` parent/sourceParent chain
- [packages/core/src/tree/__tests__/mixin.test.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/__tests__/mixin.test.ts) — tightened proof test: lexical contextual variable lookups no longer touch `DeclarationRegistry.find`

Test status: **1167 passed, 22 skipped** (78 files pass, 2 skip; no failures).
