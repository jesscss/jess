---
id: exports
title: Exporting
audiences:
  - jess
origin: jess
---
Jess currently keeps exporting simple and predictable.

## Current practical export patterns

- In stylesheet space, share reusable APIs through modules: `@-compose` for another stylesheet, `@-from` / `@-use` for JS/TS module values. (Note that module **resolution** is not wired up yet in the alpha — see [Imports](/docs/Features/imports).)
- In bundler space, `rollup-plugin-jess` currently exports the compiled CSS string as the default JS export and emits a CSS asset.

## Notes

There is no dedicated language-level `@export` directive documented as stable yet. As that API settles, this page will become the canonical guide.