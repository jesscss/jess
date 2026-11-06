# Built-ins as their CSS-native form

**Status: DESIGN — ledger row V38 (OPEN; every question in section 5 ruled by
the owner on 2026-11-01).** Section 4 is the build order. The inventory is
[`packages/fns/src/css-native-builtins.json`](../../packages/fns/src/css-native-builtins.json).

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

Out of scope here: the browser runtime, `@expose`, and the bundler. The runtime
work reads the `class` column of the inventory to decide what ships as JS: a
`none` row needs JS; every other row prints as CSS.

## 1. Inventory

Full table: [`css-native-builtins.json`](../../packages/fns/src/css-native-builtins.json) (115 rows:
every registered Less colour/math built-in, and the Sass global and
`sass:color`/`sass:math` members; seven more rows name a second spelling of one
of them, `aliasOf`). Every other registered function is listed as out of scope,
and `packages/fns/src/__tests__/css-native-builtins.test.ts` fails when a
registered function is in none of the three. Classes:

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
colour and math, so the invariant is pinned by a browser conformance test, not
assumed: `packages/core/src/ast/__tests__/css-color.test.ts` (slice 2a) holds
each CSS form with the colour a browser computes for it (`getComputedStyle`,
the browser and version named in the test), and asserts that the compile
resolves the same colour.

Where the Less meaning and a naive CSS form disagree, and how each is handled:

| Case | Difference | Handling |
| --- | --- | --- |
| **Clamping** (V14) | Relative-colour channels are *not* clamped (css-color-5 §4.1): `hsl(from C h s calc(l + 50))` can leave the sRGB gamut and the browser gamut-maps it (css-color-4 §11.2, §14). Less clamps the written channel to `[0, 1]`. | The CSS form writes the clamp: `clamp(0, l + A, 100)`. Alpha *is* clamped by CSS (§4.1), so the alpha family needs none. Every result stays in gamut. |
| **HSL vs sRGB round trip** | The browser takes `h s l` from the origin "after conversion, if required, to sRGB" (§4.4), and an `hsl()` colour resolves to sRGB (css-color-4 §2). Jess carries the authored HSL exactly (`Color.hsl`, V5). | Measured in Chrome 152, the only browser measured: an origin that resolves in HSL keeps its own `h`, `s` and `l` when a relative `hsl()` reads it, a grey's, black's and white's included (`hsl()`, a relative `hsl()`, `color-mix(in hsl, …)`), and an origin that resolves in sRGB reads through sRGB, a grey's hue being 0 (hex, a named colour, `rgb()`, `rgb(from …)`, `color-mix(in srgb, …)`). Jess does the same for what it computes: `saturate(desaturate(#33cc33, 100%), 50%)` is `#40bf40`, `hue(desaturate(#33cc33, 100%))` is `120`, and `saturate(hsl(120, 0%, 50%), 20%)` is `hsl(120, 20%, 50%)`, while `saturate(#808080, 50%)` is red. `Q9`. Math on the 0–100 scale leaves rounding in a channel, which would move a colour that lands on a half byte, so a channel's change applies to the origin's exact value on 0–1 (`moved`, `css-color.ts`), V4's tolerance trimming the rounding; for that, a form has the kernel's bytes. A channel written with `*` or `/` changes by a percentage of the origin's channel, and any other by an absolute amount (`scalesChannel`). |
| **Out-of-range channels** | A colour can hold channels outside sRGB (`rgb(300, 0, 0)`, `#7249ff + #111`), and prints them clamped. | A known origin reads the channels it prints, so a call and its form are one value: clamped sRGB. Measured in Chrome 152: `darken(rgb(300, 0, 0), 10%)` is `rgb(204, 0, 0)`, `saturate(rgb(300, 0, 0), 10%)` stays `rgb(255, 0, 0)`, and `darken(#7249ff + #111, 25%)` equals `darken(#835aff, 25%)`. An in-range fraction a computed colour holds is not rounded first. |
| **Out-of-range `hsl()`** | The spelling decides what a channel reads. | Measured in Chrome 152: comma `hsl(120, 150%, 50%)` clamps, so `s` reads 100, and space-separated `hsl(120 150% 50%)` keeps it, so `s` reads 150; either spelling reads a negative as 0. Comma `hsl(120, 50, 50)` and `hsl(none, 50%, 50%)` are invalid, so not known. A consumer computes a comma channel, clamped (`isCssColorCall`, §3.4). A space-separated one outside 0–100 is out of the sRGB gamut, which the browser gamut-maps, so the call stays printed (slice 2a): `darken(hsl(120 150% 50%), 10%)` is `hsl(from hsl(120 150% 50%) h s clamp(0, l - 10, 100))`, and `fade(hsl(120 150% 50%), 50%)` is `rgb(from hsl(120 150% 50%) r g b / 0.5)`, whose `r g b` read outside sRGB (`color(srgb -0.25 1.25 -0.25 / 0.5)`). |
| **Out-of-range `rgb()`** | The spelling decides nothing. | Measured in Chrome 152: `rgb(300 0 0)`, `rgb(300, 0, 0)`, `rgb(150% 0% 0%)` and `rgb(150%, 0%, 0%)` compute `rgb(255, 0, 0)`, and a relative colour reads them clamped (`rgb(from rgb(300 0 0) calc(r - 100) g b)` has `r` 155 of 255); a negative reads 0 in either spelling. So both stay in gamut, and a consumer computes both. Comma `rgb(50%, 20, 30)` and `rgb(none, 20, 30)` are invalid, so not known to a consumer; space-separated `rgb(50% 20 30)` and `rgb(none 20 30)` are valid. `rgb(10 20 30 40)` is invalid. A relative `rgb()` is not clamped: `rgb(from #336699 calc(r + 300) g b)` is `color(srgb 1.37647 0.4 0.6)`, so it stays printed. Alpha clamps in every spelling. |
| **Out-of-range `hwb()`** | White and black outside 0–100%. | Measured in Chrome 152: there is no comma `hwb()`, and it is always in gamut. A negative reads 0 (`hwb(90 -25% 50%)` is `rgb(64, 128, 0)`), a sum over 100% normalizes to a grey (`hwb(90 80% 80%)` is `rgb(128, 128, 128)`), and neither is clamped above (`hwb(90 150% 50%)` is `rgb(191, 191, 191)`). So the `hsv` form always computes. |
| **`method: relative`** | Less scales the delta by the current channel. | Written into the form: `clamp(0, l - l * A / 100, 100)`; alpha: `calc(alpha - alpha * A)`. Exact. |
| **Precision** | The browser computes in floats. Jess runs `+ - *` in exact base 10 (V6). | A form resolves only when every operand is a resolved number (channel keywords replaced by the origin's channel values), and then runs through the same operation evaluator as Less math (`value-operate.ts` `operate`), so V6 applies and V36's operand rule never sees a keyword. An unresolved form is never operated: it is written out, as math inside a math function always is (F8). Differences stay below the output policy, except at decimal ties (the `round` row). |
| **Amount scale** | Less reads `10%` and `10` alike as 0.1. A relative `l` is a number on 0–100, so `l - 10%` is invalid (a number and a percentage don't add), and so is `alpha + 10%`. | A known amount is written as a number (`l - 10`, `alpha + 0.1`). A **deferred** amount needs typed arithmetic, `l - var(--a) / 1%` and `alpha + var(--a) / 100%`, which assumes the variable holds a percentage (Q2). |
| **`mix` alpha** | Less/Sass weight with `((w + a)/(1 + w·a) + 1)/2`, `a = a1 - a2`; `color-mix()` interpolates premultiplied (§3.5). Equal when the alphas are equal (and in some other cases); `mix(red, rgba(0,0,255,.5), 25%)` gives `[128,0,128]` vs `[102,0,153]`. Less also mixes **rounded** 0–255 operands (`colorRgbRounded`), ±1 byte for fractional channels. | Q1. |
| **`round` tie** | CSS `nearest` breaks ties toward +∞ (`round(-0.5, 1)` = 0); V8: half away from zero (−1). And decimal ties: the compile rounds `round(1.005, 2)` in base 10 to `1.01`, while a browser's float `1.005` sits just below the tie and rounds to `1`. | `calc(sign(N) * round(abs(N), B))` fixes the sign. The decimal tie stays a divergence (V8's open sub-question), so `round` is exact-if "N is not a decimal tie". `sign()`/`abs()` are Baseline 2025 (MDN). Q4. |
| **Nested `calc()`** | `calc(percentage(var(--p)))` would write `calc(calc(var(--p) * 100%))`. | Inside a math function a form's own `calc()` wrapper is not written: `calc(var(--p) * 100%)`. This is how V27 already writes kept math inside a math function. |
| **Result format** (V10) | A translucent result retags hex to `rgba()` unless the source hex had an alpha digit. | The one function that picks a resolved form's output format owns the rule, `spelled` (`css-form.ts`), shared by every colour form. A relative `hsl()` keeps its input's format, in legacy syntax. A built-in that names a format has it, in legacy syntax: `hsv` hex, `hsva` and two-slot `rgba` `rgb()`. Any other, the alpha family, keeps its input's format and syntax until the result is translucent. Q14 is open: this is spelling only, and no byte moved for it. |
| **`mod` sign** | Less `mod` is JS `%` (sign of the dividend). CSS `mod()` takes the divisor's sign, `rem()` the dividend's (§10.3). | `rem()`. Q4. |
| **`%`** | CSS math has no `%` operator. Less `%` is JS `%`, the dividend's sign. | `rem()`, as `mod` is, wherever an operand is only the browser's: `(var(--a) % 3 * 2)` is `calc(rem(var(--a), 3) * 2)`, and in a math function too (`calc(var(--a) % 3)` is `calc(rem(var(--a), 3))`). A lone `%` over an unknown in a `calc()` is never printed as `calc(... % ...)`; a `%` after other math in one is a known gap below. Known operands in a `calc()` stay as written (`calc(10 % 3)`). |
| **Bare `/` under `math: always`** | With every operation math, a CSS separator reads as a division. | Under `math: always` a slash is division, whatever its operands (ledger P34, P35), so known numbers compute and an unknown prints `calc()`: `grid-row: 1 / var(--x)` is `calc(1 / var(--x))`, `font: 12px / var(--lh) Arial` is `calc(12px / var(--lh)) Arial`. A known keyword or `url()` beside it stays as written, as does every slash before it in the chain (`url(a.png) center / var(--s)`, `grid-column: var(--a) / span 2`, `content: "a" / @x`, `repeat(2, 1fr) / var(--x)`, `1 / var(--c) / span 2 / span 3`). Two known numbers beside a chain divide as they do in `span 2 / 3`, so `1 / var(--c) / span 2 / 3` is `1 / var(--c) / span 0.6666666667`. **The cost, measured in Chrome 152.** Known: `font: 12px/1.5 Arial` is `8px Arial`, `grid-row: 1 / 3` is `0.33333333333`. Unknown: `font: 12px/var(--lh) Arial` loses the font when `--lh` is a length and is `8px Arial` at `1.5`; `border-radius: var(--a) / var(--b)` computes to `0px`; `background: url(a.png) 0 0 / var(--s)`, `border-image: url(a.png) 30 / var(--w)` and `grid-template: 100px / var(--c)` compute to `none`; `grid-row: 1 / var(--x)` computes to `auto`; `grid-area: 1 / 2 / 3 / var(--d)` prints `calc(0.16666666667 / var(--d))`, which computes to `auto`. The default `parens-division` keeps all of them as written, as do the other modes. Printing `calc()` for an unknown is a deliberate change under `always` only: before it, an unknown kept the slash as written. |
| **A unit CSS does not define** | `unit(5px, foo)` is known and prints `5foo`. | Over an unknown there is no form (`calc(var(--x) * 1foo)` is invalid), so `unit(var(--x), foo)` and `convert(var(--x), foo)` stay written out. The table of CSS units is `isCssUnit` (`value-units.ts`). |
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
`keepAsWritten`), and so did kept math, a `WeakMap` from a `Keyword` to its
bytes, until slice 5. The value domain
(`value-eval.ts:313`: `Dimension | Color | Quoted | Keyword | Any | UrlValue |
List | Block | Bool | Null | Collection`) has nothing that holds a CSS function
or an uncomputed operation as structure. So another function can only splice
the bytes, never read them.

### 3.2 The IR: calls and kept math, as structure on the value

The evaluated value keeps the parse tree's two calculation kinds as
structure:

- **A call written out as-is** (`fallbackCall`: a CSS or unknown function, a
  built-in that could not compute, a built-in's CSS form) is the value kind
  `FunctionCall` (`value-eval.ts`): the evaluated twin of the parse tree's
  `FunctionCall`, as the value `Color`, `Dimension`, `Keyword`, `Quoted` and
  `List` are of theirs (owner, 2026-11-01, asked whether the call is "like a
  FunctionCall": *"yeah do that i think"*). It holds the name, the evaluated
  arguments as written (members may be calls in turn), the CSS type the call
  produces and its bytes. The type follows from the name: `color` for
  `hsl()`/`rgb()`/`hwb()`/`color-mix()`/`contrast-color()`/`light-dark()` and
  the other colour functions; `numeric` for a css-values-4 §10 math function,
  whose exact type §10.9 gives its arguments; unknown for `var()` and an
  unknown function. Anything that does not ask for the structure reads it as
  the keyword that spells it: a parameter typed `Keyword` accepts it,
  `iskeyword()` is true of it, Sass `type-of()` calls it a string, and an
  argument error names `Keyword`. A parameter whose type includes
  `FunctionCall` takes it, when its type is unknown or the parameter's
  (`value-dispatch.ts`); a call of a known, wrong type fails the parameter
  (§3.6). A built-in's deferred result is marked `computed`, so `iscolor()`
  of it is true and `iskeyword()` false (Q10), while an authored
  `iscolor(hsl(from var(--c) h s l))` stays as it was. A paren group around a
  call is that call, its parens in its spelling until a callable reads the call
  inside them (J16). Built in slice 2b, replacing the `KeywordCall` slice 1 hung
  on the keyword.
- **Kept math**: arithmetic that has not computed, the `Arithmetic` value
  (`op`, `left`, `right`, `value-eval.ts`). Preserved math (`calc(1px + 1em)`,
  V18) is that structure in a `calc` call, the same value an authored
  `calc(1px + 1em)` evaluates to, as is math on an operand only the browser
  knows (`calc(var(--a) * 2)`). Built in slice 5.

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

As built: the source is `packages/fns/src/less/css-forms.jess`, an ordinary
stylesheet function per form (`$darken: @($color, $amount) > { result: …; }`),
a `relative` form beside each absolute one. `pnpm build:forms` writes the parse
tree as `css-forms.generated.ts`, committed, built by `@jesscss/core/ast`'s
constructors (V8 invariant 12), and a test keeps it equal to the parse of the
source. `defineForm` (`packages/core/src/ast/css-form.ts`, on the subpath
`@jesscss/core/form`, as a form needs the evaluator and `@jesscss/core/value`
stays without it) binds the arguments and evaluates the form's `result:` as a
stylesheet function's (`evalForm`), on a lane of its own with no function
registered: every call in a form is CSS, and the form is not in the document that
called it. A form is one `result:`; the build rejects any other body, since one
activation serves every call. A known origin decides first, reading the same
channels `resolveColorCall` does, and an unknown input prints the form; the one function
that spells a resolved form's result is `spelled`.

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

### 3.5 Serializing: once

A call's bytes are written once, when the call is made, compressed under
`compress`: a call written out as-is by `verbatimArgs`, a CSS-shaped colour
call kept as authored by `preserveCall`, a kept `calc()` by `evalCalc`. So it
prints the same in a declaration, a selector, a mixin argument and a guard
operand (SEMANTIC-INVARIANTS 2), and compressed output spells it with the
compressed number and separator rules. An interpolation (`evalInterp`) spells a
call written out as-is its own way, which predates this design and is unchanged;
it has not been brought under this rule. Inside a math
function a `calc` `Call` drops its own wrapper (`calc(calc(x))` is never
written; V27). A paren group around a `Call` keeps its parens, as around any
call written out (V38); a callable reads the call inside them, so a form's slot prints it bare (J16). Structure travels with the value, so the eager
mixin-argument snapshot (`snapshotValues`, V3) keeps it without a side table.
The type predicates read the call's CSS type (`iscolor()` of a colour call: Q10).

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
already right. An exposed variable is not that `var()`: the compile knows its
value's type, so `@less.rgba(@brand, .5)` with `@brand: #c00` takes the relative
form over it (R8), and `@less.rgb(@r, 0, 0)` with `@r: 10` is
`rgb(var(--r, 10), 0, 0)`, which is valid CSS with no form at all. A wrong value
fails the slot it is in, at the compile.

A channel written in parens of its own is invalid CSS in Chrome 152 in every
position, as printed. A consumer still reads the value inside the group (J16, F4):
`fade(hsl((@h + 1) 50% 50%), 50%)` computes, as does `fade(rgb((10) 20 30), 50%)`,
in every spelling. Parens in Less are how math is written in a space-separated
channel under `parens` and `strict`.

An export's unit decides whether its slot's form means what it computes to
(`fits`, the one answer to whether a form holds a value there, given the value and
the call's other arguments; a slot without it has no form): `@r: 10` in
`@less.rgb(@r, 0, 0)` prints the form, and `@r: 2px` keeps its recipe, which computes `rgb(2, 0, 0)`. A known channel of a unit CSS does
not take beside a `var()` fails: `@less.rgb(var(--r), 1px, 0)`.

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
| 1 | The IR for calls: a call written out as-is (`fallbackCall`) carries its `call` (§3.2). No output change, proven on the full corpus. Kept math's structure moves to slice 5. Still text, with `call: null`: a CSS-shaped colour call kept as authored (`preserveCall`), a kept `calc()` (`evalCalc`), CSS `if()` (`pickIfValue`), a call inside a `var()` fallback, and a paren group around a call (`(var(--a))`). Slice 2 gives each the structure its built-ins read, with the Q12 cases. | — |
| 2a | Resolution of a modern `hsl()` a consumer demands, when its callable wrote it out as-is (`packages/core/src/ast/css-color.ts`): absolute and relative, the channel keywords bound to the origin's sRGB values while the channels evaluate, so the math in them is Less math (§2 Precision), typed as CSS math (`l - 10%` and `h + 30deg` are not CSS, so they stay unresolved). Unresolved, and printed as written, when the origin or a channel is unknown, the alpha has no `/`, a channel fails only bound (`calc(l / 0)`), or the saturation or lightness leaves 0–100 (out of the sRGB gamut, which the browser gamut-maps). A resolved colour keeps the written spelling until an operation consumes it (V1), so a mixin argument prints it as before. A colour function in a channel binds its own channels. A callable that computes the call itself (Sass `hsl()` on an absolute colour) still does. The browser conformance test. The Q12 relative-colour case; no corpus fixture moves. Q14 is open. | — |
| 2b | Templates: the `.jess` template build step in `@jesscss/fns`, and the `FunctionCall` value kind (§3.2). Less `lighten` `darken` `saturate` `desaturate` `spin` `greyscale`; their kernels deleted. `clamp()` resolves in a channel. An exposed variable in the colour slot prints the form over its `var()` (R8). An unknown *amount* (`darken(@c, var(--a))`) stays exactly as it was until slice 5. A callable reads the call inside a paren group, which is also what `@v: (var(--x)); lighten(@v, 5%)` reads (J16): `lighten((var(--x)), 5%)` is `hsl(from var(--x) h s clamp(0, l + 5, 100))`, since `hsl(from (var(--x)) …)` is invalid CSS in Chrome 152. Parens around a written-out form stay (V38). A method only the browser knows cannot pick a form, so `darken(var(--c), 10%, var(--m))` stays written out, as does the same call on a known colour. Still text, so it fails a colour parameter as before: a kept `calc()`. A CSS colour call its callable cannot compute is written out under every `functionMode` when a consumer demands it, so only a known wrong type fails (§3.6). Slice 6 gives `color-mix(in srgb, red, blue)` its evaluation. Sass rows are slice 8. | 2a |
| 3 | Alpha family: `fade` `fadein` `fadeout`, two-slot `rgba(C, a)` and `rgb(C, a)` (relative `rgb()`); their kernels deleted, and the format rule in `spelled` (§2). A known origin reads `r`, `g`, `b` and `alpha` on the evaluator path `hsl()` reads its channels on, so a consumer computes `rgb()` in any spelling, `rgb(10 20 30)` and `rgb(from …)` included (`resolveColorCall`). `rgba(var(--rgb), .5)` and `rgba(foo(1), .5)` stay written (§3.8), as do a space-separated `rgba(#f00 .5)`, an unknown alpha (slice 5) and a method only the browser knows. What moved against the old kernels, each read against the form in Chrome 152: a space-separated colour as the input, which was written out; a named or computed colour in two-slot `rgba()`, which was written out and invalid; a chain of the family, where the browser clamps each result and the kernel clamped only the last, so `fadein(fadeout(#336699, 150%), 20%)` is `rgba(51, 102, 153, 0.2)`, not `rgba(51, 102, 153, 0)`, and the in-range `fadeout(fadein(#336699, 10%), 5%)` is `rgba(51, 102, 153, 0.95)`, not `#336699`. An authored alpha out of range clamps first: `fadeout(rgba(1, 2, 3, 1.5), 10%)` was `rgb(1, 2, 3)`, now `rgba(1, 2, 3, 0.9)`. A consumer outside the family reads the alpha the form computes: `multiply(fade(#336699, 150%), #888)` was `#000e36`, now `#1b3652`, and `argb(fade(#336699, 150%))` was `#17f336699`, now `#ff336699` (Chrome 152 reads `rgb(from #336699 r g b / 1.5)` as alpha 1). A channel out of range clamps on the way through: `fade(rgb(300, 0, 0), 50%) - #ff0000` was `#2d0000`, now `#000000`. Compressed, `fadeout(#33669980, 100%)` was `#33669981`, from a negative alpha, and is now `#3690`, alpha 0, as the form reads. An authored `rgb()` is a colour to whatever computes on it: `iscolor(rgb(1 2 3))` was `false`, now `true`; `rgb(1 2 3) + #111` was an error, now `#121314`; `.a when (rgb(1 2 3) = #010203)` did not match, and now does. An absolute call's channels that computed are read from what the call evaluated, so `fade(rgb(next() 2 3), 50%)` calls `next()` once; a relative channel evaluates again with the origin's keywords bound. | slice 2 |
| 4 | `hsv` `hsva` → `hwb()`, computed through sRGB, so `saturate(hsv(120, 0, .5), 50%)` reads a grey's hue as 0, as `hsl(from hwb(120 50% 50%) …)` does. Only a hue the browser knows prints the form, with white and black computed first: `hsv(var(--h), 50%, 75%)` is `hwb(var(--h) 37.5% 25%)`. An unknown S or V may hold a percentage, which that math cannot read in CSS, so it stays written, with an unknown alpha, until slice 5. The form is `hsv` exactly for S and V in 0–100%. Outside it the kernel's arithmetic was its own, and a known input now computes what the form computes (`hsv(90, 150%, 50%)` was `#208000`, now `#408000`). At half-byte ties a known input moves to Chrome's byte (`hsv(0, 80%, 50%)` was `#801919`, now `#801a1a`). | slice 2 |
| 5 | Math: `percentage` `unit` `convert` `ceil` `floor` `round` `mod` (`calc`/`round`/`rem`/`sign`/`abs`), and math operators on an unknown operand → `calc()`. Their forms in `css-forms.jess`, computed on known inputs through the one evaluator; only `convert`'s conversion is still a kernel, its form `calc(N)` having none. Kept math is the `Arithmetic` value in a `calc` call (§3.2), replacing `keptMath`. A deferred amount (Q2) in `darken` `lighten` `saturate` `desaturate`, and `spin`'s as a number. A unit or a method only the browser knows has no form, so `unit(5px, var(--u))` and `convert(5px, var(--u))` stay written out. An exposed variable takes a form when its value is what the slot's form assumes (`fits`: a number, `%`, the unit of the argument beside it for `mod`, no dimension in a colour's slot, a weight `color-mix()` holds; it reads the number a `calc()` over known numbers computes to, and a read inside a larger argument, `@less.ceil((@a * 2))`, by what the argument computes to, where a slot it does not fit is the existing diagnostic, no recipe following such a read), and otherwise keeps its runtime recipe, so `@a: 10%` in `darken(#c00, @a)` prints the form and `@a: 10` the recipe. `isnumber()` of a math form is true and `iskeyword()` false (Q10). An authored `calc()` a parameter typed as a number takes resolves when the compile can compute it (Q12): `percentage(calc(0.5 + 0.5))` is `100%`; `calc(1px + 1em)`, `calc(1 / 0)` and a leaf only the browser knows stay as they are, and an unconsumed `calc()` prints as written. A form over a value whose type its structure gives is valid CSS of that type: the step and divisor take its unit (`ceil(percentage(var(--x)))` is `round(up, var(--x) * 100%, 1%)`), and a built-in that drops a unit divides it out (`percentage(var(--x) + 1px)` is `calc((var(--x) + 1px) / 1px * 100%)`); the number form is for a type structure does not give (Q3). Math on an exposed variable of a known wrong type (colour, keyword, string, list) fails with `eval/invalid-operand`, as on the value (V36); an exposed number or unit is `calc()`. Other classes this slice moves: math on an unknown or failed function operand is `calc()` (`foo(1) + 1`, `lightness(var(--x)) * 2`, `min(1px, 1em) * 2`), and `-@a` over a `var()` is `calc(-1 * var(--x))`; `calc(calc(1) + calc(2))` keeps its wrapper (was `calc(1) + calc(2)`); **a string keeps its quotes around a lone interpolation of kept math** (`"@{p}"` is `"calc(1px + 1em)"`, was unquoted); **`unit(5px, var(--u))` and `convert(5px, var(--u))` are written out** (were `5var(--u)` and `5px`, the argument vanishing); **a direct positional JS call of a form built-in throws** (`percentage(dim)` imported from `@jesscss/fns/less`, as slice 2b's colour forms do), a call through a registry or a stylesheet being unaffected. Fix-pass classes, against the state before slice 5: **`%` over an unknown is `rem()`** (§2), also inside a math function (`calc(var(--a) % 3)` was as written, `max(var(--a) % 3, 1)` likewise); **under `math: always` a bare slash follows known division unless a known non-numeric operand makes it a separator** (§2; `grid-row: 1 / var(--x)` and `font: 12px / var(--lh) Arial` are `calc()`); **a group of math in a call written out is a `calc()`**, at any depth of a space or slash list (`translate((var(--a) * 2), 1px)`, `foo((var(--a) * 2) 1px)`, `foo(1px / (var(--a) * 2))`, `lch(50% 20 (var(--h) + 1))`, `foo(@v)` with `@v: (var(--x) * 2)`, and a grouped colour channel a form reaches, `darken(hsl((@h + 1) 50% 50%), 5%)`); **a glued minus on a built-in that wrote a form is `-1 *`** (`-percentage(var(--x))` is `calc(-1 * var(--x) * 100%)`, `(-var(--x) + 1)` is `calc(-1 * var(--x) + 1)`; a bare `-var(--x)` and `-percentage(0.5)` stay written); **a function of no number type as an operand is kept too** (`(linear-gradient(red, blue) * 2)` failed and is `calc(linear-gradient(red, blue) * 2)`; the same `calc()` as written was already kept, CSS's own math being kept by the operand rule). A glued minus in a slot of a form is `-1 *`, as CSS has no such function token (`ceil(-var(--x))` is `round(up, -1 * var(--x), 1)`). `%` over a comma list fails as `*` does. A math call the compile did not write claims no unit, so `ceil(max(var(--x), 1px))` and `ceil(asin(var(--x)))` take the number form. A `calc()` resolves for a built-in only where CSS math types it: `percentage(calc(1px * 2px))`, `percentage(calc(10 % 3))`, `ceil(calc(1px * 1em))` and `ceil(calc(4px / 2em))` stay written, and `min(calc(3px), 3px)` is `3px` as `min(calc(1px + 1px), 3px)` is `2px`. Under `unitMode: 'strict'` a known operand with units that do not combine fails before kept math takes it (`(1px * 1em * var(--x))`, and `(min(3foo, 1%) % (1000rem / 7cm))`, formerly folded into the text). A number a form computes runs in exact base 10, so a later operation can move digits (`mod(percentage(33.3cm), -1.5cm)` is `0%`, was `1.5%`). Known gaps: `var(--z, @v)` with `@v: (var(--x) * 2)` keeps the parens, a `var()` fallback being spliced as text; and so does a colour call written out on its literal lane, `hsl((@h + 1) 50% 50%)` as a bare value, and a lone group `hsl((@h) 50% 50%)`. Accepted as they are: under `strict`, `(var(--x) * 1px * 1em)` prints `calc()`, the unknown deciding; bare math in a call written out stays written (`translate(var(--a) * 2, 1px)`), only a group being math there; `foo(@v)` with `@v: var(--x) * 2` is `foo(var(--x) * 2)` beside `z: @v`'s `calc()`; and `(1 + -percentage(0.5))` prints `calc(1 + -percentage(0.5))`. An alpha amount only the browser knows has no form yet, so `fade(#333, var(--a))` stays written (follow-up). `.scss` does not move (slice 8). `.css` does not move. | — |
| 6 | `mix` `tint` `shade` `average` → `color-mix(in srgb)`, and the longer relative form for weights `color-mix()` cannot hold (§3.4a). Their kernels (`mixColors`, the `average` blend) are deleted; a known input computes `color-mix()` on the evaluator (`css-color.ts`), for a built-in's weight outside 0–100% too, extrapolated and clamped, which is what its relative form computes. The printed forms: `mix(C, K, 25%)` is `color-mix(in srgb, C 25%, K)`; `mix(C, K)` and `average(C, K)` are `color-mix(in srgb, C, K)`; `tint(C, 13%)` is `color-mix(in srgb, white 13%, C)`; `shade` the same with `black`; `tint(C)` and `shade(C)` write their default, `50%`. A weight in any unit is a percentage, as it was (`mix(C, K, 25px)` prints `25%`). What only the browser knows in the weight is taken to hold one: `tint(C, var(--w))` is `color-mix(in srgb, white var(--w), C)`. A weight outside 0–100% with a colour not known takes the relative form over that colour, with the known one premultiplied into its numbers, so it holds a translucent `C`: `tint(var(--c), -13%)` is `rgb(from var(--c) clamp(0, (r * alpha * 1.13 + -33.15) / (alpha * 1.13 + -0.13), 255) … / calc(alpha * 1.13 + -0.13))`. Beyond the range a colour with `none` counts as known and reads `none` as 0, as a relative colour's origin does, where inside the range the browser takes the other colour's value, a jump at the edge the owner has yet to rule on: `mix(rgb(none 0 0), red, 100%)` is 255, 0, 0, and `101%` is 0, 0, 0. With both colours not known no form exists: rung 4, on the runtime when they are exposed variables; a call that names no export is not the CSS function it names, so it fails: written as it was in the default `functionMode`, `eval/invalid-function` under `functionMode: 'error'` and when imported (`@less.mix(var(--a), var(--b), 150%)`, `$mix(…)`). A colour written with `none` is not known to a mix (css-color-4 §12.2: a missing channel takes the other colour's value, which the browser computes), so `mix(rgb(none 0 0), red)` is `color-mix(in srgb, rgb(none 0 0), red)` (Chrome 152: 255, 0, 0), and `darken(color-mix(in srgb, rgb(none 0 0), red), 10%)` is a form over it; every other reader still takes `none` as 0, as the browser does in a relative colour: `lightness(rgb(none 0 0))` is `0%`. A consumer of a `color-mix(in srgb, …)` in a `.scss` file computes through the same path, and one that holds `none` stays written, as in Less; in a classic partial an exposed variable in a built-in with no form is `eval/expose-not-a-value`, which ends the compile as every such failure does (`mix(@a, @b, 150%)`, `fade(@a, var(--w))`); Sass `mix` takes the same form (row 8). `color-mix(in srgb, …)` is now the colour a consumer reads, in any spelling (`IN sRGB`, `25% red`, two percentages that do not sum to 100, a `calc()` weight, a colour call or another `color-mix()` as an argument): `darken(color-mix(in srgb, red, blue), 10%)` was `hsl(from color-mix(in srgb, red, blue) h s clamp(0, l - 10, 100))`, now `rgb(77, 0, 76)`. Written alone it prints as written. Invalid or not known (`red -5%`, `red 0%, blue 0%`, `red 25`, `in oklab`, `var()`, `currentcolor`), it stays in the form. An exposed variable prints the form over its `var()`: `@less.mix(@brand, red, 25%)` is `color-mix(in srgb, var(--brand, #c00) 25%, red)`, `@less.mix(red, blue, @w)` of `25%` is `color-mix(in srgb, red var(--w, 25%), blue)`. A weight whose value `color-mix()` cannot hold (`150%`, `25`) runs on the runtime, and so does a mix of two exports beyond 100%. **What moved against dev, each read against the form in Chrome 152.** No corpus fixture moves (367 stylesheets in 6 modes). A translucent operand, Q1: `mix(red, rgba(0, 0, 255, .5), 25%)` was `rgba(128, 0, 128, 0.625)`, now `rgba(102, 0, 153, 0.625)`; `tint(rgba(255, 0, 0, .5), 13%)` was `rgba(255, 79, 79, 0.565)`, now `rgba(255, 59, 59, 0.565)`; `average(#f00, rgba(0, 0, 255, .5))` was `#bf0040`, now `#aa0055bf`, as `average` no longer composites; `average(transparent, red)` was `#ff0000`, now `#ff000080`. Two colours of opacity 0 are `rgba(0, 0, 0, 0)` (`mix(rgba(255, 0, 0, 0), rgba(0, 0, 255, 0))` was `rgba(128, 0, 128, 0)`). A fractional channel, Q1, as operands are no longer rounded to bytes: `mix(red, hsl(120, 0%, 50%))` was `#c04040`, now `#bf4040`; `tint(hsl(90, 100%, 50%), 13%)` was `hsl(89.88235294, 100%, 56.5%)`, now `hsl(90, 100%, 56.5%)`; a computed colour the same, `shade(multiply(#86aa9c, #a13ff0))` was `#2b154a`, now `#2a1549`. A half-byte tie the old weights rounded down on float residue moves to Chrome's byte: `tint(red, 10%)` was `#ff1919`, now `#ff1a1a`; `average(#7f9, #2e8ae8)` was `#52c5c1`, now `#53c5c1`. Float residue in the old alpha is gone: `mix(#336699, red, -13%)` was `rgba(255, 0, 0, 1)`, now `#ff0000`. A space-separated colour as an operand was written out and now computes, in legacy syntax (Q14): `mix(rgb(10 20 30), blue)` was as written, now `rgb(5, 10, 143)`. A consumer of any of these reads the new colour. Against the form, the grid (52 origins, 15 weights for `tint`/`shade`, 8 for `mix`, 5 second colours, in both orders, each `color-mix()` weight pair, plain and compressed, ambient and through `@less.`) has no row off by more than one byte in a channel or in alpha. The seeded sweep (360,000 expressions) has 64 of 180,740 off by more than one byte, all with a low-alpha `rgba()` operand: Chrome reads a legacy alpha as 8 bits (`.17` as `43/255`), the compile as written, and unpremultiplying scales the difference: `shade(rgba(99, 59, 30, .17), -10%)` is `rgba(213, 127, 64, 0.087)`, Chrome 215, 128, 65 for the form. Where the weights and opacities cancel, `alpha * W + P` is 0: the compile writes `rgba(0, 0, 0, 0)`, and only a consumer that raises the alpha can see the channels the browser divides by 0 for. | — |
| 7 | `contrast()` → `contrast-color()`; known inputs pick by the larger WCAG 2.1 contrast ratio. A known input compares itself with `dark` and `light`, a tie goes to `light`, and a threshold keeps the luma rule, with `dark` and `light` swapped by luma as before. The forms: `@less.contrast(C)` is `contrast-color(C)`, and so is an ambient `contrast(C)` whose `C` is a colour by type (`contrast(mix(var(--a), red))`, `contrast(currentcolor)`), or that has a pair. **A lone `contrast(<unknown>)` goes by where it stands (Q13, built in slice 8):** `filter: contrast(var(--amount))` and `backdrop-filter: blur(2px) contrast(var(--c)) brightness(1.2)` are the filter, where `contrast-color()` would drop the declaration at computed-value time; `color: contrast(var(--bg))` is `contrast-color(var(--bg))`; and where no position is known it stays as written. An imported call cannot be the CSS function (J1), so `@less.contrast(var(--x))` is `contrast-color(var(--x))`; a known colour still computes, and `contrast(1.5)` stays the filter. `contrast(C, D, L)` is the relative form of Q13, with `L - D` already subtracted: `contrast(var(--c), #111, #eee)` is `rgb(from contrast-color(var(--c)) calc(17 + 221 * r / 255) calc(17 + 221 * r / 255) calc(17 + 221 * r / 255) / calc(1 + 0 * r / 255))`; a missing `L` is white. An unknown `C` with a threshold, or an unknown `D` or `L`, has no form: rung 4, on the runtime when they are exposed variables (`@less.contrast(@c, #111, #eee, 50%)` is a recipe); `@less.contrast(@c)` prints `contrast-color(var(--c, #999))`. Naming no export, `contrast(var(--c), #111, #eee, 50%)` fails as `mix` does (slice 6). `contrast-color()` is not a colour the compile reads, so `darken(@less.contrast(var(--c)), 10%)` stays a form over it. `@less.darken(rgb(@o 0 0), 10%)` prints `hsl(from rgb(var(--o, 200) 0 0) h s clamp(0, l - 10, 100))`, where it was a diagnostic; a function with no form over such a colour names the variable (`@less.lightness(rgb(@o 0 0))` is `eval/expose-not-a-value`). **Chrome 152.0.7977.167**: `contrast-color(C)` parses and computes white or black; the switch is the WCAG one, between `#767676` (black) and `#757575` (white); it ignores `C`'s alpha; it takes `var()`, `currentcolor` and `color-mix()`; `rgb(from contrast-color(…) …)` computes, and the second-argument keywords `max`, `tbd-fg`, `wcag2` do not parse. **What moved against dev.** One of the 19 `contrast()` cases in `tests-unit/functions/functions.less` moves, the same one in `tests-unit/functions/legacy/functions.less`: `contrast-red: contrast(#ff0000)` was `#ffffff`, now `#000000`. `contrast(#999)` was `#ffffff`, now `#000000`; `contrast(#999, #111, #eee)` was `#eee`, now `#111`; the switch for black and white moves from 43% luma to about 18%, so a consumer reads the new colour: `lightness(contrast(#999))` was `100%`, now `0%`. A threshold moves nothing in a known input. A space-separated colour as `C` was written out and now computes, in legacy syntax (Q14): `contrast(rgb(153 153 153))` is `rgb(0, 0, 0)`. Against the form, `contrast(C)` and the pair black, white read the same bytes as Chrome on every row of the grid (52 origins) and of the sweep (360,000 expressions, 26,272 such rows). **A custom pair can disagree with its form, so the row stays `approx`:** the form switches where black and white do, and the compile asks which of the pair contrasts more: `contrast(#808080, #ccc, #fff)` is `#fff` known and `#ccc` over `var()`; `contrast(#336699, #000, #333)` is `#000` known and `#333` over `var()`. | — (the `contrast()` fixtures that move are listed for the owner) |
| 8 | Sass colour/math rows, in four stages. **Stage 1, routing:** a dotted `.scss` call through a module (`color.adjust(…)`, `math.div(…)`) dispatches as an imported call, so ruling J1 holds for it: a failure is `eval/invalid-function` under every `functionMode`, where it was written out. So `color.lighten(var(--a), 10%)` fails until stage 2 gives it a form, and `color.red(var(--a))`, which has none, stays failed. A dotted call no imported function answers reads the member through the chain `ns.$var` is built as, so a stylesheet module's `@function` is called (it was written out), and a member the module lacks or a namespace no `@use` bound is `resolve/name-not-found`. Less gets the same answer for a member a `@compose` module lacks (`@m.nope(1)`), which was `eval/invalid-function`. A read that wants a typed value gets one through that chain: `darken(m.colour(), 10%)` computes. A bare name under `@use … as *` is not J1's and stays an ambient call: J1's premise is a spelling that can never be a CSS function, and `rgb(var(--r), 0, 0)`, `min(100%, 500px)`, `scale(1.2)` or `opacity(.5)` can be one, so they stay as written (orchestrator ruling, flagged for the owner). **Stage 2, colour:** `lighten` `darken` `saturate` `desaturate` `adjust-hue` `complement` `grayscale` `invert` `opacify` `fade-in` `transparentize` `fade-out` and `mix` print their forms over an input only the browser knows and compute a known one through them, and `rgb`/`rgba` print `rgb(from C r g b / A)` over a colour by type, so `color.lighten(var(--a), 10%)` no longer fails. The kernels `hslAdjust`, `mixColors` and `rotateHue` are deleted. `degreesOf` and the Sass failures stay in the wrappers: `lighten(#c00, 200%)`, `opacify(c, 10%)` and `complement(#f00, oklch)` still fail. `mix` is `color-mix(in srgb)` per Q1, whose text names Sass `mix`, so its alpha weighting is gone and E9 forbids a flag for it; the four sass-spec rows that test it are recorded exclusions in `color-sass-spec.test.ts`. A known result takes the input's format per V10: `transparentize(hsl(120,50%,50%), .1)` is `rgba(64, 191, 64, 0.9)` and `mix(#f00, #00f)` is `#800080`. A lone `grayscale()`, `invert()` or `contrast()` over an unknown goes by where it stands (Q13); `color.grayscale(C)`, `color.invert(C)` and a two-argument `invert` always take the form. Directly on `filter` or `backdrop-filter`, `.jess` writes a lone call of these names as the plain CSS call whatever its argument, so a variable's read keeps the filter (`$c: var(--x); a { filter: grayscale($c); }` converts to `filter: grayscale($c)`); known `$c: .5` prints `grayscale(0.5)` both ways, and only a colour differs (`$c: red; filter: grayscale($c)` is `#808080` directly and `grayscale(red)` through `.jess`), invalid on `filter` by either route. Plain `grayscale($c)` in `.jess` under `@-use "#sass" as *` stays CSS. A modern-syntax input spells its result by Q14, still open: `transparentize(rgb(10 20 30 / .5), .1)` is `rgb(10 20 30 / 0.4)`, `invert(color-mix(in srgb, red, blue))` is `rgb(128 255 128)`, `opacify(hsl(120 50% 50% / .5), .1)` is `rgb(64 191 64 / 0.6)`, `invert(hsl(from red h s l))` is `hsl(180deg 100% 50%)`. `@jesscss/fns/sass/color` grows, as it now carries the evaluator as `./less` does, and does not tree-shake: 44.8 KB to 376.8 KB minified (120.3 KB gzip). `./runtime` and `./registry` do not move, and `.scss` has no route to the browser. `.scss` has no export route, so no `fits` and no recipes. **Stage 3, math:** `percentage`, `ceil`, `floor` and `round` print their forms over a number only the browser knows and compute a known one through them, and `math.div` prints `calc(a / b)` there, the `.scss` `/`'s own route; known numbers keep that division, its unit rules and its failures (V7, V32). `ceil` and `floor` are Less's, so their kernels are deleted; `round`'s second argument is a step, as CSS's is (`round(16px, 5px)` is `15px`). A member CSS has a function of its name for (`math.sqrt`, `abs`, `pow`, `log`, `hypot`, `min`, `max`, `clamp`, the trig functions), and Less's `@less.sqrt`, `abs`, `pow`, `min`, `max` and trig functions by the same path, declines over a number only the browser knows and is that function: `math.sqrt(var(--x))` is `sqrt(var(--x))`. Sass's own domain stays: `math.sqrt(16px)`, `percentage(1px)` and `math.percentage(calc(1px + var(--x)))` fail. `.scss` operators on an unknown are `calc()` (V38, the coordinator's ruling, flagged for the owner): `$x * 2`, `$x + 1px`, `1 - $x`, `-$x`, `($x / 2)`, and `$x % 3` through `rem()`. The bare `$x / 2` stays as written, and a `/` in a group takes the operand rule as `*` does: `($x / foo)` fails, as Less's does. An argument of a call written out takes the `calc()` a group of one does, so `translate(-$x, $x * 2)` is `translate(calc(-1 * var(--x)), calc(var(--x) * 2))`, where it was invalid CSS. A declining member writes the arguments it bound, in parameter order, so `math.clamp($max: 1, $number: var(--x), $min: 0)` is `clamp(0, var(--x), 1)` and `math.log(var(--a), null)` is `log(var(--a))`; a keyword it has no parameter for fails. Less's have the `fits` of what CSS takes, so an export beside an unknown is that function too: `@less.min(var(--max), @gap)` is `min(var(--max), var(--gap, 2px))`, and `@less.sqrt(@a)` with a number is `sqrt(var(--a, 16))`, no recipe. So `foo(1) * 2` is `calc(foo(1) * 2)` and a Sass call that failed and was written out, `percentage(1px) * 2`, is `calc(percentage(1px) * 2)`, as both are in Less. `media()`, `supports()` and `style()` are typed as no number, so `media(print) + 1` stays an error in every dialect. `@jesscss/fns/sass/math` carries the evaluator now, as `./sass/color` does: 49.7 KB to 367.8 KB minified (118.2 KB gzip). `./runtime` and `./registry` do not move. | slices 2–6 |

**Known gaps, left as they are.**

- A math function over known values, written out under `@use`, is neither a number the compile reads nor a value a form takes, so it fails with `eval/invalid-function`: `@a: min(.1, .2)` in `@less.rgba(#c00, @a)`, `@a: min(1, 2)` in `@less.hsv(@a, 50%, 50%)`, `@a: min(1px, 2px)` in `@less.tint(#c00, @a)` and `@less.ceil(@a)`, `@less.rgba(#c00, min(.1, .2))`, `@less.rgba(#c00, min(1%, 2vw))` and `@less.darken(#c00, clamp(1%, 2vw, 3%))`. The same call over an export inside the function does not fail: `@a: 5px; @less.ceil(max(@a, 1px))` prints `round(up, max(var(--a, 5px), 1px), 1)`, which the browser rejects.
- A `%` after other math in a `calc()` stays as written: `calc(var(--x) * 0.5 % 0.25)`, and `calc(percentage(var(--x)) % 0.25)`, which prints `calc(var(--x) * 100% % 0.25)`.
- A plugin call in a slot read again for its known value runs twice: `v: @less.ceil((@a * @p.nx())); z: @p.late()`.
- `@a: 5; @less.ceil(@less.ceil((@a * 2)))` is `eval/expose-not-a-value` where the slot fits.
- `@a: 5; @less.ceil((@a * 2px))` is `eval/expose-not-a-value` and `@a: 0; @less.ceil((1 / @a))` is `eval/division-by-zero`, where the plain spelling prints.
- An export read through a mixin parameter inside a larger argument is reported under the parameter's name: `.m(@p) { v: @less.ceil((@p * 2)); }` called with `@a: 5px` says `@p is exposed`.
- Under `math: always`, two known numbers beside a slash chain divide: `1 / var(--c) / span 2 / 3` is `1 / var(--c) / span 0.6666666667`.
- Under `math: always`, a slash beside a keyword prints differently through `.jess`: the conversion writes `background: url(a.png) center / @x` as `url(a.png) $(center / $^x)`, which prints `url(a.png) calc(center / var(--x))` where the `.less` prints `url(a.png) center / var(--x)`. `foo / @x` and `@x / span 2` split the same way.
- `@l: 1, 2; min(var(--a) % @l, 1)` prints `min(var(--a) % 1, 2, 1)`, three arguments, where a literal `(1, 2)` keeps its group.
- `@a: 5; .m(@p) { v: @less.ceil((@p * 2)); } .x { .m(@less.mod((@a * 2), 3)); }` is `eval/expose-not-a-value`, as `@less.ceil(@less.ceil((@a * 2)))` is.
- `@c: color-mix(in srgb, red, blue); x: @c + #111` computes, where the direct spelling stays `eval/invalid-operand`.
- A lone `grayscale(var(--x))`, `invert(var(--x))` or `contrast(var(--x))` inside another function, or in parens, stays as written (Q13): `filter: drop-shadow(0 0 1px grayscale(var(--x)))`, `background: linear-gradient(invert(var(--x)), red)` and `color: (grayscale(var(--x)))`. The lane cannot tell cheaply that a colour is what is valid there. So does one under an interpolated property name.
- A lone `contrast(var(--c))` written inside another colour function stays as written there too, so `darken(contrast(var(--c)), 10%)`, `fade(contrast(var(--c)), 50%)` and `mix(contrast(var(--c)), red, 25%)` print a form over `contrast()`, which Chrome 152 reads as invalid at computed-value time, whatever `--c` is, so the property inherits. `contrast(C)` inside them is the form when the call says it is a colour (`@less.contrast`, or a pair). `.scss` has the same gap: `lighten(grayscale(var(--x)), 10%)` is a form over `grayscale()`.
- `darken(color-mix(in srgb, red, blue), 10%)` splits a tie by one byte: `rgb(77, 0, 76)`.
- `@less.contrast` over a pair written as a CSS call keeps the pair's spelling, not `color`'s format: `@less.contrast(#336699, rgba(1, 2, 3, .5), rgba(250, 251, 252, .25))` is `rgba(250, 251, 252, 0.25)`, where plain `contrast()` is `#fafbfc40`. Clearing `src` in `reformatColor` would fix it and would also move a literal hex pair: `contrast(#999, #111, #eee)` from `#111` to `#111111`, and `contrast(hsl(120, 50%, 40%), #111, #eee)` from `#111` to `hsl(0, 0%, 6.666666667%)`.
- A stylesheet's `@function` under `@use "./m" as *` is not called: `f(1)` is written out as-is. `@use "./m"` with `m.f(1)` calls it.
- `expression(this.foo(1))` in `.scss` reads `this.foo` as a module member, so it is `resolve/name-not-found`.
- A variable or parameter named like a stylesheet module hides it for a dotted call: `@use "sizes"; @function f($sizes) { @return sizes.double($sizes); }` is `resolve/name-not-found`. `sizes.$base` has the same fault.
- A mixin from `@use "m" as *` loses that module's own `@use`.
- A variable holding a lone filter name over an unknown, read on any declaration but `filter`, is the form directly and as written through `.jess`, where a bare name is CSS's and `$name(…)` would break it on `filter`: `$f: grayscale(var(--x)); a { color: $f; }` prints `hsl(from var(--x) h 0 l)` directly and `grayscale(var(--x))` through `.jess`.
- A Sass `@function` that returns a lone filter name over an unknown has no position in its `@return`, so through `.jess` it is the imported form: `@function f($c) { @return grayscale($c); } a { filter: f(var(--x)); }` prints `grayscale(var(--x))` directly and `hsl(from var(--x) h 0 l)` through `.jess`.
- A variable read in a lone filter name inside another function on `filter` does the same: `$c: var(--x); a { filter: drop-shadow(0 0 1px grayscale($c)); }` prints `grayscale(var(--x))` directly and `hsl(from var(--x) h 0 l)` through `.jess`.
- A Less property read of a call its position chose reads the call, not the choice: `.a { color: contrast(var(--x)); b: $color; }` prints `contrast-color(var(--x))` and `contrast(var(--x))`.
- A form over an `hsl()` can leave float residue in a channel, in a weighted `invert` and in Less and Sass `mix` alike: `invert(hsl(359,1%,99%), 50%)` and `mix(hsl(359,1%,99%), hsl(179,1%,1%))` print `hsl(0, 0.000000000000011102230246%, 50%)`. It is valid and computes the same.
- `rgba(10 20 30, .5)` prints as written, `rgba(10 20 30, 0.5)`, where it was `rgba(10, 20, 30, 0.5)`. The input is invalid either way.
- `rgba(#000, var(--a))` stays as written in Sass and Less; a follow-up after row 8 gives it the relative form.
- `-moz-filter`, `-o-filter` and `-ms-filter` take the colour form: no current browser reads them. `-webkit-filter` is the filter.
- `round(1.005, 0.01)` is `1.01` at compile time, in base 10 (V8), and `1` in the browser over `var(--x)`, as Less's decimal places are. A step that is no power of ten at or below 1 rounds in floats, as the browser does.
- A Sass form over an unknown that holds a length takes a unitless step (Q3): `ceil(var(--x))` is `round(up, var(--x), 1)`, invalid at computed-value time with `--x: 1.5px`, where `ceil(1.5px)` is `2px`. `rem(var(--x), 3)` with a length is the same.
- A declining member reads only the unknown, so a known argument's Sass failure does not run beside one: `math.pow(16px, var(--x))` prints `pow(16px, var(--x))`, where `math.pow(16px, 2)` fails. A wrong type still fails (`math.pow(foo, var(--x))`).
- A glued minus on a member that declines stays as written outside math: `-sqrt(var(--x))`. In math it is negated (`(-abs(var(--x)) * 2)` is `calc(-1 * abs(var(--x)) * 2)`).
- A `/` in `.scss` is lower than `+` in a bare value, known numbers or not: `1 + $x / 2` is `calc(1 + var(--x)) / 2` as `1 + 4 / 2` is `5 / 2`, and `$x / 2 + 1` is `var(--x) / 3`.
- `math.div(var(--x), 0)` and `(var(--x) / 0)` print `calc(var(--x) / 0)`: V7 fails only a division it knows of.
- Conversion to `.jess` reports a gap for a call as an operand of `.scss` math (`var(--x) * 2`, `env(a) * 2`, `calc($x * 2) * 3`), because `$( … )` takes no call, and for `($x / 2)`, as it does for `(1 / 2)`. `$x * 2`, `-$x`, `$x % 3` and the rest over a reference convert and render the same.
- A `@forward`ed member is not found through a dotted call.
- A `.scss` diagnostic for a call reports 1:1, because a `FunctionCall` has no span.
- `color.invert(1)`, `color.grayscale(50%)` and `color.opacity(50%)` are errors, per J1, where the bare calls are CSS filters.
- `translate(1px, 2px) + 1`, `math.div(linear-gradient(red, blue), 2)`, `ceil(linear-gradient(red, blue))` and `min(1px, 1em) + 1` reach `calc()` or a form as a call of no known type. They are known CSS types; widening the list of them (`other`) is later work.
- `@less.pow(var(--x), @a)` with `@a: 16px`, an export the CSS function does not take beside an unknown, compiles to a recipe that says what it cannot read when set, as `@less.fade(var(--x), @a)` does.

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
  `transparent`, where the two rules agree; slice 6 measured this, and no
  fixture moves. Sass `mix` is slice 8. Weights outside 0–100% are Q11.
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
  **Correction, 2026-11-05: measured, owner to confirm.** The premise above was
  never measured, and Chrome 152 (the only browser measured, `getComputedStyle`
  and canvas bytes) contradicts it. An `hsl()`-family origin keeps its own
  channels when a relative `hsl()` reads it; any other origin reads through sRGB:
  `hsl(from hsl(from #33cc33 h 0 l) h calc(s + 50) l)`,
  `hsl(from hsl(120 0% 50%) h calc(s + 50) l)` and
  `hsl(from hsl(120, 0%, 50%) h calc(s + 50) l)` are `#40bf40`, while
  `hsl(from #808080 h calc(s + 50) l)` and `hsl(from rgb(128 128 128) h calc(s + 50) l)`
  are `#bf4040`. Hue and saturation survive black and white:
  `hsl(from hsl(from #33cc33 h s 100) h s clamp(0, l - 50, 100))` and
  `hsl(from hsl(from #33cc33 h s 0) h s clamp(0, l + 50, 100))` are `#33cc33`.
  A reviewer also reports red once the origin is resolved through a registered
  `<color>` property, `rgb(from …)` or `color-mix()`; measured directly here,
  `rgb(from hsl(120 0% 50%) r g b)` and `color-mix(in srgb, hsl(120 0% 50%), hsl(120 0% 50%))`
  read hue 0, while `color-mix(in hsl, hsl(120 0% 50%), hsl(120 0% 50%))` keeps 120, 0, 50.
  So following the browser keeps what Jess did before slice 2b for a computed grey:
  `saturate(desaturate(#33cc33, 100%), 50%)` is `#40bf40` and
  `hue(desaturate(#33cc33, 100%))` is `120`. It moves an authored grey, black or
  white, for what reads it and for how it prints:

  | Call | Was | Is |
  | --- | --- | --- |
  | `hue(hsl(120, 0%, 50%))` | `0` | `120` |
  | `saturation(hsl(120, 50%, 100%))` | `0%` | `50%` |
  | `hsl(hsl(120, 0%, 50%))` | `hsl(0, 0%, 50%)` | `hsl(120, 0%, 50%)` |
  | `hsla(hsl(120, 0%, 50%), .5)` | `hsla(0, 0%, 50%, 0.5)` | `hsla(120, 0%, 50%, 0.5)` |
  | `darken(hsl(120, 50%, 100%), 20%)` | `hsl(0, 0%, 80%)` | `hsl(120, 50%, 80%)` |
  | `lighten(hsl(120, 50%, 0%), 20%)` | `hsl(0, 0%, 20%)` | `hsl(120, 50%, 20%)` |
  | `saturate(hsl(120, 0%, 50%), 20%)` | `hsl(0, 20%, 50%)` | `hsl(120, 20%, 50%)` |
  | `desaturate(hsl(120, 0%, 50%), 20%)` | `hsl(0, 0%, 50%)` | `hsl(120, 0%, 50%)` |
  | `spin(hsl(120, 0%, 50%), 20)` | `hsl(20, 0%, 50%)` | `hsl(140, 0%, 50%)` |
  | `greyscale(hsl(120, 0%, 50%))` | `hsl(0, 0%, 50%)` | `hsl(120, 0%, 50%)` |
  | `.m(hsl(120, 0%, 50%))` printing its argument | `hsl(0, 0%, 50%)` | `hsl(120, 0%, 50%)` |
  | `.m(hsl(120, 50%, 100%))` printing its argument | `hsl(0, 0%, 100%)` | `hsl(120, 50%, 100%)` |
  | `.m(hsl(0.25turn, 0%, 50%))` printing its argument | `hsl(0, 0%, 50%)` | `hsl(0.25turn, 0%, 50%)` |

  An authored value now prints what it reads, so `hsl(from @c h calc(s + 20) l)`
  and `saturate(@c, 20%)` agree in the browser. Only Chrome was measured.
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
  `color-mix()` uses when `C` is translucent; slice 6 writes one form for them
  and `mix`, which an opaque `C` reduces to these). `mix(a, b, W)` with `W`
  outside 0–100% takes the same form when one colour is known; with both
  colours unknown no CSS form exists, and the call takes rung 4. A negative
  `tint` is not the mirror of `shade`: `tint(#777777, -13%)` is `#656565`,
  `shade(#777777, 13%)` is `#686868`.

- **Q12 — an authored CSS function consumed by a built-in.** **Ruled as recommended, owner 2026-11-01 (*"yes"*).** With the IR,
  `darken(color-mix(in srgb, red, blue), 10%)` and `percentage(calc(0.5))` can
  resolve, because their leaves are known; written on their own they still
  print as written. Allow it? Recommendation: yes. It is V1 (a value prints as
  written until an operation consumes it), and it changes output only where a
  built-in today receives an authored `color-mix()`/relative colour/`calc()`.
  Counted in slice 2b: no corpus fixture.
- **Q13 — `contrast()` (Less only; Sass has none).** **Ruled as recommended, owner 2026-11-01: a known input picks by the larger WCAG 2.1 contrast ratio** (asked under the E9 principle; the owner answered *"agreed"*). With an explicit threshold argument a known input keeps the luma-threshold rule, and an unknown input with a threshold is a failed call. **A lone call over an unknown goes by where it stands. Owner 2026-11-05, verbatim, on a lone `grayscale(var(--x))` and `invert(var(--x))` staying as written: *"mmmm i don't agree... it depends on it's position for this one (if it's on filter or backdrop-filter)"*.** Directly in a declaration of `filter` or `backdrop-filter`, in any case and with a `-webkit-` prefix, it is the CSS filter as written, including as an item of the list (`filter: blur(1px) grayscale(var(--x))`). Directly in any other declaration it is the colour form: `color: grayscale(var(--x))` is `hsl(from var(--x) h 0 l)`, and `color: invert(var(--x))` is the `$invert` form. A variable is evaluated where it is read, so it goes by the declaration reading it, whichever read comes first: `$f: grayscale(var(--x)); a { filter: $f; color: $f; }` is `grayscale(var(--x))` and the form. Where no position is known, a mixin argument or a `@function`'s argument, it stays as written. **`contrast` takes the same rule: the coordinator's extension, not the owner's words, which were about `grayscale` and `invert`.** A number stays a filter everywhere. A lone `saturate` stays a filter, since the built-in takes two arguments. A pair, a second argument, an argument that is a colour by type, or a call through a module prints the form (slice 7's row and slice 8's), and a number through a module fails (J1). `contrast(C)` maps to
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
  being the only exception; this moves 1 of the 19 `contrast()` cases in
  `tests-unit/functions/functions.less`, `contrast-red` (slice 7's row).

- **Q14 — the syntax a built-in writes its result in, for an input written in modern syntax.** OPEN, not ruled. Slices 2b and 3 change no byte for it on `hsl()`: `darken(hsl(120 50% 40%), 5%)` stays `hsl(120, 50%, 35%)`, legacy syntax, in the one function that spells a resolved form's result (`spelled`, `css-form.ts`), so the answer is a one-line change. Its scope grew with slice 3, which computes a space-separated `rgb()` for the first time: `darken(rgb(10 20 30), 5%)` prints legacy `rgb(4, 7, 11)` and `fade(rgb(10 20 30), 50%)` prints modern `rgb(10 20 30 / 0.5)`, both new bytes where the call was written out before, so the answer also picks these. With slice 2a a built-in can receive a colour written in modern syntax (`darken(hsl(120 50% 40%), 5%)`), and the kernels disagree: `darken`, `lighten`, `saturate`, `desaturate` and `spin` write legacy syntax (`hsl(120, 50%, 35%)`), while `fade` keeps the modern syntax (`rgb(51 153 51 / 0.5)`). V10 decides the format (HSL in, HSL out), not the syntax. Recommendation: modern in, modern out. The conformance test pins the colour, not this spelling.

- **Q15 — a check for a namespaced built-in that does not resolve at compile time.** **Ruled, owner 2026-11-05: opt-in, off by default** (the owner, on that recommendation: *"ok sold. agreed."*). `@less.darken(var(--x), 10%)` looks like a compile-time call, and its output depends on the browser's support for the form. Someone with a browser target can ask to be told. The namespace itself never warns, since naming a dependency is what we want. A variable exposed with `@expose` is deferred on purpose, so it does not count. Not built yet; `functionMode: 'error'` cannot do it, because a printed form counts as success there. The option's name and home are open.

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
