---
title: "Number precision"
sidebar_label: Number precision
audiences:
  - jess
origin: jess
---

A **computed** number in a declaration value rounds to **8 decimal places**; a number
spliced through **interpolation** keeps **full double precision**.

## Declaration values round to 8 dp

A value Jess actually computes is rounded to 8 decimal places on the way out, which
also denoises float error (`0.1 + 0.2` never leaks a `…04` tail):

```jess
.a {
  width: 100% / 3;    // 33.33333333333…%
  height: pi() * 1px; // 3.14159265358979…px
}
```

```css
.a {
  width: 33.33333333%;
  height: 3.14159265px;
}
```

An **un-operated source literal is untouched** — `1.0px` and `2PX` are emitted
verbatim (see [Verbatim values](./02-verbatim-values.md)); only a computed number is
rounded.

## Interpolation splices emit full precision

A number spliced into a selector, property name, or `~"..."` string via interpolation
is serialized at evaluation time with **full** double precision — the 8-dp declaration
rounding does not apply:

```jess
$n: pi();
.a {
  width: $n * 1px;   // declaration value -> rounded
  --raw: ~"$(n)";    // interpolation -> full precision
}
```

```css
.a {
  width: 3.14159265px;
  --raw: 3.141592653589793;
}
```

If you need the rounded form inside an interpolation, round it explicitly with
[`round()`](../04-Functions/08-math.md). This is the same behavior as the Less 5.x
engine — see the Less [Number Precision](https://lesscss.org/docs/advanced/number-precision)
page.
