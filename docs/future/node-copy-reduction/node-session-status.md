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

- shallow `Rules.clone(false, ..., context)` semantics in `rules.ts` / `node-base.ts`
  - goal: stop shallow `Rules` clones from canonically reparenting shared top-level children while preserving lookup-visible wrapper semantics
  - primary proof:
    - `rules.test.ts`: `characterizes session shallow Rules clones as still canonically reparenting shared top-level children while nested ruleset bodies stay shared`
    - `import-style.test.ts`: `returned-tree wrapper cleanup is blocked by shallow Rules.clone(false) reparenting shared top-level children immediately`
  - note:
    - guarded mixin invocation is green again
    - `evaluateCandidateOutput(...)` now shapes wrapper output through a cloned eval scope
    - `materializeEvaluatedCopy(context)` can now materialize the active session view
    - `ImportStyle` and `Extend` are no longer the active owners

### Current Batch A: Simple Pending Wrappers

- Batch A complete.

### Current Batch B: Simple Selector Wrappers

- Batch B complete.

Rule for this batch:

- prove them in their own selector test files first
- do not use extend/import integration as the primary proof surface

### Current Batch C: Medium Nodes With Remaining Direct Writes

- Batch C complete.

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
- `Rules` remains partial because reset-session structural work still relies on cloned working trees; that is broader than a node-local `Ruleset` or `Call` patch.
- `ImportStyle` is no longer the live failing blocker on the focused set; its remaining work is clone-pressure / returned-tree cleanup rather than the old parent-var / `with` / `set` visibility failures.
- `ImportStyle` now has both `Node.materializeEvaluatedCopy()` and `Node.cloneDetachedShallowWrapper(ctx?)`, its cached compose re-eval path now also uses `cloneLookupSafeShallowWrapper(context)` instead of raw `clone(false)`, and the `_dedupe` path now keeps cached evaluated top-level child slots and parent pointers stable. If more import work remains, it is no longer the old wrapper-finalization bug.
- `ImportStyle` now appears effectively complete for the fundamentals pass; the focused node-local import suite is green and the remaining blocker tests point below the node, not inside `import-style.ts`.
- `Extend` is now partially session-safe on local clone/registration paths, but its broader selector-rewrite pipeline is still a larger clone/copy cluster.
- Focused extend helper coverage is green across `extend-rules`, `extend-roots`, `extend-list`, and `extend-import-style`; Extend now looks effectively complete for the fundamentals pass, and the remaining red extend item is a snapshot/test-ownership issue in `extend-eval-integration.test.ts`, not a helper-local immutable/session bug.
- `selectorMatch()` now accepts an optional eval `Context`, uses session-aware key sets when one is passed, and safely fast-rejects selectors from different bitset libraries. The next matcher owner is caller-side operand preparation/adoption, not the matcher core itself.
- The live remaining owner is no longer guard lookup; the guarded mixin path is green again. The current remaining `Rules` work is the shallow `Rules.clone(false)` wrapper contract on top of the landed shallow-wrapper/materialization helpers.
- `ImportStyle` and `Ruleset` now adopt `materializeEvaluatedCopy(context)` on their active returned-tree materialization paths, and `$for` prior-scope reuse now feeds materialized copies back into the next iteration rather than wrapper views.
- Remaining control-family parent-integrity work is no longer the active blocker: `$for` prior-scope reuse now uses `cloneLookupSafeShallowWrapper(ctx)` and the focused control suite is green.
- The selector-pattern mixin-param blocker in `rules.ts` is now fixed; the next compare-adoption work is no longer in that branch.
- The next compare-context owner outside selectors now points lower to the generic compare API (`node-base.ts` / non-selector value nodes such as `color.ts`), not another caller.
- If a node in Batch A or B cannot be completed without touching a higher-order node, record the exact dependency here before changing the queue.


## Core Containers And Eval Nodes


| Node                         | Status      | Notes                                                                                                                                                                                  |
| ---------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Declaration`                | `complete`  | Active eval/serialization reads and field writes for `name` / `value` / `important` now use session helpers, node-local assignment-option normalization in `preEval()` is session-backed, serialization now has a context-aware semicolon decision via `requiresSemi(context?)`, serializer de-dupe/custom-property decisions now read `name` through session-aware helpers, and `Rules._coalesceMergedDeclarations()` now keys merged declarations off the session-aware property name. The legacy `requiredSemi` property remains intentionally canonical, with active callers moved to context-aware helpers where needed. |
| `VarDeclaration`             | `inherited` | Inherits `Declaration` field behavior. Remaining mixin-param binding work is in callers, not in the node class itself.                                                                 |
| `CustomDeclaration`          | `inherited` | Inherits `Declaration`; custom eval wrapper only toggles `context.inCustom`.                                                                                                           |
| `Ruleset`                    | `complete`  | `selector` / `rules` / `guard` / extend-managed selector fields are session-aware on active eval/render paths, `hoistToRoot` reads plus active `hoistToRoot` / `F_VISIBLE` writes are session-backed, `valueOf(context)` now reads the session-aware selector/effective-selector path without mutating the canonical cached value, `getHeaderString()` respects session-patched selector state in its hoist fallback branch, active `preEval()` / `evalNode()` selector `sourceNode` reads-writes now use session runtime, `evalNode()` now also checks `rules.visibleRules(context)` instead of the canonical no-context path when deciding whether the ruleset itself should remain visible, `copy()` now materializes from authored selector provenance through `materializeCopy()`, `preEval()` child `rules.options.rulesVisibility` updates now stay on the `Rules.options` session surface instead of mutating canonical child options, `_getRulesContainer(context)` now session-adopts a session-patched `Rules` child back to its owning `Ruleset` when raw session field patching bypassed parent adoption, reference-mode collapsed nested selector composition now filters parent selector items through one shared path so hidden reference branches no longer leak back into nested output, and shallow clones of derived rulesets now materialize their immediate `selector` and `rules` containers onto the clone under an active session so returned mixin-wrapper rulesets keep nested selector/body parentage on the returned node. |
| `Rules`                      | `partial`   | Non-reset sessions now have child-array overlays and session-backed reads/writes through major preEval/eval/coalescing loops, active declaration serialization in both `serialize-helper` and the root `Rules` render path now uses `Declaration.requiresSemi(context)` instead of canonical `requiredSemi` when context exists, public mutators `push()` / `splice()` / `unshift()` no longer bypass the session child overlay on the non-reset path, `Rules.options` now has a session surface used by `Ruleset.preEval()`, reset-session `preEval()` clones now keep their active parent link in the session layer instead of falling back to canonical `parent`, session-patched declaration/mixin/function lookup now climbs parent scopes through `sessionGetParent(...)` instead of canonical `rules.parent`, `getFunctionFromMixins()` now derives caller/source scope from the session parent/source-parent chain instead of canonical `caller?.rulesParent` / `caller?.sourceRulesParent`, guarded mixin invocation is green again without canonical wrapper-parent writes, `evaluateCandidateOutput(...)` now evaluates wrapper output through a cloned eval scope so the original parameter wrapper keeps its own session-local child parentage, mixin output `Rules` now keep both `parent` and `sourceParent` in the session layer rather than materializing those links canonically, the lower parameter-wrapper `outerRules` parent link is now session-only as well, parameter vars and `@arguments` now also populate that wrapper through `outerRules.push(thisContext, ...)` instead of a plain canonical `push(...)`, bound parameter values now also keep their `sourceParent` in the session layer instead of writing it canonically, multi-candidate mixin output child `Rules` now also keep their parent only in the session layer, selector-pattern params are now prepared from the original selector operand before `compare(argValue, thisContext)` runs, call-produced declaration-only `Rules` blocks now also reorder against nested rules using session `sourceParent` on the active path rather than canonical ancestry, the `@charset` replacement branch in `_multiPassPreEval()` now adopts its replacement child through the session layer instead of assigning a canonical parent during non-reset preEval, merged declaration coalescing now compares scope boundaries through session parents when a session is active, and `setDefined` parent-scope insertion now resolves both the lookup anchor and containing `Rules` through the session layer. The current remaining `Rules` work is the shallow `Rules.clone(false)` wrapper contract: shared top-level children are still canonically reparented too early even though `materializeEvaluatedCopy(context)` can now materialize the active session view. |
| `RawRules`                   | `complete`  | Its serializer override now reads the `Rules` session child overlay instead of canonical `this.value`, and it has both a dedicated public behavior test and an eval-session immutability proof. |
| `AtRule`                     | `complete`  | Render and eval now read `name` / `prelude` / `rules` through the session-aware view, active field updates are session-backed, `at-rule.test.ts` covers behavior parity, and `eval-session.test.ts` proves the canonical field references stay unchanged under an active session. |
| `Mixin`                      | `complete`  | Render reads for `name` / `params` / `guard` / `rules` are session-aware, interpolated-name `preEval()` writes through the session field layer, `rules.options.rulesVisibility` writes are isolated from the canonical child `Rules` container under an active session, and `clone(...)` now preserves session-patched local fields across the `preEval()` clone boundary without mutating canonical children. Remaining work is caller-side invocation/output shaping, not a node-local `Mixin` gap. |
| `Call`                       | `complete`  | Render reads for `name` / `args` / `contentNode` are session-aware, the non-function eval materialization path writes `name` / `args` through the session field layer, `clone(...)` is now session-aware for `name` / `args` / `contentNode`, fallback/plain non-function branches no longer mutate canonical `silentFail`, `contentNode`, or nested arg spacing, and downstream `Func`, nested-`Call`, and `Collection` results are all materialized before outer call provenance is applied. Remaining work is the separate direct-mixin-invocation cleanup, not a node-local `Call` gap. |
| `Func`                       | `complete`  | Render reads for `name` / `params` / `body` are session-aware, `evalCall()` reads `params`, `body`, and parent context through the session-aware view, the temporary mixin-wrapper setup detaches `params` / `body` inputs so canonical children are not re-parented just to build the wrapper, the wrapper now uses `sessionSetParent(...)` rather than a real canonical parent or `parent.adopt(...)`, guard-ancestor walking in `rules.ts` is session-aware on the active mixin path, the remaining Ruleset-only `candidate.parent!` branches in `rules.ts` are gone, and `Reference(type='function')` now honors a session-patched function name on the active lookup path through a session-aware fallback search. |
| `Expression`                 | `complete`  | Render/read path for `value` is session-aware, and `clone(...)` now preserves a session-patched value across the active reset-session `preEval()` clone boundary without mutating the canonical child parent. |
| `Operation`                  | `complete`  | Render and eval now read `left` / `right` through the session-aware view, preserved-expression and calc-preserve field updates are session-backed, `operation.test.ts` covers behavior parity, and `eval-session.test.ts` proves canonical `left` / `right` stay unchanged under an active session. |
| `Condition`                  | `complete`  | Render, eval, and clone now read `left` / `operator` / `right` / `negate` through the session-aware view, selector-vs-selector comparisons now opt into `compare(context)` on the active eval path, the node has no remaining node-local eval-time field writes, `condition.test.ts` covers behavior parity, and `eval-session.test.ts` plus `condition.test.ts` prove canonical fields stay unchanged under an active session. |
| `Sequence`                   | `complete`  | Render, eval, clone, and `operate()` now use the session-aware `value[]` path on the active context-bearing surface, `compare(other, context?)` honors session-patched arrays when a `Context` is supplied, and the one-item collapse branch now reads `preserveWhitespace` through session-aware options. The remaining canonical behaviors are intentionally contextless observers (`length`, inherited `valueOf()`, contextless `compare()`). |
| `QueryCondition`             | `inherited` | Inherits `Sequence` session-aware value reads via `_getValue(context)`.                                                                                                                |
| `List`                       | `complete`  | Render/read path for `value[]` is session-aware, `operate()` now consumes session-patched left/right items on the active path without mutating the canonical list, and `preEval()` / `evalNode()` now commit child replacements through `_setValue(...)` so non-reset sessions do not overwrite canonical `value[]`. The remaining canonical behaviors are intentionally contextless observers: cached `valueOf()`, `compare()`, `length`, and iteration. |
| `Range`                      | `complete`  | Render and eval read `start` / `end` / `step` through the session-aware view, the node has no remaining node-local eval-time field writes, `range.test.ts` covers behavior parity, and `eval-session.test.ts` plus `range.test.ts` prove canonical bounds stay unchanged under an active session. |
| `Reference`                  | `complete`  | Render and eval now read `target` / `key` through the session-aware view, dependency tracking plus resolved `sourceParent` links are session-backed, active ancestor/linear-lookup parent walks now use `sessionGetParent(...)`, and the default/leaky fallback anchors now also use session-aware `rulesParent` / `sourceRulesParent` resolution when `context.rulesContext` is unset, so detached/session-parented references do not fall back to canonical anchors. The remaining direct parent checks are limited to the separate direct-mixin/direct-call invocation stage. |
| `Interpolated`               | `complete`  | Render and eval now read `source` / `replacements` through the session-aware view, eval-time replacement updates and evaluated-state marking are session-backed, `interpolated.test.ts` covers behavior parity, and `eval-session.test.ts` proves canonical replacements stay unchanged under an active session. |
| `ImportJs`                   | `complete`  | Render and eval now read `path` / `imports` through the session-aware view, the active eval-time `path` replacement is session-backed, the non-reset session path no longer deep-clones the `Quoted` child subtree before evaluation, `import-js.test.ts` covers behavior parity, and `eval-session.test.ts` proves canonical `path` stays unchanged under an active session. |
| `ImportStyle`                | `complete`  | Active import-path resolution now uses context-aware `Url`, patched-`Quoted`, and same-node patched `path` extraction, same-node patched `withNode` / `withType` are now honored on the active `StyleImport` path, the `_dedupe` finalization path now isolates top-level imported `Ruleset` children so repeated imports do not corrupt canonical selector/rules parentage, deduped imports now also materialize top-level declaration children so returned trees get real declaration parent links without corrupting canonical source parents, configured-compose and `_dedupe` returned-tree materialization now use `Node.materializeEvaluatedCopy()` so the active path materializes from the current evaluated view instead of `sourceNode` copies, evaluated postlude wrapping now materializes cloned preludes before building wrapper `AtRule`s so canonical postlude parent pointers stay unchanged, returned import/compose trees already preserve descendant parent chains to their returned `Rules`, declaration/mixin/function lookup now climbs the session parent chain so the focused import visibility / `with` / `set` failures are green on the current head, wrapper construction now uses `cloneDetachedShallowWrapper(context)` so compose cache wrappers preserve shared top-level evaluated child identity without wrapper-side reparenting, the cached compose re-eval path now also uses `cloneLookupSafeShallowWrapper(context)` instead of raw `clone(false)`, and `_dedupe` finalization now keeps cached evaluated top-level child slots and parent pointers stable while still returning per-import materialized children. The focused node-local import suite is green (`56 passed, 1 skipped`), and the remaining blockers are below `ImportStyle`, not in its local import/finalization path. |
| `If` / `For` / control nodes | `complete`  | `If.toTrimmedString()` now reads `conditions` / `bodies` / `elseBranch` through the session-aware view, `While.toTrimmedString()` now reads `condition` / `rules` through the same control-field helper, `Each.toTrimmedString()` now reads `header` / `rules` through that helper as well, `For` already has a node-local proof for session-patched iterable rendering without canonical mutation, the `For` merged-declaration coalescing write path now keeps merged declaration values session-local on non-reset sessions, `resolveEntries()` now reads iterable declaration `name` / `value` through the session layer when iterating `Rules` / `Ruleset` / `Mixin` sources, loop-result declaration coalescing now also respects session-patched `options.normalizedFromAssign` and `name` metadata, and `$for` result accumulation now reads evaluated `Rules` children through `sessionGetChildren(...)` so loop-body child replacements that exist only in-session are visible in output without mutating the canonical loop template. Focused characterization now also proves both that call-produced `Rules` from a `$for` body already materialize correctly at the control boundary and that nested prior-iteration output is already materialized before `priorScope` consumes it, and `$for` prior-scope reuse now uses `cloneLookupSafeShallowWrapper(ctx)` so reused prior-iteration nodes stay canonically parented to emitted output while remaining lookup-visible through the prior-scope wrapper. There is no active control-visibility bug on the default path; control-block rules are meant to stay publicly visible by default. |
| `Block`                      | `complete`  | Render and eval now read `value` through the session-aware view, eval writes patch the active session instead of overwriting the canonical child, and both node-local behavior plus eval-session immutability proofs are in place. |
| `Negative`                   | `complete`  | Render and eval now read `value` through the session-aware view, unary serialization has dedicated node-local coverage, and `eval-session.test.ts` proves session overlay reads without mutating the canonical child. |
| `Rest`                       | `complete`  | Serialization now reads `value` through the session-aware view, `rest.test.ts` covers both string-backed and node-backed forms, and `eval-session.test.ts` proves session overlay reads without mutating the canonical value. |
| `Extend`                     | `complete`  | `clone(false, ..., context)` now keeps `selector` / `target` parent reassignment in the session layer instead of re-parenting canonical children, clone now also sources `selector` / `target` / `namespace` / `flag` through session-aware getters so patched extend fields survive the clone boundary without mutating the canonical node, `evalNode()` now honors session-patched `target`, `selector`, and `namespace` when recording extend instructions, extend registration now treats a session-patched `selector` as explicit instead of falling back to implicit `&` composition, downstream extend processing now consumes the recorded namespace slot in `extend-roots.ts`, keeps `hoistToRoot` session-local on the active implicit-ampersand hoist path, classifies namespace-excluded misses as `extend/not-found` instead of `extend/not-accessible`, and threads eval `Context` through selector matching/rewrite so nested extend matching can see session-aware selector state consistently. Focused extend coverage is green across `extend-rules`, `extend-roots`, `extend-list`, and `extend-import-style`, and the remaining red extend item is a snapshot/test-ownership issue in `extend-eval-integration.test.ts`, not a helper-local immutable/session bug. |
| `ExtendList`                 | `complete`  | `toTrimmedString()` now reads the active `value` array through the session layer and renders child extends directly, so a session-patched extend array serializes correctly without mutating the canonical list. |


## Selector Nodes


| Node                   | Status    | Notes                                                                |
| ---------------------- | --------- | -------------------------------------------------------------------- |
| `BasicSelector`        | `leaf`    | Scalar selector token.                                               |
| `AttributeSelector`    | `complete` | Render and eval now read `name` / `value` through the session-aware view, eval-time field updates are session-backed, `selector-attr.test.ts` covers behavior parity, and `eval-session.test.ts` proves overlay reads without canonical mutation. |
| `InterpolatedSelector` | `complete` | Render and eval now read the wrapped interpolated value through the session-aware view, `selector-interpolated.test.ts` covers behavior parity, and `eval-session.test.ts` proves overlay reads without canonical mutation. |
| `Ampersand`            | `complete` | The simple-parent collapse/hoist aliasing case is now covered with a node-local proof: a simple canonical parent selector no longer needs to be mutated just to normalize the collapsed result. `valueOf(context?)` and `getResolvedSelector(context?)` now also read a session-patched parent selector without mutating the canonical parent, focused characterization proves both that `keySet` intentionally stays canonical under one session patch and that it cannot derive a sound session-specific value when two sessions patch the same parent selector differently, the new `Selector.getKeySet(context?)` API exists and is proven through `ComplexSelector`, and matcher fast-reject now safely handles different bitset libraries when a context-aware compare path crosses session-produced selectors. The only remaining local failures in `ampersand.test.ts` are selector-list collapse output-shape expectations, not immutable/session blockers. |
| `PseudoSelector`       | `complete` | Render and eval now read `name` / `arg` through the session-aware view, eval-time `arg` updates are session-backed, `selector-pseudo.test.ts` covers behavior parity, and `eval-session.test.ts` proves canonical `arg` stays unchanged under an active session. |
| `CompoundSelector`     | `complete` | Render and eval now read `value[]` through the session-aware view, eval-time component-array updates are session-backed, compound serialization no longer mutates child spacing state, `selector-compound.test.ts` covers behavior parity, and `eval-session.test.ts` proves canonical components stay unchanged under an active session. |
| `ComplexSelector`      | `complete` | Render and eval now read `value[]` through the session-aware view, eval-time component-array updates are session-backed, single-item collapse preserves a session-only `hoistToRoot` patch without mutating canonical state, collapse-to-one-child no longer re-parents the canonical child in a patch-only session, `valueOf()` is now explicitly non-mutating and intentionally canonical as a contextless selector-identity observer, and focused proof now shows `getKeySet(context)` composes a session-specific key set through an `Ampersand` child without changing canonical `keySet`. |
| `SelectorList`         | `complete` | Render and eval now read `value[]` through the session-aware view, eval-time selector-array updates and top-level `:is()` flattening are session-backed, `selector-list.test.ts` covers behavior parity, and `eval-session.test.ts` proves canonical items stay unchanged under an active session. |
| `SelectorCapture`      | `complete` | Render and eval now read the active `value` through the session-aware path, `preEval()` replacement writes are now session-backed on the non-reset path instead of directly overwriting `value`, node-local behavior coverage also pins `valueOf()` as an intentionally canonical contextless observer, and eval-session immutability proof remains in place for the active surface. |


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
| `Paren`        | `complete` | Render and eval now read both `value` and `options.escaped` through the session-aware view, wrapper-preserving eval no longer overwrites the canonical child under an active session, `paren.test.ts` covers both patched-child and patched-escaped behavior, and existing eval-session coverage proves canonical state stays unchanged. |
| `Quoted`       | `complete` | Render and eval now read `value` through the session-aware view, active eval-time value replacement no longer overwrites the canonical node under either reset or non-reset session evaluation, and both `valueOf()` and `compare()` are now explicitly characterized as intentionally canonical contextless observers rather than unfinished session leaks. |
| `Url`          | `complete` | Render and eval now read `value` through the session-aware view, active eval-time child replacement is session-backed, `pathValue(context?)` now provides a context-aware path extractor, and `ImportStyle` uses a context-aware extractor for both `Url` and session-patched `Quoted` import paths at the active callsite. `valueOf()` remains intentionally canonical for contextless callers, but the active import-path bug is closed. |


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
