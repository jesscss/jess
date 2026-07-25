# Parseman parse-performance proposals — handoff for review / implementation

**Status:** proposals only, for owner review. Nothing here is implemented. These are
parseman-side (`~/git/oss/parser-thing`) changes; `parseman` is a separate project, so
these need owner sign-off before landing.

**Source:** grounded profiling + source analysis on the jess parse benchmark
(`packages/css-parser/test/bench.ts` — 220-file / 492KB corpus). This handoff captures the
**parseman-side** proposals for owner review. (A jess-side-only version of the comment-lift win —
1.1, rebuild `_liftStandaloneComments` off the log during `build()` — was tried and **REVERTED: it
regressed parse ~15–25%** on comment-dense input, because feeding a per-node log today forces
parseman to capture *every whitespace token*. The correct fix is parseman-side — see **2.5** below.)

---

## The profile (grounds every proposal below)

Baseline: **~13.3–13.7ms median** parse on the bench corpus. Self-time splits:

| Bucket | Share | Notes |
|---|---|---|
| jess build host (`builders.ts` + core node ctors) | **~55%** | parseman helps this by handing the host less work / fewer allocations. Its hottest fn is `_liftStandaloneComments` (8.6%, source re-scan) — addressed parseman-side by **2.5** (comment-only capture). |
| parseman parse + CST capture (compiled `_r_*` + `_tf0`) | **~45%** | what bucket-2 below targets. |
| GC | ~7–8% | spread across both; child-array duplication (2.1) is a big contributor. |

Hottest single functions: `_liftStandaloneComments` (8.6%, jess — bucket 1), `_tf0` trivia skip
(5.1%, parseman — 2.2), then the `_r_*`/`_build*` pairs (2.1/2.3).

---

## Constraints on any implementation (non-negotiable)

- **Perf is king.** Every change must be measured A/B on the bench (`packages/css-parser/test/bench.ts`)
  and be **neutral-or-better**. A change that's elegant but slower does NOT land. Elegance/field-count
  never at the expense of measured perf.
- **Correctness gate:** all four parser test suites green (`css`/`jess`/`less`/`scss`-parser) AND CST
  byte-identity (the compiled output + captured CST must be unchanged for the corpus). The grammars are
  composed (`jess = compose([css, …])`), so a parseman change must be validated against all four.
- **Reason from source, not assumptions.** parseman's trivia/commit/capture machinery has non-obvious
  interactions (the deferred-trivia-commit boundaries bit the grammar-thinning agent — a blind change
  broke 102 tests). Verify against the real compiled parsers.
- Work in `~/git/oss/parser-thing` on a branch; validate the consuming grammars in the jess repo.

---

## Proposals (ranked by expected-impact-per-risk)

### ★ 2.1 — Collapse `children` / `rawChildren` when a node captures no trivia  (CLEAR WIN, low risk)

**Problem.** Every `node()` today allocates **two** child arrays (`_ch` and `_raw`), performs **86
dual leaf-pushes** (each terminal pushed to both), and **re-wraps** the built child into a leaf for
`_raw` at each of 28 node returns. But `_raw` only ever *diverges* from `_ch` when (a) trivia is
interleaved into raw (jess gates this to `CompoundSelector` only — 1 of 39 rules) or (b) a child is a
bare string vs a leaf.

**Change.** When the compile-time arity/`capturesTrivia` gate already proves a node captures no trivia,
emit a **single collector** and pass it as both `children` and `rawChildren` (apply the string→leaf wrap
lazily/once).

**Sites:** 27 of 28 node rules (`CompoundSelector` keeps the two-array path).
**Impact:** halves per-node child-array allocation + the 86 dual-pushes → cuts into the 45% capture cost
and the 7–8% GC.
**Risk:** contained — gated on the existing `capturesTrivia` compile-time flag; pairs naturally with the
trivia arity-gate already in place. **This is the highest-value parseman-side change.**

### ★ 2.2 — Fused trivia-skip + first-token dispatch  (`_tf0` is 5.1%)

**Problem.** `_tf0` runs on every inter-term gap and every `many`/`sepBy` iteration; after it returns,
the caller **re-reads** `input.charCodeAt` for the next term's first-set guard (redundant read + bounds
check per gap — thousands of gaps in the corpus). Separately, `_tf0` unconditionally does **two guarded
pushes** (`_triviaLog`, `_cstTriviaLog`) even when the node doesn't want CST trivia — the `_cap` flag is
coarse.

**Change.** (a) A combinator/codegen fast-path that returns the position **and** the first non-trivia
code point in one pass (removes the redundant `charCodeAt`+bounds check per gap). (b) A per-call-site
"skip-only" vs "skip+log" split (the codegen already knows which) so 27/28 nodes call a push-free
skipper.
**Sites:** every sequence gap + repeat iteration.
**Impact:** a meaningful fraction of the 5.1%.
**Risk:** low-medium — MUST preserve the global `_triviaLog` for the downstream trivia map (keep logging
at the *scope* boundary, not per skip).

### 2.3 — Single-frame node-scope save/restore  (DEEPEST lever, needs a prototype)

**Problem.** Each `node()` saves and restores **6 ctx fields** (`_cstChildren`, `_cstLeaves`,
`_cstRawChildren`, `captureTrivia`, `_cstTriviaLog`, sometimes `_fields`) around the inner parse — a full
"push a capture layer" on every one of ~thousands of node instantiations. This is the literal
"full ctx layer per scope" cost.

**Change.** Bundle the capture state into a single small reusable frame object (or a struct-of-arrays
stack indexed by depth) so save/restore is one push/pop rather than 12 field reads/writes. With 2.1
collapsing `_ch`/`_raw`, the frame shrinks further.
**Sites:** all 39 rule fns.
**Impact:** trims constant per-node overhead feeding both CPU and GC.
**Risk:** medium — touches the core capture contract; **needs a prototype + the full CST test suite +
byte-identity check to size.** Do 2.1 first (it shrinks the frame this optimizes).

### 2.4 — Declarative host-capture descriptor (drop the `_hostReads` reflection gate)  (low, bundle only)

**Problem.** Structural nodes emit `_hostReads(_ctx.build, n)` which does `Function.prototype.toString` +
regex on the host on first hit (memoized). Memoization makes it ~once-per-parse per arity, so it's **not
hot** — don't do it alone.
**Change.** Let the host advertise its capture needs declaratively (jess already does this for trivia via
`_parsemanCaptureTrivia(type)`; generalize to a `_parsemanReads = { trivia, state, fields }` descriptor)
to drop the `toString`/regex entirely.
**Impact/risk:** low/low. **Bundle with 2.1/2.3, not standalone.**

### ★ 2.5 — Comment-only trivia capture (unlocks the ~8.6% comment-lift win)  (CLEAR WIN, low-med)

**Problem.** `_liftStandaloneComments` (jess host, **8.6% self-time — the single hottest fn**) recovers
comments by re-scanning source bytes in every rule-body gap. The obvious fix — consume the kind-labeled
`triviaLog` instead — was tried jess-side and **regressed parse ~15–25%**: to get comments into a node's
log, the host must enable per-node trivia capture for `Stylesheet`/`Ruleset`, and parseman's current
capture logs **every trivia token, including every whitespace run** — far more than the comment re-scan it
replaces. The primitive is doing 10× the needed work.

**Change (parseman-side — the right fix, since we own it).** parseman already computes `kindIndex`
(whitespace vs blockComment) at trivia-skip time (`_tf0`). Add a **comment-only capture mode**: a per-node
log (or a per-node view over the global log) that records **only comment entries**, skipping whitespace
with a single `kindIndex === blockComment` conditional at the existing skip site. Then the host's
comment-lift reads per-node comment spans with **no whitespace overhead and no byte re-scan** — cheaper
than both today's options. (Alternative/companion: expose the already-free global `res.triviaLog`
`commentRuns()` cheaply enough to consume during `build()` rather than only post-parse — the global log is
populated at zero added cost regardless; the blocker was only that comment-lift runs inline during build.)

**Sites:** the `_tf0` skip + the per-node capture gate (interacts with **2.2**'s "the `_cap` flag is too
coarse — split skip-only vs skip+log per call-site"; 2.5 is the comment-scoped instance of that split).
**Impact:** recovers most of the 8.6% host-side cost **without** the whitespace-capture regression.
**Risk:** low-medium — must preserve the global `_triviaLog` for the downstream trivia map; validate
comment placement / inline-vs-standalone / round-trip across all four parser suites (the jess-side rewrite
was already proven correct there — only the capture cost regressed, which this removes).
**Note:** this supersedes the reverted jess-side-only 1.1; the win is real, the fix is parseman-side.

---

## Explicitly NOT worth it (measured/reasoned neutral — don't invest)

- **Regex lowering** — the ident/`basicSel` regexes are ~0.9% each and already `charCodeAt`-scanned where
  possible. Tight.
- **Interning of map/build fns** — already done (`pushMapFn`).
- **Disjoint-choice switch / jump-table** — already emitted.

---

## Recommended order

1. **2.1** (clear win, low risk, biggest single parseman-side lever) — land + measure first; it also
   shrinks the frame that 2.3 optimizes.
2. **2.5** (comment-only capture — the ~8.6% host-side win; pairs with 2.2's skip-only/skip+log split).
3. **2.2** (next concrete win on `_tf0`).
4. **2.3** (deepest, but prototype-gated — only after 2.1, with the full CST byte-identity suite).
5. **2.4** folded into 2.1/2.3, never alone.

Each behind an A/B bench delta (neutral-or-better) + all-four-parser-suites-green + CST byte-identity.
Expected combined effect: a meaningful dent in the 45% parse+capture half (child-array duplication +
`_tf0` + per-node ctx layering are the three concrete costs), **plus the ~8.6% host-side comment-lift win
via 2.5** — all parseman-side, no jess-side regression.
