# @jesscss/plugin-js

**Import bridge for JavaScript/TypeScript modules in stylesheets — a seed of the
JavaScript-execution / CSS-in-JS story.**

This plugin lets a stylesheet pull in JavaScript/TypeScript modules
(`.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`) — the mechanism behind `@use` /
`@-from` script imports and legacy Less `@plugin` loading. When installed, it is
auto-loaded by `jess`.

## Sandboxed execution

`plugin-js` does **not** run untrusted module code in your Node process. Before
executing anything, it checks for a usable **Deno** runtime (`deno --version`)
and runs the module in a Deno subprocess behind a permission broker:

- **read** is limited to `node_modules` (and an optional `jsReadRoot`),
- **net** is denied unless you opt in (`allowHttp`, optionally scoped to
  `allowNetHosts`),
- **env / write / run / ffi / sys** are denied outright.

Values cross the boundary through a small typed bridge (dimensions, colors,
quoted strings, lists, detached rules, …). Built-in `@jesscss/fns` modules are
trusted and imported directly, without the worker. If no Deno binary is found,
the plugin fails with a clear message instead of falling back to unsandboxed
execution.

## Why it exists — the convergence angle

One of the four tools [Jess](https://github.com/jesscss/jess) aims to converge is
**CSS-in-JS**: running real JavaScript inside stylesheets so styles can be
dynamic without leaving CSS files. This plugin — together with
[`@jesscss/plugin-node-modules`](../jess-plugin-node-modules), which resolves the
packages — is a seed of that story.

That convergence is **roadmap — being proven through the alpha, not claimed as
done.** Legacy Less `@plugin` is supported for compatibility but deprecated in
favor of `@-from` / `@-use`.

## Status

**Alpha.** Part of Jess. Requires a Deno runtime for script execution. The
programmatic plugin/compiler API is **not yet stabilized** — the `jess` CLI is
the documented public surface for the alpha. Watch the
[docs site](https://jesscss.github.io/) for the API once it settles.

- Project overview & positioning: <https://github.com/jesscss/jess#readme>
- Docs: <https://jesscss.github.io/> (currently pre-alpha content)
- Issues: <https://github.com/jesscss/jess/issues>
- License: MIT
