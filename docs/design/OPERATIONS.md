# Operations — math, comparison, and truthiness

> **Status: the resolutions in §1 are the owner's settled model. Everything else
> is measurement, gap list, or open question.** Nothing in here is implemented.
>
> This document replaces three that used to cover the same ground and disagreed
> about who was authoritative: `packages/core/OPERATIONS.md` (owner-authored,
> and until 2026-08-01 not in version control), `docs/design/COMPARISON-AND-TRUTHINESS.md`,
> and the semantic half of `docs/design/css-math-model.md`.

## 1. The resolutions

1. **Remove `equalityMode` from Jess options.**
2. **Lower `.scss` / `.less` accordingly** — the dialect front end does the work,
   not a runtime mode switch.
3. **Add a double-equality operator to `.jess`** — `=` loose, `==` equal-to-type.
4. **Accept moderately breaking shifts** in Less / Sass+ behaviour.

Plus a structural note that turns out to be load-bearing: these comparisons
should be **function-based compare / operate primitives**, reused elsewhere —
notably Collection index lookup, where `$foo['1px']` matches a `1px` key
*because* lookup uses loose equality.

```jess
$foo: {
  [1px]: bar;  // 1px is a true dimension value
}
.a {
  foo: $foo['1px']; // bar, because we use loose equality
}
```

Two clarifications on that note, both owner, 2026-08-01, because both are easy
to misread:

- **"Function-based primitives" means CORE-INTERNAL functions**, not
  stylesheet-callable ones. Nothing here becomes invocable from a `.less` /
  `.scss` / `.jess` source file and no name enters any dialect's builtin
  registry — that would contradict ledger **P17** (`.jess` has no ambient
  builtin namespace) and add public API nobody asked for. These are TypeScript
  functions in `packages/core`, in the not-exported class `index.ts:4` already
  describes as "compare/cast/lookup machinery".
- **`packages/fns` should CONSUME them, not reimplement.** Core-internal does
  not mean core-only; `fns/` is an in-repo consumer and is expected to call the
  same functions wherever a builtin compares or operates on values. That is what
  makes "one set of semantics" true in practice rather than only in core.

**`.jess` compiles as `.jess`. There are no modes.** The engines' divergent
behaviours become expressible natively because `.jess` has *both* operators, and
each dialect's lowering names the right primitive.

## 2. Method

Every number in §3 is measured, not recalled:

- **dart-sass 1.101.0** (`sass` devDependency of `packages/jess`) via
  `sass.compileString`.
- **lessc 4.6.3** (root `less` devDependency) via `less.render`.

Truthiness was probed as `@if <expr>` in Sass and as a mixin guard
`.m() when (<expr>)` in Less, each Less result re-verified with a single-branch
guard emitting a marker declaration, so an *incomparable* operand shows as "no
rule emitted" rather than being folded into one side by a `not (…)` mirror.

Two corrections made during measurement, recorded because both would have
produced a wrong table:

- `1m` is **not a CSS unit**. `100cm == 1m` measures unknown-unit handling, not
  conversion. Real-unit cases (`1in`/`96px`, `100cm`/`1000mm`, `1s`/`1000ms`)
  were substituted.
- `nope()` is **not an error in Sass** — unknown functions pass through as plain
  CSS, so a short-circuit probe built on it proves nothing. `1px + 1em`
  (a genuine incompatible-units error) was substituted.

Both engines are already devDependencies; no new tooling is needed. Probe from
`packages/jess` so `sass` and `less` both resolve.

## 3. Measured behaviour

### 3.1 Truthiness — a bare operand in condition position

| operand | dart-sass | lessc 4.6.3 |
|---|---|---|
| `true` | truthy | truthy |
| `false` / `null` | falsy | falsy |
| `0` | **truthy** | falsy |
| `1` | **truthy** | falsy |
| `""` | **truthy** | falsy |
| `"a"` | truthy | **falsy** |
| `"false"` | truthy | falsy |
| `()` empty list | truthy | *parse error* |
| `(a: b)` map | truthy | *parse error* |
| `1px` | truthy | **falsy** |
| `red` | truthy | **falsy** |
| bare ident | truthy | **falsy** |

**Sass: everything is truthy except `false` and `null`. Less: nothing is truthy
except the literal keyword `true`.** Not two points on a scale — Less's rule is
a *byte* test, Sass's is a *type* test. Note `0` and `""` are truthy in Sass; it
is not JavaScript.

### 3.2 Equality

| expression | dart-sass | lessc 4.6.3 |
|---|---|---|
| `1 == 1`, `1px == 1px`, `1 == 1.0` | true | true |
| `1px == 1` | **false** | **true** |
| `1in == 96px`, `100cm == 1000mm`, `1s == 1000ms` | true | true |
| `1in == 2.54cm` | true | **false** |
| `1px == 1PX` | **false** | **true** |
| `1px == 1%`, `1foo == 1bar`, `1 == "1"` | false | false |
| `1foo == 1foo` | true | true |
| `a == "a"` | **true** | **false** |
| `A == a`, `"A" == "a"` | false | false |
| `#fff == white` | true | true |
| `null == false`, `0 == false`, `"" == false` | false | false |
| `(1 2) == (1 2)` | true | *parse error* |
| `(1, 2) == (1 2)` | **false** | *parse error* |
| `(a: 1) == (a: 1)` | true | *parse error* |

**Less and Sass diverge in OPPOSITE directions.** Less coerces **numbers**
(`1px == 1` ✓) but separates **text** by quoting (`a == "a"` ✗). Sass is the
reverse: unit-strict on numbers, quote-insensitive on text. Neither is
"stricter".

Two smaller facts: Less treats units **case-insensitively**, and Less gets
`1in == 2.54cm` **wrong** (equal by definition; Less's conversion loses
precision). Sass's list equality is **separator-sensitive**.

### 3.3 Relational

| expression | dart-sass | lessc 4.6.3 |
|---|---|---|
| `2 > 1`, `2px > 1px`, `2px > 1`, `1in > 1cm` | true | true |
| `2px > 1em` | **error** — incompatible units | **false** |
| `"b" > "a"` | **error** — undefined operation | **true** |
| `null > 1` | **error** — undefined operation | **false** |

**Where Sass raises, Less silently returns false.** A Less author cannot
distinguish "genuinely not greater" from "never comparable". This is the
clearest case in the document where one engine's behaviour is a defect rather
than a dialect.

### 3.4 Logical operators

Sass's `and` / `or` are **not boolean operators** — they return one of their
*operands*, like JS `&&` / `||`: `1 and 2` → `2`, `null and 2` → `null`,
`false and 2` → `false`, `1 or 2` → `1`, `null or 2` → `2`, `false or 2` → `2`;
`not 1` → `false`, `not null` → `true`, `not ""` → `false`.

And they **short-circuit**, proven with a genuine error term:

| expression | result |
|---|---|
| `1px + 1em` (sanity) | error: incompatible units |
| `false and (1px + 1em)` | `false` — **RHS never evaluated** |
| `true and (1px + 1em)` | error |
| `true or (1px + 1em)` | `true` — **RHS never evaluated** |
| `false or (1px + 1em)` | error |

Precedence is conventional: `not` > `and` > `or`. In Less, `and`/`or` appear
only in guards and yield a boolean.

### 3.5 Arithmetic — the source columns

Input (`.less` with `boolean(…)`, `.scss` with `==`, same expressions):

| | lessc 4.6.3 | dart-sass |
|---|---|---|
| `1 + 2` | `3` | `3` |
| `1 + 2px` / `1px + 2` | `3px` | `3px` |
| `1 * 2px` / `1px * 2` | `2px` | `2px` |
| `1px * 2px` | `2px` | `calc(2px * 1px)` |
| `1px * 10%` | `10px` | `calc(10px * 1%)` |
| `10% * 1px` | `10%` | `calc(10% * 1px)` |
| `(1px / 2)` | `0.5px` | `0.5px` |
| `(2px / 1px)` | `2px` | `2` |
| `(1 / 2px)` | `0.5px` | `calc(0.5 / 1px)` |
| `calc(2px / 1)` | `calc(2px / 1)` | `2px` |
| `calc(@val / 2)`, `@val: 8px` | `calc(8px / 2)` | `4px` |

Every cell of the Less and Sass columns was re-run against lessc 4.6.3 and
dart-sass 1.101.0: **all 32 Less rows and all 31 Sass rows reproduce exactly.**

Two facts the re-run surfaced:

- dart-sass emits a **`slash-div` deprecation** for the three `/` rows (division
  outside `calc()`, to be removed in Dart Sass 2.0). Sass+ is defining behaviour
  for forms deprecated upstream.
- `1px * 10%` is **reordered** by Sass to `calc(10px * 1%)`. The `.jess` target
  preserves authored order — a deliberate divergence.

### 3.6 Math functions are not `calc()`'s poor relation

Measured against the same two oracles, because it decides §4's arithmetic rows:

| expression | dart-sass | lessc 4.x |
|---|---|---|
| `min(100% - 30px)` | **`min(100% - 30px)`** | `70%` |
| `min(1em - 2px)` | **`min(1em - 2px)`** | `-1em` |
| `min(4px / 2)` | `2px` | `min(4px / 2)` |
| `calc(4px / 2)` | `2px` | `calc(4px / 2)` |

dart-sass has **one coherent rule**: divide where division is written, and
preserve when the units do not commensurate — `min(100% - 30px)` comes back
untouched, exactly as `calc(100% - 30px)` does. **Less 4.x is the
implementation that fabricates.** That preservation rule is what §4's `h3`/`h4`
rows state for `.jess`, arrived at independently.

## 4. The target — `.jess` expected

```jess
.a {
  a: $(1 + 2);        // 3
  b: $(1 + 2px);      // 3px
  c: $(1px + 2);      // 3px
  d: $(1 * 2px);      // 2px
  e: $(1px * 2);      // 2px
  f: $(1px * 2px);    // EVAL warning -> calc(1px * 2px)
  f2: $(1px * 10%);   // EVAL warning -> calc(1px * 10%)
  f3: $(10% * 1px);   // EVAL warning -> calc(10% * 1px)
  g: $(1px / 2);      // 0.5px
  g2: $(2px / 1px);   // 2
  h: $(1 / 2px);      // 0.5px
  $val: 8px;
  h3: calc($val / 2);      // calc(8px / 2) -- Jess respects more authorship
  h4: calc($($val / 2));   // 4px -- single values in calc() can be unwrapped
  i: $(1 = 2);        // false
  j: $(1 = 1px);      // true
  j1: $(1 == 1px);    // false
  j2: $(1em = 1px);   // false
  k: $(2 = 1px);      // false
  l: $(2 = 2%);       // true
  l1: $(2 == 2%);     // false
  m: $(1 > 2);        // false
  n: $(2 > 1);        // true
  o: $(1 > 1px);      // false
  p: $(1 >= 1px);     // true
  q: $(a = b);        // false
  r: $(a = "a");      // true -- Sass value-to-quoted comparisons lower to `=`
  r1: $(a == "a");    // false
  s: $(a = a);        // true
  t: $(a > b);        // false
  u: $(b > a);        // true  -- AMENDED, see §4.2; was `false`
  v: $(red = red);            // true
  w: $(black = transparent);  // false
  x: $(black = #000000);      // true
  y: $(black = #00000000);    // false
  z: $(black = #000000FF);    // true
}
```

### 4.1 The two operators

| expression | `.jess` `=` (loose) | `.jess` `==` (type-equal) |
|---|---|---|
| `1 = 1px` | true | false |
| `2 = 2%` | true | false |
| `a = "a"` | true | false |
| `a = a` | true | true |
| `black = #000000` | true | true |

`=` coerces across representations; `==` additionally requires the same type.

### 4.2 Relational on non-numbers — JS-like `toString()` comparison

**Owner ruling, 2026-08-01: `$(a > b)` and `$(b > a)` must not BOTH be false.
Relational on non-numeric operands does a JavaScript-like `toString()`
comparison.** This amends row `u` above from `false` to `true`.

The defect it fixes is non-trichotomy: with both false, an author cannot
distinguish "not greater" from "never comparable", and the condition quietly
takes the else branch either way.

Measured, and it shows Less is already half-way there and inconsistent about it:

| expression | dart-sass | lessc 4.6.3 | `.jess` target |
|---|---|---|---|
| `a > b` | **error** | false | false |
| `b > a` | **error** | **false** | **true** |
| `"b" > "a"` | **error** | true | true |
| `"a" > "b"` | **error** | false | false |

**Less already compares QUOTED strings lexicographically** (`"b" > "a"` → true)
and does not do it for bare idents — the same construct, two answers, decided by
quoting. Sass refuses the whole class with `Undefined operation`. The
`toString()` rule makes relational **total and trichotomous** over every operand
kind, which neither engine achieves.

Note equality is unaffected and already agrees across engines: `1px == red` and
`1px == "1px"` are false in both, with no error.

### 4.3 The math rule, stated over the construct

**An operation authored inside a CSS math function preserves its authorship; it
does not fold.** `calc($val / 2)` → `calc(8px / 2)`: operands resolve so
variables substitute, and the operation is returned intact. `$( … )` is the
explicit opt-in to fold, and a `calc()` whose sole argument folds to one value
unwraps (`h4` → `4px`).

This is exactly AST v1's model. At `7b7d4e57c` it was `OperationOptions.inCalc`,
a **parse-time flag on the Operation node**, and an `inCalc` operation never
operated. The name broadens with the rule: the fact is `inMathFunction`, because
after §6 it covers every css-values-4 §10 function, not only `calc()`.

## 5. Lowering — how dialects reach one set of semantics

### 5.1 Sass `==` cannot be lowered by operator substitution

Sass `==` is unit-strict on numbers (→ `.jess` `==`) and quote-insensitive on
text (→ `.jess` `=`). Neither `.jess` operator reproduces it alone, and for
`$a == $b` the operand types are unknown until eval, so a front end cannot pick.

**Owner ruling (2026-08-01): it lowers per operand — "sometimes `=`, other times
`==`". So the lowering target is a named PRIMITIVE that dispatches on operand
type at eval, not an operator.**

The architecture already has the right shape and needs one change of carrier.
`compare()` (`ast/value-guards.ts:187`) is that internal function today, and the
guard node `{ g: 'cmp', op, left, right }` already carries `op`. The comparison
KIND moves into the node the front end lowers to — `=` loose, `==` type-equal,
and a Sass-equality kind that dispatches — and the `equalityMode` parameter
threaded through `EvalModes` disappears. Same function, one more discriminated
`op`, no runtime flag.

"Lowering, not modes" therefore does **not** mean every dialect difference
resolves at parse time. It means the difference is carried by *what the lowered
node says*, rather than by a mode flag the evaluator reads from ambient config.
A primitive may still dispatch on operand type — that is its definition, not a
mode.

**Precedent already in the tree:** `.scss` lowers `==` → `=` and `!=` → `not(=)`
at parse time (`scss-parser/src/grammar.ts:3067-3087`).

### 5.2 Less does not escape the shift

Less is numbers-loose and text-strict (`a = "a"` → false); `.jess` `=` is loose
on both. Under one set of semantics Less's text comparison shifts false → true.
That is inside resolution 4's allowance, but it is a real `.less` output change,
and every fixture it moves needs the **O4** graduation — create
`legacy/<name>.css` holding the pre-change output with the **O5** header first,
then update the top-level `.css`.

## 6. Recognition — the grammar defect that blocks the rest

None of §4's math-function rows are reachable in `.jess` today, because the
argument never parses as math.

The CSS base grammar HAS a general math ladder — and reaches it only through
`calc()`. It is even *named* for `calc()`: `CalcValue` / `CalcProduct` /
`CalcSum` / `CalcParen` (`css-parser/src/grammar.ts:2124-2159`), ported verbatim
into jess (`jess-parser/src/grammar.ts:3255-3319`). That inverts the dependency:
`calc()` computes nothing; it is a spelling the parser detects so operations
inside it are not folded away. SCSS is the standing proof the base needs no
calc-shaped grammar — `grep "'calc" scss-parser/src/grammar.ts` returns nothing.

**Cost: `a{width:calc(min(1em - 2px))}` is rejected by `css` and `jess`, accepted
by `less` and `scss` — the base rejecting what its supersets accept. 110 of the
147 remaining external-corpus superset violations are this one construct.**

### 6.1 Which functions allow a math expression

css-values-4 §10 defines a closed set, all taking `<calc-sum>` arguments:
`calc`; `min`, `max`, `clamp`; `round`, `mod`, `rem`; `sin`, `cos`, `tan`,
`asin`, `acos`, `atan`, `atan2`; `pow`, `sqrt`, `hypot`, `log`, `exp`; `abs`,
`sign`. css-values-5 adds `calc-size`, `progress`, `media-progress`,
`container-progress`, `random`, and argument-less `sibling-count` /
`sibling-index`. `round()` also takes an optional leading `<rounding-strategy>`
keyword, so the argument grammar is not uniformly `<calc-sum>#`.

No such list exists in the repo. `'calc'` is spelled independently in **six**
places — four grammar dispatch tables, `tree/call.ts:265`,
`ast/serialize.ts:4647`, `ast/value-operate.ts:306`, and
`genericFunctionIdentifier` (`css grammar.ts:864`), a regex lookahead that is a
hand-rolled copy of the dispatch table.

### 6.2 The proposal, and what adversarial review killed

Four independent reviews (refutation, grammar standard, semantics, perf) ran
against an earlier draft. Three of five steps were wrong. The dead claims are
kept because each was plausible.

**Routing math-function arguments to a `<calc-sum>` ladder is NOT a pure
widening — REFUTED.** The reasoning looked at the fold (`foldOperation` returning
the lone operand) and never at the choice lists or the sequence layer:

- `CalcValue` lacks `UnicodeRange`, which `TypedValue` has. `min(U+0-7F)` parses
  today, would not after.
- `CalcSum` has **no space-separated-run derivation**. Measured: **17
  regressions in a 25-case battery**, including `min(1px 2px)`,
  `clamp(1px 2px, 3px)`, `min(red blue)`.
- Bytes would move: `min(10px%3)` is inert today; routed it becomes a real
  `Operation` at `calcDepth 0` and **folds**.
- `/` would move from the separator ladder to the division ladder, silently
  changing the meaning of every `min(a / b)`. In SCSS `topProductOperator`
  (`scss grammar.ts:1095`) excludes `/` and `ValueTail` claims it as a list
  boundary — that pairing is *why* `min(4px / 2)` is a slash value there.

`min(1px 2px)` is not valid CSS. Irrelevant: **the parser accepts shapes, not
semantics**, it accepts this today, and narrowing it is a regression.

**So the argument of a math function is the ordinary typed value sequence,
extended so adjacent terms may be joined by a math operator.** The deciding
question is adjacency — ledger **G24** already settles how to spell it.

Other corrections: renaming `Calc*` is **not inert** (all five are public CST
node types, measured); a shared table cannot live in `parser-shared` (private,
macro-only, asserted absent from every compiled artifact by four gates);
`Operation.src` is **refuted by ledger F1**, which makes normalized operator
spacing correct.

### 6.3 Spelling is mandatory, not an implementation detail

parseman compiles `dispatch` to a linear `if / else if` chain with **each tail
fully inlined**, and the css `IdentOrFunction` tail is emitted **6 times** across
artifacts. Twenty separate `cssCase` arms would add roughly **1.4 MB** of
generated code across css+jess; **one multi-key arm** — `when()` accepts
`DispatchWhenKey = string | readonly string[]` — costs about **70 KB**.

- **MUST** be one multi-key `cssCase([...names], MathFunction)` whose tail is a
  `g.`-rule reference.
- **MUST NOT** be a `choice(MinFunction, MaxFunction, …)`.
- CSS has **two** dispatch tables; both change, or the typed and non-typed
  ladders diverge further.
- `%` is in `calcProductOperator` and is **not** a css-values-4 calc operator.

**Frequency, measured:** non-`calc` math functions appear **0 times** in
`benchmark.css`, **0 times** in bootstrap 5.3.8 dist, and **6 times** in
`benchmark.less`. The dispatch tax is paid on every ident-shaped value atom in
every stylesheet (≥1,501 entries per parse of `benchmark.css`) to serve a
construct nearly absent from the benchmark corpora. Predicted effect ≈ **+1.1%**
against a documented **12.9%** cross-process bias — so **no n=3 bench number can
gate this**. It needs a same-commit null run and a dead-arm negative control.

## 7. What jess does today — the gap list

Measured 2026-08-01 at `62c9a4ef1`.

### 7.1 Comparison — 22 of 22 rows fail, for ONE cause

`$(1 = 2)` emits `1 = 2`, not `false`. The jess grammar builds a `Condition`
carrying both a real `GuardNode` and a verbatim `src`
(`jess-parser/src/grammar.ts:1974-1998`). Serialize has two lanes, and the value
lane wins for a declaration value:

- typed lane, `serialize.ts:3019` — `evalGuard(...)` → `makeBool`. Evaluates.
- value lane, `serialize.ts:3323` — `return literal(node.src)`. Verbatim.

The value lane's comment states its premise: the logical fns read a condition's
guard directly, "so a `Condition` reaching this value lane is an UN-consumed
condition" — a mis-parse, e.g. `url(…charset=utf-8…)`. **That premise holds for
Less and Sass, where a comparison only ever appears inside `boolean()`, `if()`,
or a guard. It is false for `.jess`**, which by ledger P17 has no `boolean()` at
all, so `$( … )` is exactly where a comparison legitimately lands.

`Block.boundary` already marks `$( … )` and is the obvious discriminator for
keeping the mis-parse recovery while letting real comparisons evaluate.

**`==` does not parse at all.** The three jess operator regexes
(`grammar.ts:1456`, `:1464`, `:2012`) are each `/>=|<=|>|<|=/`.

**No `.jess` comparison assertion exists anywhere in the suite**, which is why a
22/22 failure went unnoticed.

### 7.2 Math — 6 of 9

| row | got | want |
|---|---|---|
| `calc($val / 2)` | `8px / 2` — wrapper dropped | `calc(8px / 2)` |
| `calc(2px * 3)` | `6px` — folds | `calc(2px * 3)` |
| `$(1px * 2px)` | `2px` | `calc(1px * 2px)` |
| `$(1px * 10%)` | `10px` | `calc(1px * 10%)` |
| `$(2px / 1px)` | `2px` | `2` |
| `min(100% - 30px)` | *parse error* | `min(100% - 30px)` |
| `calc($($val / 2))` | `4px` | ✓ |
| `$(1px / 2)`, `$(1 / 2px)` | `0.5px` | ✓ |

The polarity is inverted against §4.2: v2 treats `calcDepth > 0` as FORCING
operation and lets `value-operate` decline, where v1 treated in-calc as
SUPPRESSING unless units are provably safe.

### 7.3 The code surface

**Comparison is ONE live primitive with mode branches** — not N implementations.

- Live: `compare()` at **`ast/value-guards.ts:187`**, reached via
  `ValueEvaluator.compare` (`value-eval.ts:463`) → `evaluator.ts:129` →
  `guard.ts:105`. Every dialect's guard, `@if`, `when(...)`, and logical-fn
  condition funnels through it. Its three branches: `:31-36` (unitless↔unit
  coercion), `:112-118` (sass quote-insensitive), `:119-124` (less cross-kind
  byte equality). `'exact'` is not a branch — it is defined by matching none.
- **Dormant duplicate**: `tree/condition.ts` `compareUnder`. `index.ts:4` says
  the old tree classes are intentionally not exported. Readable as a
  specification; **not** the code that runs, and not the code to edit. (Earlier
  drafts of this document named it as the live one. They were wrong.)

`equalityMode` is read or defaulted at `config/src/options.ts:12,32,199`,
`core/src/context.ts:252,274,400`, `ast/evaluator.ts:129`, `value-eval.ts:302`,
`jess-plugin-less/src/index.ts:32,331,401`, `jess-plugin-scss/src/index.ts:52,67`.
`.jess` sets none and runs at the `'less'` fallthrough.
`value-collection.ts:35,56` defaults to `'sass'` — an inconsistency the mode's
removal deletes.

**`fns/` conformance: one conformer, two bypasses.**

| site | file:line | state |
|---|---|---|
| Sass map fns | `value-collection.ts:38` → `compare('=', …)` | **conforms** |
| Sass `min`/`max` | `fns/src/sass/math/compare.ts:26` | **bypass** — second numeric comparison |
| `.jess` / Less bracket lookup | `serialize.ts:4149-4152`, `Map<string, DeclEntry>` | **bypass** — BYTE identity |

The lookup bypass is the case §1 names by example: `$foo['1px']` works today
only by byte coincidence and would fail for `$foo[1px]` against a `'1px'` key.
Converting it is a fast-path-plus-fallback, not a replacement — a compare scan
is O(n) on a hot path.

**Truthiness has no mode at all.** `guard.ts`, `'truth'`:

```ts
const test = (v: ValueGroup): boolean => emitValue(v).trim() === 'true';
```

Less-only, and it decides a semantic question by **serializing the value and
string-matching the bytes** — exactly what the architecture forbids elsewhere.
Even keeping Less semantics, this should be a typed test.

**Logical operators do not short-circuit.** `evalGuard`'s `and`/`or` evaluate
both operands unconditionally. Defensible for Less; **observably wrong for
Sass**, where `false and (1px + 1em)` must not raise.

## 8. Open questions

### Blocking

- **O-TRUTH-1 — truthiness is not covered by §1 at all.** §1 settles comparison
  and arithmetic but never says what `@if $x` / `when ($x)` means for a bare
  non-boolean operand. This is the largest SCSS corpus blocker — 29 of 92
  Bootstrap files, 42 of 109 failures across bourbon / foundation-sites /
  include-media — and the reason the grammar deliberately withholds bare-truthy
  `@if` (`scss-parser/src/grammar.ts`, `IfAtom`). **Widening the grammar alone
  would not fail; it would silently take the wrong branch and emit wrong CSS.**
  Does `.jess` make a bare non-Boolean an **error** (it has a type system, and
  `@if 0` taking the true branch is a footgun), or adopt Sass truthiness? Sass+
  separately needs Sass truthiness to run real code, which under "no modes"
  means the **lowering** injects the coercion.

### Semantics needing a `.jess` answer

- **O-TRUTH-6 — RESOLVED (owner, 2026-08-01).** Relational on non-numeric
  operands is a JS-like `toString()` comparison; `$(b > a)` is **true**. See
  §4.2, which amends the target table.

- **O-TRUTH-11 (new, owner-requested) — should a cross-TYPE comparison error?**
  §4.2 settles text-vs-text. It does not settle `1px > red`. Measured:

  | expression | dart-sass | lessc 4.6.3 |
  |---|---|---|
  | `1px > red` / `red > 1px` | **error** — Undefined operation | false |
  | `red > blue` | **error** | false |
  | `true > false` | **error** | false |
  | `1px > null` | **error** | false |
  | `1px == red` | false | false |
  | `1px == "1px"` | false | false |

  A pure `toString()` rule answers these without erroring — `red > 1px` becomes
  `"red" > "1px"` → true — and is what §4.2 literally says. But comparing a
  dimension to a colour is almost certainly an author mistake, `.jess` has a
  type system, and Sass refuses the whole class. The two readings diverge:

  - **toString everywhere** — total, trichotomous, never raises, one rule. But
    `1px > red` silently answers, and the answer is meaningless.
  - **toString within a comparable kind, error across kinds** — keeps §4.2 for
    text and numbers, raises on dimension-vs-colour the way Sass does. Needs a
    definition of "kind" and makes relational partial again, though it fails
    LOUDLY rather than silently, which is the property §3.3 says Less lacks.

  Equality is not in question either way: both engines already return false for
  cross-type equality without erroring, and `.jess` should keep that.
- **O-TRUTH-2** — `and`/`or`: Sass returns an **operand** and **short-circuits**.
  Operand-returning is more expressive (`$x: $a or $default`) but makes the
  result type depend on inputs. Short-circuiting should land regardless —
  required for Sass, unobservable in Less.
- **O-TRUTH-7** — `g2: $(2px / 1px)` → `2` cancels units (Sass), but
  `h: $(1 / 2px)` → `0.5px` drops the inverse unit (Less). Dimensionally
  inconsistent: if units cancel in `g2`, `1 / 2px` should carry `px⁻¹`, which is
  what Sass's `calc(0.5 / 1px)` expresses. Is `0.5px` intended?
- **O-TRUTH-3** — Less's `1in = 2.54cm` → false is a precision bug; Sass says
  true. Does `.less` lowering reproduce the bug for byte-identity? Same for
  `1px = 1PX` (Less true, Sass false).
- **O-TRUTH-4** — Sass list equality is separator-sensitive. Does the native
  Collection model preserve separator identity? Interacts with index lookup,
  which is specified as loose.
- **O-TRUTH-8** — `null` is unaddressed: `null == false` is false in both
  engines, `1 + null` → `1` in Sass, and a `null` value **drops the
  declaration**.

### Recognition (§6)

- Does the base recognise the values-5 set, or only values-4 §10?
- Spell `round()`'s `<rounding-strategy>` arm now, or later?
- Is `inMathFunction` set in **all four** grammars? It must be, or
  `min(100% - 30px)` → `70%` survives in `.less`/`.scss`, which reach math
  through their own ladders.
- Does the fix also cover `parenDepth`, which has the identical over-reach and
  the identical absent reset?
- Less's math reaches **every** function argument, broader than §6.1's closed
  set. Stays, or converges?

### Editorial

- **O-TRUTH-9** — §4's `h4: calc($(val / 2))` is missing a sigil; presumably
  `$($val / 2)`.
- **O-TRUTH-10** — `h3` diverges from Sass, which folds to `4px`. Confirm this
  is inside resolution 4's allowance for Sass+, since real Sass code relies on
  the fold.

## 9. Consequences for the code as it stands

- `EqualityMode` (`core/src/types/modes.ts`) is **slated for removal** under
  resolution 1. Its three behaviours become the named primitives each front end
  lowers to (§5.1). The live specification is `value-guards.ts:31-36`,
  `:112-118`, `:119-124`. **It should not be extended in the meantime.**
- `guard.ts`'s `'truth'` node should become a typed test whatever O-TRUTH-1
  resolves to.
- `evalGuard`'s `and`/`or` need short-circuiting before Sass+ can be correct.
- The `Condition` value lane (`serialize.ts:3323`) needs a discriminator other
  than "reached the value lane" (§7.1).
- v2's `calcDepth` is bumped at one site (`serialize.ts:4281`) and has **no
  decrement and no reset**, where v1 had one (`tree/reference.ts:3301-3317`). A
  variable binding therefore evaluates in the *use site's* math context rather
  than its own: `@var: 50vh/2` prints `50vh / 2` bare and `25vh` inside `calc`.
  One binding, two spellings. Fixing it **moves a committed fixture** —
  `tests-unit/calc/calc.css:9-10` — which needs O4/O5 graduation.
- An `inMathFunction` field on `Operation` must be spelled **non-optional**,
  factory-defaulted, matching `FunctionCall.modern`. `Block.boundary` is NOT the
  precedent to copy: it realizes three hidden classes.

## 10. The plan

Ordered so that each phase is separately reviewable, separately measurable, and
separately revertable. **Phases 1–3 are unblocked today. Phase 4 needs
O-TRUTH-1; phase 5 needs O-TRUTH-11.**

Every phase that can move emitted CSS carries the O4/O5 fixture graduation and a
`Perf-AB` trailer, per the grammar review standard.

### Phase 0 — the net (unblocked, do first)

There is **no `.jess` comparison assertion anywhere in the suite** (§7.1), which
is why 22/22 went unnoticed. Land the §4 table as an executable test *before*
touching semantics, with every row marked pending where it fails. That converts
this document into a ratchet and makes every later phase measurable.

### Phase 1 — make `.jess` comparison evaluate (unblocked)

One cause, one site: the `Condition` value lane (`serialize.ts:3323`). Evaluate
when `e.ev` is present; keep `literal(node.src)` as the `!e.ev` fallback; give
the mis-parse recovery a discriminator other than "reached the value lane" —
`Block.boundary` already marks `$( … )`.

Closes most of §7.1's 22 rows on its own. Cannot move `.less`/`.scss` output,
because in those dialects a `Condition` only reaches the value lane in the
mis-parse case the comment describes. **That makes it the safest first cut.**

### Phase 2 — add `==` to `.jess` (unblocked)

Three operator regexes (`grammar.ts:1456`, `:1464`, `:2012`) gain `==`; the
guard node carries the new comparison kind; `compare()` gains the arm. Additive
to the grammar — `==` is currently a parse error, so nothing that parses today
changes meaning. Touches `operator-adjacency.test.ts`'s assumptions.

### Phase 3 — relational becomes trichotomous (unblocked, §4.2)

`toString()` comparison for non-numeric relational. Moves `.less` output:
`b > a` false → true, and any guard that depended on the silent false. Fixture
graduation required. Independent of phases 1–2.

### Phase 4 — collapse `equalityMode` into lowered primitives

The mechanical shape is small (§5.1): the comparison KIND moves into the guard
node's existing `op`, `compare()` loses its mode parameter, and the ~12 read
sites in §7.3 go with it. What makes it phase 4 rather than phase 1 is that it
changes `.less` and `.scss` output together — Less's `a = "a"` shifts false →
true (§5.2) — so it wants phases 0–3's net in place first.

Do the two `fns/` bypasses in the same phase, since they are the same
"one set of semantics" claim: Sass `min`/`max`'s private numeric comparison, and
the bracket-lookup byte-identity `Map` (fast path plus `compare` fallback — a
scan is O(n) on a hot path).

### Phase 5 — truthiness (BLOCKED on O-TRUTH-1)

The grammar hold on bare-truthy `@if` must not be lifted before the truth node
means something typed. `guard.ts`'s `'truth'` currently serializes the value and
byte-matches `"true"`; that becomes a typed test whatever O-TRUTH-1 resolves to.
Short-circuiting `and`/`or` lands here too — required for Sass, unobservable in
Less, so it is safe to bundle.

Unblocks 29 of 92 Bootstrap files and 42 of 109 failures across bourbon /
foundation-sites / include-media, which is the largest single corpus movement
available.

### Phase 6 — recognition (§6), independent of 0–5

D1 rename + dead-twin collapse (AST-identical, **CST-moving** — build the css
differential here, there is none today). D2 the math-function table as one
combinator const in `recognition.ts`. D3 the argument grammar, extending the
typed value sequence rather than replacing it (§6.2), spelled as ONE multi-key
dispatch arm (§6.3). Then `inMathFunction` in all four grammars, which is what
makes `min(100% - 30px)` preserve.

**No n=3 bench number can gate D3** (§6.3). It needs a same-commit null run and
a dead-arm negative control first.

### What is deliberately NOT in the plan

- Extending `equalityMode` for any reason (§9).
- Any new stylesheet-callable function (§1).
- The §11 defects, which are real but independent and should not ride along.

## 11. Defects found while measuring, outside this document's scope

- **jess `.scss` diverges from dart-sass across the whole slash family** —
  `min(4px / 2)` → `2` (want `2px`), `calc(4px / 2)` → `4px / 2` (want `2px`),
  `calc(1px + min(4px / 2))` → `calc(1px + 2)` (want `3px`). Not a dropped unit:
  jess's SCSS does not divide in these positions at all.
- **`ValueTail` (`scss grammar.ts:1876`) is a hand-rolled separated list** — a
  bespoke node returning a tagged object (`{kind:'space'|'slash', value,
  separator}`), conflating both boundaries and forcing `ValueTerm` to rebuild the
  grouping imperatively. The output is already right (`list(values, '/')`); the
  mechanism is the debt. jess-parser has the intended shape. Whoever removes it
  must preserve BOTH the list output and the positional exclusion of `/` from
  `MathTopProduct`.
- **`.jess` rejects `calc(1.0px+2em)`** while `.less`/`.scss` accept — valid CSS
  rejected by one dialect.
- **`calc(1px /* c */ + 2em)` loses the comment** in all three dialects. F1
  governs whitespace and says nothing about comments.
- **`foldOperation`** (`css grammar.ts:743`, `:749`) scans the same array twice.
- **Five `css` reducer crashes** share one cause: `valueSlotChildren` throws on
  an empty match instead of returning `[]`, making the `?? any('')` fallback its
  callers spell unreachable.
- **Latent:** Less's guard vocabulary includes `=>` and `=~`, stored
  un-normalized (`less grammar.ts:4213`), and `value-guards.ts:189-197` has no
  case for either — both silently evaluate to `false`.
