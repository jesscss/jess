# Sandboxed compiles run whole in Deno

**Status:** design, decided (§8; ledger row A19), not yet implemented. Tracks
jesscss/jess#497. It replaces
the per-call worker and the permission broker described in
[`architecture/js-execution-deno-spec.md`](../architecture/js-execution-deno-spec.md)
(its "Permission broker" section and its non-goal "running the entire Jess
compile in Deno"). The rest of that spec (lazy activation, script boundaries,
the value bridge, error categories) still holds.

Section 8 records the trust and API decisions this design rests on.

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
  module, other than Jess's own `@jesscss/fns` modules, which run in-process
  unsandboxed, §8.1) runs whole inside the
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

**Started ahead of time.** The first render in a process starts its
compiler's engine at once: Deno spawns, imports the compiler and loads the
entry's dialect while the render runs in Node, so a render that reaches a
script finds it warm. A render that loads no script lets it go (the process
is killed and the read-set work still in flight is aborted), and no later
render in that process starts one ahead of time. Its output never depends on
Deno; its cold start pays the plugin import and the spawn call on the main
thread, about 3 ms.

**Compilers that can run there.** A compiler class runs in the engine when it
declares its own `static moduleIdentity` (module and export), as jess's
`Compiler` and `DefaultCompiler` do. A script reached by any other compiler,
or outside a render (`compile`, a direct plugin call), is refused with an
error that says so; there is no per-call path any more.

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
- **One trust domain per compiler.** Scripts share the engine's realm with the
  compiler and with each other, so a script in one render can change what
  later renders in that engine produce. That is by design (ledger A19 (5)).
  Owner 2026-11-01, verbatim: *"the point of sandboxing is not to isolate
  compiles from each other, and its not to do "perfect" sandboxing... its to
  prevent someone being surprised that a stylesheet can read / execute JS,
  and make sure that doesnt' mean it's pulling private documents / caches
  from their computer"* and *"it's more like "reasonable isolation" is what
  we're building, not like CIA-grade sandboxing"*; and the same day the
  owner chose, verbatim, *"One trust domain per Compiler"*. What the sandbox
  guards is the machine: the user's files outside the read root, their
  caches, and the network.
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

Each plugin factory records its module identity on the instances it makes
(§8.4). A plugin instance without one cannot cross, and a sandboxed render that
needs it fails with an error naming the plugin.

## 5. Native permissions

Deno enforces the policy itself. The host computes the read set once per
process and passes it as flags; nothing asks the host during a compile.

```
deno run --no-prompt \
  --allow-read=<read set> --ignore-read \
  [--allow-net=<hosts>]   # only with allowHttp, as today
  --unstable-bare-node-builtins --unstable-sloppy-imports \
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
- **Environment.** No env permission, so an env read throws Deno's own
  `NotCapable`. The env facts a compile uses (cwd, home and temp paths,
  colour support, `NODE_PATH`, a fixed set of variables) travel in the
  request, and the engine answers the compiler's reads from them.
- The two unstable flags only change module resolution: bare Node built-in
  names (`fs` for `node:fs`) in workspace-linked packages, and `./x.js` for
  `./x.ts` when the compiler runs from its TypeScript sources (a workspace
  test run). Neither grants a permission.
- **The read set** is the read root (§8.2), plus the installed compiler and its
  dependencies where they lie outside it. The read root is whichever of these
  is nearest the top of the filesystem: the folder holding the `node_modules`
  that governs the entry (below), the script root (`jsReadRoot`), and the
  entry stylesheet's folder. Everything under it is readable. Each root is
  passed in its real spelling and in each written spelling the render uses for
  it, because Deno matches paths as written (below).
- **The governing `node_modules`** is the one package resolution lands in.
  Take the nearest `node_modules` above the entry; for each package it lists,
  resolve its real path, and take the parent of the outermost `node_modules`
  folder holding that path. Under npm that is the folder holding
  `node_modules` itself. Under pnpm, whose package folders link into the
  workspace root's `.pnpm` store, it is the workspace root. A stray
  `~/node_modules` above a project with its own `node_modules` does not count.
  A package whose real path is in no `node_modules` (a `link:` or `file:`
  dependency on a sibling checkout) gives no candidate, so a sandboxed render
  cannot read it; the same import compiles in a render without scripts.
- **Candidates on different branches.** When the candidates are not on one
  ancestor chain (an entry folder beside, not inside, the folder its packages
  live in, as with a symlinked `node_modules`), each one nearest the top of its
  own chain is kept as a separate read root. Orchestrator judgment under owner
  delegation, 2026-10-31: a single common ancestor could widen the read set to
  `~` or `/`, wider than the owner's rule intends; disjoint roots are the
  narrowest faithful reading, and dropping one would make the entry or its
  packages unreadable.
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
  and allowed natively. That is accepted (§8.3).
- A sandboxed script cannot make such a symlink: creating one needs unscoped
  write permission, which the sandbox never has. Only a symlink already on
  disk can lead outside.
- A stylesheet compiled in Node reads any path. `@import (inline)
  "/abs/path/secret.txt"` copies the file into the CSS today.
- The read set must list each root in the spelling the compile will use, and
  in its canonical spelling, because the two do not match each other.
- Deno 2.7.6 throws from `existsSync` where 2.9.6 returns `false`, so the
  engine needs an exact Deno version.

### Known limitation: the module loader reads any `node_modules`

When a `package.json` sits beside the main module (as it does for the engine,
inside `@jesscss/plugin-js`), Deno 2.9.6 loads a file under any `node_modules`
folder through `require()` and `import()`, whatever `--allow-read` says. An `fs` read of the same file is
denied, and so is a module load outside every `node_modules`. A sandboxed
script can therefore load (and, for JSON, read) files under a `node_modules`
folder outside its read root, though not plain files beside them.

- The broker never saw these loads either: under the broker on `dev`, the same
  `require()` of a JSON file under an unrelated `node_modules` succeeded, while
  an `fs` read of it was denied with "Read access denied by Jess policy."
- `packages/jess-plugin-js/test/deno-loader-channel.test.ts` pins the
  behaviour, so a Deno release that changes it fails the test.
- No broker walls it off (§8.3).

### What remains brokered

Nothing (§8.2, §8.3). Each broker duty and what replaces it:

| Broker duty | Replacement |
|---|---|
| read inside `jsReadRoot` / `node_modules` above it | `--allow-read` |
| deny write, env, run, ffi, sys | not granted; Deno throws `NotCapable` |
| net per `allowHttp` / `allowNetHosts` | `--allow-net=<hosts>`, as remote imports do |
| canonicalize, so a symlink cannot lead out | dropped: Deno's behaviour is accepted (§8.3) |
| grant a package a stylesheet names that resolves outside every root | dropped: the read root decides (§8.2) |

## 6. Deno version

`@jesscss/plugin-js` pins an exact `deno` version (2.9.6 today, from `^2.6.8`)
and runs the binary that dependency installs. An explicit `denoCommand` still
wins, and a Deno on `PATH` remains the fallback when the dependency's binary is
not installed (its install script did not run). Today the plugin prefers any
Deno on `PATH` over the installed one; the table above shows two Deno versions
differ in a behaviour the compile depends on.

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

## 8. Decisions

### 8.1 Stylesheet JavaScript always runs sandboxed, except Jess's own functions

Owner, 2026-10-31: *"It can be unsandboxed if it's one of Jess's distributed
functions (fns package)"*.

`@jesscss/fns` modules run in-process in Node, unsandboxed, as today. Every
other script runs sandboxed in Deno. There is no `jsSandbox: false` opt-out,
and without `@jesscss/plugin-js` a script boundary is refused as today.

### 8.2 The read root

Owner, 2026-10-31: *"Lowest root - either node modules parent root, or script
root, or start stylesheet root"*. Asked whether that means whichever of the
three is nearest the top of the filesystem, the owner answered, 2026-10-31:
*"yes"*.

So the read root is whichever is nearest the filesystem root of: the folder
holding the governing `node_modules`, the script root (`jsReadRoot`), and the
entry stylesheet's folder. Everything under it is readable.

Orchestrator judgment under owner delegation, 2026-10-31: the governing
`node_modules` is the one package resolution actually lands in, as §5 states.
Under pnpm that is the workspace root's `node_modules` (the `.pnpm` store), not
the package's own folder of links. The compiler's own
code is added where it lies outside the root, so the engine can load it.
Include paths are not added; a stylesheet or script outside the root fails in
a sandboxed compile.

### 8.3 Symlinks

Owner, 2026-10-31: *"Accept Deno's behaviour"*.

A symlink inside the read root that points outside it is readable. There is no
broker.

### 8.4 How a plugin instance names its module

Orchestrator judgment under owner delegation, 2026-10-31: each plugin factory
records its module identity, `definePlugin(import.meta.url, 'default', opts =>
new LessPlugin(opts))` or the equivalent, stored on the instance. A plugin
without it cannot cross into a sandboxed compile, and the render fails with an
error that names it.

## 9. Plan

Each step is one PR, measured and merged before the next.

1. This design.
2. Pin the exact Deno version and run the pinned binary (§6). Done: #522.
3. Done: #524 (the engine) and #526 (started ahead of time). The engine: a sandboxed render runs whole in Deno, with native permissions,
   routed by §2, for `render`, `renderToResult` and `renderString`; the CLI
   needs no change beyond the compiler's. Deletes the broker. Measured as §7,
   against `dev` and lessc: `bootstrap4.less` and `benchmark.less`, warm
   (marginal time and instructions, interleaved, with an A/A null) and cold
   (`pnpm run measure:cli:cold-start --fixture bootstrap4`).
4. Delete the per-call worker path, which no route reaches after step 3.
   `DefaultCompiler` declares its module identity, and the plugin-js tests
   drive scripts through the engine.

Every step keeps:

- `bootstrap4.less` CLI output byte-identical;
- `pnpm run compare:less:builds -- --corpus` byte-identical;
- the `@jesscss/plugin-js` suites green, including every existing sandbox
  probe, run against the new path;
- a proof-of-denial test in the pattern of
  `packages/jess-plugin-remote-import/test/deno-net-denial.test.ts`: a
  sandboxed plugin reads a file outside the read set, with every host-side
  check out of the way, and fails with Deno's own error. A positive control
  reads a file inside the set, a symlink probe pins §8.3, and a network
  request without `allowHttp` fails with Deno's own error.
