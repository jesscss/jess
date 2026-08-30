---
title: "Color output (alpha, hex, gamut)"
sidebar_label: Color output
audiences:
  - jess
origin: jess
---

Un-operated color literals follow the [verbatim rule](./02-verbatim-values.md). The
rules here govern colors Jess actually **computes**, plus one preservation rule for
authored alpha-hex.

## Computed alpha → `rgba(...)`

When a color operation produces an alpha below 1, the result serializes in
`rgba(...)` legacy syntax (the modern `rgb(r g b / a)` form is used only when the
source color was authored in modern syntax):

```jess
.a { color: fade(#e04141, 50%); }
```

```css
.a { color: rgba(224, 65, 65, 0.5); }
```

## Alpha-hex literals are preserved as hex

An authored alpha-hex literal — 4-digit `#rgba` or 8-digit `#rrggbbaa` — stays in hex
form when nothing operates on it, rather than being rewritten to `rgba(...)`:

```jess
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

Only a **computed** alpha-hex color canonicalizes — and then, with alpha < 1, it
follows the `rgba(...)` rule above.

## Out-of-gamut channels clamp

A computed color whose channels fall outside their valid range is **clamped** — rgb
channels to `0–255`, saturation/lightness to `0–100%`, alpha to `0–1`:

```jess
.a { color: lighten(#800000, 100%); }   // lightness past 100% -> clamps to white
```

```css
.a { color: #ffffff; }
```

This is the same color model as the Less 5.x engine — see the Less
[Color Output](https://lesscss.org/docs/advanced/color-output) page.
