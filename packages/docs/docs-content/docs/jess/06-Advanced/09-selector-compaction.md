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

## Specificity and `:is()` grouping (nesting & extend)

Folding branches into `:is(...)` — from this nesting collapse or from
[extend](./05-extend.md)'s `:is()` grafting — changes how a browser scores the
selector, because `:is()` does **not** score as zero. Per the CSS spec, *the
specificity of an `:is()` is the specificity of its most specific argument*
([Selectors Level 4 — specificity](https://www.w3.org/TR/selectors-4/#specificity-rules)).
So a low-specificity branch grouped with a high-specificity one inherits the group's
**maximum**: `:is(.a, #b)` scores as the ID `#b` — `(1,0,0)` — for *both* branches.

Nesting collapse carries that group score into the join (flattened output):

```jess
.a, #b {
  .c { color: red; }
}
```

```css
:is(.a, #b) .c {
  color: red;
}
```

`:is(.a, #b)` scores `(1,0,0)`, so the whole selector scores **`(1,1,0)`** — the
`.a .c` match now carries ID-level weight it would not have on its own. Extend's
partial-match grafting behaves the same way: `.a > .c` extended by `#b` renders
`.a > :is(.c, #b)`, also **`(1,1,0)`**.

**Migration note vs. less.js 4.x.** 4.x expanded these into a comma-separated cascade,
each row keeping its **own** specificity; 5.x/Jess groups them into one `:is()` scored
at the maximum:

| Source | 4.x output (per-row specificity) | 5.x output (group specificity) |
|---|---|---|
| `.a, #b { .c {} }` | `.a .c` `(0,2,0)`, `#b .c` `(1,1,0)` | `:is(.a, #b) .c` — both `(1,1,0)` |
| `.a > .c {}` + `#b:extend(.c all)` | `.a > .c` `(0,2,0)`, `.a > #b` `(1,1,0)` | `.a > :is(.c, #b)` — both `(1,1,0)` |

When the grouped branches share specificity (the common all-classes case, `:is(.a, .b)`)
nothing changes — the shift is observable only when branches of **different**
specificity are grouped, where the lower-specificity branch inherits the group's higher
score and can flip a close cascade 4.x resolved per-row. The nesting-collapse grouping
is the flattened-output form (`collapseNesting: true`); the 5.x-default nested output
keeps the multi-parent header a plain comma list, so this applies to flattened output.
Extend's `:is()` grafting appears in **both** nested and flattened output.
