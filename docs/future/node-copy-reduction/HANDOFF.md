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

---

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
- Current actual stage: fundamentals-completion gate
  - focus: make immutable canonical nodes + session-backed eval writes/replacements true end-to-end
  - order: lower-order node fields first (`Declaration`, `Ruleset`), then more compositional containers
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

## What was just done

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
18. That next low-order render-read slice is now also in the working tree:
    - `Reference`, `Interpolated`, and `JsImport` now read session-patched fields during serialization
    - focused verification is green: `src/__tests__/eval-session.test.ts`, `src/tree/__tests__/reference.test.ts`, `src/tree/__tests__/import-style.test.ts`, `src/tree/__tests__/mixin.test.ts`, `src/tree/__tests__/call.test.ts`, and `src/tree/__tests__/at-rule.test.ts` (`173 passed, 1 skipped`)
    - this still does not solve structural session replacement; it only widens the lower-order immutable/read-side coverage
19. The first structural session-replacement foundation is now in the working tree:
    - `EvalSession` has a session-local child-array overlay for `Rules`
    - `sessionGetChildren()`, `sessionAppendChildren()`, `sessionPrependChildren()`, `sessionRemoveChild()`, and `sessionReplaceNode()` now use that overlay instead of mutating canonical `Rules.value[]` when a session exists
    - runtime overlay semantics were tightened so `parent: undefined` and `sourceParent: undefined` are representable as explicit session-local clears, not mistaken for “no override”
    - focused verification is green: `src/__tests__/eval-session.test.ts`, `src/tree/__tests__/rules.test.ts`, `src/tree/__tests__/import-style.test.ts`, and `src/tree/__tests__/mixin.test.ts` (`173 passed, 9 skipped`)
    - this is still foundational only: `Rules.ts` call sites are not broadly routed through the new child-overlay helpers yet
20. The first production consumer of that child overlay is now in the working tree:
    - `Rules` render-side reads (`_emitRulesBody()`, `flatRules()`, and `visibleRules()`) now consult the session-local child overlay when a `Context` is present
    - `src/__tests__/eval-session.test.ts` now proves `Rules.toTrimmedString({ context })` sees overlay replacements/appends while canonical output stays unchanged
    - focused verification is green: `src/__tests__/eval-session.test.ts`, `src/tree/__tests__/rules.test.ts`, `src/tree/__tests__/import-style.test.ts`, and `src/tree/__tests__/mixin.test.ts` (`174 passed, 9 skipped`)
    - eval/preEval/indexing/registry loops still read `rules.value` directly, so structural session replacement is only partially integrated so far

---

## Pre-Stage-21 Threshold

Do not begin Stage 21 until all four conditions are true:

1. All cloning that this refactor intends to remove is actually removed.
2. All eval-time writes, mutations, and node replacements that are in scope for this refactor route through sessions.
3. Tests pass to the accepted baseline with (1) and (2) true.
4. A merge back to `dev` is credible without changing existing behavior.

### Immediate work

1. Inventory and classify all remaining `clone()` / `copy()` sites still on the critical eval/import/extend path.
2. Finish routing remaining eval-time writes / node replacement paths through session helpers.
3. Re-run the baseline and verify that the no-regression claim still holds under the stricter threshold.
4. Only after that, reassess readiness for Stage 21.

### Known blockers from recent reduction attempts

1. Child-array isolation and session-local replacement are now partially implemented and partially consumed.
   The registry-delta keying problem is fixed, `EvalSession` now has a child-array overlay for `Rules`, and render-side `Rules` reads use it, but most eval/preEval/indexing/registry call sites still read/write `rules.value` directly instead of routing through the helper layer.

2. Remaining high-signal clone/copy pressure is still concentrated in:
   - `packages/core/src/tree/rules.ts` — mixin arg binding and output shaping
   - `packages/core/src/tree/extend.ts`
   - `packages/core/src/tree/ruleset.ts`
   - `packages/core/src/tree/ampersand.ts`

3. `sessionReplaceNode()` is no longer a stub, but its semantics are only helper-local so far.
   Generic eval-time node replacement is still not fully sessionized until active production paths use those helpers.

4. Low-order field/read coverage is no longer the immediate weak point.
   The recent work proved that a lot of wrapper/container rendering can move to session-backed reads safely.
   The harder remaining work is structural replacement and session-local child overlays, not another round of speculative selector-leaf overrides.
5. A small sessionization cleanup landed after that blocker was identified:
   - `declaration.ts`, `ruleset.ts`, and preserve-mode fallback in `operation.ts` no longer rely on direct canonical `.evaluated` writes in their active eval paths
   - `src/__tests__/eval-session.test.ts` now proves preserve-mode operation fallback does not mark the canonical operation tree evaluated when a session is active

6. New characterization now proves session registry deltas survive a shallow clone swapping to a new `value[]`.
   That specific `Rules.value` / session-registry blocker should be treated as resolved.

7. One more previously fuzzy boundary is now clearer:
   - ephemeral wrapper scopes created during mixin guard evaluation should be materialized directly
   - returned import trees can materialize clone-only parent links after session teardown
   - but generic session-local node replacement for `Rules.value[]` is still unresolved and should not be papered over with global `adopt()` behavior changes

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
