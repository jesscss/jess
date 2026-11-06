# @jesscss/plugin-js

**Import bridge for JavaScript/TypeScript modules in stylesheets — a seed of the
JavaScript-execution / CSS-in-JS story.**

This plugin lets a stylesheet pull in JavaScript/TypeScript modules
(`.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`) — the mechanism behind `@use` /
`@-from` script imports and legacy Less `@plugin` loading. When installed, it is
auto-loaded by `jess`.

## Sandboxed execution

`plugin-js` does **not** run untrusted module code in your Node process. A
render that reaches a stylesheet script runs **whole** in a Deno process: the
compile itself, and the script as an ordinary in-process call. A render that
loads no script runs in Node as usual and never starts Deno. Deno enforces the
sandbox with its own permission flags (`docs/design/DENO-SANDBOX-COMPILE.md` in
the repository).

**Inside the Deno sandbox a render can:**

- **read** files under one read root: whichever is nearest the filesystem root
  of your `jsReadRoot`, the entry stylesheet's folder, and the folder your
  packages are installed in (the parent of the `node_modules` your package
  manager resolves them into; for a pnpm workspace package, the workspace
  root). Plus the installed compiler's own code. A read anywhere else is
  answered "not found". Deno checks the path as written, so a symlink inside
  the read root that points outside it is followed;
- **net** — nothing, unless you opt in with `allowHttp` (optionally narrowed to
  `allowNetHosts`).

Known limitation: Deno's module loader loads a file under any `node_modules`
folder through `require()` / `import()` even outside the read root (plain file
reads there are still refused).

**Inside the sandbox a script cannot:** read files outside the read root, write
any file, read environment variables (`Deno.env`), open network
connections unless you opted in, spawn subprocesses (`run`), load native code
(`ffi`), query the system (`sys`), or reach Node's `process`/`require`. A
request that runs too long is abandoned and the worker is **killed** (SIGKILL),
so a script that loops forever or hangs cannot keep burning a CPU in the
background.

What a sandboxed script still sees: its own source and the values you pass it,
plus whatever it can read under the read root (your project tree and its
installed packages) — treat those as readable by any script you import.

The sandbox protects your machine, not one compile from another. Scripts run
in the same engine as the compile and as each other, so a script reached by
one render can change what later renders of the same `Compiler` produce.
Treat everything a `Compiler` compiles as one trust domain. A `jsPlugin()`
instance you configure is one engine, shared by every `Compiler` it is
configured on, and one set in a `styles.config` is loaded once per process,
so it is shared too. To keep stylesheets you do not trust apart, give each its
own `Compiler` and configure no `jsPlugin()` instance that two of them share.

Values cross the boundary through a small typed bridge (dimensions, colors,
quoted strings, lists, detached rules, …).

The **only** code loaded directly in your Node process — outside the sandbox —
is the built-in `@jesscss/fns` package. It is recognized by the **realpath** of
the copy this plugin resolves through its own dependency, never by a package
name or a path that spells `@jesscss/fns`: a third-party package cannot opt into
in-process execution by naming or symlinking itself that way.

Trust here follows your **install graph**, not just the name. Because the trusted
copy is "the `@jesscss/fns` this plugin resolves," anything that changes what
that resolves to — a `pnpm`/`npm` `overrides`/replacement of `@jesscss/fns`, or a
writable `@jesscss/fns` install directory an attacker can drop a file into — makes
that code run in your Node process. That is the same trust you already place in
your own application code and dependency manifest; keep your lockfile and
`node_modules` as trusted as your source.

If no Deno binary is found, the plugin fails with a clear message instead of
falling back to unsandboxed execution.

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
