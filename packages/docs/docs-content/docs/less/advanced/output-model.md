---
title: "Output Model (Nesting & :is() Compaction)"
slug: "/advanced/output-model"
audiences:
  - less
origin: less
---

> How Less 5.x shapes its CSS output: nested by default, with optional `:is()` compaction.

Less 5.x changes two defaults that control the *shape* of the CSS it emits. Neither
changes the meaning of your styles — they change how the compiler serializes them.

## Nested output by default (`collapseNesting: false`)

Native CSS nesting is now a first-class part of the output. By default Less 5.x
**keeps** your nested structure (`collapseNesting: false`) instead of flattening
every rule to a fully-qualified selector the way Less 4.x did.

```less
.card {
  padding: 1rem;

  .title {
    font-weight: 600;
  }

  @media (min-width: 48rem) {
    padding: 1.25rem;
  }
}
```

Compiles to (default, `collapseNesting: false`):

```css
.card {
  padding: 1rem;
  .title {
    font-weight: 600;
  }
  @media (min-width: 48rem) {
    padding: 1.25rem;
  }
}
```

A direct consequence: **`@media` blocks are not merged.** Each nested `@media`
stays where it was written, inside its parent rule. Less 4.x bubbled and merged
media queries to the root; Less 5.x does not, because the nested `@media` is valid
CSS exactly where it sits.

### Opting into flattening (`collapseNesting: true`)

Set `collapseNesting: true` to get 4.x-style flattened output, where nested rules
are expanded to fully-qualified selectors and equivalent blocks are deduplicated:

```css
.card {
  padding: 1rem;
}
.card .title {
  font-weight: 600;
}
@media (min-width: 48rem) {
  .card {
    padding: 1.25rem;
  }
}
```

Use `collapseNesting: true` when you need to support browsers without native CSS
nesting, or when you want the historical Less 4.x output shape. Flattened output can
still contain `:is()`, so the browser needs `:is()` support (Chrome 88, Firefox 78,
Safari 14).

`true` means `'native'`: the flattened selectors keep the specificity and matching
native CSS nesting gives them, though not always its exact bytes — a nested list such
as `th, td` may print as `.table :is(th, td)` where every folded branch scores the
same. `'compact'` folds every nested list into `:is()` at the cost of group-maximum
specificity. See [Selector compaction](./selector-compaction.md).

## `:is()` selector compaction

When Less produces a rule that would otherwise repeat a selector list across many
expanded selectors, 5.x can compact those into a single `:is(...)` selector. This
keeps flattened output smaller and matches what modern CSS engines do.

Compaction most commonly shows up alongside `extend ... all` in nested or
selector-list cases. Several selectors of the same specificity that all need the same
descendant rule collapse to one:

```css
:is(.sidebar, .sidebar2, .sidebar3) .box {
  margin: 10px 0;
}
```

instead of three separate `.sidebar .box`, `.sidebar2 .box`, and `.sidebar3 .box`
rules. Extend never groups selectors of different specificity: `.type1 .sidebar3`
scores `(0,2,0)`, so it would join a separate group. See
[Extend and `:is()` wrapping](./extend-is-wrapping.md#grouping-keeps-each-selectors-specificity)
for the details of how extend feeds this compaction.

## Migration notes

- Diff your CSS output when upgrading — the *default* shape is nested now.
- If a downstream tool or target browser cannot handle native nesting, enable
  `collapseNesting: true`.
- Do not expect `@media` blocks to be hoisted/merged under the default. That is a
  deliberate 5.x change, not a bug.

See also: [Migrating to v5](../usage/migrating-to-v5.md).
