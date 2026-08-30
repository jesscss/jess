---
title: "Output model: nesting & :is() compaction"
sidebar_label: Output model
audiences:
  - jess
origin: jess
---

Jess is **nested-native**. The compiler keeps your nested structure in the emitted
CSS by default (`collapseNesting: false`), because native CSS nesting is now widely
supported and is valid CSS exactly where you write it.

```jess
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

compiles to:

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

Two consequences worth internalizing:

- **`@media` blocks are not hoisted or merged.** A nested `@media` stays inside its
  parent rule.
- When you *do* flatten (`collapseNesting: true`), selectors that would otherwise
  repeat are compacted into a single `:is(...)` selector, so flattened output stays
  small.

## Flattening for older targets

Set `collapseNesting: true` when you need to support engines without native CSS
nesting. Jess then expands nested rules to fully-qualified selectors and dedupes
equivalent blocks — the historical preprocessor output shape.

## Relationship to Less

This is the same output model documented for the Less 5.x engine. For the full set
of examples, including `:is()` compaction driven by extend, see the Less
[Output Model](https://lesscss.org/docs/advanced/output-model) page.
