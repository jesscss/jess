# GOAL #1 Completion Scorecard — differential-oracle reconciliation

> **Authoritative as of 2026-07-17, origin/dev + this branch's full workspace build.**
> Produced by reconciling the differential oracle
> (`packages/core/src/ast/parse-host/__tests__/alpha-oracle-differential.test.ts`
> + `alpha-oracle-baseline.json`, 88 paired fixtures — the `legacy/` 4.x fixtures are
> excluded) three ways: **ast/ render** vs the **committed less.js `alpha` (v5)
> golden** vs **real less.js 4.6.7** (`~/git/worktrees/less.js/less-4x`, READ-ONLY
> `bin/lessc`). This is the exact remaining GOAL #1 (feature-complete parse→eval in
> `ast/`) work list.

## 1. Authoritative counts (clean re-baseline)

A fresh run against `~/git/worktrees/less.js/content-alpha3/.../tests-unit` reproduces
the committed baseline **exactly** (status-for-status; only informational `bytes`
metadata drifted on 5 still-DIFF fixtures) — no un-ratcheted status improvement
remained and no fixture regressed:

| Status | Count |
|---|---|
| MATCH | 36 |
| MATCH_NORM | 1 |
| DIFF | 50 |
| THREW | 1 |
| **Total** | **88** |

> **Re-baseline history.** The differential gate only flags regressions, so wins ratchet
> in only when the baseline is re-run. Earlier scorecard revisions recorded `MATCH 28 /
> DIFF 53 / THREW 9` (and, pre-legacy-exclusion, a 91-fixture corpus); the eval wave
> (P2 at-rule prelude interpolation + detached-ruleset-as-value + cross-unit/scope
> throws) has since closed 8 of the 9 throws and the audit-era `MATCH 34` grew to
> `MATCH 36` (`color-functions/operations` and `strings` promoted DIFF→MATCH). The
> committed `alpha-oracle-baseline.json` is now current with HEAD.

> **`merge/merge.less` is a DIFF by design, not a gap.** ast/ correctly emits the v5
> LAST-occurrence merge anchor (`CUTOVER-STATUS.md:44`; memory
> `spine-merge-last-occurrence-anchor`), so it diverges from alpha's FIRST-occurrence
> `merge.css` golden — the golden is the outlier awaiting an upstream correction to
> LAST (hand-off in `proposed-alpha-corrections/README.md §Merge`). Task #36 briefly
> flipped ast/ to FIRST (making it a MATCH); that was reverted on
> `fix/merge-anchor-revert-to-last`, restoring the intended DIFF.

Full core suite green with this build: **242 files pass / 3 skip; 4102 tests pass /
17 skip / 2 todo** (the differential-oracle test included, no regression vs baseline).

> **Note on the doc's older THREW breakdown.** `AST-FEATURE-COMPLETENESS…md` §4 recorded
> `MATCH 25 · MATCH_NORM 1 · DIFF 54 · THREW 11` with the 11 THREW mapping onto E2 (cross-unit
> `unit`), E3 (color-fn coercion ×5), E4 (recursion), E5 (scope), hsl-args. **The eval wave
> (E1–E5) has since closed those throws** — they moved to DIFF/MATCH. The subsequent P2
> at-rule prelude-interpolation + detached-ruleset-as-value work closed the rest. **Exactly
> one THREW now remains:** `import/import-remote.less` (a network `@import`, out of GOAL-#1
> scope). See §4.

## 2. Wrong-golden claims — re-adjudicated (see `WRONG-TESTDATA-AUDIT.md`)

**No fixture in the corpus is a confirmed wrong golden.** An earlier revision of this
scorecard flagged `scope/scope.less` `.tiny-scope` `#989` as a wrong golden on the
inference "ast/ and real less.js 4.6.7 both emit `#989`, so `blue` is wrong." The
re-audit (`WRONG-TESTDATA-AUDIT.md` §1) established that this inference is exactly
backwards for the alpha corpus and that **scope `#989` is a JESS BUG, not a wrong
golden**:

| Fixture | Line | ast/ (today) | real 4.6.7 | v5 golden | Verdict |
|---|---|---|---|---|---|
| `scope/scope.less` | `.tiny-scope` | `color: #989` | `color: #989` | `color: blue` | **jess bug (golden correct)** |

- The top-level `.css` is the **v5** golden and *intentionally diverges from 4.x*; the
  `legacy/*.css` is the 4.x reference. "ast/ agrees with 4.x" is evidence that **ast/
  has not yet reached v5**, not that the golden is wrong.
- Decisive owner commits: less.js alpha `a0e4e494` *"Fix scope value in v5"* set
  `scope/scope.css` (v5) = `color: blue` and `scope/legacy/scope.css` (4.x) = `#989`;
  re-affirmed by `02f4b326`. So v5 **intentionally** resolves `@mix` to the outer last
  binding (`blue`), dropping the 4.x mixin-injected-variable hoist (`#989`).
- **v5 target = `blue`.** ast/ still applies 4.x mixin-variable hoisting → a real engine
  gap (§3), correctly an accepted DIFF in the baseline. The internal
  `mixin-var-leak.test.ts:51` encodes `#989` anchored to the **dying 4.x** shape and must
  be updated to `blue` when ast/ reaches v5 scoping (internal test, freely changeable).

The other named "wrong golden" flags (`merge`, `css-3` rotate/`@supports`,
`mixins-guards-default-func`) are likewise re-adjudicated in `WRONG-TESTDATA-AUDIT.md`:
only `merge` is a genuine graduation candidate (v5 LAST-occurrence anchor, DESIGN-DECISIONS
M1) awaiting an upstream corpus correction; the rest are misattributed jess bugs where ast/
matches 4.x while the v5 golden intentionally diverges. Every DIFF fixture's baseline status
is unaffected — the reclassification is of *rationale* (real ast/ gap, not wrong golden).

## 3. Categorized DIFF residual (50)

The oracle's **`alpha-oracle-baseline.json` already IS the intended-divergence allowlist**
(the gate is baseline-diff, not `diff==0`; a recorded DIFF/THREW is an *accepted* gap). No
oracle code change is needed to "silence" intended divergences — they are already non-failures.
This section is the categorized rationale.

**Key reconciliation finding:** at today's maturity, of the 50 DIFF fixtures, **49 are genuine
ast/ gaps** (ast/ matches the v5 golden in ZERO of them; a subset *also* sits on an intended-v5
divergence axis — that is *why* their golden differs from 4.x — but ast/ has not reached even the
v5 target on any of them). The **one exception is `merge/merge.less`**: ast/ already emits the
correct v5 output (LAST-occurrence anchor) and DIFFs *only* because the alpha golden encodes the
FIRST-occurrence order — an outlier golden awaiting upstream correction, NOT an ast/ gap. So the
practically-actionable split is **1 outlier-golden v5 divergence (`merge`) + 49 real gaps**
(`scope` among them — a jess bug, not a wrong golden; see §2), with the intended-v5 rules noted
where they explain the golden's shape.

### 3a. Intended-v5 divergence is the *reason the golden ≠ 4.x* (cited)

These fixtures' goldens legitimately diverge from real 4.x for a declared v5 rule; ast/ still
has its own gap on top (so they remain DIFF, correctly accepted in the baseline):

| Rule (cite) | Fixtures |
|---|---|
| `:is()` extend/selector compaction | `extend-selector`, `extend`, `extend-exact`, `selectors` |
| Nested output default `collapseNesting:false`; no `@media` merge | `nesting`, `detached-rulesets` (`css-grid` since promoted to MATCH) |
| Trailing/leading-comment preservation & indentation | `comments`, `comments2` (`at-rules-keyword-comments` since promoted to MATCH) |
| Verbatim un-operated values / CSS-superset pass-through (`calc()` preserved, `@supports` spacing) | `calc`, `css-3` |

(Cites: §1c of `AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md`; memory `less-v5-default-collapsenesting-false`,
`v5-preserve-unoperated-values-verbatim`, `css-superset-verbatim-passthrough`, `:is()` compaction.)

### 3b. Real ast/ gaps (49) — ranked by cluster (this is the engine work)

Clustered by the failing feature (fixture counts are where the cluster is the dominant cause):

1. **Value/string/url interpolation `@{…}` (P1)** —
   `urls` (also drops hoisted `@import`s), `import-interpolation`, `property-name-interp`,
   `parser-property-interp`, `parse-interpolation` (also `@x[@y]` map syntax), `mixins-interpolated`.
   *Highest-value: P1 is the benchmark.less blocker per §1a.* (`strings` — `"…@{var}…"` literal —
   has since promoted to MATCH.)
2. **Mixin / detached-ruleset expansion** — `mixins`, `mixins-advanced`,
   `mixins-important`, `mixins-guards`, `mixins-guards-default-func` (default() guard),
   `mixins/maps`, `detached-rulesets` (over-duplicates `.wrap-selector`), `namespace-targeted`,
   `functions-each` (`each` block ordering + `each(.mixin(), …)` mixin-call-as-iterable),
   `functions` (detached-ruleset-used-as-value, since moved THREW→DIFF).
   (`mixins-closure` since promoted to MATCH.)
3. **Property accessors `$prop` and map access `@x[key]`** — `property-accessors`,
   `nesting` (`@p[text]`), `mixins/maps`. Unresolved → emitted literally.
   (`property-targeted` since promoted to MATCH.)
4. **calc / cross-unit arithmetic (E2 output side)** — `calc` (emits `calc(70%)` not
   `calc(100% - 30px)`), `nesting` (`calc(200px)` vs `200px`), `operations`.
   The *throws* closed; the *output* is still wrong. (`color-functions/operations` and
   `operations-advanced` have since promoted to MATCH.)
5. **`!important` propagation / merge in values** — `variables` (`@c !important` unresolved),
   `mixins-important`, `variable-advanced`.
6. **`@import` handling & ordering** — `import`, `import-inline`, `import-module`,
   `import-reference-issues`, `import-interpolation`, `import-reference`, and the hoisting
   miss in `urls` (`at-rules-keyword-comments` since promoted to MATCH).
7. **Extend (`:extend`) correctness** — `extend`, `extend-exact`, `extend-selector` (leaves
   `.should-not-exist-in-output` inside `:is()`); overlaps cluster (3a) `:is()`.
8. **CSS-shape formatting** — `css-3` (float precision `rotate(-0.0000000001deg)`, `@supports`
   spacing, `foo|h1` namespace pipe), `css-escapes`, `css-guards`, `at-rules`, `starting-style`,
   `extract-and-length` (`extract()` unevaluated). (`css-grid` and `at-rules-empty` since
   promoted to MATCH.)
9. **Plugin system** — `plugin`, `plugin-module`, `plugin-preeval`, `tailwind` (`@apply`
   inside a rule dropped). *Plugin-eval; likely a separate workstream, lower GOAL-#1 priority.*
10. **Removed-feature fixtures (declared)** — `javascript-REMOVED/legacy/javascript.less`
    (backtick JS removed in v5 — ast/ now ERRORS with the `@use / @-use` migration message
    instead of emitting raw `` `…` ``; the whole-doc driver reuses `less-parser`'s exported
    `firstInlineJsBacktick` + `INLINE_JS_UNSUPPORTED_MESSAGE`, mirroring `LessParser.parse`'s
    wrapper guard), `ie-filters-REMOVED/legacy/ie-filters.less`.
    Low priority; the golden reflects removal, ast/ should error/normalize. (These live under
    `legacy/` and are now excluded from the gated corpus.)
11. **At-rule prelude interpolation (P2)** — `container`, `layer`, `media`,
    `variables-in-at-rules`, `permissive-parse`. These previously THREW ("variable @… is
    undefined" on a prelude read as a bogus variable name); the P2 fix stopped the throw but
    ast/ still does not emit the resolved prelude, so they render as DIFF. Same Tier-B leaf-split
    as P1 (cluster 1).

## 4. THREW enumeration (1) — remaining-distance-to-bootstrap list

Exactly one fixture still throws; it is out of GOAL-#1 scope:

| # | Fixture | Throw | Root-cause cluster |
|---|---|---|---|
| 1 | `import/import-remote.less` | `variable @var is undefined` | **Network `@import`** — OUT OF SCOPE (exclude per §1b E5) |

**All the previously-throwing fixtures now render** (they moved to DIFF, not MATCH):
- **P2 at-rule prelude interpolation** (`container`, `layer`, `media`, `variables-in-at-rules`,
  `permissive-parse`, `import-reference`) — the throw is closed; output is still DIFF (§3b
  cluster 11). This was the single highest-leverage fix, and the same Tier-B leaf-split that
  closes P1.
- **detached-ruleset-used-as-value** (`functions`) — throw closed, now DIFF (§3b cluster 2).
  Its `legacy/` sibling is excluded from the gate.

Known residual lanes flagged in the task surface in **DIFF** (not THREW): `each(.mixin(), …)`
mixin-call-as-iterable → `functions-each`; `@x[@y]` map-accessor iterables → `nesting`,
`property-accessors`, `parse-interpolation`.

## 5. Bottom line — the exact remaining GOAL #1 work

1. **No wrong goldens.** The previously-claimed `scope/scope.less` `#989` wrong golden was
   **re-adjudicated as a JESS BUG** (v5 target = `blue`; owner commit `a0e4e494`); ast/ still
   emits the 4.x `#989` and must reach v5 outer-binding-wins scoping (§2, and cluster 2/scope
   in §3b).
2. **P2 at-rule prelude interpolation output** — the throws are closed; ast/ still does not emit
   the resolved prelude (`container`, `layer`, `media`, `variables-in-at-rules`,
   `permissive-parse`). Same Tier-B leaf-split unblocks the P1 value-interp DIFFs (`urls`,
   `import-interpolation`, `property-name-interp`, …). Tier-B A0 job.
3. **Eval output correctness** (throws already closed by E1–E5): mixin/detached expansion,
   property/map accessors, calc/cross-unit output, `!important` merge, extend/`:is()`.
4. **Detached-ruleset-used-as-value** output (`functions`, throw closed → DIFF).
5. Lower priority / separate workstreams: `@import` ordering, plugin system, removed-feature
   fixtures, network `@import` (`import-remote`, the lone remaining THREW, out of scope).

The intended-v5 allowlist requires **no oracle code change** — `alpha-oracle-baseline.json`'s
recorded DIFF/THREW statuses already serve as the allowlist (baseline-diff gate). Statuses only
ever improve as these gaps close.
