# less@5-alpha "Content PR" — Integration Plan (Jess-powered `packages/less`)

Status: decision memo for the owner. Read-only investigation; nothing implemented.
Date: 2026-07-12. Author: research agent.

> **Current-route correction (alpha.9):** The former Less-tree compatibility
> bridge described in this memo is not the Jess public architecture. The
> `@jesscss/plugin-less-compat` package now exports only the native AST-v2
> `LessCompatPlugin` and `LessCompatPluginOptions.functions`; its old
> `tree`/visitor/function-registry/transform adapter files were unreachable
> from the public entry point and have been deleted. The `less@5` adoption
> layer must not advertise or depend on those removed exports. The older bridge
> bullets below are retained only as historical investigation notes.

## TL;DR

- **The adoption-layer approach (a) is already chosen and partly built on the less.js `alpha`
  branch.** `packages/less/lib/index.js` is a thin wrapper over `jess`'s `Compiler`, with
  `options.js` / `logger.js` / `lessc-helper.js` / `version.js` / `types.js` support modules, a
  Jess-powered `bin/lessc`, and a `build/rollup.js` that emits a Node CJS bundle. The content PR is
  **finishing this layer**, not choosing an architecture.
- **Recommendation: proceed with (a) adoption layer. Do NOT vendor (b).** Vendoring re-creates the
  publish/versioning problem the Jess monorepo already solves and forks the source of truth.
- **Browser build is the one hard gap.** `packages/less` *declares* `"browser": "./dist/less.js"`
  and the Grunt browser task shells out to `node build/rollup.js --browser`, but the current
  `build/rollup.js` **only implements the Node CJS bundle** — the `--browser` flag is a no-op and
  Jess has no browser-safe entry (it imports `node:fs`/`node:path`/`node:module` directly).
  **Verdict: ship Node/CLI-only first; browser bundle is a follow-up.** It requires removing the
  `browser` field (or pointing it at a stub that throws) so we don't publish a broken `browser`
  entry.
- **Versioning: the first external Less v5 prerelease is exactly `less@5.0.0-alpha.1`.** Root,
  `packages/less`, and the published test-data package must stay in lockstep. Earlier references
  to `.2`/`.3` were incorrect local WIP metadata, not a published Less v5 release history.
  Pin the three `@jesscss` deps to the **published Jess alpha immediately preceding this Less
  alpha** (they are currently local `link:` paths — that is the single biggest blocker to an
  actual publish). Resolve and record the exact Jess version at release time; do not hard-code a
  stale alpha number in this plan.

---

## 1. What already exists on the less.js `alpha` branch (key finding)

The brief frames this as an open "how do we back it" question. In fact the `alpha` branch has a
working WIP of approach (a). Recent history (`git log alpha -- packages/less/lib`):

```
52daf761 Consolidate Less alpha Jess wrapper
cbbe1321 Prepare Less alpha publish gate and sync test-data
23362d15 feat(alpha): refresh Jess wrapper integration
```

`packages/less` on `alpha` (all paths under `~/git/oss/less.js`, read via `git show alpha:…`):

| File | Role |
|---|---|
| `packages/less/lib/index.js` | Thin Less API over `jess`'s `Compiler`: `render`, `renderFile`, `logger`, `lesscHelper`, `Compiler`, `version`. Header comment: *"Less-compatible API backed by the Jess compiler… delegating all parsing, evaluation, and output to Jess with `@jesscss/plugin-less` and `@jesscss/plugin-less-compat`."* |
| `packages/less/lib/options.js` | Maps Less options → Jess `configOptions`. Handles `paths→searchPaths`, `math→mathMode`, and auto-enables `lessCompatPlugin` when `opts.plugins` present or source contains `@plugin`. Also `mapRenderResult` (Jess result → Less `{css, map?, imports?}`) and a stable compiler-cache key. |
| `packages/less/lib/logger.js` | Less-style `logger` with `addListener`/`removeListener`, wired onto `@jesscss/core`'s `logger` singleton. |
| `packages/less/lib/lessc-helper.js` | `stylize` + `printUsage` for the CLI (ported from 4.x `lib.bak`). |
| `packages/less/lib/version.js` | Reads `package.json` version → `{semver, array}`. |
| `packages/less/lib/types.js` | JSDoc `LessStatic` typedef for the wrapper. |
| `packages/less/bin/lessc` | Jess-powered CLI. Parses a subset of flags (`-h/-v/-s/--quiet/--verbose/-I/--include-path/--no-color`), reads stdin or file, calls `less.render`/`less.renderFile`, writes output. |
| `packages/less/build/rollup.js` | Rollup config. **Only** `buildLessNodeCjs()` → `dist/less-node.cjs`, marking `@jesscss/*` + `jess` **external** (not inlined). Inlines the package version into `lib/version.js`. |
| `packages/less/index.cjs` | CJS shim: `require('./dist/less-node.cjs')`, unwrap `.default`. |

`package.json` (on `alpha`) already reflects (a):

```jsonc
"version": "5.0.0-alpha.1",
"type": "module",
"main": "./dist/less-node.cjs",
"exports": {
  ".": { "import": "./lib/index.js", "require": "./dist/less-node.cjs", "default": "./lib/index.js" },
  "./lib/*": "./lib/*",
  "./dist/less-node.cjs": "./dist/less-node.cjs"
},
"browser": "./dist/less.js",              // <-- declared but never built (see §5)
"bin": { "lessc": "./bin/lessc" },
"dependencies": {
  "@jesscss/core":               "link:../../../../oss/jess/packages/core",
  "@jesscss/plugin-less-compat": "link:../../../../oss/jess/packages/jess-plugin-less-compat",
  "jess":                        "link:../../../../oss/jess/packages/jess",
  "copy-anything": "^3.0.5",
  "parse-node-version": "^1.0.1"
}
```

**The `link:` deps are the headline blocker**: the package cannot publish while pointing at local
filesystem paths. The content PR's first job is to convert these to published semver.

Note: `packages/less` does **not** directly depend on `@jesscss/plugin-less` — the `jess` meta
package imports `lessPlugin` from `@jesscss/plugin-less` internally, so it arrives transitively.

---

## 2. less.js `packages/less` public surface (the classic API to satisfy)

The classic Less API object is assembled in 4.x by `lib/less/index.js`
(`createFromEnvironment`), then decorated by `lib/less-node/index.js`. Read from `master`
(`git show master:packages/less/lib/less/index.js`). The full member set:

`version, data, tree, Environment, AbstractFileManager, AbstractPluginLoader, environment,
visitors, Parser, functions, contexts, SourceMapOutput, SourceMapBuilder, ParseTree,
ImportManager, render, parse, LessError, transformTree, utils, PluginManager, logger` — plus the
node layer adds `createFromEnvironment, lesscHelper, PluginLoader, fs, FileManager,
UrlFileManager, options`.

Entry points / build:
- **Node ESM**: `lib/index.js`. **Node CJS**: `dist/less-node.cjs` (via `index.cjs` shim).
- **CLI**: `bin/lessc`.
- **Browser**: `"browser": "./dist/less.js"`, historically built by the Grunt browser task
  (`shell:testbrowser` → `node build/rollup.js --browser --out=./tmp/browser/less.min.js`) and the
  UMD `dist/less.min.js`. In 4.x the browser bundle inlines the whole compiler with a
  browser-specific environment/file-manager.
- `dist` is **git-ignored**; built at publish time (`prepublishOnly: "npm run typecheck && grunt
  dist && grunt test:node"`, and `grunt dist` = `shell:build` = `node build/rollup.js --dist`).

## 3. Jess side (what backs which export)

- **`jess`** (pin to the published Jess alpha immediately preceding this Less alpha) — meta compiler
  package. The workspace and registry may be at different alpha numbers during preparation;
  record the resolved version at release time.
  `Compiler` class: `render(filePath, opts)`, `renderString(content, opts)`,
  `renderToResult(input, opts) → { css, errors, warnings, loadedUrls }`, `safeCompile` (internal).
  Bundles `@jesscss/plugin-less` + `@jesscss/plugin-scss` internally and ships only
  `bin/jess`; the external `less` package alone owns `bin/lessc`. **No `parse()` method** and **no source-map output** in
  `renderToResult`.
- **`@jesscss/core`** — `Compiler` internals, tree, `Context`/`Rules`, diagnostics, and the
  `logger` singleton (`export { logger, type Logger }` in `src/index.ts`) that `less/lib/logger.js`
  wraps.
- **`@jesscss/plugin-less`** — the Less dialect (grammar + eval). Consumed via `jess`, not directly.
- **`@jesscss/plugin-less-compat`** — a transitional native AST-v2 function
  contribution plugin. Its supported API is
  `lessCompatPlugin({ functions?: readonly Fn[] })`; Less 4 visitors,
  `functionRegistry`, `less.tree`, `PluginManager`, and the former
  `transform/*` adapters are intentionally unsupported and are not exported.

---

## 4. Options

### (a) Adoption layer — RECOMMENDED (and already underway)
`packages/less` stays a thin façade: classic Less API in, `jess` `Compiler` +
`plugin-less-compat` underneath. Deps become published `@jesscss/*` + `jess`.

Pros: single source of truth (Jess monorepo); tiny surface to maintain; the compat bridge already
maps Less 4.x plugin/visitor/function shapes; most of it is written. Cons: some classic exports
have no clean backing yet (below); source maps and `parse()` are unimplemented; browser build
absent.

### (b) Vendor Jess source into `packages/less`
Copy Jess (`core` + parsers + plugins) into the `less` package tree.

Pros: no cross-repo publish coupling; one npm artifact. Cons: forks the source of truth, duplicates
the build, and re-introduces exactly the multi-package versioning the Jess monorepo exists to
manage. Every Jess fix must be re-vendored. **Not recommended.**

### Recommendation
**(a).** It is the committed direction, it is partly built, and it keeps Jess as the one
implementation. Treat (b) only as a fallback if cross-repo `link:`→published pinning proves
unworkable (it won't — see §6 versioning).

---

## 5. Export-by-export mapping (classic Less API → Jess backing)

Legend: ✅ done on `alpha` · 🟡 backing exists, not surfaced · 🔴 missing / needs work · ⚪ likely drop for alpha.

| Classic `less.*` | Status | Backing / note |
|---|---|---|
| `version` | ✅ | `lib/version.js` from `package.json`. |
| `render(input, opts, cb)` | ✅ | Wraps `Compiler.renderToResult`; supports callback + promise. |
| `renderFile(path, opts)` | ✅ | Non-4.x convenience (4.x has no `renderFile`); harmless addition. |
| `logger` (+ `addListener`) | ✅ | `lib/logger.js` over core `logger`. |
| `lesscHelper` | ✅ | `lib/lessc-helper.js`. |
| `Compiler` | ✅ | Re-exports `jess`'s `Compiler` (Jess-specific extra). |
| `parse(input, opts, cb)` | 🔴 | Jess exposes no `parse()` returning a tree + `ParseTree`. Needed by tools that parse-then-render or introspect the AST. Options: add a `Compiler.parse` (return Jess tree + a `toCSS`-capable wrapper) or document as unsupported in alpha. |
| `tree` | ⚪ | Unsupported in alpha. The old `LessTreeConstructors` bridge was deleted; no `less.tree` surface is advertised. |
| `functions` / `functionRegistry` | ⚪ | Unsupported in alpha. Native functions can be contributed through Jess's typed plugin contract; the old Less registry shim was deleted. |
| `PluginManager` | ⚪ | Unsupported in alpha. The old compat manager was unreachable from the public plugin entry point and was deleted. |
| `visitors` | ⚪ | Unsupported in alpha. Core's public plugin ABI has no visitor hook and the old adapter was deleted. |
| `SourceMapOutput` / `SourceMapBuilder` | 🔴 | No source-map pipeline in Jess yet. `mapRenderResult` reads `result.map`, but `renderToResult` never returns `map`. Source maps are effectively **unsupported** in alpha. |
| `ImportManager` | 🔴 | Jess resolves imports internally (`searchPaths`); no public `ImportManager`. `renderToResult` returns `loadedUrls`, but `mapRenderResult` maps `result.imports` (wrong field — always `undefined`). Fix the field name; treat `ImportManager` as unsupported. |
| `ParseTree` | 🔴 | Tied to `parse()`; unsupported in alpha. |
| `FileManager` / `UrlFileManager` / `AbstractFileManager` | 🔴 | Jess owns file access; no pluggable FileManager surface. Plugins that register file managers won't work. Document as unsupported. |
| `PluginLoader` / `AbstractPluginLoader` | 🔴 | `@plugin` loading is handled inside compat (deprecated path). No public loader class. |
| `Environment` / `environment` | 🔴 | No Jess equivalent; drop. |
| `contexts` | ⚪ | Internal 4.x eval contexts; unlikely to be referenced externally. Drop. |
| `transformTree` / `utils` / `data` | ⚪ | Internal helpers; drop for alpha. |
| `LessError` | 🟡 | Jess throws `JessError`; `toLessError` in `lib/index.js` shapes a Less-like error (`type/filename/line/column/extract`). Consider exporting a `LessError` class for `instanceof` checks. |
| `options` (defaults) | 🔴 | No `less.options` defaults object surfaced. Low priority. |
| CLI (`bin/lessc`) | 🟡 | Works for the common flags; missing 4.x flags: `--source-map*`, `--global-var`/`--modify-var`, `--plugin`, `-M/--depends`, `-l/--lint`, `--math=` value passthrough, `-rp/--rootpath`, `-ru/--rewrite-urls`. `printUsage` advertises all of them. Decide alpha CLI scope. |

**Concrete bugs already latent in the WIP** (worth fixing in the content PR):
1. `mapRenderResult` reads `result.imports` but Jess returns `loadedUrls` → `out.imports` is always
   `undefined`.
2. `mapRenderResult` reads `result.map` but `renderToResult` never produces one → `sourceMap`
   option silently yields no map.
3. `package.json` `"browser": "./dist/less.js"` points at a bundle nothing builds (see §6).

---

## 6. Browser-build verdict

**Ship Node/CLI-only for `less@5.0.0-alpha.N`; browser bundle is a follow-up. It is NOT a hard
blocker to publishing — but the current `browser` field must be corrected or it ships broken.**

Evidence:
- `build/rollup.js` implements only `buildLessNodeCjs()` (Node CJS, `@jesscss/*` external). There is
  **no browser bundle path** despite `Gruntfile.cjs` invoking `node build/rollup.js --browser
  --out=./tmp/browser/less.min.js` — the `--browser` flag is unhandled, so that task is a no-op.
- Jess is not browser-safe: `jess/src/index.ts` and the wrapper import `node:fs`, `node:path`,
  `node:module` (`createRequire`), `pathToFileURL`, etc. A browser bundle needs a browser
  environment abstraction (virtual FS / no FS, browser import resolution) that Jess does not yet
  have. Memory confirms: *"Jess has no browser build yet (Node/CLI only)."*
- `dist` is git-ignored and built at publish, so shipping without a browser artifact is just a
  matter of not producing `dist/less.js`.

Required in the content PR so the published package is coherent Node-only:
- **Remove `"browser": "./dist/less.js"`** (or point it at a stub module that throws
  `"Browser build not yet available in less@5 alpha"`), and drop `bower.json`'s browser `main` if
  it would mislead.
- Keep the browser test suite (`test/browser/**`) out of the alpha gate.

Follow-up (post-alpha) for the browser bundle: give Jess a browser entry with an injectable
environment (no `node:*`), then add a real `--browser` path to `build/rollup.js` that inlines
`jess` + `@jesscss/core` + the parsers into a UMD `dist/less.js`. Sizable; out of scope for the
first alpha.

---

## 7. Versioning

Release decision:
- The first external Less v5 publication is **`less@5.0.0-alpha.1`**. Root `@less/root`,
  `packages/less`, and `@less/test-data` are pinned to that number. The previous `.2` workspace
  values were not a published Less v5 release and must not be treated as a sequence to continue.
- Published Jess: `jess`, `@jesscss/core`, and `@jesscss/plugin-less-compat` must all use the
  same published Jess alpha immediately preceding this Less alpha. Do not preserve a stale
  hard-coded alpha number here.
- npm `less` dist-tags: `latest 4.6.7`, **`alpha 3.13.0-alpha.3`** (stale), `beta 4.6.3-beta.0`,
  `canary 3.13.1-next.1`.

Recommendation:
1. **Publish `less@5.0.0-alpha.1`** as the first Less v5 prerelease. Keep root,
   `packages/less`, and `@less/test-data` in lockstep.
2. Publish under the **`alpha` dist-tag** — this *advances* the stale `alpha` tag (currently
   `3.13.0-alpha.3`) to the v5 line. Do **not** touch `latest` (stays 4.6.7). Confirm with the
   owner that moving `alpha` forward past a 3.x is intended (it is, per the branded-`less@5-alpha`
   goal).
3. **Pin the `@jesscss/*` + `jess` deps to the selected published Jess alpha** (replace the
   `link:` paths). Use an exact version so a later Jess alpha does not silently change `less`'s
   behavior.
   This is the single required change to make the package publishable.
4. Publish the next Jess alpha separately, then pin Less to that published Jess version before the
   `less@5.0.0-alpha.1` publication. Jess and Less prerelease sequences are independent.

---

## 8. Recommended sequence for the content PR (approach a)

1. Convert `packages/less` deps `link:` → the selected published `jess`/`@jesscss/core`/
   `@jesscss/plugin-less-compat` alpha.
2. Fix the two result-mapping bugs (`loadedUrls` vs `imports`; drop/guard `map`).
3. Remove/neutralize the `browser` field; keep the package Node+CJS+CLI only.
4. Keep the unsupported Less plugin statics (`less.tree`, `less.functions.functionRegistry`,
   `less.PluginManager`, and `less.visitors`) absent from alpha. The public route supports only
   Jess's typed native function contribution API; document the unsupported classic surfaces.
5. Decide CLI scope (which 4.x flags alpha honors) and align `printUsage`.
6. Point `prepublishOnly`/gate at a Node-only test set; wire the less.js test-data suite against the
   Jess-backed `render`.
7. Publish `5.0.0-alpha.1` under the `alpha` tag.

---

## 9. Unknowns / risks (honest list)

- **Test-data conformance unknown.** This memo did not run the less.js `test/` suite against the
  Jess-backed `render`. Pass/fail rate of the classic Less fixtures through the wrapper is the real
  readiness signal and is unmeasured here. (Commit `cbbe1321 … sync test-data` suggests work in
  flight.)
- **Plugin ecosystem breadth.** The compat bridge covers plugin/visitor/function/tree shapes, but
  real-world plugins (`less-plugin-clean-css`, `less-plugin-autoprefix`, custom `FileManager`s) are
  unverified end-to-end through this wrapper. FileManager-based and source-map-based plugins are
  known-unsupported.
- **`parse()` + source maps** are genuinely absent, not just unsurfaced. Any downstream tool relying
  on `less.parse` or `sourceMap` output breaks. Needs an explicit "unsupported in alpha" stance or
  new Jess work.
- **Version skew.** Less must pin its Jess dependencies to the Jess alpha that is actually published
  immediately before the Less alpha. That dependency version does not choose the Less version.
- **Error-shape fidelity.** `toLessError` approximates the 4.x error object; consumers doing
  `instanceof less.LessError` or reading `.line/.column/.extract` precisely may see differences.
- **`alpha` dist-tag semantics.** Moving npm's `alpha` tag from `3.13.0-alpha.3` to `5.0.0-alpha.1`
  is a forward jump across a major line — intended per the branding goal, but worth an explicit
  owner ack so no one is surprised that `npm i less@alpha` changes lineage.
