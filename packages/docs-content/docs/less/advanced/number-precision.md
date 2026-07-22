---
title: "Number Precision"
slug: "/advanced/number-precision"
audiences:
  - less
origin: less
---

> A **computed** number in a declaration value rounds to **8 decimal places**; a
> number spliced through **interpolation** keeps **full double precision**.

Less does its arithmetic in JavaScript doubles, which can produce long tails of
float noise (`0.1 + 0.2 → 0.30000000000000004`). To keep output clean, Less 5.x
rounds a computed declaration value to 8 decimal places. But interpolation is a
different lane — it serializes at evaluation time, before the declaration-value
rounding applies — so an interpolated number carries its full precision.

## Declaration values round to 8 dp

A value that Less actually computes is rounded to 8 decimal places on the way out:

```less
.a {
  width: 100% / 3;   // 33.33333333333…%
  height: pi() * 1px; // 3.14159265358979…px
}
```

```css
.a {
  width: 33.33333333%;
  height: 3.14159265px;
}
```

Rounding also **denoises** sub-precision float error: a source whose value cannot be
represented at the 8-dp floor (for example a computed `-0.0000000001`) collapses to
its clean canonical form (`0`). An **un-operated source literal is untouched** by
this — `1.0px` and `2PX` are emitted verbatim (see
[Verbatim Values](./verbatim-values.md)); only a computed number is rounded.

## Interpolation splices emit full precision

When a number is spliced into a selector, a property name, or a `~"..."` string via
`@{...}`, it is serialized at evaluation time with **full** double precision — the
8-dp declaration rounding does not apply:

```less
@n: pi();
.a {
  width: @n * 1px;          // declaration value -> rounded
  --raw: ~"@{n}";           // interpolation -> full precision
}
```

```css
.a {
  width: 3.14159265px;
  --raw: 3.141592653589793;
}
```

This mirrors less.js: the interpolation context carries no numeric-precision setting,
so the raw computed number flows through. If you need the rounded form inside an
interpolation, round it explicitly with [`round()`](../functions/math-functions.md).

See also: [Value & Separator Formatting](./value-formatting.md) ·
[Math functions](../functions/math-functions.md).
