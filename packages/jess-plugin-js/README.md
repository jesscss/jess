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
and runs the module in a Deno subprocess behind a permission broker.

**Inside the Deno sandbox a script can:**

- **read** files, but only under `node_modules` and your optional `jsReadRoot`
  — paths are canonicalized (realpath) before the check, so a symlink or `..`
  cannot reach outside;
- **net** — nothing, unless you opt in with `allowHttp` (optionally narrowed to
  `allowNetHosts`).

**Inside the sandbox a script cannot:** read or write files outside those read
roots, write any file, read environment variables (`Deno.env`), open network
connections unless you opted in, spawn subprocesses (`run`), load native code
(`ffi`), query the system (`sys`), or reach Node's `process`/`require`. A
request that runs too long is abandoned and the worker is **killed** (SIGKILL),
so a script that loops forever or hangs cannot keep burning a CPU in the
background.

What a sandboxed script still sees: its own source and the values you pass it,
plus whatever it can read from the allowed read roots (your project tree and
installed packages) — treat those as readable by any script you import.

Values cross the boundary through a small typed bridge (dimensions, colors,
quoted strings, lists, detached rules, …).

The **only** code loaded directly in your Node process — outside the sandbox —
is the built-in `@jesscss/fns` package. It is recognized by the **realpath** of
the copy this plugin resolves through its own dependency, never by a package
name or a path that spells `@jesscss/fns`: a third-party package cannot opt into
in-process execution by naming or symlinking itself that way. If no Deno binary
is found, the plugin fails with a clear message instead of falling back to
unsandboxed execution.

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
