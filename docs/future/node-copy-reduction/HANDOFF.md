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

---

## Current state

### Branch: `jess-dev`
### Last committed stage boundary before the Stage 20 completion slice: `3b4d089e` — `refactor(core): add session-local registry deltas`

### Stage status
- Stage 17: complete and committed
- Stage 18: complete and committed
- Stage 19: complete and committed
- Stage 20: complete in the working tree
  - done: session-local registry deltas, session-aware register/find plumbing, scope-dirty invalidation, dependency-aware partial re-eval in declaration lookup, detached-ruleset unlock off `clone(true)`, and Stage 20 characterization coverage
  - note: plain `@import` no longer adds a finalization wrapper; compose still keeps a shallow per-import wrapper because separate import sites can require different visibility / reference metadata on the same cached module
- Stage 21: not started

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

## What was just done

1. Stage 17 made selectors effectively immutable in extend paths by routing extend output through `_extendedSelector`.
2. Stage 18 added the session-local dependency graph (`dependsOn`, `sourceExpr`) and propagation through reference/expression/operation/call/declaration paths.
3. Stage 19 moved canonical ruleset, mixin, and declaration registries into a `WeakMap<Node[], RegistryData>` keyed by `Rules.value`.
4. Stage 20 completed the session-local registry delta layer, dependency-aware declaration lookup, detached-ruleset unlock via shallow session-safe clone, and the remaining import finalization reductions.
5. Session-aware `Rules.unshift(ctx, ...)` / `Rules.splice(ctx, ...)` coverage now proves shared canonical nodes can be inserted into session-scoped wrappers without overwriting canonical `.parent` pointers.
6. `src/tree/__tests__/import-style.test.ts` had two failures at committed boundary `3b4d089e`:
   - `forwarded members are not visible locally, but are visible downstream`
   - `two sequential "with" imports do not corrupt canonical node parent pointers`
   Both are now green on the working tree.
7. `src/tree/__tests__/registry-characterization.test.ts` now proves four Stage 20 properties in isolation:
   - cached compose imports reuse the same canonical WeakMap-backed registry slot
   - session-only declaration registrations stay in `EvalSession.registryDeltas` instead of polluting the canonical cache
   - repeated `_dedupe` imports reuse the same canonical registry slot
   - mixin expansion parameter vars stay in session delta only
8. `packages/core/src/tree/import-style.ts` no longer clones child `Ruleset`s for plain `multiple:true` imports.
   The child-clone path is now kept only for implicit reference / `_dedupe` imports, because
   removing it there regressed `extend-import-style` (`implicit reference mode (_dedupe) remains externally extendable`).
9. `packages/core/src/tree/import-style.ts` also no longer adds a second shallow `Rules` wrapper for plain `@import` finalization.
   `src/tree/__tests__/registry-characterization.test.ts` now proves that plain imports reuse the evaluated root and that `_dedupe` detaches the shared child array before cloning per-import `Ruleset`s.
10. Configured `with` compose finalization now restores canonical top-level parent pointers after session teardown, so shared source nodes are no longer left pointing at transient configured-import `Rules` clones.
11. `DeclarationRegistry.find()` now falls through to canonical declarations when a session overlay does not depend on the active `changedVars` set.
12. `src/tree/__tests__/import-style.test.ts` includes coverage showing why a shallow compose wrapper remains intentional: repeated compose imports can require different visibility behavior at different import sites.

---

## Next task: Stage 21 Start

**Goal**: begin the Live Patch API slice now that Stage 20 is complete.

### Immediate work

1. Build the `PatchSideTable` on `Context` and thread it through the serializer surface.
2. Use the Stage 18 dependency graph to decide when declaration output should emit `var(--jess-<id>, fallback)`.
3. Keep Stage 20’s import/registry invariants intact while adding the Stage 21 emission path.

### Key files to read first
- `packages/core/src/tree/import-style.ts`
- `packages/core/src/tree/rules.ts`
- `packages/core/src/tree/util/registry-utils.ts`
- `packages/core/src/eval-session.ts`
- `packages/core/src/tree/util/session-helpers.ts`
- `docs/future/node-copy-reduction/dependency-graph.md`
- `docs/future/node-copy-reduction/PROGRESS.md`

---

## Non-negotiable rules

1. **Never use `as any`**. Use proper type guards, type assertions, or fix the type definition.
2. **Run tests after every meaningful change**: `cd packages/core && pnpm test`. Baseline is 5 failed / 63 passed.
3. **Do not fix pre-existing failures** unless asked. Only your changes should affect the count.
4. **Commit after each successful stage** (or sub-stage). If tests break, fix before committing.
5. **One stage at a time**. Stage 20 is the committed prerequisite; do not mix unrelated Stage 21 experiments into the completion commit.
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
- Do not reopen Stage 20 unless a Stage 21 change proves one of these invariants was wrong.
