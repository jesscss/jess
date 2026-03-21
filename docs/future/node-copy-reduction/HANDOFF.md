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

### Stage status
- Stage 17: complete and committed
- Stage 18: complete and committed
- Stage 19: complete and committed
- Stage 20: major groundwork landed, but not sufficient to advance the roadmap
  - done: session-local registry deltas, session-aware register/find plumbing, scope-dirty invalidation, dependency-aware partial re-eval in declaration lookup, detached-ruleset unlock off `clone(true)`, and Stage 20 characterization coverage
  - note: plain `@import` no longer adds a finalization wrapper; compose still keeps a shallow per-import wrapper because separate import sites can require different visibility / reference metadata on the same cached module
- Stage 20.5: planned, not landed
  - purpose: replace the internal `Reference -> getFunctionFromMixins() -> JsFunction -> Call -> callWithContext()` adapter chain with a direct mixin invocation path
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
- Wrapper/selector follow-up batch is now in progress in the working tree: `Paren`, `Quoted`, `Url`, and `SelectorCapture` all have node-local behavior coverage plus eval-session immutability proof for their active eval/materialization surfaces, and `ComplexSelector` now preserves a session-only `hoistToRoot` patch on the single-item collapse path without mutating canonical state. They remain partial because their contextless observer/value APIs are still canonical, and `ComplexSelector.valueOf()` still bypasses the session layer.
- `JsImport` is now complete for this fundamentals pass: render and eval read `path` / `imports` through the session-aware view, the active eval-time `path` replacement is session-backed, the non-reset session path no longer deep-clone the `Quoted` child subtree before path evaluation, and the node has both node-local behavior coverage and eval-session immutability proof for that path.
- The next immediate node target is still `Ruleset`.
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

1. Follow the immediate node queue in `node-session-status.md` (`Ruleset` follow-up is next).
2. Keep node-level status and proof updates in `node-session-status.md`.
3. Keep stage/gate summaries in `PROGRESS.md`.
4. Only after the fundamentals gate is truly satisfied, reassess readiness for Stage 21.

### Known blockers from recent reduction attempts

1. `Rules` structural sessionization is still only partial. The child overlay exists and some production consumers use it, but `Rules` remains a higher-order incomplete node.
2. Remaining high-signal clone/copy pressure is still concentrated in `rules.ts`, `extend.ts`, `ruleset.ts`, and `ampersand.ts`.
3. The internal mixin adapter path is still indirect and now tracked as its own planned stage (`Stage 20.5`), not as a wrapper-node slice.
4. `sessionReplaceNode()` is useful but still not synonymous with “all node replacement paths are sessionized.”

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
