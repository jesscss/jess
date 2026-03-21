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

- `Ruleset`
  - goal: continue reducing its remaining composition-path writes now that `hoistToRoot` and active visibility writes are session-backed
  - primary proof:
    - node/public-path behavior in the node's own test file
    - overlay/immutability proof in [eval-session.test.ts](../../packages/core/src/__tests__/eval-session.test.ts)
  - note:
    - the prior immediate slice landed: `Ruleset` now reads `hoistToRoot` through the session-aware view on active render/eval paths, routes active `hoistToRoot` writes and `F_VISIBLE` removal through the session layer, `ruleset.test.ts` covers collapse-nesting behavior parity, and `eval-session.test.ts` proves canonical `hoistToRoot` stays unchanged under an active session

### Current Batch A: Simple Pending Wrappers

- Batch A complete.

### Current Batch B: Simple Selector Wrappers

- Batch B complete.

Rule for this batch:

- prove them in their own selector test files first
- do not use extend/import integration as the primary proof surface

### Current Batch C: Medium Nodes With Remaining Direct Writes

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
- The internal mixin adapter path (`Reference -> getFunctionFromMixins() -> Call -> callWithContext()`) is tracked as its own planned stage. Do not fold that higher-order refactor into a lower-order wrapper-node slice.
- `Mixin` still has one unresolved node-local write that is not a plain field patch: `rules.options.rulesVisibility`. Treat that as an options/policy-layer follow-up, not as a reason to keep the plain-field queue from moving to `Call`.
- If a node in Batch A or B cannot be completed without touching a higher-order node, record the exact dependency here before changing the queue.


## Core Containers And Eval Nodes


| Node                         | Status      | Notes                                                                                                                                                                                  |
| ---------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Declaration`                | `partial`   | Active eval/serialization reads and field writes for `name` / `value` / `important` now use session helpers. Broader caller-side mutation paths still need completion. |
| `VarDeclaration`             | `inherited` | Inherits `Declaration` field behavior. Remaining mixin-param binding work is in callers, not in the node class itself.                                                                 |
| `CustomDeclaration`          | `inherited` | Inherits `Declaration`; custom eval wrapper only toggles `context.inCustom`.                                                                                                           |
| `Ruleset`                    | `partial`   | `selector` / `rules` / `guard` / extend-managed selector fields are session-aware on active eval/render paths. `hoistToRoot` reads plus active `hoistToRoot` / `F_VISIBLE` writes are now session-backed. Broader composition paths still need pressure reduction.                |
| `Rules`                      | `partial`   | Non-reset sessions now have child-array overlays and session-backed reads/writes through major preEval/eval/coalescing loops. Reset-session path still relies on cloned working trees. |
| `RawRules`                   | `complete`  | Its serializer override now reads the `Rules` session child overlay instead of canonical `this.value`, and it has both a dedicated public behavior test and an eval-session immutability proof. |
| `AtRule`                     | `complete`  | Render and eval now read `name` / `prelude` / `rules` through the session-aware view, active field updates are session-backed, `at-rule.test.ts` covers behavior parity, and `eval-session.test.ts` proves the canonical field references stay unchanged under an active session. |
| `Mixin`                      | `partial`   | Render reads for `name` / `params` / `guard` / `rules` are session-aware, and interpolated-name preEval now writes through the session field layer. Remaining work is the `rules.options.rulesVisibility` policy mutation plus caller-side binding/eval paths. |
| `Call`                       | `partial`   | Render reads for `name` / `args` / `contentNode` are session-aware, and the non-function eval materialization path now writes `name` / `args` through the session field layer. Remaining work is the fallback-call branch and the larger direct-mixin-invocation cleanup tracked separately. |
| `Func`                       | `partial`   | Render reads for `name` / `params` / `body` are session-aware, and `evalCall()` now reads `params`, `body`, and parent context through the session-aware view. Remaining work is the higher-order temporary mixin-wrapper path itself, which is part of the broader direct-mixin-invocation cleanup. |
| `Expression`                 | `partial`   | Render/read path for `value` is session-aware.                                                                                                                                         |
| `Operation`                  | `complete`  | Render and eval now read `left` / `right` through the session-aware view, preserved-expression and calc-preserve field updates are session-backed, `operation.test.ts` covers behavior parity, and `eval-session.test.ts` proves canonical `left` / `right` stay unchanged under an active session. |
| `Condition`                  | `partial`   | Render/read path for `left` / `operator` / `right` is session-aware.                                                                                                                   |
| `Sequence`                   | `partial`   | Render/read path for `value[]` is session-aware.                                                                                                                                       |
| `QueryCondition`             | `inherited` | Inherits `Sequence` session-aware value reads via `_getValue(context)`.                                                                                                                |
| `List`                       | `partial`   | Render/read path for `value[]` is session-aware.                                                                                                                                       |
| `Range`                      | `partial`   | Render/read path for `start` / `end` / `step` is session-aware.                                                                                                                        |
| `Reference`                  | `partial`   | Render/read path for `target` / `key` is session-aware; dependency tracking is also session-backed.                                                                                    |
| `Interpolated`               | `complete`  | Render and eval now read `source` / `replacements` through the session-aware view, eval-time replacement updates and evaluated-state marking are session-backed, `interpolated.test.ts` covers behavior parity, and `eval-session.test.ts` proves canonical replacements stay unchanged under an active session. |
| `ImportJs`                   | `partial`   | Render/read path for `path` / `imports` is session-aware.                                                                                                                              |
| `ImportStyle`                | `pending`   | Still one of the main clone/materialization pressure sites. Import finalization and returned-tree behavior are only partially reduced.                                                 |
| `If` / `For` / control nodes | `pending`   | Control-flow bodies and binding/eval paths still use direct structural access in important paths.                                                                                      |
| `Block`                      | `complete`  | Render and eval now read `value` through the session-aware view, eval writes patch the active session instead of overwriting the canonical child, and both node-local behavior plus eval-session immutability proofs are in place. |
| `Negative`                   | `complete`  | Render and eval now read `value` through the session-aware view, unary serialization has dedicated node-local coverage, and `eval-session.test.ts` proves session overlay reads without mutating the canonical child. |
| `Rest`                       | `complete`  | Serialization now reads `value` through the session-aware view, `rest.test.ts` covers both string-backed and node-backed forms, and `eval-session.test.ts` proves session overlay reads without mutating the canonical value. |
| `Extend`                     | `pending`   | Extend pipeline is still a major remaining clone/copy cluster.                                                                                                                         |
| `ExtendList`                 | `pending`   | Extend helper container not yet migrated to the session model.                                                                                                                         |


## Selector Nodes


| Node                   | Status    | Notes                                                                |
| ---------------------- | --------- | -------------------------------------------------------------------- |
| `BasicSelector`        | `leaf`    | Scalar selector token.                                               |
| `AttributeSelector`    | `complete` | Render and eval now read `name` / `value` through the session-aware view, eval-time field updates are session-backed, `selector-attr.test.ts` covers behavior parity, and `eval-session.test.ts` proves overlay reads without canonical mutation. |
| `InterpolatedSelector` | `complete` | Render and eval now read the wrapped interpolated value through the session-aware view, `selector-interpolated.test.ts` covers behavior parity, and `eval-session.test.ts` proves overlay reads without canonical mutation. |
| `Ampersand`            | `pending` | Still called out as a remaining high-signal clone/copy site.         |
| `PseudoSelector`       | `complete` | Render and eval now read `name` / `arg` through the session-aware view, eval-time `arg` updates are session-backed, `selector-pseudo.test.ts` covers behavior parity, and `eval-session.test.ts` proves canonical `arg` stays unchanged under an active session. |
| `CompoundSelector`     | `complete` | Render and eval now read `value[]` through the session-aware view, eval-time component-array updates are session-backed, compound serialization no longer mutates child spacing state, `selector-compound.test.ts` covers behavior parity, and `eval-session.test.ts` proves canonical components stay unchanged under an active session. |
| `ComplexSelector`      | `partial` | Render and eval now read `value[]` through the session-aware view, and eval-time component-array updates are session-backed with node-local behavior proof plus eval-session immutability coverage. Single-item hoist propagation is still not promoted as complete behavior for this node. |
| `SelectorList`         | `complete` | Render and eval now read `value[]` through the session-aware view, eval-time selector-array updates and top-level `:is()` flattening are session-backed, `selector-list.test.ts` covers behavior parity, and `eval-session.test.ts` proves canonical items stay unchanged under an active session. |
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
