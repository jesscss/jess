# Comparison and truthiness — measured behaviour, and Jess's native rules

> **Status: DESIGN, needs owner sign-off on §5.** Every fact in §2–§4 is
> measured, not recalled. §5 is a proposal.

## 1. Why this exists

Bare-truthy `@if` is the single largest blocker in the SCSS corpus — 29 of 92
Bootstrap files, and 42 of the 109 failures across bourbon / foundation-sites /
include-media. It is *deliberately* held in the grammar
(`packages/syntax/scss/scss-parser/src/grammar.ts`, `IfAtom`): the note there
says bare truthiness is withheld "because the current truth node has Less's
exact-`true` behavior".

That hold is correct and must not be lifted by widening the grammar alone.
Accepting `@if $x` while the truth node still means *"the bytes are literally
`true`"* would not fail — it would silently take the wrong branch and emit
wrong CSS. The grammar rule and its semantics have to land together.

To decide the semantics we first need to know what the two engines actually do,
and then what Jess itself should mean. That is §2–§4 and §5 respectively.

## 2. Method

Measured directly, not taken from documentation:

- **dart-sass 1.101.0** (`sass` devDependency of `packages/jess`) via
  `sass.compileString`.
- **lessc 4.6.3** (root `less` devDependency) via `less.render`.

Truthiness was probed as `@if <expr>` in Sass and as a mixin guard
`.m() when (<expr>)` in Less. Every Less result was re-verified with a
single-branch guard emitting a marker declaration, so an *incomparable* operand
shows up as "no rule emitted" rather than being folded into one side by a
`not (…)` mirror branch.

Two corrections were made during measurement and are worth recording, because
both would have produced a wrong table:

- `1m` is **not a CSS unit**. `100cm == 1m` measures unknown-unit handling, not
  unit conversion. Real-unit cases (`1in`/`96px`, `100cm`/`1000mm`, `1s`/`1000ms`)
  were substituted.
- `nope()` is **not an error in Sass** — unknown functions pass through as plain
  CSS. A short-circuit probe built on it proves nothing. `1px + 1em`
  (incompatible units, a genuine error) was substituted.

## 3. The tables

### 3.1 Truthiness — a bare operand in condition position

| operand | dart-sass | lessc 4.6.3 |
|---|---|---|
| `true` | truthy | truthy |
| `false` | falsy | falsy |
| `null` | falsy | falsy |
| `0` | **truthy** | falsy |
| `1` | **truthy** | falsy |
| `""` | **truthy** | falsy |
| `"a"` | truthy | **falsy** |
| `"false"` | truthy | falsy |
| `()` (empty list) | truthy | *parse error* |
| `(a: b)` (map) | truthy | *parse error* |
| `1px` | truthy | **falsy** |
| `red` | truthy | **falsy** |
| bare ident | truthy | **falsy** |

**Sass: everything is truthy except `false` and `null`.**
**Less: nothing is truthy except the literal keyword `true`.**

These are not two points on a scale. Less's rule is a *byte* test; Sass's is a
*type* test. Note `0` and `""` are truthy in Sass — it is not JavaScript.

### 3.2 Equality

| expression | dart-sass | lessc 4.6.3 |
|---|---|---|
| `1 == 1` | true | true |
| `1px == 1px` | true | true |
| `1px == 1` | **false** | **true** |
| `1in == 96px` | true | true |
| `1in == 2.54cm` | true | **false** |
| `100cm == 1000mm` | true | true |
| `1s == 1000ms` | true | true |
| `1 == 1.0` | true | true |
| `1px == 1PX` | **false** | **true** |
| `1px == 1%` | false | false |
| `1foo == 1foo` | true | true |
| `1foo == 1bar` | false | false |
| `1 == "1"` | false | false |
| `a == "a"` | **true** | **false** |
| `A == a` | false | false |
| `"A" == "a"` | false | false |
| `#fff == white` | true | true |
| `null == false` | false | false |
| `0 == false` | false | false |
| `"" == false` | false | false |
| `(1 2) == (1 2)` | true | *parse error* |
| `(1, 2) == (1 2)` | **false** | *parse error* |
| `(a: 1) == (a: 1)` | true | *parse error* |

**The headline: Less and Sass diverge in OPPOSITE directions.**

- Less coerces **numbers** (`1px == 1` ✓) but separates **text** by quoting
  (`a == "a"` ✗).
- Sass is the reverse: unit-strict on numbers (`1px == 1` ✗), quote-insensitive
  on text (`a == "a"` ✓).

Neither is "stricter". This is already stated in
`packages/core/src/types/modes.ts` and the measurements confirm it.

Two smaller facts: Less treats units **case-insensitively** (`1px == 1PX` ✓
where Sass says ✗), and Less gets `1in == 2.54cm` **wrong** (they are equal by
definition; Less's conversion loses precision). Sass's list equality is
**separator-sensitive** — `(1, 2)` and `(1 2)` are different values.

### 3.3 Relational (`<`, `>`, `<=`, `>=`)

| expression | dart-sass | lessc 4.6.3 |
|---|---|---|
| `2 > 1` | true | true |
| `2px > 1px` | true | true |
| `2px > 1` | true | true |
| `1in > 1cm` | true | true |
| `2px > 1em` | **error** — incompatible units | **false** |
| `"b" > "a"` | **error** — undefined operation | **true** |
| `null > 1` | **error** — undefined operation | **false** |

**Where Sass raises, Less silently returns false.** A Less author cannot
distinguish "genuinely not greater" from "these were never comparable"; the
condition just quietly takes the else branch. This is the clearest case in the
whole document where one engine's behaviour is a defect rather than a dialect.

### 3.4 Logical operators

Sass's `and` / `or` are **not boolean operators** — they return one of their
*operands*, like JavaScript's `&&` / `||`:

| expression | dart-sass returns |
|---|---|
| `1 and 2` | `2` |
| `null and 2` | `null` (declaration dropped) |
| `false and 2` | `false` |
| `1 or 2` | `1` |
| `null or 2` | `2` |
| `false or 2` | `2` |
| `not 1` | `false` |
| `not null` | `true` |
| `not ""` | `false` |

And they **short-circuit** — proven with a genuine error term:

| expression | result |
|---|---|
| `1px + 1em` (sanity) | error: incompatible units |
| `false and (1px + 1em)` | `false` — **RHS never evaluated** |
| `true and (1px + 1em)` | error |
| `true or (1px + 1em)` | `true` — **RHS never evaluated** |
| `false or (1px + 1em)` | error |

Precedence is conventional: `not` > `and` > `or`.

In Less, `and`/`or` appear only in guards and yield a boolean.

## 4. What Jess does today

**Equality is already three-mode and already correct.**
`packages/core/src/tree/condition.ts` (`compareUnder`) implements
`EqualityMode = 'less' | 'sass' | 'exact'`, and its doc comments assert exactly
the divergences measured above (`2px = 2` ✓ Less / ✗ Sass; `a = "a"` ✗ Less /
✓ Sass). Independent measurement confirms them. **No change needed here.**

**Truthiness has no mode at all.** `packages/core/src/ast/guard.ts`, `'truth'`:

```ts
const test = (v: ValueGroup): boolean => emitValue(v).trim() === 'true';
```

Two problems.

1. It is Less-only, which is the blocker this document exists to unblock.
2. It decides a semantic question by **serializing the value and string-matching
   the bytes**. Everywhere else the architecture forbids re-deriving meaning
   from emitted text. Even keeping Less semantics exactly, this should be a
   typed test for the boolean `true`, not a byte compare — `emitValue` is doing
   work that a type tag already answers.

**Logical operators do not short-circuit.** `evalGuard`'s `and`/`or` evaluate
both operands unconditionally, with a comment saying this "preserves the
existing evaluation order exactly". That is defensible for Less (guards are
side-effect-free and both sides are cheap), but it is **observably wrong for
Sass**, where `false and (1px + 1em)` must not raise.

**Relational-on-incomparable has no mode.** `getResult` returns `false` for an
`undefined` three-way comparison — Less's silent-false, for every dialect.

## 5. Proposed native rules

The proposal is deliberately conservative: **reuse the mode vocabulary that
already exists** rather than invent a parallel one. `EqualityMode` already
proves the shape — two named compatibility modes plus a strict native one.

### 5.1 `TruthMode`, mirroring `EqualityMode`

| mode | rule | used by |
|---|---|---|
| `less` | true iff the value is the boolean `true` | `.less` |
| `sass` | true for everything except `false` and `null` | Sass+ |
| `exact` | a condition operand **must** be a Boolean; anything else is an **error** | `.jess` |

`exact` is the native rule. Rationale: a condition whose operand is `1px` is
almost always a mistake, and Jess has a type system to say so. This mirrors
`EqualityMode.exact` exactly — the native mode is the one that refuses to guess.

It also gives Sass+ a precise, nameable diagnostic instead of a parse error, and
gives the language service something to *warn* rather than *reject* — the
error/warning split from the wider Sass+ design.

### 5.2 Relational on incomparable operands

| mode | rule |
|---|---|
| `less` | `false` (bug-compatible; required for byte-identity) |
| `sass` | error |
| `exact` | error |

Native follows Sass here, because §3.3 is a defect, not a dialect choice.

### 5.3 Logical operators

- **Native (`.jess`)**: `and`/`or`/`not` are boolean operators returning a
  Boolean, and they **short-circuit**.
- **Sass+**: `and`/`or` return the selected **operand** and short-circuit, per
  §3.4. This is observable in value position (`$x: $a or $b`) and cannot be
  approximated by a boolean.
- **`.less`**: unchanged.

Short-circuiting must be added regardless of mode — it is required for Sass
correctness and is not observable in Less (guards are side-effect-free), so it
is safe to make unconditional.

### 5.4 Lowering

Both dialects lower onto the same `GuardNode` set; only the *modes* differ. No
new node kinds. `@if <expr>` lowers to `{ g: 'truth', value }` exactly as
`when (<expr>)` does — the mode decides what `truth` means.

## 6. Open owner decisions

- **O-TRUTH-1** — Is native truthiness `exact` (a non-Boolean operand is an
  error), as proposed? The alternative is adopting Sass truthiness natively for
  familiarity, at the cost of `@if 0` silently taking the true branch.
- **O-TRUTH-2** — Should `.jess` `and`/`or` return a Boolean (proposed) or an
  operand like Sass? Operand-returning is more expressive (`$x: $a or $default`)
  but makes the type of `and` depend on its inputs.
- **O-TRUTH-3** — Less's `1in == 2.54cm` → false is a precision **bug**. Does
  `less` mode reproduce it for byte-identity, or is equality one place we
  deliberately do not port a defect?
- **O-TRUTH-4** — Sass list equality is separator-sensitive (`(1, 2) != (1 2)`).
  Does the native Collection model preserve separator identity?

## 7. Reproducing

Both engines are already devDependencies; no new tooling is required. Probe from
`packages/jess` so `sass` and `less` both resolve, using `sass.compileString`
and `less.render` as described in §2.
