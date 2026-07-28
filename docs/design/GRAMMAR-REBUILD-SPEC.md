# Grammar rebuild — design spec and method of record

The four dialect grammars are being **rebuilt**, not refactored. This document is
what an agent is handed: the scope, the constraints, the references to read
first, the method, and the criteria that decide whether they succeeded.

> **Status: `design/`, not `architecture/`.** The problem statement (§2), the
> verification machinery in §8.2–§8.6, the traps (§7), and the structural causes
> (§13) are present-tense and measured. The old hostMode release blocker is paid
> as of `parseman@0.41.0`; the physical eight-to-four collapse is complete, and
> the active work is rebuilding/polishing the surviving grammar families until
> they meet the naming, documentation, lint, and Parseman-shape bar. Sections that preserve
> older 0.32/0.37/0.38 planning evidence are historical unless §0.2 or
> `docs/architecture/parser/GRAMMAR-SEQUENCE-ORCHESTRATION.md` says otherwise.
>
> **It graduates to `architecture/parser/` when the rebuild lands** and the
> forward-looking sections become present tense. That move is the visible event
> marking the rebuild as done — do not let this document age into `architecture/`
> quietly, and do not let it sit here describing shipped machinery.

Measured in-tree on **`a67b5077c`, 2026-07-25** (`origin/dev` at `76680b114`),
re-verified against **`origin/dev` at `92d38af4f`, 2026-07-25**, with the shell
method stated inline. Counts drift; methods do not. **Re-measure. Do not quote**
— §2.3 shows two of these figures moving inside a single day, and §0.4 lists
six figures in this document that had already gone stale within hours of it
being written.

---

## 0. Start here — status, plan, and what you are waiting on

**This section is for a reader with the repository, a shell, and nothing else:
no conversation history, no memory of prior sessions, no access to the owner.**
Everything load-bearing is stated here or reachable from here by path. Nothing
in `.cursor/` and nothing in `CLAUDE.md` is required reading.

### 0.1 What the project is

Four dialect parsers — `css`, `less`, `scss`, `jess` — each started with
**two** hand-maintained grammars: `src/grammar.ts` (a positioned CST, which the
language service consumes) and `src/ast/grammar.ts` (the AST, which is the
shipping compile path). **Eight files became four.** The remaining acceptance
work is to make those four grammar sources exemplary rather than merely folded.

The owner's requirements, verbatim, are the acceptance definition:

> all 4 grammars shiny and new and don't look anything like the old ones and
> have 1 grammar file each … and all parsing tests passing for each, and the
> language service tests passing
>
> Don't keep the same parseman combinator shapes, don't keep the same node names
> (each syntax shouldn't have bespoke naming schemes IMO?)
>
> build each grammar from scratch with an enforcement rule of never
> copy/pasting
>
> it should start with CSS, and then the others should have an agent-readable
> link to those

Four consequences, none of them optional:

1. **Order is `css` → `less` → `scss` → `jess`.** CSS is the base.
2. **The dialects link back to CSS** rather than restating it — see §12 for what
   "agent-readable link" means concretely.
3. **No copy-paste.** The old grammars are a reference for the _accept set_
   only (§3, §4).
4. **No bespoke per-dialect naming scheme.** See §2.1 and
   [`GRAMMAR-REVIEW-STANDARD.md`](../architecture/parser/GRAMMAR-REVIEW-STANDARD.md)
   item 14, which is the canonical statement of the naming law. This document
   does not restate its mechanism.

### 0.2 Current status

**The parseman floor is paid.** parseman is now resolved to **0.41.0** from the
registry; the root, `@jesscss/parser-shared`, and all four parser packages
depend on `^0.41.0`. `hostMode` reaches the macro, 0.38 adds
the keyword ergonomics this cleanup now uses:
`word(str, { caseInsensitive: true })`,
`word(str, boundary, { caseInsensitive: true })`, and
`makeWord(boundary?, { caseInsensitive: true })`, 0.39.1 provides the
macro-compiled `dispatch(combinator, when(...), otherwise(...))` routing shape,
case-insensitive `when(...)`, `makeWhen(...)`, matcher cases, and `routed()`,
and 0.40.0 adds `node(..., { project: index })` for simple semantic projection
without hiding CST ownership. Current package-local resolution checks report
`0.41.0` from `/Users/matthew/git/oss/jess/node_modules/.pnpm/parseman@0.41.0/node_modules/parseman`.
Macro
probing has one important authoring boundary:
`makeWord(...)` aliases declared inside a `rules(...)` factory lower cleanly, but
module-scope word-factory aliases do not; keep shared recognition modules on
direct `word(...)` / `keywords(...)` until that Parseman surface improves.

**The physical four-grammar collapse is complete.** CSS, Less, SCSS, and Jess
now ship AST and CST from one host-mode grammar source per dialect:
`src/grammar.ts`. The old `src/ast/grammar.ts` files have been deleted. The
remaining rebuild work is quality work on those surviving sources: simplify rule
and node names, replace duplicated broad choices with Parseman 0.41 routing
where it applies, tighten spec conformance, and keep the grammar documentation
current.
Verify:

```sh
wc -l packages/syntax/css/css-parser/src/grammar.ts \
      packages/syntax/less/less-parser/src/grammar.ts \
      packages/syntax/scss/scss-parser/src/grammar.ts \
      packages/syntax/jess/jess-parser/src/grammar.ts
```

Four file paths in the active checkout after the single-source folds. Fresh
serial checks in this integration checkout prove the folded baseline is usable:
`packages/syntax/css/css-parser/src/ast/grammar.ts` is absent, the full CSS
parser suite passes (8 files / 269 tests), and `pnpm --filter
@jesscss/css-parser build` passes. The folded CSS value route uses one parsed
identifier/function opener with `dispatch(...)`, case-insensitive
`makeWhen(...)`, and `routed()` branches for `url(`, `calc(`, `var(`, generic
functions, and bare identifiers; malformed known functions are recognition
failures, not reducer exceptions.

Less now ships from one host-mode grammar source. The previous CST bridge body
has been deleted from `packages/syntax/less/less-parser/src/grammar.ts`; both
the AST route and `parseLessCst()` use the direct host-mode grammar. The current
oracle baseline intentionally includes the host-mode CST switch and the later
strict CSS calc rejection movement for two invalid fixtures:
`packages/syntax/css/css-parser/test/css/errors/calc-empty.css` and
`packages/syntax/css/css-parser/test/css/errors/calc-lone-operator.css`.
The checked-in baseline aggregates are
`ast=309d91e177887c6aa3d140380cd5c78529a77360a427007146a2717c49a7e929`
with 120 throws and
`cst=7819745e6303225316b5af7d68ea9de301e5dd95603e06bca1260d65abb506c4`
with 0 throws over 709 entries. The current integration checkout is not
byte-identical against that committed baseline; the active registry-0.41.0
aggregate is recorded below and classified in
[`LESS-ORACLE-MOVER-CLASSIFICATION.md`](../architecture/parser/LESS-ORACLE-MOVER-CLASSIFICATION.md).
SCSS now ships from one host-mode grammar source too;
`packages/syntax/scss/scss-parser/src/ast/grammar.ts` is absent,
`pnpm --filter @jesscss/scss-parser build` passes, and the full SCSS parser
suite passes (8 files / 291 tests). The SCSS fold intentionally removed the old
CST-only acceptance path; public CST and direct parsing now share the same
accepted language. Jess also now ships from one host-mode grammar source:
`packages/syntax/jess/jess-parser/src/ast/grammar.ts` is absent,
`pnpm --filter @jesscss/jess-parser build` passes, and the full Jess parser
suite passes (6 files / 249 tests). `pnpm run check:macro` reports
parser-shared, CSS, Less, SCSS, and Jess fully compiled with 0 interpreter
fallbacks, and `pnpm run verify:compose-integrity` passes. Less, SCSS, and Jess
still carry naming/gating cleanup debt, but not second grammar bodies.

Current 2026-07-27 registry-0.41.0 gate evidence: dependency-order parser/plugin/
jess builds pass; `pnpm run check:macro` passes with all parser packages fully
compiled and 0 interpreter fallbacks; `pnpm run verify:compose-integrity` passes
with exit code 0; and `pnpm run verify:less-alpha` passes its Less parser,
Less plugin, `jess`, package-export, public-API, path-resolution, Less
test-data unit, and Less test-data config lanes. The Less oracle fails against
the checked-in baseline with the current dirty integration aggregates
`ast=bf61fca63825da2c148c82f20fcf604bc407324ba967b94f46fedb886828fa8f`
with 115 throws and 110 moved entries, and
`cst=aee294a40cce49c7d1fb07f5438be3bd2facf21d78c6f786d28304de94c9d21d`
with 0 throws and 592 moved entries over 711 entries. Do not update the
baseline until the AST movers are reviewed and the broad CST ownership movement
is either projected as intended host-mode shape churn or minimized. The active
named-set split is
[`LESS-ORACLE-MOVER-CLASSIFICATION.md`](../architecture/parser/LESS-ORACLE-MOVER-CLASSIFICATION.md).

| fact                                            | value at time of writing                                                                                          | how to re-check                                                                                                                                                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| parseman version jess resolves                  | **0.41.0** from the registry; root + parser-shared + all four parser package dependency/peer ranges are `^0.41.0` | `node -p "require('./node_modules/parseman/package.json').version + ' ' + require('fs').realpathSync('./node_modules/parseman')"` and `rg -n '"parseman"' package.json packages/parser-shared/package.json packages/syntax/*/*-parser/package.json` |
| parseman published `latest`                     | **0.41.0**                                                                                                        | `npm view parseman version`                                                                                                                                                                                                                         |
| parseman `main`                                 | **0.41.0** at publication time                                                                                    | `git -C <parseman checkout> show origin/main:package.json \| grep version`                                                                                                                                                                          |
| `hostMode` first ships in                       | **0.37.0**                                                                                                        | parseman `CHANGELOG.md`, the 0.37.0 section                                                                                                                                                                                                         |
| PRs #75, #76, #77, #80, #81, #82, #83, #84, #85 | **merged**                                                                                                        | `gh pr list --repo matthew-dean/parseman --state all`                                                                                                                                                                                               |
| **PR #85 — `hostMode` reaching the macro**      | **merged**, on `dev` in jess via `6908e7b4f`                                                                      | `gh pr view 85 --repo matthew-dean/parseman`                                                                                                                                                                                                        |

> **PR #85 — the keystone — is merged and the macro carries it.** jess's
> grammars are compiled through the parseman **macro** (`with { type: 'macro'
}`), not through a runtime `compile()` call; `hostMode` now reaches the
> macro, so each dialect's surviving `src/grammar.ts` can emit both the AST and
> positioned-CST artifacts. The remaining Stage 3–6 work is grammar polish, not
> further physical collapse.

> **Publishing parseman is owner-only.** Agents never merge or release parseman
> PRs (`docs/architecture/core/HANDOFF.md`, COLD START item 7). 0.41.0 is now
> published and jess consumes it; any future parseman bump goes through the same
> owner gate.

> **Parseman routing shape:** exact keyword contexts use `word()` / `keywords()`.
> Known-or-generic token families use macro-compiled `dispatch(combinator,
when(...), otherwise(...))`: consume one broad token, route by the returned
> value, commit a matched known case, and fall back only for truly unknown token
> values. Use `when(..., { caseInsensitive: true })` or a single grammar-local
> `makeWhen(...)` helper for repeated cases with the same policy. Use `routed()`
> when the selected branch node should own the already-consumed value/span. See
> `docs/architecture/parser/GRAMMAR-SEQUENCE-ORCHESTRATION.md` for the current
> adversarial review and sequencing decision.

**Current rebuild context for a grammar author:**

| what                                                               | where                                                                                                                  |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| The grammar naming law                                             | [`GRAMMAR-REVIEW-STANDARD.md`](../architecture/parser/GRAMMAR-REVIEW-STANDARD.md) item 14                              |
| `packages/parser-shared` (renamed from `internal-css-recognition`) | `packages/parser-shared/`, rename commit `a74131e8f`                                                                   |
| `packages/syntax/` packages-by-syntax regroup                      | `packages/syntax/<lang>/<pkg>/`, move commit `e96d1035d`                                                               |
| `packages/editor/` and `packages/docs/` sibling groups             | `packages/editor/<pkg>/`, `packages/docs/<pkg>/` — same commit `e96d1035d`                                             |
| parseman 0.41.0 floor                                              | root, parser-shared, and all four parser package manifests use `^0.41.0`; parser package peer ranges require `^0.41.0` |
| parseman/oracle byte-identity gate (Stage 2 of the rewrite)        | `packages/syntax/less/less-parser/test/oracle-byte-identity.mjs` + committed baseline at commit `a2911a491`            |
| The un-awaited-assertion helper                                    | `test/expect-sync.ts` — repo root, **not** under `packages/` (§0.6.1)                                                  |
| The `as any` detector                                              | `pnpm lint:absolute` (§0.6)                                                                                            |
| The `tree/` cutover inventory                                      | [`../architecture/core/TREE-CUTOVER-SURFACE.md`](../architecture/core/TREE-CUTOVER-SURFACE.md) (§0.7)                  |
| Removal of the dead `@jesscss/plugin-css`                          | `ls packages` — no such directory                                                                                      |

The **language-service suite is green** (§8.4) and composition is settled as
**terminal leaves** (§0.5).

### 0.3 The plan, in order, with what gates what

Read this as a dependency chain, not a wish list. The ordering is not implied by
document order; it is stated here.

| step  | what                                                                                                                                                                     | gated on                                                                                             | who                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **1** | **Parseman grammar floor**                                                                                                                                               | paid by `parseman@0.41.0`; future parseman releases remain owner-only                                | **owner only for future releases** |
| **2** | **Physical eight-to-four fold** — one host-mode `src/grammar.ts` per dialect                                                                                             | **complete**; deleted `src/ast/grammar.ts` files are historical evidence only                        | agent                              |
| **3** | **CSS polish** — spec names, small rules, documented deviations, `word(...)`, separated-list helpers, and `dispatch(...)`/`routed()` for known-or-generic token families | step 2 complete; CSS remains the base for dialect cleanup                                            | agent                              |
| **4** | **Less polish** — compose on CSS, keep Less deviations explicit, delete SCSS-only inheritance, parse selectors/extends/values once                                       | step 3 shape decisions; CSS/Less are the alpha bar                                                   | agent                              |
| **5** | **SCSS, then Jess polish** — repair the folded grammars without recreating second grammar bodies or Less inheritance                                                     | step 4; SCSS/Jess may be temporarily red while being rebuilt, but duplicate grammar bodies stay dead | agent                              |

**Acceptance, identical for every dialect** (§8.2 states these with evidence
requirements):

1. That dialect's parser suite green — as a **named set**, not a count (§0.6).
2. The **language-service suite** green — it consumes the CST, so the `'cst'`
   emission is a first-class gate, not a background check.
3. **0 interpreter fallbacks** — `pnpm run check:macro` and
   `pnpm run verify:compose-integrity`. **This is a correctness gate, not a perf
   gate** (§0.6, §8.2). Both are already blocking, in `scripts/verify-pr.mjs:90`
   and `:100` and in `.github/workflows/pr-quality-gate.yml:71` and `:78`.
4. A perf check treated as **confirmation-only in both directions** — a PASS
   certifies nothing (§0.6, §8.5).

   > **`perf:xproc`, `perf:guard:grammars` and `perf:workloads` are parseman
   > scripts, not jess scripts.** `grep -rn 'perf:xproc\|perf:guard\|workload-perf'`
   > over this repo returns **zero hits**; they are `package.json:70,71,85` in
   > the **parseman** checkout (`bench/grammar-perf-guard.ts`,
   > `bench/xproc-ab.ts`, `bench/workload-perf-guard.ts`). An agent looking for
   > them here will find nothing and must not conclude the gate is missing. For a
   > jess-side number the harness is §8.5's single-process interleaved arena,
   > which **is not checked in** — building or importing it is part of the first
   > unit that needs a perf claim.

**One thing that does _not_ gate you.** The `tree/` cutover (§0.7) is a
**parallel track** in `packages/core`. Three of its steps are mechanical and
landable immediately; exactly one is semantic. It does not block grammar work
and grammar work does not block it. Other agents are frequently live in
`packages/core/src/ast/` and `docs/architecture/core/` — coordinate before
editing there.

**Historical note.** The old plan allowed some CSS rewriting before the Parseman
floor was paid. That blocker is gone in the active checkout: do not recreate a
two-file grammar path or target pre-0.40 Parseman APIs.

### 0.4 Figures in this document that did **not** reproduce at `92d38af4f`

Recorded rather than silently patched, because a document that quietly
self-corrects teaches nobody that it drifts. The body text has been corrected;
this table is the audit trail.

| claim as written                                                                                                 | corrected                                                                       | why it moved                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hostMode` / `analyzeDuplication()` ship in **0.40.0**; the collapse has a "hard floor of 0.40.0"                | **0.37.0**                                                                      | parseman PR #83, _"collapse the unpublished 0.38–0.41 versions into 0.37.0"_. There was no published 0.40.0 in that historical sequence; future 0.40.x releases can still exist. Every "0.40.0" in the original text meant the hostMode floor |
| `DirectJess*` distinct names = **171**                                                                           | **volatile after the fold**                                                     | Remeasure in `packages/syntax/jess/jess-parser/src/grammar.ts` with `grep -ohE 'DirectJess[A-Z][A-Za-z0-9_]*' ... \| sort -u \| wc -l`; the old `src/ast/grammar.ts` count is pre-fold historical evidence only                               |
| the `internal-css-recognition` rename is unproposed and "sequenced last"                                         | **it landed**, as `packages/parser-shared`                                      | commit `a74131e8f`                                                                                                                                                                                                                            |
| `parseman/oracle` (PR #75) is "UNMERGED AND UNRELEASED"                                                          | **merged**                                                                      | `gh pr view 75 --repo matthew-dean/parseman`                                                                                                                                                                                                  |
| the stale-cached-worktree fix "is not on `main`"                                                                 | **merged** (PR #82)                                                             | ditto, `#82`                                                                                                                                                                                                                                  |
| `.cursor/rules/domains/parsers.mdc` globs the dead path `packages/parser/**` and omits `packages/jess-parser/**` | **already corrected on `dev`** — it globs all four parsers plus `parser-shared` | `head -10 .cursor/rules/domains/parsers.mdc`                                                                                                                                                                                                  |
| `grep -rn chevrotain` over the four parser `src/` trees "returns **zero** hits"                                  | **four hits, in two files**                                                     | `packages/scss-parser/src/grammar.ts:453`, `packages/less-parser/src/ast/grammar.ts:3177,3184,3208` — all historical prose comments. The _substance_ holds (Chevrotain is not the stack; there is no runtime dependency); the count does not  |
| **576 of 592 builders** violate `direct-builder-static.ts`, and that file is in `scripts/`                       | **unverifiable here**; the file is in **parseman**, not jess                    | No checked-in script produces the ratio, and the population does not match — 323 `node(` sites across the eight grammars. The _constraint_ reproduces exactly (§0.5b). The _conclusion_ stands on other evidence                              |
| `pnpm perf:xproc` / `perf:guard:grammars` / `workload-perf` are jess commands                                    | **they are parseman commands**                                                  | `grep -rn 'perf:xproc\|perf:guard\|workload-perf'` over jess → zero hits; they are `package.json:70,71,85` in parseman                                                                                                                        |
| **~237** un-awaited assertions                                                                                   | **272** by the stated regex, across 45 files                                    | §0.6.1. And `expectSync` has **zero** call sites                                                                                                                                                                                              |
| `test/expect-sync.ts` is under `packages/core/`                                                                  | **repo root**, `test/expect-sync.ts`                                            | with a companion `test/expect-sync.test.ts`                                                                                                                                                                                                   |

Two figures that reproduce but whose **scope matters**, so they are stated with
their method rather than as bare numbers:

- **`CssAst*` = 157** is the count _within `packages/css-parser/src`_. Repo-wide
  the distinct total is **166** — nine `CssAst*` names are referenced only from
  the less/scss/jess grammars. So the headline **735** total holds under
  per-package scoping and is **744** repo-wide. Both are true; say which you
  mean.
- **`parseman` is pinned at 10 sites** counts _pin lines_, across **6**
  manifests. Two range forms coexist: four caret ranges (`^0.32.0`) and six
  exact pins (§0.5).

### 0.5 Two mechanisms a rebuild author has to have straight

**(a) `hostMode` — one grammar source, two compilations, not two grammars.**

```ts
compile(grammar, { hostMode: "ast" | "cst" });
```

- A grammar with **no direct builders** is mode-agnostic: the host builds every
  node and `hostMode` never enters it.
- `hostMode` becomes load-bearing **only once a rule has a direct builder** —
  that is the first moment at which the two artifacts can diverge at all.
- The default is `'ast'`. A `'cst'` artifact requires a positioned-CST host
  (`cstBuildHost`).
- **Mismatches throw rather than degrading silently** — a mixed-mode `compose`
  is rejected at fuse time (§5.2c). That guard was found by review, not by a
  gate; do not read its silence as proof.

Full detail, with codegen line references, is §5.3.

**The pin sites.** The package is **`parseman`** — unscoped and external, _not_
`@jesscss/parseman`; a search for the scoped name matches nothing and returns
clean. These manifests are the current places to verify when a later Parseman
release is adopted.

| file                                            | line                                | form                 |
| ----------------------------------------------- | ----------------------------------- | -------------------- |
| `package.json`                                  | root dev dependency range           | `^0.41.0`            |
| `packages/parser-shared/package.json`           | shared dependency range             | `^0.41.0`            |
| `packages/syntax/css/css-parser/package.json`   | peer floor and dev dependency range | `^0.41.0`, `^0.41.0` |
| `packages/syntax/less/less-parser/package.json` | peer floor and dev dependency range | `^0.41.0`, `^0.41.0` |
| `packages/syntax/scss/scss-parser/package.json` | peer floor and dev dependency range | `^0.41.0`, `^0.41.0` |
| `packages/syntax/jess/jess-parser/package.json` | peer floor and dev dependency range | `^0.41.0`, `^0.41.0` |

Plus `pnpm-lock.yaml`. **The invariant is that compiled parser artifacts never
cross parseman versions** — a bump regenerates every artifact and rebaselines
every aggregate hash, so a bump and a grammar edit must never share a commit.

**(b) Where shared productions live, and why composition is terminal leaves.**

`packages/parser-shared` (`@jesscss/parser-shared`) is the home for productions
consumed by **two or more** parsers **and** parser-specific. Anything failing
either half of that test does not belong there.

It has no package-root export; consumers import by subpath —
`./recognition`, `./opaque-at-rule`, `./pseudo-consts`. Its four value exports
are `cssSyntax`, `lessSyntax`, `cssPseudoSyntax`, and
`opaqueAtRuleRecognition`. The shared recognition exports were cleaned on
2026-07-26 from `cssAstSyntax` / `cssAstPseudoSyntax` and `lessAstSyntax` to
remove false compile-mode names; their rule keys likewise moved from
`CssAstSyntax*` / `LessAstSyntax*` to `CssSyntax*` / `LessSyntax*`. The CSS and
Less prefixes are now language scope markers rather than compile-mode markers;
if the four-grammar rebuild later makes a base module itself unambiguous, that
prefix can disappear too.

**Cross-artifact `compose()` is not available, so the rebuild proceeds as
terminal leaves.** The constraint a builder must satisfy to be statically
resolvable is `direct-builder-static.ts` — **which is in parseman, not in this
repo**: source at `src/plugin/direct-builder-static.ts` in the parseman
checkout, shipped to jess only as bundled output at
`node_modules/.pnpm/parseman@0.32.0/node_modules/parseman/dist/plugin/index.js`
(the implementation is `directBuilderUnsupportedBindings`). Read there, verified:

- the builder must be an **expression-bodied arrow** — a `BlockStatement` body
  is rejected, and so is a nested block-bodied arrow;
- **plain-identifier parameters only** — no destructuring, no defaults, no rest;
- it may read **only its parameters plus 13 globals**: `Array`, `Boolean`,
  `Date`, `JSON`, `Math`, `NaN`, `Number`, `Object`, `String`, `Infinity`,
  `parseFloat`, `parseInt`, `undefined`.

jess's grammar builders overwhelmingly violate this by calling **imported AST
constructors and grammar-local helpers**, neither of which is in the allow-set —
which is why cross-artifact `compose()` is unavailable and the rebuild proceeds
as terminal leaves. **This conclusion is settled** and is independently
supported by §5.4 and §13.3; do not re-propose `compose()` across artifacts
without new evidence.

> **The specific figure "576 of 592 builders violate it" does not reproduce from
> this repository.** No checked-in script produces it, and the population does
> not match: `node(` across the eight grammar files is **323**
> (`grep -ohE '\bnode\(' packages/{css,less,scss,jess}-parser/src/{,ast/}grammar.ts | wc -l`).
> Treat the ratio as unverified and re-measure against parseman's own checker if
> a number is needed. The **qualitative** finding — the violations are imported
> constructors and grammar-local helpers — is what the conclusion rests on, and
> that is checkable by reading builders in the surviving grammar sources.

### 0.6 The failure class this project pays for over and over

**A check that reports success because it cannot see the failure mode.** Almost
every expensive defect in this repo's history is an instance. §9 is the full
scar record; these are the ones a _new_ agent will otherwise rediscover one at a
time.

**Build order — `parser-shared` FIRST.** All four parsers depend on it. Build
them before it and they link against a stale recognition library, and the suite
goes **green** while masking ~17 real failures. Full order:

```
parser-shared → parsers → awaitable-pipe → core → fns → styles-config
              → style-resolver → plugins → jess
```

`pnpm run build:release` does the whole thing in order. Two traps inside that
line:

- **The config package is named `styles-config`, not `@jesscss/config`.** A
  `pnpm --filter` on the scoped name matches nothing — **and a filter that
  matches nothing exits 0.** The same trap moved a jess failure count from 13 to
  23 via `pnpm --filter "*/jess-plugin-*"`. **Check what a filter actually
  selected before trusting any count taken through it.**
- **Tests run from `lib/`, not `src/`.** A stale build silently measures an
  older commit and reports it as today's number. Rebuild between every edit you
  intend to measure. A fresh worktree has no `node_modules` at all — `pnpm
install` plus the ordered build before any number is real.

**Stale artifacts fail silently and cleanly.** Stale `dist/`, stale `lib/`,
stale `.cache/` worktrees, and `link:` overrides that dangle and resolve _up_
into a parent checkout's `node_modules` are four costumes for one bug, and none
of them announces itself.

> **The rule: report the resolved path and the resolved version, per package, as
> evidence, ahead of any numbers. If a run cannot show what it loaded, its
> numbers are unfalsifiable.**

**Some files search cannot see.** `scripts/lint-violation-report.mjs` contains
**three literal NUL bytes** — used deliberately as a map-key separator
(`` `${rule}\0${relative}` ``), written raw rather than as an escape. `file`
reports it as `data`; git classifies it as binary, so `git grep -I` skips it
entirely and its content is excluded from textual diffs. **And it holds the
grammar-lint scope list** — five globs naming exactly the four parser packages
plus `parser-shared`. So a `git grep` sweep for the grammar lint scope finds
nothing and looks conclusive. **A `git grep` that finds nothing is not evidence
that nothing is there.** Use `grep -r` when a negative result is load-bearing.

**Baselines before attribution.** Record the **named** failing-test set at your
base sha before changing anything, and compare **names, not counts**. A matching
count hides "one fixed and one broken" perfectly. `all-less` moved 108 → 106
with no jess-side change at all, purely from an unpinned less.js checkout
moving.

**The perf harness is not trustworthy as a verdict.** parseman's
`perf:guard:grammars` and `perf:workloads` have produced confident **FAIL**s on
byte-identical inputs on three separate occasions, and one of them could
silently benchmark the wrong commit while reporting the sha it _intended_
(§8.5.1). The noise floor is roughly **±1.9%**. `perf:xproc` is the supported
cross-process method and it is **confirmation-only in both directions** — use it
to confirm a red, never to certify a green. All three are **parseman** scripts
and do not exist in this repo (§0.3, step 4). A neutral result is a perfectly
good result; the gate for this work is §8.1–§8.4, not a speedup.

**Macro fallback is a CORRECTNESS gate.** Stated separately in §8.2 because it
is the single most dangerous silent failure here: **a build that degrades to the
interpreter emits a different tree.** `pnpm run check:macro` and
`pnpm run verify:compose-integrity` must show **0 interpreter fallbacks**. A
green test suite does **not** clear a fallback — the suite can pass on the
interpreted tree while the shipped compiled tree differs. A red run
**invalidates any differential taken on that build.**

### 0.6.1 Repo rules a fresh agent will otherwise violate

Every prohibition carries its reason. A rule without one reads as arbitrary and
gets optimised away.

- **Never `git stash`, `git restore`, `git checkout -- .`, or `git reset --hard`
  without explicit permission.** `git stash` has silently destroyed work in this
  repo. If you genuinely need one, back the tree up first
  (`git diff > /tmp/backup.patch`) and record where. **Commit before measuring**
  — that is the supported way to compare two states.
- **Never `as any`, `: any`, `@ts-ignore`, or `@ts-nocheck`.** `pnpm
lint:absolute` (`package.json:67`, config `eslint.absolute.config.mjs`)
  detects these, non-suppressibly — `linterOptions.noInlineConfig` means an
  `eslint-disable` comment will not silence it. **It reports 500 pre-existing
  errors across 52 files, and it is deliberately not wired to a blocking gate**
  — absent from both husky hooks, from `scripts/verify-pr.mjs`, and from all
  three workflows. Both halves matter: an agent who sees 500 violations and
  concludes the rule is dead will add the 501st. The backlog is a backlog; the
  rule is live. Re-check with `pnpm lint:absolute` rather than trusting the
  number.
- **Hundreds of test assertions deliberately omit `await`** on
  `MaybePromise`-returning calls. `Node.eval()` (`packages/core/src/tree/node-base.ts:1480`)
  and `Node.render()` (`:1645-1647`) are **not** `async`; on the synchronous path
  they return a value, not a promise. The omission is **load-bearing** — it is
  what pins the synchronous fast path under test. **Adding `await` to silence a
  lint warning silently deletes that coverage, and the suite still passes.**
  Count as a heuristic upper bound:

  ```sh
  grep -rnE "(^|[^a-zA-Z])expect\([^)]*\.(render|eval)\(" --include='*.ts' packages/core \
    | grep -v await | wc -l
  ```

  **272** at `92d38af4f`, across 45 files, all under
  `packages/core/src/tree/__tests__/`. (A previously circulated figure of ~237
  does not reproduce by this method; the exact number depends on the regex, so
  re-run it rather than quoting either.) A helper exists for cases that should
  assert synchrony explicitly — **`test/expect-sync.ts` at the repo root**, which
  throws when handed a thenable and carries its own instruction never to "fix" a
  failure by adding `await`. **It currently has zero call sites**
  (`grep -rn expectSync --include='*.ts' packages` → 0), so the guarantee is
  tooled but not adopted. Do not read its existence as coverage.

- **`.css` fixtures are Less v5 alpha expected output and are owner-maintained.**
  A top-level diff against one is **a jess bug by default**, not a fixture to
  update.
- **Tests are imperfect encodings of the documented design; the design is the
  source of truth.** Do not treat a test expectation as sacred — but the
  less-compat bridge **is** a real external contract, and `all-less` is the
  fixture-backed authority (§13.1).
- **Never create a `productions.ts`.** Upgrade `productions/*.ts` in place. (No
  `productions/` directory exists in any parser package today; the rule governs
  what you may create.)
- **No regex outside `regex()`.** Pattern text belongs in a `regex()` argument
  and nowhere else — enforced at `error` by
  `grammar/no-regex-outside-combinator`.
- **Never merge or release a parseman PR.** That is the owner's, always.

### 0.7 The `tree/` cutover — context, not a dependency

[`../architecture/core/TREE-CUTOVER-SURFACE.md`](../architecture/core/TREE-CUTOVER-SURFACE.md)
inventories the deletion of `packages/core/src/tree/`. In one paragraph:
`tree/` is **130** of core's ~180 non-test source files, and **235 of
`@jesscss/core`'s 319 root exports are declared inside it** — 74% of the public
API by name count, most of it fallen out of a single wildcard re-export. The
`Context` step, which sounds like the hard one, is by the runtime-usage audit
**delete 33 members and the 10 `tree/` imports, keep 73** — every deleted member
is legacy-eval state, all 25 externally reachable members are already tree-free,
so it is mechanical with zero external blast radius. **Exactly one step is
semantic: the Sass map key model** (§1c of that document). Everything else is
bookkeeping.

This matters to a grammar agent only as context for why core's public surface is
about to change underneath the AST constructors the grammars import. It is a
parallel track. It does not gate the rebuild.

> That document was measured at `04e245b56` and states that the
> `internal-css-recognition` → `parser-shared` rename "had not landed at this
> SHA", so its paths use the old name. **The rename has since landed**
> (`a74131e8f`); read those paths accordingly.

---

## 1. How to use this document

§6 is a set of **dispatchable units**. Each states its scope and boundary, what
is off-limits and why, the references to read first, the method, the pass
criteria, and what to do when blocked. A unit can be handed to an agent verbatim
with no other context.

§8 is how each unit is **measured**. §9 is what does **not** count as success.
§9 is not boilerplate — every entry on it is something that actually happened,
most of them in the session that produced this document.

### Referenced documents

| Document                                                                                                          | Owns                                                                                       | Status                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`GRAMMAR-REVIEW-STANDARD.md`](../architecture/parser/GRAMMAR-REVIEW-STANDARD.md)                                 | The per-`const` checklist, the outcome vocabulary, the hard constraints                    | **Landed on `dev`** (`76680b114`), byte-identical to the branch version, with `.cursor/agents/grammar-reviewer.md`                               |
| [`PARSEMAN-COMBINATOR-CHEAT-SHEET.md`](../architecture/parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md)                 | The version-stamped combinator reference                                                   | **Written.** Use it as the quick Parseman decision table for `dispatch(...)`, `choice(...)`, `word(...)`, `keywords(...)`, and separator helpers |
| [`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md`](../architecture/parser/PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md)           | The two pinned-version constraints load-bearing for every measurement                      | On `dev`. **Its §2 blanket claim is superseded** — see §8.6                                                                                      |
| [`DIALECT-ARCHITECTURE-AND-ERROR-COVERAGE.md`](../architecture/parser/DIALECT-ARCHITECTURE-AND-ERROR-COVERAGE.md) | The SCSS-on-Less inversion, with the build-verified proof that it blocks Less-side cleanup | On `dev` (`ac02c6e0b`) — see §5.4                                                                                                                |
| `docs/design/PARSEMAN-0.34-GRAMMAR-IDIOM-PLAN.md`                                                                 | The P-1…P-9 parseman feature requests                                                      | **Not on `dev`** — only on branch `parseman-034-adoption` (`a49ca59da`), 981 lines                                                               |

---

## 2. The historical baseline problem

At the start of the rebuild, the repo had **eight grammar files, 24,305
lines**: two hand-maintained specifications of the same language per dialect
with no mechanical link between them. The current worktree has moved to one
host-mode grammar source per dialect; keep this section as historical evidence,
not current status.

| dialect       | CST `src/grammar.ts` | AST `src/ast/grammar.ts` | AST rule-name prefix | distinct prefixed names |
| ------------- | -------------------- | ------------------------ | -------------------- | ----------------------- |
| `css-parser`  | 1,527                | 3,455                    | `CssAst*`            | 157                     |
| `less-parser` | 1,281                | 4,750                    | `DirectLess*`        | 243                     |
| `scss-parser` | 1,379                | 5,116                    | `DirectScss*`        | 167                     |
| `jess-parser` | 1,210                | 5,587                    | `DirectJess*`        | 168                     |

```sh
# Historical pre-fold measurement from the old package layout.
wc -l packages/{css,less,scss,jess}-parser/src/grammar.ts \
      packages/{css,less,scss,jess}-parser/src/ast/grammar.ts
grep -oE 'Direct[A-Z][A-Za-z0-9_]*' packages/less-parser/src/ast/grammar.ts | sort -u | wc -l
```

**Use the `[A-Z]` anchor.** A bare `Direct[A-Za-z0-9_]*` returns 244/168/172 —
the extra one in each file is the standalone word "Direct" in prose.

> **Line count is now a poor metric, and it is instructive why.** It read 17,447
> one day earlier. `516d10222` briefly turned on
> `@stylistic/function-call-argument-newline` at `error` with an always-expanded
> call style across these files, and autofix moved arguments without changing the
> grammars. The active config now leaves grammar function-call argument layout to
> code review so short Parseman calls can stay compact, but the lesson remains:
> **do not track this work by line count.** Track it by rule-name intersection
> (§2.1) and by the §2.3 conversion classes.

### 2.1 The naming families are disjoint, and that is the structural cause

Historically, the four deleted AST grammars used disjoint rule-name
vocabularies. That naming debt can still survive inside the four host-mode
`src/grammar.ts` files as `CssAst*`, `Direct*`, or other mode-flavoured names.
The current task is to remove or justify those surviving names in the folded
grammar sources.

One nuance that changes the work: **the emitted node types already agree.** The
grammar reductions import the same constructors from `@jesscss/core/ast` and
check the same semantic node names. The divergence is in **grammar rule names**,
not in a need to redesign the AST — which is exactly why a byte-identity oracle
cannot gate pure private-rule renames (§8.1).

Core's vocabulary is `Rule`, `AtRuleBlock`/`AtRuleStatement`, `SelectorList` —
there is no `Ruleset` and no `AtRule` node type. Use core's names.

### 2.2 Four costs already paid

- **`${…}` shipped in the AST grammar and errored in the editor.**
  `packages/less-parser/src/ast/grammar.ts:1629` defines
  `DirectLessPropertyInterpolation`, consumed by the quoted-string arms at
  `:1662`, `:1663`, `:1697`, `:1698`. The CST grammar does not:
  `packages/less-parser/src/grammar.ts:162` is `const strInterp = lessInterp;`
  — `@{…}` only — so `"${prop}"` never structures on the surface the editor
  reads. The comment at `:157` still says Less "may later add" the form that
  `:113` already defines.
- **`interpAccessorKey` is correct in the AST grammar and stale in the CST.**
  CST (`packages/less-parser/src/grammar.ts:106`) is one flat character class;
  AST (`packages/less-parser/src/ast/grammar.ts:1541-1594`) is a four-arm choice
  distinguishing `index`, `var` and `prop` keys, including `[]` (`:1547`) which
  the `+`-quantified CST regex cannot match at all.
- **A CST-only production with zero coverage.** `DeferredScalarDeclaration`,
  `packages/less-parser/src/grammar.ts:531`. Its builder no longer exists; the
  only surviving mention is a stale doc row at
  `docs/architecture/core/VALUE-NODE-MODEL-DESIGN.md:241`. It is **not**
  unreachable — it is the first arm of `Declaration` at `:544`, so it silently
  shapes the CST for input as ordinary as `a: 10px;`, with no consumer and no
  test. Worse than dead.
- **Terminal-level duplication the shared package was supposed to prevent** —
  §2.3.

### 2.3 The measured worklist

The owner's standing worklist (`bcb3107a1`) was _20 near-clone clusters, 14
separated lists, 18 leading-`not()` sites_, scoped to `less-parser`. The table
below is pre-fold historical worklist evidence. For current cleanup, remeasure
over the four surviving files:
`packages/syntax/{css,less,scss,jess}/*-parser/src/grammar.ts`.

| Item                           | Brief | Measured                                                                                       | Method                                                                                                       |
| ------------------------------ | ----- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Hand-rolled keyword regexes    | 15    | **9** (was 18 a day earlier)                                                                   | `regex()` whose pattern, after stripping `^`/`$`/`\b`/lookaheads/`(?:…)`, is a pure `word\|word` alternation |
| Hand-rolled separated lists    | 39    | **65** (29 a literal `sepBy` swap)                                                             | `many(sequence(<separator terminal>, …))`                                                                    |
| Spellings of one operator set  | 7     | **7**, +5 for the Less guard superset                                                          | distinct spellings of `< <= = >= >`                                                                          |
| Near-clone clusters            | 20    | **24** at ≥3 files (69 at ≥2, 10 at ≥4)                                                        | normalise `const X = node\|choice\|sequence(` names by stripping the dialect prefix, then group              |
| Leading `not()`                | 18    | **43**                                                                                         | `sequence(not(` after whitespace flattening                                                                  |
| `not(regex(` as terminator     | —     | **21** literal; **180** for all `not(`                                                         | whitespace-flattened `re.findall`                                                                            |
| `noTrivia`                     | —     | **300**                                                                                        | ditto. `optional(ws…)` is only **10**. `scss` CST uses `noTrivia` zero times — an outlier                    |
| Bespoke boundary/ident classes | —     | **220** `(?!…)` lookaheads, **195** `[-_a-zA-Z0-9…]` classes                                   | ditto                                                                                                        |
| `/i` without `/u`              | —     | **154 of 569 regex literals — and ZERO literals in any of the eight files carry `/u` or `/v`** | per-line flag check                                                                                          |

The `/u` finding is the one to sit with: this is not a scattering of oversights,
it is the uniform house style, and `/i` case-folding is running in non-Unicode
mode everywhere. Several patterns embed a raw non-ASCII range
(`packages/scss-parser/src/ast/grammar.ts:934`) — exactly what `/u` would reject.

**Leading `not()` must be counted multiline-aware.** Since `516d10222` expanded
the call form, a plain `grep -c 'sequence(not('` returns 14 instead of 43. Use:

```sh
perl -0777 -ne '$c=()=/sequence\(\s*not\(/g; print "$ARGV: $c\n"' \
  packages/syntax/{css,less,scss,jess}/*-parser/src/grammar.ts
```

`sepBy` exists in 0.32.0 and is used **12** times across the eight files — and
**zero** times in the `jess` CST or in any of the `less`/`scss`/`jess` AST
grammars. `keywords()`/`word()` also already exist. **The API was there. It was
not reached for.** That is what §4 step 1 exists to fix.

**The keyword-regex count halving in one day is the proof that it works.**
`5d0a61523` moved the CSS named-colour list to `keywords()` on the _shared_
recognition rule, taking the count 18 → 9 and leaving `packages/less-parser/src/grammar.ts`
as the only grammar file with `keywords()` call sites (13 of them). The
remaining 9 are: `(?:and|or)` in the CSS CST; `(?:from|to)` repeated **identically
in all four AST grammars** — a four-way clone, and the cleanest available
demonstration of §2.1; `(?:reference|optional|once|multiple|inline|css|less)` and
`(?:is|not|has|where|matches|global|local)` in the Less AST; and
`(?:is|not|has|where|matches)` plus `(?:global|local)` in the SCSS AST — the last
pair being the Less one split in two, i.e. the same set spelled three ways.

---

## 3. The target

**One grammar file per dialect. The four grammars should not look anything like
the old ones.**

A reviewer who diffs old against new and mostly sees renames is looking at the
wrong outcome, and that is a stated failure condition, not a stylistic
preference. See §8.7 for how "doesn't look like the old one" is judged, and by
whom.

The old grammars are a **reference for the accept set only**. The CSS grammar is
the reference for shape.

---

## 4. Method, in order

The order is deliberately inverted from the obvious one. Reaching for the docs
when stuck is how you end up with a regex.

1. **Survey the pinned parseman export surface from source and package
   resolution** — not from recollection. The active floor is `parseman@0.41.0`.
   Use `word()` / `makeWord()`, `keywords()`, `oneOrMoreSep(...)`, `peek(...)`,
   `dispatch(...)` / `when(...)` / `otherwise(...)`, matcher cases,
   `routed()`, and `node(..., { project })` where they are the best grammar
   shape.
2. **Produce a version-stamped combinator cheat sheet** as the artifact of that
   survey, in `docs/architecture/parser/`.
3. **Measure test/corpus coverage of the existing grammars.** Productions no
   test reaches are where a rewrite silently drops behaviour, and where existing
   bugs most likely hide. **This measurement is the fact that decides whether
   greenfield is safe** — a gate on the decision, not a report.
4. **Pilot on CSS, complete, before any dialect starts.** Smallest, best-specified
   externally, and the base the others compose on, so it is not throwaway either
   way.
5. **Then the dialects**, each composing on the finished CSS base.

**Per rule: state what it recognises, in prose, from the spec — then write
combinators for that description.** Describing before writing is what stops the
old shape leaking back. A rule written by reading the old rule and re-spelling it
is a rename, which §3 rules out.

---

## 5. Blockers and sequencing

Each is stated with what is actually verified, because several were given to this
document in a form the tree does not support.

**Read §5.1 first: the parseman-version blocker is resolved, and the answer
changed the sequencing.** What remains blocking is narrower than it was:

| §                                     | status                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.0 the version question              | **RESOLVED.** parseman 0.41.0 is published and consumed by the active checkout (2026-07-27). `hostMode` reached the macro in 0.37.0 (PR #85 merged), 0.38.0 added keyword ergonomics, 0.39.0/0.39.1 added `dispatch(...)` and its routing refinements, and 0.40.0 adds declarative node projection (`node(..., { project: index })`). The architecture floor is paid; the active grammar-polish sequence can proceed |
| 5.1 the 0.36.0 adoption               | **RESOLVED** — measured and declined. Authoring is not blocked on a bump                                                                                                                                                                                                                                                                                                                                             |
| 5.2 the 0.32.0 hazards                | **standing constraints**, not blockers — check per unit. Three now, including the cross-mode fusion hazard                                                                                                                                                                                                                                                                                                           |
| 5.3 `hostMode`                        | **RESOLVED** — shipped at 0.37.0 as a compile-time flag. Delivery taken; it is now a version-floor question, not a missing mechanism                                                                                                                                                                                                                                                                                 |
| 5.4 SCSS composing on Less            | **RESOLVED for the fold.** SCSS no longer composes on Less; it now ships AST and CST from its own host-mode grammar source. Remaining SCSS work is quality cleanup on the surviving grammar                                                                                                                                                                                                                          |
| 5.5 `internal-css-recognition` rename | **DONE** — landed as `packages/parser-shared` (`a74131e8f`). No longer blocks or is blocked                                                                                                                                                                                                                                                                                                                          |

### 5.0 The version question, stated plainly

**The collapse's hard floor is paid.** The active checkout consumes
`parseman@0.41.0`, and §0.2 records the current floor plus the gates that any
later grammar change must preserve. Future parseman publishing remains owner-only.

| what                                              | version    | why                                                                                                                                                             |
| ------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Writing and polishing the surviving grammar rules | **0.41.0** | Use case-insensitive `word(...)` / `makeWord(...)`, `dispatch(...)`, `makeWhen(...)`, matcher cases, `routed()`, and `node(..., { project })` wherever they fit |
| One grammar per dialect                           | **0.41.0** | `hostMode` lets one grammar serve both the eval-AST and positioned-CST modes (§5.3)                                                                             |

> **This is not a deferrable perf matter any more.** The version floor is paid
> and the physical fold is complete. The remaining work is grammar quality:
> simplify the four surviving sources, make the current Parseman shapes exemplary,
> and keep parser correctness plus macro/compose gates green as each slice lands.
>
> **What gates it: the Less measurement, nothing else.** Correctness at 0.36.0
> was already fully clean. A re-measurement at 0.37.0 under the cross-process
> method is **DONE**. This is historical release-floor evidence, not the current
> task shape; do not use it to reopen the eight-file alternative.
>
> Historical release-floor evidence: a two-sample parse-bench
> (`packages/syntax/less/less-parser/test/parse-bench.mjs`, 5-warmup / 15-timed
> samples per case) on commit `e96d1035d` versus `6908e7b4f` showed the
> host-mode floor was viable:
>
> | case                 | B 0.32 (ms median) | A avg 0.37 (ms) | Δ A−B      | A1–A2 spread |
> | -------------------- | ------------------ | --------------- | ---------- | ------------ |
> | `benchmark.less/ast` | 16.93              | 15.82           | **−6.6%**  | 2.6%         |
> | `benchmark.less/cst` | 21.54              | 15.18           | **−29.5%** | 2.6%         |
> | `bootstrap-port/ast` | 26.55              | 25.60           | **−3.6%**  | 1.4%         |
> | `bootstrap-port/cst` | 26.07              | 18.63           | **−28.5%** | 1.7%         |
> | `test-data-unit/ast` | 26.43              | 26.07           | **−1.4%**  | 2.4%         |
> | `test-data-unit/cst` | 24.74              | 18.51           | **−25.2%** | 3.6%         |

The active conclusion is simple: the version floor is paid; do not reopen the
eight-file alternative.

Two facts that make the floor more payable than it looks, both now inside
0.37.0: it carries a Less **improvement** — a derived `expected` set naming each
token once, which parseman measures at **32% of Less parse time**, with one
constant in jess's compiled Less grammar going 20 → 70+ entries. And it fixes a
defect in the analysis surface that matters directly to §8.6 (`reportGating`'s
`try/catch` making a crashed analysis indistinguishable from a clean one).
Neither has been measured in jess.

`hostMode` reaches the macro path used by Jess grammars (`with { type: 'macro'
}`), which is the required mechanism for the four surviving host-mode grammar
sources.

### 5.1 Historical 0.36.0 adoption measurement

The invariant is that compiled parser artifacts never cross parseman versions:
a bump regenerates every artifact and rebaselines every aggregate hash.

**The 0.36.0 adoption was measured and declined. jess could not reproduce
parseman's own −18.5%.**

_Correctness was fully clean_ — **zero AST movement across 3,053 file-parses in
all four dialects**, four parser suites green, `all-less` 108/108, and
`check:macro` at 0 fallbacks on **both** versions. Nothing about correctness
motivated the decision.

_Less regresses._ `less/css-corpus` read **+7.8 / +11.9 / +10.8 / +10.7%** across
four runs and three independent harness designs, win-rate **2–4 out of 25**. The
other two Less workloads are genuinely ambiguous — −7…−9% cross-process against
+2…+5% single-process interleaved — and the measuring agent **declined to claim a
direction on them**, which is the correct outcome to record rather than a gap to
fill.

So the sequence is now settled by measurement rather than by argument:

| version    | Less                                                          | evidence                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0.34.0** | **regressed**                                                 | jess +10…25% (`a49ca59da`, P-9); parseman +32.5% on 0.33→0.34, cause found (the `not()` probe-leak fix's six unconditional `array.length` stores on a probe running ~600×/KB) |
| **0.35.0** | **improved, not to parity**                                   | parseman's rollback-guard work; jess did not reach parity                                                                                                                     |
| **0.36.0** | **improves further, still net-negative on the sharpest case** | the numbers above                                                                                                                                                             |

**parseman's CHANGELOG claim that 0.35.0 is net-faster than 0.32.0 (−18.5% on
bootstrap and the jess corpus, 12/12 interleaved wins) is contradicted for jess's
Less grammar.** That is a finding worth carrying upstream, not a number to
discard — parseman measuring its own release on its own corpora is a different
fact from jess measuring it on four dialect grammars, and parseman's own
`not()`-per-KB figures (css 20 / jess 121 / less 599) predict exactly this kind of
per-dialect divergence.

The active checkout supersedes this historical measurement by consuming
`parseman@0.41.0`; use §5.0 for current authoring guidance.

**Why this ordering is better, not merely tolerable.** The residual regression is
concentrated in **Less parsing plain CSS**, not Less parsing Less. That points at
the ported CSS value and selector productions living inside the Less grammar —
which is precisely the duplication this rebuild exists to delete. **The rebuild
may well remove the code the regression lives in.**

> **That is a hypothesis, not a result.** It has not been tested and must not be
> quoted as a finding. What follows from it is only a sequencing conclusion:
> rebuilding first and re-measuring after is the **more informative** order,
> because a re-measurement taken after the duplicated productions are gone
> answers a question the current measurement cannot. Do not re-block the rebuild
> on the parseman version, and do not treat the hypothesis as a reason to skip
> the re-measurement.

### 5.1.1 Reading parseman source

parseman is at `/Users/matthew/git/oss/parser-thing` (the on-disk directory name
differs from the package name), and **has no version tags at all**. Read a version
from its worktree, never by tag:

| version                     | worktree                                           | branch                |
| --------------------------- | -------------------------------------------------- | --------------------- |
| **0.32.0 — the pinned one** | `/Users/matthew/git/worktrees/parseman-0.32-alloc` | `release/0.32.0`      |
| 0.36.0                      | `/Users/matthew/git/worktrees/pm-036-bump`         | `release/0.36.0-bump` |

**Read `src/`, not `dist/`.** The `parseman-0.32-alloc` worktree's `dist/` is
gitignored and stale relative to its own `src/`. For what jess actually
typechecks and runs against, use the pinned artifact at
`node_modules/.pnpm/parseman@0.32.0/node_modules/parseman`.

Also mislabelled, and still true: branches `parseman-035-adoption` and
`parseman-036-adoption` **both pin 0.32.0** and contain no parseman work.

Also mislabelled: branches `parseman-035-adoption` and `parseman-036-adoption`
**both still pin 0.32.0** and contain no parseman work (the latter holds
Less-grammar refactors done against 0.32.0). The 0.34 bump at `a49ca59da` is
**not an ancestor** of either. There is no 0.36 adoption in progress.

### 5.2 Writing against the current parseman floor

Grammar cleanup targets `parseman@0.41.0`. Verify the installed version before a
grammar slice, then use the current combinator surface directly. Do not carry
workaround shapes for older pins into new grammar code.

| Need                         | Current answer                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| keyword regexes              | `word(...)`, `makeWord(...)`, and `keywords(...)`; share one grammar-local helper when case-sensitivity and boundary policy are the same                               |
| separated lists              | `oneOrMoreSep(...)`, `sepBy(...)`, and an explicit optional terminator outside the list when the language permits a trailing separator                                 |
| small lookahead              | `peek(...)`, used sparingly when it expresses ownership such as "declaration may end at `}`"; do not use broad leading lookahead as a substitute for grammar structure |
| known/generic shared openers | `dispatch(combinator, when(...), otherwise(...))` with `routed()` inside the selected branch when that branch should own the already-consumed value/span               |
| AST projection               | `node(..., { project })` and local AST factories; no builder host or generic construction registry                                                                     |
| gates                        | `check:macro`, `verify:compose-integrity`, parser suites, and the relevant oracle/corpus differential                                                                  |

The dispatch rule is narrow and mandatory where it applies. Use it when sibling
arms would otherwise recognize the same broad opener before choosing a known or
generic continuation. CSS/Less examples: identifier-or-function values, glued
function openers such as `url(` / `calc(` / `var(` / `name(`, pseudo-function
openers, and at-keyword routers whose generic fallback belongs to the same
at-keyword token family. The routed combinator must include any glue that decides
the branch; `name(` is not `name` followed later by ambient trivia and `(`.

Keep `choice(...)` for disjoint statement/body items, closed literal or keyword
sets, punctuation/operator tables, list item alternatives, and delimiter
decisions that happen after the opener has already been accepted. CSS may
dispatch on an at-keyword to select a legal tail family and then keep a local
`choice(...)` for `{` versus `;`. Less must not dispatch on bare `@`: variable
declarations, reference calls, imports/plugins, conditional at-rules, generic
at-rules, and mixin-like continuations need more syntax before the grammar knows
which language branch it is in.

Lookahead remains a cost and ownership signal, not a forbidden word. Prefer a
leading discriminator, a separator/list helper, or a routed opener. Use `peek(...)`
only when the surrounding list owns the terminator and consuming it would be
wrong.

**(c) A compiled piece keeps the mode it was built with — the cross-mode fusion
hazard.** Relevant only once the collapse reaches 0.37.0 (§5.0), but it is the
defining hazard of the unified design, so it belongs here rather than being
discovered later.

An already-compiled piece carries its own `hostMode`. So a `'cst'` `compose`
could fuse an `'ast'`-compiled piece, whose direct builders dropped their CST
branch, and **feed AST objects into a positioned CST — with the assertion still
passing.** Silent cross-mode corruption, exactly the class the unified design
exists to be defended against.

**It is now rejected at fuse time**, in `fuseRules()`,
`src/compiler/linker.ts:359-380`, guard at `:370`: `compose/fuseRules: cannot
build a positioned-CST artifact from pieces that were compiled for host mode
"ast" — … Re-compile it/them with hostMode: 'cst', or pass the source grammar so
it can be re-lowered.` The offending namespace is named in the message. Only
pieces carried as IR are re-lowered by a compose; compiled ones are not.

> **Two things about how this was caught, both worth carrying.** It was found
> **by review, not by a gate** — the fix is a separate follow-up commit
> (`99b42ed`, "Caught in review, not by me") on top of the feature commit
> (`8806272`), and it now has a test asserting both the message and the named
> namespace (`test/unit/rule-fusion.test.ts`, _"a MIXED fusion is rejected at
> fuse time, not discovered mid-parse"_). And the failure mode it prevents is
> **an assertion that passes while the data is wrong** — §9.1's shape exactly. A
> unit that composes across modes should assume more of this class exists and has
> not been found yet.

**Two things no version gives you**, unchanged through 0.36.0 — so these are not
reasons to want a bump:

- **Nothing replaces manual `optional(ws)` / `noTrivia`.** `trivia`, `noTrivia`
  and `parser({trivia})` are unchanged 0.32.0 → 0.36.0. `noTrivia` at 300 sites
  is the ambient mechanism, not an anti-pattern; the don't in §10.1 is about
  _hand-written whitespace beside it_.
- **No ident/boundary preset.** `keywords()` builds `(?![<boundary>])` from a
  plain character-class string, default `'_0-9A-Za-z'`. No `cssIdent`, no
  `followedBy`, no leading boundary. `word(str, boundary)` is the only lever and
  cannot express backslash escapes or non-ASCII ident code points. Filed as
  **P-3, P-4, P-8**; open at 0.36.0. So "no bespoke ident/boundary classes"
  (§10.1) is an _aspiration_: raise it upstream, do not fake it locally.

**`analyzeDuplication()`** **shipped in 0.37.0** — eight finding families,
including `keywordRegexes` ordering hazards as a bug class, wired on all three
lowering paths, default `'off'`. It would speak directly to §2.3's conversion
classes. It is above the pin, so it arrives with the §5.0 floor or not at all —
another entry on the "what the floor buys" side of that decision, and not a gate
today.

### 5.3 `hostMode` — RESOLVED, and it is the basis of the collapse

> **This section previously tracked an unconfirmable "P1 host-aware capture
> elision". It shipped, as something better than what was described.** Delivery
> taken. The blocker is now a version floor, not a missing mechanism.

**`compile(g, { hostMode })`** — parseman **0.37.0**, merged at **`c4804a3`**
(PR #80, `feat(compile): host mode is a compile-time decision, not a per-node
runtime read`). Read it from `/Users/matthew/git/worktrees/pm-hostmode`
(`feat/compile-time-host-mode`); note the parseman repo's local `main` is stale at
`be09b83`. **Re-check: `main` is now at 0.37.0 and carries `hostMode`.**

**It is a compile-time flag deciding what is _emitted_, modelled on
`compile({ recovery: true })`** — the ctx flag is documented as "exactly the shape
of the `recovery` gate" (`src/compiler/codegen.ts:224-245`, declared `:246`).
`type HostMode = 'ast' | 'cst'` (`codegen.ts:3552`), default `'ast'`, on three
entry points: `compile(g, { hostMode })`, `linkable(map, ns, trivia, hostMode)`
(`linker.ts:47`), `compose(items, { hostMode })` (`linker.ts:693`).

The codegen branch, `codegen.ts:2815` and `:3032-3036`:

```js
const cstOut = ctx.hostMode === "cst" && !structural;
const ndExpr = structural
  ? `_ctx.build !== undefined ? (${hostBuildExpr}) : (${buildExpr})`
  : cstOut
  ? hostBuildExpr
  : buildExpr;
```

In `'cst'`, direct builders build through the host unconditionally — no gate —
and capture follows (`codegen.ts:2823-2828`). Structural nodes deliberately keep
the runtime `ctx.build` check.

**This is why the collapse is now possible.** The unified design previously rested
on a per-node runtime read, and that cost was the reason nobody trusted it. One
grammar can now serve both modes with the mode decided at build time.

> **Two corrections to how this was relayed, both of which matter.**
>
> **`_dcst` is not elided in `'ast'` — it is the opposite.** > `codegen.ts:2879-2880` emits `_dcst` when `!cstMode`, and suppresses it in
> `'cst'`. What actually changed is that it is **no longer a host probe**: it is
> bound to `profileCapture`, a hoisted boolean local off `_ctx._pmProfile`,
> instead of a property chain on `_ctx.build`. The CHANGELOG and commit message
> say "the host branch and the probe are not emitted at all", which overstates
> it; the code comment at `codegen.ts:2872-2877` is the accurate version — "the
> per-node `_parsemanCstOutput` read that used to sit on every direct node is
> gone." The `_parsemanCstOutput` ternary **is** genuinely gone in `'ast'`.
>
> **The perf reading is not −3.4% over 26 rounds.** The cross-process reading
> recorded for this change is **+2.0% median, +1.0% min, winning 5 of 14**
> (`CHANGELOG.md` ~:66, `docs/design/perf-harness-interleaving.md:224`) —
> marginally _slower_, judged neutral. The `3.4%` figure in that repo is a
> worst-single-pass `min` from an unrelated `--self` noise calibration
> (`docs/design/perf-gates.md:342`). The gate additionally read `css/stylesheet`
> at **+15…+29%, breaching 3/3** on an idle machine, and parseman's own note is
> candid: "No threshold was widened and the gate's number is recorded as it
> stands." **So "no measurable cost" is not what the repo says.** The
> _mechanism_ argument still holds and is verified — 10,734 fewer bytes across
> the CSS and Less workload grammars, one fewer property chain per direct node,
> no dead branch — but a mechanism argument is not a measurement, and §9.8
> applies to it.

**A gap worth knowing before Unit 4 writes against it:** `HostMode` is **not
re-exported from `src/index.ts`** at `c4804a3` (nor from `src/run.ts` or
`src/plugin`). The headline option's type is not on the public surface. Raise it
upstream rather than re-declaring the union locally.

### 5.4 SCSS composing on Less — resolved for the fold

SCSS no longer composes on Less. The current SCSS package has one host-mode
grammar source in `packages/syntax/scss/scss-parser/src/grammar.ts`; the old
`src/ast/grammar.ts` file is deleted, public CST uses `scssCstGrammar`, and the
full SCSS parser suite passes. The remaining work in SCSS is quality cleanup on
that surviving grammar, not a rebase away from Less.

The old architecture inversion looked like this:

```ts
export const scssGrammar = compose([lessGrammar, cssSyntax, rules({ trivia: rw }, (g: any) => {
```

That shape must not come back. SCSS is a CSS/preprocessor-base sibling, not a
child of Less. Keep only real Less syntax and public CST/language-service
contracts in the Less grammar; if a rule accepts Sass syntax or exists only so
SCSS can override a Less list, it belongs in SCSS or in an explicitly reviewed
shared preprocessor base.

SCSS-to-Jess conversion has one additional interpolation invariant: if SCSS
contains a complex expression in a position that Jess treats as interpolation
rather than value expression, the converter must hoist that expression into a
generated or referenced variable and splice the variable. Jess interpolation
positions are name/selector/prelude/string splice points, not places to embed an
arbitrary `$(...)` expression tree.

Tracked historically in `docs/architecture/core/SCSS-PARSER-REBASE-DESIGN.md`.

### 5.5 `packages/parser-shared`

The shared parser terminal package is **`packages/parser-shared`**
(`@jesscss/parser-shared`). Verify its history with
`git log --follow --oneline -- packages/parser-shared/package.json`.

Nothing here blocks anything. Two facts survive the rename and are load-bearing
for the rebuild:

- **It has no package-root export.** `package.json` has no `"."` entry; the
  three subpaths are `./recognition`, `./opaque-at-rule`, `./pseudo-consts`.
  Consumers import by subpath.
- **The admission test for this package is unchanged**: a production belongs here
  if it is consumed by **two or more** parsers **and** is parser-specific. After
  the rebuild the CSS base is the home for CSS _productions_ and this package's
  role is _terminals_ (§13.3).

The historical `*Ast*` export names remain the standing example of the naming
defect item 14 exists to stop; the current package should be reviewed against
the same rule whenever a name describes a compile mode or owner instead of an
accepted language surface. See §0.5(b).

A separate, still-unexecuted proposal is a _move_, not a rename:
`docs/design/packages-layout-grouping.md:67-70` relocates syntax packages under
`packages/syntax/` while keeping the name.

---

## 6. The dispatchable units

Every unit inherits §7 (traps), §8 (measurement), §9 (anti-criteria) and §10
(constraints). Those are not restated per unit. Everything else a unit needs is
in the unit.

**When blocked: report, do not decide.** Report and stop if the blocker is a
parseman capability gap, a semantic question about what the language accepts, an
`incomparable` oracle verdict, or a conflict between two constraints in §10.
Decide and record if it is a local shape question with no observable consequence.
When in doubt it is a report.

---

### Unit 1 — Survey and cheat sheet

**Scope.** Read-only survey of parseman. Produces exactly one file:
`docs/architecture/parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md`.

**Off-limits.** Every file under `packages/`. This unit writes no code. It also
does not modify parseman — jess agents never merge parseman PRs.

**Read first.** Resolve the installed `parseman` package from this checkout, then
read the matching source in `/Users/matthew/git/oss/parser-thing`. Cross-check the
package version in root and parser package manifests before writing grammar code.
Then read §5.2 above and `GRAMMAR-REVIEW-STANDARD.md`.

**Method.** The cheat sheet documents the pinned parseman version used by Jess.
Read `src/index.ts` for the full export list, then the implementation of anything
the grammars will use. The sheet must explain when to use `choice(...)`,
`keywords(...)` / `word(...)`, separator helpers, and
`dispatch(...)` / `routed()`, with CSS/Less examples grounded in current grammar
shapes. Version-stamp the result.

Current sheet: `docs/architecture/parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md`,
stamped for `parseman@0.41.0`. Keep it authoritative and current whenever the
Parseman floor moves.

**Pass criteria.**

- Every current value export of `src/index.ts` appears with a one-line "use it
  when" and at least one worked example.
- Each anti-pattern in §2.3 has a named current replacement, or an explicit
  "no replacement exists" with the missing primitive named as a parseman follow-up.
- The dispatch-vs-choice boundary is stated plainly: dispatch for shared broad
  opener plus known/generic continuation; choice for literal/disjoint/list/body
  and later-delimiter alternatives.
- The sheet is stamped with the parseman version and the SHA it was read from.
- Anything not confirmable from source is marked UNVERIFIED — not omitted, not
  guessed.

**Blocked?** Nothing blocks this unit. It reads a version already installed.

---

### Unit 2 — parseman 0.36.0 adoption — **CLOSED, not adopted**

**Outcome.** Measured and declined. Correctness fully clean (zero AST movement
across 3,053 file-parses in all four dialects; four parser suites green;
`all-less` 108/108; `check:macro` 0 fallbacks at both versions), but
`less/css-corpus` regressed **+7.8 / +11.9 / +10.8 / +10.7%** across four runs and
three harness designs, win-rate 2–4 of 25. Two other Less workloads were
ambiguous and **no direction was claimed on them** — the right call, recorded as
such. This was a measured non-adoption of 0.36.0, not a standing pin decision.
The active floor is 0.41.0 (§0.2).

**This unit is no longer a blocker on anything.** Units 3, 4 and 5 target the
current pinned parseman floor.

**What remains, deferred and unassigned:** the residual Less regression. It is
concentrated in **Less parsing plain CSS**, which points at the ported CSS value
and selector productions inside the Less grammar — the duplication Unit 5 exists
to delete. **Hypothesis, not result** (§5.1). The useful next measurement is
after Unit 5's `less` step, not before it.

Still worth harvesting from the attempt: 0.34.0's gating fix surfaced **202
ungated choices and 28 anti-patterns** invisible at 0.32.0, where the macro
build's gating is blind. Those findings describe _our_ grammars, not parseman's
version — feed the pre-`compose()` `rules()` map to 0.32.0's `analyzeGating`
(§8.6) and record the current set, as a set, during Unit 4. It does not need a
bump.

---

### Unit 3 — Coverage measurement (the greenfield gate)

**Scope.** Determine which grammar productions no test reaches. Produces a
measurement and a go/no-go recommendation.

**Off-limits.** Any grammar edit. The point is to measure the tree as it is.

**Read first.** `vitest.config.ts:142-146` and the current Less byte-identity
oracle command, `pnpm run oracle:less:byte-identity`.

**Current state — this has to be built.** `@vitest/coverage-v8` is a root
devDependency with a `test:coverage` script, but coverage is **disabled by
default** to save memory, with no `include`, thresholds, or reporter. No script
maps productions to tests. And V8 line coverage is close to useless here
regardless: the macro import (`with { type: 'macro' }`) compiles the grammar to
flat JS at build time, so line coverage of the emitted artifact does not map back
to a `const`-per-production source.

**Method.** Build an instrumented `rules()`/`node()` wrapper — or a parseman hook
— recording entered rule keys per parse, then diff that set against the declared
key set per grammar. The denominators come free from §2: 157 / 243 / 167 / 168.
**parseman 0.32.0 already exports a coverage surface** —
`GRAMMAR_COVERAGE_DEFINITIONS`, `createGrammarCoverageCollector`,
`runWithGrammarCoverage`, `compiledGrammarCoverageDefinitions`,
`composedGrammarCoverageDefinitions`. **Check whether it already does this before
building anything.**

**Pass criteria.**

- A per-grammar list of rule keys **no test reaches**, as a named set.
- An explicit go/no-go on greenfield **per dialect**, reasoned from that set. A
  dialect with a large unreached set is one where a rewrite drops behaviour
  silently — that is the finding, and it may legitimately say "not safe yet".
- The measurement is reproducible by a checked-in command.

**Blocked?** If parseman's coverage surface turns out to be sufficient, say so and
stop — do not build a second one.

---

### Unit 4 — CSS polish

**Scope.** CSS ships from one host-mode grammar:
`packages/syntax/css/css-parser/src/grammar.ts`. CSS work is now polish, not a
second fold: spec-shaped rule names, JSDoc, separator helpers, word/keyword
helpers, and `dispatch(...)` for known-or-generic shared opener families while
preserving AST/CST ownership.

**Off-limits.** Do not recreate `src/ast/grammar.ts`. Do not reintroduce
mode-shaped names. Because Less, SCSS, and Jess compose on the CSS base, a CSS
shape move is reviewed as a base-language move, not a local convenience.

**Read first, in this order.**

1. The cheat sheet from Unit 1.
2. `GRAMMAR-REVIEW-STANDARD.md` — the per-`const` checklist.
3. The CSS specs, for each rule you are about to write.
4. For JSDoc style: less.js's
   `/Users/matthew/git/worktrees/less.js/master/packages/less/lib/less/parser/parser.js`
   (**read-only**; never `/Users/matthew/git/oss/less.js`), and the Chevrotain
   parser at `a13e606b6^:packages/css-parser/src/cssActionsParser.ts` — the
   `@note` block at its line 61 is the model.
   `a13e606b6^:packages/css-parser/src/productions.ts` has the rule bodies.
5. The old CSS grammars — **last, and only for the accept set.**

**Method.** Per rule: state in prose what it recognises, from the spec. Then write
combinators for that description. Then check against the old rule for accept-set
differences only, and enumerate every difference (§8.3).

**Pass criteria.** §8 in full. Additionally:

- **The rename mapping and the residue check are built as part of this unit**
  (§8.1b) — the oracle has no such API, and every later unit depends on it. The
  check must prove the residue is **empty**, not smaller; a tool that only shrinks
  the diff fails this criterion.
- The CSS grammar's header states that three dialects compose on it (§12).
- Rule names are CSS concept names — no `CssAst*`, no `Direct*` (§10.1).
- The per-`const` review table has a row per `const` (§10.4).
- **Both emissions are gated, not just the one you were thinking about.** The
  `'ast'` build carries the eval path; the `'cst'` build carries the language
  service. §8.1's surface list must include both, and §8.4's language-service
  suite is a first-class gate here rather than a background check.
- **No cross-mode fusion.** §5.2c is rejected at fuse time upstream, but the
  rejection is one guard found by review; do not treat its absence of complaint
  as proof. State which mode each composed piece was compiled in.

**Blocked?** A rule whose spec behaviour and old-grammar accept set genuinely
disagree is a semantic question. Report it; do not pick. The old §5.0 parseman
version blocker is paid; host-mode fold work is no longer blocked on a release.

---

### Unit 5 — The dialects

**Scope.** One dialect at a time, each linked back to the finished CSS base.
Order: **`less`, then `scss`, then `jess`**. Less remains the alpha bar because
it has the oracle corpus and fixture gate. SCSS must not regain Less-only
grammar routes just to pass; shared pieces move to parser-shared only when they
are genuinely shared language.

**Off-limits.** The CSS base, once Unit 4 lands. If a dialect needs a CSS change,
that is a change to Unit 4's output and is reviewed as such — **not** a local
re-implementation. Re-implementing CSS in a dialect is a stated failure (§10.1).

**Read first.** Unit 4's landed CSS grammar — that is the shape reference. Then
the cheat sheet, then the review standard, then the dialect's own spec, then the
old grammars last, for the accept set only.

**Pass criteria.** §8 in full, plus:

- `all-less` 108/108 for the `less` unit (§8.4).
- Less cleanup prioritizes parse-once selector `:extend(...)`, canonical
  identifier-or-function dispatch, diagnostic-only isolation of any legacy
  function retry, and whole at-rule/mixin opener designs that route only after
  enough syntax has been consumed.
- Dispatch is required pressure for shared broad opener plus known/generic
  continuation. It is not a replacement for body lists, selector/comma lists,
  literal/operator tables, custom-vs-standard declaration semantics, or Less
  bare-`@` statement choices.
- Shared node names: **a `Declaration` is a `Declaration` in every dialect.**
  Dialect-specific names only for genuinely dialect-specific constructs. The
  measurable form: the cross-dialect intersection of rule names is large, and the
  dialect-specific remainder is justified **name by name**. Today the
  intersection is 0 (§2.1).
- Each dialect grammar's header links to the CSS base (§12).

**Blocked?** SCSS cannot start until §5.4 is resolved. Report if it is not.

---

## 7. Traps

Each of these has cost real hours.

- **Build in order, `parser-shared` FIRST.** All four parsers depend on
  it; wrong order links them against a stale recognition lib, which masks ~17 real
  failures. Then parsers → `awaitable-pipe` → `core` → `fns` → `config` →
  `style-resolver` → plugins → `jess`. `pnpm run build:release` does the lot.
- **Tests run from `lib/`, not `src/`.** A stale build silently measures an
  _older commit_ and reports it as today's number. Rebuild between every edit you
  intend to measure.
- **`pnpm --filter "*/jess-plugin-*"` silently matches nothing** and inflates the
  jess failure count from 13 to 23. A filter that matches nothing exits 0. Check
  what a filter actually selected before trusting a count taken through it.
- **Capture your own baselines as SETS, never inherit a count.**
  `docs/state/PROJECT_STATE.md:73-77`: a count cannot tell "nothing changed" apart
  from "you fixed one and broke another".
- **A macro-fallback build is not AST-equivalent**, so a red `check:macro`
  **invalidates any differential taken on it** (§8.2).
- **`all-less` 108/108 is meaningless without the less.js checkout SHA.** The
  fixtures live in an unpinned checkout; less.js `dded69cc` moved the count
  108→106 with no jess-side change.
- **A fresh worktree has no `node_modules`.** `pnpm install` plus the ordered
  build before any number is real.

---

## 8. How each unit is measured

### 8.1 The equivalence gate — `parseman/oracle`

> **MERGED** (PR #75, 2026-07-25) — this section previously read "UNMERGED AND
> UNRELEASED". Re-check with `gh pr view 75 --repo matthew-dean/parseman`. It is
> in parseman `main` at 0.37.0. Jess now reaches the relevant gate through
> `pnpm run oracle:less:byte-identity`. Described below as at branch
> `feat/ast-identity-oracle`, ref
> **`10ab446`**, sitting on top of the 0.36.0 bump and **not part of 0.36.0**
> (`package.json` at that ref still reads `0.36.0`). Write the spec against it;
> do not describe it as available until it merges. Until then,
> the current `pnpm run oracle:less:byte-identity` gate is what exists.

A Node-only subpath — `package.json:46-50` at `10ab446` exports `./oracle`.
Node-only by _imports_, not by an export condition: `node:crypto`
(`src/oracle/digest.ts:53`) and `node:fs` (`src/oracle/corpus.ts:20`). A separate
entry point so nothing reaches the browser bundle.

```
loadCorpus({ base, roots, extensions, maxBytes?, ignoreDirs?, allowMissingRoots? })
  -> { entries, missingRoots, skippedLarge }
digestCorpus(surfaces, corpus, { projectError?, determinismSample? })
  -> IdentityReport { format, harness, entries, surfaces[], perEntry }
compareReports(before, after) -> IdentityComparison
formatComparison(comparison, { maxMoved? }) -> string
```

**Surfaces are passed in pairs — the grammar under edit plus an untouched
control.** A `Surface` is `{ name, parse(source, id) }` (`src/oracle/identity.ts:67`)
and they arrive as a `readonly Surface[]`, so a control is declared simply by
adding another entry. There is no control flag; the untouched surface's aggregate
is the noise floor. Duplicate surface names and duplicate corpus ids both throw.
The surface _name_ is hashed into its own aggregate (`:192-196`), so renaming a
surface deliberately moves it.

Three of its properties are **criteria**, not incidental facts.

**(a) There are three verdicts, not two.** `'identical' | 'moved' | 'incomparable'`
(`identity.ts:250`). `incomparable` is returned when the two reports disagree on
the harness's own behavioural fingerprint — the `harness` field (`:94`), set from
`HARNESS_DIGEST` (`:432`), computed by running a hand-built frozen canary corpus
covering every payload-shaping decision of `canonicalize`: `-0`/`NaN`/`±Infinity`/
BigInt, `undefined` vs absent keys, key order, `Map`/`Set`/`Date`/`RegExp`, tagged
class vs plain object, sharing, cycles, NUL, functions and symbols, and the
`OK:`/`ERR:` discriminator. It is built by hand rather than by parsing precisely
so unrelated combinator changes cannot re-baseline it. A `format` mismatch
(`DIGEST_FORMAT`, currently `1`) is the second trigger.

> **`incomparable` is never to be read as "close enough", and never to be worked
> around by re-running.** The tool is refusing to answer. Find out why the harness
> differs.

**(b) `moved` is distinct from `identical`, and this rebuild will move things.**
Because §3 renames nodes deliberately, the criterion is **not** "the oracle is
happy". It is:

> **The rename mapping is declared up front, and the residue after applying it is
> empty. An undeclared `moved` is a failure.**

The mapping must be **total and unambiguous** — every old name maps to exactly one
new name, and nothing maps to two.

**What the residue check has to prove:**

> After applying the declared mapping to the old tree, **the set of remaining
> differences is EMPTY.** Not smaller. Not "only renames left". Not a diff a human
> reads and judges acceptable. Empty, or the change has not been shown
> output-neutral.

This is stated because the obvious tool to build is the wrong one. A mapping tool
that merely _shrinks_ the diff will always succeed — add enough mappings and any
two trees look close — and it converts a mechanical gate into a judgement call,
which is exactly what §8.1(a) refuses. The mapping is declared **up front**, before
the diff is seen, for the same reason: a mapping written to explain a diff you are
looking at is a rationalisation, not a specification. If applying the declared
mapping leaves anything behind, the residue **is the finding** — enumerate it,
report it, and do not extend the mapping to absorb it without saying so.

**The oracle does not support any of this natively**: there is no rename-mapping or
residue API in `src/oracle` at `10ab446`. It gives a binary per-entry fingerprint
diff — `SurfaceComparison` (`identity.ts:233`) carries `moved: string[]`, the entry
ids whose fingerprint changed, plus `addedEntries`/`removedEntries`. **jess must
build the mapping and the residue check itself.** That is unbuilt work and belongs
to Unit 4.

A gained or lost corpus entry is **not** `incomparable` — it is reported in
`addedEntries`/`removedEntries` and yields `moved`.

**(c) A nondeterministic parse is diagnosed by name, not hashed into a digest that
drifts every run.** `verifyDeterminism` (`identity.ts:210-231`, called from
`digestCorpus` at `:186`) re-parses a stride-sampled subset — `determinismSample`,
default **32**, `0` disables — and compares raw payload _text_, not the hash. On
mismatch it **throws**, naming the surface and the entry id, with the usual causes
(timestamp/counter, a `Map` keyed by object identity, a node holding mutable shared
state). Do not lower `determinismSample` to get a green run — see §9.7.

### 8.2 Definition of done

All four, each stated with evidence. **Explicitly not "tests pass."**

1. **diagnostic clean** — `pnpm run verify:types`, zero diagnostics in the files
   touched. Where parseman's gating analysis was run, it was fed the
   pre-`compose()` `rules()` map (§8.6).
2. **lint clean** — `pnpm run lint`, **0 errors**.
3. **oracle equivalent** — modulo the declared rename mapping, with empty residue
   (§8.1b). Aggregates quoted before and after.
4. **`check:macro` — 0 fallbacks.**

> **Item 4 is a CORRECTNESS gate, not a performance gate.** A build that degrades
> to the interpreter **emits a different tree**. Reproduced end to end in
> `PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md` §1: one hoisted module-level `const`
> made `compose()` non-statically-resolvable, parseman fell back to the
> interpreter, and the CST aggregate moved; inlining the literal at each call site
> restored it byte-for-byte. A red run **invalidates any differential taken on
> that build**, and a green test suite does not clear a fallback — the suite can
> pass on the interpreted tree while the shipped compiled tree differs. If this
> ever reads as a speed criterion, someone will trade it away.

`scripts/check-macro-buildable.mjs`, wired as `pnpm run check:macro`, run in CI as
`--no-build` (`scripts/verify-pr.mjs:94`,
`.github/workflows/pr-quality-gate.yml:78`), blocking in both. It counts
`_rp[N].parse(` under `lib/` for the five packages in compose order.

### 8.3 Corpus differential

> **Every input the old grammar accepted is accepted. Every rejection is
> preserved. Differences are enumerated and reported — never silently adopted.**

The corpus is the spec. A newly-accepted input is not a bug fix until the owner
says it is; a newly-rejected input is a regression until proven otherwise. Both go
in the report as a named set, with the input that produced them.

Error behaviour is inside the differential, not beside it: the oracle hashes
throws with an `ERR:` discriminator, so a change that turns a hard error into a
silent accept moves the aggregate.

### 8.4 Suites

- **Four parser suites** — `pnpm --filter @jesscss/{css,less,scss,jess}-parser test`.
  `scss` and `jess` run `--passWithNoTests`. **No current per-suite pass counts are
  recorded anywhere in `docs/`; do not quote one.** Capture your own set.
- **`all-less` 108/108** — `pnpm run test:less:test-data`, measured 2026-07-24 on
  `e34bb24b3` (`docs/state/PROJECT_STATE.md:110`), 21 of them active
  expected-failure checks. See the trap in §7.
- **jess failing set, diffed as a SET** — `pnpm run verify:jess-suite-ratchet` →
  `scripts/vitest-ratchet.mjs` against the 15-entry
  `packages/jess/test/known-failures.json`. It fails on three conditions: a failure
  not in the baseline, a baseline entry that now passes, and a baseline entry that
  no longer exists. **A count cannot detect the second or third.**
- **Language-service suite green** — `cd packages/language-service && pnpm test`
  (13 test files). **Green as of `82d0b5f13`: 189 passed / 1 skipped / 0 failed**,
  stated in that commit message. The earlier "5 pre-existing failures" figure was
  wrong twice over — it was 10 failures across 4 files, each double-counted by the
  runner's project/file reporting — and it is now moot.

> **Open gap: this suite has no ratchet baseline, and it just went green.** The
> only `known-failures.json` in the repo is `packages/jess/test/known-failures.json`,
> wired by the single ratchet at `package.json:133`. Nothing pins the LS suite at
> 189/1/0, and `packages/language-service/package.json` has no ratchet script. **A
> suite that just went green with nothing holding it there will drift** — and the
> grammar rebuild is precisely the kind of change that drifts it, since the CST is
> what the language service consumes.
>
> **Proposed, not built:** add `packages/language-service/test/known-failures.json`
> as an empty named set and wire `verify:ls-ratchet` to the existing
> `scripts/vitest-ratchet.mjs --package packages/language-service --baseline …`.
> An empty baseline is the strongest form — every one of the script's three
> failure conditions (new failure, baseline entry now passing, baseline entry
> gone) reduces to "any failure fails". Cheap, uses machinery that already exists,
> and it is what makes "language-service suite green" a gate rather than a hope.
> **Owner decision required** before a unit takes it on; it is not grammar work.

### 8.5 Perf — the single-process interleaved arena is required

Only where a change was motivated by cost. **A single median is not a result.**
The untouched surface is the noise floor. **A neutral result is a perfectly good
result** — the gate for this work is §8.1 through §8.4, not a speedup.

**The required harness is the single-process interleaved arena.** It was built
for the 0.36.0 evaluation and was the only design that stayed stable when the box
hit load average 21–29; the cross-process designs disagreed with it by 10–14
points on the same workloads, which is how two of the three Less workloads ended
up unclaimable. Do not substitute a simpler design and do not report a number
from one.

Its shape:

- Both versions' **compiled artifacts and their own parseman copies** are
  snapshotted into **self-contained arms**. Not two checkouts, not a shared
  `node_modules` — each arm carries everything it needs.
- The two arms are **alternated per iteration**, with **per-round rotation** so
  neither arm keeps a fixed position in the ordering.
- One process. Warmup then timed samples. Report **median AND min AND spread AND
  win-rate** — win-rate is what exposed `less/css-corpus` as 2–4 wins out of 25
  while its medians looked merely noisy.

**The self-validation step is part of the harness, not an optional extra:**

> **Prove the two arms are actually two builds.** Confirm the arms **disagree on
> no AST across the corpus** (2,647 files in the 0.36.0 evaluation) **while
> producing different builds**. A shared-module leak — one arm silently importing
> the other's parseman or the other's compiled artifact — produces a harness that
> times the same code twice and reports a clean, confident, meaningless number.
>
> **A harness that cannot prove its two arms are two builds produces a timing
> that is a lie.** Run the check every time; a leak is introduced by an innocuous
> refactor of the harness, not announced.

`packages/less-parser/test/ab-compare.mjs` remains the reference for the
surrounding discipline — same worktree, full macro rebuild between blocks,
interleaving, and the untouched surface as a same-run control — but its
cross-process design is **superseded** for version and grammar comparisons by the
arena above. The arena is not yet checked in; building or importing it is part of
the first unit that needs a perf claim.

For a **parseman-side** number, the supported method is **`pnpm perf:xproc`**
(`bench/xproc-ab.ts`, `package.json:71`): it materialises the reference side the
way the gate does — a `git worktree` at the pinned sha under `.cache/`, the
repo's `node_modules` symlinked in, the working tree's `grammar.ts` copied over —
and runs one fresh process per side per round, alternating which side launches
first.

> **But `perf:xproc` is a confirmation step, not a gate, and parseman's own docs
> refuse to let it become one:** "A cross-process comparison carries the
> between-launch term the interleaved harness exists to eliminate — this hardware
> has produced 9.4 ms and 26 ms for the same case in consecutive launches"
> (`docs/design/perf-harness-interleaving.md:146-152`). Use it to confirm a red,
> not to certify a green.

### 8.5.1 parseman's own perf gates cannot be cited as authoritative

Three verified defects. They matter here because §5.0's decision, and several
figures this document quotes, rest on numbers these gates produced.

**(a) `perf:guard:grammars` fails on byte-identical sides.** Four runs of
`--ref=d4f107f --head-ref=d4f107f` — the same commit against itself — produced
`expected/narrow` at **+25.0% median, +21.2% min, 0 of 12 pairs won, FAIL**, with
the other three runs clean (`docs/design/perf-harness-interleaving.md:50-62`).
parseman's own conclusion: _"a comparison where the two sides are byte-identical.
There is no regression there to find."_ It masks in the other direction too —
`rollback/none` read **−19.6% at 12/12** for identical code.

**(b) `workload-perf` failed a PR containing no file under `src/`**, with
compiled parsers byte-identical to base, on an idle runner (load 0.80): `3/3`
breached, win rates **2/12, 0/12, 0/12** (`:164-194`).

> **The consequence is the one to internalise: the win-rate rule did not separate
> noise from signal.** Both failures show _"the exact signature the gate documents
> as 'a real regression loses every pair'."_ This spec leans on win-rate as the
> discriminator — §8.5, and the 2–4-of-25 reading that decided §5.1. **Win-rate
> remains worth reporting and is still better than a bare median, but it is no
> longer sufficient on its own.** A red needs an independent confirmation
> (§8.5's arena self-validation, or `perf:xproc`) before it is believed.

**(c) `grammar-perf-guard.ts` can silently benchmark the wrong commit.**
`bench/grammar-perf-guard.ts:123-138` reuses a cached reference worktree if
`.cache/grammar-gate-<sha>/src/index.ts` merely _exists_. The sha lives in the
directory **name** only; nothing checks the directory's actual `HEAD`.
`bench/ab-harness.ts` had the identical check. Stale `.cache/` worktrees do
persist across runs.

> **This retroactively weakens every number that gate has produced**, and the fix
> commit says why it cannot be bounded: _"the output recorded the sha it INTENDED
> rather than the one it USED, so there is no way to tell which past readings
> were affected."_ **A defect that erases its own blast radius cannot be
> narrowed by inspection — treat the whole population as suspect.**
>
> The fix (`00a4c42` — compare `rev-parse sha` against `rev-parse HEAD` in the
> cached dir, treating "cannot confirm" as stale) exists on branch
> `docs/gate-stale-worktree` and **has since merged as PR #82**. Readings taken
> _before_ it are still suspect; the population cannot be narrowed by inspection.

**Figures in this document that are affected.** Marked rather than deleted, per
the rule that a suspect measurement is evidence about the harness:

| figure                                                                                                       | source                                                     | status                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0.34.0 `+32.5%`, 0.35.0 `−12.0%` / `−18.5%` / `12/12`, 0.37.0 `+2.0% median 5/14`, `css/stylesheet +15…+29%` | parseman's own gates                                       | **SUSPECT** — quoted with attribution, not relied on                                                                                                                                       |
| 0.36.0 jess-side `+7.8/+11.9/+10.8/+10.7%`, win-rate 2–4 of 25                                               | jess's arena + two other designs, **not** parseman's gates | Stands as the §5.1 basis. But its win-rate reasoning inherits (b)'s caveat, and the finding was corroborated by agreement across **three** harness designs — which is what makes it usable |
| 0.34.0 jess-side `+10…25%` (`a49ca59da`)                                                                     | jess's `ab-compare.mjs`, same-worktree git-toggle          | Not from parseman's gates. Cross-process design, now superseded                                                                                                                            |
| `10,734 fewer bytes` (§5.3)                                                                                  | byte count, not a timing                                   | Unaffected                                                                                                                                                                                 |

### 8.6 What the gating diagnostic can and cannot see

`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md` §2 claims parseman's analysis cannot walk
`compose()`d grammars — `analyzeGating()` throws for 129 of 129 rules of the
composed Less CST — and §2.2 projects that any future duplication diagnostic
inherits the defect and **silently reports nothing on exactly the four grammars
that are supposed to be parseman's reference implementation**.

**The blanket form is superseded** (`GRAMMAR-REVIEW-STANDARD.md` §3): the analysis
_can_ analyse these grammars when fed their `rules()` map captured **before**
`compose()`. It is the fused compiled artifact that throws, and it now throws
actionably. 0.34.0 goes further — `compileRuleMap` runs gating over the whole map,
and `analyzeGatingRules` is exported for exactly this.

The operative rule survives intact, and it is why an oracle exists at all:

> **Never read a clean or empty diagnostic obtained from the fused artifact as
> evidence that a grammar is clean. Feed it the pre-`compose()` map, and say which
> you fed it.**

**And at 0.32.0 — the version we pin — there is a second reason not to trust a
clean result.** parseman **0.38.0** fixed a defect where `reportGating`'s
`try/catch { return undefined }` made a **crashed analysis indistinguishable from
a clean one**. `GatingReport` gained an `unanalysable[]` field, and
`analyzeGrammarGating()` was added to accept a `compose()` result via carried IR.
Neither is available at 0.32.0.

> So on the pinned version, a silent `analyzeGating` is **three-ways ambiguous**:
> the grammar is clean, the analysis saw nothing, or the analysis crashed and
> swallowed it. That is anti-criterion §9.1 in its purest form, and it is
> upstream's own finding rather than a hypothetical. **Report gating results as
> "analysed N of M rules", never as "no warnings."** If you cannot say N, you do
> not have a result.

The oracle that exists on `dev` today —
`packages/syntax/less/less-parser/test/ast-identity-oracle.mjs`, 707 files, both
surfaces, baselines `aggAst 0aa9de8c9780273a…` / `aggCst d9fd8da52bf4bebb0…`, 119
expected throws (pre-bump, parseman 0.32.0). It is the SHORT-hash oracle: it
always exits 0; "failure" is you diffing before against after.

**Stage 2.1 has landed the §8.1 replacement on `dev`** (commit `a2911a491`,
2026-07-25, on the bumped tree at parseman 0.37.0):
`packages/syntax/less/less-parser/test/oracle-byte-identity.mjs` is the
machine-checked gate using the real `parseman/oracle`
(`loadCorpus`/`digestCorpus`/`compareReports`/`formatComparison`). Surfaces still
`ast` (parse) + `cst` (parseLessCst). Three-way verdict: `identical` → exit 0,
`moved` → exit 1, `incomparable` → exit 2. Committed baseline
`packages/syntax/less/less-parser/test/oracle-byte-identity.baseline.json`:
`aggAst=d436f6e07d267ffad4bfdd06dfa363ad170b64985e1a5c6aef0fcd21d84b290a` threw
119, `aggCst=48e1e9dc0b80b8acae3f9adcb723243cf66a94da288634f81863f708093c3b27`
threw 0, both across the 707-file Less corpus. The harmonic floor is this
baseline; every Stage 3–6 grammar diff must keep both aggregates byte-identical
to it (or, for a deliberate rename, declare the mapping up front and apply it —
see §8.1b. The residue after applying the mapping must be EMPTY).

Reproducible: `pnpm run oracle:less:byte-identity` (this rebuilds less-parser
then runs the gate against the committed baseline). Stage 3+ branches off `dev`
can re-baseline by piping `pnpm run oracle:less:byte-identity:write` to a new
JSON file and committing it in the same commit that moved the aggregate.

The short-hash oracle (`ast-identity-oracle.mjs`) is kept during the transition
for cross-checking per-file fingerprints; the new gate subsumes its job.

**Stage 2.2 (coverage gate) — discovery: parseman 0.37.0's coverage surface is
NOT sufficient for the dialect grammars that compose over CSS.** Those dialect
grammars use `compose([cssGrammar, <Dialect delta>])`, and `cssGrammar` is a
macro-compiled opaque artifact. `composedGrammarCoverageDefinitions(grammar,
'<startRule>')` deliberately throws on opaque artifacts ("semantic coverage
needs re-lowerable composed IR; this composition contains an opaque artifact"),
and `compiledGrammarCoverageDefinitions(grammar)` returns an EMPTY definitions
array for the macro-built `compose()` result even when
`transformMacro(..., grammarCoverage: true)` is invoked — only the rule-ENTER
hooks are present per rule, while the `GRAMMAR_COVERAGE_DEFINITIONS` symbol map
on the compiled compose-result carries nothing. A grammar-coverage gate for
jess therefore cannot use parseman's coverage surface off the shelf; the gate
either needs a non-macro-build path (which defeats the macro) or a jess-side
per-rule collector keyed to the grammar's public surface keys. This is OPEN
work, deferred to a later Stage 2.2 effort; the byte-identity gate (Stage 2.1)
is sufficient for Stages 3–6 to proceed (every collapse commit's byte-identity
verdict is what they will pivot on; coverage was a "is it safe to collapse
THIS dialect yet?" greenfield gate, not a collapse-pass gate).

### 8.7 The subjective bar — named as subjective, with a named judge

Two criteria here cannot be mechanised, and pretending otherwise is how they get
dropped.

- **Would this rule be the example in the docs?** These grammars are parseman's
  reference implementation.
- **Does it read when projected on a wall?** Per const: does the rule's shape
  _teach what it does_ at lecture-hall size, or does it need narration?

> **Lint is the floor; prettiness is the bar.** They fail differently and must be
> reported separately. A rule can be lint-clean and still ugly — a correctly
> formatted twenty-line `sequence` that should have been three rules passes every
> mechanical check.

**Judge: the owner**, on the `grammar-reviewer`'s evidence. The reviewer states
what it judged and why, per const; it does not return a verdict. If a reviewer is
spending its effort on paren placement, that is a finding about the lint config,
not about the const.

**"Doesn't look like the old one" is judged the same way**, and it has one concrete
test: **a reviewer diffing old against new should not mostly see renames.** If the
diff reads as a rename, the rule was transcribed rather than described, and §4's
per-rule method was skipped.

---

## 9. Anti-criteria — what does not count as success

This is a scar record. **Every entry happened**, most of them in the session that
produced this document.

1. **A check that reports success because it cannot see the failure mode.** The
   root shape, and most of this list is a special case of it. **A passing test
   suite** is the plain form: it is context, and none of the four items in §8.2.
   Three verified instances, each of which looked exactly like a pass:
   - **A clean `--self` on a perf harness.** `--self` sets the head side to the
     reference sha (`bench/workload-perf-guard.ts:95,99`), so it compares a
     commit against itself: both sides compile to the **same-sized** code image,
     while a real A/B has two **differently-sized** images sharing one heap and
     one JIT profile — the situation `--self` removes. parseman's own wording:
     _"A clean `--self` says 'the harness is not noisy today'. It does not say
     'this A/B number is real'."_ Its own labelling is honest — _"noise floor,
     not a gate"_ — and it still gets read as a trust signal.
   - **A perf harness whose two arms are secretly one build** (§8.5), and a gate
     benchmarking a stale cached worktree while reporting the sha it intended
     (§8.5.1c).
   - **A cross-mode fusion whose assertion passes while AST objects sit inside a
     positioned CST** (§5.2c) — found by review, not by any gate.
2. **A green run from a diagnostic that could not see its input.** The gating
   analysis reported clean on the fused artifact while seeing nothing at all
   (§8.6).
3. **"I converted N sites" without saying which and why.** A count is not a
   result. The unit of report is the const, with an outcome and a reason (§10.4).
4. **A fix landed in one of two duplicated files.** The `${…}` and
   `interpAccessorKey` costs in §2.2 are both exactly this.
5. **A count where a set was needed.** `all-less` moved 108→106 with no jess
   change; `pnpm --filter "*/jess-plugin-*"` matched nothing and moved a failure
   count 13→23. Neither is visible in a count.
6. **A claim carried forward from a prior report rather than re-measured.** Four of
   the five figures this document was briefed with were wrong when checked against
   the tree (§2.3); "5 language-service failures" was wrong twice over (§8.4); and
   "the `internal-css-recognition` rename" (§5.5) described a proposal that did
   not exist. **This document is not exempt.** Within one day of being written, its
   line count went stale by 6,858 lines, its keyword-regex count halved, and its
   "no ESLint rule applies to the eight grammar files" became false (§11). Re-run
   the commands in §2; do not quote the tables.
7. **A gate made to pass by shrinking what it measures.** In parseman PR #75 a
   `composeLeaf` soundness sweep ran ~5.5s under coverage against a 5s default and
   the failure message said **"timeout", not "sweep"**. The correct move was taken:
   trace it, verify green on unmodified `main` first to rule out a real regression,
   then **raise the ceiling rather than shrink the sweep** — because the sweep's
   size _is_ the assertion (`test/unit/composeleaf-firstset.test.ts` @ `10ab446`,
   timeout raised to `60_000`, the 300-grammar sweep and its `tested > 1000`
   assertion untouched). A fuzz that shrinks to fit a clock stops finding things. A
   corpus subset chosen because the full one was slow is the same move, and so is
   lowering `determinismSample` to get past §8.1c. **If a gate is too slow, that is
   a budget question to raise, not a scope to quietly reduce.**
8. **An unmeasured claim that a rewrite is faster.** Perf claims require the
   single-process interleaved arena (§8.5) — not a cross-worktree comparison, not
   a prediction from the shape of the code. **"I moved N sites into macros" is a
   count, not a result.**
9. **A perf number from a harness that did not prove its two arms are two
   builds.** The arena's self-validation — arms disagree on no AST across the
   corpus while producing different builds — is part of the harness, not an
   optional extra (§8.5). A shared-module leak yields a clean, confident,
   meaningless number, and nothing about the output looks wrong.
10. **Claiming a direction on an ambiguous measurement.** In the 0.36.0
    evaluation two of three Less workloads read −7…−9% cross-process and +2…+5%
    single-process interleaved. **The measuring agent declined to claim a
    direction, and that was the correct result** — recorded as ambiguous, with
    the decision made on the workload that was not. Reporting "roughly neutral"
    or picking the friendlier harness would both have been failures.

---

## 10. Constraints in force

### 10.1 The don'ts

- No copy/paste from the old grammars.
- No hand-rolled keyword regexes — `keywords()` / `word()`.
- No `not(regex(…))` as a terminator.
- No leading `not()`. **`peek()` does not exist at 0.32.0** — restructure so the
  discriminating terminal leads. Do not reach for `not(not(x))`: it reports
  first-set `any` and poisons the entire choice. Where a rule genuinely needs
  lookahead that 0.32.0 cannot express, that is `blocked`, with `peek()` as the
  named reason.
- No manual `optional(ws)` or hand-written whitespace beside `noTrivia`.
  (`noTrivia` itself is the ambient mechanism and is not the target — §5.2.)
- No production consuming its own `;`. **`;` separates; the list owns it.**
  `GRAMMAR-REVIEW-STANDARD.md` item 10 records this as _pending an owner ruling_
  for the existing grammars, where such sites are `blocked`, not `converted`. In
  new code, do not write them.
- No per-dialect names for CSS concepts, and **no `Direct*` prefix**.
- No re-implementing CSS — compose from the base.
- No factories, no spreads, no hoisted consts (§10.3).
- No literal non-ASCII in regexes.
- No `/i` without `/u`.
- No bespoke ident/boundary classes — **aspirational at every version**: there is
  no preset, and P-3/P-4/P-8 are open through 0.36.0 (§5.2). Raise the gap
  upstream; do not fake it locally, and do not silently keep hand-rolling.
- No `{ min, max }` on a repetition combinator — **it does not compile at
  0.32.0**. `oneOrMore(x)` is `many(x, {min:1})` (§5.2a).
- No `{ gate, combinator }` arm added to a **non-disjoint** choice without a
  corpus differential — it silently zeroes `autoNot` for every arm and changes
  what the grammar accepts (§5.2b).

### 10.2 Execution shape — checklist question 14

`GRAMMAR-REVIEW-STANDARD.md`'s thirteen questions — is this from CSS, is it
readable, does it have JSDoc, is it the simplest combinator representation, does it
duplicate another rule — are all about **the shape of the source**. A rule can pass
every one of them and still allocate a closure per token. Add, as its own numbered
question and not a footnote to any other:

> **14. What does this rule do at runtime, and what part of that is knowable at
> build time?** The AST building does visibly unnecessary work at runtime. Reason
> about what happens at parse time, and move as much of it as possible into
> parseman macros.

**This converges with the dedup constraint; it does not compete with it.** The
reason only parameterless combinator `const`s and plain reducers are allowed — no
factories, no spreads, no hoisted regex sources, no `many(choice)` consts — is that
those shapes **degrade the compiled artifact into the interpreter**. So the style
rule and the runtime rule have the same target, and **writing in the
macro-compilable subset _is_ the performance win.**

Where an agent believes the two genuinely conflict on a specific const: **surface
the conflict; do not pick.** That is a report-and-stop blocker (§6).

### 10.3 Hard constraints

These override anything the checklist might suggest.

- **The macro constraint** — parameterless combinator `const`s and plain reducers
  only. A _correctness_ rule, per §8.2.
- **No regex outside `regex()`.** Pattern text belongs in a `regex()` argument,
  nowhere else.
- **Never create a `productions.ts`.** Upgrade `productions/*.ts` in place.
- **Never `git stash`, `git restore`, `git checkout -- .`, or `git reset --hard`.**
  Commit before measuring.
- **Never `as any`, `: any`, `@ts-ignore`, `@ts-nocheck`.**

### 10.4 Per-const review

The `grammar-reviewer` agent, **required before grammar changes land**, applied to
**every `const`, not a sample**. One of exactly four outcomes each:

| outcome                  | means                                                                   |
| ------------------------ | ----------------------------------------------------------------------- |
| **conforms**             | read, nothing to do. One line. A claim that you read it, not a default. |
| **converted**            | changed — cite the commit.                                              |
| **blocked**              | should change, can't yet — cite the _specific_ reason.                  |
| **deliberate exception** | should not change — cite the justification.                             |

**Report as a table with a row per const, so an omission shows as a missing row.**
`blocked` and `deliberate exception` are the load-bearing ones: a documented
non-collapse stops the next agent re-proposing it. The two guard-operator spellings
left alone in `abe41f5bc` differ only in whitespace framing — worthless unless
written down against those consts.

The checklist itself is in `GRAMMAR-REVIEW-STANDARD.md` §2. **Cite it; do not
restate it.**

---

## 11. What is enforced mechanically

| Mechanism                  | Enforces                                                                                                                                           | Status                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run check:macro`     | 0 interpreter fallbacks — a **correctness** gate (§8.2)                                                                                            | **Landed and blocking**                                                                                                                                                      |
| Grammar ESLint rules       | block comments only, no literal non-ASCII in regexes, no regex outside `regex()`, no macro hazards, consistent multi-line call form, comment shape | **LANDED on `dev`** (`516d10222`, `f18fc4e17`) at **error** — see below                                                                                                      |
| Parseman gating analysis   | ungated choices, `double-not` anti-pattern, broad first sets                                                                                       | Available from the current Parseman floor and surfaced during parser builds; treat warnings as a review queue and prove any accepted warning as an intentional grammar shape |
| `analyzeDuplication()`     | structural duplication/overlap, `keywordRegexes` ordering hazards                                                                                  | Available from the current Parseman floor; use it as review evidence when shrinking duplicated grammar surfaces                                                              |
| `pnpm lint:absolute`       | no `as any` / `: any` / `@ts-ignore` / `@ts-nocheck`                                                                                               | Implemented, **deliberately not wired to a gate**; 500 pre-existing errors across 52 files (§0.6.1)                                                                          |
| `compile(g, { hostMode })` | one grammar, two emissions — the basis of the collapse (§5.3)                                                                                      | Shipped, published, and active through the macro path; `pnpm run check:macro` must report 0 interpreter fallbacks                                                            |
| `parseman/oracle`          | equivalence (§8.1)                                                                                                                                 | Available; Jess's active Less byte-identity gate is `pnpm run oracle:less:byte-identity`                                                                                     |

**This changed on `dev` within a day of being written, in the direction the spec
wanted.** `eslint.config.mjs` defines `GRAMMAR_FILES` as the four
`packages/syntax/*/*-parser/src/**/*.ts` trees plus
`packages/parser-shared/src/**/*.ts`, covering the four surviving grammar
sources and supporting parser source.
At **`error`**: `grammar/no-line-comments` (`:371`),
`grammar/no-literal-non-ascii-in-regex` (`:380`),
`grammar/no-regex-outside-combinator`, `grammar/no-macro-hazards`,
plus repo-wide
`grammar/no-multiline-line-comments` (`:320`) and
`@stylistic/lines-around-comment` (`:330`).

So §8.2 item 2 now has a real floor, and checklist items 4 and 9 are mechanised
rather than reviewer-borne. Item 3 (prettiness) remains a judgement call by
design — §8.7.

**Three carve-outs a unit must know about**, none of which is visible from a green
`pnpm lint`:

- **`less-parser` is deferred** (`eslint.config.mjs:436-464`), explicitly because
  its grammar is being rewritten and reformatting underneath that pass would
  collide. Off for `packages/syntax/less/less-parser/src/**`:
  `grammar/no-line-comments`, `@stylistic/lines-around-comment`, and
  `grammar/no-literal-non-ascii-in-regex`. **The block says to delete it once
  that pass lands** — that is Unit 5's `less` step, and deleting it is part of
  the step.
- **The deferral header contradicts itself.** It states the correctness rules
  "stay ON, because those are the defects the cleanup is meant to remove", and
  then turns `grammar/no-literal-non-ascii-in-regex` off eight lines later
  (`:462`, justified by a second comment citing 16 raw non-ASCII characters).
  Believe the code, not the header.
- **`no-hand-rolled-keyword-regex` exists but is wired nowhere.** Implemented at
  `scripts/eslint-rules/grammar-rules.mjs:446` and tested at
  `scripts/eslint-rules/__tests__/grammar-rules.test.mjs:136`, but absent from
  `eslint.config.mjs`. So the §2.3 keyword-regex class has **no** mechanical
  guard in any package — the header's claim that hand-rolled keywords "stay ON"
  is wrong twice over. Wiring it is a cheap, well-scoped win and would stop the
  count regrowing after Unit 4.

`local/no-oversized-choice` remains implemented and **deliberately unwired**,
now labelled "RETIRED" at `eslint.config.mjs:514-527`.

---

## 12. Discoverability — a deliverable, not a nicety

The owner's requirement is that the dialects "have an **agent-readable link**" to
the CSS base. That phrase is otherwise vague, so it is pinned down here, and this
definition is the acceptance criterion.

### 12.0 What "agent-readable link" means, concretely

**A link is agent-readable when an agent that opens _only_ the dialect grammar
file can reach the CSS base without searching, and can tell what it inherits from
what it overrides.** Four requirements, all mechanically checkable:

1. **A repo-relative path, in the header docblock, that resolves.** Not a
   package name, not prose ("composes on the CSS base"), not a bare identifier —
   a path a reader can open, e.g.
   `../../css-parser/src/grammar.ts`. Prose alone is what all four CST
   headers have today, and it is why nobody follows it.
2. **The composition expression is the link's other half.** The `compose([...])`
   or `composeLeaf([...])` call names its base explicitly at the top of the file,
   not through a re-exported barrel that hides which grammar is actually being
   extended.
3. **A named delta.** The header states, per dialect, **what this grammar adds
   or overrides relative to the base** — as a list of rule names, not a
   paragraph. An agent asked to change `declaration` in `less` must be able to
   see from the header whether `less` has its own `declaration` at all.
4. **Bidirectional.** The CSS base's header names the three dialects that
   compose on it, by path. Otherwise an agent editing the base cannot see its
   own blast radius, and §13.1's problem — the base has the widest blast radius
   and the thinnest verification — stays invisible at the edit site.

The test: **an agent handed one dialect grammar file and no other context can
name its base, open it, and list what this dialect changes.** If it has to grep
to find the base, the link is not agent-readable.

### 12.1 Current state — four surviving headers to finish

**(a) Each dialect grammar header links to the CSS base.** The old eight-file
audit is historical; the `src/ast/grammar.ts` headers are gone. The current
check is the four surviving files:
`packages/syntax/css/css-parser/src/grammar.ts`,
`packages/syntax/less/less-parser/src/grammar.ts`,
`packages/syntax/scss/scss-parser/src/grammar.ts`, and
`packages/syntax/jess/jess-parser/src/grammar.ts`. The three dialect grammar
headers now carry explicit repo-relative CSS-base links and named deltas.

**(b) The CSS grammar's own header names its dependents.** The CSS header now
owns both AST and CST emission and names the Less, SCSS, and Jess grammar paths
that compose or pattern against it. Do not recreate separate AST/CST headers to
satisfy this deliverable.

**(c) `.cursor/rules/domains/parsers.mdc` corrected.** It is substantially stale,
and it is the rule file that governs grammar work:

| line(s)                  | claim                                                                                                           | status at `92d38af4f`                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| globs                    | ~~globs the dead path `packages/parser/**`, omits `packages/jess-parser/**`~~                                   | **FIXED on `dev`** — it now globs all four parser packages plus `packages/parser-shared/**`                                                                                                                                                                                                                                           |
| 2, 14-16, 28, 46, 52, 59 | Chevrotain is the stack / the spec / the debugging hazard; `RECORDING_PHASE`, `GATE`/`ALT`/`OR`, "LL(1) gating" | **still stale** — 6 Chevrotain mentions remain in the rule file. `grep -rn -i chevrotain` over the four parser `src/` trees returns **4 hits in 2 files**, all historical prose comments (`scss-parser/src/grammar.ts:453`, `less-parser/src/ast/grammar.ts:3177,3184,3208`) — no runtime dependency. The stack is PEG-style parseman |
| 14                       | `src/builders.ts`                                                                                               | no such file in any parser package                                                                                                                                                                                                                                                                                                    |
| 18-20, 25, 46            | `packages/{less,css}-parser/src/productions/**`, `root.ts`, `values.ts`, `selectors.ts`, `guards.ts`            | no `productions/` directory exists anywhere in the repo                                                                                                                                                                                                                                                                               |
| 22-24                    | `lookupOrCall` in `guards.ts` as the accessor-shape spec                                                        | file does not exist                                                                                                                                                                                                                                                                                                                   |
| 42                       | "`packages/parser`: Jess CST parser/orchestrator"                                                               | package does not exist                                                                                                                                                                                                                                                                                                                |
| 46                       | hotspots `src/*Tokens*`, `src/*Parser*`                                                                         | no such files                                                                                                                                                                                                                                                                                                                         |

**Two dead pointers remain outside that file**, both propagating the
nonexistent `packages/parser` package:

- `.cursor/rules/packages/parser.mdc` — an entire rule file for
  `@jesscss/parser`, globbing `packages/parser/**`. **That package does not
  exist.** The file is dead.
- `CLAUDE.md`'s auto-select table carries a row for it, and its `parsers.mdc`
  row still lists the old glob set rather than the corrected one.

Essentially the only non-stale content in `parsers.mdc` is the "don't guess
shapes" hygiene advice — and it points at a nonexistent spec.

> **A cold reader does not need any of this.** `.cursor/` and `CLAUDE.md` are
> one agent system's routing layer; nothing load-bearing lives only there.
> `AGENTS.md` is the front door, this document is the spec, and
> `GRAMMAR-REVIEW-STANDARD.md` is the per-`const` checklist. The staleness above
> is recorded so it gets fixed, not because you must read those files.

---

## 13. Structural causes

Addressing these is what stops §2.2 recurring after the rebuild.

### 13.1 `all-less` is the only real corpus gate, so all work pools into `less-parser`

`packages/jess/test/less/all-less.test.ts` is the only fixture-backed integration
authority, and `pnpm run oracle:less:byte-identity` is the only byte-identity
oracle. Both are Less. So `css`, `scss` and `jess` grammar work is verified more
weakly than `less` work — precisely backwards for `css-parser`, the base
everything composes on.

**Consequence for Unit 4:** the CSS pilot has the widest blast radius and the
thinnest direct verification. `parseman/oracle`'s multi-surface corpus (§8.1) is
the fix — it takes an arbitrary surface list, so a CSS corpus with a CSS surface
plus a Less control is expressible. Until PR #75 merges, Unit 4 must state
explicitly that its coverage is indirect via the Less oracle.

### 13.2 SCSS composed on Less, not on the CSS base

Historical blocker; resolved for the physical fold. See §5.4 for the current
SCSS status and the invariant that SCSS must remain a CSS/preprocessor-base
sibling rather than a Less child.

### 13.3 The shared recognition surface is under-populated

`packages/parser-shared` is the shared terminal-recognition package. The four
surviving host-mode grammar sources import it directly where they need shared
CSS, Less, pseudo, or opaque-at-rule terminal surfaces. Its role is terminals
and shared recognition facts; structural CSS productions belong in the CSS base
grammar, not in a revived AST/CST split.
