# @jesscss/plugin-less

**The Less language engine for Jess — the Less parser wired in with Less v5
rendering defaults.**

This is the Less language engine behind the shipping alpha surface.
`plugin-less` layers the Less grammar (`@jesscss/less-parser`) onto the Jess
compiler, registers the Less built-in functions (`@jesscss/fns`), and sets the
current output defaults. The `jess` CLI loads it by default, so if you render
`.less` you are already using it — you don't need to install this package
separately for normal CLI use.

## What it does

- Parses `.less` into the Jess AST and hands it to the engine for a single
  evaluate-and-emit pass.
- Registers the Less/Sass style-function library so `lighten()`, `percentage()`,
  string and list helpers, etc. are available during evaluation.
- Owns the current Less-facing output defaults used across the alpha surface.

## Current output defaults

The defaults this plugin applies:

- `collapseNesting: false` — **nesting is preserved by default.** Less 4.x
  flattened selectors; in v5 that flattening is an explicit opt-in
  (`--collapse-nesting` on the CLI).
- `mathMode: 'parens-division'`, `unitMode: 'preserve'`, `leakyScope: true`,
  `bubbleRootAtRules: true`.

These keep the current Less-facing surface aligned on one set of output
semantics.

Equality is not among them, because it is not a mode. The Less grammar lowers
`=` to the loose comparison primitive, and that lowered node is what the
evaluator reads — there is no `equalityMode` for this plugin to set. See
`docs/design/RESOLVED-SEMANTICS-AND-NAMING.md` §5.1 and §7.3 for the full `op`
table, and §5.2 for the one `.less` behaviour this shifts: a quoted operand now
compares on string ground, so `a = "a"` is true where Less 4.x answers false.

## Status

**Alpha.** This is the shipping Less-facing engine in the current Jess alpha. It
renders real Less, but it is early software with known rendering gaps and
expected failures; don't ship it to production yet, and please
[report bugs](https://github.com/jesscss/jess/issues).

The programmatic plugin/compiler API is **not yet stabilized** — the `jess` CLI
is the documented public surface for the alpha. Watch the
[docs site](https://jesscss.github.io/) for the API once it settles.

- Project overview & positioning: <https://github.com/jesscss/jess#readme>
- Docs: <https://jesscss.github.io/> (currently pre-alpha content)
- Issues: <https://github.com/jesscss/jess/issues>
- License: MIT
