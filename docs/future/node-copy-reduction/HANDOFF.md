# Agent Handoff — Jess Node Copy Reduction (jess-dev branch)

## What this project is

**Jess** is a CSS preprocessor / transpiler (TypeScript, monorepo at `~/git/oss/jess`, active
work in worktree at `~/git/worktrees/jess-dev`). This branch (`jess-dev`) is a long-running
refactor to eliminate unnecessary `clone()` / `copy()` calls in the AST evaluation engine.

The work is fully documented in `docs/future/node-copy-reduction/`. Read order:
1. `README.md` — architecture overview and philosophy
2. `migration.md` — stage-by-stage plan (Stages 0–15 complete)
3. `dependency-graph.md` — **new** — Stages 17–21 (dependency graph, session-local
   registries, Live Patch API). This is the active roadmap.
4. `PROGRESS.md` — implementation checklist, test baselines, what's done
5. `node-session-status.md` — concrete per-node inventory for the immutable/session contract

---

## Current state

### Branch: `jess-dev`
### Last commit: `99065d2f` — docs(progress): add Live Patch API vision

### Stage status
- Stage 17: complete and committed
- Stage 18: complete and committed
- Stage 19: complete and committed
- Stage 20: completed as a slice, but not yet sufficient to advance the roadmap
  - done: session-local registry deltas, session-aware register/find plumbing, scope-dirty invalidation, dependency-aware partial re-eval in declaration lookup, detached-ruleset unlock off `clone(true)`, and Stage 20 characterization coverage
  - note: plain `@import` no longer adds a finalization wrapper; compose still keeps a shallow per-import wrapper because separate import sites can require different visibility / reference metadata on the same cached module
- Stage 20.5: planned, not landed
  - purpose: replace the internal `Reference -> getFunctionFromMixins() -> JsFunction -> Call -> callWithContext()` adapter chain with a direct mixin invocation path
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
  - the Stage 20 completion commit being prepared, or
  - the first Stage 21 slice
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

## What was just done (this session)

1. Stage 17 made selectors effectively immutable in extend paths by routing extend output through `_extendedSelector`.
2. Stage 18 added the session-local dependency graph (`dependsOn`, `sourceExpr`) and propagation through reference/expression/operation/call/declaration paths.
3. Stage 19 moved canonical ruleset, mixin, and declaration registries into a `WeakMap<Node[], RegistryData>` keyed by `Rules.value`.
4. Stage 20 landed the session-local registry delta layer, dependency-aware declaration lookup, detached-ruleset unlock via shallow session-safe clone, and the major import finalization reductions.
5. Follow-up threshold work decoupled session registry deltas from `Rules.value` identity by keying them to the `Rules` container itself, and `Rules.value` is now typed readonly for consumers so plugin code must go through `setData()` / container helpers rather than mutating arrays directly.
6. Session-aware `Rules.unshift(ctx, ...)` / `Rules.splice(ctx, ...)` coverage now proves shared canonical nodes can be inserted into session-scoped wrappers without overwriting canonical `.parent` pointers.
7. `src/tree/__tests__/import-style.test.ts` had two failures at committed boundary `3b4d089e`:
   - `forwarded members are not visible locally, but are visible downstream`
   - `two sequential "with" imports do not corrupt canonical node parent pointers`
   Both are now green on the working tree.
8. `src/tree/__tests__/registry-characterization.test.ts` now proves four Stage 20 properties in isolation:
   - cached compose imports reuse the same canonical WeakMap-backed registry slot
   - session-only declaration registrations stay in `EvalSession.registryDeltas` instead of polluting the canonical cache
   - repeated `_dedupe` imports reuse the same canonical registry slot
   - mixin expansion parameter vars stay in session delta only
9. `packages/core/src/tree/import-style.ts` no longer clones child `Ruleset`s for plain `multiple:true` imports.
   The child-clone path is now kept only for implicit reference / `_dedupe` imports, because
   removing it there regressed `extend-import-style` (`implicit reference mode (_dedupe) remains externally extendable`).
10. `packages/core/src/tree/import-style.ts` also no longer adds a second shallow `Rules` wrapper for plain `@import` finalization.
   `src/tree/__tests__/registry-characterization.test.ts` now proves that plain imports reuse the evaluated root and that `_dedupe` detaches the shared child array before cloning per-import `Ruleset`s.
11. Configured `with` compose finalization now restores canonical top-level parent pointers after session teardown, so shared source nodes are no longer left pointing at transient configured-import `Rules` clones.
12. `DeclarationRegistry.find()` now falls through to canonical declarations when a session overlay does not depend on the active `changedVars` set.
13. `src/tree/__tests__/import-style.test.ts` includes coverage showing why a shallow compose wrapper remains intentional: repeated compose imports can require different visibility behavior at different import sites.
14. The current fundamentals slice in the working tree is deliberately bottom-up:
    - `Declaration` now routes active eval/serialization field reads through session-aware accessors and only patches canonical nodes when the current object is the canonical source
    - `Ruleset` now does the same for `selector`, `rules`, and `guard` on its active eval/render paths
    - `serialize-helper.ts` now respects a session-patched `rules` body for `Ruleset` serialization when `PrintOptions.context` is present
    - focused verification is green: `src/__tests__/eval-session.test.ts`, `src/tree/__tests__/dependency-graph.test.ts`, and `src/tree/__tests__/import-style.test.ts`
15. Follow-up on that bottom-up slice is now in the working tree:
    - nested selector ancestry on active `Ruleset` / extend render paths reads through `sessionGetParent()`, so clone-session descendants no longer recompute against stale canonical parents
    - `StyleImport.getFinalRules()` materializes raw `.parent` links only for cloned descendants in the returned import tree, so import output survives session teardown without mutating canonical shared nodes
    - mixin guard wrapper scopes (`outerRules`) now materialize their local param/`@arguments` bindings directly, so fresh guard-probe sessions still resolve bound params
    - focused verification is green: `src/tree/__tests__/extend-import-style.test.ts`, `src/tree/__tests__/import-style.test.ts`, `src/tree/__tests__/mixin.test.ts`, `src/tree/__tests__/rules.test.ts`, `src/__tests__/eval-session.test.ts`, `src/tree/__tests__/dependency-graph.test.ts`, `src/tree/__tests__/control.test.ts`, `src/tree/__tests__/declaration.test.ts`, and `src/tree/__tests__/call.test.ts`
16. The current working slice continued the same bottom-up approach instead of jumping to `Rules` replacement:
    - session-aware render reads now cover lower-order selector/value wrappers and containers: `PseudoSelector`, `SelectorList`, `ComplexSelector`, `CompoundSelector`, `Expression`, `Paren`, `Quoted`, `Url`, `SelectorCapture`, `List`, `Sequence`, `QueryCondition`, `Condition`, `Func`, and `Range`
    - this specifically avoided the bad leaf-selector experiment where overriding `BasicSelector` / `Combinator` `toTrimmedString()` broke the writer contract; those changes were reverted
    - broad focused verification is green: `src/__tests__/eval-session.test.ts`, `src/tree/__tests__/extend-import-style.test.ts`, `src/tree/__tests__/import-style.test.ts`, `src/tree/__tests__/rules.test.ts`, `src/tree/__tests__/dependency-graph.test.ts`, `src/tree/__tests__/mixin.test.ts`, `src/tree/__tests__/control.test.ts`, `src/tree/__tests__/declaration.test.ts`, `src/tree/__tests__/call.test.ts`, `src/tree/__tests__/condition.test.ts`, `src/tree/__tests__/list.test.ts`, `src/tree/__tests__/sequence.test.ts`, `src/tree/__tests__/func.test.ts`, and `src/tree/__tests__/at-rule.test.ts` (`230 passed, 9 skipped`)
17. The next logical target after this slice is still below `Rules`:
    - either remaining low-order render/eval readers like `Reference` / `Interpolated` / `ImportJs`, or
    - true generic session-local replacement semantics (`sessionReplaceNode()` + `Rules.value[]` overlay), if the next reduction needs structural writes instead of just field reads

---

## Pre-Stage-21 Threshold

Do not begin Stage 21 until all four conditions are true:

1. All cloning that this refactor intends to remove is actually removed.
2. All eval-time writes, mutations, and node replacements that are in scope for this refactor route through sessions.
3. Tests pass to the accepted baseline with (1) and (2) true.
4. A merge back to `dev` is credible without changing existing behavior.

### Why this is the right next step

1. Inventory and classify all remaining `clone()` / `copy()` sites still on the critical eval/import/extend path.
2. Finish routing remaining eval-time writes / node replacement paths through session helpers.
3. Re-run the baseline and verify that the no-regression claim still holds under the stricter threshold.
4. Only after that, reassess readiness for Stage 21.

### Key files to read first
- `packages/core/src/tree/util/extend-roots.ts` — `applyInstructionToRuleset` (~line 495)
  - Look for: `ruleset.setData('selector', ...)` and `selectorBeforeExtend` copy
- `packages/core/src/tree/ruleset.ts` — `getEffectiveSelector()`, `_extendedSelector` field
- `packages/core/src/tree/util/extend-core.ts` — the ~14 `copy(true)` calls here are
  mutation-safety copies for selector assembly; become eliminable once selector is immutable
- `packages/core/src/tree/util/selector-utils.ts` — same, ~14 `copy(true)` calls

### Stage 17 checklist (from PROGRESS.md)
- [ ] `extend-roots.ts` `applyInstructionToRuleset`: stop `setData('selector', ...)` — write `_extendedSelector` only
- [ ] `extend-roots.ts`: remove `selectorBeforeExtend` save/restore (`copy(true)` at line ~515)
- [ ] Verify all callers use `getEffectiveSelector()` / `_extendedSelector ?? selector`, not raw `.selector`
- [ ] New file `selector-builders.ts` with structural-sharing helpers:
  - `appendSelectorAlternative(target, added)` — new SelectorList container, reuse existing items
  - `rewriteCompound(compound, mapper)` — new CompoundSelector if any item changes
  - `rewriteSelectorPath(root, path, replacement)` — path-copy from root to changed item
- [ ] `extend-core.ts`: replace mutation-safety `copy(true)` calls with path-copy builders
- [ ] `selector-utils.ts`: same
- [ ] `ruleset.ts:544`: `selector.clone(true)` for sourceNode storage — reference canonical instead
- [ ] `ampersand.ts:228`: evaluate necessity of `selector.clone(true)`
- [ ] Tests green after each change: `cd packages/core && pnpm test extend` (fast); full suite before commit
- [ ] Target: `copy(true)` count in extend paths ≤ 5

### After Stage 17: proceed to Stage 18 (Dependency Graph Infrastructure)
See `dependency-graph.md` Stage 18 section for the full checklist.

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
  └─ registryDeltas: WeakMap<Node[], SessionRegistryDelta>  ← Stage 20
```

Session helpers (`session-helpers.ts`) provide the read/write surface:
- `sessionGetField` / `sessionPatchField`
- `sessionIsEvaluated` / `sessionSetEvaluated`
- `sessionIsPreEvaluated` / `sessionSetPreEvaluated`
- `sessionGetParent` / `sessionSetParent`
- etc.

When no session is active, every helper falls through to the direct field — zero cost,
zero behavior change for non-session code paths.

### The `_extendedSelector` pattern (current state going into Stage 17)

`Ruleset` has:
- `selector`: the original authored selector (canonical, should be immutable)
- `_extendedSelector`: the extend-patched selector (set only during extend, session-local eventually)
- `getEffectiveSelector()`: returns `_extendedSelector ?? selector`

The extend path currently writes to BOTH `_extendedSelector` and `selector` (via `setData`).
Stage 17 removes the `setData` write. After Stage 17, `selector` is truly immutable and safe
to share across shallow clones.

### Registry structure (current, going into Stage 19)

```
Rules instance
  ├─ rulesetRegistry: RulesetRegistry
  ├─ mixinRegistry: MixinRegistry
  ├─ declarationRegistry: DeclarationRegistry
  └─ functionRegistry: FunctionRegistry
```

Each registry is built lazily from `rules.value[]` on first access. Clone resets
`rulesIndexed = 0`, forcing full rebuild on the clone. Stage 19 moves the first three
to a `WeakMap<Node[], RegistryData>` keyed by array reference — COW clones share for free.

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
# Fast extend-only run (during Stage 17 work)
cd packages/core && pnpm test extend

# Full core suite (before commits)
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
