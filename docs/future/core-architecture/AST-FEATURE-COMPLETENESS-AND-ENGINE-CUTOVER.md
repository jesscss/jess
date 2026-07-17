# ast/ Feature-Completeness → Engine Cutover (reorg A4)

> **Frame (owner, 2026-07-17).** The goal is **feature-complete parse→eval inside the
> `ast/` engine**, proven on **`benchmark.less` AND the Bootstrap 4/5 port**. Once `ast/`
> renders those two correctly, it *becomes the engine*: the parser grammar goes
> single-target (ast/ only), the legacy `BuilderHost` + legacy `tree/` render are
> retired, and downstream consumers (the `less-compat` bridge, and ultimately Less v5
> `alpha`) are re-pointed at `ast/`. **Feature completeness is the head; legacy
> retirement and `less-compat` are the tail.** This doc is the plan; it deletes/flips
> nothing.

This is the execution detail behind `AST-REORG-EXECUTION.md` **Phase A4**. A4 there is
described parser-internally ("delete `parse-host/`, retire the legacy two-target seam").
This doc adds the piece that gates it: **A4 cannot delete the legacy `BuilderHost` until
the live consumers of legacy `tree/` nodes — `Compiler.render` and the `less-compat`
visitor — no longer need them.** So the true order is *feature-complete ast/ → flip the
renderer → then A4 deletion*, not *delete then fix*.

---

## 0. Verified architecture (the dual-target reality)

One grammar, two build hosts, selected by whoever drives the parse:

| Path | Driver | Build host | Node model | Consumer | Status |
|---|---|---|---|---|---|
| **Legacy (LIVE)** | `parseLessFn` / `LessParser.parse` (`less-parser/src/functional-parser.ts:73,143`) | `BuilderHost extends LessGrammar` → `builders.ts buildNode` | legacy `tree/` `Rules` | `Compiler.render` → `tree.eval(context)` → serialize (`jess-plugin-less/src/index.ts:219`, `jess/src/index.ts:1314`); `less-compat` visitor wraps these nodes | **ships production** |
| **ast/ (TEST-ONLY)** | `parseToAst` (`core/ast/parse-host/dispatch-host.ts:103`) | `ParseBuildHost` → `ACTION_LIST` map (`parse-host/actions/index.ts`) | ast/ v2 plain-data (`Root`/`Statement`/…) | `whole-doc-driver.ts` `renderAstDoc` → `serialize` (test drivers only) | **not yet the renderer** |

Both hosts consume the **same** `lessGrammar` (`less-parser/src/grammar.ts`). The grammar
emits structural `ctx.build(type, …)` calls; the host's `build`/`buildNode` decides which
node model materializes. "Grammar is dual-target" = the grammar must keep emitting a shape
BOTH hosts can build. Making it **single-target (ast/ only)** is precisely what unblocks
the remaining builder-regex cleanup — but only after the legacy host has no consumers.

Two cross-edges worth noting for the deletion step:
- `core/ast/parse-host/import.ts:31,182` imports the **legacy** `parseLessFn` for
  `collectFileVars` (a second parse per interpolated import). This is a residual ast/→legacy
  dependency that must move to the ast/ parse when import resolution relocates (REORG §0.8a).
- The ast/ `ParseBuildHost` **already is** a name-keyed builder map (`ACTION_LIST`), matching
  the dialect re-base **W1** invariant (builder key ≡ rule name). See §5.

---

## 1. FEATURE-GAP INVENTORY (PRIMARY DELIVERABLE)

Measured empirically on `2026-07-17` origin/dev + this branch's build, driving the real
files through `renderAstFile`/`renderAstDoc` and diffing against the **less.js 4.6.7**
independent oracle (`~/git/worktrees/less.js/less-4x`, READ-ONLY `less-node.cjs`) and the
less.js `alpha` v5 goldens. The test evaluator uses the **production** `@jesscss/fns`
`builtinLessFns` (`make-builtin-registry.ts`), so eval throws are real engine gaps, not
harness-fidelity artifacts.

**Headline: the two target fixtures fail in DIFFERENT gap classes.**
- **`benchmark.less` renders end-to-end** — no throw, 0 parse errors, 0 deferred imports,
  **131,713 bytes** (vs the old legacy oracle's 131,578). Its residual is **PARSE-side
  interpolation** producing *wrong bytes*, not crashes.
- **`bootstrap.less` (bootstrap-less-port 2.5.1) parses + resolves all `@import`s cleanly**
  (0 parse errors, 0 deferred) **but throws in EVAL**. Its blockers are **eval-engine**
  gaps: `each()` expansion and cross-unit arithmetic.

This split matters: closing benchmark.less is a **Tier-B grammar** job; closing bootstrap is
an **eval-engine** job. They are largely independent workstreams.

### 1a. PARSE / interpolation gaps (Tier-B / Task #6) — surface on `benchmark.less`

| # | Gap | ast/ today | less.js oracle | Severity |
|---|---|---|---|---|
| **P1** | Quoted-string interpolation in **value** position: `content:"@{n}-bar"`, `url("@{b}/x.svg")` | emits the string **literally** (`"@{n}-bar"`) — `@{…}` not resolved | `content:"foo-bar"`, `url("/img/x.svg")` | **BLOCKER** (wrong bytes). benchmark's `.generate-icons` uses `url("@{base}/@{i}.svg")`. |
| **P2** | At-rule **prelude** interpolation: `@media @{q}`, `@keyframes @{name}` | **drops the whole block** → empty output | `@media screen {…}` | **BLOCKER (severe)** — output loss, not just wrong bytes. |
| **P3** | Quoted-string in **selector** position: `."icon"-@{i}` | emits nothing | (4.x errors; exotic) | LOW — probe first; likely not a real-world blocker. Owner confirm scope. |

Root cause (both P1/P2): the value-leaf/prelude grammar hands interpolation-bearing spans to
the builder as a single opaque leaf; `scanTo` stops at `@{`, so the interp is truncated
(`actions/at-rules.ts:44-50`, `actions/value-leaf.ts:84-88`). Fix = **grammar leaf-splits**
`" (chunk | lessInterp)* "` and prelude like `InterpolatedSelector`, consumed by
`interpFromLeaves` (spec: `TIER-B-INTERPOLATION-GRAMMAR-SPEC.md:162,241-249`). This is the
Tier-B **A0** work already named a hard prerequisite in the reorg; it retires the
`TODO(tier-b/A4)` cp-name/import-spec deferrals at the same time.

> Note: G1–G5 from the (stale, base `75e324105`) `BENCHMARK-AST-FAILURE-INVENTORY.md` —
> multi-part value assembly, mixin-call, detached-ruleset, namespace, `@import` — **have all
> landed** as `actions/*.ts` and are **no longer blockers** (verified: benchmark renders with
> 0 deferred imports). `+:`/`+_:` merge **works** (FIRST-occurrence anchor, byte-identical to
less.js — task #36; `merge/merge.less` oracle status is **MATCH**). Do
> not reopen them. The stale doc's 325/2,463-line residual figures are obsolete; the
> differential oracle (§4) is now the live residual source.

### 1b. EVAL-engine gaps — surface on `bootstrap.less` + the alpha corpus

| # | Gap | Repro | ast/ today | less.js oracle | Severity |
|---|---|---|---|---|---|
| **E1** | **`each()` iteration** over list/map with a ruleset body does not expand | `each(@m,{c+:@value})`; `each(range(3),{.col-@{value}{…}})` | emits **empty** | `c:1,2,3`; `.col-1{…}.col-2{…}.col-3{…}` | **BLOCKER** — bootstrap-less-port 2.5.1 (BS5) drives grid/utilities through `each` loops. |
| **E2** | **Cross-unit arithmetic** in parens (`4em / 2cm`, incompatible units) | `unit((@a / 2cm))`, `@a:4em` | yields `calc(4em / 2cm)` / a Keyword → downstream `unit()` throws `expected Dimension, got Keyword` | computes `2em` → `unit()` → `2` | **BLOCKER** for bootstrap; also alpha `variables.less`, `variable-advanced.less`. Owner: is `calc()`-preservation intended v5? If so, `unit()` must not *throw* + the fixture is a declared divergence. |
| **E3** | **Color-fn argument coercion** — `contrast`/`lighten`/`darken` get `Dimension`/`Keyword`, `hsl`/`rgba` reject modern-syntax args | alpha `functions.less`, `property-accessors.less`, `color-functions/modern*.less`, `rgba.less` | throws `arg N expected Color, got …` | resolves the color arg | **BLOCKER (corpus)** — value-eval resolves a color-typed operand to the wrong node kind. |
| **E4** | **Mixin recursion** termination | alpha `mixins.less` | `RangeError: Maximum call stack size exceeded` | terminates | **BLOCKER (corpus)** — guard/recursion base-case not honored (interacts with the in-flight mixin-recursion feature). |
| **E5** | **Scope / lazy resolution** — a variable resolves undefined that should bind | alpha `scope.less` (`@height`), `import-remote.less` (`@var`) | throws `variable @x is undefined` | resolves | **BLOCKER (corpus)** for `scope.less`; `import-remote` is a *network* import (out of scope — exclude). |

E1/E2 are the concrete **Bootstrap** blockers. E3/E4/E5 are the additional eval gaps the
differential oracle surfaces across the corpus (11 THREW fixtures; §4). Cross-checked: each
THREW is a value-eval/dispatch/scope path, none is a parse gap.

### 1c. DECLARED v5 divergences — NOT gaps, exclude from the completeness gate

Intended v5 behavior (matches less.js `alpha` goldens, diverges from 4.x); never count these
as blockers: `:is()` selector compaction; nested output (default `collapseNesting:false`, not
4.x flatten); no `@media` merge; trailing-comment indentation; **verbatim un-operated values**
(`1.0px`→`1.0px`, computed-only canonicalization); **CSS-superset pass-through** (`rgb(50%,0,0)`
un-operated emits verbatim); and the value-expr
cases where ast/ already matches real 4.x and the *legacy bridge* is the buggy one (modern
`/` in `rgb(0 128 255 / 50%)`, space-list call args).

---

## 2. ENGINE-CUTOVER DESIGN (SECONDARY) — making ast/ the renderer, then single-targeting

Cutover is three ordered flips plus a deletion. The completeness gaps in §1 gate flip C1.

**C1 — Flip `Compiler.render` from legacy to ast/.** Replace the render path's
`parseLessFn` + `tree.eval(context)` + legacy serialize with `parseToAst` + ast/ `serialize`
(the `whole-doc-driver` pipeline, promoted out of `__tests__` into a production module).
Import resolution moves onto the ast/ host (`resolveDirectImports`; the `collectFileVars`
legacy `parseLessFn` edge in `import.ts` is re-pointed at the ast/ parse). **Gate:** the
differential oracle (§4) shows no regression, and `benchmark.less` + `bootstrap.less` render
correctly (i.e. §1 gaps closed). Nothing else can precede this — it is the load-bearing flip.

**C2 — Single-target the grammar (retire the legacy `BuilderHost`).** With no consumer of
legacy `tree/` nodes on the render path, delete `BuilderHost` from
`less-parser/functional-parser.ts` and the legacy-`tree` construction in `builders.ts`;
delete `core/ast/parse-host/` after its construction relocates to the parser packages (REORG
A1–A4). The grammar now emits exactly one shape. **This is the step that lifts the
`§0.10 no-regex` exclusion shape-by-shape** — each Tier-B leaf-split that killed a P1/P2
misparse also removes a `builders.ts` re-parse regex.

**Deletion order within C2 (atomic-commit hazards):**
1. `:extend` marker protocol (css-parser producer + less-parser consumer) is **one commit** —
   splitting it loses extend instructions mid-migration (REORG §0.8b).
2. `import.ts` subsystem relocation carries its fixture corpus and the `%%`-splice **verbatim**
   in the same commit (REORG §0.8a).
3. trivia/`declParts`/`sliceSpan` byte-semantics port **verbatim**, gated on the FULL census
   not a family suite (highest byte-risk; REORG §0.8c).

### 2.1 Evaluated options — recommendation

- **(a) Freeze a legacy grammar snapshot** (grammar restructures freely; legacy renders off a
  frozen copy). **REJECT.** Doubles the grammar surface while Tier-B + the dialect re-base
  (W5–W7) are actively editing it; the frozen copy rots and diverges; and it does not remove
  the legacy `tree/` eval coupling — it only defers it. Violates "no permanent fallback."
- **(b) Coalescing shim on the dying `BuilderHost`** (re-merge newly grammar-split leaves back
  into the old legacy shape; isolated to the dying host, tagged, dies at deletion). **ADOPT
  TACTICALLY, not as the strategy.** Its *only* correct role: the window during Tier-B A0
  when the grammar begins leaf-splitting interpolation but the legacy `BuilderHost` is still
  the live renderer (before C1). The shim keeps the live render byte-stable across that window,
  then is deleted whole at C2. It is throwaway scaffolding, scoped to `functional-parser.ts`.
- **(c) Flip consumers to ast/, then delete the legacy path wholesale.** **RECOMMENDED as the
  endgame** = C1 → C2 above. It is the fastest route to a single-target grammar (which is what
  unblocks all remaining builder cleanup) and concentrates risk in one gated flip rather than a
  perpetual dual-shape maintenance tax.

**Recommendation: (c) as the spine, (b) only as the A0-window guard, (a) rejected.** Concretely:
close §1 gaps → **C1** flip render to ast/ (gated by §4 + the two fixtures) → **C2** delete the
legacy `BuilderHost` + `parse-host/` + legacy-`tree` construction (which mechanically closes
the burndown's `[GRAMMAR]`-tagged `t2`/regex/dead-code clusters as the directory disappears).

---

## 3. `less-compat` bridge (TAIL — after ast/ is the engine)

The bridge is **not** a gate and its byte contract is **not** preserved-in-place; it is
re-pointed at ast/ *after* C1. For the record (survey done, not acted on): the bridge consumes
the legacy **node model only** (never `Compiler.render`) — its `transform/` + `nodes/` adapters
(`toLessNode`/`fromLessNode`) read legacy `tree/` field shapes and call node-level `.eval()`.
Its external contract (the `less` mock: `less.tree` plain-object factories, `less.functions`
forwarding into the core scope, `less.visitors.Visitor` type-string protocol) is
engine-agnostic and survives if the adapters are re-authored against ast/ node shapes. That
adapter re-point is a **later** task, sequenced behind ast/ feature-completeness; it is not
allowed to hold up C1/C2.

---

## 4. Differential correctness oracle (task #32) — LANDED here

**Location:** `packages/core/src/ast/parse-host/__tests__/alpha-oracle-differential.test.ts`
(+ committed baseline `alpha-oracle-baseline.json`). It **replaces the buggy
`oracle-run.mjs`**, whose "oracle" was the legacy `tree/` Compiler (real `&`-expansion bugs on
benchmark.less → it flagged correct ast/ output as wrong).

**Design.** For each `*.less` with a sibling `*.css` in the owner-maintained less.js `alpha`
corpus (`~/git/worktrees/less.js/content-alpha3/packages/test-data/tests-unit`, override via
env `LESSJS_ALPHA_TESTDATA`; absent → suite skips), render through `ast/` and classify
`MATCH` / `MATCH_NORM` / `DIFF` / `THREW`. **The gate is baseline-diff, not `diff==0`:** a
fixture may not regress below its recorded baseline status; new `MATCH`es are welcome, and as
§1 gaps close the baseline entries are promoted (statuses only improve). Using the committed
`.css` goldens (not a live re-render) avoids circularity — less.js `alpha` itself wraps Jess.
The baseline IS the intended-divergence allowlist; the categorized rationale is §1c above.

**First diff result (91 paired fixtures):** `MATCH 25 · MATCH_NORM 1 · DIFF 54 · THREW 11`.
The 11 THREW map exactly onto §1b (E2 `unit`/cross-unit ×2, E3 color-fn ×5, E4 recursion ×1,
E5 scope/import ×2, hsl-args ×1). The DIFF bucket is dominated by declared divergences
(nesting/media/selectors), interpolation (P1/P2: `urls`, `strings`, `parse-interpolation`,
`property-name-interp`, `import-interpolation`), removed-feature fixtures
(`javascript-REMOVED`, `ie-filters-REMOVED`), and plugin fixtures (`plugin*`, `tailwind`).

> Harness follow-up (not blocking): the oracle currently classifies whole-file status; a
> per-line categorizer (declared-divergence vs P1/P2 vs new) would let DIFF fixtures be
> promoted incrementally. `benchmark.less` has no committed alpha golden, so it stays on the
> `bmark-ast-driver` self-consistency check; add a golden if the owner blesses one.

---

## 5. Coordination with the dialect re-base (W1 / W5–W7)

Canonical: `docs/future/parser-architecture/DIALECT-ARCHITECTURE-AND-ERROR-COVERAGE.md`.
That program restructures the **same builder-dispatch layer** this cutover retires, so:

- **W1 (name-keyed builder-map dispatch, `INVARIANT: builder key ≡ grammar rule name 1:1`)**
  is complementary, not colliding. The ast/ `ParseBuildHost` **already satisfies W1** (its
  `ACTION_LIST` is a name-keyed map). **Recommended order: W1 lands FIRST** — it is Phase-0,
  byte-identical, independent, and de-risks the legacy dispatch (kills the dead-override /
  sibling-interception trap) *before* C2 deletes that host. C2 then removes the legacy map
  entirely; the ast/ map, which honors the same invariant, is the survivor. **Owner of the
  legacy builder-map change = the dialect-re-base/parser owner (W1); this cutover consumes its
  result and must keep the same key≡rule-name invariant in the ast/ `ACTION_LIST`.**
- **W5–W7 (factor `preprocessorBase`, re-express `less = compose([preprocessorBase,
  lessSigilDelta])`)** touch grammar **rule composition**, whereas C1/C2 touch the build
  **host target** — separable surfaces. They may proceed in parallel provided **C2 consumes the
  re-base's FINAL grammar shape** (the same "consume final shape" discipline W5–W7 apply to the
  in-flight prelude sessions). Tier-B just landed (`e5f754a7b`), clearing part of the W5–W7
  prerequisite; the remaining wait is the two prelude sessions.
- **Order to avoid collision:** W1 (now) → Tier-B A0 leaf-splits + P1/P2 close (with the §2b
  shim guarding the live legacy render across the window) → §1b eval gaps close → **C1** render
  flip → **C2** legacy-host deletion, consuming the W5–W7 re-base's final grammar. C1/C2 do not
  edit `grammar.ts` rule composition, so they never merge-conflict with W5–W7.

---

## 6. Step sequence (what execution agents do)

1. **W1** name-keyed legacy builder map lands (parser owner; byte-identical de-risk).
2. **Tier-B A0** grammar leaf-splitting for interpolation → closes **P1, P2** (and the
   `TODO(tier-b/A4)` cp-name/import-spec deferrals); §2b coalescing shim keeps the live legacy
   render stable across the window. Gate: P1/P2 fixtures resolve; differential-oracle no
   regression.
3. **Eval-gap wave** → close **E1 (`each` expansion), E2 (cross-unit arithmetic), E3 (color-fn
   arg coercion), E4 (recursion), E5 (scope)**. Gate: `bootstrap.less` renders without throwing
   and matches the less.js oracle; corpus THREW count → 0 (minus out-of-scope network imports).
4. **Completeness checkpoint:** `benchmark.less` byte-correct (P1 resolved) AND `bootstrap.less`
   renders correctly. This is the owner's "feature-complete parse→eval" bar.
5. **C1** flip `Compiler.render` to the ast/ pipeline (promote `whole-doc-driver` to production;
   re-point the `import.ts` legacy edge). Gate: differential oracle + both fixtures green as the
   *production* renderer.
6. **C2** delete legacy `BuilderHost` + `parse-host/` + legacy-`tree` construction (REORG A1–A4
   deletion, atomic hazards per §2). Grammar single-target; `§0.10 no-regex` grep empty on the
   maintained path; package graph `parser → core` acyclic.
7. **Tail:** re-point the `less-compat` `transform/`+`nodes/` adapters at ast/ node shapes;
   then track Less v5 `alpha` parity.

**Gating rule:** steps 1–4 are the feature-completeness head and must complete before the C1
flip; step 6 deletion must not precede the C1 flip (the live consumers gate it).
