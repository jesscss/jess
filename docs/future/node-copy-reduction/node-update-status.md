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
| `Ruleset` | `in_progress` | Direct field getters are field-aligned (`getSelector(renderKey?)`, `getRules(renderKey?)`, `getGuard(renderKey?)`, etc.), and `.maybeClone(...)` is gone in favor of explicit `.clone()`. Remaining blocker is not the field API itself; it is hoist/scope ownership that still feeds `Reference` through side channels. |
| `AtRule` | `in_progress` | Major helper cleanup landed: no `AtRule` `activeState` writes, no generic `get('name', context)` / `get('selector', context)` hot-path reads, and hoisted wrapper selector composition now uses explicit cloned child `Ruleset`s. Current blocker is nested prelude/body scope ownership, not `AtRule` field access. |
| `Reference` | `in_progress` | Current lookup-parent walk still depends on `context.rulesContext` and `Rules.renderParent` as side channels. This now directly blocks nested `@media` param lookup and caller-context mixin selector composition. |
| `Call` | `not_converted` | Test-side field-patch cases were removed. Remaining production seam is returned-result shaping plus `setData`-style mutation inside call-time result processing instead of direct edge/cursor ownership. |
| `Mixin` | `not_converted` | Test-side overlay proofs were removed. Invocation/output scope still depends on thin `Rules` wrappers plus `renderParent`; not yet expressed as a pure edge/cursor-owned placement model. |
| `Control` | `not_converted` | Runtime-generated numeric render keys landed for loop placements, and narrow loop proofs now exist. The remaining work is still production conversion of loop/output ownership, not more test-side patching. |

Only the `converted` rows are valid hard-gate targets for focused edge/cursor tests.

## Immediate Next Work

1. Stay on narrow production surfaces only: pick one component, convert one owner/path seam, and verify it with a focused proof test.
2. Replace `Rules.renderParent` lookup semantics with a real parent-edge / cursor-owned scope path.
3. Convert `Reference` parent/scope resolution to follow that path directly instead of consulting `context.rulesContext` as a side channel.
4. Revisit nested `AtRule` prelude evaluation and other dependent component paths only after the lookup owner is explicit.

## Transitional Baggage To Remove

Only listed here when it directly blocks edge/cursor work:

- generic child-edge scaffolding
- hidden no-context fallbacks that still depend on old state overlay
- clone/materialize behavior used in place of edge/cursor ownership
- `packages/core/src/tree/util/field-helpers.ts` as the activeState compatibility sewer
- `packages/core/src/tree/util/legacy-node-ops.ts` as quarantined returned-result shaping
- `Rules.renderParent` as an undocumented scope-parent side channel

No longer active baggage in core test files:

- direct `activeState` / `EvalState` test setup
- direct `setField` / `getField` test mutation APIs
