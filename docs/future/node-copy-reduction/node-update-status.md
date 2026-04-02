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

| Node | Status | Notes |
| --- | --- | --- |
| `Expression` | `converted` | Direct canonical field kept; render-key child selection characterized. |
| `Block` | `converted` | Simple child surface converted to direct field + render-key read path. |
| `Negative` | `converted` | Simple child surface converted to direct field + render-key read path. |
| `Paren` | `converted` | Simple child surface converted to direct field + render-key read path. |
| `Quoted` | `converted` | Simple child surface converted to direct field + render-key read path. |
| `SelectorCapture` | `converted` | Simple child surface converted to direct field + render-key read path. |
| `SelectorInterpolated` | `converted` | Simple child surface converted to direct field + render-key read path. |
| `Url` | `converted` | Simple child surface converted to direct field + render-key read path. |
| `List` | `converted` | Canonical container stays in place for same-length render-path child replacement; `valueEdges` now carry indexed alternates and local shape changes return a different node. |
| `Rest` | `converted` | Simple child surface converted to direct field + render-key read path. |
| `Sequence` | `converted` | Canonical container stays in place for same-length render-path child replacement; `valueEdges` carry indexed alternates and only shape changes return a different node. |
| `Rules` | `in_progress` | Major render-key entry/exit owner. Wrapper registry seeding indexes direct render-visible children, render-visible reads no longer clone container nodes on read, and render-key child mutation updates/removes `parentEdges` directly on wrapper-owned paths. Main blocker now is scope ownership still leaking through `renderParent` instead of a pure parent-edge / cursor model. |
| `Ruleset` | `in_progress` | Direct field getters are field-aligned (`getSelector(renderKey?)`, `getRules(renderKey?)`, `getGuard(renderKey?)`, etc.), and `.maybeClone(...)` is gone in favor of explicit `.clone()`. Recent progress: `extend-roots` is green again after moving active-selector proofs onto evaluated placements. Remaining blocker is reference/import activation and hoist/scope ownership, not the field API itself. |
| `AtRule` | `in_progress` | Major helper cleanup landed: no `AtRule` `activeState` writes, no generic `get('name', context)` / `get('selector', context)` hot-path reads, and hoisted wrapper selector composition now uses explicit cloned child `Ruleset`s. Recent progress: nested `@layer` root naming now follows the eval frame path and `extend-roots` is green again. Current blocker is explicit reference-import activation/render behavior, not raw `AtRule` field access. |
| `Reference` | `in_progress` | Current lookup-parent walk still depends on `context.rulesContext` and `Rules.renderParent` as side channels. This now directly blocks nested `@media` param lookup and caller-context mixin selector composition. |
| `Call` | `not_converted` | Test-side field-patch cases were removed. Remaining production seam is returned-result shaping plus `setData`-style mutation inside call-time result processing instead of direct edge/cursor ownership. |
| `Mixin` | `not_converted` | Test-side overlay proofs were removed. Invocation/output scope still depends on thin `Rules` wrappers plus `renderParent`; not yet expressed as a pure edge/cursor-owned placement model. |
| `Control` | `not_converted` | Runtime-generated numeric render keys landed for loop placements, and narrow loop proofs now exist. The remaining work is still production conversion of loop/output ownership, not more test-side patching. |

Only the `converted` rows are valid hard-gate targets for focused edge/cursor tests.

## Immediate Next Work

1. Stay on narrow production surfaces only: pick one component, convert one owner/path seam, and verify it with a focused proof test.
2. Finish the explicit `reference: true` import activation/render path so externally-extended imported rulesets become render-visible without leaking ordinary reference output.
3. Keep replacing render-time canonical flag/field reads with context-aware render-key reads where activation is supposed to stay placement-local.
4. Revisit remaining extend/import integration only after the explicit reference-import activation seam is resolved.

## Transitional Baggage To Remove

Only listed here when it directly blocks edge/cursor work:

- generic child-edge scaffolding
- hidden no-context fallbacks that still depend on old state overlay
- clone/materialize behavior used in place of edge/cursor ownership
- `packages/core/src/tree/util/field-helpers.ts` as the activeState compatibility sewer
- `packages/core/src/tree/util/legacy-node-ops.ts` as quarantined returned-result shaping
- `Rules.renderParent` as an undocumented scope-parent side channel

## Clone / Materialize Debt

These seams are not acceptable end-state architecture. Each item should be
deleted, not normalized.

### Active Deep-Clone Seams

| Seam | Why It Exists Today | Blocker To Delete |
| --- | --- | --- |
| `packages/core/src/tree/util/mixin-instance-primitives.ts` `freezeChildren` / `copy(true, freezeChildren)` paths | Param binding and rest/arguments normalization still assume detached copied values in some mixin argument flows. | Finish converting arg binding/rest aggregation to wrapper + edge ownership and remove frozen-copy fallback. |
| `packages/core/src/tree/interpolated.ts` deep clone of replacements | Deep clone support still exists in generic clone implementation for interpolated replacement trees. | Once runtime callsites stop depending on deep clone semantics, collapse `Interpolated.clone(deep)` to shallow/container-only behavior or delete deep mode entirely. |

### Suspicious Shallow-Clone / Materialize Seams

These are smaller than deep clones, but still need explicit justification and
should be deleted when their blockers clear.

| Seam | Why It Exists Today | Blocker To Delete |
| --- | --- | --- |
| `packages/core/src/tree/rules.ts` `createShallowBodyWrapper()` / `createPlacementWrapper()` | Thin wrapper owners currently carry placement-local registries and child-edge ownership. | Replace remaining wrapper-only registry/state behavior with direct cursor/edge traversal where container identity does not actually diverge. |
| `packages/core/src/tree/import-style.ts` postlude wrapper path | Import postlude wrapping still detaches prelude/container nodes instead of reading the authored postlude shape directly through placement state. | Inline postlude shape decoding into the wrapper loop and attach only the new owning `AtRule` containers. |
| `packages/core/src/tree/util/scoped-body-eval.ts` scoped body wrapper creation | `$for`/scoped eval still allocates a wrapper owner for each placement. Deep clone is gone from this hot seam, but wrapper ownership is still broader than the target model. | Finish control conversion so loop bindings/placement can attach directly to canonical body structure without a scoped-body helper. |
| `packages/core/src/tree/ruleset.ts` / selector utilities `clone(false)` snapshots | Selector recomposition still uses detached selector shells in a few ownership-sensitive paths. | Convert selector composition to parent-edge/cursor-owned container replacement so selector snapshots are not needed as a safety rail. |

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
