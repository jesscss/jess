# @jesscss/plugin-less-compat

**The Less.js 4.x compatibility bridge — run existing Less plugins and visitors
against the Jess AST.**

[Jess](https://github.com/jesscss/jess) needs to meet a Less 4.x ecosystem with
years of plugins and visitors written against the old Less AST. This package
bridges the two: it converts a Jess `Rules` tree to a
Less.js-compatible tree, runs Less 4.x visitors over it, and converts the result
back — so tools like autoprefixing or minification plugins can keep working
against Jess-compiled stylesheets.

It's the load-bearing piece of the eventual **`less@5` adoption layer**: the seam
that lets a Less 4.x project move onto Jess without abandoning its existing plugin
setup.

## How it works

- **Bidirectional transformation** between Jess AST nodes and Less.js AST nodes,
  with lazy per-field conversion so only the fields a visitor touches are
  materialized.
- **Visitor support** — Less 4.x visitors run over the converted tree.
- Package resolution for `@plugin "name"` is delegated to
  [`@jesscss/plugin-node-modules`](../jess-plugin-node-modules).

## Status

**Alpha / experimental.** It works for the plugins it has been exercised against
(e.g. `less-plugin-autoprefix`, `less-plugin-clean-css`, `less-plugin-dls`), but
it has not been validated across the whole Less plugin ecosystem, and the surface
may change. If you need broad, battle-tested Less-plugin support today, use
Less.js directly.

The programmatic plugin/compiler API is **not yet stabilized** — the `jess` CLI
is the documented public surface for the alpha. Watch the
[docs site](https://jesscss.github.io/) for the API once it settles. Current
design notes live in [DESIGN.md](./DESIGN.md).

- Project overview & positioning: <https://github.com/jesscss/jess#readme>
- Docs: <https://jesscss.github.io/> (currently pre-alpha content)
- Issues: <https://github.com/jesscss/jess/issues>
- License: MIT
