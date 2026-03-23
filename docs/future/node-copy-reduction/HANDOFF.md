# Agent Handoff — Jess Node Copy Reduction (jess-dev branch)

## What this project is

**Jess** is a CSS preprocessor / transpiler (TypeScript, monorepo at `~/git/oss/jess`, active
work in worktree at `~/git/worktrees/jess-dev`). This branch (`jess-dev`) is a long-running
refactor to eliminate unnecessary `clone()` / `copy()` calls in the AST evaluation engine.

The work is fully documented in `docs/future/node-copy-reduction/`. Read order:
1. `README.md` — architecture overview and philosophy
2. `migration.md` — stage-by-stage plan (Stages 0–15 complete)
3. `dependency-graph.md` — **new** — Stages 17–21 (dependency graph, session-local
   registries, Live Patch API). This is the forward roadmap, but the branch is still
   in a fundamentals-completion gate before Stage 21.
4. `PROGRESS.md` — implementation checklist, test baselines, what's done
5. `node-session-status.md` — concrete per-node inventory for the immutable/session contract

---

## Document Role

This file is the short operational handoff.

Use it for:

- current branch reality
- latest safe boundary / next immediate task
- non-negotiable working rules

Do not use this as the full node-status matrix or roadmap document:

- node-level truth lives in `node-session-status.md`
- stage/gate summary lives in `PROGRESS.md`
- roadmap/design lives in `dependency-graph.md`

## Current state

### Branch: `jess-dev`
### Latest pushed merge-safe boundary before the current fundamentals slice: `c379624f` — `Merge branch 'dev' into jess-dev`

### Immediate work
1. Follow the immediate queue in `node-session-status.md`.
2. The next live owner is lower returned-output shaping in `Rules.evaluateCandidateOutput(...)`.
3. Do not treat matcher internals or extend matching as the current blocker:
   - `selectorMatch(..., context)` now safely handles mixed selector-bit libraries
   - `Condition` now adopts `compare(context)` for selector guards on the active path
   - extend matching/rewrite now threads eval `Context` through the active helper pipeline
4. The remaining hard owners are wrapper/output shaping:
   - later `Rules` output shaping after wrapper construction
   - later returned-output shaping downstream of `Rules`
   - lower lookup-safe shallow-clone semantics that still affect control prior-scope reuse

### Stage status
- Stage 17: complete and committed
- Stage 18: complete and committed
- Stage 19: complete and committed
- Stage 20: major groundwork landed, but not sufficient to advance the roadmap
  - done: session-local registry deltas, session-aware register/find plumbing, scope-dirty invalidation, dependency-aware partial re-eval in declaration lookup, detached-ruleset unlock off `clone(true)`, and Stage 20 characterization coverage
  - note: plain `@import` no longer adds a finalization wrapper; compose still keeps a shallow per-import wrapper because separate import sites can require different visibility / reference metadata on the same cached module
- Stage 20.5: planned, not landed
  - purpose: replace the internal `Reference -> getFunctionFromMixins() -> JsFunction -> Call -> callWithContext()` adapter chain with a direct mixin invocation path
- Stage 20.6: planned, not landed
  - purpose: clean up semantics so canonical identity, active session structure, and source/call-site provenance stop sharing the same implied API meaning
- Stage 20.75: planned, exploratory, not landed
  - purpose: record first-eval mixin/import session deltas plus dependency traces, then re-evaluate from that baseline by replaying only nodes affected by changed variables in a fresh rebased session
  - guardrail: keep this deferred until the fundamentals-completion gate is actually satisfied; do not fold it into the current node-by-node sessionization queue
- Current actual stage: fundamentals-completion gate
  - focus: make immutable canonical nodes + session-backed eval writes/replacements true end-to-end
  - order: lower-order node fields first (`Declaration`, `Ruleset`), then more compositional containers
  - checklist: keep `node-session-status.md` accurate as nodes move from `pending` -> `partial` -> done
  - proof rule: every node slice needs a narrow behavior proof plus an explicit immutability/session-overlay proof before moving upward
  - anti-pattern: do not use `Rules`, imports, or extend as the primary validation layer for a lower-order node migration when the node itself can be proven directly
  - test contract:
    - node public behavior parity lives in the node's own file under `packages/core/src/tree/__tests__/`
    - session-overlay / immutability proof lives in `packages/core/src/__tests__/eval-session.test.ts`
    - broader `rules` / `import-style` / extend tests are secondary confirmation only
  - completion gate: a node is not `complete` until reads and writes are both sessionized for the in-scope path, clone/copy dependence is gone for that responsibility, required tests exist, and the slice is committed/pushed
- Stage 21: not started and explicitly blocked on the pre-Stage-21 threshold below

### Working tree expectation
- Stage boundaries on this branch are committed and pushed.
- If the working tree is dirty when you pick this up, assume it is either:
  - the current fundamentals-completion slice, or
  - a doc-sync update reflecting that gate
- Do not discard unrecognized changes without checking them first.
- Ignore unrelated dirty files under `packages/docs-content/...` unless explicitly asked to work on them.

### Test baseline (post Stage 15, confirmed clean)
- **Core** (`packages/core`): 5 failed | 63 passed | 3 skipped; 11 failed | 954 passed | 24 skipped
- **Less-compat** (`packages/jess-plugin-less-compat`): 9 passed | 54/54 tests pass
- **Fns** (`packages/fns`): 1 failed | 64 passed (pre-existing `iif.test.ts` failure)
- **Jess** (`packages/jess`): many failures from Node v24 CJS `ERR_PACKAGE_PATH_NOT_EXPORTED` — NOT regressions

The 5 failed core test files are all **pre-existing** from the dev merge (not regressions):
- `ampersand` — selector ordering during collapsing
- `at-rule` / `at-rule-basic` — parent selector inside @media
- `mixin` — mixin scope issues
- `fast-reject` — `:is(SelectorList)` full-match

**Do not fix these pre-existing failures unless specifically asked. They are the accepted baseline.**

---

## Recent committed milestones

- Stages 17–20 are materially landed.
- `RawRules`, `Block`, `Negative`, `Rest`, `AttributeSelector`, `InterpolatedSelector`, `AtRule`, and `Operation` are now complete for the fundamentals pass.
- `Mixin` has a new partial fundamentals slice: interpolated-name preEval now writes through the session field layer, but its `rules.options.rulesVisibility` policy mutation is still unresolved.
- `Call` has a new partial fundamentals slice: its non-function eval materialization of `name` / `args` now writes through the session field layer, but its fallback-call branch and the broader direct-mixin-invocation cleanup are still unresolved.
- `Func` has a new partial fundamentals slice: `evalCall()` now reads `params`, `body`, and parent context through the session-aware view, but it still relies on the higher-order temporary mixin-wrapper path.
- `Ruleset` has a new partial fundamentals slice: active render/eval reads for `hoistToRoot` are session-aware, active `hoistToRoot` writes are session-backed, and `evalNode()` now removes `F_VISIBLE` through the session runtime layer without overwriting canonical node state.
- `PseudoSelector` is now complete for this fundamentals pass: render and eval read `name` / `arg` through the session-aware view, eval-time `arg` updates are session-backed, and the node has both node-local behavior coverage and eval-session immutability proof.
- `CompoundSelector` is now complete for this fundamentals pass: render and eval read `value[]` through the session-aware view, eval-time component-array updates are session-backed, compound serialization no longer mutates child spacing state, and the node has both node-local behavior coverage and eval-session immutability proof.
- `ComplexSelector` has a new partial fundamentals slice: render and eval read `value[]` through the session-aware view, eval-time component-array updates are session-backed, and the node now has both node-local behavior coverage and eval-session immutability proof for that path.
- `SelectorList` is now complete for this fundamentals pass: render and eval read `value[]` through the session-aware view, eval-time selector-array updates plus top-level `:is()` flattening are session-backed, and the node has both node-local behavior coverage and eval-session immutability proof.
- `Interpolated` is now complete for this fundamentals pass: render and eval read `source` / `replacements` through the session-aware view, eval-time replacement updates plus evaluated-state marking are session-backed, and the node has both node-local behavior coverage and eval-session immutability proof.
- `Range` is now complete for this fundamentals pass: render and eval read `start` / `end` / `step` through the session-aware view, the node has no remaining node-local eval-time field writes, and it now has explicit node-local behavior coverage in addition to the existing session-overlay proof.
- `Condition` is now complete for this fundamentals pass: render, eval, and clone read `left` / `operator` / `right` / `negate` through the session-aware view, the node has no remaining node-local eval-time field writes, and it now has both node-local behavior coverage and eval-session immutability proof.
- `List` has a new partial fundamentals slice: `operate()` now consumes session-patched left/right items on the active path without mutating the canonical list, and the node now has both node-local behavior coverage and eval-session immutability proof for that active path. It remains partial because `valueOf()`, `compare()`, `length`, and iteration still read canonical `value[]`.
- `Reference` has a new partial fundamentals slice: eval now reads patched `target` / `key` through the session-aware view, resolved `sourceParent` links are session-backed, and the node now has both node-local behavior coverage and eval-session immutability proof for those active paths. It remains partial because the higher-order mixin adapter path is still indirect and tracked separately as Stage 20.5.
- `Sequence` has a new partial fundamentals slice: clone, eval, and `operate()` now route active `value[]` reads/writes through the session-aware path, and the node now has both node-local behavior coverage and eval-session immutability proof for eval-time value replacement. It remains partial because context-free observers like `length` and `compare()` still read canonical `value[]`.
- `Declaration` has a new partial fundamentals slice: node-local assignment-option normalization in `preEval()` is now session-backed, and the node now has both node-local behavior coverage and eval-session immutability proof for that path. It remains partial because the remaining mutation pressure is caller-side, outside the node class itself.
- `Mixin` has a new partial fundamentals slice: `preEval()` now isolates `rules.options.rulesVisibility` writes from the canonical child `Rules` container, and the node now has both node-local behavior coverage and eval-session immutability proof for that path. It remains partial because the remaining work is caller-side binding/eval behavior and broader mixin output shaping.
- `Call` has a new partial fundamentals slice: the `silentFail` fallback branch now materializes fallback `name` / `args` through node-local session-aware setters, and the node now has both node-local behavior coverage and eval-session immutability proof for canonical nested arg spacing on that path. It remains partial because `Call` still lacks a session-aware `clone()` / `contentNode` materialization path, and the larger direct-mixin-invocation cleanup is still separate.
- `Func` has a new partial fundamentals slice: temporary mixin-wrapper setup in `evalCall()` now detaches `params` / `body` inputs so canonical children are not re-parented just to build the wrapper, and the node has node-local coverage for that invariant on top of the existing eval-session proof for session-backed param/body reads. It remains partial because the wrapper path itself and downstream return extraction are still part of the broader direct-mixin-invocation cleanup.
- `Ruleset` has a new partial fundamentals slice: `valueOf(context)` now reads the session-aware selector/effective-selector path instead of the canonical cached selector, and the node has node-local coverage for session-patched selector visibility on that path on top of the existing eval-session proof for render/eval and hoist-state immutability. It remains partial because broader composition-path writes and a few remaining canonical-only reads still need reduction.
- Follow-up partial batch is now in the working tree:
  - `Call`: `clone(...)` is now session-aware for `name` / `args` / `contentNode`, and the `silentFail` fallback branch now preserves patched `contentNode` in-session without mutating the canonical call.
  - `Func`: `evalCall()` now reads the return declaration value through `sessionGetField(...)` instead of a direct canonical field read.
  - `Ruleset`: `getHeaderString()` now respects session-patched selector state in its hoist fallback branch.
  - `Sequence`: `compare(other, context?)` now honors session-patched arrays when a `Context` is supplied.
  - `List`: the remaining canonical-only observer surfaces (`length`, iterator, `valueOf()`, `compare()`) are now explicitly characterized as requiring a broader API change, not a safe node-local patch.
- Exact follow-up batch is now committed:
  - `Call`: the plain non-function branch now materializes a real clone before clearing `silentFail`, so patch-only session eval no longer mutates the canonical call. Remaining `Call` work is now downstream in callee/result-node branches, not another isolated local write.
  - `Func`: `evalCall()` no longer calls `parent.adopt(...)` for the temporary mixin wrapper. Remaining work is the broader direct `candidate.parent!` dependency in `rules.ts`.
  - `Ruleset`: active `preEval()` / `evalNode()` selector `sourceNode` reads and writes now use session runtime. Remaining node-local gap is the context-free `copy()` / materialization path.
  - `Declaration`: strengthened characterization proves `requiredSemi` is still a contextless canonical observer and needs broader caller/API work.
  - `List`: strengthened characterization proves cached `valueOf()` stays intentionally canonical across competing session overlays.
  - `Sequence`: strengthened characterization proves `length` stays intentionally canonical across competing session overlays.
- Latest wrapper/selector follow-up batch is now in the working tree:
  - `Paren`: `options.escaped` is now session-aware on both render and eval paths, which closes the remaining node-local `Paren` gap.
  - `ComplexSelector`: `valueOf()` no longer mutates the node when `value` is non-array, and the remaining canonical `valueOf()` boundary is now explicit rather than an accidental bypass.
  - `Quoted`: `valueOf()` is now explicitly characterized as intentionally canonical across competing session overlays.
  - `Url`: `valueOf()` is now explicitly characterized as intentionally canonical because import-path consumers still call it without a `Context`.
  - `Func` / `rules.ts`: the temporary mixin wrapper now uses `sessionSetParent(...)`, and the main mixin-eval branches it depends on now resolve parent through `sessionGetParent(...)` instead of direct `candidate.parent!`.
  - `Ruleset.copy()`: investigated and left unchanged; the remaining selector `sourceNode` dependency is blocked on the broader context-free provenance/materialization model, not a safe `Ruleset`-local patch.
- New focused fundamentals batch is now in the working tree:
  - `rules.ts`: `hasFailedGuardAncestor()` now walks parentage through `sessionGetParent(...)`, so active mixin guard ancestry no longer depends on canonical `node.parent`.
  - `Ruleset.copy()`: closed via a shared `Node.materializeCopy()` helper; `Ruleset.copy()` now materializes from authored selector provenance instead of reading `currentSelector.sourceNode` directly.
  - `Declaration`: serialization now has a context-aware semicolon decision via `requiresSemi(context?)`, and `serialize-helper` uses it on active ruleset/at-rule paths.
  - `Url` / `ImportStyle`: `Url.pathValue(context?)` now exposes context-aware import-path materialization, and `ImportStyle` uses it at the active path-resolution callsite.
  - `SelectorCapture`: `valueOf()` is now explicitly pinned as an intentionally canonical contextless observer; the active render/eval surface is complete.
  - `Quoted`: `compare()` is now explicitly characterized as intentionally canonical without a `Context` channel.
- Latest exact-gap batch is now in the working tree:
  - `Rules`: root declaration serialization now uses `Declaration.requiresSemi(context)` on the active context-bearing path instead of canonical `requiredSemi`.
  - `rules.ts`: the remaining Ruleset-only `candidate.parent!` dereferences are gone; active mixin/ruleset parent lookup now flows through the session-aware helper everywhere in `getFunctionFromMixins()`.
  - `ImportStyle`: the active import-path callsite now resolves session-patched `Quoted` paths context-aware, not just `Url` paths.
  - `ComplexSelector`: the collapse-to-one-child eval branch no longer reparents the canonical child in a patch-only session.
  - `Quoted`: non-reset session eval is now explicitly proven to keep canonical `value` unchanged; completion is now justified at the node-local level.
- New completion-audit wave is now in the working tree:
  - `Call`: the nested-`Call` downstream branch now materializes the inner result before applying outer call provenance; the remaining `Call`-local downstream branch is `Collection`.
  - `Mixin`: `clone(...)` now preserves session-patched `name` / `rules` / `params` / `guard` across the `preEval()` clone boundary without mutating canonical children.
  - `Reference`: active ancestor/linear-lookup parent walks now use `sessionGetParent(...)` instead of canonical `parent`.
  - `SelectorCapture`: `preEval()` replacement writes are now session-backed instead of directly overwriting `value`.
  - `Declaration`: serializer de-dupe/custom-property decisions and merged-declaration coalescing now read the property name through session-aware helpers.
  - `Url`: audited complete for node-local scope after the import-path callsite fixes; no further active bug was found in the owned path.
- Latest completion-audit wave is now in the working tree:
  - `Call`: the remaining downstream `Collection` branch now materializes cloned collection children before wrapping them in `Rules`, so outer call provenance and `markImportant` no longer touch canonical collection children.
  - `List`: `preEval()` and `evalNode()` now commit child replacements through `_setValue(...)`, so non-reset sessions no longer overwrite canonical `value[]`.
  - `Sequence`: the one-item collapse branch now reads `preserveWhitespace` through session-aware options rather than canonical `node.options`.
  - `Rules`: non-reset-session `push()` / `splice()` / `unshift()` now stay on the child overlay path instead of mutating canonical `value[]`.
  - `Ruleset`: characterization now proves the remaining real gap is `preEval()` mutating canonical child `rules.options.rulesVisibility`, which points at missing `Rules.options` session semantics rather than another `Ruleset` field setter.
  - `Func`: characterization now proves the remaining gap is lookup-side, not `evalCall()`: `Reference(type='function')` does not yet honor a session-patched function name.
- Focused verification for that wave is green:
  - `pnpm --dir packages/core test src/tree/__tests__/call.test.ts src/tree/__tests__/list.test.ts src/tree/__tests__/sequence.test.ts src/tree/__tests__/rules.test.ts src/tree/__tests__/ruleset.test.ts src/tree/__tests__/func.test.ts`
  - Result: `85 passed, 8 skipped`
- Latest exact-gap batch is now in the working tree:
  - `Rules`: `getCurrentOptions()` / `setCurrentOptions()` now provide a session surface for `Rules.options`, and `Ruleset.preEval()` now routes `rulesVisibility` updates through that surface instead of mutating canonical child options.
  - `Ruleset`: `setOwnSelector()` now preserves other session-patched option fields instead of rebuilding from canonical `this.options`.
  - `Call`: option reads for `silentFail` / `markImportant` are now session-aware on render and eval paths.
- Focused verification for this subset is green:
  - `pnpm --dir packages/core test src/tree/__tests__/call.test.ts src/tree/__tests__/import-style.test.ts src/tree/__tests__/rules.test.ts src/tree/__tests__/ruleset.test.ts`
  - Result: `102 passed, 9 skipped`
- New exact-gap batch is now in the working tree:
  - `Func` / `Reference` / `Rules`: `Reference(type='function')` now honors a session-patched function name on the active lookup path via a session-aware fallback search in `Rules.findSessionPatchedFunction(...)`.
  - `Expression`: `clone(...)` is now session-aware for the active reset-session `preEval()` path, preserving a session-patched child value across the clone boundary without mutating the canonical child parent.
  - `ImportStyle`: the `_dedupe` finalization path now deep-clones top-level imported `Ruleset` nodes so repeated imports do not corrupt the canonical `selector` / `rules` child parent pointers.
  - `Ruleset`: re-audited complete for the current node-local fundamentals scope now that `Rules.options` session semantics are in place.
- Focused verification for this subset is green:
  - `pnpm --dir packages/core test src/tree/__tests__/func.test.ts src/tree/__tests__/reference.test.ts src/tree/__tests__/expression.test.ts src/tree/__tests__/call.test.ts src/tree/__tests__/import-style.test.ts`
  - Result: `95 passed, 1 skipped`
- New high-complexity fundamentals batch is now in the working tree:
  - `ExtendList`: `toTrimmedString()` now reads the active `value` array through the session layer and renders child extends directly, so session-patched extend arrays serialize without mutating the canonical list.
  - `Extend`: `clone(false, ..., context)` now keeps shallow-clone parent reassignment for `selector` / `target` in the session layer instead of re-parenting canonical children, and `evalNode()` now honors a session-patched `target` when registering extends without mutating the canonical node.
  - `Rules`: reset-session `preEval()` clones now preserve their active parent through the session runtime layer, and nestable at-rule wrapper detection now reads parentage through `sessionGetParent(...)`.
  - `control.ts`: `If.toTrimmedString()` now reads session-patched `conditions` / `bodies` / `elseBranch`, while `For` retains the existing session-patched iterable proof.
- Focused verification for this subset is green:
  - `pnpm --dir packages/core test src/tree/__tests__/extend-list.test.ts src/tree/__tests__/rules.test.ts src/tree/__tests__/extend-rules.test.ts src/tree/__tests__/control.test.ts`
  - Result: `66 passed, 8 skipped`
- New follow-up fundamentals batch is now in the working tree:
  - `Rules`: `findSessionPatchedFunction()` now climbs scope with `sessionGetParent(...)`, so session-only parent chains do not hide parent functions on the active lookup path.
  - `Extend`: `evalNode()` now treats a session-patched `selector` as explicit during extend registration instead of incorrectly falling back to implicit `&` composition.
  - `control.ts`: `While.toTrimmedString()` now reads session-patched `condition` / `rules` through the control field helper, so patched `While` rendering no longer falls back to canonical state.
- Focused verification for this subset is green:
  - `pnpm --dir packages/core test src/tree/__tests__/rules.test.ts src/tree/__tests__/extend-rules.test.ts src/tree/__tests__/control.test.ts`
  - Result: `68 passed, 8 skipped`
- New mixed high-complexity batch is now in the working tree:
  - `Rules`: merged declaration coalescing now compares parent scope boundaries through `sessionGetParent(...)` when a session is active, so merged `+=` declarations no longer make cross-scope decisions from canonical parent links alone.
  - `Extend`: `clone()` now sources `selector` / `target` / `namespace` / `flag` through session-aware getters, so patched extend fields survive cloning without mutating the canonical node.
  - `control.ts`: `Each.toTrimmedString()` now reads session-patched `header` / `rules` through the control field helper, closing the remaining obvious control render/read surface in that file.
  - `ImportStyle`: evaluated postlude wrapping now materializes cloned preludes before building wrapper `AtRule`s, so canonical postlude parent pointers stay unchanged.
  - `Ampersand`: added a focused proof for the simple-parent collapse/hoist aliasing case; the node still has the same two noisy selector-list collapse failures and remains pending.
- Focused verification for this subset is green:
  - `pnpm --dir packages/core test src/tree/__tests__/rules.test.ts src/tree/__tests__/extend-rules.test.ts src/tree/__tests__/control.test.ts`
  - Result: `72 passed, 8 skipped`
  - `pnpm --dir packages/core exec vitest run src/tree/__tests__/import-style.test.ts -t "evaluated postlude wrapping does not corrupt canonical postlude parent pointers"`
  - Result: `1 passed, 43 skipped`
  - `pnpm --dir packages/core exec vitest run src/tree/__tests__/ampersand.test.ts -t "does not mutate the canonical simple parent selector in the collapse/hoist path"`
  - Result: `1 passed, 14 skipped`
- New mixed high-complexity batch is now in the working tree:
  - `Rules`: `setDefined` parent-scope insertion now threads the active context into lookup and resolves the containing `Rules` through `sessionGetParent(...)`, so a session-only replacement declaration can act as the set-defined anchor without mutating canonical children.
  - `Extend`: `valueOf(context)` now reflects a session-patched `target`, and `extend-roots` now applies `F_EXTENDED` / `F_VISIBLE` through the session-aware flag APIs so session-only extend processing no longer leaks those flags onto canonical `Ruleset`s.
  - `control.ts`: the `For` merged-declaration coalescing path now reads/writes declaration values through the session layer, keeping merged loop output session-local on non-reset sessions.
  - `ImportStyle`: `toTrimmedString()`, `evalNode()`, and configured-compose finalization now read `path`, `withNode`, and `withType` through session-aware accessors on the same `StyleImport` node.
- Focused verification for this subset is green:
  - `pnpm --dir packages/core test src/tree/__tests__/rules.test.ts src/tree/__tests__/extend-rules.test.ts src/tree/__tests__/control.test.ts`
  - Result: `76 passed, 8 skipped`
  - `pnpm --dir packages/core exec vitest run src/tree/__tests__/import-style.test.ts -t "uses session-patched withNode and withType on the same StyleImport node|import path resolution uses a session-patched path field on the same StyleImport node"`
  - Result: `2 passed, 44 skipped`
- `JsImport` is now complete for this fundamentals pass: render and eval read `path` / `imports` through the session-aware view, the active eval-time `path` replacement is session-backed, the non-reset session path no longer deep-clone the `Quoted` child subtree before path evaluation, and the node has both node-local behavior coverage and eval-session immutability proof for that path.
- The next immediate target is now the remaining `ImportStyle` finalization / returned-tree clone-pressure audit.
- Next clean landed batch after that:
  - `extend-roots`: `applyInstructionToRuleset()` now reads/writes `hoistToRoot` through the session layer, so hoist-producing extend application does not mutate canonical nested `Ruleset` state.
  - `control.ts`: `resolveEntries()` now reads iterable declaration `name` / `value` through the session layer for `Rules` / `Ruleset` / `Mixin` iterables, so loop key/value binding sees session-patched declarations instead of canonical values.
  - verification:
    - `pnpm --dir packages/core test src/tree/__tests__/extend-rules.test.ts src/tree/__tests__/control.test.ts`
    - result: `36 passed`
- Next clean landed batch after that:
  - `Ruleset`: `_getRulesContainer(context)` now session-adopts a session-patched `Rules` child back to the owning `Ruleset`, so raw `sessionPatchField(..., 'rules', ...)` no longer leaves the active child container parentless in-session.
  - `control.ts`: `$for` declaration coalescing now reads session-patched `options.normalizedFromAssign` and declaration `name` through the control helper, so assignment-style merge behavior respects session metadata instead of canonical options.
  - verification:
    - `pnpm --dir packages/core test src/tree/__tests__/extend-rules.test.ts src/tree/__tests__/control.test.ts`
    - result: `37 passed`
- Next clean landed batch after that:
  - `Reference`: default/leaky fallback lookup anchors now resolve through session-aware `rulesParent` / `sourceRulesParent` when `context.rulesContext` is unset, so detached/session-parented references no longer fall back to canonical anchors.
  - verification:
    - `pnpm --dir packages/core test src/tree/__tests__/reference.test.ts`
    - result: `30 passed`
- Next clean mixed slice after that:
  - `Rules`: readonly compose-shadow checks now enumerate direct declarations through a session-aware helper instead of canonical registry `.index`, so session-only declaration replacements are visible to the readonly guard.
  - `import-style.test.ts`: returned import/compose trees already preserve descendant parent chains to their returned `Rules`, so the remaining 3 import failures are not caused by simple descendant parent loss.
  - `control.test.ts`: characterization now shows the loop-body `Rules.options.rulesVisibility` override survives the clone boundary; this is not an active bug because control-block rules are meant to be public by default.
  - verification:
    - `pnpm --dir packages/core test src/tree/__tests__/rules.test.ts`
    - `pnpm --dir packages/core test src/tree/__tests__/control.test.ts`
    - `pnpm --dir packages/core test src/tree/__tests__/import-style.test.ts src/tree/__tests__/reference.test.ts`
  - result:
    - `rules.test.ts`: green
    - `control.test.ts`: green
    - `import-style.test.ts`: green after `DeclarationRegistry.find()` switched its parent climb to `sessionGetParent(...)`
- This closes the focused import visibility blocker on the current head. The remaining import work is clone-pressure / returned-tree cleanup, not the old parent-var / `with` / `set` lookup failures.
- Small selector-side follow-up after that:
  - `Ampersand`: `valueOf(context?)` and `getResolvedSelector(context?)` now read a session-patched parent selector without mutating the canonical parent selector.
  - verification:
    - `pnpm --dir packages/core test src/tree/__tests__/ampersand.test.ts`
  - result:
    - only the same 2 known noisy selector-list collapse failures remain
- Next clean ancestry/extend batch now landed in the working tree:
  - `Rules`: `getFunctionFromMixins()` now derives caller/source scope from the session parent/source-parent chain instead of canonical `caller?.rulesParent` / `caller?.sourceRulesParent`.
  - `registry-utils.ts`: `MixinRegistry.find()` and `FunctionRegistry.find()` now climb through `sessionGetParent(...)`, not canonical `rules.parent`, so mixin/function lookup no longer falls back to canonical scope chains on the active path.
  - `extend-roots.ts`: nested extend target selection now retries against the parent's active effective selector when `selectorBeforeExtend` misses, which makes the old nested-session characterization a real passing behavior.
  - `import-style.ts`: deduped imports now materialize top-level declaration children in returned trees without corrupting canonical source parents.
  - verification:
    - `pnpm --dir packages/core exec vitest run src/tree/__tests__/mixin.test.ts src/tree/__tests__/call.test.ts src/tree/__tests__/func.test.ts -t "..."`
    - `pnpm --dir packages/core exec vitest run src/tree/__tests__/extend-rules.test.ts src/tree/__tests__/extend-import-style.test.ts -t "..."`
    - `pnpm --dir packages/core test src/tree/__tests__/import-style.test.ts src/tree/__tests__/rules.test.ts src/tree/__tests__/func.test.ts src/tree/__tests__/reference.test.ts`
  - result:
    - all green on the focused set
- Latest small follow-up now landed in the working tree:
  - `Rules`: `_normalizeCallDeclarationRulesOrder()` now reads `sourceParent` through the session layer when a context is active, so declaration-only `Rules` blocks produced by calls reorder correctly from session ancestry without mutating canonical children.
  - `Ampersand`: focused characterization now proves `keySet` intentionally stays canonical when only the parent selector is session-patched.
  - This means the next `Ampersand` owner is broader selector/key-set semantics, not another safe `Ampersand`-local patch.
- Latest mixed follow-up now landed in the working tree:
  - `Rules`: the `@charset` replacement branch in `_multiPassPreEval()` now adopts its replacement child through the session layer instead of giving that replacement a canonical parent during non-reset preEval.
  - `Extend`: `evalNode()` now preserves a session-patched `namespace` on the recorded extend instruction tuple, and `Context.extends` is typed to carry that namespace slot.
  - `Ampersand`: focused characterization now also proves that two concurrent sessions patching the same parent selector differently still share one canonical `keySet`, which is why the next owner is broader selector/session API work rather than `Ampersand` alone.
- Latest mixed follow-up now landed in the working tree:
  - `control.ts`: `$for` result accumulation now reads evaluated `Rules` children through `sessionGetChildren(...)`, so loop-body child replacements that exist only in the active session are visible in emitted output without mutating the canonical loop template.
  - `extend-roots.ts`: `clearExtendedRuleset()` now clears stale session-local `hoistToRoot` through the existing session-aware setter path, so a later helper-only extend pass that no longer matches does not leave a stale hoist bit behind.
  - `import-style.test.ts`: focused characterization now proves `_dedupe` finalization must materialize from the evaluated top-level children, not `sourceNode` copies, so the next import owner is the shared node materialization layer centered on `node-base.ts`.
- Latest characterization follow-up now landed in the working tree:
  - `ruleset.test.ts`: `Ruleset.preEval()` already composes and registers a session-patched nested child ruleset under the active extend root.
  - `import-style.test.ts`: `_dedupe` also cannot use shallow top-level child clones, because that reparents nested canonical children.
  - So the next live owner is the shared evaluated-view materialization contract in `node-base.ts`, not another local `ImportStyle` or `Ruleset` patch.
- Latest mixed follow-up now landed in the working tree:
  - `Rules`: mixin output `Rules` now keep both `parent` and `sourceParent` in the session layer instead of materializing those links canonically on the lower `getFunctionFromMixins()` path.
  - `Ruleset`: `evalNode()` now checks `rules.visibleRules(context)` instead of the canonical no-context path when deciding whether the ruleset itself should remain visible.
  - `extend-roots.ts`: downstream namespace-aware matching is now wired through, and namespace-excluded misses are classified as `extend/not-found` instead of `extend/not-accessible`.
  - `selector.ts` / `ampersand.ts`: `Selector.getKeySet(context?)` is now in place, and `selector-complex.test.ts` proves consumer-side code can derive a session-specific complex key set through an `Ampersand` child without changing canonical `keySet`.
- Latest returned-tree / lower-mixin follow-up now landed in the working tree:
  - `node-base.ts`: `Node.materializeEvaluatedCopy()` now provides a shared evaluated-view materialization path alongside provenance-root `materializeCopy()`.
  - `import-style.ts`: configured-compose and `_dedupe` returned-tree materialization now use `materializeEvaluatedCopy()`, so the active import finalization path materializes from evaluated children rather than `sourceNode` copies.
  - `Rules`: the lower `getFunctionFromMixins()` parameter wrapper now keeps `outerRules.parent` in the session layer instead of canonically adopting it.
  - `selector-match-unit.test.ts`: focused characterization now proves `selectorMatch()` cannot safely consume `getKeySet(context)` yet because it has no context parameter and its pair cache is not context-aware.
  - `control.test.ts`: focused characterization now proves call-produced `Rules` from a `$for` body already materialize correctly at the control boundary, so the remaining owner is downstream in `Rules.eval()` / returned-child materialization rather than `control.ts`.
- Latest lower-rules / matcher follow-up now landed in the working tree:
  - `Rules`: bound parameter values in `getFunctionFromMixins()` now keep `sourceParent` in the session layer instead of writing it canonically on the lower binding path.
  - `selector-match-core.ts`: `selectorMatch()` now accepts an optional eval `Context`; when provided, matching uses session-aware `valueOf(context)`, `getResolvedSelector(context)`, and `getKeySet(context)` while preserving canonical no-context behavior.
  - `import-style.test.ts`: focused characterization now proves the remaining local import-wrapper blocker is `Rules.clone(false)` reparenting shared top-level children immediately before finalization can decide whether to keep or materialize them.
  - `control.test.ts`: focused characterization now proves nested prior-iteration output is already materialized before `$for` `priorScope` consumes it, so the remaining owner stays in `Rules.eval()` / returned-child materialization.
  - `selector-complex.test.ts`: consumer-side proof remains green that a complex selector can derive a session-specific key set through an ampersand child.
- Latest ruleset/owner-sharpening follow-up now landed in the working tree:
  - `ruleset.ts`: reference-mode nested selector composition now runs through one shared filtered-parent path, so the remaining `collapseNesting` reference-import extend failures are green.
  - `extend-rules.test.ts`: now proves a nested ampersand selector extends correctly through a session-patched parent selector.
  - `mixin.test.ts`: focused characterization now proves the remaining lower mixin-output gap is no longer `Rules` provenance; it is a returned `Ruleset` whose `selector` and `rules` containers are still tied to a non-returned owner.
  - `rules.test.ts`: focused characterization now proves the remaining control-family parent-integrity issue is lower than `Rules.eval()` itself on the current slice, because shallow `Rules.clone(false, ..., ctx)` already shares nested `Ruleset.rules` bodies by reference.
  - `fast-reject.test.ts`: focused characterization now proves raw `selectorMatch(..., context)` can see a session-patched ampersand parent while compare-side consumers still stay canonical.
- Latest wrapper/materialization follow-up now landed in the working tree:
  - `ruleset.ts`: shallow clones of derived rulesets now materialize their immediate `selector` and `rules` containers onto the clone under an active session, fixing the returned mixin-wrapper nested selector/body parent chain.
  - `mixin.test.ts`: now proves returned nested rulesets keep both `selector.parent` and `rules.parent` on the returned ruleset.
  - `index.ts` / `selector-list.ts`: compare paths now accept the existing optional eval context and forward it through to `selectorMatch(..., context)`, so compare-side consumers can opt into session-aware selector matching without changing canonical no-context behavior.
  - `fast-reject.test.ts`: now proves `compare(other, context)` can see a session-patched ampersand parent while contextless compare remains canonical.
  - `rules.test.ts` / `import-style.test.ts`: focused characterization now narrows the remaining cross-cutting parent-integrity blocker to the shallow-wrapper primitive itself rather than a local `Rules`/`ImportStyle`/`control.ts` bug.
- A planned Stage 20.5 now tracks the architectural cleanup for direct mixin invocation:
  - replace the internal `Reference -> getFunctionFromMixins() -> JsFunction -> Call -> callWithContext()` adapter chain
  - keep `getFunctionFromMixins()` only as an optional external adapter if that surface is still needed

For node-level details and ordering, read:

- `node-session-status.md`
- `PROGRESS.md`

---

## Pre-Stage-21 Threshold

Do not begin Stage 21 until all four conditions are true:

1. All cloning that this refactor intends to remove is actually removed.
2. All eval-time writes, mutations, and node replacements that are in scope for this refactor route through sessions.
3. Tests pass to the accepted baseline with (1) and (2) true.
4. A merge back to `dev` is credible without changing existing behavior.

### Immediate work

1. Follow the immediate node queue in `node-session-status.md` (detached shallow-wrapper / materialized-wrapper primitive is next).
2. Keep node-level status and proof updates in `node-session-status.md`.
3. Keep stage/gate summaries in `PROGRESS.md`.
4. Only after the fundamentals gate is truly satisfied, reassess readiness for Stage 21.
5. Keep the new scope/provenance semantic cleanup deferred; do not turn it into active refactor work until the node-session fundamentals queue is much more complete.

### Known blockers from recent reduction attempts

1. `Rules` structural sessionization is still only partial. The child overlay exists and some production consumers use it, but `Rules` remains a higher-order incomplete node.
2. Remaining high-signal clone/copy pressure is still concentrated in `rules.ts`, `extend.ts`, `ruleset.ts`, and `ampersand.ts`.
3. The internal mixin adapter path is still indirect and now tracked as its own planned stage (`Stage 20.5`), not as a wrapper-node slice.
4. `sessionReplaceNode()` is useful but still not synonymous with “all node replacement paths are sessionized.”
5. `sourceParent` / `sourceRulesParent` semantics are now explicitly tracked as deferred architecture cleanup (`Stage 20.6`), not as active node-slice work.

### Key files to read first
- `docs/future/node-copy-reduction/node-session-status.md`
- `docs/future/node-copy-reduction/PROGRESS.md`
- `docs/future/node-copy-reduction/dependency-graph.md`
- `packages/core/src/tree/rules.ts`
- `packages/core/src/eval-session.ts`
- `packages/core/src/tree/util/session-helpers.ts`

---

## Non-negotiable rules

1. **Never use `as any`**. Use proper type guards, type assertions, or fix the type definition.
2. **Run tests after every meaningful change**: `cd packages/core && pnpm test`. Baseline is 5 failed / 63 passed.
3. **Do not fix pre-existing failures** unless asked. Only your changes should affect the count.
4. **Commit after each successful stage** (or sub-stage). If tests break, fix before committing.
5. **One stage at a time**. Stage 20 is not the only prerequisite; the pre-Stage-21 threshold above must also be met before any Stage 21 work starts.
6. **No destructive git ops** without explicit user permission (`git reset --hard`, `git restore`, etc.).
7. **Never work directly in `~/git/oss/less.js`** — always use worktrees.

---

## Architecture summary (enough to work without reading everything)

### The eval model

```
CANONICAL TREE (parsed once, never mutated after eval starts)
  └─ Rules.value[]  ←── WeakMap-keyed registry index (Stage 19)

EVAL SESSION (one per import / mixin call / with-import)
  ├─ runtimeState: WeakMap<Node, {parent, index, evaluated, preEvaluated}>
  ├─ nodePatches: WeakMap<Node, Record<string, unknown>>
  ├─ dependencyMap: WeakMap<Node, {dependsOn, sourceExpr}>  ← Stage 18
  └─ registryDeltas: WeakMap<Rules, SessionRegistryDelta>   ← Stage 20
```

Session helpers (`session-helpers.ts`) provide the read/write surface:
- `sessionGetField` / `sessionPatchField`
- `sessionIsEvaluated` / `sessionSetEvaluated`
- `sessionIsPreEvaluated` / `sessionSetPreEvaluated`
- `sessionGetParent` / `sessionSetParent`
- etc.

Architectural hard rules:
- Canonical nodes are immutable after construction.
- Eval-time replacement and field update are both session-layer writes.
- Clone/copy is not a substitute for session layering.
- Lower-order nodes must be fully session-correct before higher-order containers are reduced.

When no session is active, every helper falls through to the direct field — zero cost,
zero behavior change for non-session code paths.

### The `_extendedSelector` pattern

`Ruleset` has:
- `selector`: the original authored selector (canonical, should be immutable)
- `_extendedSelector`: the extend-patched selector (set only during extend, session-local eventually)
- `getEffectiveSelector()`: returns `_extendedSelector ?? selector`

Stage 17 removed the direct `selector` mutation. `selector` is now treated as canonical and
extend output rides through `_extendedSelector`.

### Registry structure

```
Rules instance
  ├─ rulesetRegistry: RulesetRegistry
  ├─ mixinRegistry: MixinRegistry
  ├─ declarationRegistry: DeclarationRegistry
  └─ functionRegistry: FunctionRegistry
```

`functionRegistry` remains instance-local. The canonical ruleset, mixin, and declaration
registries now live in a `WeakMap<Node[], RegistryData>` keyed by `rules.value`, and
Stage 20 adds a session-local delta layer on top.

### Copy-on-write pattern

`clone(false, undefined, ctx)` with an active session:
- Shallow-copies all fields
- Routes child parent-pointer writes through `session.runtimeState` (not onto canonical node)
- Canonical nodes' `.parent` fields are preserved

This is the mechanism that lets mixin bodies and imported trees share the canonical tree
across multiple eval sessions without corruption.

---

## Key files reference

| File | Role |
|------|------|
| `packages/core/src/tree/node-base.ts` | Node base class, `clone()`, `adopt()`, `maybeClone()`, eval dispatch |
| `packages/core/src/eval-session.ts` | `EvalSession` class — all session state |
| `packages/core/src/tree/util/session-helpers.ts` | Session-aware read/write helpers |
| `packages/core/src/tree/import-style.ts` | Import eval — where most session work has landed |
| `packages/core/src/tree/rules.ts` | `Rules` class — registry host, mixin eval, `$for` loops |
| `packages/core/src/tree/util/extend-roots.ts` | `applyInstructionToRuleset` — extend engine |
| `packages/core/src/tree/util/extend-core.ts` | Selector assembly for extend — `copy(true)` sites |
| `packages/core/src/tree/util/selector-utils.ts` | Selector helpers — more `copy(true)` sites |
| `packages/core/src/tree/util/registry-utils.ts` | `RulesetRegistry`, `MixinRegistry`, etc. |
| `packages/core/src/tree/ruleset.ts` | `Ruleset` — `_extendedSelector`, `getEffectiveSelector()` |

---

## Test commands

```bash
# Fast extend-only run
cd packages/core && pnpm test extend

# Focused Stage 20 verification
cd packages/core && pnpm test src/tree/__tests__/rules.test.ts src/__tests__/eval-session.test.ts src/tree/__tests__/dependency-graph.test.ts
cd packages/core && pnpm test src/tree/__tests__/registry-characterization.test.ts src/tree/__tests__/control.test.ts
cd packages/core && pnpm test src/tree/__tests__/extend-import-style.test.ts src/tree/__tests__/import-style.test.ts

# Full core suite (before larger commits if needed)
cd packages/core && pnpm test

# Less-compat regression check
cd packages/jess-plugin-less-compat && pnpm test

# Build core (required before running jess package tests)
pnpm --filter @jesscss/core build
```

---

## What NOT to do

- Do not change `.css` fixture files without user review — they are Less v5 alpha expected
  outputs maintained by the user, not Less.js 4.x outputs.
- Do not add unnecessary comments to code. Avoid comments that restate what the code does.
- Do not add `as any` casts.
- Do not run tests from the repo root with `pnpm test` unless you expect Jess package
  failures — the Node v24 CJS issue makes that noisy.
- Do not create new abstraction layers or helpers that are only used once.
- Do not start Stage 21 merely because the Stage 20 slice is committed. The threshold above is the real gate.
