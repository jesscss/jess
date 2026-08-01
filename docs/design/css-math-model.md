# The CSS math model — proposal

**Status: PROPOSAL. Nothing here is implemented.** It exists to be ruled on, and
to be attacked first. Written 2026-07-31 against `origin/dev` `a9f5d77c7`.

## 0. The defect, stated as an inversion

The CSS base grammar has a general math-expression ladder. It is called
`CalcValue` / `CalcProduct` / `CalcSum` / `CalcParen`, and it is reachable from
exactly three places — `CalcCall`, `CalcFunction`, `CalcParen`
(`packages/syntax/css/css-parser/src/grammar.ts:2123-2170`, `:2327-2339`,
`:1811-1820`). Jess ports the same five consts verbatim
(`packages/syntax/jess/jess-parser/src/grammar.ts:3254-3319`, port note at
`:14-22`).

So the base grammar says: **`calc()` owns arithmetic, and arithmetic exists
because `calc()` needs it.** That is backwards. `calc()` is not a function in any
executable sense — it computes nothing, it is a CSS spelling the parser detects
so that operations inside it are not folded away. Naming the general ladder after
it is the same category error as naming a value `DeclarationValue` because a
declaration happens to use one, and the grammar standard already forbids that
shape (`GRAMMAR-REVIEW-STANDARD.md` item 16, "Do not prefix a child with its
caller").

Two dialects already got this right and one did not:

| dialect | general math production | entered from | `calc()` special-cased? |
| --- | --- | --- | --- |
| SCSS | `MathSum` / `MathTopSum` | `Paren`, `MapEntry`, `ValueTail`, `ValueTerm`, at-rule preludes — a dozen sites | **no `calc` production exists at all** |
| Less | `MathSum` / `TopSum` | `Paren`, media features, **every function argument** | yes, but not the sole entrance |
| CSS | `CalcSum` | `CalcCall` / `CalcFunction` / `CalcParen` only | **yes — the sole owner** |
| Jess | `CalcSum` (ported) | `CalcFunction` / `CalcParen` only | **yes — the sole owner** |

`grep -n "'calc" packages/syntax/scss/scss-parser/src/grammar.ts` returns nothing.
SCSS is the existing proof that the base does not need a calc-shaped grammar.

### What it costs, measured

`a{width:calc(min(1em - 2px))}` is rejected by `css` and `jess`, accepted by
`less` and `scss` — the base rejecting what its own supersets accept. **110 of the
147 remaining superset violations** in the 18,245-entry external corpus are this
one construct (`test/css-corpus/README.md`; re-measured at `17b675065`).

The mechanism is one hop. `CalcValue`'s function arm is
`CalcIdentOrFunction = typedIdentOrFunction` (`grammar.ts:2445`), whose dispatch
routes `url(`/`calc(`/`var(` to dedicated tails and **everything else** glued to
`(` into `TypedGenericFunction` (`:2400-2408`), whose arguments are
`sepBy(TypedValueSequence, …)`. `TypedValue` (`:2521-2532`) has no operator arm,
so the `-` in `min(1em - 2px)` matches nothing and the enclosing `)` fails.

A corollary worth stating because it changes what "fixed" means: top-level
`min(1em - 2px)` *does* parse in `css` today — but only because the non-typed
`Value` ladder has a `PunctuationValue` arm that swallows the `-` as an opaque
byte. **CSS never builds an `Operation` for a nested math function, at any
position.** The construct is not recognised anywhere; it is only tolerated in one
of the two ladders. Widening `TypedValue` with the same punctuation arm would
clear all 110 corpus entries while recognising nothing — a green number over an
unchanged defect. This proposal rejects that option explicitly.

## 1. Which CSS functions allow a math expression

The open question in the ruling was whether `calc()` has company. It does.
css-values-4 §10 defines a closed set, and every member takes `<calc-sum>`
arguments:

| §10 | functions |
| --- | --- |
| §10.1 calc | `calc()` |
| §10.2 comparison | `min()`, `max()`, `clamp()` |
| §10.3 stepped-value | `round()`, `mod()`, `rem()` |
| §10.4 trigonometric | `sin()`, `cos()`, `tan()`, `asin()`, `acos()`, `atan()`, `atan2()` |
| §10.5 exponential | `pow()`, `sqrt()`, `hypot()`, `log()`, `exp()` |
| §10.6 sign-related | `abs()`, `sign()` |

css-values-5 adds `calc-size()`, `progress()`, `media-progress()`,
`container-progress()`, `random()`, and the argument-less `sibling-count()` /
`sibling-index()`.

`round()` additionally takes an optional leading `<rounding-strategy>` keyword
(`nearest | up | down | to-zero`), so the argument grammar is not uniformly
`<calc-sum>#` and the production must spell that arm.

**No such list exists in the repo today.** There is no `keywords()` table, no
registry, no constant. The string `'calc'` is spelled independently in five
layers: the four grammar dispatch tables, `tree/call.ts:265` `isCalcCall`,
`ast/serialize.ts:4647`, `ast/value-operate.ts:306` `CALC_WRAP_RE`, and
`tree/call.ts:1164`/`:2005`. Anything downstream that wants to ask "is this a
math function?" has to hardcode a string.

## 2. Proposal

### D1 — rename the family to what it is

`CalcValue` → `MathValue`, `CalcProduct` → `MathProduct`, `CalcSum` → `MathSum`,
`CalcParen` → `MathParen`, in `css` and `jess`. Converges on the spelling Less
and SCSS already use. `CalcCall` stays, because that one really is the `calc()`
call.

This is a rename with **no accept-set change and no AST movement** — the AST
node built is `funcCall('calc', …)` either way. It should land alone, so its
differential is provably inert and the next change starts from a clean base.

### D2 — the math-function set is spec data, in one place

One table, in `packages/parser-shared/`, holding §1's names with their argument
shapes. It is the only thing that decides which openers route to `MathSum`, and
it replaces five hardcoded `'calc'` strings with one import.

### D3 — routing: `calc()` stops being the entrance

In the base's ident-or-function dispatch, every name in the D2 table routes to a
`MathFunction` production whose arguments are comma-separated `MathSum` (plus
`round()`'s keyword arm). `calc(` loses its `cssCase` special case and becomes an
ordinary member of the table. Jess mirrors it, per its port note.

**This is an accept-set widening and nothing else, for the same reason the
`SquareValue` change was.** `foldOperation` (`grammar.ts:743-765`) returns the
lone operand when there are no operators, and `MathValue` projects to its single
child. So an argument containing no arithmetic reduces to exactly the node it
reduces to today; only arguments containing arithmetic — which currently fail to
parse — produce anything new. **This claim is the load-bearing one in the whole
proposal and is the first thing review should try to break.**

### D4 — the builtin-name collision is an EVAL question, and D3 does not touch it

13 of the §1 names are registered Less builtins (`abs`, `min`, `max`, `round`,
`mod`, `pow`, `sqrt`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`); 5 are
registered Sass globals (`abs`, `min`, `max`, `round`, `random`). Their
signatures are not the CSS ones — Less `round(x, 2)` is *decimal precision*,
CSS `round(strategy, a, b)` rounds to a step
(`packages/fns/src/less/round.ts:10`, `packages/fns/src/sass/math/round.ts:16`,
whose header says outright that Sass follows CSS here and Less does not).

That looks like a blocker and is not one, **if D3's widening claim holds**:
whether `min()` folds is decided by the registry at eval time
(`packages/core/src/ast/evaluator.ts:124-125`; `functionMode` only fires for a
*registered* name whose invocation failed), and D3 changes only how the
argument's *structure* is recognised. An argument that parses to the same node
reaches the same builtin with the same value.

What D3 *does* change is that arguments which previously failed to parse now
reach those builtins. `min(1em - 2px)` in `.less` currently parses via Less's own
`FunctionScalarArgument` → `MathSum` path, so Less is already there; the movement
is in `css` and `jess`. `.jess` has no registry at all (**P17**, SETTLED), so it
emits verbatim and cannot be affected semantically.

Existing pins that must not move: `packages/jess/test/min-max-dialect.test.ts`
(`.less`/`.scss` fold, `.jess` verbatim — pinned by `b5ae850a1`), and the
per-dialect registry disjointness in `packages/jess/test/dialect-builtins.test.ts`.

### D5 — `inCalc`: v1 stored it, v2 derives it, and the derivation is wrong

At `7b7d4e57c` this was a **parse-time flag on the node**:

```ts
export type OperationOptions = { inCalc: boolean }
// eval: if (inCalc) { resolve operands so variables substitute; return intact }
```

An `inCalc` operation never operated. Today v2 re-derives it from a walker
counter, and the derivation has a confirmed hole: `calcDepth` is **bumped at
exactly one site** (`ast/serialize.ts:4281`) and has **no decrement and no reset
site anywhere**. v1 had one (`tree/reference.ts:3301-3317` zeroes `calcFrames`,
and `tree/call.ts` pushes `false` for call arguments). So in v2, once a walk
enters `calc(…)`, every descendant `EvalCtx` — including unrelated nested call
arguments and variable-binding evaluations reached through `evalBinding` /
`resolveVarRef` — sees `calcDepth > 0`.

The polarity also inverted, which is worth recording because it means the two
engines are not merely differently-factored:

| | v1 (`tree/util/should-operate.ts:41-59`) | v2 (`ast/serialize.ts:3348`) |
| --- | --- | --- |
| in calc | short-circuits to **false** unless the unit pair is provably safe — calc SUPPRESSES | first disjunct is `calcDepth > 0` → **true** — calc FORCES, then `operate` declines |
| operands | inspected here | never read; the predicate is a pure function of depths, mode, and operator |
| parens | boolean **stack** — a frame can push `false` to close the context | monotone **counter**; nothing can close it |

The v2-shaped fix follows from the model's own rule rather than from porting v1.
v2's principle is that the AST owns structure and the evaluator owns policy
(`nodes.ts:211-222`, `serialize.ts:192-199`) — so an evaluation *decision* must
not live on a node. But "this operation was written inside a math function" is
not a decision, it is a **positional fact the parser knows for free and the
walker only approximates**. Storing the lossless fact and deriving the lossy one
is the standing rule (`memory:downstream-workaround-means-upstream-defect`).

Once D3 lands, the grammar knows this exactly. Proposal: an optional
`readonly inMath?: boolean` on `Operation`, precedented by `Block.boundary` and
`FunctionCall.modern`, initialized by the factory so the hidden class stays
stable. Named `inMath`, not `inCalc`, because after D3 the fact is "inside a math
function" and `min(100% - 30px)` must preserve exactly as `calc(100% - 30px)`
does.

Fallback if review rejects a node field: keep the walker counter but give it the
reset v1 had. That fixes the leak without fixing the derivation, and should be
recorded as debt rather than as the design.

### D6 — the preserve path is a real gap, named here and not solved

A math expression that cannot fold has, in v2, **no representation other than a
string**: it becomes a value-domain `Keyword` whose bytes are re-entered by regex
(`CALC_WRAP_RE`, `value-operate.ts:306`), and composition of two preserved calcs
proceeds by unwrap-and-rewrap. `Operation` has no `src` field, unlike every other
preserve-capable v2 value node (`Keyword`, `Color`, `Quoted`, `Dimension`, `Any`,
`Condition` all carry one), so every preserve path reconstructs with **normalized
single spaces** rather than replaying authored bytes.

Today that is mostly invisible because so little math parses. D3 makes far more
of it parse, so the gap gets proportionally larger. This proposal does **not**
solve it; it flags that D3 should not land without deciding whether `Operation`
gains a `src`.

## 3. Sequencing

Each step is separately reviewable, separately measurable, and separately
revertable:

1. **D1** rename — inert, differential must show zero movement.
2. **D2** the table — inert, replaces five hardcoded strings.
3. **D3** routing — the accept-set widening; clears the 110 entries. Differential
   must show movement **only** on entries that previously rejected, with a
   negative control.
4. **D6 decision** — does `Operation` carry `src`? Gate D5 on it.
5. **D5** `inMath` — the semantic change, and the only step that can move emitted
   CSS. Needs the semantics reviewer and its own corpus differential.

Steps 1–3 do not change emitted bytes for any input that parses today. Steps 4–5
can, and should not be bundled with them.

## 4. Open questions for the owner

1. **Does the base grammar recognise the values-5 set** (`calc-size()`,
   `progress()`, `random()`, `sibling-*()`), or only values-4 §10? They are less
   stable and `random()` collides with a Sass global.
2. **`round()`'s `<rounding-strategy>` keyword arm** — spell it in the base, or
   treat `round()` as ordinary until the strategy grammar is wanted?
3. **D5's home** — node field (`Operation.inMath`) or walker counter plus the
   missing reset?
4. **D6** — does `Operation` gain `src`, and if so is that a prerequisite for D3
   rather than a follow-up?
5. **Less's `MathSum` reaches every function argument** (`FunctionScalarArgument`,
   `less/grammar.ts:3001`), which is broader than §1's closed set. After D3, is
   that a Less addition that stays, or a divergence to converge?
