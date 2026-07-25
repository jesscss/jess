# Grammar remediation plan

The single statement of **what happens to the eight grammar files, how it is
verified, and how it is reviewed**. The work is spread across several lanes; this
is the spine that orders them.

It is deliberately thin on things its siblings own. Read them there:

| Document | Owns | Status |
| --- | --- | --- |
| [`GRAMMAR-REVIEW-STANDARD.md`](./GRAMMAR-REVIEW-STANDARD.md) | The standing brief: the 13-item per-`const` checklist, the outcome vocabulary, the hard constraints, the propose/verify/measure/keep loop | **Written, not on `dev`** — lands via branch `grammar-review-standard` (`d4bd4a7bb`), with the `grammar-reviewer` agent at `.cursor/agents/grammar-reviewer.md` |
| `GRAMMAR-UNIFICATION-PLAN.md` (placeholder) | Track A: collapsing 8 files to 4 — the freeze/inventory, the adapter, the per-dialect migration order, the cleanup | **Not written.** No file at this path and no equivalent anywhere in `docs/` on any live branch as of `bcb3107a1` |
| [`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md`](./PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md) | The two pinned-version constraints that are load-bearing for every measurement below | On `dev` |

When the unification plan lands, replace the placeholder row with its real path
and delete the Track A summary in §2 in favour of a link.

Every count below was measured in-tree on **`bcb3107a1`, 2026-07-25**, with the
method stated. Counts drift; methods do not. Re-measure rather than quoting.

---

## 1. The problem

**Eight grammar files, 17,447 lines**, two hand-maintained specifications of the
same language per dialect with no mechanical link between them:

| dialect | CST `src/grammar.ts` | AST `src/ast/grammar.ts` |
| --- | --- | --- |
| `css-parser` | 800 | 2,173 |
| `less-parser` | 1,252 | 4,750 |
| `scss-parser` | 844 | 3,298 |
| `jess-parser` | 627 | 3,703 |

```sh
wc -l packages/{css,less,scss,jess}-parser/src/grammar.ts \
      packages/{css,less,scss,jess}-parser/src/ast/grammar.ts
```

The CST route feeds the language service and the editor; the AST route is what
`parse()` ships. Nothing keeps the two in agreement. That is the root cost, and
it has already been paid four times:

- **`${…}` shipped in the AST grammar and errored in the editor.** The Less AST
  grammar structures `${…}` inside quoted strings —
  `packages/less-parser/src/ast/grammar.ts:1629` defines
  `DirectLessPropertyInterpolation`, consumed by the quoted-string arms at
  `:1662`, `:1663`, `:1697`, `:1698`. The CST grammar does not:
  `packages/less-parser/src/grammar.ts:162` is `const strInterp = lessInterp;`
  — `@{…}` only — so `"${prop}"` never structures on the surface the editor
  reads. The comment at `packages/less-parser/src/grammar.ts:157` still says
  Less "may later add" the form that `:113` already defines.

- **`interpAccessorKey` is correct in the AST grammar and stale in the CST.**
  CST (`packages/less-parser/src/grammar.ts:106`) is one flat character class,
  `regex(/[-_a-zA-Z0-9@$-￿]+/)` — every key is an undifferentiated
  token. AST (`packages/less-parser/src/ast/grammar.ts:1541-1594`) is a
  four-arm choice of typed nodes distinguishing `index`, `var` and `prop` keys,
  including `[]` (`:1547`) which the `+`-quantified CST regex cannot match at
  all. Same syntax, two unrelated answers.

- **A CST-only production with zero coverage.** `DeferredScalarDeclaration`,
  `packages/less-parser/src/grammar.ts:531`, self-described in its own comment
  as an experimental POC. Its builder `_buildDeferredScalarDeclaration` no
  longer exists in the tree; the only surviving mention is a stale doc row at
  `docs/architecture/core/VALUE-NODE-MODEL-DESIGN.md:241`. No test references it.
  Note it is *not* unreachable — it is the first arm of `Declaration` at
  `packages/less-parser/src/grammar.ts:544`, so it silently shapes the CST for
  input as ordinary as `a: 10px;`, with no consumer and no coverage. That is
  worse than dead.

- **Terminal-level duplication that the shared package was supposed to prevent.**
  Below.

### The worklist as measured

The owner's standing worklist, recorded in `bcb3107a1`, is *20 near-clone
clusters, 14 separated lists, 18 leading-`not()` sites*, all scoped to
`less-parser`. Independent whole-corpus re-counts across all eight files, with
the exact method, follow. Where they differ from a figure quoted in the review
standard or in `bcb3107a1`, the difference is scope or criterion, not a
contradiction — and the standard already instructs re-counting rather than
quoting.

| Item | Brief's figure | Measured (8 files) | Method |
| --- | --- | --- | --- |
| Hand-rolled keyword regexes | 15 | **18** | `regex()` whose pattern is a pure alternation of literal words, i.e. `keywords()`/`word()` spelled by hand |
| Hand-rolled separated lists | 39 | **65**, of which **29** are a literal `sepBy` swap | `many(sequence(<separator terminal>, …))`; the 29 are those whose item combinator is textually identical on both sides |
| Spellings of one operator set | 7 | **7** exactly, plus **5** more for the overlapping Less guard superset | distinct source spellings of the mediaqueries-4 comparison set `< <= = >= >` |
| Near-clone clusters | 20 | **24** spanning ≥3 of the 8 files (69 span ≥2, 10 span ≥4) | normalise each `const X = node\|choice\|sequence(` name by stripping `Direct`/`Less`/`Scss`/`Jess`/`Css`/`Ast`/`Syntax`, then group |
| Leading `not()` | 18 | **43** | `sequence(not(` after whitespace flattening; css 2/less 3/scss 3/jess 0 CST, css 11/less 12/scss 5/jess 7 AST |

Supporting detail:

- parseman **does** expose `keywords()`/`word()`, and `less-parser`'s CST already
  uses them (`packages/less-parser/src/grammar.ts:399`, `:711`, `:815-817`,
  `:1118`, `:1132`, `:1157`, `:1189-1190`). The 18 are what remains.
- parseman **does** expose `sepBy(combinator, separator)`. It is used **12**
  times across the eight files — and **zero** times in the `jess` CST grammar or
  in any of the `less`/`scss`/`jess` AST grammars.
- The seven operator spellings are:
  `packages/css-parser/src/grammar.ts:722`;
  `packages/jess-parser/src/grammar.ts:287` (= `packages/jess-parser/src/ast/grammar.ts:1071`, `:1341`);
  `packages/jess-parser/src/grammar.ts:155`;
  `packages/jess-parser/src/ast/grammar.ts:1076`;
  `packages/scss-parser/src/grammar.ts:286`;
  `packages/scss-parser/src/ast/grammar.ts:2058`;
  and a hand-written JS predicate at `packages/css-parser/src/ast/grammar.ts:310`
  (= `packages/less-parser/src/ast/grammar.ts:3512`, `:3537`).
  `abe41f5bc` already cut the Less guard superset from 4 spellings to 2.
- The largest clone clusters are `combinator` (5 files), `important` (5),
  `Quoted` (5), `value` (5), `Declaration` (5), then `Stylesheet`,
  `simpleSelector`, `Ruleset`, `Call`, `AtRuleStatement` (4 each).

---

## 2. What we are going to do

Two tracks. They are not independent, and §2.3 is the part that decides
sequencing.

### 2.1 Track A — collapse 8 files to 4

**Planned. The plan document does not exist yet** (see the table above); this
section states only the shape agreed so far and is superseded the moment
`GRAMMAR-UNIFICATION-PLAN.md` lands.

One grammar per dialect instead of a CST/AST pair. The pair is the mechanism
behind three of the four concrete costs in §1; collapsing it removes the class,
not the instances.

Phase structure:

1. **Freeze and inventory** — record the oracle baseline (§3.1) and a per-`const`
   inventory of both files for the dialect, so a rule that disappears is a
   decision rather than an accident.
2. **Adapter** — a shape that lets the single grammar serve both the
   language-service surface and `parse()` before either caller changes.
3. **Per-dialect migration** — one dialect at a time, oracle-verified at each
   step.
4. **Cleanup** — delete the adapter and the retired file.

Order, smallest blast radius first, and the base before the thing that composes
on it:

| # | dialect | CST | AST | why here |
| --- | --- | --- | --- | --- |
| 1 | `jess` | 627 | 3,703 | leaf; nothing composes on it |
| 2 | `scss` | 844 | 3,298 | leaf (today it composes on `less` — see §6.2) |
| 3 | `css` | 800 | 2,173 | the base; everything downstream inherits the result |
| 4 | `less` | 1,252 | 4,750 | largest, most-depended-on, and the only one with an oracle |

Two facts make step 4 the hard one rather than the easy one: `less-parser` is
where the oracle lives (§3.1), and it is also where all the corpus pressure
lands (§6.1). Doing it last means the earlier steps have weaker verification —
say so in each step's report rather than implying otherwise.

### 2.2 Track B — per-rule remediation of what survives

The checklist is [`GRAMMAR-REVIEW-STANDARD.md`](./GRAMMAR-REVIEW-STANDARD.md)
§2, applied to **every `const`, not a sample**, with the four-outcome vocabulary
in §4 below. The conversion classes with a concrete worklist today are the five
rows of the §1 table:

- **near-clone clusters** — collapse onto one definition, or record why not;
- **convertible separated lists** — the 29 literal `sepBy` swaps first, the
  remaining 36 case by case;
- **leading-`not()` sites** — a leading `not()` widens the arm's first-set to
  `any` and drops the enclosing choice off first-char dispatch
  (`packages/less-parser/src/grammar.ts:527-528`);
- **hand-rolled keyword regexes** — `keywords()`/`word()`;
- **operator-set spellings** — one spelling, in the shared package.

`optional(literal(';'))` inside a declaration is a sixth class the standard
raises (item 10) and it is **blocked pending an owner ruling** — do not convert
it.

### 2.3 How the two tracks interact

**Remediating a rule that Track A is about to delete is waste, and worse, it
consumes the oracle budget that Track A needs.** The ordering rule:

1. A conversion class that is **cross-dialect** — the operator set, the keyword
   regexes, the near-clone clusters — is Track B work that *reduces* Track A's
   surface. Do it first; a clone collapsed before unification is one fewer rule
   to migrate twice.
2. A conversion class that is **local to one file's shape** — separated lists,
   leading `not()` — is done **after** that dialect's Track A migration, not
   before, because the migration rewrites the shape anyway.
3. Never run both tracks on the same dialect at the same time. Both are verified
   by the same aggregate hashes; two concurrent movers make the differential
   unattributable.

---

## 3. How it is verified

### 3.1 The AST/CST byte-identity oracle

`packages/less-parser/test/ast-identity-oracle.mjs` (landed `bcb3107a1`).

It parses **707 corpus files** through **both shipping surfaces** — `parse()`
from `lib/index.js` and `parseLessCst()` from `lib/cst.js` — hashes a key-sorted
cycle-safe projection of each result, and folds them into two aggregate hashes,
`aggAst` and `aggCst`. Baselines reproduced in `bcb3107a1`:
`aggAst 0aa9de8c9780273a…`, `aggCst d9fd8da52bf4bebb0…`, 707 files, 119 expected
AST throws.

- **Error cases are hashed.** A throw hashes as `ERR:${name}:${message}`, a
  success as `OK:${projection}`. A change that turns a hard error into a silent
  accept moves the aggregate. The `OK:`/`ERR:` prefix is load-bearing — dropping
  it while writing `bcb3107a1` silently changed every aggregate.
- **The untouched surface is a same-run control.** A grammar change touching one
  route should move neither aggregate; if the control moved, the run is invalid,
  not interesting.
- **It parses `lib/`, not `src/`** — the macro-compiled artifact is what ships.
  Rebuild between edits.
- **A change that moves either aggregate is a failed change, not a judgement
  call.**

Two things to state plainly rather than imply:

- **It is manual.** There is no `package.json` script and no CI wiring. Run
  `pnpm --filter @jesscss/less-parser build` then
  `node packages/less-parser/test/ast-identity-oracle.mjs out.json`. The script
  always exits 0; "failure" is you diffing before against after. Wiring it as a
  gate is unclaimed work.
- **It covers `less-parser` only.** There is no equivalent for the other three.
  Because `less` composes on `css` and `scss` composes on `less`, a `css` change
  is *partly* covered — state which surfaces you actually hashed.

### 3.2 `check-macro-buildable` — a correctness gate, not a speed gate

`scripts/check-macro-buildable.mjs`, wired as `pnpm run check:macro`, and run in
CI as `--no-build` (`scripts/verify-pr.mjs:94`,
`.github/workflows/pr-quality-gate.yml:78`). Blocking in both.

It walks every `.js` under `lib/` for the five packages in compose order and
counts `_rp[N].parse(` — the signature of a rule parseman could not compile,
left to run on the interpreter. **The threshold is exactly 0**; anything else
exits 1.

Why this guards correctness: **a macro-fallback build is not AST-equivalent to a
macro-compiled build.** Reproduced end to end in
[`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md`](./PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md)
§1 — a single hoisted module-level `const` made `compose()` non-statically
resolvable, parseman fell back to the interpreter, and **the CST aggregate
moved**; inlining the literal at each call site restored it byte-for-byte.

The consequence is the one that gets forgotten: **a red `check:macro`
invalidates any differential taken on that build.** Run it before you trust an
oracle number, not after. A green test suite does not clear a fallback — the
suite can pass on the interpreted tree while the shipped compiled tree differs.

This is also why the macro constraint (parameterless combinator `const`s and
plain reducers; no factories, no spread, no hoisted `const`s including plain
strings) is a correctness rule and not a style preference.

### 3.3 Corpus and suite gates

- **Four parser suites** —
  `pnpm --filter @jesscss/{css,less,scss,jess}-parser test`. `scss` and `jess`
  run with `--passWithNoTests`. No current per-suite pass counts are recorded
  anywhere in `docs/`; do not quote one. Capture your own as a named set.
- **`all-less`** — `pnpm run test:less:test-data`, the only fixture-backed Less
  integration authority. **108/108** measured 2026-07-24 on `e34bb24b3`
  (`docs/state/PROJECT_STATE.md:110`,
  `docs/architecture/core/HANDOFF.md:329-332`), 21 of which are active
  expected-failure checks. The number is meaningless without the less.js
  checkout SHA — less.js `dded69cc` moved it 108→106 with no jess-side change —
  and bogus on a partial workspace build.
- **The jess failing set, diffed as a SET.**
  `pnpm run verify:jess-suite-ratchet` → `scripts/vitest-ratchet.mjs` against
  the 15-entry baseline `packages/jess/test/known-failures.json`. It fails on
  three distinct conditions: a failure not in the baseline, a baseline entry
  that now passes, and a baseline entry that no longer exists. **A count cannot
  detect the second and third.** A missing JSON report is a hard failure, never
  a known failure.

### 3.4 Perf

Only if the change was motivated by cost. `packages/less-parser/test/ab-compare.mjs`
is the verdict harness and encodes the rules: **same worktree** (A = working
tree, B = `git show HEAD:` of the two grammar files), warmup then timed samples,
a full macro rebuild between every block, interleaved `B A B A` across rounds and
across processes, and it reports **median AND min AND spread AND A-win-rate**.
`packages/less-parser/test/parse-bench.mjs` is one measurement block, three
standing workloads, both surfaces — not a comparison on its own.

Its own header states the standard: **a single median is not a result.** The
untouched surface is the noise floor. A neutral result is a perfectly good
result — the gate for a grammar cleanup is §3.1 plus §3.3, not a speedup.

### 3.5 Definition of done

All four, each stated with evidence. **Not "tests pass."**

1. **diagnostic clean** — `pnpm run verify:types`, zero diagnostics in the files
   touched.
2. **lint clean** — `pnpm run lint`.
3. **oracle byte-identical** — both aggregates unchanged, quoted before and
   after.
4. **macro-buildable clean** — `pnpm run check:macro`, `0 interpreter fallbacks`.

A green test suite is context. It is none of these four.

---

## 4. How it is reviewed

The **`grammar-reviewer`** agent (`.cursor/agents/grammar-reviewer.md`, landing
via `grammar-review-standard`), **required before grammar changes land**.

It returns **evidence per checklist item, per `const`** — not a verdict, and not
a sample. Every `const` in the file gets exactly one of four outcomes:

| outcome | means |
| --- | --- |
| **conforms** | read, nothing to do. One line. "Conforms" is a claim that you read it, not a default. |
| **converted** | changed — cite the commit. |
| **blocked** | should change, can't yet — cite the *specific* reason (reducer stride, separator capture, AST movement, missing export). |
| **deliberate exception** | should not change — cite the justification. |

`blocked` and `deliberate exception` are the load-bearing ones: a documented
non-collapse stops the next agent re-proposing it. The two guard-operator
spellings left alone in `abe41f5bc` differ only in whitespace framing — a fact
that is worthless unless it is written down against those consts.

The exhaustiveness is the method. The failure mode it exists to prevent is an
agent reading linearly, pattern-matching locally, and stopping when the
immediate task looks done.

---

## 5. What is enforced mechanically

| Mechanism | Enforces | Status on `dev` (`bcb3107a1`) |
| --- | --- | --- |
| `pnpm run check:macro` | 0 interpreter fallbacks (§3.2) | **Landed and blocking** — root script, plus `--no-build` in `verify-pr.mjs` and the PR workflow |
| Grammar ESLint rules | comment shape, block comments only, no literal non-ASCII in regexes, no regex outside `regex()`, no macro hazards, expanded call form | **NOT on `dev`.** Branch `grammar-lint-rules` (`7c883f7f1`, local, unpushed) adds `scripts/eslint-rules/grammar-rules.mjs` at **error** across all eight grammar files plus `internal-css-recognition`, with `less-parser` layout and non-ASCII rules deferred behind a narrow dated block because its grammars are being rewritten concurrently |
| parseman duplication/overlap diagnostic | cross-rule duplication and first-set overlap | **Does not exist in this repo.** Not in any script, package, or workflow — neither blocking nor advisory. In flight upstream |

Today, **no ESLint rule applies to the eight grammar files.** The four local
rules in `scripts/eslint-rules/index.mjs` are all `warn` by explicit policy
(`eslint.config.mjs:263-268`) and are scoped to `packages/*/src/ast/**` or a
core hot-path allowlist; `eslint.config.mjs:320-321` states that grammar files
are out of their scope. The one grammar-shaped rule, `local/no-oversized-choice`,
is implemented and **deliberately unwired** (`eslint.config.mjs:305-316`).
`grammar-lint-rules` is the fix. Until it lands, items 3, 4 and 9 of the
checklist have no mechanical floor and are entirely reviewer-borne.

### The diagnostic's known defect — and its corrected form

The blanket claim in
[`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md`](./PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md)
§2 is that parseman's analysis cannot walk `compose()`d grammars —
`analyzeGating()` throws for 129 of 129 rules of the composed Less CST — and §2.2
projects that any future duplication or overlap diagnostic inherits the defect
and **silently reports nothing on exactly the four grammars that are supposed to
be parseman's reference implementation**.

[`GRAMMAR-REVIEW-STANDARD.md`](./GRAMMAR-REVIEW-STANDARD.md) §3 **supersedes the
blanket form**: the analysis surface *can* analyse these grammars when fed their
`rules()` map captured **before** `compose()`. It is the fused compiled artifact
that throws, and it now throws with an actionable message rather than reporting
empty.

The operative rule survives the correction intact, and it is the reason the
oracle exists at all:

> **Never read a clean or empty diagnostic obtained from the fused artifact as
> evidence that a grammar is clean.** Feed it the pre-`compose()` map, and say
> which you fed it.

parseman is pinned at **`0.32.0`** (exact, in the root and all five parser
packages; `pnpm-lock.yaml:17276`). A `0.34.0` bump is in flight. The standing
invariant is that **compiled parser artifacts never cross parseman versions** —
a version bump regenerates every artifact and rebaselines every aggregate in
§3.1.

---

## 6. Known structural causes

Addressing these is what stops the §1 costs recurring after the tracks finish.

### 6.1 `all-less` is the only real corpus gate, so all work pools into `less-parser`

`packages/jess/test/less/all-less.test.ts` is the only fixture-backed
integration authority, and `packages/less-parser/test/ast-identity-oracle.mjs`
is the only byte-identity oracle. Both are Less. The predictable result is that
`css`, `scss` and `jess` grammar work is verified more weakly than `less` work,
which is precisely backwards for `css-parser`, the base everything composes on.

Consequence for the plan: Track A step 3 (`css`) is the step with the widest
blast radius and the thinnest direct verification. Either extend the oracle to
`css-parser` first, or state explicitly in that step's report that its coverage
is indirect via the Less oracle.

### 6.2 SCSS composes on Less, not on the CSS base

`packages/scss-parser/src/grammar.ts:30`:

```ts
export const scssGrammar = compose([lessGrammar, cssAstSyntax, rules({ trivia: rw }, (g: any) => {
```

This contradicts the design, and it contradicts an assertion in the tree:
`packages/less-parser/src/grammar.ts:158-159` states "SCSS composes on the CSS
base, NOT on Less, so it never inherits this Less body." **That comment is
wrong.** SCSS inherits the whole Less CST, including the `@{…}`-only
string-interpolation seam from §1.

This is why `scss` is listed as a leaf in §2.1 with a caveat: it is a leaf in
the sense that nothing composes on it, but its own base is wrong. Rebasing it
onto CSS is tracked separately
(`docs/architecture/core/SCSS-PARSER-REBASE-DESIGN.md`) and is a prerequisite
for treating step 2 as independent of step 4.

### 6.3 The shared recognition surface is under-populated

`packages/internal-css-recognition` is **368 lines across 3 source files**,
publishing 4 exports and **89 rule keys, all pure terminals** — `cssAstSyntax`
(`src/recognition.ts:198`), `lessAstSyntax` (`:251`), `cssAstPseudoSyntax`
(`src/pseudo-consts.ts:46`), `opaqueAtRuleRecognition`
(`src/opaque-at-rule.ts:23`). It contains no structural productions.

Consumption is lopsided: all four **AST** grammars import it; of the four **CST**
grammars only `packages/scss-parser/src/grammar.ts:10` does. So it does not look
like the natural home for a CSS production, and the terminal-level duplication
of §1 — the 18 keyword regexes, the 7+5 operator spellings — persists in the
CST grammars that share nothing with it.

Populating it is the *destination* for the cross-dialect conversion classes in
§2.3 rule 1. A collapsed clone has to land somewhere, and this is the somewhere.
