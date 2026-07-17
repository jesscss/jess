# GOAL #1 Completion Scorecard — differential-oracle reconciliation

> **Authoritative as of 2026-07-17, origin/dev + this branch's full workspace build.**
> Produced by reconciling the differential oracle
> (`packages/core/src/ast/parse-host/__tests__/alpha-oracle-differential.test.ts`
> + `alpha-oracle-baseline.json`, 91 paired fixtures) three ways: **ast/ render**
> vs the **committed less.js `alpha` (v5) golden** vs **real less.js 4.6.7**
> (`~/git/worktrees/less.js/less-4x`, READ-ONLY `bin/lessc`). This is the exact
> remaining GOAL #1 (feature-complete parse→eval in `ast/`) work list.

## 1. Authoritative counts (clean re-baseline)

A fresh run against `~/git/worktrees/less.js/content-alpha3/.../tests-unit` reproduces
the committed baseline **exactly** — the per-agent in-isolation numbers *did* compose
across the rebases:

| Status | Count |
|---|---|
| MATCH | 28 |
| MATCH_NORM | 1 |
| DIFF | 53 |
| THREW | 9 |
| **Total** | **91** |

> **`merge/merge.less` is a DIFF by design, not a gap.** ast/ correctly emits the v5
> LAST-occurrence merge anchor (`CUTOVER-STATUS.md:44`; memory
> `spine-merge-last-occurrence-anchor`), so it diverges from alpha's FIRST-occurrence
> `merge.css` golden — the golden is the outlier awaiting an upstream correction to
> LAST (hand-off in `proposed-alpha-corrections/README.md §Merge`). Task #36 briefly
> flipped ast/ to FIRST (making it a MATCH → count 29); that was reverted on
> `fix/merge-anchor-revert-to-last`, restoring the intended DIFF (count 28 MATCH).

Full core suite green with this build: **241 files pass / 3 skip; 4097 tests pass /
17 skip / 2 todo** (the differential-oracle test included, no regression vs baseline).

> **Note on the doc's older THREW breakdown.** `AST-FEATURE-COMPLETENESS…md` §4 recorded
> `MATCH 25 · MATCH_NORM 1 · DIFF 54 · THREW 11` with the 11 THREW mapping onto E2 (cross-unit
> `unit`), E3 (color-fn coercion ×5), E4 (recursion), E5 (scope), hsl-args. **The eval wave
> (E1–E5) has since closed all of those throws** — E2/E3/E4/E5 fixtures now render (they moved
> to DIFF/MATCH, not THREW). The current 9 THREW are a *different, smaller* class: at-rule
> **prelude** interpolation (P2) and **detached-ruleset-used-as-value**. See §4.

## 2. Confirmed wrong goldens (validated vs real less.js 4.6.7)

Method: a per-line 3-way comparison flags a golden as *wrong* only when **ast/ and real
less.js 4.6.7 agree on a line the golden lacks, with no intended-v5 substitution present**
(i.e. the golden is the lone outlier, not a v5 divergence from 4.x).

**Exactly one fixture qualifies** — matching owner ruling #38:

| Fixture | Line | ast/ | real 4.6.7 | committed golden | Verdict |
|---|---|---|---|---|---|
| `scope/scope.less` | `.tiny-scope` | `color: #989` | `color: #989` | `color: blue` | **golden wrong** |

- ast/ already emits the correct `#989` (lazy-print of the last-unlocked `@mix`); internal
  regression coverage exists at
  `packages/core/src/ast/parse-host/__tests__/mixin-var-leak.test.ts:51`.
- **The golden lives in the READ-ONLY, owner-maintained less.js `alpha` corpus**
  (`content-alpha3/.../scope/scope.css`), not vendored into jess. It is **not edited here**:
  (a) the worktree is read-only by standing rule, and (b) editing the external corpus would
  make the committed jess baseline non-reproducible (a machine re-syncing the pristine corpus
  would see the fixture flip back and the gate would flag a false MATCH→DIFF regression). **The
  fix belongs upstream in less.js `alpha`** (`.tiny-scope { color: #989 }`); this scorecard is
  the hand-off. Once synced, the fixture's baseline entry promotes.
- **`scope.less` does not flip DIFF→MATCH from this golden fix alone**: ast/ additionally drops
  the `.testImported` (detached-ruleset call from a selector body) and `#allAreUsedHere`
  (default-guard mixin) blocks — those are real engine gaps (see §3, cluster *mixins/detached*),
  independent of the wrong golden.

Every *other* DIFF fixture whose golden differs from 4.x does so for a **documented v5 reason**
(the golden holds the v5 target that ast/ has not yet reached) — those are ast gaps (§3), **not**
wrong goldens.

## 3. Categorized DIFF residual (53)

The oracle's **`alpha-oracle-baseline.json` already IS the intended-divergence allowlist**
(the gate is baseline-diff, not `diff==0`; a recorded DIFF/THREW is an *accepted* gap). No
oracle code change is needed to "silence" intended divergences — they are already non-failures.
This section is the categorized rationale.

**Key reconciliation finding:** at today's maturity, of the 53 DIFF fixtures, **52 are genuine
ast/ gaps** (ast/ matches the v5 golden in ZERO of them; a subset *also* sits on an intended-v5
divergence axis — that is *why* their golden differs from 4.x — but ast/ has not reached even the
v5 target on any of them). The **one exception is `merge/merge.less`**: ast/ already emits the
correct v5 output (LAST-occurrence anchor) and DIFFs *only* because the alpha golden encodes the
FIRST-occurrence order — an outlier golden awaiting upstream correction, NOT an ast/ gap. So the
practically-actionable split is **1 wrong golden (`scope`) + 1 outlier-golden v5 divergence
(`merge`) + 51 real gaps**, with the intended-v5 rules noted where they explain the golden's shape.

### 3a. Intended-v5 divergence is the *reason the golden ≠ 4.x* (cited)

These fixtures' goldens legitimately diverge from real 4.x for a declared v5 rule; ast/ still
has its own gap on top (so they remain DIFF, correctly accepted in the baseline):

| Rule (cite) | Fixtures |
|---|---|
| `:is()` extend/selector compaction | `extend-selector`, `extend`, `extend-exact`, `selectors` |
| Nested output default `collapseNesting:false`; no `@media` merge | `nesting`, `detached-rulesets`, `css-grid` |
| Trailing/leading-comment preservation & indentation | `comments`, `comments2`, `at-rules-keyword-comments` |
| Verbatim un-operated values / CSS-superset pass-through (`calc()` preserved, `@supports` spacing) | `calc`, `css-3` |

(Cites: §1c of `AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md`; memory `less-v5-default-collapsenesting-false`,
`v5-preserve-unoperated-values-verbatim`, `css-superset-verbatim-passthrough`, `:is()` compaction.)

### 3b. Real ast/ gaps (51) — ranked by cluster (this is the engine work)

Clustered by the failing feature (fixture counts are where the cluster is the dominant cause):

1. **Value/string/url interpolation `@{…}` (P1)** — `strings` (`"…@{var}…"` literal),
   `urls` (also drops hoisted `@import`s), `import-interpolation`, `property-name-interp`,
   `parser-property-interp`, `parse-interpolation` (also `@x[@y]` map syntax), `mixins-interpolated`.
   *Highest-value: P1 is the benchmark.less blocker per §1a.*
2. **Mixin / detached-ruleset expansion** — `mixins`, `mixins-advanced`, `mixins-closure`,
   `mixins-important`, `mixins-guards`, `mixins-guards-default-func` (default() guard),
   `mixins/maps`, `detached-rulesets` (over-duplicates `.wrap-selector`), `namespace-targeted`,
   `functions-each` (`each` block ordering + `each(.mixin(), …)` mixin-call-as-iterable).
3. **Property accessors `$prop` and map access `@x[key]`** — `property-accessors`,
   `property-targeted`, `nesting` (`@p[text]`), `mixins/maps`. Unresolved → emitted literally.
4. **calc / cross-unit arithmetic (E2 output side)** — `calc` (emits `calc(70%)` not
   `calc(100% - 30px)`), `nesting` (`calc(200px)` vs `200px`), `operations`,
   `operations-advanced`, `color-functions/operations`. The *throws* closed; the *output* is
   still wrong.
5. **`!important` propagation / merge in values** — `variables` (`@c !important` unresolved),
   `mixins-important`, `variable-advanced`.
6. **`@import` handling & ordering** — `import`, `import-inline`, `import-module`,
   `import-reference-issues`, and the hoisting miss in `urls`/`at-rules-keyword-comments`.
7. **Extend (`:extend`) correctness** — `extend`, `extend-exact`, `extend-selector` (leaves
   `.should-not-exist-in-output` inside `:is()`); overlaps cluster (3a) `:is()`.
8. **CSS-shape formatting** — `css-3` (float precision `rotate(-0.0000000001deg)`, `@supports`
   spacing, `foo|h1` namespace pipe), `css-grid` (multi-line `grid-template-areas`),
   `css-escapes`, `css-guards`, `at-rules`, `at-rules-empty`, `starting-style`,
   `extract-and-length` (`extract()` unevaluated), `strings`.
9. **Plugin system** — `plugin`, `plugin-module`, `plugin-preeval`, `tailwind` (`@apply`
   inside a rule dropped). *Plugin-eval; likely a separate workstream, lower GOAL-#1 priority.*
10. **Removed-feature fixtures (declared)** — `javascript-REMOVED/legacy/javascript.less`
    (backtick JS removed in v5 — ast/ still emits raw `` `…` ``), `ie-filters-REMOVED/legacy/ie-filters.less`.
    Low priority; the golden reflects removal, ast/ should error/normalize.

## 4. THREW enumeration (9) — remaining-distance-to-bootstrap list

Each THREW is a value-eval / dispatch / scope path (none is a parse crash). Root-cause hint per
fixture:

| # | Fixture | Throw | Root-cause cluster |
|---|---|---|---|
| 1 | `container/container.less` | `variable @varfoo (min-width: @threshold)  is undefined` | **P2 at-rule prelude interpolation** — `@container` prelude read as a bogus variable name |
| 2 | `import/import-reference.less` | `variable @keyframeName  is undefined` | **P2 prelude interp** — `@keyframes @{keyframeName}` |
| 3 | `layer/layer.less` | `variable @layer-name  is undefined` | **P2 prelude interp** — `@layer @{layer-name}` |
| 4 | `media/media.less` | `variable @smartphone  is undefined` | **P2 prelude interp** — bare `@var` in `@media` prelude not resolved |
| 5 | `variables-in-at-rules/variables-in-at-rules.less` | `variable @ns "http://lesscss.org" is undefined` | **P2 prelude interp** — `@namespace @ns url(…)` |
| 6 | `permissive-parse/permissive-parse.less` | `variable @function-name("(\d{0,@{d-value}})")  is undefined` | **P2 interp** — `@{…}` inside permissive value/selector content |
| 7 | `functions/functions.less` | `detached ruleset used as a value (not called)` | **Detached-ruleset-as-value** eval gap |
| 8 | `functions/legacy/functions.less` | `detached ruleset used as a value (not called)` | **Detached-ruleset-as-value** eval gap |
| 9 | `import/import-remote.less` | `variable @var is undefined` | **Network `@import`** — OUT OF SCOPE (exclude per §1b E5) |

**Ranked remaining work from THREW:** (i) **P2 at-rule prelude interpolation** — 6 of 9 throws
(#1–6); the single highest-leverage engine fix, and the same Tier-B leaf-split that closes P1.
(ii) **detached-ruleset-used-as-value** — 2 throws (#7–8). (iii) `import-remote` (#9) is a
network import, excluded from the completeness gate.

Known residual lanes flagged in the task surface in **DIFF** (not THREW): `each(.mixin(), …)`
mixin-call-as-iterable → `functions-each`; `@x[@y]` map-accessor iterables → `nesting`,
`property-accessors`, `parse-interpolation`.

## 5. Bottom line — the exact remaining GOAL #1 work

1. **Wrong golden (1):** `scope/scope.less` `.tiny-scope` → `#989` — fix **upstream in less.js
   `alpha`** (external read-only corpus); ast/ is already correct.
2. **P2 at-rule prelude interpolation** — closes 6 of 9 THREW and unblocks the P1 value-interp
   DIFFs (`strings`, `urls`, `import-interpolation`, `property-name-interp`, …). Tier-B A0 job.
3. **Eval output correctness** (throws already closed by E1–E5): mixin/detached expansion,
   property/map accessors, calc/cross-unit output, `!important` merge, extend/`:is()`.
4. **Detached-ruleset-used-as-value** (2 THREW).
5. Lower priority / separate workstreams: `@import` ordering, plugin system, removed-feature
   fixtures.

The intended-v5 allowlist requires **no oracle code change** — `alpha-oracle-baseline.json`'s
recorded DIFF/THREW statuses already serve as the allowlist (baseline-diff gate). Statuses only
ever improve as these gaps close.
