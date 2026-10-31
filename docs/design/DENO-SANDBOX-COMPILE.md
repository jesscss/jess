# Sandboxed compiles run whole in Deno

**Status:** design, not yet implemented. Tracks jesscss/jess#497. It replaces
the per-call worker and the permission broker described in
[`architecture/js-execution-deno-spec.md`](../architecture/js-execution-deno-spec.md)
(its "Permission broker" section and its non-goal "running the entire Jess
compile in Deno"). The rest of that spec (lazy activation, script boundaries,
the value bridge, error categories) still holds.

Section 8 lists the decisions this design needs before the routing and
permission changes land.

## 1. What happens today

`@jesscss/plugin-js` runs stylesheet JavaScript (Less `@plugin`, script `@use`)
in a Deno subprocess. The compile stays in Node, so every plugin function call
during evaluation is a round trip: encode, pipe, wait, decode. Every file
access Deno makes is a second round trip, to a permission broker socket in the
Node host.

Measured on `dev` (`66717170b`, Node 24.11.1, Deno 2.9.6, M4 Pro at load
averages 10–20, so indicative), compiling the less.js corpus
`3rd-party/bootstrap4.less`:

| Per render | Value |
|---|---|
| `@plugin` scripts loaded | 8, on every render |
| plugin function calls, one round trip each | 2,437 |
| main thread idle, waiting on the worker | 115 ms of a 388 ms warm render (medians of 10) |
| render time when the first `@plugin` is reached | 145 ms into the first render (735 ms total); 51–64 ms into a warm render (325–540 ms) |

## 2. The routing rule

A compile runs in one of two places, and the CSS must not depend on which.

- **In Node, as today.** This is every compile that does not execute
  stylesheet JavaScript, including compiles where `@jesscss/plugin-js` is
  installed but never reached. Such a compile pays nothing new.
- **Whole in Deno.** A compile that reaches a script boundary served by
  `@jesscss/plugin-js` (the boundaries of the spec's "Lazy Activation
  Contract": a `@plugin` or script `@use` that resolves to a `.js`/`.ts`
  module, other than the trusted `@jesscss/fns` modules) runs whole inside the
  Deno sandbox: parse, evaluate and serialize. Plugin calls are ordinary
  in-process function calls there.

The rule needs no prediction. A compile starts in Node. The first time it
reaches a script boundary, the plugin-js proxy stops it, and the compiler runs
that render again in Deno. The compiler remembers that entry path, so later
renders of it go to Deno directly. The Node work thrown away is the time to the
first boundary: 145 ms in a cold process for `bootstrap4.less`, then never
again for that compiler. The CLI uses the same compiler, so it behaves the same
way and switches to Deno only when the compile needs it.

The stop must not be swallowed. The `@plugin` load path reports load failures
as diagnostics and keeps evaluating (P45), so the proxy signals the reroute
through a value the compiler checks, not through a load error.

A stylesheet without JavaScript never touches Deno, so its output and timing
are unchanged.

## 3. How a compile enters Deno

- **One process per compiler.** A `Compiler` owns one Deno process per read
  set (§5), started on its first sandboxed render and kept warm between renders. It is
  killed on dispose, after an idle timeout, or when a render overruns its time
  limit, as the worker is today.
- **One message per render.** The host sends one `render` request. It carries
  the entry path (or the source text, for `renderString`), the compiler
  options and render options as data, and the host facts the compile reads
  from its process (cwd, terminal width, colour support). The reply carries
  the CSS, the source map when one was requested, and the diagnostics the
  compile collected. The host prints those diagnostics, so a sandboxed compile
  reports exactly what an in-process one does. A thrown `JessError` is rebuilt
  as a `JessError`.
- **What runs inside.** The Deno side imports the same compiler package the
  host uses, from where it is installed, and renders with the script runtime
  in-process. The script runtime is today's `runtime-worker.ts` facade and
  value bridge, called directly instead of over a pipe, so plugin values cross
  the same conversion as today and output stays byte-identical.
- **Plugins load once.** A script loads once per Deno process and loads again
  only when its file changes.
- **Entry points.** `render`, `renderToResult` and `renderString` route as
  above. `compile` (internal: parse plus static imports) evaluates nothing, so
  it reaches no script boundary and stays in Node.

## 4. How host plugins and functions cross

Nothing crosses as a live object.

- **A plugin instance** crosses as its module identity: the module that
  exports its factory or class, the export name, and the arguments it was
  created with. Deno imports that module and creates the plugin again.
- **A function** in the options (an inline Less plugin's `install`, a
  function-valued option) crosses as its source, `fn.toString()`, and is
  rebuilt in Deno. Plugin functions are pure, so the source is the whole
  function. A rebuilt function that reads a variable from the caller's scope
  fails with an error that names the variable and the option path, instead of
  resolving it to a global or `undefined`. Functions are rebuilt only inside
  Deno.
- **Config files** (`styles.config.*`) are loaded by the compile in Deno, as
  they are found per source file today.

How a plugin instance reports its module identity is decision 8.4.

## 5. Native permissions

Deno enforces the policy itself. The host computes the read set once per
process and passes it as flags; nothing asks the host during a compile.

```
deno run --no-prompt \
  --allow-read=<read set> --ignore-read \
  --ignore-env \
  [--allow-net=<hosts>]   # only with allowHttp, as today
  <engine>
```

- **No** `--allow-write`, `--allow-run`, `--allow-ffi`, `--allow-sys` or
  `--allow-env`. The CSS returns as data and the host writes the output file.
- **`--ignore-read`** makes a read outside the set fail with Deno's own
  `NotFound` instead of `NotCapable`. The compile needs this: its config search
  and package resolution probe folders above the roots, and a probe that throws
  instead of reporting "absent" stops the compile. Measured: with `--allow-read`
  alone, the compile stops at the first probe of the cwd.
- A plugin that reads outside the set therefore sees "no such file", the same
  answer as for a file that does not exist, and learns nothing about what is
  there.
- **`--ignore-env`** makes every environment read `undefined`. The env facts a
  compile uses travel in the request instead.
- **The read set** is the script read set of today's policy (`jsReadRoot` and
  the `node_modules` folders above it), plus the include paths, plus the
  installed compiler and its dependencies. Each entry is passed in both its
  written and its canonical spelling, because Deno matches paths as written
  (below). Decision 8.2 is whether that set is right for stylesheets.
- **A different read set needs a different process.** Flags are fixed at spawn,
  so a render whose read set differs from the running process's starts a new
  one. A compiler that renders one project keeps one process.

### What the native check does with symlinks and paths

Deno 2.9.6 and 2.7.6, `--allow-read=<root>`, a file `outside/secret.txt` next
to `root/`:

| Access | Result |
|---|---|
| `root/inside.txt` | allowed |
| `root/link-file`, a symlink to `outside/secret.txt` | **allowed** (`Deno.readTextFile` and `node:fs` alike) |
| `root/link-dir/secret.txt`, through a directory symlink to `outside/` | **allowed** |
| `root/../outside/secret.txt` | denied (`..` is normalized first) |
| `/etc/hosts`, `outside/` listing | denied |
| allow-list entry written through a symlink, file read by its real path | denied |
| allow-list entry written as the real path, file read through the symlink | denied |
| `Deno.symlink` inside the root | denied: it needs unscoped read and write |
| a static `import` from a module loaded at runtime, to a file outside the set | denied (`NotFound` with `--ignore-read`) |
| `fs.existsSync` outside the set, `--ignore-read`, Deno 2.9.6 | `false` |
| `fs.existsSync` outside the set, `--ignore-read`, Deno 2.7.6 | throws `NotFound` |

What that means:

- Deno checks the path as written. It does not resolve symlinks, on either
  side. Today's broker resolves every requested path (`realpath`) before it
  checks, so a symlink inside the root that points outside it is denied today
  and allowed natively. Decision 8.3.
- A sandboxed script cannot make such a symlink: creating one needs unscoped
  write permission, which the sandbox never has. Only a symlink already on
  disk can lead outside.
- A stylesheet compiled in Node reads any path. `@import (inline)
  "/abs/path/secret.txt"` copies the file into the CSS today.
- The read set must list each root in the spelling the compile will use, and
  in its canonical spelling, because the two do not match each other.
- Deno 2.7.6 throws from `existsSync` where 2.9.6 returns `false`, so the
  engine needs an exact Deno version.

### What remains brokered

Nothing, under the options this design takes in §8. Each broker duty and what
replaces it:

| Broker duty | Replacement |
|---|---|
| read inside `jsReadRoot` / `node_modules` above it | `--allow-read` |
| deny write, env, run, ffi, sys | not granted; `--ignore-env` for env reads |
| net per `allowHttp` / `allowNetHosts` | `--allow-net=<hosts>`, as remote imports do |
| canonicalize, so a symlink cannot lead out | not expressible natively; decision 8.3 |
| grant a package a stylesheet names that resolves outside every root | not expressible with flags fixed at spawn; decision 8.2 |

If decision 8.3 or 8.2 keeps either of the last two rows, that row is the only
thing a broker would still answer, and its cost is ~0.13 ms per check (293
checks per `bootstrap4.less` compile in the prototype below).

## 6. Deno version

`@jesscss/plugin-js` pins an exact `deno` version (2.9.6 today, from `^2.6.8`),
and the engine runs the pinned binary. A Deno on `PATH` is used only when
`denoCommand` names it. Today the plugin prefers any Deno on `PATH`; the table
above shows two Deno versions differ in a behaviour the compile depends on.

## 7. Evidence from the prototype

The closed prototype (jesscss/jess#495, branch `proto/deno-compile`) ran the
whole compile in Deno behind the broker. For this design it was rerun with the
broker replaced by the flags of §5, unchanged otherwise. All numbers are from
one M4 Pro at load averages 9–12, so they are indicative; ratios hold better
than milliseconds.

**Warm, per compile** (marginal: the 20 renders after the first 5, in one
process; 3 interleaved rounds):

| `bootstrap4.less` | per call, broker (today) | whole compile, broker | whole compile, native | in Node, no sandbox | lessc 4.9.1 |
|---|---|---|---|---|---|
| ms | 317–406 | 166–178 | **144–150** | 141–151 | 99 (one run, same load) |

- The CSS was byte-identical in all four jess arms (sha1 `e99dcf2641…`).
- With native permissions the sandboxed compile costs the same as an
  unsandboxed one. The broker cost 15–35 ms per compile.
- The rest of the gap to lessc is the compiler itself, not the sandbox.

**Cold CLI** (`bootstrap4.less`, spawn to exit, median of 9 interleaved runs):

| per call (today) | whole compile, broker | whole compile, native | in Node, no sandbox |
|---|---|---|---|
| 805 ms | 754 ms | 729 ms | 549 ms |

**Deno process cost** (median of 15):

| | ms |
|---|---|
| spawn an empty Deno script to exit | 10.6 |
| spawn Deno, import the compiler, exit | 91 (the import is 71) |
| for comparison: spawn Node, import the compiler, exit | 108 |

The cold sandboxed CLI is ~180 ms slower than the cold unsandboxed one: Deno
loads the compiler a second time and starts cold. The prototype forced every
render into Deno; the routing of §2 adds the Node time to the first boundary on
a cold first render. Starting the Deno process in the background when
plugin-js is installed, while Node begins the compile, would overlap the two;
that is an optimization to measure after the routing lands.

## 8. Decisions needed

### 8.1 Is there an unsandboxed mode for stylesheet JavaScript?

Today stylesheet JavaScript runs only in the sandbox. Without
`@jesscss/plugin-js` a script boundary is refused ("Install
@jesscss/plugin-js…"). This design keeps that. Options:

- **A (this design):** no unsandboxed mode. The "sandboxing off" figures above
  come from the prototype and are a measurement only.
- **B:** an explicit opt-out (the prototype's `compile.jsSandbox: false`, CLI
  `--js-sandbox off`), for a project that trusts its scripts. Scripts run
  in-process in Node through the same runtime and value bridge.
- **C:** without plugin-js installed, scripts run in-process unsandboxed;
  installing plugin-js turns the sandbox on.

### 8.2 What may a sandboxed compile read?

The compile and its scripts share one realm in Deno, so they share one read
set. Today stylesheets read any path (in Node) and only scripts are confined.
Options:

- **A (this design):** the read set of §5. A stylesheet import outside it fails
  in a sandboxed compile with a diagnostic that names the read roots, where the
  same import succeeds in a compile without JavaScript. The package rule for
  scripts that resolve outside every root (a corpus checked out beside the
  project) is not kept. In the prototype's corpus run this changed 1 of 318
  fixtures (`import-module.less`, which imports a sibling folder).
- **B:** A, plus the folders of every stylesheet the Node attempt read before
  it reached the boundary. Covers more, but which files are readable then
  depends on import order.
- **C:** an unrestricted read set (`--allow-read` with no list), keeping no
  write, env, run, ffi or sys, and no net unless `allowHttp`. Scripts could
  then read what stylesheets already can; the only way out is the CSS.

### 8.3 Symlinks inside a read root

Deno allows a symlink inside the read set that points outside it; the broker
denies it. Options:

- **A (this design):** accept the native behaviour. A script cannot create a
  symlink, and a stylesheet compiled in Node reads such a file anyway.
- **B:** keep the broker for reads only, at ~0.13 ms per read, to resolve and
  check each path.

### 8.4 How a plugin instance names its module

For §4, the host needs each configured plugin's module and export. Options:

- **A:** search for it, as the prototype does: Node's CJS registry, then the
  ESM entries of plugin packages in the compiler's dependency closure, then a
  same-named class. Needs no change to plugins; the last step can pick the
  wrong class.
- **B:** each plugin factory records it: `definePlugin(import.meta.url,
  'default', opts => new LessPlugin(opts))`, stored on the instance. Exact, one
  line per plugin package, and a third-party plugin that does not record it
  fails with a clear error in a sandboxed compile.
- **C:** only plugins from config files and the default stack cross (Deno
  loads both itself). A plugin instance passed in code is refused in a
  sandboxed compile.

## 9. Plan

Each step is one PR, measured and merged before the next.

1. This design.
2. Pin the exact Deno version and run the pinned binary (§6).
3. The engine: a sandboxed render runs whole in Deno, with native permissions,
   routed by §2, for `render`, `renderToResult` and `renderString`; the CLI
   needs no change beyond the compiler's. Deletes the broker. Measured as §7,
   against `dev` and lessc: `bootstrap4.less` and `benchmark.less`, warm
   (marginal time and instructions, interleaved, with an A/A null) and cold
   (`pnpm run measure:cli:cold-start --fixture bootstrap4`).
4. Delete the per-call worker path, which no route reaches after step 3.

Every step keeps:

- `bootstrap4.less` CLI output byte-identical;
- `pnpm run compare:less:builds -- --corpus` byte-identical;
- the `@jesscss/plugin-js` suites green, including every existing sandbox
  probe, run against the new path;
- a proof-of-denial test in the pattern of
  `packages/jess-plugin-remote-import/test/deno-net-denial.test.ts`: a
  sandboxed plugin reads a file outside the read set, with every host-side
  check out of the way, and fails with Deno's own error. A positive control
  reads a file inside the set, and a symlink probe pins whichever answer
  decision 8.3 takes.
