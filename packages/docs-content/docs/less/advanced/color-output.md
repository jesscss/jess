---
title: "Color Output (Alpha, Hex, Gamut)"
slug: "/advanced/color-output"
audiences:
  - less
origin: less
---

> How Less 5.x serializes colors: a **computed** color with alpha < 1 prints as
> `rgba(...)`, an authored **alpha-hex literal** is preserved as hex, and
> out-of-range channels **clamp** to their valid gamut.

Un-operated color literals follow the [verbatim rule](./verbatim-values.md) — what
you write is what you get. The rules here govern colors that Less actually
**computes** (through a color function or arithmetic), and one preservation rule for
authored alpha-hex.

## Computed alpha → `rgba(...)`

When a color operation produces an alpha below 1, the result serializes in
`rgba(...)` legacy syntax (the modern `rgb(r g b / a)` form is used only when the
source color was authored in modern syntax):

```less
.a {
  color: fade(#e04141, 50%);
}
```

```css
.a {
  color: rgba(224, 65, 65, 0.5);
}
```

An un-operated `rgba(...)`/`hsla(...)` with literal args still passes through
verbatim (see [Verbatim Values](./verbatim-values.md)); the `rgba(...)` **output**
form here is what a *computed* alpha color canonicalizes to.

## Alpha-hex literals are preserved as hex

An authored alpha-hex literal — 4-digit `#rgba` or 8-digit `#rrggbbaa` — is kept in
hex form when nothing operates on it, rather than being rewritten to `rgba(...)`:

```less
.a {
  color: #ff000080;
  background: #f003;
}
```

```css
.a {
  color: #ff000080;
  background: #f003;
}
```

Only when the alpha-hex color is **computed** (passed through a color function or
arithmetic) does it canonicalize — and then, with alpha < 1, it follows the
`rgba(...)` rule above.

## Out-of-gamut channels clamp

A computed color whose channels fall outside their valid range is **clamped** —
rgb channels to `0–255`, saturation/lightness to `0–100%`, alpha to `0–1` — rather
than overflowing:

```less
.a {
  color: lighten(#800000, 100%);   // lightness pushed past 100% -> clamps to white
}
```

```css
.a {
  color: #ffffff;
}
```

Clamping happens on the computed result only; an authored literal like
`hsl(200, 150%, 40%)` that nothing operates on is emitted verbatim.

See also: [Verbatim Values](./verbatim-values.md) ·
[Color definition functions](../functions/color-definition.md) ·
[Color operations](../functions/color-operations.md).
