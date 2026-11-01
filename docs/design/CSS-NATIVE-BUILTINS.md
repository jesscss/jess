# Built-ins as their CSS-native form

**Status: PROPOSAL — ledger row V38 (OPEN).** Nothing here is built. Section 5
lists what the owner must rule before any slice lands. The inventory is
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
| `rgba(var(--rgb), .5)` | `rgba(var(--rgb), .5)` | unchanged: CSS channel-list idiom (§3.3) |
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
  built-in's domain. 26 rows.
- **exact-if** — exact under one stated condition, usually "the deferred input
  is a `<number>`". 15 rows.
- **approx** — a CSS form exists but computes a different value for part of
  the domain. 5 rows, all `color-mix()`: `mix`, `tint`, `shade`, `average`,
  Sass `mix` (Q1).
- **already-css** — the built-in has the same name and meaning as a CSS
  function, so the call as written is already the CSS form (`sin`, `min`,
  `abs`, `sqrt` on numbers, `rgb`/`hsl` with three channels). 32 rows.
- **none** — no CSS form: channel readers (`hue()`, `red()`, `luma()`…),
  blend modes (`multiply`, `screen`…), `contrast`, string results (`argb`,
  `get-unit`, `unit()` in Sass), `random`. 37 rows. These stay as they are:
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
| **HSL vs sRGB round trip** | The browser takes `h s l` from the origin "after conversion, if required, to sRGB" (§4.4), and an `hsl()` colour resolves to sRGB (css-color-4 §2). Jess carries the authored HSL exactly (`Color.hsl`, V5). | For a chromatic origin, both sides use the same formulas (`rgbToHsl`/`hslToRgb`, `color.ts`): float ulps, below V4's 1e-10 tolerance and the byte rounding. **A grey origin written with a hue diverges:** Jess keeps the hue of `hsl(120, 0%, 50%)`, while the browser stores grey sRGB, whose hue is powerless (css-color-4 §4.4.1) and reads as 0. So `saturate(hsl(120, 0%, 50%), 10%)` is greenish in Jess and reddish in the browser; `spin` likewise. Q9. |
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

## 3. AST shape

No new node kind. Three existing pieces carry it:

1. **The CSS form is a `FunctionCall`** (`core/src/ast/nodes.ts:321`), the node
   the CSS grammar produces for the same text, relative `from` slot included
   (F5's nested structured slot). A built-in that has a CSS form declares it as
   that node, its parameters as variable references bound to the call's
   arguments, the way a stylesheet-defined function binds its parameters. The
   template is built once per built-in, at module load, with core's node
   factories (no parse at runtime). The JS kernel the form replaces is
   deleted (`hslAdjust`, `withAlpha`'s alpha arithmetic, …): one definition.
2. **A built-in call resolves by evaluating its form.** The rule is stated over
   the construct, a *built-in call*: when every input is a resolved value, the
   call is its form evaluated over those values (relative `rgb()`/`hsl()`/
   `hwb()`, `color-mix(in srgb, …)`, `clamp`/`round`/`rem`/`sign`/`abs`/
   `calc`). That evaluator runs only as a built-in call's own evaluation. A CSS
   colour or math function written in the stylesheet is not a built-in call:
   it is printed as written, as today (V1, F5, F8, V32), and as an input to a
   built-in it is deferred (3.1). So no value prints two ways by who built it.
   `darken(color-mix(in srgb, red, blue), 10%)` prints
   `hsl(from color-mix(in srgb, red, blue) h s clamp(0, l - 10, 100))`.
3. **Unresolved, the form itself is written out**, with its resolved inputs
   substituted, by the emitter every written-out call uses (F11, compressed
   output included). Not `fallbackCall` over the built-in's own arguments,
   which writes `darken(…)` back, the defect this replaces. The result is a
   `Keyword` marked `keepAsWritten` (`value-operate.ts:638`), with a type fact
   (colour, or a numeric type) in the same side-table pattern as
   `keptAsWritten`/`keptMath`. No field is added to `Keyword`, so its hidden
   class does not change. A consumer reads the type fact to tell a deferred
   **colour** from a value that is not a colour. Nesting splices the inner
   form's bytes as the origin, without re-parsing them:
   `darken(darken(var(--x), 10%), 5%)` is
   `hsl(from hsl(from var(--x) h s clamp(0, l - 10, 100)) h s clamp(0, l - 5, 100))`.

### 3.0 One value in every position

A deferred form is one value with fixed bytes, so it prints the same in a
declaration, an interpolation (`evalInterp`), a selector, a mixin argument and
a guard operand (SEMANTIC-INVARIANTS 2). As a call written out as-is, a paren
group around it keeps its parens (J16). Two facts must travel with it, and
slice 1 tests each:

- the type fact survives the eager mixin-argument snapshot (`snapshotValues`,
  V3);
- the type predicates (`iscolor()` and the others) and `=` give the same
  answer whether a guard or a declaration reads them. What that answer is: Q10.

### 3.1 What counts as a deferred input

An argument makes the form print instead of resolve when it is a value only the
browser can compute **and** its CSS type can fill the parameter:

- an arbitrary-substitution function: `var()`, `env()`, `attr()`;
- for a colour parameter: `currentcolor`, a system colour, `light-dark()`,
  `color-mix()`, a relative colour, any CSS colour function the compile does
  not materialize as a `Color` (F5 materializes `rgb()`/`hsl()` channels; they
  stay resolved), or a deferred built-in result (above);
- for a numeric parameter: kept math (`calc(1px + 1em)` under `preserve`, V18)
  or a CSS math function written in the stylesheet.

Anything else keeps today's behaviour: `darken(10px, 10%)` is still a failed
call under `functionMode` (C17), and an unknown function such as
`darken(foo(1), 10%)` is still printed as written (Q6).

### 3.2 Scope by dialect

- **Legacy `.less`** (ambient built-ins, P36): yes.
- **Modern `.less` and `.jess`** (built-ins only by import, P17, P36): an
  unimported `darken()` stays an unknown CSS function, unchanged. An imported
  one (`@less.darken(var(--x), 10%)`, `$darken(…)`) is today a compile error
  (J1: a namespaced call can never be a CSS function); under this design it
  prints the CSS form (Q7). Q7 is not independent: a legacy `.less`
  `darken(var(--x), 10%)` converts to an imported `.jess` call, so if Q7 is
  "no", `.less → .css` prints the form and `.less → .jess → .css` errors.
- **`.scss`**: the owner has ruled `.scss` constructs to follow Dart Sass
  (`calc()` V32, `+` V36, `if()` 2026-10-19), and Dart Sass rejects
  `lighten(var(--x), 10%)`. Whether that covers these built-ins is Q5.

### 3.3 CSS-shaped names keep their CSS reading

`rgb`/`rgba`/`hsl`/`hsla` with a `var()` argument are never rewritten:
`rgba(var(--rgb), .5)`, with `--rgb: 255, 0, 0`, is a common, valid CSS idiom
(owner-maintained golden `tests-unit/color-functions/rgba.css`). The Less
two-slot `rgba(C, a)` takes the relative form only for a deferred colour that
is not a substitution function (`rgba(currentcolor, .5)` →
`rgb(from currentcolor r g b / 0.5)`). The same holds for every already-css
name: a `var()` may expand to several arguments, and the call as written is
already right.

## 4. Slice plan

Each slice: OPEN→ruled ledger text, `semantics-reviewer` and
`perf-architecture-reviewer` (core eval path), the Less corpus in all four
math modes plus the equivalence suite, byte-identical output for every input
that resolves today, and a browser check. The browser check puts each printed
CSS form on a test page with the custom property set to the known input and
compares `getComputedStyle` with what the compile resolves for the same input.

| # | Slice | Gated on |
| --- | --- | --- |
| 0 | Move the inventory into `packages/fns` and add a test that every registered colour/math `Fn` has exactly one row (the runtime work reads it). No output change. | — |
| 1 | Core: template `FunctionCall` on `Fn`, the built-in-call evaluation of relative `hsl()`, deferred-input detection, the type fact, the browser conformance test. Less `lighten` `darken` `saturate` `desaturate` `spin` `greyscale`; their kernels deleted. | Q2, Q6, Q7, Q8, Q9, Q10 |
| 2 | Alpha family: `fade` `fadein` `fadeout`, two-slot `rgba(C, a)` (relative `rgb()` fold). | slice 1 |
| 3 | `hsv` `hsva` → `hwb()` fold. | slice 1 |
| 4 | Math: `percentage` `unit` `convert` `ceil` `floor` `round` `mod` (`calc`/`round`/`rem`/`sign`/`abs` fold). | Q3, Q4 |
| 5 | `mix` `tint` `shade` `average` → `color-mix(in srgb)`. | Q1 |
| 6 | Sass colour/math rows. | Q5 |

## 5. Owner questions (nothing above lands without these)

- **Q1 — `mix()` with translucent colours.** `color-mix()` and Less `mix()`
  disagree when the alphas differ, and Less mixes rounded byte channels. (a)
  `mix` *is* `color-mix(in srgb)`: resolved output changes for translucent or
  fractional-channel mixes (fixture count to be measured first); (b) keep the
  Less formula when known and print `color-mix()` only when not, so known and
  unknown inputs disagree; (c) print `color-mix()` only for opaque operands,
  else as written. Recommendation: (a), because it is the requirement read
  literally and keeps one definition.
- **Q2 — a deferred amount.** `darken(@c, var(--a))` needs the amount as a
  percentage (`l - var(--a) / 1%`); `spin(@c, var(--a))` needs a number. Assume
  the documented spelling (percentage for the HSL/alpha amounts, degrees as a
  number for `spin`)? Recommendation: yes; any other spelling is invalid at
  computed-value time, where today's output is invalid at every input.
- **Q3 — math on a deferred input of unknown type.** `ceil(var(--x))` →
  `round(up, var(--x), 1)`, valid only when `--x` holds a number (a length
  needs `1px`, and its unit is unknown). Print the number form? Recommendation:
  yes. Any declaration containing `var()` is already invalid only at
  computed-value time, so this is never worse than today.
- **Q4 — `round()` and `mod()` share a name with CSS functions that mean
  something else.** Print the Less meaning (`calc(sign(x) * round(abs(x),
  0.01))`, `rem()`)? This changes output that today is valid CSS with the wrong
  meaning. `sign()`/`abs()` are Baseline 2025; `round(x, 0.01)` alone differs
  only on negative exact ties. Recommendation: yes, with `sign()`/`abs()`.
- **Q5 — `.scss`.** Apply this to `.scss`, or do the `.scss` rulings above
  (follow Dart Sass, an error) cover these built-ins? Recommendation: they
  cover it until the owner says otherwise; slice 6 waits.
- **Q6 — unknown functions as inputs.** Should `darken(foo(1), 10%)` print
  `hsl(from foo(1) …)` (forward-compatible with a future CSS colour function),
  or stay as written? Recommendation: stay as written; only the inputs listed
  in 3.1.
- **Q7 — imported built-ins.** `@less.darken(var(--x), 10%)` (and `.jess`
  `$darken`) stops being a compile error and prints the CSS form. Confirm.
  ("No" breaks the `.less → .jess` round trip for legacy `.less`, §3.2.)
- **Q8 — fixtures whose output moves** (all print as-written today):
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
  `rgba(var(--color-accent), 0.2)` (3.3).
- **Q9 — a grey `hsl()` written with a hue.** Jess keeps the hue of
  `hsl(120, 0%, 50%)`; a browser does not (§2). Should the resolved value
  follow the browser (`saturate`/`spin` of such a colour change output), or
  keep the authored hue and accept that known and deferred inputs differ here?
  Recommendation: follow the browser, after counting the fixtures that move.
- **Q10 — type tests on a deferred colour.** Is `iscolor(darken(var(--x),
  10%))` true (it is a colour the browser computes) or false, as
  `iscolor(var(--x))` is today? Recommendation: true for a deferred built-in
  result, unchanged for a bare `var()`.

Not verified in this pass: browser support for relative colour syntax and for
typed arithmetic (`var(--a) / 1%`); the css-color-5 serialization of a relative
colour (§11.3); the Values 5 percentage normalization `color-mix()` cites; and
css-color-5's at-risk item "Relative Alpha Colors" (its effect on the
`alpha` keyword the fade family uses). Slice 1 checks each in a browser before
anything lands.
