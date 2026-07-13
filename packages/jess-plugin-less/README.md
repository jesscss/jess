# @jesscss/plugin-less

**The Less language engine for Jess — the Less parser wired in with Less v5
rendering defaults.**

This is the one shipping surface today. [Jess](https://github.com/jesscss/jess)
*is* Less.js v5, and `plugin-less` is where that lives: it layers the Less
grammar (`@jesscss/less-parser`) onto the Jess compiler, registers the Less
built-in functions (`@jesscss/fns`), and sets the v5 output defaults. The `jess`
and `lessc` CLIs load it by default, so if you render `.less` you are already
using it — you don't need to install this package separately for normal CLI use.

## What it does

- Parses `.less` into the Jess AST and hands it to the engine for a single
  evaluate-and-emit pass.
- Registers the Less/Sass style-function library so `lighten()`, `percentage()`,
  string and list helpers, etc. are available during evaluation.
- Owns the **Less v5 output defaults** — the single source of truth the `lessc`
  CLI imports so CLI and engine defaults can never drift.

## Less v5 output defaults

The defaults this plugin applies:

- `collapseNesting: false` — **nesting is preserved by default.** Less 4.x
  flattened selectors; in v5 that flattening is an explicit opt-in
  (`--collapse-nesting` on the CLI).
- `mathMode: 'parens-division'`, `unitMode: 'preserve'`, `equalityMode: 'less'`,
  `leakyScope: true`, `bubbleRootAtRules: true`.

These keep the Less 4.x command surface (flags, stdin/stdout, exit codes) while
producing Less **v5** output semantics.

## Status

**Alpha.** This is the **"Now" / Less.js tier** — the earned, shipping-today
surface. It is real and renders real Less, but it is early software with known
rendering gaps and expected failures; don't ship it to production yet, and please
[report bugs](https://github.com/jesscss/jess/issues).

The programmatic plugin/compiler API is **not yet stabilized** — the `jess` /
`lessc` CLIs are the public surface for the alpha. Watch the
[docs site](https://jesscss.github.io/) for the API once it settles.

- Project overview & positioning: <https://github.com/jesscss/jess#readme>
- Docs: <https://jesscss.github.io/> (currently pre-alpha content)
- Issues: <https://github.com/jesscss/jess/issues>
- License: MIT
