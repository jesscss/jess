---
title: "Value & Separator Formatting"
slug: "/advanced/value-formatting"
audiences:
  - less
origin: less
---

> In Less 5.x, operators and list separators are **structural tokens the emitter
> owns** — they print with consistent spacing regardless of how you wrote them.
> Only the *values* around them follow the [verbatim rule](./verbatim-values.md).

Less 4.x copied whatever spacing you typed around a `/`, and printed a legacy tight
slash (`12px/16px`). Less 5.x treats `/`, `+`, `-`, `*`, and list commas as
separators, not values — so their spacing is a formatting decision, not
source-verbatim data. The result is one predictable shape no matter the input.

## Operators and separators are spaced

`/`, `+`, `-`, `*`, and list commas emit **with a space on each side**:

```less
.a {
  margin: 12px/16px;
  grid-area: 1/2/3/4;
  --ratio: 10px / 2px + 6px;   // preserved (un-operated) math, still spaced
}
```

```css
.a {
  margin: 12px / 16px;
  grid-area: 1 / 2 / 3 / 4;
  --ratio: 10px / 2px + 6px;
}
```

The values themselves (`12px`, `16px`) still follow the verbatim rule — only the
separator glue is normalized. Preserved math (an expression Less did not compute,
e.g. a `--custom-property` value) keeps its operands spaced the same way.

## Comma value-lists normalize to `, `

An inline comma-separated list is re-glued with a single `, ` between items,
regardless of the authored spacing:

```less
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

### Newline-carrying separators are preserved

A comma list authored **across multiple lines** keeps its line breaks — the newline
is a meaningful separator the author chose (common for long `grid-template`,
`box-shadow`, or `background` stacks), so it is preserved instead of being collapsed
to a single-line `, `:

```less
.a {
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.2),
    0 2px 8px rgba(0, 0, 0, 0.1);
}
```

```css
.a {
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.2),
    0 2px 8px rgba(0, 0, 0, 0.1);
}
```

## Exception: `:nth-*()` `An+B` stays unspaced

The `An+B` microsyntax inside `:nth-child()`, `:nth-of-type()`, and the other
`:nth-*()` selectors is **selector syntax**, not an arithmetic expression. Its `+`
is never treated as an operator: it is neither spaced nor evaluated.

```less
.a:nth-child(2n+1) { color: red; }
.b:nth-of-type(-n+3) { color: blue; }
```

```css
.a:nth-child(2n+1) { color: red; }
.b:nth-of-type(-n+3) { color: blue; }
```

Spacing `2n+1` to `2n + 1` would both misformat the selector and risk routing it
through the arithmetic path. It stays exactly as written.

See also: [Verbatim Values](./verbatim-values.md) ·
[Number Precision](./number-precision.md) · [Operations](../features/strictmath.md).
