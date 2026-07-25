---
title: "Number Precision"
slug: "/advanced/number-precision"
audiences:
  - less
origin: less
---

> A **computed** number is emitted as the **shortest decimal that is still the same
> number** — within a relative tolerance of `1e-10`. One policy, every position.

Less does its arithmetic in JavaScript doubles, which produce long tails of float
noise: `0.1 + 0.2` is really `0.30000000000000004`. Nobody authored those digits, so
Less removes them.

It is worth being precise about what that means, because it is **not** rounding to a
fixed number of places. JavaScript already prints the *shortest string that reads back
as the same double* — which is exactly why it is obliged to print
`0.30000000000000004`: that genuinely is a different double from `0.3`. What Less does
is the tolerance-aware version: emit the shortest decimal that lands within `1e-10`
(relative) of the computed value.

## Noise goes, earned digits stay

```less
.a {
  a: 0.1 + 0.2;   // float noise
  b: (100% / 3);  // a real repeating decimal
  c: pi();
}
```

```css
.a {
  a: 0.3;
  b: 33.333333333%;
  c: 3.1415926536;
}
```

`0.3` is short because the extra digits were noise. `33.333333333%` stays long
because every one of those digits is earned — no tolerance can shorten a third.

There is **no cap** on length and no per-unit rule. A cap would have to discard real
digits at larger magnitudes (`393.35275591px`, which is what `1cm` works out to in
px, would become `393.35276px`) to save a fraction of a percent of output size. CSS
Values 4 §5 leaves numeric precision explicitly implementation-defined, so nothing
requires one.

Because the tolerance is relative rather than a fixed number of decimal places, small
magnitudes survive: a computed `0.00000000123456789` stays itself instead of
collapsing to `0`. Exact integers are never touched at all — an integer carries no
float noise, so there is nothing to remove.

Output is never written in scientific notation, per
[CSSOM §6.7.2](https://drafts.csswg.org/cssom-1/#serializing-css-values) ("scientific
notation is not used").

## Un-operated literals are emitted verbatim

Only a **computed** number goes through the policy. A source literal you wrote
yourself is emitted exactly as written:

```less
.a {
  a: 1.50000px;
  b: 2PX;
  c: 0.00000000123456789;
}
```

```css
.a {
  a: 1.50000px;
  b: 2PX;
  c: 0.00000000123456789;
}
```

See [Verbatim Values](./verbatim-values.md). The one spelling adjustment is a
leading decimal point: `.3s` is emitted as `0.3s`.

## Interpolation splices print identically

A number spliced into a selector, a property name, or a `~"..."` string prints the
**same bytes** it would print in a declaration value:

```less
@n: pi();
.a {
  width: @n;
  content: ~"@{n}";
}
```

```css
.a {
  width: 3.1415926536;
  content: 3.1415926536;
}
```

:::note Changed in 5.0

Earlier builds rounded a declaration value to 8 decimal places but let an
interpolated number through at full double precision, so `pi()` printed
`3.14159265` in one position and `3.141592653589793` in the other. That was an
artifact of where the two paths ran, not a rule about numbers, and it is gone: a
value spells itself the same way wherever it stands.

The same change removed the 8-decimal floor from **source literals**. An authored
`-0.0000000001deg` used to be denoised to `0deg`; it is now preserved, because an
un-operated literal is emitted verbatim.

:::

See also: [Value & Separator Formatting](./value-formatting.md) ·
[Math functions](../functions/math-functions.md).
