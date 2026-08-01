# The CSS math model — proposal, revision 2

> **SCOPE NARROWED 2026-08-01.** `packages/core/OPERATIONS.md` is the owner's
> canonical spec for math and comparison semantics, and
> `COMPARISON-AND-TRUTHINESS.md` §0 records how the three documents relate.
> **This document is now scoped to RECOGNITION only** — the CSS base grammar
> does not parse math-function arguments as math, so `calc(min(1em - 2px))` is
> rejected outright (110 of the 147 remaining corpus superset violations).
>
> Its semantic sections are superseded. In particular **D5 is subsumed**: it
> reconstructed, from AST v1 at `7b7d4e57c` and a commit message, the rule
> OPERATIONS.md states outright in rows `h3`/`h4` — inside a math function jess
> preserves authorship (`calc($val / 2)` → `calc(8px / 2)`) and `$( … )` is the
> explicit opt-in to fold (`calc($($val / 2))` → `4px`). The reconstruction was
> right; it is no longer the source. Read D5 for the *mechanism* evidence — the
> `calcDepth` binding leak, the hidden-class constraint, the fixture it moves —
> and OPERATIONS.md for what the answer is.
>
> D1/D2/D3 (naming, the math-function table, the argument grammar) stand: they
> are recognition, and nothing else in the set covers them.

**Status: PROPOSAL. Nothing here is implemented.** Revision 1 was reviewed by
four independent lenses (refutation, grammar standard, semantics, perf) and
**three of its five steps were wrong**. This revision records what they killed as
well as what survived, because the dead claims are the useful part: each one was
plausible, and each one is a trap the next reader would otherwise re-enter.

Written against `origin/dev` `a9f5d77c7`; measured at `17b675065`.

## 0. The defect, stated as an inversion

The CSS base grammar has a general math-expression ladder called `CalcValue` /
`CalcProduct` / `CalcSum` / `CalcParen`
(`packages/syntax/css/css-parser/src/grammar.ts:2124-2159`), reachable from
exactly three places — `CalcCall`, `CalcFunction`, `CalcParen`. Jess ports the
same five consts verbatim (`jess-parser/src/grammar.ts:3255-3319`).

So the base says: **`calc()` owns arithmetic, and arithmetic exists because
`calc()` needs it.** That is backwards. `calc()` computes nothing; it is a
spelling the parser detects so that operations inside it are not folded away.
Naming the general ladder after it is what `GRAMMAR-REVIEW-STANDARD.md` item 16
forbids ("do not prefix a child with its caller").

SCSS is the standing proof the base does not need a calc-shaped grammar:
`grep -n "'calc" scss-parser/src/grammar.ts` returns **nothing**, and math is an
ordinary value production reached from a dozen positions.

**Cost:** `a{width:calc(min(1em - 2px))}` is rejected by `css` and `jess`,
accepted by `less` and `scss` — the base rejecting what its supersets accept.
**110 of the 147 remaining superset violations** are this construct.

## 1. Which CSS functions allow a math expression

css-values-4 §10 defines a closed set, all taking `<calc-sum>` arguments:
`calc`; `min`, `max`, `clamp`; `round`, `mod`, `rem`; `sin`, `cos`, `tan`,
`asin`, `acos`, `atan`, `atan2`; `pow`, `sqrt`, `hypot`, `log`, `exp`; `abs`,
`sign`. css-values-5 adds `calc-size`, `progress`, `media-progress`,
`container-progress`, `random`, and the argument-less `sibling-count` /
`sibling-index`. `round()` also takes an optional leading `<rounding-strategy>`
keyword, so the argument grammar is not uniformly `<calc-sum>#`.

No such list exists in the repo. `'calc'` is spelled independently in **six**
places — the four grammar dispatch tables, `tree/call.ts:265`,
`ast/serialize.ts:4647`, `ast/value-operate.ts:306`, and, the one revision 1
missed, `genericFunctionIdentifier` (`css grammar.ts:864`), a regex negative
lookahead `(?!(?:calc|url|var)(?=\())` that is a hand-rolled copy of the dispatch
table, used at `:1785` and `:2077`.

## 2. What the reviews killed

### 2.1 D3 was NOT a pure widening — REFUTED

Revision 1 claimed that routing math-function arguments to `MathSum` was a pure
accept-set widening, because `foldOperation` returns the lone operand when there
are no operators. **That reasoning was about the fold and never looked at the
choice lists or the sequence layer above them.** Both diverge:

- **`CalcValue` lacks `UnicodeRange`**, which `TypedValue` has
  (`grammar.ts:2124-2136` vs `:2560-2571`). `min(U+0-7F)` parses today, would not
  after.
- **`CalcSum` has no space-separated-run derivation.** `TypedValueSequence`
  (`:2573-2599`) accepts a whitespace-joined run of values; `CalcSum` requires an
  operator between operands, and `calcSumPad` (`:852`) makes whitespace around
  `-`/`+` mandatory on both sides. Measured: **17 regressions in a 25-case
  battery**, including `min(1px 2px)`, `min(1px -2px)`, `clamp(1px 2px, 3px)`,
  `min(red blue)`, `min(var(--x) 1px)`, `min(calc(1px) 2px)` — all confirmed
  end-to-end through the compiler.
- **Bytes would move at step 3, not step 5.** `min(10px%3)` parses today as inert
  opaque bytes. Routed, it becomes `Operation('%', 10px, 3)`; `calcDepth` is
  bumped only for the name `calc` (`serialize.ts:4281`), so `shouldOperate`'s
  `parens-division` disjunct is satisfied and **it folds to a number**.
- **Separator capture is an extra obligation.** `TypedGenericFunction` ends in
  `withAuthoredSeparators(args, fields, …)`; `CalcCall`'s reducer takes no
  `fields`. Modelled on `CalcCall`, `min(1px ,2px)` loses its authored padding
  even where the node tree is identical.

`min(1px 2px)` is not valid CSS. That is irrelevant: **the parser accepts shapes,
not semantics**, it accepts this today, and narrowing it is a regression whatever
the spec says about the value.

**Consequence: the argument of a math function is not `<calc-sum>`. It is the
ordinary typed value sequence, extended so adjacent terms may be joined by a math
operator.** The deciding question is adjacency (**G24**), not a separate ladder.
Revision 2's D3 is rewritten on that basis.

### 2.2 D1 was not inert — the ladder is public CST

Measured directly: `parseCssCst('a{width:calc(1px + 2px * (3px - 1px))}')` yields
node types **`CalcCall CalcSum CalcProduct CalcValue CalcParen`**, and jess the
same. `nodesByGrammarType` is the public CST query. So D1 is a **public CST label
change in two dialects**, its `aggCst` differential *must* move, and revision 1's
"provably inert differential" would have made a moving hash read as a regression
— or a zero hash read as a pass from an instrument that never looked.

### 2.3 D2 could not be built as described — BLOCKED

Revision 1 proposed a shared table in `packages/parser-shared/` replacing "five
hardcoded strings with one import". Three of those five are in `packages/core`,
which **has no dependency on parser-shared** — and every parser asserts the
package is *absent* from its compiled artifact
(`expect(transformed?.code).not.toContain('@jesscss/parser-shared')`, four
separate gates). parser-shared exists only to be inlined away at macro time. The
payoff does not exist, and a name→argument-shape map is a runtime object, which
is neither a combinator nor macro-foldable.

### 2.4 D6 was refuted by a SETTLED ledger row

Revision 1 called the missing `Operation.src` a gap that should gate D3. **Ledger
F1 (SETTLED)** is dispositive: *"OPERATORS / SEPARATORS = SPACED … regardless of
source … They are separators, NOT values — the verbatim-value rule (V1) does NOT
govern them."* So `calc(1.0px+2em)` → `calc(1.0px + 2em)` is F1 executing, not a
defect, and an `Operation.src` replaying authored bytes would **violate F1**.

V1 is already honoured: the preserve path composes `left.bytes`/`right.bytes`
(`value-operate.ts:416`), which are the V1-verbatim operand bytes. Measured
identical in all three dialects: `calc(2PX + 1e3em)` → `calc(2PX + 1e3em)`.

**Open question 4 of revision 1 is closed: no, `Operation` does not gain `src`.**

The perf and semantics reviews appeared to conflict here — perf said "D6 must
gate D3", semantics said "D6 is a non-issue". They were describing different
things, and separating them is the actual finding:

- **`Operation.src` for formatting — dead.** F1 governs; nothing to fix.
- **Preserved math has no node at all — real, and it is a STRUCTURE problem, not
  a formatting one.** An unfoldable operation exits as
  `makeKeyword('calc(…)')` and is re-entered by
  `CALC_WRAP_RE = /^calc\(([\s\S]*)\)$/` (`value-operate.ts:306`) plus a
  hand-rolled paren scanner (`:322-340`). That is answering a structural question
  by scanning canonical text, and D3 multiplies traffic through it. It is the
  same family as the standing "parser owns structure, core never re-derives from
  bytes" rule.

The one genuine byte loss on the preserve path is neither: `calc(1px /* c */ +
2em)` → `calc(1px + 2em)` in all three dialects. F1 governs whitespace and says
nothing about comments. That is a trivia-placement item.

### 2.5 D5's hidden-class precedent was backwards

Revision 1 proposed `readonly inMathFunction?: boolean` on `Operation`, "precedented by
`Block.boundary` and `FunctionCall.modern`". Verified in
`packages/core/src/ast/nodes.ts:1358-1367`:

- `FunctionCall.modern` (`:236`) is **non-optional**, always written by the sole
  factory (`:1360`). **1 realized map.** Valid precedent.
- `Block.boundary` (`:256`) is **optional**, and the factories build three
  distinct literals (`:1363` two branches, `:1367`). **3 realized maps.**
  `Block.boundary` *is* an existing hidden-class split of exactly the kind this
  repo measured at 46% of CSS parse. Revision 1 cited its own counterexample.

`Operation` has **1 realized map** — one construction site repo-wide
(`nodes.ts:1359`). So the field is achievable at base=1 **only** if spelled
`readonly inMathFunction: boolean`, non-optional and factory-defaulted.

### 2.6 D4's `.jess` immunity claim was false

Revision 1 said `.jess` "has no registry at all (P17), so it emits verbatim and
cannot be affected semantically." **P17 removes the function registry; it says
nothing about arithmetic.** `.jess` already operates: `calc(2px * 3)` → `6px`.
Today `.jess` `min(1em - 2px)` is a parse error; after routing, the argument is an
`Operation` at `calcDepth === 0`, `shouldOperate` is true under parens-division,
and it **folds**. D3 moves `.jess` from parse error to a folded numeric — and
that lands squarely inside **OPEN P18** (where the CSS-superset guarantee stops
in `.jess`), answering it by accident.

The pin revision 1 named as protection, `packages/jess/test/min-max-dialect.test.ts`,
contains **no argument with an arithmetic operator** in any of its 22 entries. It
cannot move, and equally it pins nothing this touches.

## 3. Revised proposal

### D1 — rename to what it is, and delete the dead twins

`CalcValue` → `MathAtom`, `CalcProduct` → `MathProduct`, `CalcSum` → `MathSum`,
`CalcParen` → `Paren`, in `css` and `jess`.

Names taken from the dialects that already have them, not invented: Less spells
the operand `MathAtom` (`less grammar.ts:3271`) and the group `Paren` (`:3190`);
Less and SCSS agree exactly on `MathProduct`/`MathSum`. Revision 1's `MathValue`
and `MathParen` were a third spelling neither dialect uses.

Also in scope, all missed by revision 1:

- **Three dead consts.** `g.CalcCall`, `g.Url`, `g.Call` have **0 references
  each** (verified). The `'CalcCall'` *label* is public CST and must stay; the
  `CalcCall` const (`:2159`) is an unreachable twin of `CalcFunction` and should
  collapse via `routed(fallback)` — parseman 0.46 documents it for exactly this
  and it has zero uses in this repo — taking `calcOpen` (`:1141`) with it.
- **`CalcIdentOrFunction` (`:2483`) and `TypedIdentOrFunction` (`:2484`) are
  byte-identical aliases of the same combinator on consecutive lines** (verified),
  both in the rule-name union and the rules map. This is the exact duplication D1
  claims to fix, one line below the family it renames.
- jess's `isCalcOperator` (`:1296`) and `foldCalcOperation` (`:1307`), whose CSS
  counterpart is already plainly `foldOperation`.

**Restated honestly: AST byte-identical; CST grammar-type labels change on four
productions in two dialects; no accept-set change.** The differential must cover
CST, and there is no css differential script today — building one is part of D1,
not a precondition someone else supplies.

### D2 — one combinator const, in the grammar, not a shared data table

The math-function set becomes **one `keywords([...])`-style combinator const at
module scope in `recognition.ts`**, spelled the way `conditionalAtKeyword` and
`marginAtKeyword` already are: array inline as a combinator argument. That is the
only shape with precedent and the only one the macro constraint permits.

Core's three `'calc'` sites are **out of scope** — they stay literal, or move to
a separate plain constant in `packages/core`. Do not claim one import.

`genericFunctionIdentifier` (`css grammar.ts:864`) must be updated in the same
change or `min(` behaves differently in `Call`/query positions than in value
position.

### D3 — extend the argument grammar; do not replace it

**The math-function argument is `TypedValueSequence` with math.** Concretely: a
sequence of typed values where adjacent terms may be joined either by whitespace
(a space run, as today) or by a math operator (producing an `Operation`). This
preserves `UnicodeRange`, space runs, and separator capture — the three things
§2.1 showed a `MathSum` argument destroys — while adding arithmetic.

The operator-vs-space-run decision is **adjacency**, and **G24** already settles
how to spell it: never assert that trivia is present, assert that two tokens are
not adjacent. `1px -2px` is a space run of two dimensions; `1px - 2px` is
subtraction; that is the same distinction G24 states for `1 - 2` vs `1 -2`.

**Spelling is mandatory, not an implementation detail.** parseman compiles
`dispatch` to a linear `if / else if` chain with **each tail fully inlined**, and
the css `IdentOrFunction` tail is emitted **6 times** across the ast and cst
artifacts. Twenty separate `cssCase` arms would add roughly **1.4 MB** of
generated code across css+jess; **one multi-key arm** — `when()` accepts
`DispatchWhenKey = string | readonly string[]` (verified), and the artifact
already uses the form for five pseudo-selector keys — costs about **70 KB**.

- **MUST** be one multi-key `cssCase([...names], MathFunction)` whose tail is a
  `g.`-rule reference.
- **MUST NOT** be a `choice(MinFunction, MaxFunction, …)` of per-function
  productions — that is the shared-prefix re-parse shape the perf checklist
  names.
- CSS has **two** dispatch tables (`:2418`, `:2463`); jess one. Both css tables
  change, or the typed and non-typed ladders diverge further.

`%` is in `calcProductOperator` (`regex(/[*/%]/)`) and is **not** a css-values-4
calc operator. D3 must narrow it, or `min(10px%3)` starts folding (§2.1).

**Frequency, measured — this is why the spelling matters more than the ladder:**
non-`calc` math functions appear **0 times** in `packages/jess/benchmark/benchmark.css`,
**0 times** in bootstrap 5.3.8 dist, and **6 times** in `benchmark.less` (none
containing an operator). D3 pays a per-atom dispatch tax on every ident-shaped
value atom in every stylesheet — ≥1,501 dispatch entries per parse of
`benchmark.css` — to serve a construct that is nearly absent from the benchmark
corpora. The ladder itself is allocation-free for operator-free arguments
(`{project: 0}` and `foldOperation`'s single-operand return both check out), so
the dispatch chain is the entire cost.

### D5 — `inMathFunction` as a parse-time fact

At `7b7d4e57c` this was `OperationOptions.inCalc`, a parse-time flag on the node;
an `inCalc` operation resolved operands and returned intact. v2 re-derives it from
`calcDepth`, bumped at one site (`serialize.ts:4281`) with **no decrement and no
reset**.

**Correction to revision 1:** the leak is *subtree over-reach*, not an unbounded
leak. `EvalCtx` is threaded by value — `ce` is a fresh object, never mutated onto
`e` — so the depth does not escape the calc argument subtree. Verified:
`a { b: calc(1px + @a); c: @a; }` emits `3px` then `4px / 2`. The defect is that
a **variable binding evaluates in the use site's math context instead of its
own**, because `evalBinding` (`serialize.ts:2409`) forwards the caller's `e`.

That is invariant 1's prohibited shape — one binding, two spellings, decided by
use site:

```less
@var: 50vh/2;  a { b: @var; }             => b: 50vh / 2;
@var: 50vh/2;  a { c: calc(50% + @var); } => c: calc(50% + 25vh);
```

Spelled `readonly inMathFunction: boolean`, non-optional, factory-defaulted (§2.5). It is
also a **perf win**, unclaimed by revision 1: it deletes the 18-field
`{ ...e, calcDepth: … }` `EvalCtx` spread at `serialize.ts:4281` and five
`(e.calcDepth ?? 0)` reads.

**Three things D5 must own that revision 1 did not:**

1. **It moves a committed fixture.** `tests-unit/calc/calc.css:9-10` expects
   `calc(50% + (25vh - 20px))` twice; the `25vh` exists *only* because the leaked
   depth folded `50vh/2` inside `@var`'s binding. Under `inMathFunction` it becomes
   `calc(50% + (50vh / 2 - 20px))`. That requires the **O4** graduation
   procedure — create `tests-unit/calc/legacy/calc.css` holding the pre-change
   output with the **O5** header *first*, then update the top-level `.css`.
2. **The polarity divergence is undecided, not merely differently-factored.** For
   Dimension×Dimension, v1's `should-operate.ts:41-59` and v2's `calcSafe` are
   the same predicate. They diverge on non-Dimension operands: v1 returns false
   and preserves; v2 has already decided to operate, so it falls through into
   live arithmetic. Measured: `calc(#f00 + #001)` → `#ff0011` in v2, preserved in
   v1. Both engines are public surface. The D5 ruling must cover this class.
3. **`parenDepth` has the identical over-reach and the identical absent reset**
   (`serialize.ts:3348`). Fixing `calcDepth` alone is half a fix.

**The oracles corroborate the rule, and they disagree with each other.** Measured
against **dart-sass 1.101.0** and **lessc 4.6.3** directly (not jess's dialect
plugins, which are not oracles for either language):

| expression | dart-sass | lessc 4.x | jess `.scss` |
| --- | --- | --- | --- |
| `min(100% - 30px)` | **`min(100% - 30px)`** | `70%` | `70%` |
| `min(1em - 2px)` | **`min(1em - 2px)`** | `-1em` | `-1em` |
| `min(4px / 2)` | `2px` | `min(4px / 2)` | `2` |
| `calc(4px / 2)` | `2px` | `calc(4px / 2)` | `4px / 2` |
| `calc(1px + min(4px / 2))` | `3px` | preserved | `calc(1px + 2)` |

dart-sass has **one coherent rule**: divide where division is written, and
preserve when the units do not commensurate — `min(100% - 30px)` comes back
untouched, exactly as `calc(100% - 30px)` does. That IS the `inMathFunction`
rule, already shipping in the reference implementation. **Less 4.x is the
implementation that fabricates.**

So jess's `.scss` is wrong against its own oracle in four ways here: it copies
Less 4.x's `70%`/`-1em` fabrication, it drops the unit on `min(4px / 2)`, and it
does not divide inside `calc()` at all. Those are pre-existing SCSS defects, not
consequences of this proposal, but they are the reason the `70%` case must not be
described as "less and scss agree" — dart-sass does not agree, and it is the
oracle.

**Scope correction:** revision 1 promised `min(100% - 30px)` would preserve as
`calc(100% - 30px)` does. It cannot at the proposed scope — that expression
reaches math through Less's `FunctionScalarArgument` and SCSS's `MathTopSum`,
neither of which D3 touches, and both emit the fabricated `70%` today. Either
`inMathFunction` is set in **all four** grammars, or the promise comes out. (It should be
set in all four: `70%` where the same expression under `calc` preserves is one
value printing two ways.)

## 4. Sequencing

1. **D1** rename + dead-twin collapse — AST-identical, **CST-moving**; build the
   css differential here.
2. **D2** the combinator const — build-time only.
3. **D3** argument grammar — the accept-set widening. Differential must show
   movement only on previously-rejecting entries, **with a negative control**,
   and must separately show the 25-case battery from §2.1 does not regress.
4. **D5** `inMathFunction` — the semantic change, and the only step that moves emitted
   CSS. Needs its own ledger row, the O4/O5 fixture graduation, and the
   semantics reviewer.

D6 is **deleted**: `Operation.src` is refuted by F1. The surviving structural
residual (preserved math has no node; `CALC_WRAP_RE` re-derivation) is filed
separately and does not gate this work.

**No number from `postcss-oracle.mjs --bench` at n=3 can gate D3.** Predicted
effect ≈ +1.1% against a documented 12.9% cross-process bias. D3 needs a
same-commit null run establishing the real spread, and a **dead-arm negative
control** — add 20 arms that can never fire and confirm the harness reports the
predicted delta. If the control reads zero, the harness cannot see D3 and no
post-D3 number is evidence either way.

## 5. Governance — the finding under the finding

**No ledger row governs in-calc math semantics.** `grep -n "inCalc\|calcFrames"
docs/architecture/core/DESIGN-DECISIONS.md` → zero hits. The owner memory note
`tree-is-the-spec-for-math-semantics` cites **ledger P19** and
`docs/architecture/core/MATH-FRAME-PROTOCOL.md`. **P19 is the parseman
`balanced()` CST row**, and the doc **has never existed in git history**. Both
pointers are wrong.

The current v2 polarity was installed by `47bda0a1b`, justified in its commit
message as *"matching less.js Dimension.toColor"* plus *"Differential oracle:
operations-advanced DIFF->MATCH"* — a reference-implementation port and a green
differential, with no ledger row. Ledger **E1/E5/E6/E7** forbid both halves. It
shipped because no contradicting row existed to catch it.

So D5 cannot cite a SETTLED row, and must not pretend to be a defect fix. It
needs its own **OPEN** row, which must also retroactively settle what `47bda0a1b`
changed. The row that *does* support it and revision 1 failed to cite is **P1**:
*"Math mode … is a PARSE-TIME input."* Whether math happens is already settled as
parse-time; `Operation.inMathFunction` is the same axis.

Required ledger actions: a new OPEN row for in-math operation policy (stating the
rule over the construct, the operand classes including the undecided
colour/keyword case, and that a binding evaluates in its own math context); a row
or tracker entry for D3's dialect asymmetry; correction of the broken memory
pointers; and an owner decision on **P17 vs the valid-CSS-in-all-dialects rule**,
since `min(1px, 2px)` is valid CSS and emits three different ways today.

## 6. Open questions for the owner

1. Does the base recognise the values-5 set (`calc-size`, `progress`, `random`,
   `sibling-*`), or only values-4 §10?
2. Spell `round()`'s `<rounding-strategy>` keyword arm now, or treat `round()` as
   ordinary until wanted?
3. Is `inMathFunction` set in **all four** grammars (needed for the `min(100% - 30px)`
   promise), or only css+jess?
4. Does D5 also fix `parenDepth`, or is that a separate ruling?
5. Less's math reaches **every** function argument, broader than §1's closed set.
   After D3, does that stay as a Less addition or converge?

## 7. Defects found by the reviews, outside this proposal's scope

Each needs its own issue; none is caused by this work.

- **jess `.scss` diverges from dart-sass 1.101.0 on the whole slash family.**
  `min(4px / 2)` → `2` where dart-sass gives `2px`; `calc(4px / 2)` → `4px / 2`
  where dart-sass gives `2px`; `calc(1px + min(4px / 2))` → `calc(1px + 2)` where
  dart-sass gives `3px`. Not one dropped unit — jess's SCSS does not divide in
  these positions at all, and loses the unit when something else folds it. Cause
  is positional: `topProductOperator` (`scss grammar.ts:1095`) excludes `/`, and
  `Call` arguments use `MathTopSum`, so `/` is claimed by `ValueTail` as a list
  boundary. dart-sass divides there.
- **`ValueTail` (`scss grammar.ts:1876`) is a hand-rolled separated list.** It is
  not a separator combinator but a bespoke node returning a tagged object
  (`{ kind: 'space' | 'slash', value, separator }`, type at `:32`), conflating
  both boundaries and forcing `ValueTerm` to rebuild the grouping imperatively.
  The output is already right (`list(values, '/')`); the mechanism is the debt.
  jess-parser has the intended shape — a space group plus a slash-separated
  repetition. Whoever removes it must preserve BOTH the `list(values, '/')`
  output and the positional exclusion of `/` from `MathTopProduct`, or every
  `min(a / b)` silently changes meaning.
- **`.jess` rejects `calc(1.0px+2em)`** (no whitespace around the operator) while
  `.less` and `.scss` accept — valid CSS rejected by one dialect.
- **`min(100% - 30px)` → `70%`** in `.less` and jess `.scss` — fabricated output
  where the same expression under `calc` correctly preserves. This matches
  lessc 4.x and **contradicts dart-sass**, which preserves. Correct for `.less`
  (4.x compat), a defect for `.scss`.
- **`calc(1px /* c */ + 2em)` loses the comment** in all three dialects.
- **`foldOperation`** (`css grammar.ts:743`, `:749`) does `children.find(isValue)`
  then `children.indexOf(first)` — two scans of one array, collapsible to one
  pass.
- **Five `css` reducer crashes** share one cause: `valueSlotChildren` throws on an
  empty match instead of returning `[]`, so the `?? any('')` fallback its callers
  spell is unreachable. Tracked in `test/css-corpus/README.md`.
