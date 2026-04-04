# Node Update Status

This file tracks only edge + cursor migration work.

If an item does not directly move the runtime toward:

- field-aligned edges
- `RenderKey`-selected reads
- cursor-based parent/child traversal

it does not belong here.

## Target

The target runtime shape is:

- every node instance starts with `renderKey = CANONICAL`
- eval only assigns `EVAL` when evaluation returns a different node object
- canonical child fields stay the canonical value
- `parent` is the primary lookup path for the current placement
- `sourceParent` is canonical definition provenance
- canonical static-field mutation must return or install a derived
  non-canonical node instead of mutating the canonical node in place
- alternate child links are field-aligned edges:
  - singular child: `fooEdge?: NodeEdge<T>`
  - list child: `fooEdges?: Array<NodeEdge<T> | undefined>`
- alternate parent links live in `parentEdges?: NodeEdge<Node>`
- canonical runtime state stays direct on the node:
  - `state: number`
  - `preEvaluated: boolean`
  - `evaluated: boolean`
- non-canonical runtime state only exists when it diverges:
  - `stateEdges?: Map<RenderKey, number>`
- non-canonical nodes are ephemeral placements:
  replacing one non-canonical node with another does not require retaining the
  displaced derived node unless an edge still references it
- path selection uses `RenderKey`
- traversal uses a cursor: `{ node, renderKey }`

The target model is not:

- `sourceParent` varying by eval placement
- `sourceParentEdge` acting as a hidden invocation-scope channel
- raw child field reads in eval code bypassing render-key-aware state

Discipline rule:

- if code needs the current placement, read through `get(...)`, typed field
  getters, `getParent(...)`, `getChildren(...)`, or a cursor
- if code intentionally needs the canonical field, make that explicit
- when the read is intentionally canonical, prefer the direct field
  (`node.value`, `node.rules`, `node.params`, etc.) over `.get('value')` or
  other generic getters
- do not read `node.params`, `node.guard`, `node.rules`, `node.value`, or
  similar fields directly in converted/hybrid eval paths just because it is
  convenient
- `leakyRules` caller fallback should be modeled as an extra parent-edge lookup
  lane, not by changing the meaning of `sourceParent`
- if that caller fallback needs its own edge identity, prefer an explicit
  `CALLER` symbol key in `parentEdges` instead of pretending it is the primary
  render-key parent edge
- write-side discipline matters as much as read-side discipline:
  `.parent` should always be the current primary lookup path for that node's
  placement, while caller fallback is additive and belongs on
  `parentEdges.get(CALLER)`
- do not rewrite `sourceParent` during call/invocation output shaping just to
  smuggle caller ancestry into lookup

This file does not track:

- registry redesign by itself
- mixin/control semantics by themselves
- broad Context cleanup by itself
- test triage on hybrid nodes

Those only matter here when they directly block edge/cursor conversion.

## Current Reset

The core test suite no longer carries direct `activeState` / `EvalState` /
`setField` / `getField` usage in `packages/core/src/tree/__tests__` or
`packages/core/src/tree/util/__tests__`.

That cleanup matters here only because it removes old-model poison from the
working surface. From this point, remaining reds in focused files should be
treated as production runtime issues, not test-shim compatibility issues.

## Verification Rule

Only use tests as hard gates for surfaces that are already edge/cursor-based.

If a node is still hybrid, failures are migration signals only.

Do not add old-model compatibility logic here just to satisfy tests on nodes that
are not yet converted.

## Edge/ Cursor Surfaces

### 1. Render-Key Read Surface

Status: `active`

Goal:

- child reads that only need path selection should use `renderKey`
- do not pass full `Context` for edge selection alone

Primary files:

- `packages/core/src/tree/node-base.ts`
- `packages/core/src/tree/util/cursor.ts`

### 2. Field-Aligned Edge Storage

Status: `active`

Goal:

- remove generic child-edge storage as a target shape
- keep only field-aligned edge surfaces:
  - `fooEdge`
  - `fooEdges`
  - `parentEdges`

Primary files:

- `packages/core/src/tree/node-base.ts`
- `packages/core/src/tree/util/cursor.ts`

### 3. Cursor Parent/Child Traversal

Status: `active`

Goal:

- parent traversal must depend on `{ node, renderKey }`
- child traversal must resolve field-aligned edges through `renderKey` or cursor

Primary files:

- `packages/core/src/tree/util/cursor.ts`
- `packages/core/src/tree/util/field-helpers.ts`
- `packages/core/src/tree/util/serialize-helper.ts`

### 4. No-Context Render Walks

Status: `active`

Goal:

- render-owned nodes must be readable through direct field + edge state without
  requiring hidden `Context.activeState` rescue
- no-context serialization should be able to follow the current render-owned
  path when the node itself already owns that path

Primary files:

- `packages/core/src/tree/rules.ts`
- `packages/core/src/tree/ruleset.ts`
- `packages/core/src/tree/at-rule.ts`
- `packages/core/src/tree/util/serialize-helper.ts`

Current warning:

- `Rules` / `Ruleset` serialization still has too much shape recovery through
  rendered-text inspection.
- Checks based on string prefixes, start characters, or already-serialized
  selector text should be treated as temporary migration debt.
- The target cleanup is node-shape-driven serialization scheduling, not more
  text comparisons in `serialize-helper.ts`.

## Node Conversion Status

This section tracks only edge/cursor conversion status.


| Node                   | Status          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Expression`           | `converted`     | Direct canonical field kept; render-key child selection characterized.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Block`                | `converted`     | Simple child surface converted to direct field + render-key read path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Negative`             | `converted`     | Simple child surface converted to direct field + render-key read path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Paren`                | `converted`     | Simple child surface converted to direct field + render-key read path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Quoted`               | `converted`     | Simple child surface converted to direct field + render-key read path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `SelectorCapture`      | `converted`     | Simple child surface converted to direct field + render-key read path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `SelectorInterpolated` | `converted`     | Simple child surface converted to direct field + render-key read path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Url`                  | `converted`     | Simple child surface converted to direct field + render-key read path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `List`                 | `converted`     | Canonical container stays in place for same-length render-path child replacement; `valueEdges` now carry indexed alternates and local shape changes return a different node.                                                                                                                                                                                                                                                                                                                                                                      |
| `Rest`                 | `converted`     | Simple child surface converted to direct field + render-key read path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Sequence`             | `converted`     | Canonical container stays in place for same-length render-path child replacement; `valueEdges` carry indexed alternates and only shape changes return a different node.                                                                                                                                                                                                                                                                                                                                                                           |
| `Rules`                | `in_progress`   | Major render-key entry/exit owner. Wrapper registry seeding indexes direct render-visible children, render-visible reads no longer clone container nodes on read, and render-key child mutation updates/removes `parentEdges` directly on wrapper-owned paths. Main blocker now is scope ownership still leaking through `renderParent` instead of a pure parent-edge / cursor model.                                                                                                                                                             |
| `Ruleset`              | `in_progress`   | Direct field getters are field-aligned (`getSelector(renderKey?)`, `getRules(renderKey?)`, `getGuard(renderKey?)`, etc.), and `.maybeClone(...)` is gone in favor of explicit `.clone()`. Import-style is green again after placement-owned top-level import wrappers and render-key-aware `enterRules()` body ownership fixes, and `Reference` no longer re-identifies resolved definition-like nodes through generic eval inheritance. The parser-generated `tests-unit/import/import-reference.less` activation / ancestry seam is now fixed too: multi-candidate mixin output assembly rebinds candidate wrapper ancestry onto the caller-owned path without flattening away candidate wrappers or rebasing their state lanes. The formerly-live parser-backed `extend.less` seam is also fixed again: exact local-child extend can now fall back to the live own-selector surface after earlier local `all` extension, but only under a single-parent-selector parent and only when the active parent selector does not already contain the extender. Remaining blockers are now mostly selector/output-shape parity seams. |
| `AtRule`               | `in_progress`   | Major helper cleanup landed: no `AtRule` `activeState` writes, no generic `get('name', context)` / `get('selector', context)` hot-path reads, and hoisted wrapper selector composition now uses explicit cloned child `Ruleset`s. The remaining live issue is not raw `AtRule` field access; it is the parser-generated reference-import activation / ancestry path that still fails in real Less integration.                                                            |
| `Reference`            | `in_progress`   | Lookup-parent walk still depends on `context.rulesContext` and `Rules.renderParent` as side channels, but `Reference` no longer re-identifies resolved definition-like nodes through generic eval inheritance. That guard now protects mixin/ruleset/function lookups from being re-registered as bogus `EVAL` definitions. Remaining work is to make reference-import activation and ruleset-as-mixin ancestry use the render-owned path directly instead of the side channels.                                                                                                                                       |
| `Call`                 | `in_progress`   | Direct dispatch and render-key-owned result shaping are in place. The remaining production seam is narrower: function/mixin call-time result processing still has a few ownership-sensitive branches, but the old “not converted” wrapper model is gone.                                                                                                                                                                                                                                                                                                                                          |
| `Mixin`                | `in_progress`   | Direct mixin invocation primitives and render-key scopes are in place. A real child-edge bug was fixed here: `Mixin.preEval()` now reattaches `rules` / `params` / `guard` children on the active render-key path, and guarded dispatch now reads the current guard surface instead of a canonical `candidate.get('guard')` read. That removed the old emitted-nested-mixin closure failure in `mixins-guards.less`. Multi-candidate output assembly is also narrower now: `assembleMixinInvocationOutput(...)` no longer canonically nests caller-owned candidate wrappers for reference-import activation, and parser-backed `import-reference.less` is green again. `mixins-guards-default-func.less` is green again too; the remaining mixin-related reds are selector-shape or formatting parity, not output assembly/runtime lookup failures. |
| `Control`              | `in_progress`   | Runtime-generated numeric render keys landed for loop placements, and narrow loop proofs now exist. The remaining work is final production conversion of loop/output ownership, not more test-side patching.                                                                                                                                                                                                                                                                                                                                      |


Only the `converted` rows are valid hard-gate targets for focused edge/cursor tests.

## Immediate Next Work

1. Stay on narrow production surfaces only: pick one component, convert one owner/path seam, and verify it with a focused proof test.
2. Keep the remaining frontier grounded in the actual failing fixture output. The current Jess red set is:
   - selector-shape-only output in `extend-nest.less`
   - grouped `:is(...)` route output in `rulesets.less`
   - formatting-only output drift in `css-3.less`, `css-grid.less`, and `whitespace.less`
3. Continue deleting remaining clone/materialize seams only where they directly block edge/cursor conversion.
4. When a live bug turns out to be “wrong field was read directly,” fix the read surface first before adding more wrapper/source-parent repair logic.

## Transitional Baggage To Remove

Only listed here when it directly blocks edge/cursor work:

- generic child-edge scaffolding
- hidden no-context fallbacks that still depend on old state overlay
- clone/materialize behavior used in place of edge/cursor ownership
- `packages/core/src/tree/util/field-helpers.ts` as the activeState compatibility sewer
- `packages/core/src/tree/util/legacy-node-ops.ts` as quarantined returned-result shaping
- `Rules.renderParent` as an undocumented scope-parent side channel

## Future Runtime Overhead

These are not edge/cursor blockers by themselves, but they should be tracked as
follow-on runtime cleanup once the active correctness bugs are stable.

- `packages/core/src/define-function.ts` still exposes function metadata through
  a `Proxy`.
  Desired end-state: attach stable metadata (`name`, `options`, `_internal`)
  directly to the callable with `defineProperty`/`defineProperties` instead of a
  per-access trap wrapper.

## Active Less Fixture Seams

- Workflow rule for Jess parity:
  when a red shows up only in `packages/jess/test/less/all-less.test.ts`,
  prefer adding a parser-accurate focused core repro first when practical.
  Use the core repro as the fast debugging loop and keep the Jess fixture as the
  outer parity confirmation.

Recent proof milestone:

- `packages/core/src/tree/__tests__/node-graph.test.ts` now provides direct
  graph-level coverage for canonical parent walks, render-key wrapper parent
  walks, detached unlock wrappers, `CALLER` as a secondary lane, and the
  core child-edge helper behavior. Treat that suite as the baseline proof that
  parent/cursor primitives themselves are working before debugging higher-level
  mixin/import behavior.

- `tests-unit/property-accessors/property-accessors.less`
  Fixed.
  A focused core repro now exists in
  `packages/core/src/tree/__tests__/declaration.test.ts` proving that merged
  property declarations must remain visible both to later nested property
  lookups and to the parent declaration chain itself.
  The actual fix was in post-eval declaration coalescing:
  `Rules._coalesceMergedDeclarations()` now appends `+:` anchor values instead
  of replacing the earlier anchor with the later scalar.

- `tests-unit/mixins-interpolated/mixins-interpolated.less`
  Fixed.
  The remaining start-of-selector `:is(...)` differences now live only in
  fixture-parity cases where Jess groups selector-list parents and Less expands
  them into repeated selectors.

- `tests-unit/extend/extend.less`
  Fixed.
  The parser-backed failure was not serializer ordering; it was target
  resolution after a prior local `all` extend widened the child own-selector
  list. The durable fix is in `packages/core/src/tree/util/extend-roots.ts`:
  `applyInstructionToRuleset(...)` can fall back to the live own-selector
  surface for exact local-child extend, but only under a single-parent-selector
  parent and only when the active parent selector does not already contain the
  extender.

- `packages/jess/test/less/all-less.test.ts`
  Current red set after the latest rebuild is down to five fixture-parity
  candidates:
  - `tests-unit/css-3/css-3.less`
  - `tests-unit/css-grid/css-grid.less`
  - `tests-unit/extend-nest/extend-nest.less`
  - `tests-unit/rulesets/rulesets.less`
  - `tests-unit/whitespace/whitespace.less`
  Current narrowing:
  a parser-accurate core repro now exists in
  `packages/core/src/tree/__tests__/mixin.test.ts` for the final
  `.Person(person, "Male"); .person.sayGender();` case.
  The repro fails with the same real runtime error:
  `ReferenceError: 'gender_' is not defined`.
  Important findings from this pass:
  - the Less parser shape matters here:
    - `.@{name}` parses as `InterpolatedSelector(Interpolated source: '.%%')`
    - `.person.sayGender()` parses as a single compound `mixin-ruleset`
      reference path, not as nested target/key references
  - selector/mixin registry reads now use context-aware selector access in
    `registry-utils.ts`; that did not fix the closure failure by itself
  - caller-scope lookup in `reference.ts` now treats a `CALLER` edge that
    already points at `Rules` as the rules scope directly; that also was not
    sufficient by itself
  - keep the lookup model disciplined while debugging this:
    - `.parent` is the current primary lookup path
    - `sourceParent` is stable definition provenance only
    - caller fallback is additive on `parentEdges.get(CALLER)`
    - canonical reads should use direct fields, while placement-sensitive reads
      must stay on edge-aware accessors
  The live seam is narrower now:
  invocation-time scope/parent propagation inside
  `util/mixin-instance-primitives.ts` is still letting the emitted nested
  `.person` subtree lose access to the outer mixin param scope while the outer
  mixin body is being evaluated.

- `tests-unit/mixins-guards/mixins-guards.less`
  Current narrowing:
  the old lock-closure and recursive-mixin failures are fixed in reduced repros
  and in the nearby Less fixtures (`mixins-closure.less`,
  `mixins-advanced.less`). The earlier
  `ReferenceError: 'space-list' is not defined` is now removed.
  Reduced repro:
  shared `.generic(...)` guarded overloads plus
  `.variouse-types-comparison { ... }` followed by
  `.list-comparison { ... }`.
  The same `.list-comparison` block passes in isolation and only fails after the
  earlier guarded calls run, which still points at render-key / pre-eval state
  reuse leakage across repeated guarded mixin evaluation rather than parser
  output shape or serializer behavior.
  The live remainder is now output-shaped:
  repeated guarded calls produce missing spaces in emitted `content:` values and
  drop the later `.call-lock-mixin .call-inner-lock-mixin` block inside the full
  fixture, even though `mixins-closure.less` still passes in isolation.
  Current narrower repro finding:
  the emitted nested `.inner-locked-mixin(@x: @a)` definition survives, but its
  sibling call still reevaluates to `Nil`. The eval mixin wrapper already carries
  the outer param scope on its current placement, but some downstream reads still
  bypass that placement state and observe canonical child fields instead.
  Next step:
  remove direct child-field reads in the guarded mixin path before adding more
  source-parent repair logic.

## Clone / Materialize Debt

These seams are not acceptable end-state architecture. Each item should be
deleted, not normalized.

### Active Deep-Clone Seams


| Seam                                                                                                             | Why It Exists Today                                                                                              | Blocker To Delete                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/tree/util/mixin-instance-primitives.ts` `freezeChildren` / `copy(true, freezeChildren)` paths | Param binding and rest/arguments normalization still assume detached copied values in some mixin argument flows. | Finish converting arg binding/rest aggregation to wrapper + edge ownership and remove frozen-copy fallback.                                                         |
| `packages/core/src/tree/interpolated.ts` deep clone of replacements                                              | Deep clone support still exists in generic clone implementation for interpolated replacement trees.              | Once runtime callsites stop depending on deep clone semantics, collapse `Interpolated.clone(deep)` to shallow/container-only behavior or delete deep mode entirely. |


### Suspicious Shallow-Clone / Materialize Seams

These are smaller than deep clones, but still need explicit justification and
should be deleted when their blockers clear.


| Seam                                                                                        | Why It Exists Today                                                                                                                                                         | Blocker To Delete                                                                                                                                      |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/tree/rules.ts` `createShallowBodyWrapper()` / `createPlacementWrapper()` | Thin wrapper owners currently carry placement-local registries and child-edge ownership.                                                                                    | Replace remaining wrapper-only registry/state behavior with direct cursor/edge traversal where container identity does not actually diverge.           |
| `packages/core/src/tree/import-style.ts` postlude wrapper path                              | Import postlude wrapping still detaches prelude/container nodes instead of reading the authored postlude shape directly through placement state.                            | Inline postlude shape decoding into the wrapper loop and attach only the new owning `AtRule` containers.                                               |
| `packages/core/src/tree/util/scoped-body-eval.ts` scoped body wrapper creation              | `$for`/scoped eval still allocates a wrapper owner for each placement. Deep clone is gone from this hot seam, but wrapper ownership is still broader than the target model. | Finish control conversion so loop bindings/placement can attach directly to canonical body structure without a scoped-body helper.                     |
| `packages/core/src/tree/ruleset.ts` / selector utilities `clone(false)` snapshots           | Selector recomposition still uses detached selector shells in a few ownership-sensitive paths.                                                                              | Convert selector composition to parent-edge/cursor-owned container replacement so selector snapshots are not needed as a safety rail.                  |
| `packages/core/src/tree/import-style.ts` top-level placement wrappers                       | Import evaluation still needs thin top-level wrappers to give each import site its own render-owned registry and parent edges before eval.                                  | Finish direct parent-edge/cursor traversal for import-owned registries so imported top-level children do not need a dedicated placement wrapper owner. |


### Tracking Rule

When a clone/materialize seam is removed:

1. delete it from this section
2. note the focused proof file that now protects the replacement model
3. do not replace it with a differently named clone/materialize helper

Recent removal:

- `packages/core/src/tree/call.ts` fallback-call arg deep clone was deleted.
  Proof: `packages/core/src/tree/__tests__/call.test.ts`
- `packages/core/src/tree/call.ts` JS-function arg deep clone was deleted.
  Proof: `packages/core/src/tree/__tests__/call.test.ts`
- `packages/core/src/tree/function.ts` no longer routes stylesheet-defined
  functions through temporary mixins or `freezeChildren()`.
  Proof: `packages/core/src/tree/__tests__/func.test.ts`

### End-State

The desired destination is to remove generic `.clone()` / `.copy()` from
`packages/core/src/tree/node-base.ts` as normal runtime escape hatches.

That should happen in this order:

1. delete production deep-clone callsites
2. delete production shallow-clone/materialize callsites that only exist for
   eval isolation
3. replace any remaining legitimate uses with explicit derived-node/container
   constructors
4. only then remove generic clone/copy from `node-base`

No longer active baggage in core test files:

- direct `activeState` / `EvalState` test setup
- direct `setField` / `getField` test mutation APIs
