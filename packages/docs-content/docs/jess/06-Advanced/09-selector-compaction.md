---
title: "Selector compaction (:is() nesting)"
sidebar_label: Selector compaction
audiences:
  - jess
origin: jess
---

When a `&`-less nested rule collapses onto its accumulated ancestor, Jess factors
the common ancestor out **once** and wraps each multi-branch side in a single
`:is(...)` — instead of repeating the whole prefix or cartesian-expanding it into
one row per combination.

## The rule

Joining a `&`-less descendant onto its ancestor emits the ancestor once, then wraps
**each side** in `:is(...)` **only if it is a multi-branch comma list** (a single
selector joins plainly):

| Input | Output |
|---|---|
| `.a, .b { .c {…} }` | `:is(.a, .b) .c {…}` |
| `.a { .c, .d {…} }` | `.a :is(.c, .d) {…}` |
| `.a, .b { .c, .d {…} }` | `:is(.a, .b) :is(.c, .d) {…}` — one row |
| `.a, .b { & .c {…} }` | `.a .c, .b .c {…}` — `&` nesting cartesian-expands |
| `.a, .b {…}` | `.a, .b {…}` — a rule's own header stays a plain list |

A `&`-based child is a different path: each `&` substitutes over the full cartesian
ancestor list (no `:is()`).

## Worked example

```jess
#first #deux {
  #fourth, #five, #six {
    .seven, .eight > #nine { margin: 0; }
    #ten { padding: 0; }
  }
}
```

```css
#first #deux :is(#fourth, #five, #six) :is(.seven, .eight > #nine) {
  margin: 0;
}
#first #deux :is(#fourth, #five, #six) #ten {
  padding: 0;
}
```

The common ancestor is written once per child rule instead of exploding into `3 × 2`
selectors. This is the same compaction as the Less 5.x engine — see the Less
[Selector Compaction](https://lesscss.org/docs/advanced/selector-compaction) page for
the details, and [Extend](./05-extend.md) for the separate extend-driven `:is()`
grafting.
