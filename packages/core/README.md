# @jesscss/core

**The Jess compiler engine: the AST, evaluator, and single-pass serializer that
turn a parsed stylesheet into CSS.**

`@jesscss/core` is the engine at the heart of
[Jess](https://github.com/jesscss/jess) — Less.js v5, a ground-up rewrite of the
Less CSS preprocessor. It defines the syntax tree that every Jess parser produces,
evaluates that tree (resolving variables, expanding mixins, running functions,
applying `extend`, and folding nesting), and renders the result to CSS.

The AST lives here rather than in the `jess` package so that parsers can depend on
the tree without pulling in the compiler, and `jess` can depend on the parsers
plus core — avoiding a circular dependency.

## What's inside

- **The AST** — the node types (`Rules`, declarations, selectors, values, …) that
  make up a parsed stylesheet, shared by every language grammar.
- **The evaluator** — resolves the language semantics over that tree.
- **The single evaluate-and-emit pass** (the "spine") — serializes directly over
  one canonical source tree instead of repeatedly cloning and re-walking nodes.
  This is the rewrite's headline architectural bet, and the reason the engine is
  being rebuilt rather than patched.
- **The plugin interface** — the seam that language engines
  (`@jesscss/plugin-less`, `@jesscss/plugin-scss`) and compatibility layers wire
  into.
- **Diagnostics** — the error and deprecation types Jess reports through.

## Who uses it

This is an internal engine package. Most people should install
[`jess`](https://www.npmjs.com/package/jess) and use the `jess` / `lessc` CLIs
rather than depending on `@jesscss/core` directly. Its JavaScript/TypeScript API
is **not yet stabilized** and is intentionally undocumented for now.

## Status

Alpha. Jess renders real `.less` today and is being dogfooded against the Less
test suite and Bootstrap, but it is early software with known rendering gaps.
Published to npm under both the `latest` and `alpha` dist-tags. Please
[report bugs](https://github.com/jesscss/jess/issues).

## Links

- Repository: <https://github.com/jesscss/jess>
- Documentation: <https://jesscss.github.io/> (currently pre-alpha content)

## License

[MIT](https://github.com/jesscss/jess/blob/dev/LICENSE)
