---
title: "Extend and :is() Wrapping"
slug: "/advanced/extend-is-wrapping"
audiences:
  - less
origin: less
---

> How Less 5.x resolves `:extend(... all)` by grafting `:is(...)` into the matched
> selector, superseding the 4.x string-replace model.

Less 5.x re-specifies how the `all` form of [extend](../features/extend.md) produces
its output. Instead of doing a textual find-and-replace on compiled selectors (the
4.x model), 5.x matches by **compound-subset** and wraps the matched span with
`:is(...)`, preserving whatever came before and after it.

Matching always runs on the **compiled** selectors — after nesting and parent
selectors are resolved — never on source text.

## Whole-compound match: selector-list append

When the extend target matches an entire compound in the selector, the extender is
simply appended to the selector list (no `:is()`), exactly as with an exact extend:

```less
.a {
  color: red;
}
.b:extend(.a all) {}
```

```css
.a,
.b {
  color: red;
}
```

## Partial (sub-span) match: `:is(...)` grafting

When the target matches only *part* of a compound selector — a subset of the
compound, with context on one or both sides — 5.x grafts `:is(<matched>, <extender>)`
into that position, keeping the surrounding selector intact:

```less
.a > .c {
  color: red;
}
.x:extend(.c all) {}
```

```css
.a > :is(.c, .x) {
  color: red;
}
```

The `.a >` context on the left is preserved; only the matched `.c` compound is
wrapped. Because the extender is folded into a single `:is()` rather than emitting
a whole new expanded selector for every match site, cascades of extends compact
into far less CSS. This is the same [`:is()` compaction](./output-model.md#is-selector-compaction)
that shapes 5.x flattened output.

## Multi-target `all` and the `!all` flag

Per-selector `all` on each target (`:extend(.a all, .b all)`) is deprecated in
5.x in favor of a single trailing `!all` flag, which reads less ambiguously:

```less
// Deprecated:
&:extend(.a all, .b all);

// Preferred:
&:extend(.a, .b !all);
```

## Why this changed

The 4.x string-replace model produced one fully-expanded selector per match, which
multiplied selector output on deeply-nested extends and could reorder combinator
context in surprising ways. The compound-subset + `:is()` model keeps context
stable on both sides of the match and lets the output stay compact.

See also: [Extend](../features/extend.md) · [Output Model](./output-model.md).
