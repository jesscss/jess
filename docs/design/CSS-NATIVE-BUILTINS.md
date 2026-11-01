# Built-ins as their CSS-native form

**Status: DESIGN — ledger row V38 (OPEN; every question in section 5 ruled by
the owner on 2026-11-01).** Nothing here is built; section 4 is the build order. The inventory is
[`css-native-builtins.json`](./css-native-builtins.json).

## The requirement

Owner, 2026-11-01, verbatim:

> express all calculations functions that DO have CSS counterparts or can be
> represented by CSS counterparts as those abstractions internally. So for
> example, if a relative color syntax is supported, it's actually represented
> that way internally. This would ALSO solve a long-standing issue of it being
> counter-intuitive, once Custom properties were introduced, about why custom
> props can't go in something like the darken() function. But they COULD if
> darken() itself was represented by its CSS equivalent, and either resolved
> when values were known or printed the CSS function as-is if it couldn't. This
> would also match calc()'s current behavior of printing 'as-is' when it can't
> be calculated.

So a built-in with a CSS counterpart **is** that counterpart. `darken(C, 10%)`
is `hsl(from C h s clamp(0, l - 10, 100))`. When every input is known, the
compile resolves it to a colour, as today. When an input is known only to the
browser, the compile prints the CSS form.

What changes, measured against `dev` (`f2119a2d0`):

| Written | Today | Proposed |
| --- | --- | --- |
| `darken(#336699, 10%)` | `#264c73` | `#264c73` (unchanged) |
| `darken(var(--brand), 10%)` | `darken(var(--brand), 10%)` (invalid CSS) | `hsl(from var(--brand) h s clamp(0, l - 10, 100))` |
| `fade(var(--x), 50%)` | `fade(var(--x), 50%)` | `rgb(from var(--x) r g b / 0.5)` |
| `percentage(var(--p))` | `percentage(var(--p))` | `calc(var(--p) * 100%)` |
| `round(var(--x), 2)` | `round(var(--x), 2)`: valid CSS that rounds to a **multiple of 2** | `calc(sign(var(--x)) * round(abs(var(--x)), 0.01))` (Q4) |
| `mod(var(--x), 3)` | `mod(var(--x), 3)`: valid CSS with the **divisor's** sign | `rem(var(--x), 3)` (Q4) |
| `rgba(var(--rgb), .5)` | `rgba(var(--rgb), .5)` | unchanged: CSS channel-list idiom (§3.8) |
| `lightness(var(--x))` | `lightness(var(--x))` | unchanged: no CSS counterpart |

The `round` and `mod` rows are existing defects. In legacy-mode `.less` the Less
built-in is the author's request (P36), and a call printed as written there
already means something else to the browser.

Out of scope here: the browser runtime, `@export`, and the bundler. The runtime
work reads the `class` column of the inventory to decide what ships as JS: a
`none` row needs JS; every other row prints as CSS.

## 1. Inventory

Full table: [`css-native-builtins.json`](./css-native-builtins.json) (115 rows:
every registered Less colour/math built-in, and the Sass global and
`sass:color`/`sass:math` members). Classes:

- **exact** — the CSS form computes the same value for every input in the
  built-in's domain. 31 rows, including `mix`, `tint`, `shade`, `average` and
  Sass `mix`, which are `color-mix(in srgb)` by the Q1 ruling.
- **exact-if** — exact under one stated condition, usually "the deferred input
  is a `<number>`". 15 rows.
- **approx** — a CSS form exists but computes a different value for part of
  the domain. 1 row: `contrast()` (Q13).
- **already-css** — the built-in has the same name and meaning as a CSS
  function, so the call as written is already the CSS form (`sin`, `min`,
  `abs`, `sqrt` on numbers, `rgb`/`hsl` with three channels). 32 rows.
- **none** — no CSS form: channel readers (`hue()`, `red()`, `luma()`…),
  blend modes (`multiply`, `screen`…), string results (`argb`, `get-unit`,
  `unit()` in Sass), `random`. 36 rows. These stay as they are:
  resolved when known, printed as written when not.

Spec basis, per family (each row cites its section):

| Family | CSS form | Spec |
| --- | --- | --- |
| `lighten` `darken` `saturate` `desaturate` `spin` `greyscale`; Sass `adjust-hue` `complement` `grayscale` `color.adjust/scale/change` | `hsl(from C …)` | css-color-5 §4.4 (relative HSL: `h` in degrees, `s`/`l` numbers on 0–100) |
| `fade` `fadein` `fadeout`; Sass `opacify` `transparentize` `fade-in` `fade-out`; Less 2-slot `rgba(C, a)` | `rgb(from C r g b / …)` | css-color-5 §4.1 (omitted alpha = origin alpha; alpha clamped), §4.3 |
| Sass `invert` | `rgb(from C calc(255 - r) …)`, weighted via `color-mix()` | css-color-5 §4.3, §3 |
| `hsv` `hsva` | `hwb(H (1-s)v 1-v)` | css-color-4 §8 |
| `mix` `tint` `shade` `average` | `color-mix(in srgb, …)` | css-color-5 §3 (premultiplied, §3.5; default space Oklab, §3.1, so `in srgb` is written) |
| `percentage` `unit` `convert` Sass `math.div` | `calc()` | css-values-4 §10.9 (typed arithmetic) |
| `ceil` `floor` `round` | `round(up\|down\|nearest, …)` (+ `sign()`/`abs()`) | css-values-4 §10.3, §10.6 |
| `mod` | `rem()` | css-values-4 §10.3 |
| `min` `max` `abs` `sqrt` `pow` trig, Sass `log` `hypot` `clamp` | same name | css-values-4 §10.2–§10.6 |

## 2. The compile-time-resolution invariant

**RULE:** for a built-in whose class is `exact` or `exact-if`, the value the
compile resolves equals the value a browser computes for the CSS form the
compile would have printed, after output quantization (V4, V5). Stated over the
construct: *a built-in call and its CSS form are one value*. Only the spelling
differs: a resolved colour keeps its input's format (V10), as today.

Each built-in has one definition, its CSS form, and resolving means evaluating
that form (section 3). The evaluation is still Jess's own implementation of CSS
colour and math, so the invariant is pinned by a browser conformance test that
slice 1 adds and names (section 4), not assumed.

Where the Less meaning and a naive CSS form disagree, and how each is handled:

| Case | Difference | Handling |
| --- | --- | --- |
| **Clamping** (V14) | Relative-colour channels are *not* clamped (css-color-5 §4.1): `hsl(from C h s calc(l + 50))` can leave the sRGB gamut and the browser gamut-maps it (css-color-4 §11.2, §14). Less clamps the written channel to `[0, 1]`. | The CSS form writes the clamp: `clamp(0, l + A, 100)`. Alpha *is* clamped by CSS (§4.1), so the alpha family needs none. Every result stays in gamut. |
| **HSL vs sRGB round trip** | The browser takes `h s l` from the origin "after conversion, if required, to sRGB" (§4.4), and an `hsl()` colour resolves to sRGB (css-color-4 §2). Jess carries the authored HSL exactly (`Color.hsl`, V5). | For a chromatic origin, both sides use the same formulas (`rgbToHsl`/`hslToRgb`, `color.ts`): float ulps, below V4's 1e-10 tolerance and the byte rounding. **A grey a built-in computed keeps its hue in Jess:** `desaturate`/`greyscale` write `s = 0` and Jess carries the hue to the next call (`Color.hsl`), so `saturate(desaturate(#33cc33, 100%), 50%)` is `#40bf40` (green) today. In the browser each relative colour resolves to sRGB, a grey's hue is powerless (css-color-4 §4.4.1) and reads as 0, so the same chain is `#bf4040` (red). An authored grey `hsl(120, 0%, 50%)` already loses its hue in Jess (`saturate(hsl(120, 0%, 50%), 20%)` is `hsl(0, 20%, 50%)` today). Q9. |
| **`method: relative`** | Less scales the delta by the current channel. | Written into the form: `clamp(0, l - l * A / 100, 100)`; alpha: `calc(alpha - alpha * A)`. Exact. |
| **Precision** | The browser computes in floats. Jess runs `+ - *` in exact base 10 (V6). | A form resolves only when every operand is a resolved number (channel keywords replaced by the origin's channel values), and then runs through the same operation evaluator as Less math (`value-operate.ts` `operate`), so V6 applies and V36's operand rule never sees a keyword. An unresolved form is never operated: it is written out, as math inside a math function always is (F8). Differences stay below the output policy, except at decimal ties (the `round` row). |
| **Amount scale** | Less reads `10%` and `10` alike as 0.1. A relative `l` is a number on 0–100, so `l - 10%` is invalid (a number and a percentage don't add), and so is `alpha + 10%`. | A known amount is written as a number (`l - 10`, `alpha + 0.1`). A **deferred** amount needs typed arithmetic, `l - var(--a) / 1%` and `alpha + var(--a) / 100%`, which assumes the variable holds a percentage (Q2). |
| **`mix` alpha** | Less/Sass weight with `((w + a)/(1 + w·a) + 1)/2`, `a = a1 - a2`; `color-mix()` interpolates premultiplied (§3.5). Equal when the alphas are equal (and in some other cases); `mix(red, rgba(0,0,255,.5), 25%)` gives `[128,0,128]` vs `[102,0,153]`. Less also mixes **rounded** 0–255 operands (`colorRgbRounded`), ±1 byte for fractional channels. | Q1. |
| **`round` tie** | CSS `nearest` breaks ties toward +∞ (`round(-0.5, 1)` = 0); V8: half away from zero (−1). And decimal ties: the compile rounds `round(1.005, 2)` in base 10 to `1.01`, while a browser's float `1.005` sits just below the tie and rounds to `1`. | `calc(sign(N) * round(abs(N), B))` fixes the sign. The decimal tie stays a divergence (V8's open sub-question), so `round` is exact-if "N is not a decimal tie". `sign()`/`abs()` are Baseline 2025 (MDN). Q4. |
| **Nested `calc()`** | `calc(percentage(var(--p)))` would write `calc(calc(var(--p) * 100%))`. | Inside a math function a form's own `calc()` wrapper is not written: `calc(var(--p) * 100%)`. This is how V27 already writes kept math inside a math function. |
| **Result format** (V10) | The alpha kernel `withAlpha` (`color-helper.ts:52`) owns the rule that a translucent result retags hex to `rgba()` unless the source hex had an alpha digit. | When that kernel is deleted, the rule moves with it into the one function that picks a resolved form's output format. That function is shared by every colour form and is the only owner. Spelling only, unchanged bytes. |
| **`mod` sign** | Less `mod` is JS `%` (sign of the dividend). CSS `mod()` takes the divisor's sign, `rem()` the dividend's (§10.3). | `rem()`. Q4. |
| **Types CSS rejects** | CSS `sqrt`/`pow` take numbers only (§10.5); `round(A, B)` needs A and B of one type, B optional only for a number (§10.3); `rem` needs one type. Less keeps a unit (`sqrt(4px)` = `2px`, `mod(5px, 2)` = `1px`). | A *known* input still resolves as today. A deferred input of unknown type gets the number form, which is valid exactly when the variable holds a number (Q3). |
| **`asin`/`acos`/`atan`** | Less writes `rad`; CSS returns an `<angle>`. | Same quantity; already-css. |

## 3. Internal representation: a function IR

Owner, 2026-11-01, verbatim: *"we should reason about how the function works
internally... it should create intermediate representations of these functions
that can be passed around to other Less functions or serialized... meaning we
should also PARSE the functions probably to create their IR."*

### 3.1 What is missing today

The parser already gives CSS functions structure: `hsl(from …)` arrives as a
`FunctionCall` with a nested relative slot (F5, `nodes.ts:321`), `color-mix()`
as a `FunctionCall`, and math inside `calc()` as `Operation` nodes. Evaluation
then discards it. A call written out as-is becomes text at once
(`evaluator.ts` `fallbackCall` → `verbatimArgs` → a `Keyword` marked
`keepAsWritten`), and so does kept math (`value-operate.ts` `keptMath`, a
`WeakMap` from a `Keyword` to its bytes). The value domain
(`value-eval.ts:313`: `Dimension | Color | Quoted | Keyword | Any | UrlValue |
List | Block | Bool | Null | Collection`) has nothing that holds a CSS function
or an uncomputed operation as structure. So another function can only splice
the bytes, never read them.

### 3.2 The IR: the parse tree's two calculation kinds, as values

The value domain gains the evaluated twins of the two parse-tree kinds it
lacks, the way `Color` is the evaluated twin of a colour literal:

- **`Call`**: a CSS function, holding `name`, `args` (a `ValueGroup`, so an
  argument may itself be a `Call`), `result` (its CSS type: `color` for
  `hsl()`/`rgb()`/`hwb()`/`color-mix()`/`contrast-color()`/`light-dark()`, and
  for `calc()`/`clamp()`/`round()`/`rem()`/`abs()`/`sign()` the type
  css-values-4 §10.9 gives its arguments), and `src` (the authored bytes, or
  `''` when computed).
- **`Operation`**: arithmetic inside a math function that has not computed:
  `op`, `left`, `right`. It replaces `keptMath`'s bytes. Preserved math
  (`calc(1px + 1em)`, V18) becomes an `Operation` in a `calc` `Call`, the same
  value an authored `calc(1px + 1em)` evaluates to.

Every field is always present (factory-defaulted), so each kind is one hidden
class, as `Any` and `Keyword` already are. Neither duplicates an existing value
kind: `Keyword`/`Any` are text, `UrlValue` is one opaque function.
`keptAsWritten`'s text stays for calls nothing can compute: an unknown
function, a failed built-in.

The leaves an IR cannot compute are the values only the browser knows:
`var()`, `env()`, `attr()`, `currentcolor`, system colours. They are `Call`s
(or a `Keyword`) whose `result` is unknown (substitution) or `color`.

### 3.3 Built-ins are templates over the IR, written in `.jess` and parsed at build time

Each built-in with a CSS counterpart is defined by its CSS form, written as
`.jess` source over its parameters (shown here as `signature = form`; the
file's exact `.jess` spelling is a slice 2 detail):

```
darken($color, $amount)    = hsl(from $color h s clamp(0, l - $amount, 100))
fade($color, $amount)      = rgb(from $color r g b / $amount)
mix($a, $b, $weight: 50%)  = color-mix(in srgb, $a $weight, $b)
percentage($n)             = calc($n * 100%)
```

The `.jess` grammar parses each template once, at the `@jesscss/fns` build,
into the parse tree; the package ships that tree, so nothing is parsed at
runtime and no code is generated at runtime. Calling the built-in binds the
parameters to the evaluated arguments and evaluates the template, which
yields a `Call`. One definition per built-in: the JS kernel it replaces
(`hslAdjust`, the alpha arithmetic in `withAlpha`, `mixColors`) is deleted.

### 3.4 Resolving: an operated value computes, an authored one prints as written

This is V1 stated for the IR. A `Call` or `Operation` the author wrote prints
its `src` bytes unchanged (V1, F5, F8, V32). A built-in call is an operation:
it consumes its arguments, and its result is computed. A computed `Call`
resolves to a `Color` or `Dimension` when every leaf under it is known, using
the CSS definition of each function: relative `rgb()`/`hsl()`/`hwb()`
(css-color-5 §4), `color-mix(in srgb)` (§3), `calc`/`clamp`/`round`/`rem`/
`abs`/`sign` (css-values-4 §10). Otherwise it stays a `Call`. So:

- `darken(#336699, 10%)` → `#264c73`, as today.
- `darken(var(--x), 10%)` → the `Call`
  `hsl(from var(--x) h s clamp(0, l - 10, 100))`.
- `darken(color-mix(in srgb, red, blue), 10%)`: the authored `color-mix()` is
  consumed, its leaves are known, so the whole call resolves to a colour.
  Written on its own, `color-mix(in srgb, red, blue)` still prints as written
  (Q12).
- `darken(mix(var(--a), red), 10%)` nests:
  `hsl(from color-mix(in srgb, var(--a), red) h s clamp(0, l - 10, 100))`.

Where the browser's definition and Jess's earlier kernel differ, the
browser's definition wins. Section 2 lists each case; under E9 the confusing
old behaviour is dropped, not kept behind an option.

### 3.4a Choosing the form: the representation ladder

Owner, 2026-11-01, verbatim: *"if the value is known, or the weight is in a
range that we CAN represent as a simpler form, do it, and then if it needs a
longer sugared form, do that. and then beyond that, it becomes it's classic
representation (compile time plus JS module export)"*.

A built-in call takes the first rung that represents it exactly, given what
the compile knows:

1. **Every input known** → the resolved value (`tint(#777777, 13%)` →
   `#898989`).
2. **The simplest CSS form** that is exact for the known inputs
   (`tint(var(--c), 13%)` → `color-mix(in srgb, white 13%, var(--c))`).
3. **A longer CSS form** when the simple one cannot hold a known input
   (`tint(var(--c), -13%)` → relative `rgb()` with the extrapolation formula
   and a `clamp()`, because `color-mix()` rejects a negative weight).
4. **The classic representation**: the value computed at compile time where
   it can be, plus the JS runtime module export. That is the browser-runtime
   design's territory, not this one's (it reads the inventory to know which
   built-ins reach this rung). Until that runtime exists, rung 4 is today's
   behaviour: the call is printed as written, or an error under
   `functionMode: 'error'`. This document's reading; not an owner ruling.

An unknown input is taken to lie in the built-in's documented domain, as for
the amount (Q2) and the number form (Q3). So `tint(var(--c), var(--w))` takes
rung 2, `color-mix()`, which is valid while `--w` holds 0–100%.

The inventory row gives each rung's form (`css` for rung 2, `extended` for
rung 3); a row whose class is `none` has only rungs 1 and 4.

### 3.5 Serializing: once, at output

A `Call` turns into text only where output is written, by one emitter. So it
prints the same in a declaration, an interpolation (`evalInterp`), a selector,
a mixin argument and a guard operand (SEMANTIC-INVARIANTS 2), and compressed
output spells it with the compressed number and separator rules. Inside a math
function a `calc` `Call` drops its own wrapper (`calc(calc(x))` is never
written; V27). A paren group around a `Call` keeps its parens, as around any
call written out (J16). Structure travels with the value, so the eager
mixin-argument snapshot (`snapshotValues`, V3) keeps it without a side table.
The type predicates read `result` (`iscolor()` of a colour `Call`: Q10).

Later work can rewrite the IR before output, for example folding
`darken(darken(x, 10%), 5%)` into one relative colour. The runtime work can
walk it to find every `var()` a value depends on.

### 3.6 Which inputs fail

A built-in call fails, as today (`functionMode`, C17), only when an argument's
type is **known** and wrong (`darken(10px, 10%)`), or when the built-in has no
CSS form and an input is unknown (`lightness(var(--x))`, `argb()`). An unknown
function as an input (`darken(foo(1), 10%)`) maps like any other (Q6, ruled).

### 3.7 Scope by dialect

- **Legacy `.less`** (ambient built-ins, P36): yes.
- **Modern `.less` and `.jess`** (built-ins only by import, P17, P36): an
  unimported `darken()` stays an unknown CSS function, unchanged. An imported
  one (`@less.darken(var(--x), 10%)`, `$darken(…)`) is today a compile error
  (J1: a namespaced call can never be a CSS function); under this design it
  prints the CSS form (Q7). Q7 is not independent: a legacy `.less`
  `darken(var(--x), 10%)` converts to an imported `.jess` call, so if Q7 is
  "no", `.less → .css` prints the form and `.less → .jess → .css` errors.
- **`.scss`**: yes, the same as Less (Q5, owner 2026-11-01). The `.scss`
  dialect is Sass+, not canonical Sass, so Dart Sass rejecting
  `lighten(var(--x), 10%)` does not decide it.

### 3.8 CSS-shaped names keep their CSS reading

`rgb`/`rgba`/`hsl`/`hsla` with a `var()` argument are never rewritten:
`rgba(var(--rgb), .5)`, with `--rgb: 255, 0, 0`, is a common, valid CSS idiom
(owner-maintained golden `tests-unit/color-functions/rgba.css`). The Less
two-slot `rgba(C, a)` takes the relative form only for a deferred colour that
is not a substitution function (`rgba(currentcolor, .5)` →
`rgb(from currentcolor r g b / 0.5)`). The same holds for every already-css
name: a `var()` may expand to several arguments, and the call as written is
already right.

## 4. Slice plan

Each slice: ruled ledger text, `semantics-reviewer` and
`perf-architecture-reviewer` (core eval path), the Less corpus in all four
math modes plus the equivalence suite, byte-identical output for every input
that resolves today, and a browser check. The browser check puts each printed
CSS form on a test page with the custom property set to the known input and
compares `getComputedStyle` with what the compile resolves for the same input.

| # | Slice | Gated on |
| --- | --- | --- |
| 0 | Move the inventory into `packages/fns` and add a test that every registered colour/math `Fn` has exactly one row (the runtime work reads it). No output change. | — |
| 1 | The IR alone: `Call` and `Operation` value kinds, built where evaluation now writes text (`fallbackCall`, `keptMath`), one output emitter. No output change: every authored call and every kept operation prints the same bytes, proven on the full corpus. `perf-architecture-reviewer` on the new kinds. | — |
| 2 | Templates: the `.jess` template build step in `@jesscss/fns`, resolution of relative `hsl()`, the browser conformance test. Less `lighten` `darken` `saturate` `desaturate` `spin` `greyscale`; their kernels deleted. | — |
| 3 | Alpha family: `fade` `fadein` `fadeout`, two-slot `rgba(C, a)` (relative `rgb()`). | slice 2 |
| 4 | `hsv` `hsva` → `hwb()`. | slice 2 |
| 5 | Math: `percentage` `unit` `convert` `ceil` `floor` `round` `mod` (`calc`/`round`/`rem`/`sign`/`abs`), and math operators on an unknown operand → `calc()`. | — |
| 6 | `mix` `tint` `shade` `average` → `color-mix(in srgb)`, and the longer relative form for weights `color-mix()` cannot hold (§3.4a). | — |
| 7 | `contrast()` → `contrast-color()`; known inputs pick by the larger WCAG 2.1 contrast ratio. | — (the `contrast()` fixtures that move are listed for the owner) |
| 8 | Sass colour/math rows. | slices 2–6 |

## 5. Owner questions and rulings

- **Q1 — `mix()` with translucent colours.** `color-mix()` and Less `mix()`
  disagree when the alphas differ, and Less mixes rounded byte channels. (a)
  `mix` *is* `color-mix(in srgb)`: resolved output changes for translucent or
  fractional-channel mixes (fixture count to be measured first); (b) keep the
  Less formula when known and print `color-mix()` only when not, so known and
  unknown inputs disagree; (c) print `color-mix()` only for opaque operands,
  else as written. **Ruled (a), owner 2026-11-01, with no legacy flag.** Asked
  which algorithm causes less surprise (each colour counts by weight × opacity,
  as gradients and transitions blend, css-color-4 §12.3, against a weighting
  formula with no physical meaning), the owner agreed with (a); asked whether
  to keep the old weighting behind a flag, the owner agreed to leave it out and
  made that a rule: *"if the old behavior was confusing and a surprise, it's
  gone"* (ledger E9). So `mix`, `tint`, `shade`, `average` and Sass `mix` are
  `color-mix(in srgb, …)`, compile-time results included. In the Less test
  corpus every `mix`/`tint`/`shade`/`average` call mixes opaque colours or
  `transparent`, where the two rules agree; slice 5 measures this. Weights
  outside 0–100% are Q11.
- **Q2 — a deferred amount.** **Ruled as recommended, owner 2026-11-01 (sugar framing, below).** `darken(@c, var(--a))` needs the amount as a
  percentage (`l - var(--a) / 1%`); `spin(@c, var(--a))` needs a number. Assume
  the documented spelling (percentage for the HSL/alpha amounts, degrees as a
  number for `spin`)? Recommendation: yes; any other spelling is invalid at
  computed-value time, where today's output is invalid at every input.
- **Q3 — math on a deferred input of unknown type.** **Ruled as recommended, owner 2026-11-01 (sugar framing, below).** `ceil(var(--x))` →
  `round(up, var(--x), 1)`, valid only when `--x` holds a number (a length
  needs `1px`, and its unit is unknown). Print the number form? Recommendation:
  yes. Any declaration containing `var()` is already invalid only at
  computed-value time, so this is never worse than today.
- **Q4 — `round()` and `mod()` share a name with CSS functions that mean
  something else.** **Ruled as recommended, owner 2026-11-01 (sugar framing, below).** Print the Less meaning (`calc(sign(x) * round(abs(x),
  0.01))`, `rem()`)? This changes output that today is valid CSS with the wrong
  meaning. `sign()`/`abs()` are Baseline 2025; `round(x, 0.01)` alone differs
  only on negative exact ties. Recommendation: yes, with `sign()`/`abs()`.
- **Q5 — `.scss`. Ruled, owner 2026-11-01: the same as Less.** Asked whether
  `.scss` built-ins follow Dart Sass (an error) or this mapping, the owner
  answered *"Sass would be teh same way"*, and gave the reason: *"Because our
  Sass we call Sass+, not canonical Sass"*. So `.scss` `lighten(var(--x), 10%)`
  prints the CSS form, as `.less` does.
- **Q6 — unknown functions as inputs.** **Ruled against the recommendation, owner 2026-11-01 (sugar framing, below): `darken(foo(1), 10%)` prints `hsl(from foo(1) h s clamp(0, l - 10, 100))`.** Should `darken(foo(1), 10%)` print
  `hsl(from foo(1) …)` (forward-compatible with a future CSS colour function),
  or stay as written? Recommendation: stay as written; only the inputs listed
  in §3.6.
- **Q7 — imported built-ins.** **Ruled as recommended, owner 2026-11-01 (sugar framing, below).** `@less.darken(var(--x), 10%)` (and `.jess`
  `$darken`) stops being a compile error and prints the CSS form. Confirm.
  ("No" breaks the `.less → .jess` round trip for legacy `.less`, §3.7.)
- **Q8 — fixtures whose output moves** (all print as-written today). **Approved, owner 2026-11-01.**
  - `tests-unit/math-css-vars/math-css-vars.css` `e: percentage(var(--p))` →
    `calc(var(--p) * 100%)` (slice 4);
  - `tests-error/eval/percentage-css-var` → `calc(var(--x) * 100%)`, so it is no
    longer an error fixture under `functionMode: 'error'` (slice 4);
  - `tests-error/eval/color-func-invalid-color-2` and
    `packages/jess/test/less/function-mode.test.ts` (`darken(var(--baseColor,
    red), 50%)`) →
    `hsl(from var(--baseColor, red) h s clamp(0, l - 50, 100))`, likewise no
    longer an error (slice 1).

  Unchanged: `sin(var(--angle))`, `atan2(…)` (already-css),
  `rgba(var(--color-accent), 0.2)` (§3.8).
- **Q9 — a grey that a built-in computed.** **Ruled as recommended, owner 2026-11-01 (*"Yes, follow browser"*): a computed grey has no hue, as in the browser.** `saturate(desaturate(#33cc33,
  100%), 50%)` is `#40bf40` (green) in Jess today, because the hue survives
  the grey; the CSS form `hsl(from hsl(from #33cc33 h 0 l) h calc(s + 50) l)`
  is `#bf4040` (red) in a browser, because a grey has no hue. An authored grey
  `hsl()` already behaves the browser's way. Follow the browser for computed
  greys too? Recommendation: yes (one definition, and E9), after counting the
  fixtures that move. The Less corpus has no direct chain (a hue-reading
  built-in around `desaturate()`/`greyscale()`); a chain through a variable is
  measured in slice 2.
- **Q10 — type tests on a deferred colour.** **Ruled as recommended, owner 2026-11-01 (sugar framing, below).** Is `iscolor(darken(var(--x),
  10%))` true (it is a colour the browser computes) or false, as
  `iscolor(var(--x))` is today? Recommendation: true for a deferred built-in
  result, unchanged for a bare `var()`.
- **Q11 — mix weights outside 0–100%.** **Ruled, owner 2026-11-01, by the
  representation ladder (§3.4a).** `tint(#777777, -13%)` and
  `shade(#777777, -13%)` compute an extrapolated colour today
  (`tests-unit/functions/functions.less` `tint-negative`, `shade-negative`),
  and `color-mix()` rejects a negative percentage (css-color-5 §3.2). A known
  input still resolves, so those two fixtures do not move: `tint(#777777,
  -13%)` stays `#656565`. With an unknown colour, `tint` and `shade` take the
  longer relative form, which is exact for every weight because the other
  colour (white, black) is known:
  `rgb(from C clamp(0, r + W * (255 - r), 255) …)` for `tint`,
  `rgb(from C clamp(0, r - W * r, 255) …)` for `shade` (with the alpha terms
  `color-mix()` uses when `C` is translucent). `mix(a, b, W)` with `W`
  outside 0–100% takes the same form when one colour is known; with both
  colours unknown no CSS form exists, and the call takes rung 4. A negative
  `tint` is not the mirror of `shade`: `tint(#777777, -13%)` is `#656565`,
  `shade(#777777, 13%)` is `#686868`.

- **Q12 — an authored CSS function consumed by a built-in.** **Ruled as recommended, owner 2026-11-01 (*"yes"*).** With the IR,
  `darken(color-mix(in srgb, red, blue), 10%)` and `percentage(calc(0.5))` can
  resolve, because their leaves are known; written on their own they still
  print as written. Allow it? Recommendation: yes. It is V1 (a value prints as
  written until an operation consumes it), and it changes output only where a
  built-in today receives an authored `color-mix()`/relative colour/`calc()`
  (to be counted in slice 2).
- **Q13 — `contrast()` (Less only; Sass has none).** **Ruled as recommended, owner 2026-11-01: a known input picks by the larger WCAG 2.1 contrast ratio** (asked under the E9 principle; the owner answered *"agreed"*). With an explicit threshold argument a known input keeps the luma-threshold rule, and an unknown input with a threshold is a failed call. `contrast(C)` maps to
  `contrast-color(C)` (css-color-5 §8; Baseline 2026). Known dark/light
  colours `D`, `L` are selected without `if()`, by using the black/white
  result's red channel as a switch:
  `rgb(from contrast-color(C) calc(Dr + (Lr - Dr) * r / 255) … / calc(Da + (La - Da) * r / 255))`.
  CSS `if()` cannot do it: its conditions test style, media and support, not
  a colour's contrast. The threshold argument has no CSS form, so an unknown
  `C` with a threshold stays a failed call. Known and unknown inputs disagree:
  Less picks `L` when `C`'s luma is below 43%, while `contrast-color()` picks
  whichever of black and white contrasts more, by a UA-defined algorithm
  (under WCAG 2.1 contrast the switch is near 18% luminance). So
  `contrast(#999)` is `#ffffff` today, and `contrast-color(#999)` is black
  (7.4:1 against white's 2.8:1). No compile-time rule can equal a UA-defined
  one, so the row is `approx` whatever is chosen. Recommendation (E9): a known
  input picks by the larger WCAG 2.1 contrast ratio, the threshold argument
  being the only exception; this moves some of the 19 `contrast()` cases in
  `tests-unit/functions/functions.less` (to be counted).

### The owner's framing (2026-11-01): built-ins are sugar for CSS

The owner, verbatim: *"I think what we would do is actually reframe a lot of
Jess's functions and expressions as "syntactic sugar" for specific CSS
functions (and/or calc()), detail how those are mapped, and say that are simply
pre-calculated when we can. Therefore, no, a var() in many cases would no
longer error, as the function is just sugar-mapping and calculating-when-available."*

So each built-in (and each math operator) is a documented mapping to a CSS
function or `calc()`, precomputed when every input is known; the inventory is
the mapping table. Its consequences were put to the owner as one list, and the
owner answered *"yes that's what i meant"*:

- Q2, Q3, Q4, Q7 and Q10 as recommended;
- Q6 reversed: a built-in maps whatever it is given, so `darken(foo(1), 10%)`
  prints the CSS form; it fails only for an input whose type is **known** to
  be wrong (`darken(10px, 10%)`), or for a built-in with no CSS form given an
  unknown input (`lightness(var(--x))`, `argb()`);
- math operators are sugar for `calc()`: `(var(--a) * 2)`, today the compile
  error `eval/invalid-operand` (V36), becomes `calc(var(--a) * 2)`.

Not verified in this pass: browser support for relative colour syntax and for
typed arithmetic (`var(--a) / 1%`); the css-color-5 serialization of a relative
colour (§11.3); the Values 5 percentage normalization `color-mix()` cites; and
css-color-5's at-risk item "Relative Alpha Colors" (its effect on the
`alpha` keyword the fade family uses). Slice 1 checks each in a browser before
anything lands.
