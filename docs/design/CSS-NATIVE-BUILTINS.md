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
| **HSL vs sRGB round trip** | The browser takes `h s l` from the origin "after conversion, if required, to sRGB" (§4.4), and an `hsl()` colour resolves to sRGB (css-color-4 §2). Jess carries the authored HSL exactly (`Color.hsl`, V5). | Measured in Chrome 152, the only browser measured: an origin in the `hsl()` family keeps its own `h`, `s` and `l` when a relative `hsl()` reads it, a grey's, black's and white's included, and any other origin reads through sRGB, a grey's hue being 0. Jess does the same: `saturate(desaturate(#33cc33, 100%), 50%)` is `#40bf40`, `hue(desaturate(#33cc33, 100%))` is `120`, and `saturate(hsl(120, 0%, 50%), 20%)` is `hsl(120, 20%, 50%)`, while `saturate(#808080, 50%)` is red. `Q9`. Math on the 0–100 scale leaves rounding in a channel, which would move a colour that lands on a half byte, so a channel's change applies to the origin's exact value on 0–1 (`moved`, `css-color.ts`), V4's tolerance trimming the rounding; for that, a form has the kernel's bytes. A channel written with `*` or `/` changes by a percentage of the origin's channel, and any other by an absolute amount (`scalesChannel`). |
| **`method: relative`** | Less scales the delta by the current channel. | Written into the form: `clamp(0, l - l * A / 100, 100)`; alpha: `calc(alpha - alpha * A)`. Exact. |
| **Precision** | The browser computes in floats. Jess runs `+ - *` in exact base 10 (V6). | A form resolves only when every operand is a resolved number (channel keywords replaced by the origin's channel values), and then runs through the same operation evaluator as Less math (`value-operate.ts` `operate`), so V6 applies and V36's operand rule never sees a keyword. An unresolved form is never operated: it is written out, as math inside a math function always is (F8). Differences stay below the output policy, except at decimal ties (the `round` row). |
| **Amount scale** | Less reads `10%` and `10` alike as 0.1. A relative `l` is a number on 0–100, so `l - 10%` is invalid (a number and a percentage don't add), and so is `alpha + 10%`. | A known amount is written as a number (`l - 10`, `alpha + 0.1`). A **deferred** amount needs typed arithmetic, `l - var(--a) / 1%` and `alpha + var(--a) / 100%`, which assumes the variable holds a percentage (Q2). |
| **`mix` alpha** | Less/Sass weight with `((w + a)/(1 + w·a) + 1)/2`, `a = a1 - a2`; `color-mix()` interpolates premultiplied (§3.5). Equal when the alphas are equal (and in some other cases); `mix(red, rgba(0,0,255,.5), 25%)` gives `[128,0,128]` vs `[102,0,153]`. Less also mixes **rounded** 0–255 operands (`colorRgbRounded`), ±1 byte for fractional channels. | Q1. |
| **`round` tie** | CSS `nearest` breaks ties toward +∞ (`round(-0.5, 1)` = 0); V8: half away from zero (−1). And decimal ties: the compile rounds `round(1.005, 2)` in base 10 to `1.01`, while a browser's float `1.005` sits just below the tie and rounds to `1`. | `calc(sign(N) * round(abs(N), B))` fixes the sign. The decimal tie stays a divergence (V8's open sub-question), so `round` is exact-if "N is not a decimal tie". `sign()`/`abs()` are Baseline 2025 (MDN). Q4. |
| **Nested `calc()`** | `calc(percentage(var(--p)))` would write `calc(calc(var(--p) * 100%))`. | Inside a math function a form's own `calc()` wrapper is not written: `calc(var(--p) * 100%)`. This is how V27 already writes kept math inside a math function. |
| **Result format** (V10) | The alpha kernel `withAlpha` (`color-helper.ts`) owns the rule that a translucent result retags hex to `rgba()` unless the source hex had an alpha digit. | When that kernel is deleted (slice 3), the rule moves with it into the one function that picks a resolved form's output format, `spelled` (`css-form.ts`), shared by every colour form and the only owner. Spelling only, unchanged bytes. |
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
  call is that call, its parens in its spelling (J16). Built in slice 2b, replacing the `KeywordCall` slice 1 hung
  on the keyword.
- **Kept math**: arithmetic that has not computed, `op`, `left`, `right`, in
  place of `keptMath`'s bytes. Preserved math (`calc(1px + 1em)`, V18) becomes
  that structure in a `calc` call, the same value an authored
  `calc(1px + 1em)` evaluates to. Built with slice 5, which is the first to
  read it.

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
channels `resolveHsl` does, and an unknown input prints the form; the one function
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
call written out (J16). Structure travels with the value, so the eager
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
| 1 | The IR for calls: a call written out as-is (`fallbackCall`) carries its `call` (§3.2). No output change, proven on the full corpus. Kept math's structure moves to slice 5. Still text, with `call: null`: a CSS-shaped colour call kept as authored (`preserveCall`), a kept `calc()` (`evalCalc`), CSS `if()` (`pickIfValue`), a call inside a `var()` fallback, and a paren group around a call (`(var(--a))`). Slice 2 gives each the structure its built-ins read, with the Q12 cases. | — |
| 2a | Resolution of a modern `hsl()` a consumer demands, when its callable wrote it out as-is (`packages/core/src/ast/css-color.ts`): absolute and relative, the channel keywords bound to the origin's sRGB values while the channels evaluate, so the math in them is Less math (§2 Precision), typed as CSS math (`l - 10%` and `h + 30deg` are not CSS, so they stay unresolved). Unresolved, and printed as written, when the origin or a channel is unknown, the alpha has no `/`, a channel fails only bound (`calc(l / 0)`), or the saturation or lightness leaves 0–100 (out of the sRGB gamut, which the browser gamut-maps). A resolved colour keeps the written spelling until an operation consumes it (V1), so a mixin argument prints it as before. A colour function in a channel binds its own channels. A callable that computes the call itself (Sass `hsl()` on an absolute colour) still does. The browser conformance test. The Q12 relative-colour case; no corpus fixture moves. Q14 is open. | — |
| 2b | Templates: the `.jess` template build step in `@jesscss/fns`, and the `FunctionCall` value kind (§3.2). Less `lighten` `darken` `saturate` `desaturate` `spin` `greyscale`; their kernels deleted. `clamp()` resolves in a channel. An exposed variable in the colour slot prints the form over its `var()` (R8). An unknown *amount* (`darken(@c, var(--a))`) stays exactly as it was until slice 5. A paren group around a call reads as its call, its parens printed (J16): `lighten((var(--x)), 5%)` is `hsl(from (var(--x)) h s clamp(0, l + 5, 100))`. Still text, so it fails a colour parameter as before: a kept `calc()`. A CSS colour call its callable cannot compute is written out under every `functionMode` when a consumer demands it, so only a known wrong type fails (§3.6). A form over `rgb(10 20 30)` or `color-mix(in srgb, red, blue)` prints until slices 3 and 6 give those their evaluation. Sass rows are slice 8. | 2a |
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
  `<color>` property, `rgb(from …)` or `color-mix()`. So following the browser
  keeps what Jess did before slice 2b for a computed grey:
  `saturate(desaturate(#33cc33, 100%), 50%)` is `#40bf40` and
  `hue(desaturate(#33cc33, 100%))` is `120`. It changes an authored grey a
  consumer reads, whose own spelling stays unmoved:
  `saturate(hsl(120, 0%, 50%), 20%)` was `hsl(0, 20%, 50%)` and is
  `hsl(120, 20%, 50%)`.
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
  built-in today receives an authored `color-mix()`/relative colour/`calc()`.
  Counted in slice 2b: no corpus fixture.
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

- **Q14 — the syntax a built-in writes its result in, for an input written in modern syntax.** OPEN, not ruled. Slice 2b changes no byte for it: `darken(hsl(120 50% 40%), 5%)` stays `hsl(120, 50%, 35%)`, legacy syntax, in the one function that spells a resolved form's result (`spelled`, `css-form.ts`), so the answer is a one-line change. With slice 2a a built-in can receive a colour written in modern syntax (`darken(hsl(120 50% 40%), 5%)`), and the kernels disagree: `darken`, `lighten`, `saturate`, `desaturate` and `spin` write legacy syntax (`hsl(120, 50%, 35%)`), while `fade` keeps the modern syntax (`rgb(51 153 51 / 0.5)`). V10 decides the format (HSL in, HSL out), not the syntax. Recommendation: modern in, modern out. The conformance test pins the colour, not this spelling.

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
