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

## Specificity and `:is()` grouping (nesting & extend)

Folding branches into `:is(...)` — whether from the nesting collapse above or from
[extend's `all` grafting](./extend-is-wrapping.md) — changes how a browser scores the
selector, because `:is()` does **not** score as zero. Per the CSS spec, *the
specificity of an `:is()` is the specificity of its most specific argument*
([Selectors Level 4 — specificity](https://www.w3.org/TR/selectors-4/#specificity-rules)).

So when a low-specificity branch is grouped with a high-specificity one, the whole
group scores at the **maximum** — and every branch inside it inherits that score:

- `:is(.a, #b)` scores as the ID `#b` — `(1,0,0)` — for *both* branches, including the
  plain-class `.a` one.

**Nesting collapse.** A multi-parent header that collapses onto a descendant carries
its group specificity into the join:

```less
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
`.a .c` match now carries ID-level weight it would not have on its own.

**Extend.** A partial-match extender grafts `:is(...)` into the compound (see
[Extend and `:is()` Wrapping](./extend-is-wrapping.md)), with the same effect:

```less
.a > .c { color: red; }
#b:extend(.c all) {}
```

```css
.a > :is(.c, #b) {
  color: red;
}
```

`:is(.c, #b)` scores `(1,0,0)`; the whole selector scores **`(1,1,0)`** — the original
`.c` match is now scored as though it were the ID `#b`.

### Migration note vs. Less 4.x

Less 4.x expanded both of these into a comma-separated cascade, each row keeping its
**own** specificity. 5.x groups them into one `:is()` scored at the group maximum:

| Source | 4.x output (per-row specificity) | 5.x output (group specificity) |
|---|---|---|
| `.a, #b { .c {} }` | `.a .c` `(0,2,0)`, `#b .c` `(1,1,0)` | `:is(.a, #b) .c` — both `(1,1,0)` |
| `.a > .c {}` + `#b:extend(.c all)` | `.a > .c` `(0,2,0)`, `.a > #b` `(1,1,0)` | `.a > :is(.c, #b)` — both `(1,1,0)` |

When the grouped branches have **equal** specificity — the common case, e.g. all
classes (`:is(.a, .b)`) — nothing changes. The shift is observable only when branches
of **different** specificity are grouped: the lower-specificity branch inherits the
group's higher score, which can flip a close cascade that 4.x resolved per-row.

:::note
The nesting-collapse `:is()` grouping shown here is the **flattened**-output form
(`collapseNesting: true`). In the 5.x default nested output the multi-parent header
stays a plain comma list (`.a, #b { .c {…} }`) and no `:is()` is emitted at the join,
so this specificity shift applies to flattened output. Extend's `:is()` grafting, by
contrast, appears in **both** nested and flattened output.
:::

See also: [Output Model](./output-model.md) ·
[Extend and `:is()` Wrapping](./extend-is-wrapping.md).
