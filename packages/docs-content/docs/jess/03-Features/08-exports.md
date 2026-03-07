---
id: exports
title: Exporting
audiences:
  - jess
origin: jess
---
Jess currently keeps exporting simple and predictable.

## Current practical export patterns

- In stylesheet space, share reusable APIs through imported modules (mixins, variables, and JS module values via `@import`).
- In bundler space, `rollup-plugin-jess` currently exports the compiled CSS string as the default JS export and emits a CSS asset.

## Notes

There is no dedicated language-level `@export` directive documented as stable yet. As that API settles, this page will become the canonical guide.