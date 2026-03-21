# Node Session Status

This is the concrete inventory for the pre-Stage-21 fundamentals gate.

Purpose:

- track every concrete tree node against the intended "session node object" contract
- keep the work bottom-up and atomic
- avoid claiming architectural completion from a few green slices

This status is about the immutability/session model only, not general feature completeness.

## Document Role

This file is the source of truth for:

- per-node status (`pending` / `partial` / `complete`)
- the immediate execution queue and current batches
- per-node completion criteria and proof requirements

Do not duplicate the full node matrix in `PROGRESS.md` or `HANDOFF.md`.
Those docs should summarize and link back here.

## Migration Strategy

Use this inventory as an execution order, not just a report.

Rules:

1. Migrate the simplest node that still has active canonical reads/writes.
2. Prove that node in isolation first.
3. Only move upward into a more compositional node after the lower-order dependency is stable and committed.
4. Do not “validate” a low-order migration only through `Rules`, imports, or extend when a narrow node-level proof is possible.
5. Treat `Rules` as the highest-complexity structural node in this fundamentals pass, not as the default place to discover lower-order gaps.

## Per-Node Done Condition

A node is not "done" for this pass until all of these are true for the active in-scope behavior:

1. Canonical fields/children used by the node are no longer directly mutated on the migrated path.
2. Session-backed reads can observe a mixed view of canonical fallback plus session patches/replacements.
3. A focused test proves behavioral parity on the public path.
4. A focused test proves immutability:
   - canonical field/child stays unchanged
   - session-scoped read sees the patched/replaced value
   - non-session read still sees canonical value
5. The slice is committed before moving to a more complex dependent node.

## Test Contract

Every migrated node should have explicit proof in vitest, using these file locations:

- Public behavior parity:
  - put the test in the node's own file under `packages/core/src/tree/__tests__/`
  - examples: `declaration.test.ts`, `ruleset.test.ts`, `call.test.ts`, `mixin.test.ts`
- Session overlay / immutability:
  - put the test in `packages/core/src/__tests__/eval-session.test.ts`
- Eval-time write proof:
  - prefer the node's own test file
  - use `eval-session.test.ts` only when proving the generic helper semantics themselves

Required proof shapes:

1. Field-backed node
   - patch a field in-session
   - assert session-scoped render/eval sees the patched value
   - assert no-context render/eval still sees canonical value
   - assert the canonical field still points at the original value/object

2. Structural node
   - replace, append, prepend, or remove a child in-session
   - assert session-scoped render/eval sees the changed child sequence
   - assert canonical `value[]` is unchanged
   - assert canonical parent/child identity is unchanged

3. Eval-time mutation node
   - exercise the smallest real public path that triggers the write
   - assert output/behavior matches pre-migration behavior
   - assert the canonical field/child was not overwritten

What does not count:

- only proving the node through `rules.test.ts`
- only proving the node through `import-style.test.ts`
- only proving the node through extend integration tests

Those broader tests are secondary confirmation only. They are not the primary proof surface for lower-order nodes.

## Status Legend


| Status      | Meaning                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `complete`  | The node's in-scope immutable/session contract is done for this fundamentals pass and has the required proof.        |
| `leaf`      | Canonical node is effectively a scalar/opaque value node today. No active session overlay work is currently required. |
| `inherited` | Node inherits the relevant session behavior from a parent node class and does not override the affected path.         |
| `partial`   | Some active reads/writes are session-aware, but the full immutable/session contract is not complete for this node.    |
| `pending`   | Active paths still read/write canonical fields directly, or the node has not been fully audited yet.                  |

## Promotion Gate To `complete`

A node moves from `pending` or `partial` to `complete` only when all of these are true:

1. All active in-scope reads for that node use the session-aware view when `Context.session` is present.
2. All active in-scope eval-time writes or structural replacements for that node go through the session layer instead of mutating canonical node state.
3. No remaining clone/copy behavior is still required for that node's targeted responsibility in this fundamentals pass.
4. The node has explicit public behavior parity coverage in its own test file under `packages/core/src/tree/__tests__/`.
5. The node has explicit session-overlay / immutability coverage in `packages/core/src/__tests__/eval-session.test.ts`.
6. Any broader dependent integration tests needed to confirm the migrated path remain green.
7. The slice has been committed and pushed as a stable boundary.

If any of those are missing, the node stays `partial`.

Special cases:

- `leaf` nodes do not need session-overlay machinery unless they gain a real in-scope eval-time write surface.
- `inherited` nodes can only be treated as effectively complete when the parent behavior they rely on is complete and the subclass does not bypass it.
- `complete` means complete for this fundamentals gate, not "guaranteed never to need changes again."

## Priority Queue

This section is the operational queue for the fundamentals pass. Update it whenever
the next atomic slice changes.

### Immediate Next Slice

- `Declaration` caller-side param/default binding writes in [rules.ts](../../packages/core/src/tree/rules.ts)
  - goal: finish moving mixin param/default binding off canonical field mutation
  - primary proof:
    - node/public-path behavior in [mixin.test.ts](../../packages/core/src/tree/__tests__/mixin.test.ts)
    - overlay/immutability proof in [eval-session.test.ts](../../packages/core/src/__tests__/eval-session.test.ts)
  - promotion target:
    - `Declaration` may move to `complete`
    - `VarDeclaration` may move from `inherited` to effectively complete if no subclass bypass remains

### Current Batch A: Simple Pending Wrappers

- `RawRules`
- `Block`
- `Negative`
- `Rest`

Rule for this batch:

- do not touch `Rules` internals unless one of these wrappers genuinely requires it
- each node should be migrated and committed independently if the slice stays small

### Current Batch B: Simple Selector Wrappers

- `AttributeSelector`
- `InterpolatedSelector`

Rule for this batch:

- prove them in their own selector test files first
- do not use extend/import integration as the primary proof surface

### Current Batch C: Medium Nodes With Remaining Direct Writes

- `AtRule`
- `Mixin`
- `Call`
- `Func`
- `Operation`
- `Ruleset`

Rule for this batch:

- these can only move after the simpler wrapper/selector nodes they depend on are stable
- each slice must name the exact eval-time write being migrated

### Deferred High-Complexity Batch

- `Rules`
- `ImportStyle`
- `Extend`
- `ExtendList`
- `Ampersand`
- control-flow nodes (`If` / `For`)

These are intentionally deferred until the lower-order nodes above them are either `complete`
or explicitly blocked with a written reason.

## Blockers / Unblockers

Use this to record why a node is not next, even if it looks urgent.

- `Rules` is not the current target unless a lower-order migration proves it is the smallest remaining place where a write must be redirected.
- `ImportStyle` and extend-path work remain high-value but are not allowed to pull the order upward ahead of lower-order node completion.
- If a node in Batch A or B cannot be completed without touching a higher-order node, record the exact dependency here before changing the queue.


## Core Containers And Eval Nodes


| Node                         | Status      | Notes                                                                                                                                                                                  |
| ---------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Declaration`                | `partial`   | Active eval/serialization reads and field writes for `name` / `value` / `important` now use session helpers. Caller-side mutation paths still need to be finished.                     |
| `VarDeclaration`             | `inherited` | Inherits `Declaration` field behavior. Remaining mixin-param binding work is in callers, not in the node class itself.                                                                 |
| `CustomDeclaration`          | `inherited` | Inherits `Declaration`; custom eval wrapper only toggles `context.inCustom`.                                                                                                           |
| `Ruleset`                    | `partial`   | `selector` / `rules` / `guard` / extend-managed selector fields are session-aware on active eval/render paths. Broader composition paths still need pressure reduction.                |
| `Rules`                      | `partial`   | Non-reset sessions now have child-array overlays and session-backed reads/writes through major preEval/eval/coalescing loops. Reset-session path still relies on cloned working trees. |
| `RawRules`                   | `pending`   | Extends `Rules` but overrides serialization by iterating canonical `this.value`, so it currently bypasses the child overlay.                                                           |
| `AtRule`                     | `partial`   | Render reads for `name` / `prelude` / `rules` are session-aware. Eval-time writes are not fully sessionized yet.                                                                       |
| `Mixin`                      | `partial`   | Render reads for `name` / `params` / `guard` / `rules` are session-aware. Binding/eval write paths are still being migrated.                                                           |
| `Call`                       | `partial`   | Render reads for `name` / `args` / `contentNode` are session-aware. Full eval/write coverage is not complete.                                                                          |
| `Func`                       | `partial`   | Render reads for `name` / `params` / `body` are session-aware. Broader eval/write behavior still needs completion.                                                                     |
| `Expression`                 | `partial`   | Render/read path for `value` is session-aware.                                                                                                                                         |
| `Operation`                  | `partial`   | Dependency/eval-state helpers are wired in, but some structural writes still hit the node directly (`left` / `right`).                                                                 |
| `Condition`                  | `partial`   | Render/read path for `left` / `operator` / `right` is session-aware.                                                                                                                   |
| `Sequence`                   | `partial`   | Render/read path for `value[]` is session-aware.                                                                                                                                       |
| `QueryCondition`             | `inherited` | Inherits `Sequence` session-aware value reads via `_getValue(context)`.                                                                                                                |
| `List`                       | `partial`   | Render/read path for `value[]` is session-aware.                                                                                                                                       |
| `Range`                      | `partial`   | Render/read path for `start` / `end` / `step` is session-aware.                                                                                                                        |
| `Reference`                  | `partial`   | Render/read path for `target` / `key` is session-aware; dependency tracking is also session-backed.                                                                                    |
| `Interpolated`               | `partial`   | Render/read path for `source` / `replacements` is session-aware.                                                                                                                       |
| `ImportJs`                   | `partial`   | Render/read path for `path` / `imports` is session-aware.                                                                                                                              |
| `ImportStyle`                | `pending`   | Still one of the main clone/materialization pressure sites. Import finalization and returned-tree behavior are only partially reduced.                                                 |
| `If` / `For` / control nodes | `pending`   | Control-flow bodies and binding/eval paths still use direct structural access in important paths.                                                                                      |
| `Block`                      | `pending`   | Wrapper node still reads canonical `value` directly.                                                                                                                                   |
| `Negative`                   | `pending`   | Unary wrapper still reads canonical `value` directly on eval paths.                                                                                                                    |
| `Rest`                       | `pending`   | Wrapper node still reads canonical `value` directly.                                                                                                                                   |
| `Extend`                     | `pending`   | Extend pipeline is still a major remaining clone/copy cluster.                                                                                                                         |
| `ExtendList`                 | `pending`   | Extend helper container not yet migrated to the session model.                                                                                                                         |


## Selector Nodes


| Node                   | Status    | Notes                                                                |
| ---------------------- | --------- | -------------------------------------------------------------------- |
| `BasicSelector`        | `leaf`    | Scalar selector token.                                               |
| `AttributeSelector`    | `pending` | Owns `name` / `value` child fields and still reads them canonically. |
| `InterpolatedSelector` | `pending` | Wrapper around `Interpolated` still reads/evals canonically.         |
| `Ampersand`            | `pending` | Still called out as a remaining high-signal clone/copy site.         |
| `PseudoSelector`       | `partial` | Render/read path for `name` / `arg` is session-aware.                |
| `CompoundSelector`     | `partial` | Render/read path for `value[]` is session-aware.                     |
| `ComplexSelector`      | `partial` | Render/read path for `value[]` is session-aware.                     |
| `SelectorList`         | `partial` | Render/read path for `value[]` is session-aware.                     |
| `SelectorCapture`      | `partial` | Render/read path for `value` is session-aware.                       |


## Leaf / Opaque Value Nodes


| Node           | Status    | Notes                                                                                                |
| -------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `Any`          | `leaf`    | Scalar token node.                                                                                   |
| `Bool`         | `leaf`    | Scalar token node.                                                                                   |
| `Color`        | `leaf`    | Scalar value node.                                                                                   |
| `Comment`      | `leaf`    | Opaque token/comment node.                                                                           |
| `Combinator`   | `leaf`    | Scalar selector token node.                                                                          |
| `DefaultGuard` | `leaf`    | Scalar control marker; no session-backed write surface.                                              |
| `Dimension`    | `leaf`    | Numeric value object; current session work targets containing nodes, not `Dimension` field patching. |
| `JsArray`      | `leaf`    | Opaque JS payload node.                                                                              |
| `JsObject`     | `leaf`    | Opaque JS payload node.                                                                              |
| `JsFunction`   | `leaf`    | Opaque JS function payload node.                                                                     |
| `JsExpression` | `leaf`    | Opaque string payload plus eval hook.                                                                |
| `Log`          | `leaf`    | Scalar/log token node.                                                                               |
| `Nil`          | `leaf`    | Sentinel value node.                                                                                 |
| `Num`          | `leaf`    | Numeric scalar node.                                                                                 |
| `Paren`        | `partial` | Wrapper render/read path for `value` is session-aware.                                               |
| `Quoted`       | `partial` | Render/read path for `value` is session-aware.                                                       |
| `Url`          | `partial` | Render/read path for `value` is session-aware.                                                       |


## Base / Infra Types

These are not counted as concrete AST node inventory items, but they still matter to the architecture:

- `Node` / `node-base.ts`
- `Collection`
- `Selector`
- `SimpleSelector`
- `tree.ts`

Those files carry the generic parent/adoption/clone/visitor rules that the concrete-node inventory depends on.

## Current Intent Rule

The target end state for every non-`leaf` node in scope is:

1. Canonical node fields are immutable after construction.
2. Eval-time field updates and structural replacement are written to the active session, not to the canonical node.
3. Reads with `Context.session` present resolve the effective node view as `session overlay + canonical fallback`.
4. Clone-based divergence is removed from the targeted paths once the session-backed equivalent is proven.
