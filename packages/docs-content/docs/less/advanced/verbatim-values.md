---
title: "Verbatim (Lazy-Print) Values"
slug: "/advanced/verbatim-values"
audiences:
  - less
origin: less
---

> In Less 5.x, un-operated value literals are preserved exactly as you wrote them;
> only values that are actually *computed* get canonicalized.

Less 4.x normalized many value literals even when nothing operated on them — a
`1.0px` could come out as `1px`, and colors were re-serialized to a canonical form.
Less 5.x changes this: an **un-operated literal is emitted source-verbatim**. The
compiler only canonicalizes a value when an operation actually produces a new value.

This makes output more predictable — what you type is what you get — and avoids
surprising rewrites of authored CSS.

## Un-operated literals pass through unchanged

Dimensions keep their exact spelling — trailing zeros, unit casing, and exponent
form are all preserved:

```less
.a {
  width: 1.0px;
  height: 2PX;
  margin: 1e3px;
}
```

```css
.a {
  width: 1.0px;
  height: 2PX;
  margin: 1e3px;
}
```

Colors are preserved in their authored form — a short hex stays short:

```less
.b {
  color: #989;
}
```

```css
.b {
  color: #989;
}
```

## Computed values *are* canonicalized

As soon as a value participates in an operation, the result is a freshly-computed
value and is emitted in canonical form:

```less
.c {
  width: 1.0px + 1px;   // computed
  color: #989 + #010;   // computed
}
```

```css
.c {
  width: 2px;
  color: #9a9a9a;
}
```

The rule is simple: **literal in, literal out; computed in, canonical out.**

## CSS-superset pass-through

The same principle extends to CSS constructs that *look* like Less functions but
are valid CSS. An un-operated `rgb(50%, 0, 0)` is emitted verbatim as written,
rather than being evaluated by the Less `rgb()` function. The Less function only
runs when the value is operated on, or when its arguments are non-CSS Less forms
(they contain a Less variable/expression, or a historical Less-only syntax).

```less
.d {
  color: rgb(50%, 0, 0);   // valid CSS, un-operated -> verbatim
}
```

```css
.d {
  color: rgb(50%, 0, 0);
}
```

This applies to CSS-shaped, un-operated `rgb`/`rgba`/`hsl`/`hsla` calls with
three or more argument slots, and to unknown function names alike. The Less
function runs **only** when the value is operated on (`lighten(hsl(...), 10%)`)
or given a Less overload/variable argument (`rgba(#fff)`, `hsl(@h, 50%, 40%)`):

```less
.e {
  a: hsl(200, 50%, 40%);              // verbatim
  b: lighten(hsl(200, 50%, 40%), 10%); // computed -> invoked
}
```

```css
.e {
  a: hsl(200, 50%, 40%);
  b: #4d9fd9;
}
```

## Function shape vs. grouping parens

Whether parentheses are a **function call** or **math grouping** comes down to a
single space before the `(`:

- **No space** — `name(...)` — is a function shape. It passes through **verbatim**,
  even for a name that is not a real CSS function.
- **A space** — `keyword (expr)` — is math grouping. Once the expression computes,
  the grouping parens **dissolve** and do not survive to output.

```less
@a: #a80000;
@b: #00000b;
.f {
  border-a: 1px solid(#a8000b);            // no space -> function shape, verbatim
  border-b: 1px solid (@a * .66 + @b * .33); // space -> grouping, dissolves
}
```

```css
.f {
  border-a: 1px solid(#a8000b);
  border-b: 1px solid #a8000b;
}
```

The grouping parens exist only to control evaluation order; they are not part of the
computed result's spelling, so `(2px + 3px)` emits `5px`, never `(5px)`.

See also: [Value & Separator Formatting](./value-formatting.md) ·
[Color Output](./color-output.md) · [Operations](../features/strictmath.md) ·
[Color functions](../functions/color-definition.md).
