# Comparison and truthiness — measured behaviour, and Jess's native rules

> **Status: DESIGN.** Every fact in §2–§4 is measured, not recalled. §5 records
> the owner's settled model from `packages/core/OPERATIONS.md` (no modes;
> `.jess` compiles as `.jess`), and supersedes an earlier mode-based proposal in
> this document. §6 is the open list.

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

## 5. Native rules — the owner's model (supersedes an earlier mode proposal)

`packages/core/OPERATIONS.md` settles the shape, and it is **not** the
mode-based one an earlier draft of this document proposed. The resolutions
there are:

1. **Remove `equalityMode` from Jess options.**
2. **Lower `.scss` / `.less` accordingly** — the dialect front end does the
   work, not a runtime mode switch.
3. **Add a double-equality operator to `.jess`** — `=` loose, `==` equal-to-type.
4. Accept moderately breaking shifts in Less / Sass+ behaviour.

Plus a structural note: these comparisons should be **function-based
compare/operate primitives**, reused elsewhere — notably Collection index
lookup, where `$foo['1px']` matches a `1px` key *because* lookup uses loose
equality.

**`.jess` compiles as `.jess`. There are no modes.** The two engines'
divergent behaviours become expressible natively because `.jess` has *both*
operators, and each dialect's lowering picks the right one.

### 5.1 The two operators

| expression | `.jess` `=` (loose) | `.jess` `==` (type-equal) |
|---|---|---|
| `1 = 1px` | true | false |
| `2 = 2%` | true | false |
| `a = "a"` | true | false |
| `a = a` | true | true |
| `black = #000000` | true | true |

`=` coerces across representations; `==` additionally requires the same type.
This is verified against OPERATIONS.md §".jess expected" rows `j`/`j1`,
`l`/`l1`, `r`/`r1`.

### 5.2 Verification of the source columns

Every cell of OPERATIONS.md's Less and Sass outputs was re-run against
lessc 4.6.3 and dart-sass 1.101.0: **all 32 Less rows and all 31 Sass rows
reproduce exactly.** The `.jess` target column is therefore derived from
accurate source data.

Two facts the re-run surfaced that the document does not mention:

- dart-sass emits a **`slash-div` deprecation** for rows `g`, `g2` and `h`
  (`/` division outside `calc()`, to be removed in Dart Sass 2.0). Sass+ is
  defining behaviour for forms that are deprecated upstream.
- `1px * 10%` is **reordered** by Sass to `calc(10px * 1%)`. The `.jess`
  target preserves authored order (`calc(1px * 10%)`) — a deliberate divergence
  worth stating as one.

## 6. Outstanding questions

Ordered by whether they block work now.

### Blocking

- **O-TRUTH-1 (unresolved, critical path)** — **OPERATIONS.md does not cover
  truthiness at all.** It settles comparison and arithmetic, but never says what
  `@if $x` / `when ($x)` means for a bare non-boolean operand. This is the 42/109
  corpus blocker and the reason the grammar hold exists. `.jess` needs one
  answer: is a bare non-Boolean operand an **error** (proposed — `.jess` has a
  type system and `@if 0` taking the true branch is a footgun), or does `.jess`
  adopt Sass truthiness? Sass+ separately needs Sass truthiness to run real
  code, which under "no modes" means the **lowering** must inject the coercion.

- **O-TRUTH-5 (new)** — **The Sass `==` lowering is not statically decidable.**
  Sass `==` is unit-strict on numbers (→ `.jess` `==`) but quote-insensitive on
  text (→ `.jess` `=`, per OPERATIONS.md line 216). For `$a == $b` the operand
  types are not known until eval, so a syntactic operator substitution cannot
  choose. The "function-based compare primitives" note looks like the intended
  escape hatch: lower Sass `==` to a **named primitive** whose runtime dispatch
  is numbers-strict / text-loose, rather than to either operator. Confirm that
  is the intent — the alternative is accepting the moderately-breaking shift
  where Sass+ `a == "a"` becomes `false`.

### Semantics that need a `.jess` answer

- **O-TRUTH-6 (new)** — `t: $(a > b) // false` and `u: $(b > a) // false`, while
  `q: $(a = b) // false`. All three false means `.jess` relational is
  **non-trichotomous**: an author cannot distinguish "not greater" from "never
  comparable". §3.3 argues this is Less's defect rather than a dialect choice,
  and Sass raises here. Is silent-false deliberate for `.jess`?
  Related: OPERATIONS.md covers only *unquoted* `a > b`. Less returns **true**
  for quoted `"b" > "a"` (measured) while Sass errors — what is
  `$("b" > "a")`?

- **O-TRUTH-2** — `and` / `or`: Sass returns an **operand**, not a boolean
  (`1 and 2` → `2`, `null or 2` → `2`), and **short-circuits** (proven in §3.4).
  Jess's `evalGuard` currently evaluates both operands unconditionally.
  Operand-returning is more expressive (`$x: $a or $default`) but makes the
  result type depend on the inputs. Not covered by OPERATIONS.md.
  Short-circuiting should land regardless — required for Sass, unobservable in
  Less.

- **O-TRUTH-7 (new)** — `g2: $(2px / 1px) // 2` cancels units (following Sass),
  but `h: $(1 / 2px) // 0.5px` drops the inverse unit (following Less).
  Dimensionally those are inconsistent: if units cancel in `g2`, `1 / 2px`
  should carry `px⁻¹`, which is what Sass's `calc(0.5 / 1px)` expresses. Is
  `0.5px` intended?

- **O-TRUTH-3** — Less's `1in = 2.54cm` → **false** is a precision bug (they are
  equal by definition); Sass says true. Not in OPERATIONS.md. Does `.less`
  lowering reproduce the bug for byte-identity?
  Similarly `1px = 1PX`: Less **true** (units case-insensitive), Sass **false**.

- **O-TRUTH-4** — Sass list equality is separator-sensitive (`(1, 2) != (1 2)`).
  Does the native Collection model preserve separator identity? This interacts
  with the index-lookup primitive, since lookup is specified as loose.

- **O-TRUTH-8 (new)** — `null` is unaddressed: `null == false` is false in both
  engines, `1 + null` → `1` in Sass, and a `null` value **drops the
  declaration**. What does `.jess` do?

### Editorial

- **O-TRUTH-9** — OPERATIONS.md line 203, `h4: calc($(val / 2))`, is missing a
  sigil; presumably `$($val / 2)`.
- **O-TRUTH-10** — `h3: calc($val / 2)` → `calc(8px / 2)` ("Jess respects more
  authorship") diverges from Sass, which folds it to `4px`. Confirm this is
  inside the "moderately breaking" allowance for Sass+, since real Sass code
  relies on the fold.

## 7. Consequences for the code as it stands

- `EqualityMode` (`packages/core/src/types/modes.ts`, `condition.ts`
  `compareUnder`) is **slated for removal** under resolution 1. Its three
  behaviours do not disappear — they become the lowering targets, and
  `compareUnder`'s `less` / `sass` arms are the specification of what each
  front end must lower to. It should not be extended in the meantime.
- `guard.ts`'s `'truth'` node still decides truthiness by serializing the value
  and byte-comparing to `"true"`. Whatever O-TRUTH-1 resolves to, that should
  become a typed test; re-deriving meaning from emitted text is exactly what the
  architecture forbids elsewhere.
- `evalGuard`'s `and`/`or` need short-circuiting before Sass+ can be correct.

## 7. Reproducing

Both engines are already devDependencies; no new tooling is required. Probe from
`packages/jess` so `sass` and `less` both resolve, using `sass.compileString`
and `less.render` as described in §2.
