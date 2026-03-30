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
- alternate child links are field-aligned edges:
  - singular child: `fooEdge?: NodeEdge<T>`
  - list child: `fooEdges?: Array<NodeEdge<T> | undefined>`
- alternate parent links live in `parentEdges?: NodeEdge<Node>`
- path selection uses `RenderKey`
- traversal uses a cursor: `{ node, renderKey }`

This file does not track:

- registry redesign by itself
- mixin/control semantics by themselves
- broad Context cleanup by itself
- test triage on hybrid nodes

Those only matter here when they directly block edge/cursor conversion.

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
| `List` | `converted` | List child surface converted to direct field + render-key read path. |
| `Rest` | `converted` | Simple child surface converted to direct field + render-key read path. |
| `Sequence` | `converted` | List child surface converted to direct field + render-key read path. |
| `Rules` | `in_progress` | Major render-key entry/exit owner. Wrapper registry seeding now indexes direct render-visible children, render-visible reads no longer clone container nodes on read, and render-key child mutation now updates/removes `parentEdges` directly on wrapper-owned paths. Still hybrid because render walks and option/state surfaces still mix edge work with overlay-era behavior. |
| `Ruleset` | `in_progress` | Still hybrid. `rules` container entry is partly render-key aware, but selector/rules/option behavior still mixes edge work with clone/state-era behavior. |
| `AtRule` | `in_progress` | Current-view `prelude` / `rules` reads improved, but node is not edge/cursor-complete. |
| `Call` | `not_converted` | Still tied to hybrid mixin output and old eval-state replacement behavior. |
| `Mixin` | `not_converted` | Still routes body/current-view handling through hybrid clone/state-era behavior. |
| `Control` | `not_converted` | Still relies on hybrid loop/output plumbing rather than direct edge/cursor ownership. |

Only the `converted` rows are valid hard-gate targets for focused edge/cursor tests.

## Immediate Next Work

1. Keep removing `Context` from reads that only need `renderKey`.
2. Keep replacing generic traversal assumptions with cursor-based parent/child
   traversal.
3. Convert `Rules`, then `Ruleset`, then `AtRule` into real edge/cursor nodes
   before treating their broader tests as architectural gates.

## Transitional Baggage To Remove

Only listed here when it directly blocks edge/cursor work:

- generic child-edge scaffolding
- hidden no-context fallbacks that still depend on old state overlay
- clone/materialize behavior used in place of edge/cursor ownership
