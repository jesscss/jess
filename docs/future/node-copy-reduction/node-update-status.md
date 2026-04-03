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
| `Ruleset`              | `in_progress`   | Direct field getters are field-aligned (`getSelector(renderKey?)`, `getRules(renderKey?)`, `getGuard(renderKey?)`, etc.), and `.maybeClone(...)` is gone in favor of explicit `.clone()`. Import-style is green again after placement-owned top-level import wrappers and render-key-aware `enterRules()` body ownership fixes, and `Reference` no longer re-identifies resolved definition-like nodes through generic eval inheritance. Remaining blocker is the parser-generated `tests-unit/import/import-reference.less` activation / ancestry seam in real Less integration. |
| `AtRule`               | `in_progress`   | Major helper cleanup landed: no `AtRule` `activeState` writes, no generic `get('name', context)` / `get('selector', context)` hot-path reads, and hoisted wrapper selector composition now uses explicit cloned child `Ruleset`s. The remaining live issue is not raw `AtRule` field access; it is the parser-generated reference-import activation / ancestry path that still fails in real Less integration.                                                            |
| `Reference`            | `in_progress`   | Lookup-parent walk still depends on `context.rulesContext` and `Rules.renderParent` as side channels, but `Reference` no longer re-identifies resolved definition-like nodes through generic eval inheritance. That guard now protects mixin/ruleset/function lookups from being re-registered as bogus `EVAL` definitions. Remaining work is to make reference-import activation and ruleset-as-mixin ancestry use the render-owned path directly instead of the side channels.                                                                                                                                       |
| `Call`                 | `in_progress`   | Direct dispatch and render-key-owned result shaping are in place. The remaining production seam is narrower: function/mixin call-time result processing still has a few ownership-sensitive branches, but the old “not converted” wrapper model is gone.                                                                                                                                                                                                                                                                                                                                          |
| `Mixin`                | `in_progress`   | Direct mixin invocation primitives and render-key scopes are in place. Remaining work is the last wrapper/ownership seams around output placement, not the old temporary-mixin architecture.                                                                                                                                                                                                                                                                                                                                                         |
| `Control`              | `in_progress`   | Runtime-generated numeric render keys landed for loop placements, and narrow loop proofs now exist. The remaining work is final production conversion of loop/output ownership, not more test-side patching.                                                                                                                                                                                                                                                                                                                                      |


Only the `converted` rows are valid hard-gate targets for focused edge/cursor tests.

## Immediate Next Work

1. Stay on narrow production surfaces only: pick one component, convert one owner/path seam, and verify it with a focused proof test.
2. Fix the real live Less integration blocker in `tests-unit/import/import-reference.less`: reference-import activation and ruleset-as-mixin ancestry still need to render through the activated selector path instead of the reference-only source path.
3. Keep the extend/import frontier grounded in the actual failing fixture output, not the older exact-extend `&&` / nested `@media` storyline that is no longer the top-line blocker.
4. Continue deleting remaining clone/materialize seams only where they directly block edge/cursor conversion.

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
  Next step: inspect reuse/mutation of evaluated call arg `Sequence` values
  across repeated guarded candidates, especially when later candidate prep sees
  arg nodes already carrying non-canonical render keys/source ancestry.

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
