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

This is the same extend engine documented for Less 5.x. For the full behavior of
`:is()` grafting and multi-target `!all`, see the Less
[Extend and `:is()` Wrapping](https://lesscss.org/docs/advanced/extend-is-wrapping)
page.
