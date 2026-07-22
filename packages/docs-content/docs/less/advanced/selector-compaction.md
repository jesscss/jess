---
title: "Selector Compaction (`:is()` Nesting)"
slug: "/advanced/selector-compaction"
audiences:
  - less
origin: less
---

> When a `&`-less nested rule collapses onto its accumulated ancestor, Less 5.x
> factors the common ancestor out **once** and wraps each multi-branch side in a
> single `:is(...)` — instead of repeating the whole prefix or cartesian-expanding
> it into one row per combination.

This is the *nesting-collapse* form of `:is()` compaction. It is distinct from the
[extend `all` wrapping](./extend-is-wrapping.md), which grafts `:is()` into a matched
compound. Here the rule is about how a descendant block joins onto the selector it
is nested inside.

## The rule

Joining a nested `&`-less descendant `B` onto its ancestor `A` emits:

```
<A> <combinator> render(B)
```

where **each side** wraps in a single `:is(...)` **only if it is a multi-branch
comma list** (a single selector joins plainly). The ancestor `A` is emitted
**once**, as one opaque unit — never repeated inside the child's `:is()`, never
cartesian-distributed.

| Input | Output |
|---|---|
| `.a, .b { .c {…} }` | `:is(.a, .b) .c {…}` |
| `.a { .c, .d {…} }` | `.a :is(.c, .d) {…}` |
| `.a, .b { .c, .d {…} }` | `:is(.a, .b) :is(.c, .d) {…}` — one row |
| `.a, .b { & .c {…} }` | `.a .c, .b .c {…}` — `&` nesting cartesian-expands |
| `.a, .b {…}` | `.a, .b {…}` — a rule's own header stays a plain list |

Two things to internalize:

- **`&`-less descendant** → factored `:is()` join (the rows above).
- **`&`-based** child is a *different* path: each `&` substitutes over the full
  cartesian ancestor list (no `:is()`), producing one selector per combination.

## Worked example

A deeply-nested block factors its prefix instead of exploding combinatorially:

```less
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

The common ancestor `#first #deux :is(#fourth, #five, #six)` is written once per
child rule. Without compaction this would be `3 × 2 = 6` selectors for the first
rule alone; with it, each rule stays a single row.

## Why it differs from Less 4.x

Less 4.x fully expanded nested selector lists into a cartesian cascade — one rule per
combination. Less 5.x keeps output nested and compact: the prefix is factored so a
deep multi-selector block stays one row per rule instead of a combinatorial
explosion, matching how modern CSS engines evaluate `:is()`.

See also: [Output Model](./output-model.md) ·
[Extend and `:is()` Wrapping](./extend-is-wrapping.md).
