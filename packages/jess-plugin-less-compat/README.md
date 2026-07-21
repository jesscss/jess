# @jesscss/plugin-less-compat

**The Less.js 4.x compatibility package for legacy plugin loading, functions,
and post-processors.**

[Jess](https://github.com/jesscss/jess) needs to meet a Less 4.x ecosystem with
years of plugins and visitors written against the old Less AST. This package
contains the legacy-tree conversion work needed for a future explicit adapter.
The public AST-v2 compiler route does **not** invoke a generic Less visitor
bridge today; it must not be presented as working visitor support.

It's the load-bearing piece of the eventual **`less@5` adoption layer**: the seam
that lets a Less 4.x project move onto Jess without abandoning its existing plugin
setup.

## How it works

- **Bidirectional transformation** between Jess AST nodes and Less.js AST nodes,
  with lazy per-field conversion so only the fields a visitor touches are
  materialized.
- **Legacy visitor shapes** are isolated inside this package, not exposed on
  `@jesscss/core`'s plugin interface. Wiring a future AST-v2 adapter requires a
  separately designed, tested execution seam.
- Package resolution for `@plugin "name"` is delegated to
  [`@jesscss/plugin-node-modules`](../jess-plugin-node-modules).

## Status

**Alpha / experimental.** The supported public route covers the package's active
loading, function, and CSS post-processing capabilities. Legacy visitor execution
is not currently wired into AST-v2 compilation. If you need broad, battle-tested
Less visitor support today, use Less.js directly.

The programmatic plugin/compiler API is **not yet stabilized** — the `jess` CLI
is the documented public surface for the alpha. Watch the
[docs site](https://jesscss.github.io/) for the API once it settles. Current
design notes live in [DESIGN.md](./DESIGN.md).

- Project overview & positioning: <https://github.com/jesscss/jess#readme>
- Docs: <https://jesscss.github.io/> (currently pre-alpha content)
- Issues: <https://github.com/jesscss/jess/issues>
- License: MIT
