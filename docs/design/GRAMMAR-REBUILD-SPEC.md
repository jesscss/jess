# Grammar rebuild — design spec and method of record

The four dialect grammars are being **rebuilt**, not refactored. This document is
what an agent is handed: the scope, the constraints, the references to read
first, the method, and the criteria that decide whether they succeeded.

> **Status: `design/`, not `architecture/`.** The problem statement (§2), the
> verification machinery in §8.2–§8.6, the traps (§7) and the structural causes
> (§13) are present-tense and measured. **Everything in §4, §5, §6 and §8.1 is
> planned and not built** — and two of the tools the method depends on are
> unreleased and unmerged upstream. `CLAUDE.md` says not to add architecture
> documents that mostly describe machinery the repo does not currently have, and
> [`../README.md`](../README.md) puts such a document here. This one obeys that
> rather than acknowledging it in a banner.
>
> **It graduates to `architecture/parser/` when the rebuild lands** and the
> forward-looking sections become present tense. That move is the visible event
> marking the rebuild as done — do not let this document age into `architecture/`
> quietly, and do not let it sit here describing shipped machinery.

Measured in-tree on **`a67b5077c`, 2026-07-25** (`origin/dev` at `76680b114`),
with the shell method stated inline. Counts drift; methods do not. **Re-measure.
Do not quote** — §2.3 shows two of these figures moving inside a single day.

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
| [`GRAMMAR-REVIEW-STANDARD.md`](../architecture/parser/GRAMMAR-REVIEW-STANDARD.md) | The per-`const` checklist, the outcome vocabulary, the hard constraints | **Landed on `dev`** (`76680b114`), byte-identical to the branch version, with `.cursor/agents/grammar-reviewer.md` |
| `docs/architecture/parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md` | The version-stamped combinator reference | **Not written.** It is the deliverable of Unit 1. It belongs in `architecture/parser/` even though this spec does not: it documents an external library's actual capability, which is a fact about the world, not a plan |
| [`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md`](../architecture/parser/PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md) | The two pinned-version constraints load-bearing for every measurement | On `dev`. **Its §2 blanket claim is superseded** — see §8.6 |
| [`DIALECT-ARCHITECTURE-AND-ERROR-COVERAGE.md`](../architecture/parser/DIALECT-ARCHITECTURE-AND-ERROR-COVERAGE.md) | The SCSS-on-Less inversion, with the build-verified proof that it blocks Less-side cleanup | On `dev` (`ac02c6e0b`) — see §5.4 |
| `docs/design/PARSEMAN-0.34-GRAMMAR-IDIOM-PLAN.md` | The P-1…P-9 parseman feature requests | **Not on `dev`** — only on branch `parseman-034-adoption` (`a49ca59da`), 981 lines |

---

## 2. The problem

**Eight grammar files, 24,305 lines**, two hand-maintained specifications of the
same language per dialect with no mechanical link between them.

| dialect | CST `src/grammar.ts` | AST `src/ast/grammar.ts` | AST rule-name prefix | distinct prefixed names |
| --- | --- | --- | --- | --- |
| `css-parser` | 1,527 | 3,455 | `CssAst*` | 157 |
| `less-parser` | 1,281 | 4,750 | `DirectLess*` | 243 |
| `scss-parser` | 1,379 | 5,116 | `DirectScss*` | 167 |
| `jess-parser` | 1,210 | 5,587 | `DirectJess*` | 171 |

```sh
wc -l packages/{css,less,scss,jess}-parser/src/grammar.ts \
      packages/{css,less,scss,jess}-parser/src/ast/grammar.ts
grep -oE 'Direct[A-Z][A-Za-z0-9_]*' packages/less-parser/src/ast/grammar.ts | sort -u | wc -l
```

**Use the `[A-Z]` anchor.** A bare `Direct[A-Za-z0-9_]*` returns 244/168/172 —
the extra one in each file is the standalone word "Direct" in prose.

> **Line count is now a poor metric, and it is instructive why.** It read 17,447
> one day earlier. `516d10222` turned on
> `@stylistic/function-call-argument-newline` at `error` across these files and
> autofixed them into expanded call form — one argument per line. Nothing about
> the grammars changed. `less-parser`'s two files are the control: they sit
> behind the deferral block (§11) and did **not** move (`4750` before and after).
> **Do not track this work by line count.** Track it by rule-name intersection
> (§2.1) and by the §2.3 conversion classes.

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
| Hand-rolled keyword regexes | 15 | **9** (was 18 a day earlier) | `regex()` whose pattern, after stripping `^`/`$`/`\b`/lookaheads/`(?:…)`, is a pure `word\|word` alternation |
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

**Leading `not()` must be counted multiline-aware.** Since `516d10222` expanded
the call form, a plain `grep -c 'sequence(not('` returns 14 instead of 43. Use:

```sh
perl -0777 -ne '$c=()=/sequence\(\s*not\(/g; print "$ARGV: $c\n"' \
  packages/{css,less,scss,jess}-parser/src/grammar.ts \
  packages/{css,less,scss,jess}-parser/src/ast/grammar.ts
```

`sepBy` exists in 0.32.0 and is used **12** times across the eight files — and
**zero** times in the `jess` CST or in any of the `less`/`scss`/`jess` AST
grammars. `keywords()`/`word()` also already exist. **The API was there. It was
not reached for.** That is what §4 step 1 exists to fix.

**The keyword-regex count halving in one day is the proof that it works.**
`5d0a61523` moved the CSS named-colour list to `keywords()` on the *shared*
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

1. **Survey parseman `0.32.0`'s full export surface from source** — not from
   recollection. `sepBy`, `keywords()` and `word()` have all been there the whole
   time and were not reached for; that is what produced the hand-rolled lists,
   the keyword regexes and the boundary guards. Read the CHANGELOG through
   0.36.0 too, but as a **"not available to us"** appendix (§5.1).
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

| § | status |
| --- | --- |
| 5.1 parseman version | **RESOLVED** — 0.36.0 measured and declined; the rebuild targets the pinned 0.32.0 and is not blocked on a bump |
| 5.2 the two 0.32.0 hazards | **not a blocker, a standing constraint** — check per unit |
| 5.3 P1 host-aware capture elision | **open** — take delivery or drop the dependency, before Unit 4 |
| 5.4 SCSS composing on Less | **open** — blocks Unit 5's `scss` step, and a one-line false comment blocks its `less` step |
| 5.5 `internal-css-recognition` rename | **sequenced last**, after the rebuild |

### 5.1 parseman stays at 0.32.0 — the rebuild targets the pinned version

> **This section previously said 0.36.0 adoption must land first. It was measured,
> and the answer was no.** The rebuild is **not** blocked on a parseman bump.

The repo pins **`0.32.0` exactly** (root + 5 package manifests;
`pnpm-lock.yaml:17276`). The invariant is that **compiled parser artifacts never
cross parseman versions** — a bump regenerates every artifact and rebaselines
every aggregate hash.

**The 0.36.0 adoption was measured and declined. jess could not reproduce
parseman's own −18.5%.**

*Correctness was fully clean* — **zero AST movement across 3,053 file-parses in
all four dialects**, four parser suites green, `all-less` 108/108, and
`check:macro` at 0 fallbacks on **both** versions. Nothing about correctness
motivated the decision.

*Less regresses.* `less/css-corpus` read **+7.8 / +11.9 / +10.8 / +10.7%** across
four runs and three independent harness designs, win-rate **2–4 out of 25**. The
other two Less workloads are genuinely ambiguous — −7…−9% cross-process against
+2…+5% single-process interleaved — and the measuring agent **declined to claim a
direction on them**, which is the correct outcome to record rather than a gap to
fill.

So the sequence is now settled by measurement rather than by argument:

| version | Less | evidence |
| --- | --- | --- |
| **0.34.0** | **regressed** | jess +10…25% (`a49ca59da`, P-9); parseman +32.5% on 0.33→0.34, cause found (the `not()` probe-leak fix's six unconditional `array.length` stores on a probe running ~600×/KB) |
| **0.35.0** | **improved, not to parity** | parseman's rollback-guard work; jess did not reach parity |
| **0.36.0** | **improves further, still net-negative on the sharpest case** | the numbers above |

**parseman's CHANGELOG claim that 0.35.0 is net-faster than 0.32.0 (−18.5% on
bootstrap and the jess corpus, 12/12 interleaved wins) is contradicted for jess's
Less grammar.** That is a finding worth carrying upstream, not a number to
discard — parseman measuring its own release on its own corpora is a different
fact from jess measuring it on four dialect grammars, and parseman's own
`not()`-per-KB figures (css 20 / jess 121 / less 599) predict exactly this kind of
per-dialect divergence.

> **jess stays pinned at `0.32.0` exactly** (root + 5 package manifests;
> `pnpm-lock.yaml:17276`). **The rebuild targets 0.32.0.** The residual
> investigation into the Less regression is deferred and is **not** a blocker on
> any unit.

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

| version | worktree | branch |
| --- | --- | --- |
| **0.32.0 — the pinned one** | `/Users/matthew/git/worktrees/parseman-0.32-alloc` | `release/0.32.0` |
| 0.36.0 | `/Users/matthew/git/worktrees/pm-036-bump` | `release/0.36.0-bump` |

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

### 5.2 Writing against 0.32.0 — what you have, and two hazards

**Almost nothing is lost by targeting 0.32.0.** The whole API delta to 0.36.0 is
**three** value exports — `peek`, `oneOrMoreSep`, `analyzeGatingRules` — plus
three types and the `parseman/run` subpath. Nothing was removed, and the
combinators the rebuild leans on all exist today.

| Need | 0.32.0 answer | lost vs 0.36.0 |
| --- | --- | --- |
| keyword regexes | `keywords()`, `word()`, `makeWord()` — **all present** | only `caseInsensitive` on `word()`, and the ASCII case-folding soundness fix |
| separated lists | `sepBy(item, sep)` — present | `{min,max}`, `trailing`, `oneOrMoreSep` |
| leading `not()` | **no `peek()`.** Restructure the rule so the discriminating terminal leads, rather than spelling `not(not(x))` — which reports first-set `any` and poisons the whole choice | `peek()` |
| gating analysis | `analyzeGating()` on a pre-`compose()` `rules()` map (§8.6). **The macro build's gating is blind at 0.32.0** | `analyzeGatingRules`, `resolveRef`, whole-map gating in `compileRuleMap` |
| scan hygiene | `scanTo`/`balanced` do **not** skip ambient trivia at 0.32.0 | 0.33.0's ambient scan-skip and `rules({ scanSkip })` |

**Two 0.32.0 hazards are now load-bearing and must be checked per unit.**

**(a) `{min, max}` does not exist — and it will not compile.** At 0.32.0 the
signatures take positional combinators only, no options object:
`many<T>(combinator)`, `oneOrMore<T>(combinator)`, `sepBy<T,S>(combinator, separator)`
(`parseman-0.32-alloc/src/combinators/repeat.ts:70`, `:122`, `:196`; the shipped
`dist/combinators/repeat.d.ts:2,3,5` matches, with no overloads). `min` is a
hardcoded literal on the def — `0` for `many` (`repeat.ts:76-77`), `1` for
`oneOrMore` (`:128-129`). `oneOrMoreSep` does not exist.

> **Correction to how this was briefed to the spec:** it is **not** a silent
> hazard. `many(x, { min: 1 })` is `TS2554: Expected 1 arguments, but got 2` — a
> hard compile error. At runtime the extra argument would be ignored and the
> combinator would stay nullable, but that code cannot get past `tsc`. Write it
> as "the 0.34.0 idiom will not compile", not as "it silently does nothing" —
> overstating a hazard as silent teaches agents to distrust the compiler.

The practical rule: **`oneOrMore(x)` *is* `many(x, {min:1})`.** Where a rebuilt
rule wants a non-nullable list, use `oneOrMore`. Nullability still matters for the
same reason 0.34.0 fixed it — a nullable arm kills the enclosing choice's dispatch
— and at 0.32.0 plain `sepBy` **is** nullable with no way to say otherwise. That
is a real constraint on rule shape, and where it forces an awkward construction,
record it as `blocked` with this as the reason. Zero of jess's 148 current
`many(`/`oneOrMore(`/`sepBy(` call sites pass an options object.

**(b) One gated arm disables `autoNot` for the *entire* choice — silently, and it
changes what the grammar accepts.** This one **is** silent. In
`src/combinators/choice.ts` at 0.32.0, `:21` computes
`hasGates = gates.some(g => g !== null)` — a single `{ gate, combinator }` arm
sets it for the whole choice — and `:55-57` then zeroes the autoNot table for
**every** arm index. `:51` additionally forces the plain ordered `firstMatch`
loop by suppressing `detectStrategy`, so `greedyClassify`,
`literalsLongestFirst` and `sharedPrefix` all go too.

**This is a semantics change, not a dispatch tweak**, by two independent routes:

1. **autoNot loss.** `computeAutoNot` is longest-match disambiguation: a
   successful short arm whose check fires is rolled back and skipped so a longer
   arm can win. Nulled, `choice(literal('and'), regex(/[a-z]+/))` consumes `and`
   out of `android` and leaves `roid` for the enclosing sequence — a different
   accepted language.
2. **`literalsLongestFirst` loss.** An all-literal choice is no longer sorted
   longest-first, so declaration order decides and a shorter literal listed first
   shadows a longer one.

There is **no warning, no diagnostic, and no error** on this path — `autoNot`
appears nowhere in any 0.32.0 analysis or diagnostic surface, and codegen reads
the already-nulled `def.autoNot` without comment.

> **The precise trigger condition, which is narrower than it first looks:**
> `autoNot` is only ever computed when the choice is **not** disjoint. So adding a
> gated arm to a genuinely disjoint choice loses nothing. **The hazard bites when
> a gated arm is added to a non-disjoint choice** — one relying on ordered or
> longest-match resolution among literal, or literal-vs-regex, arms.
> **Any such change requires a corpus differential (§8.3), not a perf
> measurement.**

jess has exactly **two** `{ gate, combinator }` arms today, both in
`simpleSelector` and both in believed-disjoint choices:
`packages/jess-parser/src/grammar.ts:210` and
`packages/scss-parser/src/grammar.ts:1230`. Neither currently loses anything.
`css-parser`, `less-parser` and all four AST grammars have none.

**Two things no version gives you**, unchanged through 0.36.0 — so these are not
reasons to want a bump:

- **Nothing replaces manual `optional(ws)` / `noTrivia`.** `trivia`, `noTrivia`
  and `parser({trivia})` are unchanged 0.32.0 → 0.36.0. `noTrivia` at 300 sites
  is the ambient mechanism, not an anti-pattern; the don't in §10.1 is about
  *hand-written whitespace beside it*.
- **No ident/boundary preset.** `keywords()` builds `(?![<boundary>])` from a
  plain character-class string, default `'_0-9A-Za-z'`. No `cssIdent`, no
  `followedBy`, no leading boundary. `word(str, boundary)` is the only lever and
  cannot express backslash escapes or non-ASCII ident code points. Filed as
  **P-3, P-4, P-8**; open at 0.36.0. So "no bespoke ident/boundary classes"
  (§10.1) is an *aspiration*: raise it upstream, do not fake it locally.

**`analyzeDuplication()`** is unreleased and `main`-only at any version. Not a
gate.

### 5.3 parseman host-aware capture elision — UNVERIFIED, in flight

Cited as "P1 host-aware capture elision, without which the unified CST is
silently lossy". **An agent is actively building it**, so treat this as work in
flight rather than a settled capability — and note that nothing about it is
readable from here yet.

What is verifiable as of `76680b114`: no "host-aware" or "capture elision" string
exists in parseman's `docs/` or `notes/`, nor in jess's `docs/`; the branch
`fix/host-aware-capture` sits at `be09b83` = `main` with **zero commits of its
own**. That is consistent with work living in an uncommitted worktree, which is
why this reads UNVERIFIED rather than absent. jess's own P-1 is a different item
(`composeLeaf` holes reported as `ungated` instead of `deferred`) — do not
conflate the two numbers.

The nearest committed work is 0.31.0's `_parsemanReadsChildren` children-array
elision and the `_hostReads(build, n)` arity probe discussed in
`pm-036-bump/notes/PERF_IDEAS.md` and `notes/CODEGEN-FAST-PATHS.md`
("arity-gated capture elision").

> **Action before Unit 4: take delivery from the P1 agent, or drop Unit 4's
> dependency on it.** If the delivery lands, read what it actually guarantees and
> write that into Unit 4. If the delivery reports that the elision is not
> achievable, drop the dependency and say so. **Unit 4 must not assume it in
> either direction** — neither "it will be there" nor "it does not exist" is a
> premise to build on.

### 5.4 SCSS composing on Less must be corrected

`packages/scss-parser/src/grammar.ts:30`:

```ts
export const scssGrammar = compose([lessGrammar, cssAstSyntax, rules({ trivia: rw }, (g: any) => {
```

This is **blocking Less-side cleanup**, not merely an SCSS correctness leak —
and as of `ac02c6e0b` that is **verified by building it**, not inferred.
`docs/architecture/parser/DIALECT-ARCHITECTURE-AND-ERROR-COVERAGE.md` records the
mechanism: because `scssGrammar = compose([lessGrammar, …])`, `lessGrammar` may
not itself become a non-final carried piece. Composing the shared recognition map
into the Less CST compiles fine in `less-parser`, and then `scss-parser` reports
`compose(): argument 0 isn't a build-resolvable grammar`. **So the Less CST
cannot reach the shared recognition surface at all while the inversion stands.**

First concrete casualty, named in that commit: the Less CST keeps a 150-name copy
of the CSS named-colour list that `5d0a61523` could not delete — and any other
CSS-recognition duplicate in the Less CST is stuck for the same reason. This is
why §2.3's remaining keyword regexes cluster where they do.

**The false comment is still in the tree.**
`packages/less-parser/src/grammar.ts:157` still reads "SCSS composes on the CSS
base, NOT on Less, so it never inherits this Less body", licensing Less-side edits
on a premise `ac02c6e0b` disproves 560 lines lower in the same file. Deleting it
is a one-line prerequisite for Unit 5, not a nicety.

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

**Read first.** `/Users/matthew/git/worktrees/parseman-0.32-alloc` (branch
`release/0.32.0`) — **`src/index.ts` and `src/combinators/`, not `dist/`**, which
is gitignored and stale there. Cross-check against the pinned artifact jess
actually compiles against,
`node_modules/.pnpm/parseman@0.32.0/node_modules/parseman`. Then §5.2 above,
which is a seed and must be checked against source.

**Method.** **The cheat sheet documents 0.32.0 — the version the rebuild
targets.** Read `src/index.ts` for the full export list, then the implementation
of anything the grammars will use. Then read
`/Users/matthew/git/worktrees/pm-036-bump/CHANGELOG.md` for 0.33.0 → 0.36.0 and
record the delta as a clearly-separated **"not available to us"** appendix — so
nobody writes a 0.34.0 idiom by mistake, and so the cost of staying pinned stays
visible. Version-stamp the result.

**Pass criteria.**
- Every value export of **0.32.0's** `src/index.ts` appears with a one-line "use
  it when" and at least one worked example.
- Each anti-pattern in §2.3 has a named 0.32.0 replacement, or an explicit "no
  replacement exists at 0.32.0" — distinguishing *never existed* from *exists
  only in a version we do not have*.
- **Both §5.2 hazards are stated with their trigger conditions**: `{min,max}`
  does not compile (and `oneOrMore(x)` is the substitute for `many(x,{min:1})`);
  and one gated arm zeroes `autoNot` across the whole choice, which only bites on
  a **non-disjoint** choice and needs a corpus differential when it does.
- The sheet is stamped with the parseman version **and the SHA it was read from**,
  and says plainly that `dist/` in that worktree is stale.
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
such. **jess stays pinned at 0.32.0.** Full record in §5.1.

**This unit is no longer a blocker on anything.** Units 3, 4 and 5 target 0.32.0.

**What remains, deferred and unassigned:** the residual Less regression. It is
concentrated in **Less parsing plain CSS**, which points at the ported CSS value
and selector productions inside the Less grammar — the duplication Unit 5 exists
to delete. **Hypothesis, not result** (§5.1). The useful next measurement is
after Unit 5's `less` step, not before it.

Still worth harvesting from the attempt: 0.34.0's gating fix surfaced **202
ungated choices and 28 anti-patterns** invisible at 0.32.0, where the macro
build's gating is blind. Those findings describe *our* grammars, not parseman's
version — feed the pre-`compose()` `rules()` map to 0.32.0's `analyzeGating`
(§8.6) and record the current set, as a set, during Unit 4. It does not need a
bump.

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
- **The rename mapping and the residue check are built as part of this unit**
  (§8.1b) — the oracle has no such API, and every later unit depends on it. The
  check must prove the residue is **empty**, not smaller; a tool that only shrinks
  the diff fails this criterion.
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
new name, and nothing maps to two.

**What the residue check has to prove:**

> After applying the declared mapping to the old tree, **the set of remaining
> differences is EMPTY.** Not smaller. Not "only renames left". Not a diff a human
> reads and judges acceptable. Empty, or the change has not been shown
> output-neutral.

This is stated because the obvious tool to build is the wrong one. A mapping tool
that merely *shrinks* the diff will always succeed — add enough mappings and any
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
   the tree (§2.3); "5 language-service failures" was wrong twice over (§8.4); and
   "the `internal-css-recognition` rename" (§5.5) describes a proposal that does
   not exist. **This document is not exempt.** Within one day of being written, its
   line count went stale by 6,858 lines, its keyword-regex count halved, and its
   "no ESLint rule applies to the eight grammar files" became false (§11). Re-run
   the commands in §2; do not quote the tables.
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
  `GRAMMAR-REVIEW-STANDARD.md` item 10 records this as *pending an owner ruling*
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
| Grammar ESLint rules | block comments only, no literal non-ASCII in regexes, no regex outside `regex()`, no macro hazards, expanded call form, comment shape | **LANDED on `dev`** (`516d10222`, `f18fc4e17`) at **error** — see below |
| `analyzeGating` (pre-`compose()` map) | ungated choices, `double-not` anti-pattern | **Usable at 0.32.0**, but the macro build's gating is **blind** — feed it the `rules()` map by hand (§8.6). `analyzeGatingRules` and whole-map gating need 0.34.0, which was declined (§5.1) |
| `analyzeDuplication()` | structural duplication/overlap, hand-rolled-`sepBy` detection | **Unreleased, parseman `main` only.** Not a gate |
| `parseman/oracle` | equivalence (§8.1) | **Unmerged.** PR #75 |

**This changed on `dev` within a day of being written, in the direction the spec
wanted.** `eslint.config.mjs:56-62` defines `GRAMMAR_FILES` as
`packages/{css,less,scss,jess}-parser/src/**/*.ts` plus
`packages/internal-css-recognition/src/**/*.ts` — glob-covering all eight files.
At **`error`**: `grammar/no-line-comments` (`:371`),
`grammar/no-literal-non-ascii-in-regex` (`:380`),
`grammar/no-regex-outside-combinator` (`:386`), `grammar/no-macro-hazards`
(`:394`), `@stylistic/function-paren-newline` (`:423`),
`@stylistic/function-call-argument-newline` (`:424`), plus repo-wide
`grammar/no-multiline-line-comments` (`:320`) and
`@stylistic/lines-around-comment` (`:330`).

So §8.2 item 2 now has a real floor, and checklist items 4 and 9 are mechanised
rather than reviewer-borne. Item 3 (prettiness) remains a judgement call by
design — §8.7.

**Three carve-outs a unit must know about**, none of which is visible from a green
`pnpm lint`:

- **`less-parser` is deferred** (`eslint.config.mjs:436-464`), explicitly because
  its grammars are being rewritten and reformatting underneath that pass would
  collide. Off for `packages/less-parser/src/**`: `grammar/no-line-comments`,
  `@stylistic/function-paren-newline`, `@stylistic/function-call-argument-newline`,
  `@stylistic/lines-around-comment`, and `grammar/no-literal-non-ascii-in-regex`.
  Outstanding at time of writing: 1403 + 276 + 103 + 21 violations, all
  autofixable. **The block says to delete it once that pass lands** — that is Unit
  5's `less` step, and deleting it is part of the step.
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
