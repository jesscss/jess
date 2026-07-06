# REPROFILE_POST_COMMENTSCAN — where the time goes after the comment-scan fix

**Branch:** `work/reprofile-post-commentscan` off dev tip `4c4397297`
(`perf(core): fix comment-scan serialize quadratic`).
**Method:** `node --cpu-prof` (self-time, sampled) + `JESS_PROFILE=1` (wall-time phase split) on the
same three workloads as `REPROFILE_CURRENT.md`: `collapse-bench` (collapse mode), `dynamic-bench`, and
a hand-written 300-component extend/mixin/color/comment real-world sheet. Read-only; no core changes.

> **Environment caveat (READ FIRST):** as in the prior report, this build is in the known slow-artifact
> regime and the machine is loaded. **Absolute ms are NOT comparable to historical baselines.** Every
> conclusion is drawn from **relative self-time %** and **relative phase share**, both robust to a
> uniform slowdown. That said, one absolute number IS meaningful as a before/after on the *same* build:
> the collapse workload's dominant cost, which is exactly what the fix targeted.

---

## TL;DR verdict

1. **The comment-scan quadratic is GONE.** `entries` (the trivia generator, was **48–54%** self-time)
   is absent from every profile's top list. `commentRunsWithinSpan` (was **20–22%**) is now **0.02%**
   on collapse and does not appear in dynamic/realworld. Collapse render dropped from ~3100ms to
   ~145ms; the whole comment/trivia machinery is now sub-1% everywhere. **Confirmed fixed.**

2. **The collapse and dynamic profiles are now flat and broad.** No single function dominates. The
   largest cost on both is the **garbage collector** (13% collapse, 8% dynamic); everything else is a
   long tail of parser `_r_*` frames and node-build/eval machinery in the 1–4% band. Phase split is now
   an even ~50/50 parse-vs-render (parse's *share* rose only because serialize collapsed).

3. **On real (extend-heavy) Less there is a NEW, singular #1 hotspot:**
   **`isSameOrDescendantRoot` at 76% self-time** — a recursive extend-root visibility tree-walk run
   per `(root × extend-instruction)` pair in `processExtends`. The old diffuse "extend matcher ~25%
   cluster" from `REPROFILE_CURRENT` has collapsed into this one function. **This is the next target.**

---

## 1. Per-workload results

### Phase split (`JESS_PROFILE=1`, warm render, single iteration)

| workload | getTree (parse) | render (serialize + extend) | render share | total |
|---|--:|--:|--:|--:|
| **collapse** (1500 nested static blocks, `collapseNesting:true`) | 154.2ms | 145.0ms | **48.4%** | 299ms |
| **dynamic** (1200 mixin/ref/operation blocks) | 142.6ms | 155.8ms | **52.2%** | 299ms |
| **realworld** (300 mixin+guard+`:extend`+op+color+comment components) | 55.4ms | **6068.4ms** | **99.1%** | 6124ms |

- The two synthetic workloads are now **~50/50 parse/render** — a major shift from the prior report's
  80–94% render share. Nothing collapsed on the parse side; render/serialize *shrank* by ~20× once the
  comment-scan quadratic was removed, so parse now looks proportionally large. Parse itself is
  unchanged (`_r_*` frames all sub-4% self-time).
- **realworld is 99% "render"** — but note this jess version runs `processExtends` **inside the render
  phase**, so that 6068ms is almost entirely the extend engine, not serialize (serialize/trivia is
  sub-0.1% here). The extend cost eclipses everything.

### Top self-time functions (CPU profile)

**collapse** (10,854 samples / 40 renders):

| % | function | location |
|--:|---|---|
| **12.99%** | `(garbage collector)` | — |
| 2.57% | `_r_value` (parser) | index.js:12712 |
| 2.07% | `setFieldSpans` | index.js:118 |
| 1.84% | `_r_LessAmpersand` (parser) | index.js:41351 |
| 1.79% | `_r_ComplexSelector` (parser) | index.js:9940 |
| 1.75% | `isNode` | index.js:2058 |
| 1.67% | `Selector` (ctor) | index.js:2096 |
| 1.58% | `(program)` | — |
| 1.38% | `_r_blockItem` (parser) | index.js:33233 |
| 1.36% | `_r_PseudoSelector` (parser) | index.js:11107 |
| 1.31% | `refreshPositions` | index.js:566 |
| 1.30% | `_r_CompoundSelector` (parser) | index.js:10284 |
| 1.21% | `renderRulesBody` | index.js:7160 |
| 1.11% + 1.03% | `inherit` (×2 sites) | index.js:1865 / :2123 |

→ **No dominant function.** GC leads at 13%; the rest is a flat tail split between parser `_r_*` frames
and node-build (`setFieldSpans`, `Selector`, `isNode`, `inherit`). **`commentRunsWithinSpan` = 0.02%,
`entries` absent.**

**dynamic** (6,493 samples / 25 renders):

| % | function | location |
|--:|---|---|
| **8.39%** | `(garbage collector)` | — |
| 3.74% | `_r_value` (parser) | index.js:12712 |
| 3.28% | `(program)` | — |
| 2.19% | `evalStatic` | index.js:1834 |
| 2.13% | `inherit` | index.js:1865 |
| 2.09% | `setFieldSpans` | index.js:118 |
| 1.66% | `_r_topProduct` (parser, arithmetic) | index.js:45918 |
| 1.34% | `renderRulesBody` | index.js:7160 |
| 1.29% | `_r_topSum` (parser, arithmetic) | index.js:46122 |
| 1.09% | `isNode` | index.js:2058 |
| 1.08% | `setValueSpans` | index.js:139 |
| 0.80% | `lookupResolvedReference` | index.js:23199 |
| 0.79% each | `registerNode`, `callWithContext`, `Rules` ctor | — |

→ Again **flat**. GC leads (8%), then parse arithmetic (`_r_topProduct`/`_r_topSum`) and real eval work
(`evalStatic`, `inherit`, `lookupResolvedReference`, `callWithContext`) scattered at 1–2% each. The old
eval hotspots (`createRulesLikeReferenceSurface`, `ensureProv`) remain gone. Comment-scan absent.

**realworld** (31,749 samples / 4 renders):

| % | function | location | bucket |
|--:|---|---|---|
| **76.33%** | `isSameOrDescendantRoot` | extend-roots.ts:555 | **extend visibility** |
| **7.42%** | `(anonymous)` — the `instructions.filter` callback | index.js:18045 | extend visibility |
| 5.97% | `(program)` | — | — |
| 1.20% | `processExtends` | extend-roots.ts:635 | extend |
| 1.11% | `extendSelector` | index.js:16018 | extend |
| 0.68% | `applyExtendsToSelector` | index.js:15444 | extend |
| 0.63% | `findChainedExtendsWithSkips` | index.js:17411 | extend |
| 0.40% | `classifyInstructionMatch` | index.js:17837 | extend |
| 0.33% | `(garbage collector)` | — | gc |
| 0.26% | `isNode` | index.js:2058 | dispatch |
| 0.25% | `isWholeNodeMatch` | index.js:14649 | extend |
| 0.21% | `wouldMatchNode` | index.js:15200 | extend |

→ **`isSameOrDescendantRoot` alone is 76% of self-time**, and its immediate caller (the
`instructions.filter(...)` visibility callback) is another 7.4%. Everything else — including the entire
selector-matching cluster that was the ~25% story in the prior report (`extendSelector`,
`applyExtendsToSelector`, `wouldMatchNode`, `processExtends`, `isWholeNodeMatch`) — is now **≤1.2%
each**. The bottleneck moved from "match selectors" to "decide which extends are visible to each root."

---

## 2. Comment-scan: confirmed gone; new shape of collapse/dynamic

| function | prior report (self-time) | now |
|---|--:|--:|
| `entries` (trivia generator) | **48–54%** | **absent from top-500** |
| `commentRunsWithinSpan` | **20–22%** | **0.02%** (collapse); absent (dynamic/realworld) |
| `_emitNameBoundaryComment` | 3.8% | ≤0.08% |
| all trivia/comment functions combined | **~70–79%** | **<1%** |

The `perf(core)` comment-scan fix (`4c4397297`) did exactly what it claimed: the
`O(nodes × total_comments)` full-map scan per node is eliminated. Collapse render 3100ms → 145ms on the
same build class.

**What collapse & dynamic look like now:** broad and GC-led. With no algorithmic hotspot left, the
profile is dominated by the garbage collector (8–13%) followed by a long tail of parser productions and
node materialization (`setFieldSpans`/`Selector`/`inherit`/`isNode`), none above ~4%. These are
*allocation-and-throughput* profiles, not *algorithmic-quadratic* profiles — the character that
`REPROFILE_CURRENT` predicted would surface "once comments no longer swamp the profile."

---

## 3. The new top-3 targets

1. **`isSameOrDescendantRoot` — the extend-root visibility walk. ~76% self-time (+7.4% in its filter
   caller) on real Less; ~0 on the synthetic benches.** In `processExtends`
   (`packages/core/src/tree/util/extend-roots.ts`), for **every root** the code does
   `instructions.filter(instr => isInstructionVisibleForRoot(...))`, and for each `(root, instruction)`
   pair `isInstructionVisibleForRoot` calls `isSameOrDescendantRoot(rootRules, instruction.extendRoot)`
   — a **recursive descent of the `childrenRoots` tree** (line 555, self-recursing at 575). With R
   roots and I extend-instructions this is **O(R × I × tree-depth)**; a measured scaling run confirms
   superlinear per-component cost (0.64ms/comp at n=150 → 1.01ms/comp at n=300). This single function is
   the entire real-world extend cost. Fix is self-contained to the extend-root layer: **memoize
   ancestor/descendant relationships** (precompute a root→descendant-set or root→depth/ancestor index
   once per pass, or cache `isSameOrDescendantRoot` results by `(rootRules, extendRoot)` pair the way
   `visibleRootsCache` already caches `getVisibleRoots`). The visibility answer is invariant across the
   inner ruleset loop, so it can be computed per `(root, instruction)` once and reused.

2. **Garbage collector / allocation pressure. ~8–13% on collapse/dynamic (now the #1 line there); 0.3%
   on realworld.** With the comment quadratic gone, GC is the largest *remaining* cost on the
   throughput-shaped workloads. The tail feeding it is node/span materialization
   (`setFieldSpans` 2.0–2.1%, `Selector` ctor, `inherit` ×2 sites, `setValueSpans`) plus parser
   allocation. This is a broad allocation-reduction target, not one hot function — lower urgency than
   #1 but it is genuinely the leading cost on 2 of 3 workloads.

3. **Parser throughput (`_r_*` productions). Flat ~1–4% each, no single hot frame.** `_r_value`
   (2.6–3.7%), the selector productions (`_r_ComplexSelector`/`_r_CompoundSelector`/`_r_PseudoSelector`),
   and the arithmetic productions (`_r_topProduct`/`_r_topSum` on dynamic) together make parse a
   co-equal ~50% of wall time on the synthetic benches. There is no quadratic here — it is steady-state
   throughput. Only worth attention after #1; individually none of these frames pays for a focused
   optimization.

---

## 4. Recommendation for the next perf slice

**The next target is #1: memoize `isSameOrDescendantRoot` / the per-root extend-visibility filter.**

This UPDATES the prior report's expectation. `REPROFILE_CURRENT` predicted the *selector-matching*
engine (`extendSelector`/`applyExtendsToSelector`/`wouldMatchNode`) would surface as the leading
eval-phase cost once comments were fixed. It did surface — but those functions are only ~1% each. The
real cost is one level up, in the **visibility gate that decides which extends apply to which root**
(`isSameOrDescendantRoot`), which the prior diffuse profile had folded into the general extend bucket.
It is a textbook `O(R × I × depth)` walk with an obvious memoization fix, isolated to
`extend-roots.ts`, no eval/render-fold coupling, and it is **~83% of self-time on realistic Less** — by
far the highest-value, lowest-risk win available. Expect it to move real-world extend renders by a
large multiple, the same way the comment-scan fix moved collapse.

After that lands, re-profile: the extend cost should drop out and the GC/allocation tail (#2) will
become the headline on all three workloads, at which point allocation reduction (fewer span/selector
materializations) is the sensible follow-up. **Phase D targets remain off the table** — nothing in the
eval-fold / registration / flag-walk surface breaks 2.2% on any workload here.

---

## Appendix — harness & repro

Profiling drivers live in `packages/core/perf/`:
`collapse-bench.mjs collapse`, `dynamic-bench.mjs`, `prof-realworld.mjs` (300-component extend sheet),
`phase-split.mjs <workload>` (emits the `[jess-profile]` phase JSON), and `parse-prof.mjs
<file.cpuprofile> [topN]` (self-time aggregation). Profiles were captured with
`node --cpu-prof --cpu-prof-dir=packages/core/perf/prof`.

**Note — real bug found (out of scope, not fixed):** `:extend` on a selector nested inside an `@media`
block crashes with `TypeError: selector.cloneForPlacement is not a function` (`copySelectorForPlacement`
→ `makeList` → `applyWholeMatch`). Minimal repro: a rule `.x:extend(.y) { }` inside `@media (...) { }`
where `.y` is defined at the top level. The realworld harness avoids this construct (uses top-level and
`&:extend` forms). Worth a separate bug ticket.
