# Jess 2.0.0-alpha.23

This alpha finishes script and data module imports and aligns the Less parser
with the rule for dashed Less at-rules.

## Highlights

### Script and data modules

- Jess `@-use` and `@-from`, and Less `@use` / `@-use`, now load modules
  instead of passing the directive through to CSS.
- JSON modules become stylesheet values. Local and package JavaScript or
  TypeScript modules load through the optional `@jesscss/plugin-js` sandbox.
  Trusted built-in modules such as `#sass/*` and `#less` need no script
  runtime.
- Module files load once per compilation. Their exports become lexical
  bindings when the stylesheet renders, and stylesheets without module imports
  pay no extra cost.
- Less derives the module namespace from the file name.

### Dashed Less at-rules

- Every Less-specific at-rule accepts a dashed spelling that behaves the same
  as the plain one. `@-plugin` is now the same directive as `@plugin`; before,
  it passed through to the CSS output.
- `@-import` keeps Less import semantics. It accepts every Less import option,
  including `(inline)`, and rejects a media, `supports()` or `layer`
  condition instead of wrapping the imported rules in `@media`.
- `@-import (css)` is the one explicit request for a CSS import: the rest
  parses as a plain CSS `@import` and the output keyword is `@import`.

### Documentation

- The shared modules page is the source of truth for `@compose`, `@use`, and
  `@import` across the Jess and Less documentation sites.

## Known limitations

The Less alpha fixture lane is a classified compatibility signal, not a claim
that every upstream Less 4.x fixture is byte-identical. The release-facing
inventory is
[`less-v5-corpus-inventory.md`](../state/less-v5-corpus-inventory.md), and the
readiness gates and remaining package-flow work are tracked in
[`less-v5-alpha-readiness.md`](../state/less-v5-alpha-readiness.md).
