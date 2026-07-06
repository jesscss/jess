# dev→parseman Performance-Commit Integration — Evidence Log

**Purpose.** Preserve the evaluation of the `origin/dev` performance campaign (66
commits not in `feature/parseman`) so the analysis and the commits' *claims* are
not lost, even though the code changes were **discarded** as superseded. If a
future workload re-surfaces one of these hot paths, this is the reactivation map:
every commit SHA, its claim, and why it was kept or dropped.

**Decision (2026-07-05).** `feature/parseman` ⊇ `origin/dev` was established via a
`git merge -s ours origin/dev` — it *records* dev as integrated while keeping
parseman's tree byte-identical. dev's perf commits optimize the **pre-parseman
architecture**; parseman's refactor (12,000ms → ~266ms on the canonical benchmark)
already restructured those hot paths, so the micro-opts either target code that is
no longer the bottleneck or land below end-to-end measurement sensitivity. Per the
governing bar — *keep a ported commit only if it adds a measurable speedup or a
correctness fix* — nothing measured qualified. This makes `parseman → dev` a clean
fast-forward with no lost value.

## A/B methodology

- Workload: a synthetic 150-block Less file (`scratchpad/synth-bench.less`, 45KB)
  that renders **cleanly** on parseman and stresses the relevant hot paths —
  `:extend` (×150), mixin calls with operations + variadics, `@var` references,
  deep nesting, dimension arithmetic, color functions. (`benchmark.less` from
  less.js is NOT usable: it exercises eval paths parseman hasn't finished, i.e. the
  less-integration frontier.)
- Harness: `scratchpad/ab-bench.mjs` — warm 40, time 200 renders through the built
  `jess` Compiler, report the **median** (mean/stdev are polluted by occasional GC
  outliers; median is the reliable metric).
- Baseline: **median ≈ 163ms**, reproducible to ±0.4%. Detection floor ≈ 2%.

## A/B results (measured)

| Ported group | Commits | Baseline | Ported median | Verdict |
|---|---|---|---|---|
| Surface memoizations | `b9c0434a4` + `3ad85763c` | 163ms | 163.6 / 166.4ms | **no gain → discard** |
| Hot-path serialize | `a2cd0de0d` | 163ms | 166.4 / 167.6ms | **no gain → discard** |
| Extend-instruction chain | `c53429cb8`→`4b3969f15`→`da9d1548c` + `be3cbc8e0` | 172.7 / 162.2ms | 163.8 / 168.6ms | **no gain + 3 test regressions → discard** |

The first two groups ported cleanly via `git cherry-pick -n -X theirs` (dropping doc
churn). The **extend chain does NOT cherry-pick** — parseman's `extend-roots.ts`
diverged (SelectorLike model; `.parent` not `.sourceParent`) — so it was ported by
hand (`extend-roots.ts` + `extend.ts`) and measured: median unchanged (no speedup,
matching the other groups), AND the hand-adaptation broke **3 of 378 extend tests**
(baseline: 0 failures). Dev's headline `processExtends 88→63ms` claim does not
transfer to parseman: it optimizes the pre-refactor engine. Fails the bar on both
speedup and correctness — the strongest DISCARD of the set. (Note: an autonomous
port agent applied the change but died before reporting; the measurement was
finished by hand from its worktree.)

## Per-commit classification (static eval, 7-agent sweep)

Verdicts: **DISCARD** (obsolete / superseded / no measured value) · **KEEP?**
(portable candidate — but must pass the A/B bar) · **INVESTIGATE** (needs manual
adaptation before it can even be measured).

### Docs / process (~19) — DISCARD (no code)
`c52c822ff 4d191b7ca b0629936e 968e01377 a36b9e76c 27ca401be c34483d22 146024676`
`feb827285 964d19e32 46093297f 56b7e9a7a aa9e4b800 8e7154958 63506e135 1406bf64d`
`6ae9a3061 74968dbbb 155a20cc8` — all touch only `docs/future/core-architecture/*`
(HANDOFF/PERFORMANCE-HANDOFF/FOCII/NODE-REWRITE-TRACKER); mostly "Record rejected …"
experiment notes. No merge value.

### Node-adoption / child-processing (7) — DISCARD (already in parseman)
`80b5e4e2b cb8687cac b0f207eab 6097ac72a 26f5d151b 662bfd52e` teach each node class
to skip the base ctor's generic child-walk via a `processChildren=false` param.
**Parseman already does this, more generally**: base `Node` ctor adopts nothing
("Invariant 7"), each class declares `static childKeys` (or `null` for leaves), and
a single `parentChildren()` factory pass parents off that metadata. The dev field
sets map 1:1 onto parseman's `childKeys`. `9761c1d7c` (warm-profile-less-benchmark
harness) = INVESTIGATE tooling (standalone script).

### `c203e7990` "Slim source ancestry and lookup normalization" (96 files) — DISCARD
~70% a repo-wide `parent`→`sourceParent` rename (write-once source ancestry) that
parseman **independently superseded**: parseman kept the name `parent`, solved the
same ~38× `Object.defineProperties` ctor hotspot with plain fields + `toJSON()`, and
evolved its own `inherit()`/`setSourceSpan` and custom-property parser. Landed one
day *after* parseman's fork point. Only genuinely net-new piece: ~1170 lines of
mixin-namespace callable-guard **lookup-normalization** logic in `rules.ts`
(`withRulesetNamespaceGuards`, `dedupeNamespaceCallableResults`, …) — re-derive by
hand ONLY if parseman exhibits the namespace-lookup bug it fixes; otherwise skip.

### Extend bitset/root pruning (10) — INVESTIGATE (chain; needs re-siting)
`4699e5d49` (foundation: `selectorKeySetByRoot` + `rootMayContainExtendTarget`) →
`987d8b177` (per-instruction gate + `isDisjoint` word-AND fast path) → `64c823144`
(`isEmptyBitSet` alloc-avoid) → `e506545b3` (per-root target-aggregate prune) →
`7765fdbbf` + `ffcfa3443` (refinements + ruleset-level skip). `90f62b6bc`/`333ed2f76`
= placement refactors. `71f633bf5` (memoize descendant checks) is later negated by
`892fb2cd0` (deletes `isSameOrDescendantRoot` — **semantic**, `.css`-risk, needs
`getVisibleRoots` equivalence proof). Parseman HAS the infra (`bitset.ts`,
`selector.keySet`, `context.selectorBits`) but NONE of the pruning gates. Portable
standalone: the `isDisjoint` fast path (`987`) and `isEmptyBitSet` (`64c`). DROP
`ffcfa3443`'s `.parent`→`.sourceParent` swaps (fight parseman's COW parent model).

### Extend-instruction (6) — KEEP? (chain) — under A/B
`c53429cb8` (cache `targetValue`/`extendWithValue` via `toRootInstruction`) →
`4b3969f15` (carry precomputed keysets) → `da9d1548c` (`isSelfExtend` + for-loop
warning scan). `be3cbc8e0` (tuple→object `findChainedExtends`, deletes recovery
scan). **Dev's headline claim: `processExtends` 88.37ms→63.29ms (~28%).** All sit
at parseman's exact pre-commit baseline (machinery present, un-cached). Highest
value-to-risk: `423b97402` (2-line guard: skip `processExtends` when
`context.extends.length === 0` — helps NO-extend files only). `ba0376895` = DISCARD
(doc + dead-helper deletion already true in parseman; the rejected prototype it
documents was superseded by `4b3969f15`).

### Rules-like / callable surfaces (7)
`b9c0434a4` (memoize exact mixin/ruleset surface scans) + `3ad85763c` (memoize
negative reference-import scan) — **measured: no speedup → DISCARD**. `0581add77` +
`e878510d0` (descriptor-copy slims) = KEEP? (untested; likely below noise).
`5948ce4de` (specialize surface field-copy) = INVESTIGATE (field-inventory audit).
`703c3f6b6` + `b001dfa49` = **DISCARD** — parseman eliminated the callable-surface
*cloning* model these optimize ("share the canonical body children, no cloned
nodes"); their host functions don't exist.

### Property-merge / registration (6)
`e24bd6255` (default-colon declarations reuse the canonical registration lane —
real CPU evidence) + `39bd28d3a` (bitset guard trim) = KEEP? (coupled; e24's
`rules.ts` edit must use the literal `':'` from 39bd28d3a to avoid an import cycle).
`c62847b3d` (narrow property-merge lookup lane) + `641cf2a57` (prune merge child
lookups — biggest counter win) = INVESTIGATE (parseman has PROPERTY_LOOKUP + a
strategy dispatch; needs a native re-impl, not a cherry-pick; 641 depends on 62847).
`a34de14c8` (reuse default callable declarations) = DISCARD (parseman shares
callable children — no copy-vs-reuse gate exists). `a8b7c655f` (`node.type` shortcut
in `childRulesOf`) = DISCARD (parseman restructured with `instanceof Rules`
correctness guards the shortcut would drop).

### Hot-path / node / selector / trivia (9)
`a2cd0de0d` (lazy dup-declaration serialize pass) — **measured: no speedup →
DISCARD**. `673bac96d` (single-pass callable-arg flatten) + `f9e75a764`
(`EMPTY_HEADER_TRIVIA` hoist only; its print.ts trim targets deleted code) = KEEP?
(untested). `0a9dd7531`/`57704f101` (skip redundant selector copies) +`e7b9aa22e`
(inline bit-tests) = INVESTIGATE (parseman restructured via `copyOwnedWithReusableLeaves`/`isRulesetSelectorMetadata`;
`e7b9aa22e` fights parseman's `isNode` idiom). DISCARD: `8e42cc668` (contradicts
parseman's intentional `childKeys=['value']` on JsArray/JsObject), `4438fd83e`
("Remove trivia run registry" — parseman's trivia rewrite **already removed** the
`runs` registry; no-op), `2cbaedad9` (targets a `rules.ts` node model that no longer
exists).

## Reactivation

If a future workload profiles one of these hot paths (extend processing, callable
surface scans, declaration registration) as a real bottleneck, the ports are
recoverable from `origin/dev` at the SHAs above. The *machinery* they assume is
mostly still present in parseman; the blocker was that end-to-end median on a
representative workload showed no gain. Re-measure against a workload that stresses
the specific path with a per-function profiler before re-porting.
