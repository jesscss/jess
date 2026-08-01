# Comparison and truthiness — measured behaviour, and Jess's native rules

> **Status: DESIGN.** Every fact in §2–§4 is measured, not recalled. §5 records
> the owner's settled model from `packages/core/OPERATIONS.md` (no modes;
> `.jess` compiles as `.jess`), and supersedes an earlier mode-based proposal in
> this document. §6 is the open list.

## 0. The document set — which of these is authoritative

Three documents cover this work. They are not alternatives; they have different
jobs, and conflicts resolve in this order:

| doc | role | authority |
| --- | --- | --- |
| **`packages/core/OPERATIONS.md`** | owner-authored target semantics: the four resolutions, and the row-by-row `.jess expected` table for comparison and arithmetic | **CANONICAL.** Where anything disagrees with it, it wins. |
| **this document** | measured behaviour of dart-sass 1.101.0 and lessc 4.6.3, measured state of jess, and the open questions OPERATIONS.md does not answer | evidence and gap list; proposes nothing that contradicts OPERATIONS.md |
| **`css-math-model.md`** | the *grammar-level* defect — CSS math functions do not parse their arguments as math, so `calc(min(1em - 2px))` is rejected by the base | scoped to recognition only; its semantic sections defer to OPERATIONS.md |

Two things worth stating because they caused real confusion:

- **`OPERATIONS.md` was untracked** until it was committed alongside this
  revision — it existed only as an uncommitted file in one checkout. The
  canonical spec was not in version control and could not be referenced by
  commit.
- **`css-math-model.md` §D5 independently reconstructed OPERATIONS.md's `h3`/`h4`
  rule** ("Jess respects more authorship": `calc($val / 2)` → `calc(8px / 2)`,
  with `$( … )` as the explicit opt-in to fold) by reading AST v1 at `7b7d4e57c`
  and a 2025 commit message. That reconstruction was correct, but it was
  inference where a written spec already existed. Its semantic claims are now
  subordinate to OPERATIONS.md; what survives there is the recognition defect,
  which OPERATIONS.md does not cover and which blocks the rest — `min(100% -
  30px)` cannot preserve in `.jess` until it parses at all.

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

**Equality is already three-mode and already correct — but this document
previously named the wrong file, and the correction matters for anyone
implementing §5.**

The LIVE primitive is **`compare()` at `packages/core/src/ast/value-guards.ts:187`**
(`compare(op, left, right, equalityMode = 'less')`), reached through
`ValueEvaluator.compare` (`value-eval.ts:463`) → `evaluator.ts:129` →
`guard.ts:105`. Every dialect's guard, `@if`, `when(...)`, and logical-fn
condition funnels into that one function. Its three `equalityMode` branches are
`value-guards.ts:31-36` (unitless↔unit coercion), `:112-118` (sass
quote-insensitive), `:119-124` (less cross-kind byte equality); `'exact'` is not
a branch of its own — it is defined by matching none of the three.

`packages/core/src/tree/condition.ts` (`compareUnder`) is the **dormant legacy
duplicate**. `packages/core/src/index.ts:4` states the old tree classes are
"intentionally not exported". Its doc comments do assert the measured
divergences, so it remains readable as a specification, but it is not the code
that runs and must not be the code that is edited.

**Measured state of `.jess` (2026-08-01): all 22 comparison rows of
OPERATIONS.md's `.jess expected` block FAIL**, and for one cause — see §4.1.
Independent measurement confirms the divergence table above; what is missing is
not the comparison logic but its reachability.

### 4.1 Why no `.jess` comparison evaluates

`$(1 = 2)` emits `1 = 2`, not `false`. The jess grammar builds a `Condition`
node carrying both a real `GuardNode` and a verbatim `src`
(`jess-parser/src/grammar.ts:1974-1998`). Serialize then has two lanes, and the
value lane wins for a declaration value:

- typed lane, `serialize.ts:3019` — `evalGuard(...)` → `makeBool`. Evaluates.
- value lane, `serialize.ts:3323` — `return literal(node.src)`. Verbatim.

The value lane's comment states its premise: the logical fns read a condition's
guard directly, "so a `Condition` reaching this value lane is an UN-consumed
condition" — a mis-parse, e.g. `url(…charset=utf-8…)`. That premise holds for
Less and Sass, where a comparison only ever appears inside `boolean()`, `if()`,
or a guard. **It is false for `.jess`**, which by ledger P17 has no `boolean()`
at all, so `$( … )` is exactly where a comparison legitimately lands.

The `$( … )` boundary Block is transparent (`serialize.ts:~3300`) and does not
switch lanes. The fix is to make the value lane evaluate when an evaluator is
present, and keep `literal(node.src)` only as the `!e.ev` fallback — but the
mis-parse recovery the comment protects then needs a discriminator other than
"reached the value lane". `Block.boundary` already marks `$( … )` and is the
obvious candidate.

**`==` does not parse at all.** The three jess operator regexes
(`grammar.ts:1456`, `:1464`, `:2012`) are each `/>=|<=|>|<|=/` — no `==`, no
`!=`. `$(1 == 1px)` fails with "Unexpected Jess syntax."

**No `.jess` comparison assertion exists anywhere in the test suite**, which is
why a 22/22 failure went unnoticed.

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

- **O-TRUTH-5 — RESOLVED (owner, 2026-08-01).** The question was whether Sass
  `==` can be lowered by syntactic operator substitution. **It cannot**, and the
  owner's ruling is that the lowering *"should depend on what is being
  compared… sometimes it should lower to `=`, other times `==`"*.

  Sass `==` is unit-strict on numbers (`1px == 1` → false, which is `.jess`
  `==`) but quote-insensitive on text (`a == "a"` → true, which is `.jess` `=`).
  Neither `.jess` operator reproduces it alone, and for `$a == $b` the operand
  types are unknown until eval — so a front end cannot pick an operator.

  **Therefore the lowering target is a named compare PRIMITIVE, not an
  operator**: one whose runtime dispatch is numbers-strict / text-loose.

  **These primitives are CORE-INTERNAL FUNCTIONS, not stylesheet-callable
  functions** (owner, 2026-08-01). Nothing here becomes invocable from a
  `.less` / `.scss` / `.jess` source file, and no name enters any dialect's
  builtin registry — which would contradict ledger **P17** (`.jess` has no
  ambient builtin namespace) as well as adding public API nobody asked for. The
  primitives are TypeScript functions in `packages/core`, in the same
  not-exported class `index.ts:4` already describes for "compare/cast/lookup
  machinery".

  The architecture already has the right shape and needs only one change of
  carrier. `compare()` (`value-guards.ts:187`) is that internal function today,
  and the guard node `{ g: 'cmp', op, left, right }` already carries `op`. So
  the comparison KIND moves into the node the front end lowers to — `=` loose,
  `==` type-equal, and a Sass-equality kind that dispatches on operand type —
  and the `equalityMode` parameter threaded through `EvalModes` disappears.
  Same function, one more discriminated `op`, no runtime flag.

  Consequence for the architecture: "lowering, not modes" does **not** mean
  every dialect difference resolves at parse time. It means the difference is
  carried by *what the lowered node says*, rather than by a mode flag the
  evaluator consults from ambient config. A primitive may still dispatch on
  operand type at eval — that is its definition, not a mode.

  Note the same reasoning does **not** rescue Less: Less is numbers-loose and
  text-strict (`a = "a"` → false), while `.jess` `=` is loose on both. Under one
  set of semantics Less's text comparison shifts to true, which is inside
  resolution 4's allowance and is a real `.less` output change.

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

- `EqualityMode` (`packages/core/src/types/modes.ts`) is **slated for removal**
  under resolution 1. Its three behaviours do not disappear — they become the
  named primitives each front end lowers to (O-TRUTH-5). The live specification
  of those behaviours is `value-guards.ts:31-36`, `:112-118`, `:119-124`, NOT
  `tree/condition.ts` `compareUnder`, which is dormant. It should not be
  extended in the meantime.

  Removal is not confined to core: the mode is read or defaulted at
  `packages/config/src/options.ts:12,32,199`, `core/src/context.ts:252,274,400`,
  `core/src/ast/evaluator.ts:129`, `value-eval.ts:302`, the `.less` plugin
  (`jess-plugin-less/src/index.ts:32,331,401`) and the `.scss` plugin
  (`jess-plugin-scss/src/index.ts:52,67`). `.jess` sets none and therefore runs
  at the `'less'` fallthrough default today. `value-collection.ts:35,56` defaults
  to `'sass'` instead — an existing inconsistency that disappears with the mode.
- **`packages/fns` should CONSUME these primitives, not reimplement them**
  (owner, 2026-08-01). Core-internal does not mean core-only: `fns/` is an
  in-repo consumer and is expected to call the same compare/operate functions
  wherever a builtin needs to compare or operate on values. That is what makes
  "one set of semantics" true in practice rather than only in core.

  Measured today there is **one conformer and two bypasses**:

  | site | file:line | state |
  | --- | --- | --- |
  | Sass map fns (`map-get`, `map-has-key`, …) | `value-collection.ts:38` → `compare('=', …)` | **conforms** — though it defaults to `'sass'` where `compare()` itself defaults to `'less'`, an inconsistency the mode's removal deletes |
  | Sass `min`/`max` | `fns/src/sass/math/compare.ts:26` `compareSassNumbers` | **bypass** — a second numeric comparison with its own unit rules |
  | `.jess` / Less bracket lookup | `serialize.ts:4149-4152`, `DeclMap` as `Map<string, DeclEntry>` | **bypass** — keys are stringified and matched by BYTE identity |

  The lookup bypass is the one OPERATIONS.md calls out by name: `$foo['1px']`
  must match a `1px` dimension key *because lookup uses loose equality*. Today
  it compares `"1px"` bytes against `"1px"` bytes with no unit logic, so it
  happens to work for that spelling and would fail for `$foo[1px]` vs a `'1px'`
  key, or any unit-equivalent key. Converting it means the `Map` string identity
  becomes a fast path with a `compare`-based fallback, not a straight
  replacement — a scan is O(n) per lookup and this is a hot path.

- `guard.ts`'s `'truth'` node still decides truthiness by serializing the value
  and byte-comparing to `"true"`. Whatever O-TRUTH-1 resolves to, that should
  become a typed test; re-deriving meaning from emitted text is exactly what the
  architecture forbids elsewhere.
- `evalGuard`'s `and`/`or` need short-circuiting before Sass+ can be correct.

## 7. Reproducing

Both engines are already devDependencies; no new tooling is required. Probe from
`packages/jess` so `sass` and `less` both resolve, using `sass.compileString`
and `less.render` as described in §2.
