# Grammar rebuild — design spec and method of record

The four dialect grammars are being **rebuilt**, not refactored. This document is
what an agent is handed: the scope, the constraints, the references to read
first, the method, and the criteria that decide whether they succeeded.

> **Status.** The problem statement (§2), the verification machinery in §8.2–§8.6,
> the traps (§7) and the structural causes (§13) are present-tense and measured.
> **Everything in §4, §5, §6 and §8.1 is planned and not built.** Two of the tools
> the method depends on are unmerged and unreleased upstream. Per
> [`../../README.md`](../../README.md) a document describing machinery the repo
> does not have belongs in `design/`; this one sits in `architecture/` because
> HANDOFF routes to it, and it carries that debt by labelling every planned item
> rather than by hiding it. When the rebuild lands, the planned sections either
> become present tense or move out.

Measured in-tree on **`bcb3107a1`, 2026-07-25**, with the shell method stated
inline. Counts drift; methods do not. **Re-measure. Do not quote.**

## 1. How to use this document

§6 is a set of **dispatchable units**. Each states its scope and boundary, what
is off-limits and why, the references to read first, the method, the pass
criteria, and what to do when blocked. A unit can be handed to an agent verbatim
with no other context.

§8 is how each unit is **measured**. §9 is what does **not** count as success.
§9 is not boilerplate — every entry on it is something that actually happened,
most of them in the session that produced this document.

### Referenced documents

| Document | Owns | Status |
| --- | --- | --- |
| [`GRAMMAR-REVIEW-STANDARD.md`](./GRAMMAR-REVIEW-STANDARD.md) | The per-`const` checklist, the outcome vocabulary, the hard constraints | **Written, not on `dev`** — branch `grammar-review-standard` (`d4bd4a7bb`), with `.cursor/agents/grammar-reviewer.md` |
| `PARSEMAN-COMBINATOR-CHEAT-SHEET.md` (placeholder, this directory) | The version-stamped combinator reference | **Not written.** It is the deliverable of Unit 1 |
| [`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md`](./PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md) | The two pinned-version constraints load-bearing for every measurement | On `dev`. **Its §2 blanket claim is superseded** — see §8.6 |
| `docs/design/PARSEMAN-0.34-GRAMMAR-IDIOM-PLAN.md` | The P-1…P-9 parseman feature requests | **Not on `dev`** — only on branch `parseman-034-adoption` (`a49ca59da`), 981 lines |

---

## 2. The problem

**Eight grammar files, 17,447 lines**, two hand-maintained specifications of the
same language per dialect with no mechanical link between them.

| dialect | CST `src/grammar.ts` | AST `src/ast/grammar.ts` | AST rule-name prefix | distinct prefixed names |
| --- | --- | --- | --- | --- |
| `css-parser` | 800 | 2,173 | `CssAst*` | 157 |
| `less-parser` | 1,252 | 4,750 | `DirectLess*` | 243 |
| `scss-parser` | 844 | 3,298 | `DirectScss*` | 167 |
| `jess-parser` | 627 | 3,703 | `DirectJess*` | 171 |

```sh
wc -l packages/{css,less,scss,jess}-parser/src/grammar.ts \
      packages/{css,less,scss,jess}-parser/src/ast/grammar.ts
grep -oE '\bDirect[A-Za-z0-9_]+' packages/less-parser/src/ast/grammar.ts | sort -u | wc -l
```

### 2.1 The naming families are disjoint, and that is the structural cause

`less ∩ scss = 0`. `less ∩ jess = 1`. `scss ∩ jess = 2` — and all three of those
"overlaps" are comment mentions, not definitions
(`packages/jess-parser/src/ast/grammar.ts:1926`, `:3115`). `css` shares nothing
with any of them because it uses a fourth prefix.

**Four disjoint vocabularies for one language is why the four AST grammars can
share nothing.** It is not cosmetic. A `Declaration` cannot be composed from a
base if the base calls it `CssAstDeclaration` and the dialect calls it
`DirectLessStandardDeclaration`.

One nuance that changes the work: **the emitted node types already agree.** All
four AST grammars import the same constructors from `@jesscss/core/ast`
(`packages/less-parser/src/ast/grammar.ts:6-7`) and check the same names
(`packages/css-parser/src/ast/grammar.ts:251` — `isNodeType(value, 'Declaration')`).
The divergence is entirely in **grammar rule names**. So this is a rename of
rules, not a redesign of the AST — which is exactly why a byte-identity oracle
cannot gate it (§8.1).

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

The owner's standing worklist (`bcb3107a1`) is *20 near-clone clusters, 14
separated lists, 18 leading-`not()` sites*, scoped to `less-parser`. Whole-corpus
re-counts across all eight files:

| Item | Brief | Measured | Method |
| --- | --- | --- | --- |
| Hand-rolled keyword regexes | 15 | **18** | `regex()` whose pattern is a pure alternation of literal words |
| Hand-rolled separated lists | 39 | **65** (29 a literal `sepBy` swap) | `many(sequence(<separator terminal>, …))` |
| Spellings of one operator set | 7 | **7**, +5 for the Less guard superset | distinct spellings of `< <= = >= >` |
| Near-clone clusters | 20 | **24** at ≥3 files (69 at ≥2, 10 at ≥4) | normalise `const X = node\|choice\|sequence(` names by stripping the dialect prefix, then group |
| Leading `not()` | 18 | **43** | `sequence(not(` after whitespace flattening |
| `not(regex(` as terminator | — | **21** literal; **180** for all `not(` | whitespace-flattened `re.findall` |
| `noTrivia` | — | **300** | ditto. `optional(ws…)` is only **10**. `scss` CST uses `noTrivia` zero times — an outlier |
| Bespoke boundary/ident classes | — | **220** `(?!…)` lookaheads, **195** `[-_a-zA-Z0-9…]` classes | ditto |
| `/i` without `/u` | — | **154 of 569 regex literals — and ZERO literals in any of the eight files carry `/u` or `/v`** | per-line flag check |

The `/u` finding is the one to sit with: this is not a scattering of oversights,
it is the uniform house style, and `/i` case-folding is running in non-Unicode
mode everywhere. Several patterns embed a raw non-ASCII range
(`packages/scss-parser/src/ast/grammar.ts:934`) — exactly what `/u` would reject.

`sepBy` exists in 0.32.0 and is used **12** times across the eight files — and
**zero** times in the `jess` CST or in any of the `less`/`scss`/`jess` AST
grammars. `keywords()`/`word()` also already exist; `less-parser`'s CST uses them
(`:399`, `:711`, `:815-817`, `:1118`, `:1132`, `:1157`, `:1189-1190`). The 18
keyword regexes are what remains. **The API was there. It was not reached for.**
That is what §4 step 1 exists to fix.

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

1. **Survey parseman's full export surface from source** — not from
   recollection. Every mental model in this project is 0.32.0-era, and that
   staleness is what produced the hand-rolled `sepBy`, the keyword regexes and
   the boundary guards. Read the CHANGELOG `0.32.0 → 0.36.0` as a diff of
   capability.
2. **Produce a version-stamped combinator cheat sheet** as the artifact of that
   survey, in this directory.
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

None of §6 starts before these resolve. Each is stated with what is actually
verified, because two of them were given to this document in a form the tree does
not support.

### 5.1 parseman 0.36.0 adoption must land first

The repo pins **`0.32.0` exactly** (root + 5 package manifests;
`pnpm-lock.yaml:17276`). The invariant is that **compiled parser artifacts never
cross parseman versions** — a bump regenerates every artifact and rebaselines
every aggregate hash.

parseman is at `/Users/matthew/git/oss/parser-thing` (on-disk directory name
differs from the package name). 0.36.0 is merged to `main` at `be09b83` via PR
#70. **There are no version tags in that repo at all**, and whether 0.36.0 is
published to npm is **unverified** — check before writing a version into a
manifest. Read 0.36.0 from `/Users/matthew/git/worktrees/pm-036-bump`
(`release/0.36.0-bump`), not from `shadowed-leaf-arm`, which carries unreleased
commits past it.

**Correction to the brief this document was given.** "0.34 and 0.35 both
net-regressed Less" is half wrong, and the difference decides the target version:

- **0.34.0 regressed.** jess measured Less **+10…25%** slower on the
  `0.32.0 → 0.34.0` bump (branch `parseman-034-adoption`, `a49ca59da`;
  same-worktree git-toggle, 4 rounds × 3 runs, AST byte-identity held across
  1,880 corpus files). Filed as **P-9**. parseman independently measured
  **+32.5%** on `0.33.0 → 0.34.0` and found the cause: the `not()` probe-leak fix
  issued six unconditional `array.length` stores on a probe executed ~600×/KB by
  the Less grammar.
- **0.35.0 fixed it and went net-faster than the `0.32.0` we pin** — guarding all
  ~3,000 rollback sites gave −12.0% vs 0.33.0, and vs 0.32.0 the guarded build
  wins on every corpus (Less `benchmark.less` −3.9%, `bootstrap.css` −18.5%,
  jess corpus −18.5%, 12/12 interleaved wins).
- **0.36.0** deduplicates expectation sets — oversized derived sets were ~⅓ of
  parse time on a 106 KB Less stylesheet.

**All of the 0.35/0.36 numbers are parseman's own measurements. jess has never
measured 0.35 or 0.36.** Reproducing them in jess, by §8.5's method, is the first
task of Unit 2 — not an assumption it may proceed on.

Also mislabelled: branches `parseman-035-adoption` and `parseman-036-adoption`
**both still pin 0.32.0** and contain no parseman work (the latter holds
Less-grammar refactors done against 0.32.0). The 0.34 bump at `a49ca59da` is
**not an ancestor** of either. There is no 0.36 adoption in progress.

### 5.2 What 0.36.0 actually gives you

Versus 0.32.0, exactly **three** new value exports — `peek`, `oneOrMoreSep`,
`analyzeGatingRules` — plus types (`RepeatOptions`, `SepByOptions`,
`TrailingSeparator`) and the `parseman/run` subpath. Nothing was removed.

| Need | 0.36.0 answer |
| --- | --- |
| leading `not()` | **`peek(x)`** (added 0.34.0). Zero-width positive lookahead that **carries its body's first-set**, so `peek(regex(/[.#]/))` keeps O(1) first-char dispatch. `not(not(x))` reports first-set `any` and poisons the choice |
| separated lists | `sepBy` (0.32.0) and **`oneOrMoreSep`** (0.34.0). All four repetition combinators take `{min, max}` counting items; separated forms take `trailing: 'forbid'\|'allow'\|'require'`. Prefer `min >= 1` — plain `sepBy` is nullable, which kills the enclosing choice's dispatch |
| keyword regexes | `keywords()`, `word()`, `makeWord()` — **all three already exist in 0.32.0.** 0.34.0 adds `caseInsensitive` to `word()` and ASCII-folds case-insensitive first-sets so the arm still gates |
| gating analysis | **`analyzeGatingRules(ruleMap, opts?)`** (0.34.0), plus `resolveRef` for the fused view, and `compileRuleMap` now runs gating over the whole map — it was **blind in the macro build** through 0.32.0 |
| scan hygiene | 0.33.0: `scanTo`/`balanced` skip ambient `trivia` by default; `rules({ scanSkip })` for opaque units; per-call `raw: true` opts out |

**Two things 0.36.0 does not give you.** Say so rather than planning around
capability that is not there:

- **Nothing replaces manual `optional(ws)` / `noTrivia`.** `trivia`, `noTrivia`
  and `parser({trivia})` are unchanged 0.32.0 → 0.36.0. `noTrivia` at 300 sites
  is the ambient mechanism, not an anti-pattern; the don't in §10.1 is about
  *hand-written whitespace beside it*, not about `noTrivia` itself.
- **No ident/boundary preset.** `keywords()` still builds `(?![<boundary>])` from
  a plain character-class string (`src/combinators/keywords.ts:80`, default
  `'_0-9A-Za-z'`). No `cssIdent`, no `followedBy`, no leading boundary.
  `word(str, boundary)` is the only lever and it cannot express backslash escapes
  or non-ASCII ident code points. jess filed these as **P-3, P-4, P-8; all still
  open in 0.36.0.** So "no bespoke ident/boundary classes" is an *aspiration*:
  raise it upstream, do not fake it locally.

Not in 0.36.0: **`analyzeDuplication()`** — the structural duplication/overlap
diagnostic with seven finding families and hand-rolled-`sepBy` detection — is
**unreleased, `main`-only**. Do not write it into a gate.

### 5.3 parseman host-aware capture elision — UNVERIFIED

The brief cites a "P1 host-aware capture elision, without which the unified CST
is silently lossy." **I could not find it.** No "host-aware" or "capture elision"
string exists in parseman's `docs/` or `notes/`, nor in jess's `docs/`. The
branch `fix/host-aware-capture` sits at `be09b83` = `main` with **zero commits of
its own**. jess's own P-1 is something different (`composeLeaf` holes reported as
`ungated` instead of `deferred`).

The nearest real work is 0.31.0's `_parsemanReadsChildren` children-array elision
and the `_hostReads(build, n)` arity probe discussed in
`pm-036-bump/notes/PERF_IDEAS.md` and `notes/CODEGEN-FAST-PATHS.md`
("arity-gated capture elision").

**Action: resolve this with the owner before Unit 4 starts.** If a real lossiness
risk exists it is a hard blocker on the unified CST and must be named precisely.
Do not proceed on the strength of a half-remembered item.

### 5.4 SCSS composing on Less must be corrected

`packages/scss-parser/src/grammar.ts:30`:

```ts
export const scssGrammar = compose([lessGrammar, cssAstSyntax, rules({ trivia: rw }, (g: any) => {
```

This is now **blocking Less-side cleanup**, not merely an SCSS correctness leak:
`packages/less-parser/src/grammar.ts:157-158` asserts "SCSS composes on the CSS
base, NOT on Less, so it never inherits this Less body" and licenses Less-side
edits on that premise. **That comment is false**, and any Less CST edit taken on
its authority silently changes SCSS.

**Good news, and it changes the sequencing:** this is **CST-only**. The SCSS
*AST* grammar does not compose on Less — it has no `compose(` call at all, only
`composeLeaf([cssAstSyntax, opaqueAtRuleRecognition, cssAstPseudoSyntax, …])` at
`packages/scss-parser/src/ast/grammar.ts:943`, i.e. shared *terminal* tables. The
four AST grammars are already independent of each other. Tracked in
`docs/architecture/core/SCSS-PARSER-REBASE-DESIGN.md`.

### 5.5 The `internal-css-recognition` rename is sequenced last

Because it rewrites an import in all four grammars. **No rename proposal exists
in the tree** — no doc, no branch, no target name. The closest thing is a *move*,
not a rename: `docs/design/packages-layout-grouping.md:67-70` proposes relocating
syntax packages under `packages/syntax/` while keeping the name. Blast radius if
it happens: **12 import statements** in the grammar files, **54 reference sites**
repo-wide.

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

**Read first.** `/Users/matthew/git/worktrees/pm-036-bump` (branch
`release/0.36.0-bump`) — `CHANGELOG.md`, `src/index.ts`, `src/combinators/`.
Then §5.2 above, which is a seed, not a substitute: it was compiled from the
CHANGELOG and must be checked against source.

**Method.** Read the CHANGELOG 0.32.0 → 0.36.0 as a diff of capability, then
`src/index.ts` for the full export list, then the implementation of anything the
grammars will use. Version-stamp the result.

**Pass criteria.**
- Every value export of 0.36.0's `src/index.ts` appears with a one-line "use it
  when" and at least one worked example.
- Each anti-pattern in §2.3 has a named replacement, or an explicit "no
  replacement exists at 0.36.0, filed as P-n".
- The sheet is stamped with the parseman version **and the SHA it was read from**.
- Anything not confirmable from source is marked UNVERIFIED — not omitted, not
  guessed.

**Blocked?** If 0.36.0 is not published to npm, report — do not pin a manifest to
an unpublished version.

---

### Unit 2 — parseman 0.36.0 adoption

**Scope.** The version pin, the regenerated artifacts, and a jess-side
measurement.

**Off-limits.** Any grammar rewrite. This unit changes a version and regenerates;
it does not restructure. Mixing the two makes the differential unattributable.

**Read first.** §5.1. `docs/design/PARSEMAN-0.34-GRAMMAR-IDIOM-PLAN.md` on branch
`parseman-034-adoption` (`a49ca59da`) for P-1…P-9 and the 0.34 measurement
method.

**Method.** Bump root + all five package manifests together. Rebuild every
compiled artifact. Then measure by §8.5.

**Pass criteria.**
- §8.2 definition of done, with the **rename mapping empty** — this unit renames
  nothing, so the oracle verdict must be `identical`, not `moved`.
- A jess-side perf measurement of 0.32.0 → 0.36.0 by §8.5, reported as median,
  min, spread and win-rate **per dialect**. **parseman's own numbers do not
  substitute.**
- 0.34.0's gating fix surfaced **202 ungated choices and 28 anti-patterns** that
  had been invisible since 0.32.0. Re-run `analyzeGatingRules` and record the
  current set — as a set, not a count.

**Blocked?** If the measurement shows a net regression on any dialect, report with
the numbers. Do not adopt, and do not tune the grammar to compensate — that would
confound Unit 5.

---

### Unit 3 — Coverage measurement (the greenfield gate)

**Scope.** Determine which grammar productions no test reaches. Produces a
measurement and a go/no-go recommendation.

**Off-limits.** Any grammar edit. The point is to measure the tree as it is.

**Read first.** `vitest.config.ts:142-146`;
`packages/less-parser/test/ast-identity-oracle.mjs`.

**Current state — this has to be built.** `@vitest/coverage-v8` is a root
devDependency with a `test:coverage` script, but coverage is **disabled by
default** to save memory, with no `include`, thresholds, or reporter. No script
maps productions to tests. And V8 line coverage is close to useless here
regardless: the macro import (`with { type: 'macro' }`) compiles the grammar to
flat JS at build time, so line coverage of the emitted artifact does not map back
to a `const`-per-production source.

**Method.** Build an instrumented `rules()`/`node()` wrapper — or a parseman hook
— recording entered rule keys per parse, then diff that set against the declared
key set per grammar. The denominators come free from §2: 157 / 243 / 167 / 171.
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

### Unit 4 — The CSS pilot

**Scope.** `packages/css-parser/src/grammar.ts` and
`packages/css-parser/src/ast/grammar.ts` become one grammar. Complete, reviewed
and landed **before any dialect starts**.

**Off-limits.** `less`, `scss`, `jess` — all six of their grammar files. Because
`less` composes on `css` and `scss` composes on `less` (§5.4), a CSS change moves
downstream trees; that is expected, and is exactly what the control surface in
§8.1 is for. Also off-limits: any `internal-css-recognition` rename (§5.5).

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
- The CSS grammar's header states that three dialects compose on it (§12).
- Rule names are CSS concept names — no `CssAst*`, no `Direct*` (§10.1).
- The per-`const` review table has a row per `const` (§10.4).

**Blocked?** A rule whose spec behaviour and old-grammar accept set genuinely
disagree is a semantic question. Report it; do not pick.

---

### Unit 5 — The dialects

**Scope.** One dialect at a time, each composing on the finished CSS base. Order:
**`less`, then `scss`, then `jess`** — because §5.4 means `scss` cannot be treated
as independent until `less` is settled, and because `less` is the only dialect
with an oracle corpus and a fixture gate.

**Off-limits.** The CSS base, once Unit 4 lands. If a dialect needs a CSS change,
that is a change to Unit 4's output and is reviewed as such — **not** a local
re-implementation. Re-implementing CSS in a dialect is a stated failure (§10.1).

**Read first.** Unit 4's landed CSS grammar — that is the shape reference. Then
the cheat sheet, then the review standard, then the dialect's own spec, then the
old grammars last, for the accept set only.

**Pass criteria.** §8 in full, plus:
- `all-less` 108/108 for the `less` unit (§8.4).
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

- **Build in order, `internal-css-recognition` FIRST.** All four parsers depend on
  it; wrong order links them against a stale recognition lib, which masks ~17 real
  failures. Then parsers → `awaitable-pipe` → `core` → `fns` → `config` →
  `style-resolver` → plugins → `jess`. `pnpm run build:release` does the lot.
- **Tests run from `lib/`, not `src/`.** A stale build silently measures an
  *older commit* and reports it as today's number. Rebuild between every edit you
  intend to measure.
- **`pnpm --filter "*/jess-plugin-*"` silently matches nothing** and inflates the
  jess failure count from 13 to 23. A filter that matches nothing exits 0. Check
  what a filter actually selected before trusting a count taken through it.
- **Capture your own baselines as SETS, never inherit a count.**
  `docs/state/PROJECT_STATE.md:73-77`: a count cannot tell "nothing changed" apart
  from "you fixed one and broke another".
- **A macro-fallback build is not AST-equivalent**, so a red
  `check-macro-buildable` **invalidates any differential taken on it** (§8.2).
- **`all-less` 108/108 is meaningless without the less.js checkout SHA.** The
  fixtures live in an unpinned checkout; less.js `dded69cc` moved the count
  108→106 with no jess-side change.
- **A fresh worktree has no `node_modules`.** `pnpm install` plus the ordered
  build before any number is real.

---

## 8. How each unit is measured

### 8.1 The equivalence gate — `parseman/oracle`

> **UNMERGED AND UNRELEASED.** PR #75, branch `feat/ast-identity-oracle`, ref
> **`10ab446`**, sitting on top of the 0.36.0 bump and **not part of 0.36.0**
> (`package.json` at that ref still reads `0.36.0`). Write the spec against it;
> do not describe it as available until it merges. Until then,
> `packages/less-parser/test/ast-identity-oracle.mjs` (§8.6) is what exists.

A Node-only subpath — `package.json:46-50` at `10ab446` exports `./oracle`.
Node-only by *imports*, not by an export condition: `node:crypto`
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
The surface *name* is hashed into its own aggregate (`:192-196`), so renaming a
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
new name, and nothing maps to two. **The oracle does not support this natively**:
there is no rename-mapping or residue API in `src/oracle` at `10ab446`. It gives a
binary per-entry fingerprint diff — `SurfaceComparison` (`identity.ts:233`) carries
`moved: string[]`, the entry ids whose fingerprint changed, plus
`addedEntries`/`removedEntries`. **jess must supply the mapping and the residue
check itself.** That is unbuilt work and belongs to Unit 4.

A gained or lost corpus entry is **not** `incomparable` — it is reported in
`addedEntries`/`removedEntries` and yields `moved`.

**(c) A nondeterministic parse is diagnosed by name, not hashed into a digest that
drifts every run.** `verifyDeterminism` (`identity.ts:210-231`, called from
`digestCorpus` at `:186`) re-parses a stride-sampled subset — `determinismSample`,
default **32**, `0` disables — and compares raw payload *text*, not the hash. On
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
4. **`check-macro-buildable` — 0 fallbacks.**

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
  (13 test files).

> **Recorded dependency, and a correction.** The brief states the LS suite has 5
> pre-existing failures being fixed in parallel. **That number is unsourced.** It
> appears nowhere in `docs/state/PROJECT_STATE.md`, in `known-failures.json`, or in
> HANDOFF; the LS suite has no ratchet baseline at all. Before relying on it,
> capture the current failing set by running the suite — as a set, per §7 — and
> record it. The dependency is real; the number is not yet evidence.

### 8.5 Perf

Only where a change was motivated by cost. `packages/less-parser/test/ab-compare.mjs`
encodes the method: **same worktree** (A = working tree, B = `git show HEAD:` of
the grammar files), warmup then timed samples, a **full macro rebuild between every
block**, interleaved `B A B A` across rounds and processes, reporting **median AND
min AND spread AND win-rate**.

Its header states the standard: **a single median is not a result.** The untouched
surface is the noise floor. **A neutral result is a perfectly good result** — the
gate for this work is §8.1 through §8.4, not a speedup.

### 8.6 What the gating diagnostic can and cannot see

`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md` §2 claims parseman's analysis cannot walk
`compose()`d grammars — `analyzeGating()` throws for 129 of 129 rules of the
composed Less CST — and §2.2 projects that any future duplication diagnostic
inherits the defect and **silently reports nothing on exactly the four grammars
that are supposed to be parseman's reference implementation**.

**The blanket form is superseded** (`GRAMMAR-REVIEW-STANDARD.md` §3): the analysis
*can* analyse these grammars when fed their `rules()` map captured **before**
`compose()`. It is the fused compiled artifact that throws, and it now throws
actionably. 0.34.0 goes further — `compileRuleMap` runs gating over the whole map,
and `analyzeGatingRules` is exported for exactly this.

The operative rule survives intact, and it is why an oracle exists at all:

> **Never read a clean or empty diagnostic obtained from the fused artifact as
> evidence that a grammar is clean. Feed it the pre-`compose()` map, and say which
> you fed it.**

The oracle that exists on `dev` today —
`packages/less-parser/test/ast-identity-oracle.mjs`, 707 files, both surfaces,
baselines `aggAst 0aa9de8c9780273a…` / `aggCst d9fd8da52bf4bebb0…`, 119 expected
throws — has **no `package.json` script, no CI wiring, and covers `less-parser`
only**. It always exits 0; "failure" is you diffing before against after. §8.1
replaces it when PR #75 merges.

### 8.7 The subjective bar — named as subjective, with a named judge

Two criteria here cannot be mechanised, and pretending otherwise is how they get
dropped.

- **Would this rule be the example in the docs?** These grammars are parseman's
  reference implementation.
- **Does it read when projected on a wall?** Per const: does the rule's shape
  *teach what it does* at lecture-hall size, or does it need narration?

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

1. **A passing test suite.** It is context. It is none of the four items in §8.2.
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
   the tree (§2.3), as were "0.35 regressed Less" (§5.1), "ESLint rules cover the
   eight grammar files" (§11), "5 LS failures" (§8.4), "the P1 host-aware capture
   elision item" (§5.3) and "the `internal-css-recognition` rename" (§5.5).
7. **A gate made to pass by shrinking what it measures.** In parseman PR #75 a
   `composeLeaf` soundness sweep ran ~5.5s under coverage against a 5s default and
   the failure message said **"timeout", not "sweep"**. The correct move was taken:
   trace it, verify green on unmodified `main` first to rule out a real regression,
   then **raise the ceiling rather than shrink the sweep** — because the sweep's
   size *is* the assertion (`test/unit/composeleaf-firstset.test.ts` @ `10ab446`,
   timeout raised to `60_000`, the 300-grammar sweep and its `tested > 1000`
   assertion untouched). A fuzz that shrinks to fit a clock stops finding things. A
   corpus subset chosen because the full one was slow is the same move, and so is
   lowering `determinismSample` to get past §8.1c. **If a gate is too slow, that is
   a budget question to raise, not a scope to quietly reduce.**
8. **An unmeasured claim that a rewrite is faster.** Perf claims need a controlled
   measurement in **one directory with a git toggle** (§8.5) — not a cross-worktree
   comparison, not a prediction from the shape of the code. **"I moved N sites into
   macros" is a count, not a result.**

---

## 10. Constraints in force

### 10.1 The don'ts

- No copy/paste from the old grammars.
- No hand-rolled keyword regexes — `keywords()` / `word()`.
- No `not(regex(…))` as a terminator.
- No leading `not()` — **`peek()` exists at 0.36.0** and carries its body's
  first-set.
- No manual `optional(ws)` or hand-written whitespace beside `noTrivia`.
  (`noTrivia` itself is the ambient mechanism and is not the target — §5.2.)
- No production consuming its own `;`. **`;` separates; the list owns it.**
  `GRAMMAR-REVIEW-STANDARD.md` item 10 records this as *pending an owner ruling*
  for the existing grammars, where such sites are `blocked`, not `converted`. In
  new code, do not write them.
- No per-dialect names for CSS concepts, and **no `Direct*` prefix**.
- No re-implementing CSS — compose from the base.
- No factories, no spreads, no hoisted consts (§10.3).
- No literal non-ASCII in regexes.
- No `/i` without `/u`.
- No bespoke ident/boundary classes — **aspirational at 0.36.0**: there is no
  preset, and P-3/P-4/P-8 are open (§5.2). Raise the gap upstream; do not fake it
  locally, and do not silently keep hand-rolling.

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
macro-compilable subset *is* the performance win.**

Where an agent believes the two genuinely conflict on a specific const: **surface
the conflict; do not pick.** That is a report-and-stop blocker (§6).

### 10.3 Hard constraints

These override anything the checklist might suggest.

- **The macro constraint** — parameterless combinator `const`s and plain reducers
  only. A *correctness* rule, per §8.2.
- **No regex outside `regex()`.** Pattern text belongs in a `regex()` argument,
  nowhere else.
- **Never create a `productions.ts`.** Upgrade `productions/*.ts` in place.
- **Never `git stash`, `git restore`, `git checkout -- .`, or `git reset --hard`.**
  Commit before measuring.
- **Never `as any`, `: any`, `@ts-ignore`, `@ts-nocheck`.**

### 10.4 Per-const review

The `grammar-reviewer` agent, **required before grammar changes land**, applied to
**every `const`, not a sample**. One of exactly four outcomes each:

| outcome | means |
| --- | --- |
| **conforms** | read, nothing to do. One line. A claim that you read it, not a default. |
| **converted** | changed — cite the commit. |
| **blocked** | should change, can't yet — cite the *specific* reason. |
| **deliberate exception** | should not change — cite the justification. |

**Report as a table with a row per const, so an omission shows as a missing row.**
`blocked` and `deliberate exception` are the load-bearing ones: a documented
non-collapse stops the next agent re-proposing it. The two guard-operator spellings
left alone in `abe41f5bc` differ only in whitespace framing — worthless unless
written down against those consts.

The checklist itself is in `GRAMMAR-REVIEW-STANDARD.md` §2. **Cite it; do not
restate it.**

---

## 11. What is enforced mechanically

| Mechanism | Enforces | Status on `dev` (`bcb3107a1`) |
| --- | --- | --- |
| `pnpm run check:macro` | 0 interpreter fallbacks — a **correctness** gate (§8.2) | **Landed and blocking** |
| Grammar ESLint rules | comment shape, block comments only, no literal non-ASCII in regexes, no regex outside `regex()`, no macro hazards, expanded call form | **NOT on `dev`.** Branch `grammar-lint-rules` (`7c883f7f1`, **local and unpushed**) adds `scripts/eslint-rules/grammar-rules.mjs` at **error** across all eight grammar files plus `internal-css-recognition`, with `less-parser`'s layout and non-ASCII rules deferred behind a narrow dated block |
| `analyzeGatingRules` | ungated choices, `double-not` anti-pattern | Available from **0.34.0**; the repo pins 0.32.0, where the macro build's gating was **blind** |
| `analyzeDuplication()` | structural duplication/overlap, hand-rolled-`sepBy` detection | **Unreleased, parseman `main` only.** Not a gate |
| `parseman/oracle` | equivalence (§8.1) | **Unmerged.** PR #75 |

**Today, no ESLint rule applies to the eight grammar files.** The four local rules
in `scripts/eslint-rules/index.mjs` are all `warn` by explicit policy
(`eslint.config.mjs:263-268`) and scoped to `packages/*/src/ast/**` or a core
hot-path allowlist; `eslint.config.mjs:320-321` states grammar files are out of
their scope. The one grammar-shaped rule, `local/no-oversized-choice`, is
implemented and **deliberately unwired** (`:305-316`). Until `grammar-lint-rules`
lands, §8.2 item 2 has no floor for these files, and checklist items 3, 4 and 9 are
entirely reviewer-borne.

---

## 12. Discoverability — a deliverable, not a nicety

Three concrete outputs, each verified as missing today.

**(a) Each dialect grammar header links to the CSS base.** All eight files have
header docblocks and **none links to the CSS base grammar by path**. The CST
headers at least name their base in prose (`packages/less-parser/src/grammar.ts:2`,
`packages/scss-parser/src/grammar.ts:2`, `packages/jess-parser/src/grammar.ts:2-8`).
The **AST** headers do the opposite — they assert independence and link to nothing
(`packages/scss-parser/src/ast/grammar.ts:1-7`,
`packages/jess-parser/src/ast/grammar.ts:1-5`).

**(b) The CSS grammar's own header states that three dialects compose on it.**
Today `packages/css-parser/src/grammar.ts:1-10` says dialects compose it but does
not name them or point at them; `packages/css-parser/src/ast/grammar.ts:1-6` does
not mention them at all.

**(c) `.cursor/rules/domains/parsers.mdc` corrected.** It is substantially stale,
and it is the rule file that governs grammar work:

| line(s) | claim | status |
| --- | --- | --- |
| 7 | globs `packages/parser/**` | **dead path** — no such package; the real one is `packages/jess-parser` |
| — | no glob for `packages/jess-parser/**` | **the jess grammars are uncovered by the rule that governs grammars** |
| 2, 14-16, 28, 46, 52, 59 | Chevrotain is the stack / the spec / the debugging hazard; `RECORDING_PHASE`, `GATE`/`ALT`/`OR`, "LL(1) gating" | `grep -rn chevrotain` over all four parser `src/` trees returns **zero hits**. The stack is PEG-style parseman |
| 14 | `src/builders.ts` | no such file in any parser package |
| 18-20, 25, 46 | `packages/{less,css}-parser/src/productions/**`, `root.ts`, `values.ts`, `selectors.ts`, `guards.ts` | no `productions/` directory exists |
| 22-24 | `lookupOrCall` in `guards.ts` as the accessor-shape spec | file does not exist |
| 42 | "`packages/parser`: Jess CST parser/orchestrator" | package does not exist |
| 46 | hotspots `src/*Tokens*`, `src/*Parser*` | no such files |

The dead `packages/parser/**` glob is propagated into `CLAUDE.md`'s auto-select
table. Essentially the only non-stale content is the "don't guess shapes" hygiene
advice — and it points at a nonexistent spec.

---

## 13. Structural causes

Addressing these is what stops §2.2 recurring after the rebuild.

### 13.1 `all-less` is the only real corpus gate, so all work pools into `less-parser`

`packages/jess/test/less/all-less.test.ts` is the only fixture-backed integration
authority, and `packages/less-parser/test/ast-identity-oracle.mjs` is the only
byte-identity oracle. Both are Less. So `css`, `scss` and `jess` grammar work is
verified more weakly than `less` work — precisely backwards for `css-parser`, the
base everything composes on.

**Consequence for Unit 4:** the CSS pilot has the widest blast radius and the
thinnest direct verification. `parseman/oracle`'s multi-surface corpus (§8.1) is
the fix — it takes an arbitrary surface list, so a CSS corpus with a CSS surface
plus a Less control is expressible. Until PR #75 merges, Unit 4 must state
explicitly that its coverage is indirect via the Less oracle.

### 13.2 SCSS composes on Less, not on the CSS base

§5.4. CST-only; the AST grammars are already independent.

### 13.3 The shared recognition surface is under-populated

`packages/internal-css-recognition` is **368 lines across 3 source files**,
publishing 4 exports and **89 rule keys, all pure terminals** — `cssAstSyntax`
(`src/recognition.ts:198`), `lessAstSyntax` (`:251`), `cssAstPseudoSyntax`
(`src/pseudo-consts.ts:46`), `opaqueAtRuleRecognition` (`src/opaque-at-rule.ts:23`).
No structural productions.

Consumption is lopsided: all four **AST** grammars import it; of the four **CST**
grammars only `packages/scss-parser/src/grammar.ts:10` does. So it does not look
like the natural home for a CSS production, and the terminal-level duplication of
§2.3 persists in the CST grammars that share nothing with it.

After the rebuild the CSS base is the home for CSS productions and this package's
role is terminals. Its rename is sequenced last (§5.5).
