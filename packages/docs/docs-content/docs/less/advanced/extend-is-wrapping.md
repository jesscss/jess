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

## Grouping keeps each selector's specificity

An `:is()` scores as its most specific argument, so grouping a class with an ID would
make the class branch score as the ID. Extend therefore groups only alternatives that
behave inside `:is()` exactly as they do on their own — the same rule the default
[`'native'` flatten](./selector-compaction.md#native-fold-only-what-keeps-native-specificity)
uses for nested selector lists:

- every alternative in one `:is()` has the **same specificity**;
- none carries a **pseudo-element**, and every pseudo-class is a standard one every
  major browser implements (`:is()` silently drops an argument a browser does not
  understand, where a plain selector list drops the whole rule);
- an alternative with a **combinator** (`.p .x`) joins an `:is()` only at the start of
  the selector. After a combinator, `.a > :is(.p .x)` would also match a `.p` that is
  not inside `.a`.

Alternatives that differ in specificity form separate equal-specificity groups, and an
alternative that cannot join a group is written out as its own selector — the Less 4.x
expanded form:

```less
.a > .c { color: red; }
.x:extend(.c all) {}
#b:extend(.c all) {}
.y:extend(.c all) {}
.p .q:extend(.c all) {}
```

```css
.a > :is(.c, .x, .y),
.a > #b,
.a > .p .q {
  color: red;
}
```

`.c`, `.x` and `.y` score `(0,1,0)` and share one `:is()`, even though `#b` was
written between them: the order of selectors inside one rule changes neither the
cascade nor specificity. Groups appear in the order their first member appears.

This holds in **every** output mode — nested, `'native'` and `'compact'`. Only the
nesting fold of `'compact'` groups selectors of different specificity.

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
