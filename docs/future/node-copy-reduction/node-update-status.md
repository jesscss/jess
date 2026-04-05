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

Do not add old-model compatibility logic here just to satisfy tests on nodes
that are not yet converted.

For performance or migration work, “green” is not enough by itself.

Every gate also requires architectural compliance:

- prefer direct canonical fields on already-resolved canonical paths
- prefer sparse state or a thin derived node at true divergence points
- keep edge wiring only where it solves a concrete placement problem
- treat generic `.get(...)`, `clone(...)`, `copy(...)`, `inherit(...)`, and
  `adopt(...)` on hot paths as suspect legacy machinery
- if a change passes tests but preserves the wrong runtime shape, it has not
  passed the gate

## Edge / Cursor Surfaces

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
  rendered-text inspection
- checks based on string prefixes, start characters, or already-serialized
  selector text should be treated as temporary migration debt
- the target cleanup is node-shape-driven serialization scheduling, not more
  text comparisons in `serialize-helper.ts`

## Node Conversion Status

This section tracks only edge/cursor conversion status.

| Node                   | Status        | Notes |
| ---------------------- | ------------- | ----- |
| `Expression`           | `converted`   | Direct canonical field kept; render-key child selection characterized. |
| `Block`                | `converted`   | Simple child surface converted to direct field + render-key read path. |
| `Negative`             | `converted`   | Simple child surface converted to direct field + render-key read path. |
| `Paren`                | `converted`   | Simple child surface converted to direct field + render-key read path. |
| `Quoted`               | `converted`   | Simple child surface converted to direct field + render-key read path. |
| `SelectorCapture`      | `converted`   | Simple child surface converted to direct field + render-key read path. |
| `SelectorInterpolated` | `converted`   | Simple child surface converted to direct field + render-key read path. |
| `Url`                  | `converted`   | Simple child surface converted to direct field + render-key read path. |
| `List`                 | `converted`   | Canonical container stays in place for same-length render-path child replacement; `valueEdges` now carry indexed alternates and local shape changes return a different node. |
| `Rest`                 | `converted`   | Simple child surface converted to direct field + render-key read path. |
| `Sequence`             | `converted`   | Canonical container stays in place for same-length render-path child replacement; `valueEdges` carry indexed alternates and only shape changes return a different node. |
| `Rules`                | `in_progress` | Major render-key entry/exit owner. Wrapper registry seeding indexes direct render-visible children, render-visible reads no longer clone container nodes on read, and render-key child mutation updates/removes `parentEdges` directly on wrapper-owned paths. Main blocker is still scope ownership leaking through `renderParent` instead of a pure parent-edge / cursor model. |
| `Ruleset`              | `in_progress` | Direct field getters are field-aligned (`getSelector(renderKey?)`, `getRules(renderKey?)`, `getGuard(renderKey?)`, etc.), and `.maybeClone(...)` is gone in favor of explicit `.clone()`. Import-style is green again after placement-owned top-level import wrappers and render-key-aware `enterRules()` body ownership fixes, and `Reference` no longer re-identifies resolved definition-like nodes through generic eval inheritance. Remaining blockers are mostly selector/output-shape parity seams. |
| `AtRule`               | `in_progress` | Major helper cleanup landed: no `AtRule` `activeState` writes, no generic `get('name', context)` / `get('selector', context)` hot-path reads, and hoisted wrapper selector composition now uses explicit cloned child `Ruleset`s. Remaining live issue is the parser-generated reference-import activation / ancestry path in real Less integration. |
| `Reference`            | `in_progress` | Lookup-parent walk still depends on `context.rulesContext` and `Rules.renderParent` as side channels, but `Reference` no longer re-identifies resolved definition-like nodes through generic eval inheritance. Remaining work is to make reference-import activation and ruleset-as-mixin ancestry use the render-owned path directly instead of the side channels. |
| `Call`                 | `in_progress` | Direct dispatch and render-key-owned result shaping are in place. Remaining seam is narrower: function/mixin call-time result processing still has a few ownership-sensitive branches, but the old “not converted” wrapper model is gone. |
| `Mixin`                | `in_progress` | Direct mixin invocation primitives and render-key scopes are in place. `Mixin.preEval()` now reattaches `rules` / `params` / `guard` children on the active render-key path, and guarded dispatch now reads the current guard surface instead of a canonical `candidate.get('guard')` read. Remaining mixin-related reds are selector-shape or formatting parity, not output assembly/runtime lookup failures. |
| `Control`              | `in_progress` | Runtime-generated numeric render keys landed for loop placements, and narrow loop proofs now exist. Remaining work is final production conversion of loop/output ownership, not more test-side patching. |

Only the `converted` rows are valid hard-gate targets for focused edge/cursor
tests.

## Immediate Next Work

1. Stay on narrow production surfaces only: pick one component, convert one owner/path seam, and verify it with a focused proof test.
2. For runtime-performance work, follow the benchmark / focused-vitest / keep-or-revert protocol in [HANDOFF.md](./HANDOFF.md#performance-execution-protocol). Do not restate or improvise that plan in chat.
3. Keep the remaining frontier grounded in the actual failing fixture output.
4. Continue deleting remaining clone/materialize seams only where they directly block edge/cursor conversion.
5. When a live bug turns out to be “wrong field was read directly,” fix the read surface first before adding more wrapper/source-parent repair logic.

## Performance Tracking

`node-update-status.md` is the live edge/cursor conversion status doc.

For the current extend / selector performance snapshot, use:

- [extend-selector-performance-status.md](./extend-selector-performance-status.md)

For the chronological experiment log, use:

- [HANDOFF.md](./HANDOFF.md)

For the enforceable extend / selector work contract and gates, use:

- [extends-performance-contract.md](./extends-performance-contract.md)
