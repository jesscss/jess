# Jess 2.0.0-alpha.25

This alpha makes the module model explicit in both Jess and Less, tightens
Less value and function semantics, and replaces removed inline JavaScript with
a migration-ready diagnostic.

## Highlights

### Explicit modules and function references

- A Less file that uses `@use` or `@compose` enters modern mode. Built-in Less
  functions are no longer ambient in that file; import `#less` and call them
  through the imported namespace. Files without either directive keep legacy
  behavior. The `moduleMode: 'modern'` option applies modern mode to every Less
  file in a compilation.
- Jess calls imported functions through an explicit `$` reference, such as
  `$double(10px)` or `$math.round(1.5)`. A bare `double(10px)` remains a CSS
  function call even when a module exports that name.
- Module members work in condition values, including
  `$if ($flags.enableShadow) { ... }`. Nested expressions, space-list
  arguments, and quoted positional arguments remain intact in imported calls.

### Less values, calls, and conversion

- Less division and slash-separated values now have one consistent parse.
  Computed math is represented as expressions, math inside `calc()` stays
  authored, and division by zero raises an evaluation error.
- Calls that remain CSS evaluate their arguments without losing ruleset
  blocks. A value-producing call used as a standalone statement now raises
  `eval/invalid-statement` instead of emitting invalid CSS or disappearing.
- Jess can emit `.jess` source from the canonical tree. The Less-to-Jess
  equivalence lane now checks that a converted stylesheet renders the same CSS
  as its Less source.

### Parsing and diagnostics

- Removed Less backtick JavaScript now raises
  `parse/unsupported-inline-javascript` with guidance to move the code into a
  JavaScript module loaded through `@use`. Editor parsing underlines each
  complete or unfinished construct and keeps later document structure.
- Escaped Less at-keywords follow CSS decoding rules. Escaped variable names
  are decoded and then checked by the same validity rules as plain names.
- CSS-shaped general-enclosed query content is preserved without evaluating
  nested syntax that the query grammar does not own.

### Documentation delivery

- The Jess documentation site now deploys automatically after every merge to
  `dev`, from the shared Jess/Less documentation source.
- The module and plugin pages now use the current `@compose` and `@use` syntax
  and explain the explicit function-reference rules.

## Known limitations

The Less alpha fixture lane is a classified compatibility signal, not a claim
that every upstream Less 4.x fixture is byte-identical. The release-facing
inventory is
[`less-v5-corpus-inventory.md`](../state/less-v5-corpus-inventory.md), and the
readiness gates and remaining package-flow work are tracked in
[`less-v5-alpha-readiness.md`](../state/less-v5-alpha-readiness.md).
