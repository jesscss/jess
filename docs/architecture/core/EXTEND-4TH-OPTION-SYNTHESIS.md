# Extend: 4th-option design synthesis (evidence-grounded)

Status: DESIGN HYPOTHESIS for adversarial review. Not yet implemented.

This is the output of a forensic, magnifying-glass analysis of **all three existing
extend engines** plus a **frequency classification of the entire acceptance corpus**
(four independent read-only agents, file:line-cited). It converts the owner's open
questions into measured answers and proposes a 4th direction. It does **not** invent a
novel engine — the evidence points to a design the repo already sketched
(`EXTEND-REDESIGN.md`, task #29), and this doc's job is to *validate it with evidence*
and name the exact pieces to port, graft, fix, and reject.

Companion: `EXTEND-REDESIGN.md` (the lazy-candidacy direction this confirms),
`packages/core/src/tree/util/EXTEND_RULES.md` (the correctness spec — unchanged).

---

## 1. Evidence base (what was actually traced)

- **Engine A — tree-v1** (`tree/util/extend.ts` 185KB + `selector-match-core.ts` 81KB OLD
  engine + `extend-walk.ts` 52KB NEW engine + `extend-roots.ts` driver + `selector-analysis.ts`
  cached keySet bitsets + `bitset.ts`).
- **Engine B — AST-v2** (`ast/extend/match.ts` + `plan.ts` + `solve.ts` + `emit.ts` + `ir.ts`).
- **Engine C — extend-index** (`tree/extend/extend-index.ts`, `process-extends-by-index.ts`,
  `pipeline.ts`; design `archive/EXTEND-INDEX-DESIGN.md`).
- **Acceptance corpus** — ~120 distinct output-asserting behavioral cases (after de-duping the
  corpus replays), plus ~380 engine-mechanics tests that pin machinery, not semantics.

---

## 2. The convergent verdict (all three engines + frequency agree)

1. **The load-bearing perf lever is fast-reject-over-a-scan, NOT a precomputed index.**
   - tree-v1 PROVED it: commit `5ed1bc554` added a keyset pre-reject in the *walk* →
     `processExtends` **51.8 → 27.3 ms (~47%), byte-identical, 45/45 paired wins**.
   - the extend-**index** direction is REFUTED: measured **3.8× SLOWER at N=26** (below any
     index break-even; the benchmark has only 26 extends over 1–2-compound selectors). The
     corpus-wide Set-Trie the design promised was **never actually built** — both the dead
     prototype and the surviving pipeline do a linear scan + cheap reject. `EXTEND-REDESIGN.md`
     already records "Explicitly NOT a trie."
   - AST-v2 has only a weak "shares-ANY-atom" OR-filter, not the `keySet.isSubsetOf` AND-subset.

2. **Matching must be equivalency, never serialization/`valueOf()` equality.**
   - AST-v2's exact-mode `bKey === targetKey` string compare is a **correctness bug**:
     `.b.c {}` + `.a:extend(.c.b) {}` produces NO extend (should be `.b.c, .a`). No acceptance
     test catches it today (all exact-mode targets are single-simple). *(Must-verify: write the
     failing test first.)*
   - tree-v1's equivalency IS order-independent + `:is()`-aware (`areCompoundsEquivalent`,
     tail-aware `positionSimpleMatches`), but every leaf comparison still bottoms out in
     `valueOf()` — the `EXTEND_RULES.md` "implementation gap" is real.

3. **Classification must be a pure boolean, never speculative full-application.**
   - The owner's "extend-roots re-makes selectors" suspicion is **CONFIRMED and structural**:
     tree-v1 classifies "does this instruction change this selector?" by *running the entire
     apply machinery, building a new selector, and comparing `.valueOf()`* — then discarding it
     (`extend-roots.ts:478`, `:501-511`). Matching selectors are reconstructed **2–5×** per pass.
   - `classifyExtendMatch`/`wouldMatchNode` (`extend-walk.ts:1261`) proves allocation-free
     boolean classification is achievable; the driver just doesn't always use it.

4. **Materialize the selector ONCE, at the end — never per-round to drive control flow.**
   - AST-v2 rebuilds `branchText` per comparison, un-memoized (`ir.ts:71`), ~2B string
     serializations per `applyInstruction` — the same `selectorAtoms` round-trip smell.
   - The index prototype re-serializes the whole selector via `.valueOf()` every fixpoint round.

5. **The fixpoint must fold all matching instructions per subject in ONE pass.**
   - AST-v2's quadratic (measured exponent 2.00) is `runFixpoint` firing **one instruction per
     round then `break`**, re-scanning a growing branch list: Σk = n(n+1)/2 (`solve.ts:128-155`).
   - Fix: group reachable instructions by target key (a `Map` for fan-out — *not* a trie) and
     apply all matches in one pass → exponent 2 → 1.

6. **Scope/roots reachability is orthogonal POLICY, separable from matching.**
   - C10 (roots) is *frequent but simple*: extends reach self + descendant roots, never ancestor
     roots; `@layer` shares by name. The matcher does nothing here.

---

## 3. Owner's open questions — answered with evidence

- **"Is extend-roots re-making selectors hot or rare?"** → HOT and structural (§2.3). Not rare —
  it's the classification mechanism itself. Kill it by routing classification through the boolean
  `classifyExtendMatch`, never through apply.
- **"Are we over-thinking it?"** → For the common path, YES it can be much simpler. A **3-capability
  matcher passes ~85–90% of the real corpus** (§4). The over-engineering is concentrated in one
  place: **C6 (`:is()` grafting into an authored pseudo) carries ~30 unit tests but only ONE real
  fixture (`extend-exact.css`) forces it** — every other `:is()` in real output is a *product* of
  C4 partial-all, not an input the matcher must recurse into.
- **"Is the index worth it?"** → No — refuted by controlled measurement (§2.1). Keep the *rewrite*
  primitive it produced (`extendByIndexOwn`, cloning-free, byte-identical over a 2,595-tuple sweep),
  discard the *index/trie*.

---

## 4. Frequency map (drives how simple the engine can be)

| Class | Behavior | Real weight | Verdict |
|---|---|---|---|
| **C4** partial-all → `:is(matched, ext)` wrap | ~25 | **COMMON — the workhorse** |
| **C1 / C1-reject** exact append / partial-in-full reject | ~22 | **COMMON** |
| **C10** roots/scope reachability | ~30 (one policy) | **COMMON, simple, orthogonal** |
| **C7** ampersand crossing/relative | 5 behaviors (~6 eval cases) | RARE at eval; over-tested at unit |
| **C6** graft into authored `:is/:where/:not` | ~30 unit / **1 real fixture** | UNIT-HEAVY, barely needed |
| **C2** order-independent compound | ~5 | RARE but a CORRECTNESS landmine |
| **C3** full complex chain | ~4 | RARE |
| **C5** multi-segment span wrap | 1 real fixture | RARE |
| **C9** reference-import boundary | 1 case | vanishingly rare |

**Correctness landmines any design MUST pass** (they defeat string equality): order-independent
compound (C2), consume-ALL simples (`.b.b.c` find `.b.c` → unchanged), combinator-sensitivity
(`.a .b` ≠ `.a > .b`), authored-`:is` OR-branch pick, partial-in-full rejection, element/ID conflict
guard (`a.info` + `div.foo` → reject).

---

## 5. The 4th-option design

**Not a new engine — a disciplined convergence on `EXTEND-REDESIGN.md`'s lazy-candidacy design,
built on the flat `Branch` IR, assembled from the proven pieces:**

**PORT (from tree-v1 — the tuned wins):**
- `keySet.isSubsetOf` / `isDisjoint` fast-reject over **cached lazy bitsets**
  (`selector-analysis.ts` + `bitset.ts`) as the front gate on both classify and apply. This is the
  measured ~47% lever.
- The equivalency **walk** semantics (order-independent multiset compound match, tail-aware `:is()`
  or-path, consume-ALL) — but with atom/keySet-id comparison as the leaf test, not `valueOf()`.
- Document-level zero-extend bail; same-target batching (kills the Bootstrap O(N²)); pass-scoped memos.

**KEEP (already present in AST-v2 — do not regress):**
- `match.ts`'s existing **cloning-free rewrite** (`rewriteBranchPartial` /
  `substituteSingleCompound` / `substituteMultiCompound`, `match.ts:194-341`) on the flat `Branch`
  IR. This already satisfies the cloning-free *principle*.
- ⚠️ **Correction (adversarial review F1):** do NOT graft `extendByIndexOwn`. It is imported only by
  `tree/extend/*` (Engine C), has **zero imports in `ast/extend/*`**, and operates on tree `Selector`
  nodes — the wrong IR for the flat-`Branch` engine. The earlier "already reused in solve.ts" claim
  conflated `tree/extend/solve.ts` with `ast/extend/solve.ts`. The transferable lesson from Engine C is
  the cloning-free *discipline* + its correctness ladder, which AST-v2 already embodies — not the function.

**FIX (the AST-v2 regressions):**
- Replace exact-mode string equality with keySet-subset + multiset-equivalency (correctness bug §2.2).
- Replace the fire-one-per-round-`break` fixpoint with a **fold-all-matching-in-one-pass** step. Per
  review F2, the fold ALONE is necessary-but-not-sufficient for linear; it must also:
  (a) group instructions by **`(partial, targetKey)`** — not `targetKey` alone, or exact and `all`
  instructions with the same target text merge incorrectly (cf. `instKey`, `solve.ts:31`);
  (b) cache the branch key on the `Branch` node **pre-declared in every factory** (not lazy `??=`, which
  would force a `{segs}`→`{segs,key}` hot-path shape transition — inv 1 / R4);
  (c) hoist the per-apply `present = new Set(out.map(branchText))` (`match.ts:110`) to **once-per-pass**.
- The fold is byte-identical to fire-one-per-round **only because extend application is confluent**
  (branch-SET order-independence, tested in `tree/extend/__tests__/oqd-confluence-differential.test.ts`).
  Cite confluence as the load-bearing invariant licensing the fold.
- Add an O(1) target-atom pre-gate **before** `branchText(b)` on the exact/append path too (`match.ts:61`),
  not only the partial path.
- Split the fast-reject correctly (review claim-4 caveat): `isSubsetOf` (AND-subset) is the **exact /
  whole-branch** gate; the `all` sub-part path MUST keep `!isDisjoint` (shares-any), or valid sub-compound
  matches are over-rejected (`extend-roots.ts:430-435` encodes this split).

**REJECT:**
- The corpus-wide index/Set-Trie/NFA (refuted, 3.8× slower at real N; §2.1). Self-limited: no high-N
  measurement exists — the claim is "slower at the real corpus," not "at all N."
- Classification-by-speculative-apply (§2.3).
- `valueOf()` as the comparison primitive anywhere on the hot path.

**Architecture shape:** one matcher, boolean classification + cloning-free rewrite, over the flat
`Branch` IR, with lazy candidacy (scan + cached-bitset reject) as the discovery mechanism and a
single final materialization. Roots reachability stays a separate policy gate.

---

## 6. Targets & gates (runs THROUGH the enforcement)

- **Correctness:** every §4 landmine has a passing acceptance test; add the missing exact-mode
  reorder test (`.b.c` + `:extend(.c.b)`) FIRST (red), then make it green.
- **Complexity:** `extend-op-budget` — extend-free doc does zero matcher work; N vs 2N branch-comparison
  growth is **linear** (drive the pinned 4.6× ceiling toward ~2×).
- **Perf:** controlled same-worktree toggle on `benchmark.less`; target ≤ the tree-v1 walk's 27.3 ms
  `processExtends`, byte-identical across the full extend corpus.
- **Reviewer:** `perf-architecture-reviewer` must sign each landing with evidence per invariant
  (esp. inv 1 shapes, inv 2 no re-derive, inv 3 fast-reject, inv 4 complexity-class).

---

## 7. Open risks / must-verify before building

1. **[F5]** The AST-v2 exact-mode reorder **correctness bug** (§2.2) is CONFIRMED by the adversarial
   review at file:line, and verified as uncovered by any test. Add the failing test
   (`.b.c` + `:extend(.c.b)` → `.b.c, .a`) **FIRST (red)**, then make it green.
2. **[F3 — blocking, no plan yet]** The **element/ID conflict guard** (`a.info` + `div.foo` → reject,
   not `:is(.info, div.foo)`) is **entirely absent** from the AST-v2 matcher (zero `conflict|isTag|isId`
   in `ast/extend/`). The only implementation is `extend-index.ts:817` `partialWrapMayConflict` (Engine C,
   which we do not graft). Plan: port a `partialWrapMayConflict`-equivalent validation into `match.ts`'s
   `:is()`-wrap paths, OR scope it out explicitly with a failing test. Do not claim "every landmine has a
   passing test" until this has one.
3. **[Missing risk] Ampersand-crossing hoist** is emit-layer behavior (`emit.ts` `hoistHeader`/`hoistNested`),
   not matcher behavior. The §5 fold restructures match/solve; it MUST preserve emit's hoist projection and
   feed it the folded result correctly. State this explicitly; do not let "C7 over-tested at unit" imply the
   hoist output can be dropped.
4. **[Missing risk] `@layer` / `@media` scope closure** — `solve.ts:94-100` gates on `reaches(i.scope,
   subject.scope)` + `referenceBoundary`. Confirm `@layer`-shares-by-name and media-scope closure are
   covered by `reaches` before treating roots reachability as fully "orthogonal policy."
5. **[Missing risk] Interpolated selectors** degrade to atom `''` (`ir.ts:159-165`), so the atom prefilter
   can spuriously admit on `''` and the matcher cannot know resolved text. Restate that `@{…}`-selector
   extend is **out of the exact-match contract** (EXTEND-REDESIGN §5 lists these as adversarial gates).
6. C6 "barely needed" is a frequency claim — before deleting any graft machinery, confirm `extend-exact.css`
   is the *only* forcing fixture and that C4's `:is()` output covers the rest.
7. Reference-boundary (C9) and cross-`@import` closure are eval-routed WIP — keep them out of the core
   matcher contract, as tree-v1 does.

## 8. Review status
Adversarially reviewed by `perf-architecture-reviewer` (evidence per invariant + independent file:line
verification of all four load-bearing claims). Verdict: **diagnosis APPROVED; construction plan REWORKED**
per findings F1–F5 (folded into §5/§7 above). Blocking items remaining before implementation: F2 (linear-fold
completeness), F3 (conflict-guard plan), F4 (pre-declared Branch fields), F5 (failing test first).
