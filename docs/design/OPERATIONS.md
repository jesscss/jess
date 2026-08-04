# Operations — math, comparison, and truthiness

> **Status: SETTLED. Every semantic question in this document is decided; §8
> carries no open rulings.** Nothing in here is implemented — the plan is §10.
>
> Two items are deliberately *unspecified* rather than open: the exact
> diagnostics wording, and whether the values-5 math-function set is recognised
> (§8, Recognition).
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

### 4.1 The comparison model — one-on-one common ground

**Owner ruling, 2026-08-01. Each comparison is ONE-ON-ONE: the operand pair picks
a common ground, and the comparison happens there, once. NOTHING IS TRANSITIVE.**

| operand pair | common ground |
| --- | --- |
| both numeric | numeric — reconcile units; under `=` a unitless side is a wildcard |
| either side quoted | string — compare the other operand's OWN spelling |
| both colours | colour — rgb + alpha |
| `null` and a number | numeric, `null` → `0` |
| anything else | **none** |

`=` compares on the common ground. `==` additionally requires the SAME TYPE.
With no common ground, **relational errors and equality returns `false`** —
equality never raises.

That single rule reproduces every row of the target table, and several results
that previously looked like separate rulings now fall out of it:

| expression | ground | `=` | `==` |
| --- | --- | --- | --- |
| `1 = 1px`, `2 = 2%` | numeric (unitless wildcard) | true | false |
| `1in = 2.54cm` | numeric (converted) | true | true |
| `1 = "1"` | string — `1` spells `"1"` | **true** | false |
| `1px = "1px"` | string — `1px` spells `"1px"` | **true** | false |
| `1 = "1px"` | string — `"1"` ≠ `"1px"` | **false** | false |
| `a = "a"` | string | true | false |
| `red = "red"` | string | true | false |
| `black = #000000` | colour | true | true |
| `black = #00000000` | colour (alpha differs) | false | false |
| `1px = red` | none | false | false |
| `null = 0` | numeric | **true** | false |
| `null = false` | none | **false** | false |

**Why this is not transitive, and why that is fine.** `1 = 1px` compares on
numeric ground; `1 = "1px"` compares on string ground and fails. Different pairs,
different grounds, no contradiction. Note Less's `=` is ALREADY non-transitive
without any of this — measured on lessc 4.6.3, `1 = 1px` and `1 = 1em` are both
true while `1px = 1em` is false — so transitivity was never a property to
preserve.

A value equals its own spelling. That is the whole quoted rule, and it is what
makes `1px = "1px"` and `1 = "1"` both true for the same reason.

### 4.2 Relational — trichotomous, on the same ground

**Owner ruling, 2026-08-01: `$(a > b)` and `$(b > a)` must not BOTH be false.**
This AMENDS row `u` above from `false` to `true`.

Relational uses §4.1's ground:

- **numeric ground** → numeric comparison. Incompatible units ERROR under
  `unitMode: 'strict'` (landed, `5c516dbb1`) and report incomparable otherwise.
- **string ground** → lexicographic. `b > a` true, `a > b` false.
- **no common ground** → **error**. `1px > red` is an author mistake, and Sass
  agrees; erroring is what keeps the operator honest rather than answering
  meaninglessly.

Measured, showing both engines are degenerate in opposite directions and neither
is trichotomous:

| expression | dart-sass | lessc 4.6.3 | `.jess` |
| --- | --- | --- | --- |
| `2 > 1`, `10px > 9px` | true | true | true |
| `1in > 1cm` | true | true | true |
| `2px > 1em` | error | false | error under strict |
| `b > a` | error | **false** | **true** |
| `a > b` | error | false | false |
| `"b" > "a"` | error | true | true |
| `"a" > "b"` | error | false | false |
| `1px > red` | error | false | **error** |
| `null > 1` | error | false | false (`0 > 1`) |

Less already compares QUOTED strings lexicographically (`"b" > "a"` → true) and
not bare idents — the same construct, two answers, decided by quoting. Sass
refuses the whole class. `.jess` is total over every pair that has a ground and
errors on the rest.

### 4.3 `null`

`.jess` gets a `null` literal, spelled as Sass spells it rather than as a new
word. Core ALREADY has the value: `value-eval.ts` defines `Nil` — "an empty /
absent value" — and ledger **M5** already specifies that a Nil emits nothing AND
drops the separator that would follow it, which is exactly Sass's list elision,
built for merge. This is a missing literal, not a missing concept.

Semantics, measured on dart-sass 1.101.0:

| construct | result |
| --- | --- |
| `$x: null; a { b: $x; c: red }` | `a { c: red }` — declaration DROPS |
| `a { b: 1px null 2px }` | `b: 1px 2px` — elides from a list |
| `$x: null; a { margin: 0 $x 0 }` | `margin: 0 0` — elides from shorthand |
| `$x: null; a { b: "v#{$x}" }` | `b: "v"` — interpolates empty |
| `a { b: 1 + null }` | `b: 1` |
| `$x: ""; a { b: $x; c: red }` | `b: ""` — `""` is NOT null |

Comparison follows §4.1: `null` grounds numerically against a number, and has no
ground with anything else — so `null = 0` is true while `null = false` is false,
matching both engines on the case that matters.

**The node is renamed `Nil` → `Null`** (owner, 2026-08-01). The language spells
the literal `null`, and the naming law is to use the language's own term; `Nil`
is invented vocabulary by comparison. This is a PUBLIC rename, not an internal
one — `Nil` and `makeNil` are exported from the package root
(`packages/core/src/index.ts:52,92`), so the discriminant `type: 'Nil'` is an AST
fact that consumers can see.

**Provenance is retained: explicit vs implicit.** An author-written `null` and an
absent/unbound value are the same VALUE but not the same FACT, and core already
mints the implicit one (M5's unbound optional self-ref). A flag on `Nil` keeps
one value type rather than growing a second node.

**Interop asymmetry (deliberate).** JS `undefined` → jess `null` inbound; jess
`null` → JS `null` outbound. JS has two absences and jess has one, so the lossy
direction is the inbound one.

### 4.4 Truthiness — falsy iff absent or empty

**Owner ruling, 2026-08-01.** A condition is falsy for exactly four values:

```
false    null    ""  (and '')    ()  (empty list / map)
```

Everything else is truthy, INCLUDING `0`, `0px`, `0%`, `"0"`, `red`,
`transparent`, and `rgba(0,0,0,0)`.

**The principle is emptiness, not zero-ness.** `0` is a real CSS value —
`margin: 0`, `content: ""` — not an absence, so `@if $margin` with `$margin: 0`
must take the TRUE branch. That is where JavaScript is wrong for this domain
(`0` and `""` both falsy) and where Sass is half-right (`0` truthy, but `""` and
`()` truthy too, which it cannot explain). This rule is sharper than either.

| value | `.less` | `.scss` | **`.jess`** |
| --- | --- | --- | --- |
| `true` | truthy | truthy | **truthy** |
| `false`, `null` | falsy | falsy | **falsy** |
| `""`, `''` | falsy | truthy | **falsy** — diverges from Sass |
| `()` empty list/map | *parse error* | truthy | **falsy** — diverges from Sass |
| `0`, `1`, `-1`, `0.0` | falsy | truthy | **truthy** |
| `0px`, `1px`, `0%`, `1em` | falsy | truthy | **truthy** |
| `"a"`, `"0"`, `"false"`, `"true"` | falsy | truthy | **truthy** |
| `a`, `none`, `inherit` | falsy | truthy | **truthy** |
| `red`, `#000`, `transparent`, `rgba(0,0,0,0)` | falsy | truthy | **truthy** |
| `(1 2)`, `(1, 2)`, `(a: b)` | *parse error* | truthy | **truthy** |
| `nope()` | falsy | truthy | **truthy** |

`.less` / `.scss` columns measured on lessc 4.6.3 and dart-sass 1.101.0.

#### 4.4.1 Specified as a desugaring, implemented as one predicate

```jess
$if($x)  ≡  $if(not(($x == false) or ($x == null) or ($x == "") or ($x == ())))
```

The desugaring is the DEFINITION — visible in the language, teachable, and one
line to change. Core implements it as a single typed predicate on the truth
node, so there is one evaluation site, one error site, and the node keeps its
AUTHORED span; a literal four-comparison expansion would point diagnostics at an
expression the author never wrote.

This retires `guard.ts`'s `'truth'` byte test —
`emitValue(v).trim() === 'true'` — which decided a semantic question by
serializing the value and string-matching, the thing the architecture forbids
everywhere else.

#### 4.4.2 Both dialects lower to plain `.jess`

```
.less   when (@x)   ->   $if($x == true)
.scss   @if $x      ->   $if(not(($x == false) or ($x == null)))
```

Both are writable `.jess`, which is the hard requirement: `.less` and `.scss`
must go {lang} -> `.css` AND {lang} -> `.jess` -> `.css`. A lowering that needs
an internal node or a core-only predicate has no `.jess` representation and is
therefore not a lowering.

**`==` is load-bearing, and each lowering breaks differently with the loose
operator.** Note this is an argument for `==` ONLY — `not(...)` covers negation,
so `!=` is not required (§4.4.3):

| lowering | with `==` | with `=` |
| --- | --- | --- |
| `.less` `$if($x == true)` | correct | `"true" = true` → string ground → **true**, but Less says `"true"` is falsy |
| `.scss` `$if(not(($x == false) or ($x == null)))` | correct | `0 = null` → numeric ground → equal, so `0` comes out **falsy**; Sass says truthy |
| `.jess` `$if($x)` | correct | same `0 = null` break |

`=`'s grounds are deliberately generous (§4.1); "is this literally that value" is
the type-strict question.

#### 4.4.3 `!=` is NOT required — deferred

An earlier revision of this document claimed the type-strict PAIR was
load-bearing. That was wrong, and the correction matters because it would have
bought grammar surface for nothing.

`not($x == y)` is unconditionally equivalent to `$x != y` here: `==` yields a
`Bool`, and an incomparable pair already collapses to `false`, so there is no
three-valued case where they could diverge. All three lowerings above are written
with `not(...)` and need no `!=`.

**Both forms must parenthesise each comparison** — see §4.5.4. A bare comparison
is not an `and`/`or` operand in the jess grammar, so
`not($x == false or $x == null)` is a PARSE ERROR. Verified against the parser,
not inferred.

`!=` remains defensible as pure ergonomics — Sass has it, and `$x != null` reads
better than `not($x == null)` — but it is redundant, and `!` in that position
wants checking against `!important` before it is spent. **Deferred**; it is
additive and breaks nothing if it earns its place later.

#### 4.4.4 `=` is NOT overloaded with falsiness

`"" = false` stays **false** (Quoted vs Bool → no common ground). Making it true
was considered and rejected twice over:

- It would force `null = false` to be **true** — `null` is falsy, so if `= false`
  means "is falsy" then null must equal false — re-opening a settled ruling
  (§4.1) that both engines back.
- Making `"" = false` true while `$if("")` stays truthy is precisely the
  JavaScript `[]` wart. Measured: `[] == false` is **true** in JS while `if([])`
  is **truthy**, and `null == false` is **false** while `null` is **falsy**. JS's
  `== false` agrees with its own truthiness on only four of six probed values,
  with no rule predicting which.

`=` asks *are these the same value*; `$if` asks *is this present and non-empty*.
Two questions, two answers, and the relationship stays total and predictable:
`$if` is false for exactly `{false, null, "", ()}` and `= false` is true for
exactly `{false}`. Simple containment, no overlap.

#### 4.4.5 Migration note

Compiled `.scss` is unaffected — the lowering emits the explicit form. A HAND
port of `@if $x` to `$if($x)` changes behaviour when `$x` is `""` or `()`. That
is a migration-guide line, not a defect.

### 4.5 Expression value position — where operators live

`.jess` does not have one "value position". It has three, and operators are
admitted in only one of them. This is the same boundary ledger **P17** already
draws for arithmetic — bare `1 + 2` in a declaration value is a parse error and
must stay one — generalised to every operator.

| position | spelling | operators admitted |
| --- | --- | --- |
| interpolation | `${name}` | none |
| value | an ordinary declaration value slot | none |
| **expression value** | the five forms below | **arithmetic, comparison, logical** |

#### 4.5.1 The expression value positions

There are FOUR, and whether parens surround the expression is part of each form
rather than a uniform rule:

```jess
$([here])
$if ([here])
$for ([here])
when [here]
```

**Parens are REQUIRED after `$if`, `$else if` and `$for`. They are NOT required
after `when`** (owner ruling, 2026-08-01). The asymmetry is about which language
each keyword is sourced from, not about the parser:

- **`$if` / `$for` — the mental model is JavaScript.** `if (…) { … }` is the most
  familiar control-flow shape a web developer has, and the parens separate the
  condition from the body. Mandatory buys that symmetry outright, `$else if`
  included.
- **`when` — the mental model is a CSS query prelude**, where a bare keyword is a
  complete condition (`@media screen`). A guard is a trailing modifier on a
  signature that already ends in `)`, so `m() when (true)` puts two paren groups
  adjacent doing unrelated jobs.

**`when` admits a bare VALUE, not a bare COMPARISON** — this is where the CSS
analogy is exact. A prelude is a bare keyword or a parenthesised condition, never
a bare condition:

```jess
when true            OK    like `@media screen`
when $foo            OK
when (1 > 2)         OK    like `@media (min-width: 500px)`
when 1 > 2           NOT VALID — no CSS analogue
```

Parens after `when` therefore stay **allowed** everywhere and **required** around
a comparison, which also keeps every existing `.less` guard parsing.

#### 4.5.2 Call arguments are VALUE position — `$( … )` is the only compute marker

**Mixin and function call arguments are NOT an expression position** (owner
ruling, 2026-08-01, reversing an earlier steer in this document). Computing
inside an argument requires the explicit boundary:

```jess
$my-func($(4px / 2), …)      // computes -> 2px
$ > my-mixin($(1 > 2), …)
```

The reversal is because treating arguments as expressions reintroduces exactly
the ambiguity `$( … )` exists to remove. Measured on the current grammar, where
arguments are already value position:

```
m(4px / 2)      ->  4px / 2      slash value, preserved
m($(4px / 2))   ->  2px          explicit expression, computes
m(1 + 2)        ->  PARSE ERROR  bare arithmetic rejected, per P17
m(12px/1.5)     ->  12px / 1.5   shorthand survives
```

Two things break if arguments become expressions:

1. **`m(4px / 2)` silently becomes `2px`.** That is the most common shorthand
   shape in CSS — `font: 12px/1.5`, `grid-area: 1/2`, `border-radius: 50% / 20%`
   — changing meaning with no diagnostic. It is the `slash-div` mess dart-sass
   spent years deprecating its way out of.
2. **Nothing would be left to mean "do NOT compute this."** `$( … )` would be
   redundant inside an argument, so a slash value could not be passed at all.

A hybrid — admitting `>`/`<`/`and`/`or` bare because they carry no CSS value
meaning while keeping `/` and `-` as value syntax — is explicitly rejected. It
reads reasonable and is the worst option: an author would have to know which
operators are safe bare, and the boundary is invisible at the call site.

**Expression position IS contagious inward.** A call written inside `$( … )` has
expression arguments — `ExpressionCallArgument` (`grammar.ts:1821`) already
threads `ExpressionCompare` — while the same call at statement level takes value
arguments through `MixinCallArgument` → `g.ValueTerm` (`grammar.ts:5269`). Both
behaviours are already implemented and both are correct.

The rule in one line: **if it computes, it is inside `$( )`** — no exceptions,
no per-operator carve-outs, no position where the marker is optional.

#### 4.5.3 Implementation status

Measured. TWO rows are behind the ruling (see also §4.5.3b):

| position | production today | matches? |
| --- | --- | --- |
| `$([here])` | `ExpressionAtom` → `ExpressionCompare` → `ExpressionSum` | **yes** |
| `$if ([here])` | `IfGuardCompare` over `ExpressionSum` (`grammar.ts:5636`) | **yes** — parens already required |
| `$for ([here])` | `For` (`grammar.ts:5600`) | **yes** — parens already required |
| `when [here]` | `MixinDefinition` spells `literal('(')` … `literal(')')` (`grammar.ts:5358`) | **NO** — parens mandatory; `when true` is a parse error |
| call arguments | `MixinCallArgument` → `g.ValueTerm`; `ExpressionCallArgument` inside `$( … )` | **yes** — already value position |

`when true` and `$if true` both fail today with `Unexpected Jess syntax.`, and
lessc 4.6.3 rejects `when true` with `expected condition` — so bare `when` is NEW
syntax in jess, not a Less behaviour being preserved.

#### 4.5.3a Less `boolean()` / `if()` are SYNTAX, not `fns/` exports

They wear call parentheses, but they are expression-position constructs and must
be **lowered**, not dispatched. Under §4.5.2 they could not be functions at all:
their arguments are conditions, and call arguments are value position.

The implementation already agrees. `LOGICAL_FNS = {'if','boolean','not','and','or'}`
(`serialize.ts:4397`) is consulted in the serializer BEFORE any registry lookup,
and its comment states the reason outright — the argument is *"a guard tree, not
an ordinary value — dispatched here (not via `ev.call`) so the condition
evaluates through the guard evaluator and `if` stays branch-lazy."* They are
absent from the Less fns index, and the Less grammar carries dedicated
`FunctionCondition` / `FunctionConditionTerm` productions (`less/grammar.ts:130`,
`:2931`) precisely because an ordinary argument production cannot hold a
condition.

Consequences:

- **`packages/fns` must not export them.** A registry entry would be dead —
  `LOGICAL_FNS` short-circuits first — and would imply an argument shape the
  value-position rule forbids.
- **They lower to jess syntax, not to a call.** `boolean(<cond>)` is the `$( … )`
  expression boundary; `if(<cond>, a, b)` is the VALUE-POSITION `$if` (§4.5.3b),
  not a call and not the statement form. The lowering target is a language
  construct, matching §4.5.5's rule that logical operators are native rather than
  rewritten.
- **`not`/`and`/`or` are in that same set**, which is why §4.5.5's native
  operators are the right home for them rather than a `fns/` entry.

#### 4.5.3b `$if` / `$for` have TWO body forms, decided by position

This is the part `if(<cond>, a, b)` "lowers to the conditional form" was
hand-waving over. `$if` and `$for` exist in two positions and the BODY differs:

| position | body | example |
| --- | --- | --- |
| statement | a declaration / statement list | `a { $if (true) { b: 1px; } }` |
| **value** | **a VALUE — never a declaration list** | `a { b: $if (true) { 1px } $else { 2px }; }` |

A value-position `$if` produces a value, so its body cannot be a declaration
list; there is nothing for declarations to attach to. Same for `$for`, whose
value form yields the accumulated values rather than emitting declarations.

**Only the statement form exists today.** Measured:

```
a { $if (true) { b: 1px; } }                  OK
a { b: $if (true) { 1px } $else { 2px }; }    ERROR  Unexpected Jess syntax.
a { b: $for ($i of 1 to 3) { $i }; }          ERROR  Unexpected Jess syntax.
```

There is one `If` production (`grammar.ts:5754`) and its `IfBody`
(`grammar.ts:5717`) is `literal('{') many(nestedBodyStatement) literal('}')` — a
statement list. No value-body form is reachable.

**This is required, not optional**, because it is the lowering target for Less's
`if(<cond>, a, b)`: that construct returns a value, so it cannot lower to the
statement form, and §4.5.3a rules out lowering it to a call. Adding it is a
grammar change of the same standing as `when`'s parens (§4.5.3).

**The spelling is settled** (owner, 2026-08-01):

```jess
foo: $if ($bar) { blah } $else { blarp };
```

Brace-delimited value bodies, `$else` chains in value position, and the whole
form terminates as an ordinary declaration with `;`. The braces delimit a VALUE,
not a declaration list — that is the distinction this section exists to make.

#### 4.5.4 Two consequences the grammar enforces today

Both verified against the parser rather than read off the productions:

```
($x = 1px)                       OK    a bare comparison is fine on its own
($x = 1px or $x = 2px)           ERROR bare comparisons are not and/or operands
(($x = 1px) or ($x = 2px))       OK    parens make them primaries
(not true or false)              ERROR `not` always takes parens
(not(true) or false)             OK
(true or false)                  OK    bare values chain fine
```

1. **`not` takes parens** — `not($x)`, never `not $x`.
2. **A comparison must be parenthesised to be an `and`/`or` operand.**
   `IfGuardAnd`/`IfGuardOr` chain `IfGuardPrimary`, which is `not(…)`, `(…)`, or a
   bare value; `IfGuardCompare` is not a primary.

A guard parse failure is reported at the ENCLOSING rule, not the offending
token — worth knowing, because it makes a bad guard look like a broken ruleset.

#### 4.5.5 Logical operators are native, not rewritten

`and` / `or` / `not` are expression-position operators in their own right:

- **`and` / `or` return an OPERAND** and short-circuit — `$a or $default` is
  `$a` when truthy, else `$default`.
- **`not` returns a `Bool`.**
- **Conditions truthiness-test the result** (§4.4), so one semantics serves both
  the `$( … )` and the guard forms: `truthy($a and $b)` is exactly
  `truthy($a) and truthy($b)`.

They are NOT lowered to `if(…)`. That rewriting was considered and rejected:
`if($a, $a, $default)` duplicates the operand in generated source, makes
transpiled `.jess` stop resembling the author's code, and leaves a direct `.jess`
author unable to express the construct at all. Sass's own `if()` is deprecated.

Sass therefore lowers near-identically, wrapper aside:

```
.scss   $x: $a or $default   ->   $x: $($a or $default)
.scss   @if $a and $b        ->   $if($a and $b)
.scss   @if not $x           ->   $if(not($x))
```

The `$( … )` wrapper is mandatory in the first case and implicit in the other
two, because `$if`'s condition is already an expression position (§4.5.1).

Two grammar sites remain distinct even though the semantics are one:
`$( … )` expression `and`/`or`, and `IfGuardAnd`/`IfGuardOr` combining guard
nodes. They agree observationally in condition position; they are not the same
production.

#### 4.5.6 Guard EXPRESSION lowering is not CONSTRUCT lowering

The tables above lower the guard *expression*. Where it lands is a separate
mapping, and only Sass's is one-to-one:

| dialect | construct | lands in |
| --- | --- | --- |
| `.scss` | `@if` | `$if` — a genuine statement-to-statement map |
| `.less` | `.m() when (…)` | a jess **mixin guard** (`when ( … )`), not `$if` |
| `.less` | `.sel when (…)` (CSS guard) | **`$if (guard)` WRAPPING the ruleset** — jess grows no ruleset-level guard |

`.less` has `when (…)` guards and an `if()` function; it has no `$if`. Writing
`.less when (@x) -> $if($x == true)` names a construct Less does not have and
forces the wrong target.

**CSS guards lower by WRAPPING** (owner, 2026-08-01) — jess deliberately does not
grow a ruleset-level guard, because a guard hanging off a selector is clunky:

```less
.light when (lightness(@a) > 50%) { color: green; }
```

```jess
$if ((lightness($a) > 50%)) {
  .light { color: green; }
}
```

So `when` survives in jess only as a MIXIN guard. A Less CSS guard becomes a
control-flow statement wrapping the ruleset, which is the construct jess already
has.

### 4.6 The math rule, stated over the construct

**An operation authored inside a CSS math function preserves its authorship; it
does not fold.** `calc($val / 2)` → `calc(8px / 2)`: operands resolve so
variables substitute, and the operation is returned intact. `$( … )` is the
explicit opt-in to fold, and a `calc()` whose sole argument folds to one value
unwraps (`h4` → `4px`).

This is exactly AST v1's model. At `7b7d4e57c` it was `OperationOptions.inCalc`,
a **parse-time flag on the Operation node**, and an `inCalc` operation never
operated. The name broadens with the rule: the fact is `inMathFunction`, because
after §6 it covers every css-values-4 §10 function, not only `calc()`.

### 4.7 Unit strictness — nonsensical operations throw

**Owner ruling, 2026-08-01. jess defaults to units being stricter than Less 4.x,
and refuses operations whose result cannot be expressed.**

The deciding case is `1 / 2px`. Dividing a unitless number by a dimension yields
a reciprocal unit, and **CSS has no such unit** — there is no `px⁻¹`. Less 4.x
answers `0.5px`, which is dimensionally false; dart-sass answers
`calc(0.5 / 1px)`, which does not claim the unit exists but merely preserves the
expression. Since jess is not preserving here, the honest outcome is an error.

| expression | lessc 4.6.3 | dart-sass | **jess** |
| --- | --- | --- | --- |
| `2px / 1px` | `2px` | `2` | **`2`** — units cancel |
| `1 / 2px` | `0.5px` | `calc(0.5 / 1px)` | **mode-dependent, and never silent** — see below |
| `1px * 2px` | `2px` | `calc(2px * 1px)` | preserve + warn (§4 rows `f`–`f3`) |

The rule is chosen on the two axes that matter: **consistency with the coercion
model** — a value must be expressible in the value domain, and a reciprocal unit
is not — and **least surprise**, since `0.5px` is a plausible-looking answer that
is simply wrong, which is worse than a diagnostic.

`unitMode` is the ladder, and **every rung warns except the one that throws**
(owner, 2026-08-01):

| mode | `1 / 2px` | |
| --- | --- | --- |
| `loose` | `0.5px` | Less 4.x's answer, **+ warning** |
| **`preserve`** (default) | `calc(1 / 2px)` | **+ warning** |
| `strict` | throws | |

**No mode is silent.** Silent preservation is the worst option: the author gets
output that looks fine and never learns the expression was meaningless. Ledger
**G25** already settled that shape for the `calc()` comment case — *"auto-fixed
AND warned — both, not either"* — and §4's rows `f`/`f2`/`f3` annotate the same
thing ("EVAL warning → `calc(1px * 2px)`").

`preserve` PRESERVES; it does not raise. That is both the mode's name and its
existing implementation — `value-operate.ts:425` and `:441` already convert a
unit clash into a `calc(…)` rather than throwing. An earlier revision of this
section said `preserve` raises, which contradicted the name and the code.

The default is `preserve` (`DEFAULT_MODES`, and the dialect plugins); `strict`
arrives via the `strict: true` preset. This is the same lever extended in
`5c516dbb1`, which gave `unitMode` reach into comparison — the modes now govern
arithmetic, comparison, and expressibility as one policy rather than three.

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
`sibling-index`. **These are NOT recognised** — see §8, Recognition: nothing
enters the table until it ships in browsers, gated per function at
implementation time. `round()` also takes an optional leading `<rounding-strategy>`
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

**Cross-reference, recorded not resolved.** The MUST/MUST NOT above rests on one
ground only: the codegen byte delta (~1.4 MB of inlined tails against ~70 KB).
Two other documents give the opposite default on *other* grounds, and neither
cites this delta:

- `docs/architecture/parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md` — "do not use
  `dispatch(...)` as a prettier `choice(...)`"; closed keyword/operator choices
  are "already cheap and clearer as `choice(...)` or `keywords(...)`" — a
  clarity-and-cheapness ground.
- `docs/architecture/parser/GRAMMAR-REVIEW-STANDARD.md` §2 item 8 — `choice(...)`
  is kept for alternatives with disjoint first sets, and closed spelling tables
  "stay `word(...)` / `keywords(...)` / small literal `choice(...)`" — a
  first-set-gating ground.

The rule above is unchanged and still binds. Recorded so a reader who meets the
other two first knows the conflict exists and on what grounds; the owner decides
it, and it is not decidable until the measurements this section names have run.

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

The polarity is inverted against §4.6: v2 treats `calcDepth > 0` as FORCING
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

## 8. Questions — all semantic rulings CLOSED

- **O-TRUTH-1 — RESOLVED (owner, 2026-08-01).** See §4.4. `.jess` truthiness is
  falsy iff **absent or empty** — `false`, `null`, `""`, `()` — and both dialects
  lower to plain `.jess` source. Nothing is blocking.

### Semantics — all resolved

- **O-TRUTH-5 / 6 / 11 — ALL RESOLVED (owner, 2026-08-01) by §4.1's common-ground
  model.** They turned out to be one question, not three:

  - **O-TRUTH-5** (can Sass `==` be lowered by operator substitution?) — no. It
    lowers to a named primitive that picks the ground at eval. See §5.1.
  - **O-TRUTH-6** (are `$(a > b)` and `$(b > a)` both false?) — no. String ground
    makes relational trichotomous; row `u` is amended to `true`. See §4.2.
  - **O-TRUTH-11** (does a cross-type comparison error?) — **relational errors,
    equality returns `false`.** `1px > red` has no common ground and is an author
    mistake; `1px = red` is simply false. Equality never raises.

  What collapsed them was dropping the idea that an operand is COERCED into a
  canonical value and then re-enters the other rules. It is not: the pair picks a
  ground and compares there once. That is also why `1 = "1px"` is false — `"1"`
  is not `"1px"` — while `1 = 1px` is true on numeric ground, with no
  contradiction between them and no transitivity implied.

- **`null` in comparison — RESOLVED.** Grounds numerically against a number
  (`null` → `0`), and has NO ground with anything else. So `null = 0` is true,
  `null > 1` is false, and `null = false` stays **false**, which is what both
  engines report and the case that would otherwise surprise. See §4.3.

- **O-TRUTH-2 — RESOLVED (owner, 2026-08-01): `and`/`or` SHORT-CIRCUIT.**
  Required for Sass, where the right operand may raise; for Less it only ever
  makes FEWER things raise, so it is safe. `guard.ts:73-85` currently evaluates
  both, on the stated premise that "a guard is side-effect-free" — true for Less,
  false for Sass. **Independently landable** — an earlier revision of this
  document claimed the defect was masked by the bare-truthy `@if` hold and had to
  land with Phase 5. That was wrong: the demo behind it died on a DIFFERENT gap
  (a parenthesised arithmetic expression is not admitted as an `and` operand in
  the SCSS `@if` grammar), which was then misattributed. The defect is live and
  reproducible today:

  ```
  unitMode: 'strict'
  @if false and (2px > 1em)   ->  ERR "Invalid unit arithmetic"   RHS evaluated
  ```

  Short-circuiting should take the `@else` branch there. So this belongs early
  (phase 1–2), not with phase 5.

- **O-TRUTH-7 — RESOLVED (owner, 2026-08-01): `$(1 / 2px)` THROWS.** See §4.7.
  There is no such unit as `px⁻¹`; an earlier draft of this document suggested
  one, which was simply wrong — dart-sass's `calc(0.5 / 1px)` PRESERVES the
  expression rather than claiming an inverse unit exists. Since the result cannot
  be expressed, the honest answer is a unit error, and the ruling generalises:
  jess defaults to units being STRICTER and refuses nonsensical operations.

- **O-TRUTH-3 — RESOLVED (owner, 2026-08-01): `1in = 2.54cm` is TRUE.** They are
  equal by definition; Less 4.x's `false` is a conversion-precision bug, not a
  dialect choice. `.less` output shifts, and that is acceptable: **a divergence
  from Less 4.x where Less 4.x was wrong in the first place needs no further
  justification.**

- **O-TRUTH-4 — RESOLVED (owner, 2026-08-01): list equality IS
  separator-sensitive.** `(1, 2) ≠ (1 2)`, matching Sass, because **CSS does not
  make those interchangeable** — a comma list and a space list are different
  values in a declaration. `List` already carries `sep`, so the fact is available
  without a model change. Note it sits deliberately alongside index lookup being
  LOOSE (§1): lookup compares keys by value, list identity compares separators.

- **O-TRUTH-8 — RESOLVED.** `null` is specified in §4.3 (literal, elision,
  declaration drop, interop) and §4.1 (comparison ground).

### Recognition (§6)

- **RESOLVED (owner, 2026-08-01): values-4 §10 ONLY.** Nothing is recognised
  until it is shipping in browsers. The values-5 set is not uniform — some
  members have shipped and some have not — so the gate is **per function,
  verified against browser support AT IMPLEMENTATION TIME**, not a judgement
  baked in here from memory.

  Not recognising one costs nothing today: an unrecognised `progress(…)` falls
  through to `GenericFunction` and emits verbatim, so the only consequence is
  that its arguments are not parsed as math — and nobody writes math inside a
  function that does not exist yet. Adding a name early is the costlier
  direction: it claims syntax that may still change, and §6.3 shows every routed
  name carries generated-code weight.
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
- **LANDED `5c516dbb1`:** `unitMode` now reaches comparison, not only
  arithmetic. `strictUnits` used to make `1px + 3em` a hard error while
  `2px > 1em` stayed a silent `false` in the same mode on the same operand pair.
  Both now raise the same `JessError` (`eval/invalid-unit-arithmetic`) with a
  source location. Known gap: `mixin-dispatch.ts` calls `evalGuard` unwrapped, so
  a mixin guard's clash still surfaces as the bare class.
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
§4.4, which is now settled — no ruling is outstanding.**

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

Three operator regexes (`grammar.ts:1456`, `:1464`, `:2012`) gain `==`; the guard
node carries the new comparison kind; `compare()` gains the arm. Additive — `==`
is a parse error today, so nothing that parses now changes meaning. Touches
`operator-adjacency.test.ts`'s assumptions.

`!=` is NOT part of this phase — `not(...)` covers negation and the pair is
redundant (§4.4.3).

**Phases 4 and 5 both depend on this**, since every lowering is written in terms
of `==`.

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

### Phase 5 — truthiness (UNBLOCKED, §4.4)

Settled by §4.4: falsy iff `false`, `null`, `""`, `()`. The grammar hold on
bare-truthy `@if` lifts together with the semantics, never before — widening the
grammar alone would not fail, it would silently take the wrong branch.

`guard.ts`'s `'truth'` byte test (`emitValue(v).trim() === 'true'`) is replaced
by ONE typed predicate carrying the authored span, specified as the §4.4.1
desugaring. The two dialect lowerings (§4.4.2) are plain `.jess` and need no core
support beyond `==` / `!=` from phase 2.

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

## 10a. Editor / lint diagnostics

The rules here currently fail only at EVAL time. They should also be IDE and lint
diagnostics across all four grammars — owner note, 2026-08-01. Tracked in
[`docs/architecture/lint-roadmap.md`](../architecture/lint-roadmap.md), which
owns stylesheet diagnostics and whose standing principle is that lint should
"expose the problems Jess already understands, not grow a second detector stack."

Follows the §10 implementation rather than preceding it: the rules must exist in
core first, and the diagnostics should read the SAME predicates rather than
reimplementing them.

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
