---
title: "Extend and :is() wrapping"
sidebar_label: Extend
audiences:
  - jess
origin: jess
---

Jess writes extend with the `$extend` form. `$extend` defaults to **partial**
(compound-subset) matching — the equivalent of Less's `:extend(... all)`:

```jess
.a > .c {
  color: red;
}
.x {
  $extend .c;         // partial (default): matches the .c compound anywhere
}
```

```css
.a > :is(.c, .x) {
  color: red;
}
```

When the target matches only *part* of a compound selector, Jess grafts
`:is(<matched>, <extender>)` into that position, preserving the surrounding context
(`.a >` stays on the left). When the target matches a whole compound, the extender
is appended to the selector list instead (no `:is()` wrapper).

Grouping the match and the extender into `:is()` also raises **specificity**: an
`:is()` scores as its most specific argument, so `.a > :is(.c, #b)` scores an ID even
for the plain-class `.c` branch. See
[Selector compaction — Specificity and `:is()` grouping](./09-selector-compaction.md#specificity-and-is-grouping-nesting--extend)
for the cascade implications and the vs-4.x migration note.

## Exact matching

Use `!exact` to require a whole-selector match — the equivalent of Less's plain
`:extend(...)` without `all`:

```jess
.x {
  $extend .c !exact;   // only matches a bare `.c` compound, appends to the list
}
```

## Notes

- Matching runs on **compiled** selectors (after nesting/parent resolution), never
  on source text.
- An interpolated selector as a match *target* matches nothing; an interpolated
  *extender* works.
- Extend is **selector-level** — it shares a rule's whole declaration block and cannot
  pull in a single property.
- Target matching is **exact** apart from attribute-quote normalization: a leading
  star, pseudo-class order, and `nth` form all matter.
- An extend targeting a `(reference)`-imported rule surfaces the declarations under
  *your* selector only; the referenced target header is never emitted.

This is the same extend engine documented for Less 5.x. For the full behavior —
`:is()` grafting, sibling compaction, nested re-nesting and its flatten triggers,
`@media` scoping, and reference visibility — see the Less
[Extend and `:is()` Wrapping](https://lesscss.org/docs/advanced/extend-is-wrapping)
and [Extend Semantics](https://lesscss.org/docs/advanced/extend-semantics) pages.
