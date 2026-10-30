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

- **read** files, but only inside your optional `jsReadRoot`, a `node_modules`
  directory on `jsReadRoot`'s own ancestor chain (where your package manager
  installs dependencies and pnpm keeps its store), or the root of a package your
  stylesheet names (`@plugin "x"`, or `@use` of a JS module). Such a plugin is
  found by normal package resolution, which can place it outside those
  directories; the package it resolved into — the nearest directory with a
  `package.json` above its realpath, inside a `node_modules` — becomes readable,
  and only that package: never a sibling package or the rest of that
  `node_modules`, and never any `node_modules` elsewhere on the machine. Paths
  are canonicalized (realpath) before the check, so a symlink or `..` cannot
  reach outside, and with no `jsReadRoot` set every read is denied;
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
plus whatever it can read from the allowed read roots (your project tree, its
installed packages and every package a stylesheet named) — treat those as
readable by any script you import.

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

## Where scripts run: `compile.jsSandbox`

| Setting | Where the compile runs | Where scripts run | Cost per plugin call |
|---|---|---|---|
| `'call'` (default) | Node | the Deno sandbox | one round trip to Deno |
| `'compile'` | the Deno sandbox | the Deno sandbox, in-process with the compiler | an ordinary function call |
| `false` | Node | Node, with no sandbox (as Less 4.x runs them) | an ordinary function call |

The `jess` CLI takes the same setting as `--js-sandbox call|compile|off`.
Without this plugin installed the setting changes nothing: compiles run in
Node, and a stylesheet that loads a script is refused as before.

With `'compile'`, the compiler sends one request per compile to a Deno process
the plugin keeps for the life of the compiler: the entry path, the compiler
options as data, and the module and export of the compiler class. Deno imports
that same compiler from where it is installed and renders. Scripts load once and
load again only when their file changes. The reply is the CSS and what the
compile printed (its warnings), which the host writes to its own stderr; a
compile error is rethrown in the host as the same `JessError`.

Compiler options cross as data. A plugin instance (`lessPlugin()`) is sent as
the module that exports its class plus its `opts`, and Deno constructs its own.
A function in the options (an inline Less plugin's `install`, say) is sent as
its source and rebuilt in the sandbox: plugin functions are pure, so the source
is the function. A rebuilt function that reads a variable from the caller's
scope fails at that read with a message naming the variable.

### Permissions of the compile engine

The compiler and every script it loads share one Deno process, so the
process's permissions are the scripts' permissions. Each check goes to the same
permission broker as the per-call worker. Paths are canonicalized (realpath)
before the check, so a symlink or `..` cannot reach outside; a path that does
not exist yet is judged by where its nearest existing parent really is.

| Permission | Granted | Why |
|---|---|---|
| read: the script root | `jsReadRoot` (default: the entry's folder, or its config's), with the `node_modules` folders above it, as in `'call'` mode | the stylesheets and scripts of the project |
| read: include paths | each `paths` / `searchPaths` folder of the compile | stylesheets imported through them |
| read: `NODE_PATH` packages | each package in each `NODE_PATH` folder, at its real location | Node resolves package imports through them, and so does the engine |
| read: the compiler's code | the installed package of the compiler class and its dependency closure (regular, optional and installed peer dependencies), and this plugin | the engine imports the compiler, and loads parts of it lazily |
| read: config search | each folder from a root up to its package root (the folder entry itself), and only the `styles.config.*`, `package.json`, `package.yaml` names in it | each source's settings come from its nearest `styles.config.*`, found by walking up to the package root |
| read: the working directory | the folder entry, its `package.json`/`package.yaml`, and `.config/config.*` | the config loader looks for its own meta-config there when it starts |
| net | nothing, unless `allowHttp` (optionally narrowed to `allowNetHosts`) | as in `'call'` mode |
| write | nothing | the CSS comes back as data and the host writes it; a TypeScript `styles.config.ts` is loaded by Deno itself, not compiled to a temp file beside it |
| env | nothing | the few variables the compile reads (`JESS_PROFILE`, `JESS_NO_DECLMAP_MEMO`, `NO_COLOR`) are sent as data |
| sys | nothing | the home and temp directory paths the config loader reads at startup are sent as data |
| run, ffi | nothing | |

What a script can reach in `'compile'` mode beyond `'call'` mode: the include
paths, the `NODE_PATH` packages, the compiler's installed code, the config files
of the folders a config search visits, and the entry names of those folders and
of the working directory. What it can reach in `'call'` mode and not here: a
script package that resolution places outside every root (the named-package
rule above) is not granted to the engine yet. A stylesheet import outside every
root is refused, where a compile in Node reads it.

Only `Compiler.render` (and so the CLI) runs in the engine so far;
`renderToResult`, `renderString` and the other entry points compile in Node with
`'call'` behaviour.

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
