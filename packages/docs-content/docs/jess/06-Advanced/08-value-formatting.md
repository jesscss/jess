---
title: "Value & separator formatting"
sidebar_label: Value & separator formatting
audiences:
  - jess
origin: jess
---

Operators and list separators are **structural tokens the emitter owns** — they
print with consistent spacing regardless of how you wrote them. Only the *values*
around them follow the [verbatim rule](./02-verbatim-values.md).

## Operators and separators are spaced

`/`, `+`, `-`, `*`, and list commas emit **with a space on each side**:

```jess
.a {
  margin: 12px/16px;
  grid-area: 1/2/3/4;
}
```

```css
.a {
  margin: 12px / 16px;
  grid-area: 1 / 2 / 3 / 4;
}
```

The values themselves (`12px`, `16px`) still follow the verbatim rule — only the
separator glue is normalized.

## Comma value-lists normalize to `, `

An inline comma-separated list is re-glued with a single `, ` between items:

```jess
.a {
  font-family: Helvetica,Arial ,  sans-serif;
  transition: color 0.2s,background 0.2s;
}
```

```css
.a {
  font-family: Helvetica, Arial, sans-serif;
  transition: color 0.2s, background 0.2s;
}
```

A comma list authored **across multiple lines** keeps its line breaks — the newline
is a separator the author chose (long `box-shadow`/`grid-template` stacks), so it is
preserved instead of collapsed to a single-line `, `.

## Exception: `:nth-*()` `An+B` stays unspaced

The `An+B` microsyntax inside `:nth-child()`, `:nth-of-type()`, and friends is
**selector syntax**, never an arithmetic expression — so it is neither spaced nor
evaluated:

```jess
.a:nth-child(2n+1) { color: red; }
.b:nth-of-type(-n+3) { color: blue; }
```

```css
.a:nth-child(2n+1) { color: red; }
.b:nth-of-type(-n+3) { color: blue; }
```

This is the same emitter as the Less 5.x engine — see the Less
[Value & Separator Formatting](https://lesscss.org/docs/advanced/value-formatting)
page for the full rule set.
