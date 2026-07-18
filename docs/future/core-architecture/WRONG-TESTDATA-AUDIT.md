# WRONG-TEST-DATA RE-AUDIT (alpha corpus expected `.css`)

Scope: re-adjudicate every "the alpha `.css` expected output is wrong" claim against the
**correct** test, after fixing a differential-harness integrity bug (Part A).

## The bug that motivated this audit (Part A)

`alpha-oracle-differential.test.ts::pairedFixtures()` recursively walked the
alpha corpus and compared **every** `.less`+sibling `.css` pair — including the
`legacy/` subfolders, which hold the OLD Less **4.x** reference output, NOT the
v5 target. Diffing v5 `ast/` render against a 4.x reference flags every intended
4.x→v5 divergence as a false gap.

**Fix:** `pairedFixtures()` now skips any `legacy/` directory.

- Legacy fixtures wrongly compared: **3**
  (`functions/legacy/functions.less`, `ie-filters-REMOVED/legacy/ie-filters.less`,
  `javascript-REMOVED/legacy/javascript.less`) — all three were counted as **DIFF**
  gaps in the baseline.
- Corrected re-baseline (legacy excluded, honest — only those 3 keys removed, no
  other fixture's status changed):

  | | fixtures | MATCH | MATCH_NORM | DIFF | THREW |
  |---|---|---|---|---|---|
  | before (with legacy) | 91 | 34 | 1 | 55 | 1 |
  | **after (legacy excluded)** | **88** | **34** | **1** | **52** | **1** |

## The unsound default this audit corrects (Part B)

The "wrong test-data" flags leaned on the inference **"ast/ output matches real
Less 4.x ⇒ the expected output is wrong."** That is exactly backwards for the alpha
corpus: the top-level `.css` is the **v5** expected output and *intentionally diverges
from 4.x*; the `legacy/*.css` is the 4.x reference. So "ast/ agrees with 4.x" is
usually evidence that **ast/ has not yet reached v5**, i.e. a JESS BUG — not a
wrong expected output. The burden of proof for "wrong test-data" is a **positively-confirmed
v5 rule** (an owner corpus-fix commit, a SETTLED DESIGN-DECISIONS row, or an owner
memory decision), never mere 4.x agreement.

Correct test per flag: is the top-level divergence **positively confirmed** as a
v5 behavior (→ GENUINE graduation candidate, cite the rule), or is it just ast/
trailing v5 while matching 4.x (→ MISATTRIBUTED jess bug / real gap)?

## Per-flag verdicts

### 1. `scope/scope.less` `.tiny-scope` `#989` — **MISATTRIBUTED (jess bug)**

- Claim (GOAL1-SCORECARD §2/§5, `mixin-var-leak.test.ts`): expected `.css` `blue` is
  wrong; ast/ + real 4.6.7 both emit `#989`, so "expected output wrong".
- **Reality (owner corpus commits, decisive):** less.js alpha commit
  `a0e4e494` *"Fix scope value in v5"* deliberately set
  `scope/scope.css` (v5) = `color: blue` and `scope/legacy/scope.css` (4.x) =
  `color: #989`; re-affirmed by `02f4b326` *"test-data: rebaseline scope
  fixture"*. So v5 **intentionally** resolves `@mix` to the outer last binding
  (`@mix: blue`), dropping the 4.x mixin-injected-variable hoist (`#989`).
- The "expected output wrong" verdict used precisely the banned "ast/+4.x agree ⇒ expected
  output wrong" inference. ast/'s `#989` matches **4.x**, not v5 → real gap: ast/ still
  applies 4.x mixin-variable hoisting instead of v5 outer-binding-wins.
- Internal `mixin-var-leak.test.ts:51` encodes `#989` with the comment "less@4:
  the unlocked `@mix` wins" — it is anchored to the **dying 4.x** shape and must
  be updated to `blue` when ast/ reaches v5 scoping (internal test, freely
  changeable).
- Cite (against the claim): corpus commits `a0e4e494`, `02f4b326`.

### 2. `merge/merge.less` — **GENUINE graduation candidate**

- Claim (`proposed-alpha-corrections/README.md`, GOAL1-SCORECARD §3): the expected `.css`
  encodes 4.x FIRST-occurrence merge anchor; ast/ emits v5 LAST-occurrence.
- **Reality (verified):** ast/ render is **byte-identical** to the proposed
  `merge.css`; the only diff vs the committed expected `.css` is the `+`/`+_` combined-line
  anchor position (member content identical) — `.test-rule-interleaved` /
  `.test-rule-spaced` emit `background:` before `transform:`.
- v5 LAST-occurrence anchor is **owner-SETTLED**: DESIGN-DECISIONS **M1**
  ("Merge ANCHOR = LAST-occurrence (jess v5) … intended, not a bug"), memory
  `spine-merge-last-occurrence-anchor`, `CUTOVER-STATUS.md:44`. Task #36 flipped
  ast/ to FIRST to chase the expected output and was reverted on
  `fix/merge-anchor-revert-to-last`.
- The expected `.css` is the un-graduated outlier (no `legacy/` subfolder; last touched by
  the generic mega-refactor `43228697`, never v5-graduated). ast/ is correct.
- **Caveat (skeptic's note):** unlike `scope`, there is **no owner corpus-fix
  commit** graduating merge to LAST — confirmation is doc/memory-level (M1). Solid,
  but owner should ratify the upstream corpus change.
- Cite (for the claim): DESIGN-DECISIONS M1; `memory:spine-merge-last-occurrence-anchor`.

### 3. `extend-subspan-all` (`:extend(… all)` compound-subset `:is()` wrap) — **NEW-FIXTURE PROPOSAL; core mechanism GENUINE, specific cases rest on an OPEN edge**

- This is **not** an "expected output wrong" claim — it is a *new* proposed alpha fixture
  demonstrating a v5 extend feature ast/ implements (alpha's own `lessc` emits
  `WARNING: extend '…' has no matches` for cases 1–2; 4.x has no compound-subset
  complex-target matching).
- Core mechanism (partial `all` substitution → `:is(<matched>, <ext>)` graft; whole
  match → plain append) is **SETTLED**: DESIGN-DECISIONS **X3** (cite
  `EXTEND-SEMANTICS.md` §3/§5).
- BUT the fixture's mid-complex **combinator-span** cases (`.a > .c` matching
  `.a.b > .c.d`) are exactly DESIGN-DECISIONS **X1**'s "interior-combinator-span
  substitution mid-complex = **NOT specified** (OPEN edge)". The README also records
  that the #30 design brief prose transposed `&`/argument and the agent had to
  **reinterpret** it to a self-consistent direction. So the specific fixture leans
  on an unsettled edge + a reinterpreted brief.
- Verdict: GENUINE v5 *direction*, but **owner-ratify before upstream adoption**;
  not a misattribution, not fully settled either.
- Cite: DESIGN-DECISIONS X3 (settled core), X1 (open combinator-span edge).

### 4. `css-3/css-3.less` — `rotate(-0.0000000001deg)` "verbatim rounding" — **MISATTRIBUTED (jess bug)**

- Claim (GOAL1-SCORECARD §3a): un-operated value → source-verbatim, so the expected `.css`
  `rotate(0deg)` is the v5 divergence.
- **Reality:** both the v5 expected `.css` AND `legacy/` 4.x expected `.css` emit `rotate(0deg)`;
  **no divergence** exists — ast/ is the lone outlier at `rotate(-0.0000000001deg)`.
  No owner-fix graduated this to verbatim. The `v5-preserve-unoperated-values-verbatim`
  rule does **not** extend to this `rotate()`-arg case per the owner expected output.
- ast/ over-applies verbatim (or fails to canonicalize the `rotate()` arg) → real
  gap. "verbatim ⇒ expected output wrong" fails the burden of proof; the expected `.css` stands.
  (GOAL1-SCORECARD §3b cluster 8 *does* also list this as a real ast/ gap — the §3a
  "v5-divergence" bucketing is the erroneous part.)

### 5. `css-3/css-3.less` — `@supports` prelude spacing — **MISATTRIBUTED (jess bug)**

- Claim: CSS-superset verbatim pass-through, so the compact expected `.css` is the v5 target
  ast/ hasn't reached — framed as an intended divergence.
- **Reality (direction confirmed):** v5 expected `.css` **normalizes** the prelude to compact
  single-line `@supports (box-shadow: …) or (-moz-box-shadow: …) {`; `legacy/` 4.x
  preserves source spacing `@supports ( box-shadow: … ) or\n ( … ) {`. v5
  **intentionally normalizes, diverging FROM 4.x**. ast/ emits the **spaced verbatim**
  form — i.e. it matches **4.x**, not v5 → jess bug.
- So the expected `.css` is v5-correct (positively: v5 normalizes vs 4.x); ast/ trails. The
  "verbatim pass-through ⇒ expected output is the v5 target ast/ hasn't reached" framing is
  half-right (it IS a v5 target) but the *reason* is normalization, not verbatim, and
  ast/'s output is the 4.x shape, not a partial v5 shape.

### 6. `mixins-guards-default-func` adjacent-block merge — **MISATTRIBUTED (jess bug)**

- Claim: the expected `.css` wrongly merges the two adjacent `guard-default-definition-order-2`
  blocks.
- **Reality (direction confirmed):** v5 expected `.css` MERGES adjacent same-selector rules
  into one block (`case: 2; case: 3;`); `legacy/` 4.x SPLITS them into two blocks.
  v5 **intentionally merges** adjacent identical-selector rules; ast/ SPLITS —
  matching **4.x**, not v5 → jess bug.
- ast/ additionally drops whole `default()`-overload blocks (`guard-default-scopes-1/3`,
  `default: false`) — a separate real gap (the leaky-in-container `default()` dynamic
  registration feature, `CUTOVER-STATUS.md:49`). The expected `.css` stands.

## Summary

Of the six named flags:

| # | Flag | Verdict |
|---|---|---|
| 1 | `scope` `#989` | **MISATTRIBUTED** jess bug (owner commit `a0e4e494` sets v5=`blue`) |
| 2 | `merge` last-occurrence | **GENUINE** (DESIGN-DECISIONS M1; owner ratify upstream) |
| 3 | `extend-subspan` `:is()` wrap | new-fixture proposal; core GENUINE (X3), combinator-span on OPEN edge (X1) |
| 4 | `css-3` `rotate` verbatim | **MISATTRIBUTED** jess bug (v5 expected `.css` == 4.x == `0deg`) |
| 5 | `css-3` `@supports` spacing | **MISATTRIBUTED** jess bug (v5 normalizes; ast/ matches 4.x) |
| 6 | `mixins-guards-default-func` adjacent-merge | **MISATTRIBUTED** jess bug (v5 merges; ast/ matches 4.x) |

**4 of 6 named flags were misattributed jess bugs** — in every one, ast/ agrees with
the LEGACY 4.x reference while the owner-maintained v5 top-level expected `.css` intentionally
diverges. Only `merge` is a genuine graduation candidate; `extend-subspan` is a
partly-settled new-fixture proposal. The `alpha-oracle-baseline.json` DIFF entries for
flags 1/4/5/6 correctly remain accepted gaps — the reclassification is of their
*rationale* (real ast/ gap, not wrong expected output), not their baseline status.

The one previously-accepted "wrong expected output" outside this list — `extend.css` /
`extend-exact.css` exact-extender fold corrections (DESIGN-DECISIONS **X2**, SETTLED,
owner-confirmed pending upstream apply) — is unaffected here; ast/ does not reach it
(still DIFF), so it is moot for the reference. Note X2's owner-confirmation cites the
proposed-corrections README + `EXTEND-SEMANTICS.md` §12.1 (somewhat self-referential).
