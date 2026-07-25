# Parseman 0.34.0 — grammar idiom plan (design, pre-implementation)

Status: **DESIGN — not built.** The parseman `0.32.0 → 0.34.0` bump itself is landed and
evidenced in §1; everything from §3 onward is proposed work.

Filed under `docs/design/` per `docs/README.md`: this document describes machinery the repo
does not have yet. When each per-parser section lands, delete it from here; when the whole
plan lands, move what survives to `docs/architecture/parser/`.

**Why this exists.** `parseman/examples/css/parser.ts` names
`jess/packages/css-parser/src/grammar.ts` as its "source of truth" — these four grammars *are*
parseman's reference implementation. They currently contradict the guidance the same monorepo
ships (`parser-thing/AGENTS.md`, `docs/guide/combinators.md`, `docs/guide/first-char-gating.md`).
The bar for every item below is **"would this be the example in the docs"**, not "it parses and
tests are green".

**Hard floor: performance.** A conversion that costs measurable parse time is not accepted as a
grammar exception. It is a **parseman bug** — file it with a measurement and a minimal repro, and
leave the hand-roll behind a grep-able `TODO(parseman-#NNN)` until the library fixes it.

---

## 1. The bump — landed, with evidence

Branch `parseman-034-adoption` off `origin/dev` `93e1aa49d`.

### 1.1 What "bump" means here

parseman artifacts are **version-locked**: `fusedBody` throws *"recompile — parseman does not fuse
across versions"* on a stamp mismatch (0.32.0 changelog). Every macro-compiled artifact must be
regenerated in topological order, not just the pins edited. The five macro-compiled packages, in
build order, are:

`@jesscss/internal-css-recognition` → `@jesscss/css-parser` → `@jesscss/less-parser` →
`@jesscss/scss-parser` → `@jesscss/jess-parser`

The repo's enforcement of that order is `scripts/verify-compose-integrity.mjs`, which does a clean
`rm -rf lib` + rebuild of exactly those five and fails on any `falling back to runtime` /
`references missing rule` signature. It was used as the bump gate and reported
**"Compose-integrity OK (no grammar degraded to the interpreter)."**

Pins changed (dev dep `0.34.0`, peer range `^0.34.0` — for a `0.x` package `^0.34.0` is
`>=0.34.0 <0.35.0`, i.e. already locked to the minor, which is the right shape for the invariant):
root `package.json`, `internal-css-recognition`, and all four parser packages.

### 1.2 AST byte-identity — **clean, zero movement**

Captured before and after, same worktree, same corpus, aggregate SHA-256 over per-file AST hashes
(`JSON.stringify` of a key-sorted, cycle-safe projection; parse errors are hashed too, so error
behaviour is compared as well).

| dialect | files | parsed OK | errored | aggregate 0.32.0 | aggregate 0.34.0 |
|---|---|---|---|---|---|
| css | 33 | 33 | 0 | `125a53f49af970fa…` | **identical** |
| less | 270 | 259 | 11 | `37a2a25fa61ab394…` | **identical** |
| scss | 1325 | 280 | 1045 | `c64786fb1eba7153…` | **identical** |
| jess | 52 | 37 | 15 | `b6df0b2377967bc3…` | **identical** |

Per-file diffs: **0**. Corpora: `packages/css-parser/test/css/*.css` (fed to all four dialects),
`@less/test-data/tests-unit/**` + `packages/jess/test/**` + `bootstrap-less-port/less/**`,
sass-spec cache (`packages/scss-parser/.cache/sass-spec/inputs`, 1200) + `bootstrap/scss/**`,
and every `.jess` file in the workspace.

The high SCSS error count is the sass-spec corpus containing indented-syntax and
deliberately-invalid cases; those hashes are part of the differential and also did not move.

### 1.3 Test gates

| gate | 0.32.0 | 0.34.0 |
|---|---|---|
| `@jesscss/css-parser` | 242/242 | 242/242 |
| `@jesscss/less-parser` | 439/439 | 439/439 |
| `@jesscss/scss-parser` | 290/290 | 290/290 |
| `@jesscss/jess-parser` | 239/239 | 239/239 |
| `all-less` (`test:less:test-data`) | 106/108 | 106/108 |
| `jess` package | 17 failures (named set) | **same 17, name-for-name** |

**`all-less` is 106/108, not 108/108 — and it is NOT the bump.** My first baseline that morning
was a clean 108/108. Two fixtures then started failing:
`tests-unit/css-3/css-3.less` (`rotate(-0.0000000001deg)` → `rotate(0deg)`) and
`tests-unit/variables/variable-advanced.less` (`add-px-2: 393.3527559px` → `393.35275591px`).
Both are numeric-precision, neither involves a parse difference — and both fixtures parse to
**byte-identical ASTs** at 0.32.0 and 0.34.0 (verified in the table above; they are in the corpus).

Cause: the corpus moved underneath the run. `node_modules/@less/test-data` symlinks to the live
`~/git/oss/less.js` working tree, where commit `dded69cc "test-data: v5 numeric-precision
expectations, 4.x snapshotted to legacy/"` rewrote `css-3.css` and `variable-advanced.css`
mid-session. **Proven by toggling back**: reinstalling parseman `0.32.0` and rebuilding all five
macro packages reproduces the same two failures. They are a real, pre-existing jess gap against
the owner-maintained v5 expectation (per the standing rule, a top-level `.css` diff is a jess bug
by default), and they belong to numeric precision — see `docs/design/numeric-precision-policy.md`
— not to this branch.

The jess-package failure set at both versions is those two plus the 15 known reds
(4 `@plugin`/script-runtime, 1 ruleset-merge, 1 bootstrap-clean-repro, 9 `tests-error/eval/*`).

**A third, intermittent `all-less` failure is infrastructure, not jess.**
`tests-unit/extend-exact/extend-exact.less` fails in roughly 2 runs out of 3 with
`Cannot find module '…/tests-unit/extend-exact/styles.config.cjs'` — a `cosmiconfig` TypeScript
loader race writing and re-reading a sibling `.cjs` inside the live `~/git/oss/less.js` tree. It is
not a render diff, it is not parse-related, and it does not reproduce deterministically. Worth its
own fix (the corpus harness should not transpile config files into a checkout it does not own), but
out of scope here.

### 1.4 Performance — **the bump is a measurable parse REGRESSION**

Method: same worktree, same directory, **git-toggle of the pins + full macro rebuild between every
block** (never two worktree dirs — see [[cross-worktree-bench-bias]]), interleaved `B A B A …`
across 4 rounds × 3 process runs each = 12 runs per version, 8 warmup + 25 timed iterations per
case per run, machine otherwise idle.

| case | runs A/B | 0.32.0 median | 0.34.0 median | Δ median | 0.32.0 min | 0.34.0 min | Δ min | 0.32.0 spread | 0.34.0 spread | 0.34 faster in |
|---|---|---|---|---|---|---|---|---|---|---|
| css/bootstrap.css (274 KB) | 12/12 | 12.728 ms | 12.523 ms | **−1.6 %** | 10.291 | 10.141 | −1.5 % | 11.73–31.52 | 11.34–25.71 | **11/12** |
| css/corpus (33 files) | 12/12 | 0.622 ms | 0.616 ms | −0.9 % | 0.549 | 0.517 | −5.9 % | 0.59–0.65 | 0.59–0.68 | 5/12 |
| less/benchmark.less (104 KB) | 12/12 | 24.660 ms | 30.954 ms | **+25.5 %** | 21.101 | 26.412 | +25.2 % | 23.19–81.77 | 27.82–63.46 | 3/12 |
| less/bootstrap-port (90 files) | 12/12 | 31.462 ms | 36.279 ms | **+15.3 %** | 25.763 | 30.020 | +16.5 % | 28.02–63.66 | 32.54–85.25 | 2/12 |
| less/test-data-unit (129 files) | 12/12 | 28.854 ms | 31.754 ms | **+10.1 %** | 23.267 | 27.513 | +18.2 % | 25.38–78.62 | 29.19–45.86 | 4/12 |
| scss/bootstrap (29 files) | 12/12 | 1.023 ms | 1.056 ms | +3.3 % | 0.851 | 0.867 | +1.8 % | 0.98–1.10 | 1.01–1.14 | 1/12 |
| scss/sass-spec (440 files) | 12/12 | 2.648 ms | 2.728 ms | +3.0 % | 2.082 | 2.190 | +5.2 % | 2.47–2.78 | 2.61–2.96 | 0/12 |
| jess/corpus (32 files) | 12/12 | 1.354 ms | 1.443 ms | +6.6 % | 1.004 | 1.072 | +6.8 % | 1.26–1.61 | 1.30–1.71 | 0/12 |

Aggregate across cases: Δ median mean **+7.7 %**, median **+4.9 %**; Δ min mean **+8.3 %**, median
**+6.0 %**.

Read honestly:

- **CSS is neutral-to-slightly-better** (−1.6 % median, 11/12 win-rate on the big file). The
  0.34.0 gating/first-set work does not cost CSS anything.
- **Less is the real regression** — +10 % to +25 % median, +16 % to +25 % on minima, low win-rate
  on all three Less workloads. Less is the dialect that dominates the repo's own benchmark.
- **SCSS (+3 %) and jess (+6.6 %)** are small but directionally consistent, with tight spreads
  (0.98–1.14 ms, 1.26–1.71 ms) — not noise.

**Hypothesis, stated as a hypothesis.** The 0.34.0 changelog says:

> **Fix: `not()` no longer leaks its speculative probe.** … compiled `emitNot` emitted no rollback
> of its own and relied on `emitFallible`'s failure-only path, so when the probed parser
> **succeeded** its captured leaves survived… *"Grammars with no `node()` and no recovery compile
> byte-identically."*

Every jess grammar has `node()` and trivia capture, so none is in that byte-identical class: the
fix adds real rollback work to every `not()`. Less has by far the most (`not(` sites, CST + AST:
**less 70**, scss 43, css 35, jess 31) *and* is the only dialect with `attempt()` (6 sites), so its
`not()`s run inside speculative frames that are themselves re-entered. That fits the magnitudes.

**But `not()` density alone does not explain the ordering** — scss (43) regressed less than jess
(31), and css (35) did not regress at all. So the mechanism is not proven, only consistent. It
needs a parseman-side profile before anyone claims it. Recorded as PARSEMAN ISSUE P-9.

**What this changes for §4.** The `not(not(X)) → peek(X)` and leading-`not` removals stop being
cosmetics and become *perf-recovery*: every `not()` deleted is worth more at 0.34.0 than it was at
0.32.0, and less-parser has the most of them. **Sequence the `peek()` conversions first in every
parser, and first of all in less-parser.**

**The bump is still the right call**: the leak `emitNot` closed is real, the AST did not move, and
the gating diagnostic — blind in the macro build until 0.34.0 — is what makes §4 possible at all.
But the regression should be filed, not absorbed silently.

---

## 2. What 0.34.0 actually adds (verified against `parser-thing` source, not recollection)

Export-surface delta `0.32.0 → 0.34.0`. **Removed: nothing.**

- **NEW:** `peek`, `oneOrMoreSep`, `analyzeGatingRules`; types `RepeatOptions`, `SepByOptions`,
  `TrailingSeparator`.
- **CHANGED:** `word()` gains a `caseInsensitive` opts overload (ASCII-folded first-set, still
  gates); `many`/`oneOrMore`/`sepBy` gain `{min,max}` + `trailing`; `RulesOptions` gains
  `scanSkip` (0.33.0); `ScanToOptions` gains `raw` and `skip` now **extends** rather than replaces;
  `AnalyzeGatingOptions` gains `entryName` + `resolveRef`; `GatingReport` gains `deferred`.
- **DEPRECATED:** `guard` (alias of `gate`, since 0.32.0).

Three behaviour changes matter to jess:

1. **0.33.0 — `scanTo`/`balanced` ambient skip.** `scanTo` now skips ambient **trivia** during a
   scan; both consult ambient `scanSkip`; per-call `skip` **extends** rather than replaces;
   `raw: true` restores the old raw byte walk. A sentinel hidden in a comment is no longer matched.
2. **0.34.0 — `not()` probe rollback** (see §1.4).
3. **0.34.0 — the gating diagnostic was BLIND in the macro build.** `compileRuleMap`/`compileLinkable`
   never ran the analysis, so a macro-built grammar reported zero findings. This is why nothing in
   this repo ever caught any of §4: **the diagnostic has been on by default since 0.32.0 and has
   been reporting nothing.** The 0.34.0 rebuild emits **202 ungated choices and 28 anti-patterns**
   across the five packages, on the first build.

Fourth, and the one that unblocks the biggest item: **shared grammar SHAPES**. A `rules()` map may
now leave holes (`g.Value`, bound by whoever composes it) and still ship compiled — the macro
stamps compiled linkable pieces so a downstream `compose()`/`composeLeaf()` fuses it statically.

### 2.1 What jess uses today, and what it has never used

Union of every value imported from `parseman` anywhere in jess (22 files):
`attempt, balanced, choice, compose, composeLeaf, expect, field, label, leaf, literal, many,
noTrivia, node, not, oneOrMore, optional, parseDoc, parser, regex, rules, run, scanTo, sepBy,
sequence, trivia, withCtx`.

**Never used anywhere:** `word`, `keywords`, `makeWord`, `peek`, `oneOrMoreSep`, `gate`,
`transform`, `token`, `analyzeGating*`, `formatGatingWarnings`, `rules({scanSkip})` (one exception,
below), repetition `{min,max}`/`trailing`, `node(…, {trailingTrivia})`, `parser({captureTriviaKinds})`.

The single exception, and the one construct in the four grammars that is already exemplary:
`less-parser/src/ast/grammar.ts:1515` declares
`rules({ trivia: whitespace, scanSkip: [scanSkipDoubleString, scanSkipSingleString, blockComment] })`.
That is the reference use of the 0.33.0 feature; the other seven grammars hand-roll it per call.

### 2.2 Structural note for the fan-out

There is **no `productions/` directory in any parser package** on this branch. Each parser is
exactly `src/grammar.ts` (CST) + `src/ast/grammar.ts` (AST), plus
`scss-parser/src/ast/lower-user-function-calls.ts`. The standing rule "never create
`productions.ts`, upgrade the existing `productions/*.ts`" has no target here — **do not create
that directory either.** Work in the two existing files.

---

## 3. CENTRAL — must land once, before any fan-out

These change `internal-css-recognition` or `css-parser`, which all four dialects `composeLeaf`.
Per [[stale-recognition-lib-masks-dev-failures]], **`internal-css-recognition` must be rebuilt
first** or the downstream packages test against a stale `lib/` and report a false green.

**C-0 — Land the gating snapshot tests FIRST, with today's counts as the baseline.**
No package in the repo calls `analyzeGating*`. Add one test per package using
`analyzeGatingRules(ruleMap, { accept: ACCEPTED, resolveRef })` and assert **both**
`report.ungated.map(c => c.id)` is `[]` **and** `report.acceptedUnused` is `[]`. The second
assertion is the ratchet: it forces the accept list to shrink as §4 lands. Baseline counts:
css 62 (58 own + 4 shared), less 52 (48 own + 4 shared), scss 48 (34 own + 14 Less-inherited),
jess 36, internal-css-recognition 4. Per-package accept lists are in §4.

**C-1 — Re-run the §5.0 shared-shape spike against 0.34.0, and update §5.2.**
`docs/architecture/core/PSEUDO-ARGUMENT-CONSOLIDATION-DESIGN.md` §5.2 records the shared-external-ref
shape as *"IN FLIGHT (parseman PR targeting 0.34.0 — NOT landed; do not plan a landing against it
yet)"*. **That status is stale.** Both named changes are present in 0.34.0 source:
(a) `parser-thing/src/plugin/index.ts:1264-1275` now stamps carried pieces via `compileLinkable` +
`hasExternalRuleRef` when `compileRuleMap` cannot inline; (b)
`parser-thing/src/codegen.ts:4630-4650` `hasSemanticReduction` now takes `externalRefs` and returns
`false` for a hole while every other lazy failure still fails closed. The `GatingReport.deferred`
bucket corroborates it.
**What is still unknown is exactly what §5.0 said was unknown**: whether the §3a-shaped artifact is
byte-identical end-to-end across all four parsers with each `*macro-compiled*.test.ts` still proving
fusion. That is a spike, not a code read. §5.2's two residual limits are unchanged and load-bearing:
**`composeLeaf`'s non-final-argument gate still requires recognition-only**, so a shared shape may
carry holes but **may not carry reducers**; and generic `compose()` still drops `captureTerminals`.
Update §5.2 in the same turn as the spike result ([[feedback-tuned-decisions-update-docs]]).

**C-2 — At-keyword terminals in `internal-css-recognition/src/recognition.ts` are keyword-regexes.**
`R:51,56,57,58,59,60,64,74,75,77,87` (`conditionalAtKeyword`, `mediaContainerAtKeyword`,
`mediaAtKeyword`, `containerAtKeyword`, `supportsAtKeyword`, `startingStyleAtKeyword`,
`pageAtKeyword`, `scopeAtKeyword`, `descriptorAtKeyword`, `layerAtKeyword`,
`fontFeatureValuesAtKeyword`). Converting here fixes the anti-pattern for all four dialects at once.
**CRITICAL:** the file uses **two** boundary classes and they must not be unified — `R:51-77` use
narrow ASCII `(?![-\w])` (= `boundary: '-_0-9A-Za-z'`, documented at `R:61-63`/`R:84-86` as
deliberately preserved legacy behaviour: `@pageé` = at-keyword + prelude), while `R:66,67,68,88`
use the wide `(?![-_a-zA-Z0-9-￿\\])` which `word()` **cannot express** → PARSEMAN
ISSUE P-3.

**C-3 — `R:39` `important` and `R:14` `urlOpen` take `literal(..., { caseInsensitive: true })`, not
`word()`.** Neither has a trailing boundary today; `word()` would add one and silently tighten
`!importantX`. Per the docs table, `literal` is "a fixed token with **no** word-boundary
requirement". Same for the css-parser-local copies `G:220`, `G:67`.

**C-4 — One CSS comparison terminal, not two.** `recognition.ts:72` `queryComparisonOperator` and
`css-parser/src/grammar.ts:722` `mfComparison` spell the same mediaqueries-4 §4 range operator two
ways — and `R:69-72`'s own comment says "the CSS range spelling itself must not drift into
parser-local scanner logic". The **CST is the sole holdout**: the css AST grammar
(`A:1592,1594,1608,1610`), less (`ast:3499,3500,3524,3525`) and scss (`ast:1693,2202`) already
consume `g.CssAstSyntaxQueryComparisonOperator`.
The "re-spelled 4×" premise is **understated, and split across two languages**: the CSS-semantic
operator is spelled 2×, but the *guard/condition* operator (a different language — `=~`, `=>`, `=<`,
`==`, `!=`) is spelled 8× in less-parser, 2× in scss-parser and 5× in jess-parser. Those must NOT
be unified with the CSS one (§5, LD-4) but each dialect must collapse its own copies (§4).

**C-5 — `R:83` `genericAtRuleName` hand-maintains a duplicate of the known-at-keyword set.**
Its negative lookahead lists ~19 at-rule names that are each *also* declared as their own terminal
in the same file. Any at-rule added to one and not the other silently reclassifies a known at-rule
as opaque **in all four dialects**. Not mechanically fixable — owner question O-3.

**C-6 — New shared recognizers requested by the dialects** (each removes a leading-`not` from at
least two parsers):
- `CssAstSyntaxNonOnlyKeyword` — keyword leaf with a `(?!only(?![-\w]))` prefix. Kills
  `sequence(not(g.CssAstSyntaxQueryOnly), …)` in jess (`ast:2317`, `:2336`), less and scss.
- `CssAstSyntaxNonUrlFunctionName` — kills `not(regex(/url(?=\()/i))` (jess `ast:1919`).
- `CssAstSyntaxCustomPropertyTail` — the post-`--` run, so a dialect can write
  `sequence(literal('--'), choice(interpTail, g.CssAstSyntaxCustomPropertyTail))` instead of a
  choice whose two arms share `--` (jess `ast:2805`).
- `Num`/`Dimension` left-factor in the **CST** — the AST grammars already did this
  (`jess ast:1509` `noTrivia(sequence(Number, optional(Unit)))`); the CST inherits the two-rule
  split from css-parser and every dialect reports the `+ - . 0-9` overlap.

**C-7 — `PseudoSelector.nth` in core** (blocks jess J-1). See §4.4.

**C-8 — `(g: any)` on the CST `rules()` factory is repo-wide** —
`css-parser/src/grammar.ts:92`, `less-parser:32`, `jess-parser:40`, `scss-parser:30` — plus
`(s: any)` on the gate predicates at `scss-parser/src/grammar.ts:725` and `jess-parser:98`.
This violates the ABSOLUTE no-`any` rule. The AST grammars already use the typed
`rules<XAstRules>(…)` form; that is the model. **Fix once, centrally, before the fan-out** so four
agents do not each invent a different type.

**C-9 — do not touch `internal-css-recognition/src/pseudo-consts.ts`.** All six rules are `g`-free
`regex()` with cited spec sections, it produces **zero** gating findings, and its header documents
why the `rules()` recognition-map shape is the proven cross-package mechanism. It is the model the
other shared artifacts should follow.

### 3.1 Two "known offenders" that are already closed — do not re-fix

- **`,` modelled as `optional(literal(','))` inside a clause.** **FIXED, in all four.**
  `css-parser/src/ast/grammar.ts:1664-1668` carries the fix and its rationale verbatim: *"A clause
  is one `<media-query>`… the comma belongs to the enclosing `<media-query-list>` (mediaqueries-4
  §2.1), so it must not be an optional separator here — swallowing it collapsed `screen, print`
  into a SpacedValue instead of the List the other three dialects produce."* less, scss and jess
  all model the comma correctly (`less ast:3623/3660`, `scss ast:2305-2316/1748-1755`,
  `jess ast:2366` → `list(values, ',')`). The remaining `optional(literal(','))` sites are
  deliberate **trailing**-comma tolerance (scss `ast:1846,1874`; less `grammar.ts:603`) and are
  correct.
- **"hand-rolled `sepBy`, 0 uses of `sepBy` in the css grammar."** Half right: **0 in the CST, 3 in
  the AST** (`css ast:986, 1223, 1253`), and all three are correct `sepBy` (genuinely-optional
  argument lists — `f()` is legal). The real finding is the *hand-rolled* count, which is much
  larger than "repeatedly": **css 23, less 11 (+5 nullable-`sepBy`), scss 20, jess 22.**

---

## 4. Per-parser plans

Each subsection is independently executable **after §3 lands**. Every item is gated on: the
package's own suite, `*macro-compiled*.test.ts` (which proves fusion rather than interpreter
fallback — mandatory on every item), and AST byte-identity over the corpus in §1.2.

### 4.0 Conventions

- **AST-neutral by the sink lemma.** `node()` collects children through a capture sink over the
  node's extent (`parser-thing/src/combinators/node.ts:150`), *not* from the combinator return
  shape. So (a) re-nesting bare `sequence`s (left-factoring) inside a `node()` does not change the
  `children` array, and (b) `sepBy`/`oneOrMoreSep` drop the separator from their *value* but the
  separator's `literal()` still fires inside the capture extent, so children are unchanged.
  `peek()` explicitly rolls back the capture sink and contributes no child.
  **Every "AST-neutral: yes" below rests on this lemma; an executing agent that touches a reducer
  must re-check it for that reducer.**
- **`word()` boundary mapping.** CST spelling `(?![-\w])` → `word('kw', '-_0-9A-Za-z')`.
  AST spelling `(?![-_a-zA-Z0-9-￿])` → `word('kw', '-_a-zA-Z0-9\\u0080-\\uffff')`.
  Preserve `/i` exactly: pass `{ caseInsensitive: true }` only where the current regex has it.
- **Two module-level boundary `const`s are permitted** (parameterless). **`makeWord(boundary)` is
  NOT** — it is a factory and is forbidden by the grammar-dedup macro-constraint.
- `keywords([...])` is longest-first by construction, so hand-ordered "longest alternative first"
  comments become obsolete and should be deleted with the conversion.

---

### 4.1 `css-parser` (+ it OWNS `internal-css-recognition`)

Gating baseline: 62 findings (58 own + 4 shared). Anti-patterns: 24 `keyword-regex`, 4 `leading-not`
— **the only package where the diagnostic surfaced anti-patterns at all** (see PARSEMAN ISSUE P-2).
`not(not(X))`: **0**. This package is clean of the double-not offender.

| id | what | where | AST-neutral | risk |
|---|---|---|---|---|
| CSS-1 | CST comma lists → `oneOrMoreSep` | `G:141` SelectorList, `G:257` valueList, `G:569` KeyframeSelectorList, `G:773` queryPrelude tail | yes¹ | MED |
| CSS-2 | AST comma lists → `oneOrMoreSep` | `A:841, 902, 1141, 1153, 1322, 1358, 1684, 1804, 1867` | yes | LOW-MED |
| CSS-3 | operator lists → `oneOrMoreSep` | `G:297, 300, 766`; `A:1176, 1181, 1660, 1781` | verify per site | **HIGH — do last, one at a time** |
| CSS-4 | **do NOT convert** (nullable separator) | `G:148`, `A:897`, `A:1120` | — | — |
| CSS-5 | at-keyword `regex` → `word`/`keywords` (12 sites) | `G:385, 522, 523, 525, 528, 531, 534, 591, 594, 615, 616, 698` | yes | LOW |
| CSS-6 | query keywords → `word`/`keywords` | `G:196, 765, 766` | yes | LOW |
| CSS-7 | keyframe selectors → `keywords(['from','to'])` | `G:563` | yes | LOW |
| CSS-8 | no-boundary keywords → `literal(…,{caseInsensitive})` | `G:67, 220` (+ C-3) | yes | LOW |
| CSS-9 | `atToken`'s leading `not(...)` | `G:502-505`, `G:506` | see note | MED |
| CSS-10 | `peek()` for `(`-anchored function names | `G:351, 721`; `A:1161, 1186, 1275` | yes | LOW |
| CSS-11 | port the AST's `pseudoArg` left-factor back into the CST | `G:195-199` ← model at `A:687-759` | **NO** | **HIGH, owner-visible** |
| CSS-12 | gating snapshot test | new `test/gating.test.ts` | n/a | none |

¹ `sepBy` adds tolerant-mode error recovery the hand-roll lacks (`repeat.ts:369-385`,
`recoverScan` on a junk first element when `ctx._tolerant`). That changes **error/recovery** output
for the language service, not happy-path bytes — gate CSS-1 on `packages/language-service-tests`
as well.

**CSS-5 table** (all `{ caseInsensitive: true }`, all `boundary: '-_0-9A-Za-z'` — do **not** widen
to `-￿`): `@supports`, `@starting-style`, `@layer`, `@scope`, `@page`,
`@font-feature-values`, `@import` → `word(...)`; `@media|@container|@supports`,
`@media|@container`, the 7-name `descriptorAtKeyword`, the 16-name `marginAtKeyword`, the 7-name
`featureTypeKeyword` → `keywords([...])`.

**CSS-9 note.** `not(atRunStop)` exists solely to forbid a zero-width match (documented at
`G:496-497`). Removing it is AST-neutral in principle (`not()` is zero-width), **but its
byte-behaviour is coupled to the bump** — at 0.32.0 a *successful* `not()` probe leaked `_triviaLog`
entries and captured leaves; 0.34.0 fixed that. Measure after the bump, not before. If it cannot be
made zero-risk, leave the `not` and accept `atTokenStream` in the snapshot with a `TODO`.

**CSS-10 exclusions.** Do **not** apply the same rewrite to `A:1404` `regex(/(?=calc\()/i)` or
`G:487` `supportsCondAhead` — those are *pure* zero-width probes that today emit an empty-string
leaf; `peek()` emits none, and `A:1413-1427`'s reducer indexes `children`. Real AST delta.

**CSS-11 is an acceptance tightening**, the same one the AST already took
(`:nth-of-type(2n of .a)` stops being accepted in the CST). The consolidation design §5 step 1
records it as intended and asks to "confirm no alpha fixture depends on it" → owner question O-4.

**Proposed accept list (CST):** `pseudoArg#0/#1/#2`, `UnknownAtRuleBlock`,
`atTokenStream#0/#2/#3`, `AtRuleBlockTop#0/#2/#4/#5/#6`, `AtRuleStatement#2/#3`,
`AtRulePreludeSegments#0/#2/#3`, `CustomDeclaration#1/#2/#3`, `combinator`, `ComplexSelector`,
`value`, `mathProduct`, `Url`, `Call`, `QueryFunction`, `stylesheetBody`, `declarationList`,
`descriptorBody`, `pageBody`, `AtRuleBlock`, `QueryCondition`, `QueryInParens#1`.
**(AST):** `balancedParens`, `balancedBrackets`, `balancedBraces`, `customValue#1/#2/#3`,
`importTailGroup`, `importTailSquareGroup`, `CssAstDocument`, `CssAstConditionalBlock#0/#1`,
`CssAstNestedConditionalBlock`, `CssAstStartingStyleBlock`, `CssAstScopeBlock`,
`CssAstDocumentBlock`, `CssAstQueryClause#0/#1`, `CssAstSupportsCondition`, `CssAstDeclaration#0`,
`CssAstDeclarationValueTerm`, `CssAstValueTerm`, `CssAstImportUrl`, `CssAstUrl`, `CssAstPseudo#0`.
The 4 shared ids (`cssBrace`, `preprocessorBrace`, `CssAstOpaqueCapturePrelude#1`,
`JessAstOpaqueStaticPrelude#1`) belong in `internal-css-recognition`'s own gating test.

**Upgrade risk specific to this package (0.33.0 ambient skip).** The CST declares
`rules({ trivia: rw, scanSkip: [singleStr, doubleStr] })` at `G:92` where `rw` **includes block
comments**, so two sites change behaviour: `G:248` `CustomDeclaration` (`--x: /* ; */ red;` stops
terminating at the comment's `;`) and `G:742` `queryFunctionBody` (a `)` inside a comment stops
closing the query function). Both are *more correct* and both are byte changes — reconcile `G:248`
against the owner decision [[custom-property-edge-whitespace-vs-comments]]. **The AST grammar is
already 0.33-shaped** (`A:659`: trivia is whitespace-only, comments are explicit `scanSkip`), so
the CST is the whole exposure. Note the §1.2 byte-identity run covers this and found no movement —
but the corpus may simply lack a comment-hidden sentinel; add the targeted fixture.

---

### 4.2 `less-parser`

Gating baseline: 52 findings (48 own + 4 inherited). `not(not(X))`: **6, all verified**, and
**all six sit among shared-first-char sibling arms** — the configuration the docs say
`not(not(...))` *miscompiles* in. These are correctness fixes, not cosmetics.

| id | what | where | AST-neutral | risk |
|---|---|---|---|---|
| LESS-1 | `not(not(X))` → `peek(X)` ×6 | `grammar.ts:851`; `ast:2053, 2217, 2563, 3184, 4510` | yes | LOW |
| LESS-2 | hand-rolled sep-lists → `oneOrMoreSep` ×6 | `grammar.ts:428, 736, 901`; `ast:3729, 4483, 4493` | yes | LOW-MED |
| LESS-3 | nullable `sepBy` where the list cannot be empty ×5 | `grammar.ts:475, 870(×2), 1081, 1149` | see note | LOW-MED |
| LESS-4 | one comparison terminal, not 8 | `grammar.ts:320, 784, 849`; `ast:1148, 1485, 1486, 1487, 1491` | mixed | MED |
| LESS-5 | `keyword-regex` → `word`/`keywords`, CST (18 sites) | `grammar.ts:266, 345, 353, 356, 358, 393, 461, 700, 779, 780, 781, 965, 1075, 1077, 1089, 1114, 1146, 1147` | yes | LOW |
| LESS-6 | `keyword-regex` → `word`/`keywords`, AST (16 sites) | `ast:1343, 1412, 1438, 1479, 1480, 1481, 1490, 3007, 3049, 3085, 3090, 3095, 3106, 3111, 3116, 3342, 3667, 4095, 4430` | yes | LOW |
| LESS-7 | dedup the `default()` guard regex ×3 | `grammar.ts:334`; `ast:3019, 3051` | yes | LOW |
| LESS-8 | `regex()` spelling a bare literal ×5 | `ast:1484`; `grammar.ts:47`; `ast:3918, 3923, 4102, 4120` | yes | LOW |
| LESS-9 | hoist `scanSkip` into `rules()` (CST) | `grammar.ts:32, 62-64, 195, 370, 443, 852, 1181` | verify per site | **MED — the one item I could not clear by reading** |
| LESS-10 | split nullable-prefix choice arms ×7 | `ast:3049, 3095, 3613, 3650`; `grammar.ts:345, 425, 1083` | yes² | LOW-MED |
| LESS-11 | left-factor the `/`-overlapping trivia arms | `grammar.ts:30`; `ast:1361, 1383` | see §5 LD-8 | LOW |
| LESS-12 | delete dead exported rules | `grammar.ts:331` `Comparison`, `:440` `pseudoArg` | yes | LOW |
| LESS-13 | **bind the shared nth name instead of duplicating it** | `ast:1500` → `g.CssAstSyntaxNthName` | yes | LOW |
| LESS-14 | `attempt()` reduction (2 of 6) | `ast:2220, 2387` | measure first | MED |
| LESS-15 | `queryPrelude` media-type asymmetry | `grammar.ts:1082-1083` | yes for well-formed | **MED-HIGH** |
| LESS-16 | gating snapshot test | new `test/gating.test.ts` | n/a | none |

² verified position-independent for the four AST reducers (`3080`, `3101`, `3619` filter children
by predicate); verify `grammar.ts:345/425` before splitting.

**LESS-1 detail.** `ast:2217` `directMixinReferenceAhead` → `peek(regex(/[.#][^;{}]*[([]/))` and
`ast:3184` `directLessMixinStatementAhead` → `peek(regex(/[.#][^{};]*[(;]/))` are the two that
*gain real dispatch* (non-nullable `[.#]` head). The other four have nullable bodies → anti-pattern
and correctness only, no dispatch gain. All six should land regardless.

**LESS-3 detail.** `grammar.ts:1081` `ImportMedia` is **a live AST bug**, not a tidy-up:
`node('ImportMedia', sepBy(...))` is nullable and `grammar.ts:1155` wraps it in `optional(...)`, so
a nullable node inside `optional` always succeeds and **every `@import "x.less";` with no media
list emits an empty `ImportMedia` node.** Fixing it removes that node — verify against
`_buildImport`. `grammar.ts:475` (`:extend()`) and `:1149` (`@import () "x"`) become parse errors;
both are invalid Less → owner question O-5.

**LESS-13 detail — the highest value-per-line item in the file.**
`ast:1500` `directStaticNthPseudoNameBoundary` is a **byte-for-byte duplicate** of
`CssAstSyntaxNthName` (`pseudo-consts.ts:31`), whose own docstring says *"This is the shared form of
Less's `directStaticNthPseudoNameBoundary`."* Less already fuses `cssAstPseudoSyntax` and already
uses `g.CssAstSyntaxNthChildName`/`NthTypeName`/`OfKeyword` — it simply never bound `NthName`.
Zero central change required.

**LESS-14 / HANDOFF cross-reference.** `docs/architecture/core/HANDOFF.md` marks "Less decl-vs-ruleset
speculation" `[~]` — *addressed by gating, not left-factoring*: `53163def8` is
`directLessRulesetNotDeclaration` (`ast:3214`) and `e6782a2dc` is `directLessMixinStatementAhead`
(`ast:3184`). Those are exactly the constructs LESS-1 and the leading-`not` item touch.
**The full shared-prefix left-factor is still open and marked HIGH-risk — do not attempt it in this
sweep.** LESS-1 is the correct incremental step: it converts the *existing* gates to the idiomatic
primitives without reopening the left-factor question.

**`ast:3214`'s leading `not()` — accepted, not fixed.** `not()`'s first-set is `any` so the arm can
never gate, and `peek` cannot express a negative. Both idiomatic alternatives (move the guard past
`DirectLessRuleset`'s first concrete terminal; a gated arm) change *when* the guard runs, which is
the whole point of the construct (documented at `ast:3202-3213`). Accept it in the snapshot with a
comment citing the HANDOFF `[~]` item. **This is an explicit accept with a reason, not a silent
exception.**

**Proposed accept list** (POST-conversion residual only): `topProduct`, `MixinArgs#2/#4`,
`VarDeclaration#1`, `GuardTerm#0`, `CondArgAndOp`, `ArgCondition#1`, `CondArgTermOp#0…#4`,
`DirectLessMixinArguments#0/#1/#2`, `DirectLessCallArgumentValue`, `DirectLessMixinParam#1`,
`DirectLessGeneralEnclosedContent#0`, `DirectLessCustomPart`, `DirectLessCustomInnerPart`,
`DirectLessStaticPseudoQuoted#1/#2`, `DirectLessDeclaration#0/#1`,
`DirectLessCustomPropertyName#0/#1`, `DirectLessInterpolatedProperty#0/#2`,
`DirectLessInterpolatedAttributeToken`, `DirectLessInterpolatedNthPseudo#1`, `DirectLessRuleset`,
`DirectLessInlineExtendRule#1`, + the 4 inherited ids.
**Must NOT appear** (the conversions eliminate them): `rw`, `mathTrivia`, `staticSelectorTrivia`,
`directProductOperator#0`, `directTopProductOperator#0`, `queryPrelude`, `DirectLessQueryClause`,
`DirectLessMediaContainerBlock#0…#5`, `DirectLessMixinGuardTerm`, `DirectLessSupportsCondition`,
`DirectLessKeyframeBlock`.

---

### 4.3 `scss-parser`

Gating baseline: 48 findings — but **14 of them are Less-inherited rules SCSS cannot legally
reach** (`MixinArgs#2/#4`, `CondArgAndOp`, `CondArgTermOp#0…#4`, `ArgCondition#1`, `GuardTerm#0`,
`mathProduct#0`, `preprocessorBrace`, `JessAstOpaqueStaticPrelude#1`).

**Headline finding — [[scss-should-compose-on-css-not-less]] is NOT what the code does.**
`packages/scss-parser/src/grammar.ts:30` is `compose([lessGrammar, cssAstSyntax, rules(…)])` and
`package.json` declares `@jesscss/less-parser` as a hard **dependency**. There is no
`preprocessorBase` and no name-keyed builder MAP anywhere in the package. The CST inherits
`g.LessAmpersand`, `g.Guard`, `g.blockItem`, `g.stylesheetItem`, `g.AnonymousMixinDefinition`,
`g.DetachedRuleset`, `g.MixinArgs`, `g.CondArg*`, `g.GuardTerm`, `g.basicSel`, `g.extendAhead` from
Less. **The AST grammar already complies** (`ast:943` `composeLeaf([cssAstSyntax,
opaqueAtRuleRecognition, cssAstPseudoSyntax, rules(…)])`, no Less). So the two halves of the package
disagree about the base → owner question O-6.

| id | what | where | AST-neutral | risk |
|---|---|---|---|---|
| SCSS-1 | **retire 15 local copies of shared recognition leaves (~45 call sites)** | `ast:890, 891, 892, 898, 899, 913-921, 941` | yes | LOW |
| SCSS-2 | hand-rolled sep-lists → `oneOrMoreSep`/`sepBy` (18 of 20) | `grammar.ts:166, 195, 203, 307, 310, 545, 587`; `ast:1633, 1715, 1750, 1846, 1874, 1996, 2099, 2110, 2268, 2415, 2917` | yes | LOW-MED |
| SCSS-3 | `regex(/@kw/i)` → `word`/`keywords` (46 sites) | `grammar.ts` 22 + `ast` 24, listed below | yes | LOW |
| SCSS-4 | `not(not(X))` → `peek(X)` ×2 | `grammar.ts:573`; `ast:2974` | yes | v.LOW |
| SCSS-5 | **left-factor the 3 conditional-block choices** (the P3 item) | `ast:2129, 2545, 2672` | yes³ | MED |
| SCSS-6 | hoist `scanSkip` into `rules()` | `grammar.ts:30, 479-485, 527, 557, 574, 667, 693` | yes | LOW |
| SCSS-7 | drop now-redundant `skip` entries | `grammar.ts:572`; `ast:943, 2248` | yes | LOW |
| SCSS-8 | CST comparison regex → bare-literal choice | `grammar.ts:286` | yes | v.LOW |
| SCSS-9 | gating snapshot test | new `test/gating.test.ts` | n/a | none |

³ verify `children[1]` is still the prelude in all three reducers before landing — this is the one
SCSS conversion where a mis-step changes reducer indices.

**SCSS-1 is pure catch-up, with a precedent.** `git log -L 880,921` shows these copies were never
included in `5cc69d791` ("retire the local first-set regex copies — 0.32.0 gates them natively"),
which covered **less and css only**. Confirmed by count: `g.CssAstSyntaxMediaAtKeyword` uses —
css 4, less 2, jess 2, **scss 0**. Delete the 15 consts, replace ~45 uses with `g.*`, and delete
the three stale comment blocks (`881-889`, `893-897`, `906-912`, `935-940`) that justify the copies
with a pre-0.32.0 `composeLeaf` limitation that no longer exists. Keep exactly two module-scope
consts for the options-first `rules({scanSkip})` call at `ast:943`, which runs before `g` exists.
**Verify the `5cc69d791` way: instrumented `RegExp.exec/test` probe counts over one full parse must
be EXACTLY equal before/after** — that commit proved gating by counting, not by inference.

**SCSS-5 — what structurally causes `NestedConditionalBlock` self-time.** All three rules have the
shape `choice(seq(supportsKw, SupportsPrelude, '{', BODY, '}'), seq(mediaOrContainer, QueryPrelude,
'{', BODY, '}'), seq(mediaOrContainer, StaticMediaPrelude, '{', BODY, '}'))`. Arms 1 and 2 are
identical except for the prelude, but the shared prefix is spelled as **two separately-constructed
`choice(…)` objects**, so parseman's `sharedPrefix` auto-detection — which needs **object
identity** — cannot fire. Consequence: for any `@media` whose prelude is not a structured query,
arm 1 re-parses the at-keyword and, if the prelude succeeds but the body fails, **re-parses the
entire `directScssNestedKeyframesBody`** (a `many(choice(…))` over ~18 arms). *Body re-parse is the
cost.*
Proof that object identity is the mechanism: `DirectScssPseudo`'s five arms all share the **same
`pseudoColon` object** (`ast:890`, used at `2930/2946/2969/2988/2998`) and consequently do **not**
appear in the gating report at all.
Two fixes: **minimal** — hoist one `mediaOrContainerAtKeyword` const and use the same object at all
six sites; **full (recommended)** — left-factor so the body is parsed exactly once.
HANDOFF P3 records the 15%-self figure as *UNVERIFIED since 2026-07-22*; re-measure with the
controlled method before and after ([[feedback-perf-claims-need-controlled-measurement]]).

**SCSS-3 keyword sets** (the textbook `keywords([...])` collapses): `@debug|@warn|@error`
(`grammar.ts:593-599` — the one confirmed structurally-visible `keyword-regex` site),
`@media|@container` (`:748`), `@media|@container|@supports` (`:791`),
`@charset|@namespace|@layer` (`ast:2508`), `through|to` (`ast:2037` — longest-first is *required*
and `keywords` guarantees it; the current `choice` gets it right only by authoring order),
`true|false` (`ast:2051-2052`), `from|to` (`ast:869`).
**Not convertible:** `grammar.ts:771` `supportsCondAhead`, `ast:934` `scssGenericAtRuleName`
(negative-lookahead exclusion list), `ast:2881/2884` (`(?=\()` boundary — see P-4).

**SCSS-4 is NOT a latent correctness bug** — I asked for this to be checked and the answer is no.
`detectAntiPatterns` (`gating.ts:342-353`) inspects only `peelToLeading(arm)`, and neither site
leads: `grammar.ts:573` leads with `literal(',')` in a first-char-disjoint sentinel choice, and
`ast:2974` sits at position 4 of a sequence whose arm gates on the shared `pseudoColon` object.
Perf/idiom conversion only. **Do not report it as a bug.**

**Residual text-joining — one live violation.** The SCSS `text`→`structure` pseudo migration did
land for the structured pseudos (`ast:2957-2983` keeps a `SelectorList` in `args`). Three joins
survive: `:global`/`:local` (`ast:2988` — deliberate, sealed, §5 LD-6), the attribute selector
(`ast:2815` — canonical node shape, §5 LD-7), and **`DirectScssGenericPseudo` (`ast:2998`) →
`DirectScssStaticPseudoArgument` (`ast:2848`) → `joinSourceText`**, which is a genuine live
violation of [[parser-pseudo-args-always-structured]] ("always parse structure, even for
unknowns"). It is the same unknown-pseudo-argument problem css-parser owns → owner question O-7.

**Proposed accept list:** `rw`, `ScssComparison`, `ScssCondInParens`, `ScssCallArg`,
`functionCallArgs`, `Call#0/#1`, `VarDeclaration#1`, `Declaration#8`, `CustomDeclaration#10`,
`declarationList#6/#15`, `Stylesheet#5/#14`, `ScssPlaceholderRuleset#4/#13`, `DirectScssMathUnary`,
`DirectScssMixinCallArg`, `DirectScssIfAtom`, `DirectScssCustomPart`, `DirectScssCustomInnerPart`,
`DirectScssCustomPropertyName#0`, `DirectScssDeclaration#0`, `DirectScssMixinDef#1`,
`DirectScssStaticImportSupports`, `DirectScssStaticImportMediaClause#0`,
`DirectScssSupportsCondition`, `DirectScssSupportsAtom#0`, `DirectScssQueryCondition`,
`DirectScssQueryClause#0/#1`, + the 14 Less-inherited and 4 shared ids (which should move out of
this list entirely if O-6 resolves toward a `preprocessorBase`).

---

### 4.4 `jess-parser`

Gating baseline: 36 findings, **0 anti-pattern lines** — which is itself a finding (P-2): the 3
`double-not` and 7 `leading-not` sites are real and invisible in the capture.

**J-1 — delete `staticSelectorText`. The last `*SelectorText` text-join in the repo.**
Verified at `ast/grammar.ts:376` (definition), used at `:1692` and `:1770`. It is a byte-identical
duplicate of core `pseudoCanonical` (`core/src/ast/nodes.ts:598-601`, same `complexCanonical` +
`', '` join) — **the parser is re-implementing the core join site**, violating
[[parser-never-serializes-structure-plus-trivia]] and [[parser-owns-structure-no-byte-rederivation]].

*Use 2 (`:1770`) is the easy half.* Per `PSEUDO-ARGUMENT-ALWAYS-STRUCTURE-DESIGN.md` §7 Q1
(owner-resolved 2026-07-23), non-selector-arg pseudos are the **general-any** class and take the
verbatim balanced scan, not a re-joined selector. Drop the `DirectJessStaticPseudoArgument` arm from
`DirectJessGenericPseudoArgument` (`ast:1852`), keeping only `jessPseudoRawArgument`.
**NOT AST-neutral:** `:lang( en )` currently normalizes to `:lang(en)` via the selector round-trip;
verbatim keeps `( en )`. Narrow input class, needs a corpus gate.

*Use 1 (`:1692`) is the hard half and needs core change C-7.* The structure replacing the joined
text is the An+B string **plus** the `SelectorList`, both retained. `PseudoSelector`
(`core/src/ast/nodes.ts:478-485`) has `text | interp | name | args | crossable` and cannot express
both. Plan:
1. Add `readonly nth: string | null` to `PseudoSelector`, **appended after `crossable`** — `text`
   and `interp` must stay at field offsets 0/1 for the degree-2 IC in `compoundCanonical`
   (`nodes.ts:465-467` documents this). Default `null` in the builder so no call site changes shape.
2. Extend `pseudoCanonical` (`nodes.ts:598`) to emit `${name}(${nth} of ${…join…})` — **the single
   join site that consumes the new field.**
3. `DirectJessStaticNthChildArgument` (`ast:1673`) stops reducing to `string`;
   `DirectJessPseudo` (`ast:1753`) emits `pseudoSelector(head, selector, { nth })`.
4. Delete `staticSelectorText` and, per §7 Q1, delete `STRUCTURED_PSEUDOS` (`ast:385`).

**NOT AST-neutral, definitively.** Before: `SimpleSelector { text: ':nth-child(2n+1 of .a)' }`.
After: `PseudoSelector { name: ':nth-child', args: SelectorList([.a]), nth: '2n+1' }`.
`pseudoCanonical` reproduces identical *serialized* bytes, so rendered CSS is byte-identical while
the in-memory node type changes for every `:nth-child`/`:nth-last-child`.
**Risk: HIGH** — reaches `compoundCanonical`, `simpleTokenText`, the extend matcher's `crossable`
logic, and shape stability (a new field on a hot node). This is a `perf-architecture-reviewer` +
`semantics-reviewer` item and a **4-parser landing**, not a mechanical edit. It also carries the
bare-nth-name guard jess still lacks — but check first whether `ast:1747`'s existing
`g.CssAstSyntaxNthName` reference already closes that divergence.

| id | what | where | AST-neutral | risk |
|---|---|---|---|---|
| JESS-1 | delete `staticSelectorText` (above) | `ast:376, 1692, 1770` | **NO** | **HIGH** |
| JESS-2 | `not(not(X))` → `peek(X)` ×3 | `ast:1589, 1636, 2770` | yes | LOW |
| JESS-3 | leading `not(...)` → prepend a concrete `peek`, or adopt C-6 | `ast:1175, 1707, 1746-1747, 1919, 2317, 2336, 2982` | yes | LOW-MED |
| JESS-4 | hand-rolled sep-lists → `oneOrMoreSep`/`sepBy` (20 of 22) | CST `:346, 347, 379, 394, 431, 461, 502`; AST `:1446, 1448, 2003, 2156, 2164, 2188, 2348, 2352, 3012, 3034, 3144, 3198, 3360, 3365` | yes | LOW |
| JESS-5 | `regex(keyword)` → `word`/`keywords` (44 sites) | CST 22 + AST 22 | yes | LOW |
| JESS-6 | one comparison terminal, not 5 | CST `:134, 265`; AST `:1030, 1035, 1254` | yes | LOW |
| JESS-7 | left-factor the `$if` guard (and `DirectJessMixinGuard`) | `ast:3270`, `ast:1303` | yes⁴ | MED |
| JESS-8 | remove `withCtx` + the gated arm from the CST | `grammar.ts:98, 552` | see note | LOW-MED |
| JESS-9 | at-rule gating cluster: dedup `@media`, factor `url(`, factor `$[` | `ast:2413/2397`, `ast:2543`, `ast:1050` | yes | LOW-MED |
| JESS-10 | `DirectJessStaticValueAtom` call-vs-keyword left-factor | `ast:2179`, `ast:2124` | value yes, node identity NO | MED |
| JESS-11 | gating snapshot test | new `test/gating.test.ts` | n/a | none |

⁴ `reduceGuardAnd`'s `index += 2` stride assumes `[primary, op, primary, …]`, which the factored
form still produces — but test each of `$if ($a)`, `$if ($a > 5)`, `$if ((A) and (B))`,
`$if ((A) or (B))`, `$if (not($a))` and the mixed-chain rejection.

**JESS-2 is a correctness fix, not a perf fix.** `ast:1636` `DirectJessInterpolatedParentSuffix`
and `ast:1589` `DirectJessInterpolatedSimple` are **siblings in `DirectJessCompound`** (`ast:3324`)
alongside `DirectJessParent` (also `&`-led) — a `&`-led arm sharing a first char with a
`not(not(...))`-led arm is exactly the documented miscompile shape. `ast:2770` is arm[0] of
`DirectJessDeclaration#1` against `g.CssAstSyntaxProperty`, same shape.
Side effect: the three "throwaway match token" filters (`ast:1613-1619`, `:1646`, `:2785-2791`)
become dead code. Keep them in the same commit; delete in a follow-up once a test confirms.

**JESS-3 detail.** `ast:1175` alone accounts for four findings — `DirectJessMixinGuard`,
`DirectJessGuardPrimary`, `DirectJessIfGuard`, `DirectJessIfGuardPrimary` all bottom out at
`DirectJessExpressionAtom` arm[0], whose lead is `not(jessTypeNamespace)`. Prepending
`peek(literal('$'))` gives it first-set `{$}` and fixes all four. `ast:2982` takes
`peek(literal('@'))`. `ast:2317/2336/1919` should wait for C-6 rather than take an interim
`peek(g.CssAstSyntaxKeyword)`, which re-runs the ident regex per attempt —
[[feedback-no-defensive-slowdowns]]: **measure before landing any interim**.

**JESS-9 — "one root cause, not seven?" Partly.** Four of the seven (`DirectJessMediaPrelude`,
`DirectJessStaticAtPreludeTerm`, `DirectJessStaticAtNonOnlyAtom`, `DirectJessCssImportPrelude`)
share **one** chain terminating at `via ref g.DirectJessCustomPropertyValue → ref cycle`.
`DirectJessCustomPropertyValue` (`ast:2081`) is a one-line node over `g.CssAstSyntaxCustomProperty`,
a cross-artifact **hole**. Resolved, its first-set is `{-}`; unresolved, `ANY`.
**These four may be phantom** — 0.34.0 added `deferred` + `resolveRef` precisely for holes, and
these are reported as `ungated` with reason `ref cycle`. **Re-run `analyzeGatingRules` with
`resolveRef` over the fused map before spending any effort here** (P-1). The remaining three are
independent and real: `DirectJessAtRuleHeader` re-attempts a full static header for every `@media`
(arm[0] of both `DirectJessAtRuleHeader` and `DirectJessStaticAtRuleHeader` is
`sequence(MediaAtKeyword, …)`); `DirectJessCssImportTarget#0` (`ast:2543`) has two arms sharing
`CssAstSyntaxUrlOpen`; `jessDollarInterpStructure` (`ast:1050`) has **four arms all leading
`literal('$[')`** — the cleanest left-factor in the package.

**JESS-8 — the CST's top-level-`&` gate.** `grammar.ts:98` has a gated `choice` arm
`{ gate: (s: any) => !!(s && s.inner), combinator: parentSelector }` fed by
`grammar.ts:552` `withCtx({ inner: true }, …)`. (Note: the claim that jess never uses a gated
`choice` arm is wrong — this is one, and its `: any` is a hard violation, see C-8.)
Decisive evidence for deleting rather than restructuring: **the AST grammar has no such gate** —
`DirectJessCompound` (`ast:3324`) admits `DirectJessParent` unconditionally, top level included.
The two grammars already disagree and the AST is the shipping engine → owner question O-8.
Secondary benefit: `hasSemanticReduction` treats both `withCtx` and a gated `choice` as semantic,
so removing them is a precondition for ever making any part of this grammar recognition-only.

**`calc()` in `.jess` is a functional GAP, not a duplication.** `grep -rn calc packages/jess-parser/src/`
returns **nothing**. `calc(100% - 20px)` falls to the generic `DirectJessCall` whose components are
`DirectJessValueSpaceGroup` atoms; a bare `-` is not a `CssAstSyntaxKeyword`, so this is a **parse
rejection**. The only occurrence in the jess suite is inside an escaped string
(`test/ast-grammar.test.ts:472`), i.e. the real form is untested → owner question O-1.

**Proposed accept list:** `rw`, `VarDeclaration`, `CollectionEntry`, `For#1`,
`DirectJessValueAtom#0`, `DirectJessMixinCallArg`, `DirectJessFor`, `DirectJessUrl`,
`DirectJessCustomPart`, `DirectJessCustomInnerPart`, `condPrimary#0/#1`,
`DirectJessPseudo#0/#1/#2`, `DirectJessSupportsCondition`, `DirectJessReferenceTail#1`,
`DirectJessDeclaration#0/#1`, `forRange`, `DirectJessStaticAtRuleHeader#0`.

---

## 5. LEGITIMATELY DIFFERENT — the narrow, justified list

This category gets abused. Every entry below names the spec section or owner decision that makes
the idiomatic form *wrong*, not merely inconvenient.

- **LD-1 — complex-selector `optional(combinator)` separator** (css `G:148`/`A:897`, less
  `grammar.ts:425`). Selectors-4 §4.1 makes the descendant combinator the *absence* of an explicit
  one. The separator is genuinely nullable, and `sepBy` terminates its loop by separator failure —
  which a nullable separator never produces. No `sepBy`-family combinator can model it.
- **LD-2 — `field('separator', …)`-capturing lists** (less `ast:1754, 2079, 2106, 2369, 2378, 2388,
  2406, 2688, 3623, 3660, 3808`; jess `ast:2134`). These capture the *authored separator text* for
  byte-faithful layout replay (`withValueLayout`, `commaListFromChildren`). `sepBy`/`oneOrMoreSep`
  return `T[]` and give the reducer no per-separator field. **A real capability gap, not a style
  choice** — arguably a parseman feature request (P-5).
- **LD-3 — `many(sequence(literal(','), optional(item)))`** (scss `grammar.ts:206, 396, 414`). Not a
  separated list: the item is optional, so `f(a,,b)` parses with a hole, which Sass's argument
  grammar permits. `sepBy` has no legal-empty-slot mode (its tolerant path is error recovery).
- **LD-4 — the guard/condition comparison operators must NOT be unified with the CSS one.**
  less `grammar.ts:320,784,849` spell `>=|<=|=>|=<|=~|[<>=]`, scss `grammar.ts:286` spells
  `==|!=|>=|<=|=|>|<`. `=~`, `=>`, `=<`, `==`, `!=` have no meaning in a CSS media-query range
  (mediaqueries-4 §4 defines only `< <= = >= >`). Unifying would widen
  `@media (width => 600px)` into acceptance. Only the two **CSS-semantic** spellings are duplicates
  (C-4).
- **LD-5 — vendor-prefix and exclusion-lookahead identifiers stay `regex`.** `@(?:-[a-z]+-)?keyframes`,
  `@(?:-moz-)?document` contain a **wildcard** prefix — an open set `keywords()` cannot enumerate.
  `containerName`, `genericFunctionName`, `statementAtRuleName`, `genericAtRuleName`,
  less `nonKnownAtVar`/`knownAtVar`/`mediaType`/`directAtRuleName`, scss `scssGenericAtRuleName`,
  jess `jessGenericCssAtRuleName` are identifier patterns carrying a *negative* keyword exclusion —
  the docs table's own definition of "a genuine pattern". The `keywords`-based alternative is
  `sequence(not(keywords([...])), ident)`, which is the `leading-not` anti-pattern and strictly
  worse.
- **LD-6 — `:global(…)` / `:local(…)` retain opaque joined text** (scss `ast:2988`, and the
  matching css/less/jess landings). CSS-Modules pseudos are *sealed* — the argument is a scoping
  directive, not a selector to compose. Structuring it would be meaningless.
- **LD-7 — the attribute selector joins to one `SimpleSelector`** (scss `ast:2815`). That is the
  canonical AST v2 node shape, identical to the CSS direct grammar — a model decision, not a parser
  serialization.
- **LD-8 — css `A:608` `customSlash` overlapping `blockComment` in every balanced skip set is the
  FIX, not the bug.** `A:600-607` documents it: *"a balanced interior stops at the first character
  of every skipper it is given, so `blockComment` puts `/` in the interior's stop set: a `/` that
  does NOT open a comment matches no interior arm and truncates the group early… `url(//host/a;b)`
  inside a custom-property value is exactly that shape."* The ordering (`blockComment` before
  `customSlash` at every site) is load-bearing. Accept-list, never "left-factor".
- **LD-9 — `node()`-per-selector-tail instead of `sepBy`** (jess `ast:1798, 3345, 3355`). Each tail
  is a distinct AST fact with its own reduction (`reduceSelectorTail`); `sepBy` drops the separator
  from the value and offers no per-item node.
- **LD-10 — `many(blockComment)` interleaved into list separators** (jess `ast:2678, 2744-2749`).
  Block comments are deliberately *not* ambient trivia in the jess AST grammar (`ast:1015` — only
  whitespace and `//`) because a `/* */` is CSS output. A `sepBy` conversion would drop the comment
  positions.
- **LD-11 — `parser({ trivia })` re-establishers inside `noTrivia` scopes** (jess, ~15 sites;
  scss `ast:2894, 2917, 2951`). A shared nested rule must not inherit the caller's `noTrivia` or
  `$( 1px + 1px )` stops parsing. This is the documented way to flip trivia inside a `noTrivia`
  region.
- **LD-12 — three distinct jess comparison spellings survive C-6/JESS-6.** Bare, space-REQUIRED and
  space-TOLERANT encode three owner-settled rules: expression operators require spaces
  ([[v5-slash-list-spaced]]); `$if` conditions do not. Only the 4th and 5th copies are redundant.
- **LD-13 — arithmetic `many(sequence(op, operand))`** (scss `ast:1276, 1281, 1286, 1291`). Shaped
  like a separated list, but `foldOperation` walks children stepping by 2 and the operator token's
  *text* is load-bearing — the "separator" is semantic content. Sass's `/` and `-` are further
  whitespace-sensitive (`directScssSumOperator` encodes Dart Sass's minus rule).
- **LD-14 — scss `scssGenericAtRuleName` deliberately differs from the shared one**: it additionally
  excludes every Sass directive and the `@-…` compiler namespace, because those must never degrade
  to verbatim opaque CSS output.
- **LD-15 — the SCSS `withCtx` + gated arm is the RECOMMENDED form** (`grammar.ts:725, 729`). The
  docs' own table says a gated `choice` ARM *selects* a branch and preserves dispatch — strictly
  better than a `gate()` in a sequence. A structural split would require duplicating the entire
  inherited Less selector chain. Keep, but fix the `(s: any)` under C-8. *(Contrast jess JESS-8,
  where the AST grammar proves the restriction is not part of the language model.)*
- **LD-16 — less `grammar.ts:603` `valueList`'s trailing `optional(literal(','))`.** Less 4.x breaks
  out of the comma loop when no expression follows, silently dropping the dangling comma;
  `sepBy(..., {trailing:'allow'})` would consume it into the list. The current shape is the faithful
  port.
- **LD-17 — less `grammar.ts:519-531` `DeferredScalarDeclaration`** is an explicitly-scoped
  experimental Jess-native family whose `noTrivia` + explicit `optional(ws)` shape is the point.
  Not a candidate until the POC resolves.

Two entries I am **declining** to accept, recorded so nobody re-proposes them:
`regex(/calc(?=\()/i)` and friends are *not* legitimately different — they are P-4, a parseman gap.
And less `ast:3214`'s leading `not()` is *accepted in the snapshot with a cited reason*, which is
not the same thing as legitimately different.

---

## 6. PARSEMAN ISSUES to file

Each is a library/DX bug. **None is a permanent grammar exception**; the grammar keeps the
hand-roll only behind a grep-able `TODO(parseman-#NNN)`.

**P-1 — a `composeLeaf` hole is reported as `ungated` with reason `ref cycle`, not `deferred`.**
Four of jess's seven at-rule findings bottom out at
`via ref g.DirectJessCustomPropertyValue → ref cycle`, where the real dependency is a plain
non-recursive hole bound from `internal-css-recognition`. 0.34.0's `deferred` bucket exists exactly
for this.
*Repro:* a two-map `composeLeaf` where the leaf's rule `A` is `node('A', g.External)` and `External`
lives in the first map; run the macro build's fused diagnostic and check the classification and the
chain reason.
*Measure:* whether re-running with `AnalyzeGatingOptions.resolveRef` over the fused map reclassifies
all four. **If yes this is our capture methodology, not a parseman bug — close it and re-capture.**
*Marker (only if it survives):* `// TODO(parseman-#NNN): hole reported as 'ref cycle' instead of deferred.`
at `jess-parser/src/ast/grammar.ts:2081`.

**P-2 — `detectAntiPatterns` inspects only an arm's LEADING term, so anti-patterns behind a `g.` ref
are invisible.** The 0.34.0 capture reports **28 anti-patterns in css-parser and ZERO in less, scss
and jess** — yet those three contain 8 verified `not(not(...))` sites and ~120 keyword regexes.
Cause: `peelToLeading` (`gating.ts:322`) stops at a `lazy` ref, and every dialect at-rule keyword is
buried inside `node(sequence(kw, …))` reached via `g.ScssIf`/`g.DirectLess…`.
*Repro:* a `rules()` map with `A = node(sequence(regex(/@if(?![-\w])/i), …))` and
`Entry = choice(g.A, g.B)` → 0 anti-patterns; inline the same `sequence` as the arm → 1
`keyword-regex`.
*Measure:* anti-pattern count with and without ref-peeling.
*Consequence for this plan:* §4.2/§4.3/§4.4's keyword lists were derived by **static reading**, not
from the diagnostic. **Do not treat a clean anti-pattern report as evidence a grammar is clean.**
Also: the current capture formats `ungated` only — `report.antiPatterns` must be formatted in the
next capture.

**P-3 — `word()`/`keywords()` boundary is a character class, so the full CSS ident boundary is
inexpressible.** `recognition.ts:66,67,68,88` guard with `(?![-_a-zA-Z0-9-￿\\])` — a
boundary excluding the **backslash** (css-syntax-3 §4.3.7 escapes) and **all non-ASCII ident code
points** (§4.3.9). So `queryNot`, `queryOnly`, `queryAndOr` and `fontFeatureValueAtKeyword` are
stuck on `regex` while sibling terminals two lines away convert cleanly.
*Measure:* whether `word()` accepting a regex character-class source (or a named `cssIdent` boundary
preset) preserves the ASCII-folded exact first-set without degrading to `any`.
*Marker:* `// TODO(parseman-#NNN): word()/keywords() boundary cannot express the full CSS ident code-point class.`

**P-4 — `word()`/`keywords()` cannot express a positive-lookahead anchor.** `regex(/calc(?=\()/i)`,
`/url(?=\()/i`, `/supports(?=\()/i`, `/layer(?=\()/i`, and every `(?=\()`-anchored name in
`pseudo-consts.ts` must stay `regex` and stay flagged. `boundary` is a *negative* class only.
Writing it as `sequence(word('calc'…), peek(literal('(')))` splits one leaf into two and is not
AST-neutral.
*Ask:* `word('url', { followedBy: '(' })`, or `keywords([...], { anchor: peek(literal('(')) })`.
*Measure:* count of `keyword-regex` findings across all four parsers attributable solely to a
`(?=\()` anchor.

**P-5 — `sepBy`/`oneOrMoreSep` give the reducer no per-separator field.** This is why LD-2 exists:
Less and jess capture the *authored* separator text via `field('separator', …)` for byte-faithful
layout replay, and no repetition combinator can express it. Every such list must stay hand-rolled.
*Ask:* a `separatorField` option, or a `sepByWith` that yields `[item, sep, item, …]`.
*Measure:* count of hand-rolled lists across the four grammars that exist *solely* for separator
capture (currently ~12).

**P-6 — `balanced()`'s synthesized skip choice, and all-literal longest-first choices, report
UNGATED with no authorable fix.** `cssBrace`/`preprocessorBrace` (`opaque-at-rule.ts:16,20`) and
`balancedParens`/`Brackets`/`Braces` (css `A:612-614`) report `first-set ANY (broad-recognizer)` for
`balanced`'s own interior recognizer and `overlap on '/'` for two `/`-leading skippers — **arms the
grammar author did not write.** Likewise
`choice(literal('||'), literal('>'), literal('+'), literal('~'), literal('|'))`
(css `G:44`, `A:559`, less `ast:1417`): `literalsLongestFirst` already handles `||`-before-`|`
correctly, so reporting it as UNGATED is a false alarm on a choice parseman itself reordered — and
note the identical CST `combinator` is *not* reported, presumably classified `recoverable`, so the
two classifications disagree.
*Measure:* report-precision only. Finding count before/after with no grammar change — css-parser
should drop 62 → ~48.

**P-7 — no keyword-class (trie) dispatch primitive.** `choice` gates on the first *character*, but
a pseudo-name or at-keyword dispatch is a keyword *trie* and every arm collides. This accounts for
the clear majority of the 202 findings: at-rule arms all leading `@` (css `stylesheetBody`,
`AtRuleBlockTop#0/#6`, `AtRuleBlock`, `declarationList`, `CssAstDocument`; jess
`DirectJessStaticAtRuleHeader#0`), and pseudo-name arms colliding on `N/n`, `H-I/M-N/W` (jess
`DirectJessPseudo#0`). The documented remedy — left-factor `literal('@')` — is **not applicable
AST-neutrally**: it splits one captured at-name leaf into two and breaks `tokenText(children[0])`
at nine css-parser reducers plus the CST builders; `token(sequence(literal('@'), word(…)))` restores
the single leaf but re-hides `@` from the `sharedPrefix` detector.
*Repro:* a `choice` of five `word('@a'|'@bb'|'@ccc'|'@dddd'|'@eeeee', '-_0-9A-Za-z',
{caseInsensitive:true})` arms — each has an **exact** first-set, so parseman has enough information
to build a trie or a second-character bucket, yet reports 10 pairwise overlaps and `firstMatch`.
*Measure — do this BEFORE asking for the feature:* parse time over
`packages/css-parser/test/css/atrule-*.css` and the at-rule-dense sections of
`packages/jess/benchmark/benchmark.less`, with `PARSEMAN_GATING=off`, same-worktree git-toggle,
warmup + N-median, `firstMatch` vs a trie prototype. Is the shared-`@` case measurably costly, or is
`literalsLongestFirst` already close enough that this is a report-noise problem?
*Marker:* `// TODO(parseman-#NNN): at-keyword arms all lead with '@'; left-factoring literal('@') is not AST-neutral.`

**P-8 — `word()`/`keywords()` emit no LEADING word boundary.** scss `grammar.ts:338-341, 383,
487, 488` use `\bin\b`, `\bfrom\b`, `\bthrough\b`, `\bto\b`, `\busing\b`, `\bas\b`, `\bwith\b`.
`parse(word('through','-_0-9A-Za-z'), '1through')` succeeds at offset 1; `parse(regex(/\bthrough\b/),
'1through')` fails. In practice `@for $i from 1 through 5` always has intervening whitespace, so the
widening is unreachable — but that is an argument for *accepting* the widening deliberately, not for
claiming neutrality. **My recommendation is (b): accept and convert**, since a PEG position-anchored
parser does not need a leading boundary (the previous token always consumed to one). Owner call.

**P-9 — 0.34.0 is a measurable parse regression on Less (+10…25 %), small on SCSS/jess, neutral on
CSS.** See §1.4 for the full interleaved measurement. Leading hypothesis is the `emitNot` rollback
added by the probe-leak fix: a `not()` whose body captures nothing may not need the leaf-rollback
half at all, which would recover most of it without reopening the leak. **Not proven** — `not()`
density does not explain the per-dialect ordering (scss 43 sites regressed less than jess 31, css
35 did not regress). Needs a parseman-side profile.
*Repro:* `packages/jess/benchmark/benchmark.less` through `@jesscss/less-parser`'s `parse`,
git-toggled between `parseman@0.32.0` and `@0.34.0` with a full macro rebuild between blocks.
*Measure:* self-time in the compiled `not()` sites; then a build with the leaf-rollback half
suppressed for capture-free bodies, against the same table.

---

## 7. Open questions for the owner

- **O-1 — is `calc()` in scope for `.jess` at all?** jess has *no* calc production, so
  `calc(100% - 20px)` is a parse rejection, untested. less re-implements calc twice
  (`grammar.ts:888-928`, `ast:1443/2147-2151`), scss's AST has none while its CST references
  `g.CalcCall` (`grammar.ts:216`), and only css-parser owns a real one (`G:283-300, 351, 368, 721`;
  `A:1169-1188`). Per [[dialect-var-forms-are-operands-in-ported-css-productions]] the *shape* is
  shared and only the operand atom differs — which is exactly a `rules()` map with a `g.CalcValue`
  hole. **This is the highest-value candidate for 0.34.0's hole mechanism, and it is bigger than the
  pseudo-argument consolidation that motivated §5 of the design doc.** Scope it as a follow-on to
  C-1, or out of scope?
- **O-2 — `:global()`/`:local()` in the shared selector-arg pseudo set.** less `ast:1492` includes
  `global|local`; the shared `CssAstSyntaxSelectorArgPseudoName` does not. Add centrally (all four
  dialects gain them), or keep a Less-local `choice(g.…, word('global'), word('local'))`?
- **O-3 — `recognition.ts:83` `genericAtRuleName`'s hand-maintained exclusion list** duplicates ~19
  at-rule names declared as terminals in the same file. Derive it (one `keywords()` set used both
  positively and, negated, as the generic guard), or keep the duplication with a lint assertion?
  A shared-shape hole does not solve this one.
- **O-4 — CSS-11 tightens CST acceptance** (`:nth-of-type(2n of .a)` stops parsing in the CST as it
  already does in the AST). The consolidation design §5 step 1 flags it as intended and asks to
  confirm no alpha fixture depends on it. Confirm, or defer CSS-11 out of this pass.
- **O-5 — empty `:extend()` and empty `@import ()`** become parse errors under LESS-3. Both are
  invalid Less; v5 has generally chosen "hard error where 4.x warned". Confirm.
- **O-6 — `[[scss-should-compose-on-css-not-less]]` vs `scss-parser/src/grammar.ts:30`
  `compose([lessGrammar, …])` and the hard `@jesscss/less-parser` dependency.** Aspirational (the
  AST already complies, the CST has not been migrated), or superseded? 14 of 48 SCSS gating findings
  and every `g.Less*`/`g.CondArg*`/`g.MixinArgs`/`g.Guard` reference in the CST depend on the
  answer, as does whether a `preprocessorBase` should be extracted.
- **O-7 — `DirectScssGenericPseudo` (`ast:2998`) still joins an unknown pseudo's argument to text.**
  Is the SCSS slice of the always-structure migration deferred deliberately (the design sequences
  SCSS last, "highest risk; isolated")? Track here or under css-parser?
- **O-8 — should the jess CST's top-level-`&` restriction exist at all?** `grammar.ts:98` gates `&`
  on `ctx.state.inner`; the AST grammar admits `&` everywhere. Delete the CST gate to match the AST,
  or add the restriction to the AST?
- **O-9 — `PseudoSelector.nth` (C-7/J-1).** Add the field (a new field on a hot node → shape-stability
  review), or keep the nth-`of` degrade-to-text as a documented permanent exception? The
  always-structure design says delete; the model does not currently support it.
- **O-10 — case-sensitivity divergences, three of them, all currently preserved verbatim by the
  conversions.** (i) Less spells `not`/`and`/`or`/`when` **case-sensitively** at
  `grammar.ts:345/353/356/358` and `ast:3049…3116` but **case-insensitively** at `grammar.ts:393`,
  `779-781`, `784`, `849`, `ast:1490` — so `WHEN` is recognized by the selector-run boundary
  lookahead but not by the `Guard` rule that follows it. (ii) SCSS's `@for` range keywords are
  case-sensitive in the CST (`\bfrom\b`, `\bthrough\b`, `\bto\b`) and case-insensitive in the AST
  (`/from…/i`) — `@for $i FROM 1 THROUGH 5` parses in one grammar and not the other. (iii) Less
  `grammar.ts:184` `important` is case-**sensitive** while the AST routes through
  `g.CssAstSyntaxImportant`; CSS `!important` is ASCII case-insensitive (css-syntax-3 §3).
  A ruling on each would let the sites collapse to one spelling.
- **O-11 — SCSS `@if $a = 1`.** The CST accepts a bare `=` as a comparison operator
  (`grammar.ts:286`); the AST does not (`ast:2058`). Dart Sass rejects it. If the AST is right,
  SCSS-8 becomes a tightening rather than a neutral conversion.
- **O-12 — is the comparison-operator *vocabulary* a central fact?** `internal-css-recognition`
  already owns `CssAstSyntaxQueryComparisonOperator`; jess spells a near-identical set five more
  times and less eight. Move the vocabulary central (per-dialect whitespace framing staying local),
  or is the media-query set deliberately a different language? (§5 LD-4 says the *guard* set is
  genuinely different; this question is only about the CSS-shaped subset.)
- **O-13 — LESS-15's error-behaviour tightening.** Routing `@media <type>` preludes through the
  structured `QueryAtRuleBlock` leaves well-formed output unchanged (both paths converge on
  `_buildAtRulePrelude` from source text) but turns malformed brackets into hard errors instead of
  being swallowed. Wanted?
- **O-14 — the two `all-less` reds (§1.3).** `css-3.less` and `variable-advanced.less` now differ
  from the freshly-updated v5 numeric-precision expectations. By the standing rule that is a jess
  bug. Should it be tracked against `docs/design/numeric-precision-policy.md` as its own item?

---

## 8. Fan-out protocol

Four parallel per-parser agents, one per §4 subsection. Each gets `isolation: worktree` (they all
edit and build). Preconditions and ordering:

1. **§3 CENTRAL lands and is pushed first, as its own commit(s).** In particular C-0 (gating
   snapshots, baselined at today's counts), C-8 (the `any` fix), C-2/C-3/C-4/C-6
   (`internal-css-recognition`), and a rebuild of `internal-css-recognition` **before** anything
   else — otherwise all four agents test against a stale `lib/` and report a false green
   ([[stale-recognition-lib-masks-dev-failures]]).
2. **C-1 (the §5.0 re-spike) gates every "host it centrally" item** — O-1, and the shared-shape
   half of §4. If the spike fails, those items stay in this document and the fan-out is limited to
   the local conversions, which is still the bulk of the work.
3. **Within each parser, sequence: `peek()`/`not()` removals → keyword conversions → separated
   lists → left-factors → the AST-changing items.** §1.4 makes the `not()` removals worth more than
   they were, and they are the lowest-risk items in every section.
4. **Every agent re-captures the §1.2 AST byte-identity aggregate for its dialect** before and after
   each landing, and each `*macro-compiled*.test.ts` must still prove fusion. An item marked "NOT
   AST-neutral" needs the owner's answer to its open question first.
5. **Do not create a `productions/` directory** (§2.2), do not introduce `makeWord` or any factory
   (§4.0), and do not add a `regex` outside `regex()`.
