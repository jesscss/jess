# Jess 2.0.0-alpha.24

This alpha fixes how parser errors report their diagnostic code.

## Fixes

- Parser errors keep their own diagnostic code in the compiler API and the
  `lessc` CLI. Before, a code that core had not listed separately was reported
  as `parse/syntax-error`. This affected:
  - `parse/source-import-css-syntax`, for `@-import` with a media, `supports()`
    or `layer` condition but no `(css)` option;
  - `parse/import-postlude-on-compile-time-import`, for a compile-time
    `@import` with a `layer` or `supports()` condition.
- A new parser error code now only needs to be registered once, in core's
  error-code registry.

## Known limitations

The Less alpha fixture lane is a classified compatibility signal, not a claim
that every upstream Less 4.x fixture is byte-identical. The release-facing
inventory is
[`less-v5-corpus-inventory.md`](../state/less-v5-corpus-inventory.md), and the
readiness gates and remaining package-flow work are tracked in
[`less-v5-alpha-readiness.md`](../state/less-v5-alpha-readiness.md).
