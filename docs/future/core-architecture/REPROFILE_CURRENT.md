# REPROFILE_CURRENT — where the time actually goes on dev (post Phase A/B)

**Branch:** `work/reprofile-current` off dev tip `4b4412bfe`.
**Method:** `node --cpu-prof` (self-time, sampled) + `JESS_PROFILE=1` (wall-time phase split) on
4 workloads. Read-only; no core changes.

> **Environment caveat (READ FIRST):** this machine was under heavy load (load-avg ~13 on 14 cores)
> and the runtime build is in the known **~14× slow** artifact regime (a single collapse render is
> ~3100ms vs the ~215ms historical baseline). **Absolute ms are NOT comparable to old baselines and
> are NOT reported as wins/regressions.** Every conclusion below is drawn from **relative self-time %**
> and **relative phase share**, both of which are robust to a uniform slowdown. The *shape* of the
> profile — which functions dominate — is what matters, and it is unambiguous.

---

## TL;DR verdict

**The hotspot has MOVED. Phase D's targets (eval / registration / copy / reuse-gates / flag-walk) no
longer dominate any workload — most are <0.5% self-time.** The overwhelming current cost is a
**serialize-side O(nodes × comments) quadratic** in the comment/trivia round-trip machinery
(`commentRunsWithinSpan` + its `entries` generator), which alone is **~70% of self-time on the two
synthetic benches and still the #1 single function (23%) on the extend-heavy real-world file.** The
second real hotspot, visible only on extend-heavy input, is the **extend selector-matching engine**
(`extendSelector`/`applyExtendsToSelector`/`wouldMatchNode`/`processExtends` ~25%).

**Recommendation: do NOT start Phase D as scoped. Redirect first to the comment-scan quadratic (days,
not weeks, and it is pure serialize plumbing with no eval/render-fold coupling). Then re-profile.**
Phase D attacks a region that is currently ~1–3% of self-time; it cannot pay for a multi-week,
high-regression-risk rework on this evidence.

---

## 1. Per-workload results

### Phase split (JESS_PROFILE wall-time, warm render, single iteration)

| workload | getTree (parse) | eval | render (serialize) | render share |
|---|--:|--:|--:|--:|
| **collapse** (1500 nested static blocks, `collapseNesting:true`) | 133.7ms | 71.0ms | **3098.6ms** | **93.9%** |
| **dynamic** (1200 mixin/ref/operation blocks) | 112.3ms | 134.2ms | **1020.6ms** | **80.3%** |
| **realworld** (300 mixin+guard+`:extend`+op+color+media components, w/ comments) | 99.3ms | **703.4ms** | 427.3ms | 34.7% |

- On the two **output-shaped** workloads, render/serialize is **80–94%** of wall time.
- On the **extend-shaped** realworld file, the work shifts into **eval (57%)** — because
  `processExtends`/extend selector matching runs in the eval phase — but serialize is still ~35%.

### Top self-time functions (CPU profile, self-time %)

**collapse** (total sampled ~35.2s / 8 renders):

| % | function | location |
|--:|---|---|
| **54.0%** | `entries` (trivia generator, filters hidden runs) | `jess/…:2925` |
| **21.6%** | `commentRunsWithinSpan` (full-map comment scan per node) | `core/…:842` |
| 3.9% | `(program)` | — |
| 3.9% | `(garbage collector)` | — |
| 3.8% | `_emitNameBoundaryComment` (calls `commentRunsWithinSpan`) | `core/…:26599` |
| 1.0% | `writeDeclarationValueSyntax` | `core/…:26888` |
| 0.6% | `writeSyntax` | `core/…:3091` |
| 0.3% | `_r_value` (parser) | `less-parser/…` |
| ~0.2% each | `renderRulesBody`, `refreshPositions` (0.16%), `composeHeaderSelector`, `isNode`, parser `_r_*` | — |

→ **~79% of collapse self-time is the comment-scan pair** (`entries` + `commentRunsWithinSpan`),
plus a further 3.8% in `_emitNameBoundaryComment` which drives it. Everything else is noise.

**dynamic** (total sampled ~14.3s / 8 renders):

| % | function | location |
|--:|---|---|
| **48.5%** | `entries` (trivia generator) | `jess/…:2925` |
| **20.1%** | `commentRunsWithinSpan` | `core/…:842` |
| 4.3% | `(program)` | — |
| 3.8% | `(garbage collector)` | — |
| 0.9% | `_r_value` (parser) | `less-parser/…` |
| 0.4% | `inherit` | `core/…:1843` |
| 0.3% | `_r_topProduct`, `callWithContext`, `_r_blockItem`, lodash `_createRound` (color math) | — |
| 0.2% | `writeDeclarationValueSyntax`, `evalStatic`, `clone`, `evaluateRest`, `_r_Call` | — |

→ Even the **eval-heavy** workload is **~69% comment-scan**. Actual eval work (`inherit`,
`evalStatic`, `clone`, `callWithContext`, color fns) is scattered sub-1% each.

**realworld** (extend-heavy; total sampled ~13.1s / 8 renders):

| % | function | location | bucket |
|--:|---|---|---|
| **23.2%** | `entries` (trivia generator) | `jess/…:2925` | serialize (comments) |
| 5.8% | `extendSelector` | `core/…:15988` | extend |
| 5.6% | `(garbage collector)` | — | gc |
| 4.6% | `applyExtendsToSelector` | `core/…:15414` | extend |
| 3.3% | `setValueSpans` | `core/…:138` | node/prov |
| 2.9% | `wouldMatchNode` | `core/…:15170` | extend |
| 2.9% | `processExtends` | `core/…:17958` | extend |
| 2.1% | `Selector` (ctor) | `core/…:2074` | build |
| 2.1% | `isNode` | `core/…:2036` | dispatch |
| 1.7% | `isWholeNodeMatch` | `core/…:14619` | extend |
| 1.6% + 1.4% | `inherit` (×2 sites) | `core/…:2101 / …:1843` | eval/build |
| 1.5% each | `collectSelectorSubtreeValues`, `classifyInstructionMatch` | extend |
| 0.7% each | `findChainedExtendsWithSkips`, `adopt`, `_r_value` | extend / build / parse |

→ Comment-scan is still the **single biggest function (23%)**, but the **extend engine cluster**
(`extendSelector` + `applyExtendsToSelector` + `wouldMatchNode` + `processExtends` +
`isWholeNodeMatch` + `classifyInstructionMatch` + `collectSelectorSubtreeValues` +
`findChainedExtendsWithSkips` + `classifyExtendMatch`) sums to **~25%** and is the dominant *phase*
on this shape. `inherit` (both sites) ≈ 3%, the largest any Phase-D-adjacent function reaches.

### bootstrap4 (real large Less) — did NOT compile on jess

Full `bootstrap.less` (~7500 lines via `bootstrap-less-port`) **cannot compile on jess today**: its
`_functions.less` is built entirely from Less `@plugin "plugins/…"` JS files (`color-yiq`, `map-get`,
`theme-color`, `gray`, etc.), and jess reports
`Feature not supported. Install @jesscss/plugin-js to enable Less @plugin script execution.`
This is a missing-plugin gap, **not** a jess compile bug — it fails at the `@plugin` at-rule during
before-eval, before any meaningful render work. `@jesscss/plugin-js` is not installed in this tree, so
the bootstrap workload was replaced (per the fallback plan) with the **hand-written real-world file**
above: 300 components exercising variables, guarded mixins, `:extend`, arithmetic, color functions
(`darken`/`lighten`/`mix`/`spin`/`contrast`), nested media queries, and comments — the same feature
mix as bootstrap, and specifically comment-bearing so the round-trip path is exercised.

---

## 2. Where the time goes NOW vs the last profile

The prior profile (captured in `CORE-CLEANUP.md`, pre Phase A/B) found:

- **Collapse was writer/serialize-dominated** — `refreshPositions` was the #1 win (`W2`, collapse
  1006→~290ms), OutputWriter + trims >70% incl. GC. **Still serialize-dominated — but the cost moved
  OFF `refreshPositions` (now 0.16%) and ONTO the comment-scan pair.** The W2 incremental-position win
  held; a *new* serialize quadratic (comment round-tripping) took its place as the dominant cost. This
  is consistent with the recent git history on this line of work
  (`perf(core): drop per-sub-component span arrays; comments via node-span scan` — c3c8238f7 /
  468747cc7): dropping the per-sub-component span arrays moved comment placement to a **per-node full
  span scan**, which is the quadratic now measured.
- **Dynamic eval's old #1/#2 were `createRulesLikeReferenceSurface` (~921ms) and `ensureProv`
  (~711ms).** Both are **gone from the top** — `createRulesLikeReferenceSurface` is 0.09–0.11%,
  `ensureProv` doesn't appear (the provenance-inline work eliminated the WeakMap). Those wins landed.
  **But dynamic is no longer eval-bound at all** — it too is ~69% comment-scan.
- **Parse was ~42% of the "static" bimodal profile.** Parse is now a **flat 6–7%** (`getTree`
  99–134ms across workloads; `_r_*` parser frames all sub-1% self-time). Parse is no longer a headline.
- **GC** sits at ~4–6% across all workloads — real but secondary; highest on the extend-heavy file.

**Net movement:** the old eval hotspots (`createRulesLikeReferenceSurface`, `ensureProv`) and the old
parse share are gone/shrunk — the earlier perf drive worked. A **new serialize quadratic**
(comment/trivia span-scan) is now the singular dominant cost, and the **extend matcher** is the
second hotspot on extend-heavy input. Neither is a Phase-D target.

---

## 3. Where the Phase-D-relevant functions rank NOW

Self-time %, worst (largest) showing across the three compiling workloads:

| Phase-D target | best-case self-time | verdict |
|---|--:|---|
| `eval` / `evalNode` | 0.02–0.40% | negligible |
| `_prepareForEval` / `_prepareRegistration` / registration | ≤0.05% | negligible |
| `cloneForPlacement` | ≤0.29% | negligible |
| `clone` | ≤0.49% | negligible |
| `canReuseAsLeaf` / `reuseAsLeaf` (reuse gates) | ≤0.01% | negligible |
| `propagateFlagsFrom` (the flag walk being deleted) | ≤0.42% | negligible |
| `findMixin*` (lookup) | ≤0.02% | negligible |
| `adopt` / `setParent` | ≤0.70% | small |
| `inherit` | **≤3.04%** | small (only on extend-heavy; two sites combined) |
| `refreshPositions` (old #1 serialize win) | ≤0.16% | already won, negligible |
| `createRulesLikeReferenceSurface` (old eval #1) | ≤0.11% | already won, negligible |

**The entire Phase-D target surface — eval fold, registration, copy/clone, reuse gates, the flag walk
— is collectively a low-single-digit % of self-time.** `propagateFlagsFrom`, the walk Phase D exists
to delete, is **≤0.42%**. Deleting it, even perfectly, saves <0.5%. The reuse gates it feeds are
≤0.01%. This is the crux: *the machinery Phase D removes is not where the time is.*

`inherit` (≤3%) is the only Phase-D-adjacent function with a pulse, and it shows up **only** on the
extend-heavy workload — where it is dwarfed by the extend matcher (~25%) and the comment scan (23%)
around it. Folding eval into render would not touch the extend matcher's cost.

---

## 4. Top 3 highest-value optimization targets (on current evidence)

1. **Kill the comment-scan quadratic — `commentRunsWithinSpan` / `entries`.** *~70% of self-time on
   collapse & dynamic, 23% (still #1 fn) on realworld.* Every serialized selector/compound/pseudo/
   declaration/at-rule node calls `commentRunsWithinSpan`, which does `trivia.entries("after")` — a
   **full scan of the whole file's comment/trivia map** — then filters by the node's `[spanStart,
   spanEnd]`. That is **O(nodes × total_comments)**. Fix is standard and self-contained to the
   serialize/trivia layer (no eval/render-fold coupling): index comment runs by offset once (sorted
   array + binary search, or an interval index), or thread a forward cursor through the walk so each
   run is visited once. **Highest value by far, lowest risk, days of work.** Callers:
   `trivia.ts` `commentRunsWithinSpan`; used from `selector-complex.ts:155`, `selector-compound.ts:167`,
   `selector-pseudo.ts:135`, `declaration.ts:603`, `at-rule.ts:219`, and `_emitNameBoundaryComment`.

2. **The extend selector-matching engine** (`extendSelector`, `applyExtendsToSelector`,
   `wouldMatchNode`, `processExtends`, `isWholeNodeMatch`, `classifyInstructionMatch`,
   `collectSelectorSubtreeValues`, `findChainedExtendsWithSkips`). *~25% on extend-heavy input; ~0 on
   the others.* This is the real eval-phase hotspot on realistic (Bootstrap-like) stylesheets that use
   `:extend`. Worth a targeted look at the match loop's complexity (it has the shape of an
   all-selectors × all-extends scan). Value is workload-dependent but high for real-world Less.

3. **GC / allocation pressure** (~4–6% across workloads, highest on extend). Secondary, but the extend
   path (`Selector` ctor 2.1%, `setValueSpans` 3.3%, `inherit`/`adopt`/`clone` in aggregate) suggests
   selector materialization churn during extend. Lower priority than #1/#2; revisit after they land.

---

## 5. Honest recommendation

**Redirect. Do not begin Phase D as currently scoped.**

Phase D (fold eval into the render walk, delete copies, delete `propagateFlagsFrom`) is a multi-week,
high-regression-risk rework touching serialize/sourcemap/extend/eval. Its entire target surface is
**low-single-digit % of current self-time**, and the specific walk it deletes (`propagateFlagsFrom`)
is **≤0.42%**. The evidence does not justify that investment right now — the earlier perf drive already
harvested the eval hotspots Phase D was implicitly aimed at (`createRulesLikeReferenceSurface`,
`ensureProv` are gone), so eval is now cheap and the copies are already shallow (per
`FLAG-WALK-DELETION.md` STEP 0: deep value-tree copies are already zero).

Concretely:

1. **First**, fix the comment-scan quadratic (target #1). It is the single dominant cost on 2 of 3
   workloads and the #1 function on the third, it is isolated to the trivia/serialize layer, and it is
   the classic "found only by profiling, missed by the walk-plan" win — the same category as the W2
   `refreshPositions` win that dominated the last round. Expect it to move collapse/dynamic
   dramatically.
2. **Then** re-profile. With comments no longer swamping the profile, the true post-fix ranking on
   real Less will surface the extend matcher (target #2) as the leading eval-phase cost.
3. **Only then** re-evaluate Phase D. If, after #1 and #2, `propagateFlagsFrom` / copy / reuse-gate
   costs are *still* sub-1% (they will be — the fixes above don't touch them), Phase D should be
   **re-scoped or shelved** as a correctness/architecture-cleanup project rather than sold as a perf
   win. The flag-walk deletion may still be worth doing for code-health reasons (it deletes real
   complexity), but it should not be justified on performance grounds — the numbers don't support it.

The `FLAG-WALK-DELETION.md` "ENDGAME VERDICT" already reached a compatible conclusion from the
architecture side (the reuse gates hang on a dynamic-leaf-share rework that is "multi-week,
high-regression-risk"). This profile adds the missing quantitative half: **that rework's target is
also not where the time is.** Bank Phase A+B, take the comment-scan and extend wins, and revisit the
flag-walk deletion as cleanup — not as the next perf lever.
