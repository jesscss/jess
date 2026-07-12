# REPROFILE_POST_EXTEND — where the time goes after the extend-visibility fix

**Branch:** `work/reprofile-post-extend` off dev tip `fb55d98eb`
(`perf(core): memoize extend-visibility walk (isSameOrDescendantRoot)`).
**Method:** `node --cpu-prof` (self-time, sampled) + `JESS_PROFILE=1` (wall-time phase split) on the
**same three workloads** as `REPROFILE_CURRENT.md` / `REPROFILE_POST_COMMENTSCAN.md`:
`collapse-bench` (collapse mode, 1500 nested-static blocks), `dynamic-bench` (1200 mixin/ref/operation
blocks), and a **multi-root** extend/mixin/guard/`:extend`/color/comment real-Less sheet (300
components, each in its own `@import`'d file → distinct extend-root, the shape required to surface the
extend cost). Read-only; no core-logic changes. Only this report is committed.

> **Environment caveat (READ FIRST):** this is a fresh `pnpm -r` build, in the known slow-artifact
> regime, on a loaded machine. **Absolute ms are NOT comparable to historical baselines.** Every
> conclusion below is drawn from **relative self-time %** and **relative phase share**, both robust to a
> uniform slowdown. Scaling ratios (per-component cost vs n) are also uniform-slowdown-invariant and
> are used to establish the complexity class of the new #1.

---

## TL;DR verdict

1. **Both previously-fixed hotspots are CONFIRMED GONE.**
   - `isSameOrDescendantRoot` (was **76%** self-time on real Less in `POST_COMMENTSCAN`): **0.000%** —
     absent from the top-500 on every workload. The memoization landed.
   - `commentRunsWithinSpan` (was 20–22%, then 0.02%): **0.001%** collapse, absent elsewhere.
     `entries` (the trivia generator, was 48–54%): **absent**. Comment-scan quadratic stays dead.

2. **collapse & dynamic are unchanged in character: flat, broad, GC-led.** No single function
   dominates. The largest line on both is the garbage collector (**13.2%** collapse, **9.7%** dynamic);
   everything else is a long tail of parser `_r_*` frames and node-build/eval machinery in the 1–4%
   band. Phase split is ~43/57 (collapse) and ~50/50 (dynamic) parse-vs-render. No algorithmic hotspot.

3. **On real multi-root Less there is a NEW, singular #1 — and it MOVED down a layer, exactly as
   `REPROFILE_CURRENT` predicted.** The extend cost is no longer in the *visibility gate*
   (`isSameOrDescendantRoot`); it is now in the **chained-extend discovery + selector matcher**:
   `findChainedExtendsWithSkips` **29.1%**, `wouldMatchNode` **22.1%**, `wouldExtendChange` **13.1%**,
   `isWholeNodeMatch` **12.0%**, `findChainedExtends` **6.3%**, plus `isNode` **10.0%** (dispatch inside
   the matcher). **This cluster is ~92% of self-time.** It is **quadratic in the number of extend
   instructions** (per-component cost 13.4 → 50.9 → 106.0 ms at n=100/200/300 → total ~O(n²)). **This is
   the next target.**

---

## 1. Per-workload results

### Phase split (`JESS_PROFILE=1`, warm render, single iteration)

| workload | getTree (parse) | render (serialize + extend) | render share | total |
|---|--:|--:|--:|--:|
| **collapse** (1500 nested static, `collapseNesting:true`) | 132.0ms | 174.9ms | **57.0%** | 307ms |
| **dynamic** (1200 mixin/ref/operation) | 187.7ms | 183.5ms | **49.4%** | 371ms |
| **realworld** (300 multi-root extend/mixin/guard/color/comment) | 3.1ms | **30226.9ms** | **99.99%** | 30230ms |

- collapse & dynamic are ~50/50 parse/render — same balance as `POST_COMMENTSCAN`. Serialize/trivia is
  sub-0.1%.
- **realworld getTree is only 3.1ms** because the `@import`'d component files are parse-cached across
  the warm renders; the entire measured cost is `processExtends` **inside the render phase**. The
  30.2s "render" is ~100% extend engine, ~0% serialize.

### Top self-time functions (CPU profile)

**collapse** (3,987 samples / 12 renders):

| % | function | location |
|--:|---|---|
| **13.22%** | `(garbage collector)` | — |
| 2.28% | `_r_value` (parser) | less-parser:12712 |
| 2.18% | `setFieldSpans` | core:118 |
| 1.76% | `isNode` | core:2071 |
| 1.58% | `_r_blockItem` (parser) | less-parser:33233 |
| 1.53% | `_r_ComplexSelector` (parser) | less-parser:9940 |
| 1.43% | `_r_simpleSelector` / `_r_LessAmpersand` | less-parser |
| 1.33% | `_r_CompoundSelector` / `_r_PseudoSelector` / `Selector` ctor | less-parser / core:2109 |
| 1.23% | `_r_Declaration` / `renderRulesBody` | less-parser / core:7173 |
| 1.10% | `refreshPositions` | core:566 |

→ **No dominant function.** GC leads at 13%; the rest is a flat tail split between parser `_r_*` and
node-build (`setFieldSpans`, `Selector`, `isNode`, `refreshPositions`). `commentRunsWithinSpan` 0.05%,
`entries` absent.

**dynamic** (3,510 samples / 12 renders):

| % | function | location |
|--:|---|---|
| **9.74%** | `(garbage collector)` | — |
| 4.10% | `_r_value` (parser) | less-parser:12712 |
| 3.30% | `(program)` | — |
| 2.62% | `inherit` | core:1878 |
| 1.65% | `evalStatic` | core:1847 |
| 1.57% | `_r_topProduct` (arithmetic) | less-parser:45918 |
| 1.51% | `setFieldSpans` | core:118 |
| 1.31% | `_r_topSum` (arithmetic) | less-parser:46122 |
| 1.25% | `renderRulesBody` | core:7173 |
| 1.20% | `isNode` | core:2071 |
| 1.00% | `setValueSpans` | core:139 |
| 0.88% | `callWithContext` / `clone` / `createRulesLikeReferenceSurface` | core |

→ Again **flat**. GC leads (9.7%), then parse (`_r_value`, arithmetic productions) and real eval work
(`inherit`, `evalStatic`, `callWithContext`, `clone`) scattered at 1–2.6% each. Comment-scan absent.

**realworld — multi-root extend** (109,162 samples / 3 renders):

| % | function | location | bucket |
|--:|---|---|---|
| **29.11%** | `findChainedExtendsWithSkips` | extend.ts:4046 | **extend chaining** |
| **22.11%** | `wouldMatchNode` | extend-walk.ts:1156 | **selector match** |
| **13.14%** | `wouldExtendChange` | extend-walk.ts:1122 | **selector match** |
| **12.02%** | `isWholeNodeMatch` | extend-walk.ts:157 | **selector match** |
| 10.02% | `isNode` | core:2071 | dispatch (inside matcher) |
| 6.28% | `findChainedExtends` | extend.ts:3935 | extend chaining |
| 2.58% | `(program)` | — | — |
| 1.01% | `(garbage collector)` | — | gc |
| 0.57% | `extendSelector` | core:16031 | extend apply |
| 0.48% | `applyExtendsToSelector` | core:15457 | extend apply |
| 0.28% | `processExtends` | core:18001 | extend driver |
| 0.09% | `decomposeFind` | extend-walk.ts:14630 | selector match |

→ **`isSameOrDescendantRoot` = 0.000% (gone).** The extend cost moved one layer down, from the
visibility gate into the **chained-extend discovery + the selector matcher it drives**. The chaining
functions (`findChainedExtendsWithSkips` + `findChainedExtends` = 35.4%) and the matcher they call
per-pair (`wouldMatchNode` + `wouldExtendChange` + `isWholeNodeMatch` = 47.3%, plus `isNode` dispatch
10%) together are **~92% of self-time**. Serialize/GC/parse are all <3% combined.

---

## 2. Both prior hotspots: confirmed gone

| function | prior report | now (this run) |
|---|--:|--:|
| `isSameOrDescendantRoot` (extend visibility walk) | **76.3%** (POST_COMMENTSCAN) | **0.000%** (absent) |
| `entries` (trivia generator) | 48–54% (CURRENT) → absent | **absent** |
| `commentRunsWithinSpan` | 20–22% → 0.02% | **0.001%** (collapse); absent elsewhere |
| whole trivia/comment machinery | ~70–79% → <1% | **<0.1%** |

The `fb55d98eb` extend-visibility memoization did exactly what it claimed: the `O(R × I × depth)`
recursive `childrenRoots` descent is eliminated (0% self-time), and its immediate caller — the
`instructions.filter` visibility callback that was another 7.4% — is likewise gone from the top list.
Combined with the earlier comment-scan fix, **both regressions are dead.**

---

## 3. The new top-3 targets

1. **The chained-extend discovery + selector-matcher cluster. ~92% self-time on multi-root Less;
   quadratic in extend-instruction count.**
   In `processExtends`'s per-selector loop (`extend.ts` ~line 376), each time an extend applies the code
   calls `findChainedExtends` / `findChainedExtendsWithSkips` (`extend.ts:3935/4046`) to discover which
   *other* extends now become applicable. That function **re-scans the entire `allExtends` list** and,
   for every `(candidate × otherExtend)` pair, calls `wouldExtendChange` **twice** (lines 4064 & 4068).
   Each `wouldExtendChange` call re-runs `decomposeFind(find)` and a full `wouldMatchNode` selector
   descent from scratch — **no result is cached across the pass.** With I extend instructions processed
   across R roots this is **O(I²)** matcher invocations per root. Measured scaling confirms it:
   per-component render cost is 13.4ms (n=100) → 50.9ms (n=200) → 106.0ms (n=300) — per-component cost
   itself grows ~linearly with n, i.e. **total ≈ O(n²)**. This one cluster is the entire real-world
   extend cost.

2. **Garbage collector / allocation pressure. 13.2% collapse, 9.7% dynamic (the #1 line on both); 1.0%
   realworld.** With no algorithmic hotspot on the synthetic benches, GC is the leading remaining cost.
   The tail feeding it is node/span materialization (`setFieldSpans` 1.5–2.2%, `Selector` ctor,
   `inherit`, `setValueSpans`, `refreshPositions`) plus parser allocation. Broad allocation-reduction
   target, not one hot function.

3. **Parser throughput (`_r_*` productions). Flat 1–4% each, no single hot frame.** `_r_value`
   (2.3–4.1%), selector productions, and dynamic's arithmetic productions (`_r_topProduct`/`_r_topSum`)
   together make parse a co-equal ~50% of wall time on the synthetic benches. Steady-state throughput,
   no quadratic — individually none pays for a focused optimization.

---

## 4. The #1 through the necessity + specialization lens

**Is it deletable / vestigial / specializable, or genuine work to optimize?**

It is **genuine, necessary work that is done in a quadratic way** — the fix is *algorithmic*
(memoize/cache + prune the rescan), **not** deletion. Chained-extend discovery is semantically required:
Less `:extend` is transitively closed (if `.a:extend(.b)` and `.b:extend(.c)`, then `.a` must also gain
`.c`), so after each application the engine genuinely must find newly-eligible extends. What is
*not* necessary is:

- **Recomputing `wouldExtendChange` from scratch for every `(candidate, otherExtend)` pair on every
  iteration.** The `(target-selector-value, find-selector-value, partial)` → match-result relation is
  **invariant** for a given pair; today it is recomputed O(I²) times per root. This is directly
  cacheable — the same way `visibleRootsCache` / the just-landed `isSameOrDescendantRoot` memo cache
  their invariant answers. A per-pass `Map<"targetVal|findVal|partial", MatchResult>` in front of
  `wouldExtendChange` would collapse the dominant 13% + 22% + 12% matcher cost.
- **Re-scanning the *entire* `allExtends` list per applied extend.** `findChainedExtendsWithSkips`
  already computes `collectNewSelectorCandidates`; the candidate set could **index `allExtends` by
  target-selector value** (build a `Map<targetVal, extends[]>` once per pass) so chaining only visits
  the extends whose target actually appears in the new candidates, instead of the full list. This
  removes the outer O(I) factor from the O(I²).
- **`decomposeFind(find)` is recomputed inside every `wouldExtendChange`** (extend-walk.ts:1132) even
  though `find` is one of a small fixed set of instruction selectors — memoizable per-pass by
  `find.valueOf()`.

**Partial-specialization angle (matches the goal's per-use-case lens):** the whole cluster is dead
weight for **extend-free** sheets — if a root graph contains zero `:extend`/`&:extend` instructions,
`processExtends` should early-out before entering the chaining loop at all (a one-time "any extends?"
guard on the instruction list). That guard makes the common no-extend `.less` render pay 0% here. The
matcher is also only exercised for `.less`; static CSS never reaches it.

**Recommended next slice:** memoize `wouldExtendChange` (and its inner `decomposeFind`) by
selector-value key for the duration of one `processExtends` pass, **and** index `allExtends` by target
value so `findChainedExtends*` visits only relevant extends instead of rescanning the full list. Both
are self-contained to `extend.ts` + `extend-walk.ts`, mirror caches that already exist in the codebase,
carry no eval/render-fold coupling, and directly attack the 92%-of-self-time cluster with a
straightforward O(I²)→~O(I·k) reduction. Expect this to move real multi-root extend renders by a large
multiple — the same category of win the visibility-walk and comment-scan fixes delivered. Add the
extend-free early-out as a cheap secondary guard.

After it lands, re-profile: the extend cluster should fall out and **GC/allocation (#2) becomes the
headline on all three workloads**, at which point the follow-up is broad allocation reduction (fewer
span/selector materializations — the SLIM/copy-reduction track), not a single fix. **Phase D targets
remain off the table** — nothing in the eval-fold / registration / flag-walk surface breaks ~2.6% on
any workload here.

---

## Appendix — harness & repro

Synthetic sheets are written by the committed benches (`packages/core/perf/collapse-bench.mjs`,
`dynamic-bench.mjs`), producing `synth.less` / `dyn.less`. The multi-root realworld sheet is generated
by a harness that writes N `@import`'d component files (each with mixin + guard + `:extend` + operations
+ color + comments) plus a `_base.less` of extend targets and a `main.less` that imports them all — the
multi-root graph required to exercise the extend engine. Profiles captured with
`node --cpu-prof --cpu-prof-dir=…`; self-time aggregated by `(functionName, url:line)` from the
`.cpuprofile` node hit counts; phase split from the `[jess-profile]` JSON (`JESS_PROFILE=1`).

**Repro:** `node --cpu-prof --cpu-prof-dir=packages/core/perf/prof/<wl> <driver>` for each workload,
then aggregate. Scaling run: generate the realworld sheet at n=100/200/300 and time a 2-iter warm
render; per-component ms grows linearly → total ≈ O(n²), confirming the chaining/matcher quadratic.

**Confirmed:** `isSameOrDescendantRoot` 0.000%, `commentRunsWithinSpan` 0.001%, `entries` absent — both
prior hotspots gone. **New #1:** chained-extend discovery + selector matcher, ~92% self-time, O(I²),
memoizable/indexable (optimize, not delete; add an extend-free early-out for the common `.less` case).
