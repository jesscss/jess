---
id: exports
title: Exporting
audiences:
  - jess
origin: jess
---
Jess currently keeps exporting simple and predictable.

## Current practical export patterns

- In stylesheet space, share reusable APIs through `@-compose` stylesheet
  modules. The `@-from` / `@-use` script-module syntax is still a preview and
  does not bind exports in the current alpha. See
  [Modules & imports](/docs/language/modules-and-imports).
- In bundler space, `rollup-plugin-jess` currently exports the compiled CSS string as the default JS export and emits a CSS asset.

## Notes

There is no dedicated language-level `@export` directive documented as stable yet. As that API settles, this page will become the canonical guide.
