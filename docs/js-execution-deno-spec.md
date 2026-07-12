# Jess JavaScript Execution via Deno (Feature Spec)

## Status

- Proposed
- Owner: Jess core team
- Scope: `@jesscss/jess`, `@jesscss/core`, new `@jesscss/plugin-js`

## Goals

- Provide secure JavaScript module execution for Jess styles/functions.
- Make script execution available only when `@jesscss/plugin-js` is installed, while keeping it optional for users who do not need script features.
- Load `@jesscss/plugin-js` only when the source graph reaches a script execution boundary; installing the package must not add startup cost to plugin-free parsing, evaluation, or rendering.
- Enforce a least-privilege sandbox (filesystem + network) for JS runtime.
- Keep existing behavior unchanged for users who do not install/configure JS support.
- Route all script-capable language features through one secure runtime path (`@jesscss/plugin-js`).

## Non-goals

- Rewriting all plugin APIs.
- Running the entire Jess compile in Deno by default in this phase.
- Full remote-module allowlisting policy beyond a first safe toggle/host list.

## Current behavior (evidence)

- JS module loading is plugin-driven through `Context.getModule()`. There is
  no `enableJavaScript` or `compile.javascript` compiler gate; executable JS is
  enabled by configuring `@jesscss/plugin-js`.
- Module loading is plugin-driven through `PluginInterface.import()`.
- Parse plugin selection is separate from JS execution. A `.less` file only needs the Less parser plugin to parse `@plugin` or script-capable syntax as syntax.
- Config loading is based on `styles.config.*` search-up behavior.

## Lazy Activation Contract

### Core principle

Installing `@jesscss/plugin-js` must not mean "start Deno for every compile."
Jess should treat the JS plugin as a cold optional capability until a concrete
script boundary proves it is required.

Script boundaries are:

- a resolved module import with extension `.js`, `.mjs`, `.cjs`, `.ts`,
  `.mts`, or `.cts`;
- a file-based Less `@plugin` directive whose resolved target is a JavaScript
  module and cannot be satisfied by an explicit in-process `pluginRegistry`;
- future script-capable features such as Sass/Jess module imports that resolve
  to JS/TS modules.

Non-boundaries are:

- parsing a stylesheet that contains `@plugin` syntax;
- parsing or evaluating a stylesheet that has no resolved JS module or Less
  plugin execution;
- importing `.json`, which is data and is parsed directly in Node without a
  script runtime;
- importing trusted built-in function packages that the host explicitly keeps
  in Node, such as `@jesscss/fns`, `#less/*`, and `#sass/*`.

### Lifecycle

1. Compiler creation builds only the language/parser and explicitly configured
   plugins.
2. Context creation includes only explicitly configured plugins. A configured
   `@jesscss/plugin-js` entry is represented by a lazy proxy, so Deno remains
   cold until script execution.
3. Parse and ordinary eval/render do not resolve, import, prewarm, or spawn the
   JS runtime.
4. `Context.getModule()` resolves the import path first. If the extension is a
   script extension and no active configured plugin can import it, the
   feature-level "install plugin-js" error is thrown.
5. The JS plugin starts Deno only when its `import(...)` or explicit `prewarm()`
   path is invoked.

Explicit plugin behavior:

- If a user explicitly lists `@jesscss/plugin-js` in `compile.plugins`, Jess may
  include and prewarm it as an explicit user request.
- JS sandbox config, when present, configures runtime policy; it does not
  eagerly add or prewarm the JS plugin by itself.

### Less v5 benchmark implication

The historical Less benchmark harness calls `less.render(...)` with filename,
paths, and math options, but without source maps or script plugin options. Under
this contract:

- plugin-free benchmark source graphs parse/evaluate/render entirely in Node;
- the Deno runtime is not resolved, prewarmed, or spawned;
- source maps are generated only when the Less/Jess option layer requests them;
- benchmarks that intentionally include Less `@plugin` or JS module imports
  measure the JS bridge path honestly.

## Cross-Realm Value Bridge Contract

The JS runtime boundary must be a value boundary, not a live AST boundary.

When a Jess value crosses from Node to Deno:

1. Node serializes the value into a small protocol payload.
2. The Deno worker reconstructs Deno-side Less/Jess-compatible value objects.
3. User/plugin JavaScript runs against those Deno-side objects.
4. Returned values are serialized back to protocol payloads.
5. Node reconstructs Node-side Jess values for the evaluator.

This preserves common Less plugin ergonomics inside Deno:

```js
value instanceof less.tree.Dimension
```

That check can be true because the Deno bridge provides a Deno-side
`less.tree.Dimension` class. It is not true because a live Node object crossed
the process boundary.

### Protocol shape

The bridge payload should cover plugin-facing value classes first:

```ts
type JsBridgeValue =
  | { kind: 'dimension'; value: number; unit?: string }
  | { kind: 'color'; rgb: [number, number, number]; alpha?: number }
  | { kind: 'quoted'; value: string; escaped?: boolean }
  | { kind: 'keyword'; value: string }
  | { kind: 'list'; items: JsBridgeValue[]; separator: ',' | ' ' | '/' }
  | { kind: 'call'; name: string; args: JsBridgeValue[] };
```

Rules:

- Do not send parent pointers, source-tree ownership, scope frames, registries,
  contexts, writer state, or source-map state across the bridge.
- Do not proxy arbitrary property access back into Node.
- Do not expose live Node constructors in Deno.
- Convert only function call arguments and return values unless a future plugin
  API explicitly needs a broader value type.

### API surface tiers

1. Trusted built-ins and `@jesscss/fns`: run in Node with native Jess values.
2. Jess `@-use` / `@-from` script module imports: run in Deno as normal ESM modules.
   Imports and exports are the API. This path must not expose Jess or Less
   compatibility globals by default.
3. Deprecated legacy Less `@plugin` files: run in Deno only through an explicit
   Less compatibility mode. This mode exposes old Less API shapes such as
   `less.tree.Dimension`, `less.functions.functionRegistry`, and
   `registerPlugin` as needed.

Visitor-style Less plugins are harder than function plugins because they expect
tree traversal and mutation APIs. The compatibility surface must stay explicit:
support function plugins first; add visitor bridge coverage only for documented
Less-facing value/tree APIs, not by shipping the whole Jess AST runtime into
Deno.

The deprecated old Less API belongs to `@plugin`; Jess `@-use` and `@-from` are ESM module imports.
`@jesscss/plugin-js` may host both runtime modes, but the modes must not be
merged into one ambient global surface.

### Deprecated legacy Less `@plugin` wrapper mode

Less `@plugin` files are not ESM modules. They use the old Less loader shape:

```js
new Function(
  "module",
  "exports",
  "require",
  "registerPlugin",
  "functions",
  "tree",
  "less",
  "fileInfo",
  source
)
```

That wrapper belongs only to the legacy `@plugin` path. The Deno worker should
execute it in explicit Less mode, inject Less-compatible `functions`, `tree`,
`less`, `registerPlugin`, and `fileInfo` objects, and keep registered function
implementations inside Deno. Node should receive callable proxies that bridge
arguments/results through the value protocol.

The wrapper must not be used for Jess `@-use` / `@-from`; those are plain ESM
import and export handling.

## Proposed architecture

### 1) New package: `@jesscss/plugin-js`

- Add a new plugin package with:
  - Package name `@jesscss/plugin-js` (fixed).
  - `name: "js"` (stable plugin id exposed in compiler/plugin config).
  - `supportedExtensions` for script module files (`.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`).
  - `import(absoluteFilePath)` implementation that executes inside Deno sandbox.
- This plugin is the only path that enables Deno-backed JS execution.
- This plugin is also the required runtime bridge for:
  - Sass and future Less `@use`,
  - Jess `@-use` and `@-from`,
  - Less inline JavaScript,
  - Less `@plugin`.

### 2) Deno runtime strategy (required when plugin is used)

- Packaging model:
  - `@jesscss/plugin-js` is an optional dependency of `@jesscss/jess` (not installed by default for all users).
  - When installed, Jess may resolve it lazily at the first script boundary.
  - `@jesscss/plugin-js` declares `deno` as a direct dependency.
  - Deno runtime is required for this plugin path (not optional once plugin features are invoked).
- Runtime fallback order:
  1. Deno binary from `deno` npm package.
  2. Native `deno` on `PATH`.
  3. Hard error with actionable diagnostics if neither is available and any script feature is requested.

### 3) Gating model (must all pass)

Third-party script execution (for `.js`/`.mjs`/`.cjs`/`.ts` modules and script-capable language features) is allowed only when all conditions are true:

1. `@jesscss/plugin-js` is configured and active.
2. Runtime policy validation passes (sandbox root resolved, permission flags built).

`disableScriptModules` is the canonical policy switch for disabling executable
script modules. It disables local/external JS/TS module imports and deprecated
Less file-based `@plugin` execution, even when `@jesscss/plugin-js` is installed
and configured. The old Less-compatible `disablePluginRule` option is a
deprecated alias for the same behavior; diagnostics and docs should tell users
to use `disableScriptModules`.

Exemption:

- Functions imported from `@jesscss/fns` are always executable.
- `@jesscss/fns`, `#less/*`, and `#sass/*` execution does not require Deno.
- `.json` imports are data imports and do not require Deno or `@jesscss/plugin-js`.
- These exemptions only apply to trusted built-in function imports and JSON data, not arbitrary Node modules.

If plugin is absent and JS import is requested, fail with deterministic error:
- `JavaScript plugin not installed. Install @jesscss/plugin-js to enable script execution features.`

If a script-capable feature is encountered and the plugin is not installed/configured:

- Throw a feature-level error with consistent wording:
  - `Feature not supported. Install @jesscss/plugin-js to enable script execution features.`
- This applies to executable `@-use` / `@-from` imports, Less inline JavaScript,
  and file-based Less `@plugin`.
- `@jesscss/fns`, `#less/*`, `#sass/*`, and `.json` imports are excluded from
  this error path.

## Deno execution model

### Why process boundary

- Keeps untrusted/third-party JS outside the Node host process.
- Enables strict, explicit runtime permissions (`--allow-read`, `--allow-net`, etc.).

### Initial implementation choice

- Use a long-lived Deno worker process with a Deno permission broker (`DENO_PERMISSION_BROKER_PATH`) as the primary mode.
- Keep a spawn-per-request mode as a fallback for environments where broker startup is not available.
- Do not rely on broad `--allow-all`.
- Use `--no-prompt` for deterministic CI/non-interactive behavior.

### Invocation shape (illustrative)

- Broker mode (preferred):
  - `DENO_PERMISSION_BROKER_PATH=<socketOrPipe> deno run --no-prompt <runner-script>`
- Fallback mode (no broker):
  - `deno run --no-prompt --allow-read=<sandboxRoot> [--allow-net[=<hosts>]] <runner-script> <module-path>`

Runner script responsibilities:

- Dynamically import the target module in Deno.
- Return only serializable exports needed by Jess JS function bridge.
- Exit with structured error payload for consistent Jess diagnostics.

### Async startup model (explicit prewarm + lazy await)

- On compiler/context creation:
  - do not start broker + Deno worker initialization for implicit/lazy JS support;
  - prepare enough resolver state to load `@jesscss/plugin-js` if a script boundary is reached.
- On explicit JS plugin configuration or explicit plugin prewarm:
  - start broker + Deno worker initialization asynchronously,
  - store one shared promise on context/runtime state.
- At first script-required operation (`@-use`, `@-from`, inline JS, `@plugin`, non-`@jesscss/fns` module import):
  - await the same shared initialization promise,
  - then execute request through worker bridge.
- If no script features are used, initialization must not be started by the default lazy path.

### Runtime lifecycle state machine

- `idle` -> `initializing` -> `ready`
- `initializing` -> `failed` (cache failure reason, fail deterministically on subsequent calls)
- `ready` -> `failed` (if broker/worker dies during compile)
- State data:
  - `initPromise?: Promise<void>`
  - `failure?: { code: string; message: string; cause?: unknown }`
  - `workerPid?: number`
  - `brokerEndpoint?: string`

### Broker policy behavior

- With permission broker enabled:
  - Deno sends permission checks to broker at runtime.
  - Permission flags (`--allow-*`/`--deny-*`) are not used as policy authority.
- Broker must be fail-closed:
  - malformed request/response, endpoint disconnect, or timeout => deny and terminate worker session.
- Policy decisions:
  - `read`: allow for `jsReadRoot`, plus allowed external package roots discovered by resolver.
  - `net`: deny by default; allow per `allowHttp` and `allowNetHosts`.
  - `env`, `run`, `ffi`, `sys`: deny by default.

## Security model

### Filesystem root policy

Sandbox root in plain language:

- The sandbox root is the top-most directory Deno can read from during script execution.
- Anything outside this directory is blocked by default.

Determine effective sandbox root as follows:

1. If the configured plugin-js instance supplies `jsReadRoot`, use it directly
   as the effective sandbox root.
2. Otherwise, candidate A: root derived from starting Less file path.
3. Candidate B: root derived from resolved `styles.config.*` file location.
4. If both A and B exist, effective root = directory furthest up between A and B.
5. If only A exists, use A.
6. If only B exists, use B.
7. If neither A nor B exists, use `process.cwd()`.

Interpretation:

- "Furthest up" means closest to filesystem root (largest containment scope across the two trusted project anchors).
- Normalize with `path.resolve()` and compare by ancestor relationship.
- Example:
  - entry Less file at `/repo/app/styles/main.less` gives candidate `/repo/app/styles`
  - `styles.config.ts` at `/repo/styles.config.ts` gives candidate `/repo`
  - effective sandbox root is `/repo` (furthest up).

Permission flags:

- Broker mode: broker is source of truth for permission decisions; no broad allow flags.
- Fallback mode: pass `--allow-read=<effectiveRoot>`, optional `--allow-net`, and deny prompts with `--no-prompt`.
- Do not pass `--allow-write`, `--allow-run`, `--allow-env`, `--allow-ffi`, `--allow-sys` by default.

### External node_modules outside `jsReadRoot`

- Resolved external packages may live outside `jsReadRoot` (for example with pnpm symlink/store layouts).
- Policy for non-`@jesscss/fns` modules:
  - allow execution when module is resolved through Jess resolver and classified as a package module,
  - allow read access to that package root (resolved realpath) even if outside `jsReadRoot`,
  - deny ad-hoc filesystem reads outside `jsReadRoot` and outside approved package roots.
- Do not pre-crawl parent directories for all `node_modules`; approval is resolver-driven and incremental.

### Network policy

Default:

- No network access (no `--allow-net`).

Opt-in via plugin-js options:

- Configure `@jesscss/plugin-js` in `compile.plugins`.
- Behavior:
  - `allowHttp: false|undefined` => no network.
  - `allowHttp: true` and no host list => `--allow-net`.
  - `allowHttp: true` and host list => `--allow-net=host1,host2`.

## API and config changes

### Plugin config shape

Runtime policy lives on `@jesscss/plugin-js` options:

```ts
type JsPluginOptions = {
  allowHttp?: boolean; // default false
  allowNetHosts?: string[]; // optional host allowlist when allowHttp=true
  jsReadRoot?: string; // optional explicit sandbox read root
};
```

### Config loader enhancement

Need access to both config object and config file path:

- Add `getConfigWithMeta(searchFrom)` in `packages/jess/src/config.ts` returning:
  - `{ config: StylesConfig; configFilePath?: string }`
- Backed by a new exported API in `styles-config` loader that returns `cosmiconfig` result metadata.

This enables safe computation of config-root candidate for sandboxing.

## Integration points

### `@jesscss/jess` (`Compiler.createContext`)

- Attach a lazy script-plugin loader to the context; do not add `@jesscss/plugin-js` to active plugins solely because it is installed.
- Compute sandbox root from:
  - entry file directory (`filePath` when provided),
  - config file directory (from config metadata),
  - and use `process.cwd()` only if neither of the above exists.
- Derive effective root using shared helper (`resolveSandboxRoot(...)`) implementing the exact algorithm above.
- Pass resolved default root to the configured plugin-js proxy. Do not store a
  compiler-level JS policy in context options.
- Do not trigger runtime prewarm for plugin-js support; the configured proxy
  stays cold until `import(...)`, `importLessPlugin(...)`, or explicit
  `prewarm()`.

### `@jesscss/core` (`Context.getModule`)

- Do not use an `enableJavaScript` hard gate.
- Ensure `@jesscss/fns` import path does not require plugin-js.
- Improve error path when module import is requested but no plugin with `import()` supports it.
- Use only active configured plugins or host-provided lazy loaders.
- Pass through import request to `plugin.import()` unchanged; plugin owns runtime execution policy enforcement.
- Add consistent "Feature not supported" diagnostics for script-capable syntax paths that require `@jesscss/plugin-js`.
- On first non-`@jesscss/fns` script request, await scripts runtime readiness before dispatch.

### `@jesscss/plugin-js`

- `import()` uses Deno runtime bridge and broker-backed permission policy.
- Validates module path is either under effective sandbox root or under an approved external package root.
- Maps Deno/runtime failures to normalized Jess diagnostics.
- Handles TypeScript modules by default (`.ts`, `.mts`, `.cts`) via Deno runtime.
- Fails fast with clear diagnostics when no usable Deno runtime is available.
- Maintains resolver-driven allowlist of approved external package roots (realpath) for broker read checks.

## Error handling and diagnostics

Add explicit error categories:

- `js/runtime-missing` (no usable Deno runtime available)
- `js/plugin-missing` (plugin not installed/configured)
- `js/sandbox-violation` (module path or read access outside root)
- `js/network-denied` (network needed but not allowed)
- `js/runtime-failure` (Deno execution error with sanitized stderr details)

Required runtime-missing error copy:

- `Deno runtime is required for @jesscss/plugin-js, but no usable Deno binary was found.`
- `If using pnpm, approve build scripts for "deno" (pnpm approve-builds).`
- `If using npm with ignored scripts, reinstall with lifecycle scripts enabled.`
- `Or install native Deno and ensure "deno" is on PATH.`

All errors should include:

- requested module path,
- effective sandbox root,
- whether network was enabled,
- short fix guidance.

### Package manager UX guidance

- `@jesscss/plugin-js` should proactively surface package-manager-specific hints when Deno is missing:
  - pnpm users may need to approve lifecycle scripts for `deno`.
  - npm users may have installed with `--ignore-scripts`.
  - Deno package-manager users may skip npm lifecycle scripts by default and should use native `deno` on `PATH` or explicitly allow scripts in their install flow.

## Testing plan

### Unit tests

- Root resolution helper:
  - explicit `jsReadRoot` override,
  - entry only, config only, both with ancestor relationship, neither (cwd fallback).
- Runtime state machine:
  - prewarm starts once,
  - first-use await behavior,
  - cached failure behavior after init failure.
- Broker policy:
  - allow read under `jsReadRoot`,
  - allow read for approved external package root,
  - deny read outside both regions.
- Deno flag construction:
  - default no-net,
  - net opt-in,
  - host allowlist formatting.
- Path guard:
  - reject module path traversal outside root.

### Integration tests

- `@jesscss/plugin-js` fixture tests:
  - `@jesscss/fns` imports execute without plugin-js.
  - `@jesscss/fns` imports execute when Deno runtime is unavailable.
  - plugin-free Less/Jess render does not resolve or prewarm `@jesscss/plugin-js` even when the package is installed.
  - successful JS import under allowed root.
  - successful package import resolved outside `jsReadRoot` via approved external package root.
  - successful TS module import under allowed root.
  - JS import fails without plugin.
  - non-`@jesscss/fns` JS import fails when plugin-js is not configured.
  - network-denied behavior with attempted fetch.
  - network allowed when `allowHttp=true`.
  - compile start does not trigger runtime prewarm when no script features are used.
  - first script operation awaits runtime readiness and succeeds after async startup completes.
  - broker disconnect mid-compile results in deterministic fail-closed diagnostics.
  - `@-use`/`@-from`/inline JS/`@plugin` throw `Feature not supported` with install guidance when plugin is absent.

### Cross-package checks

- Build changed packages before downstream tests:
  - `packages/config`, `packages/core`, `packages/jess`, `packages/jess-plugin-js`.
- Run less/jess integration suite subset that exercises JS imports.

## Rollout phases

### Phase 1: Foundations

- Add config metadata support (`styles-config` + `jess/config` wrappers).
- Add sandbox root resolver helper and tests.

### Phase 2: Plugin package

- Scaffold `@jesscss/plugin-js` with Deno runtime detection and command execution.
- Add Deno dependency/runtime integration and install/runtime docs.

### Phase 3: Compiler wiring

- Pass JS sandbox policy from compiler context to plugin.
- Add lazy pickup of `@jesscss/plugin-js` at script boundaries.
- Improve diagnostics in `Context.getModule` missing-plugin scenarios.

### Phase 4: Hardening

- Add integration fixtures for denial/allow cases.
- Add docs for setup and security defaults.

## Compatibility and migration

- Existing users without JS plugin: no behavior change.
- Existing users with non-Deno JS plugin: continue to work if configured, unless they opt into the new plugin.
- Default security posture remains strict (JS disabled by option or plugin absence; no network unless explicitly enabled).
- Trusted `@jesscss/fns` imports remain available independent of JS runtime gating.
- Script-capable features now share a unified runtime gate and error message contract.
- Installing `@jesscss/plugin-js` should require no additional manual plugin-list wiring at first script use, but must not affect script-free compiles.

## Open questions (needs decisions)

1. Plugin naming/public package surface:
   - Keep package name as `@jesscss/plugin-js` per install/error guidance; do we also want an alias package name (`@jesscss/plugin-scripts`) for discoverability, or avoid aliases to reduce support burden?
2. Runtime policy location:
   - Decided: runtime policy is plugin-local options only.
3. Runtime transport:
   - Keep `spawn` only, or support worker/reused process later for performance?

## Suggested acceptance criteria

- Jess with no JS plugin behaves exactly as today.
- Configuring `@jesscss/plugin-js` enables lazy script execution features when a script boundary is reached.
- Installing `@jesscss/plugin-js` does not make script-free compiles resolve, prewarm, or spawn the Deno runtime.
- Executable JS/TS script features require a working Deno runtime and fail with actionable diagnostics when Deno is unavailable.
- TypeScript modules are supported out-of-the-box in the same runtime path.
- `@jesscss/fns`, `#less/*`, `#sass/*`, and `.json` imports execute without Deno.
- JS execution cannot read files outside computed sandbox root (A/B furthest-up, `process.cwd()` only when both A and B are absent).
- Network is denied by default and only enabled by explicit config.
- Error messages clearly explain missing plugin/runtime and security denials.

## Concrete implementation task list

### Task 1: Add config metadata for sandbox roots

- **Files**
  - `packages/config/src/loader.ts`
  - `packages/config/src/types.ts`
  - `packages/jess/src/config.ts`
- **Changes**
  - Add loader API that returns config + config file path metadata.
  - Keep plugin-js runtime policy on plugin options, not compiler options.
  - Keep backward-compatible config loading for callers not using metadata.
- **Done when**
  - `Compiler.createContext()` can obtain `configFilePath`.
  - Type checks pass in `styles-config` and `jess`.

### Task 2: Add sandbox root resolver helper

- **Files**
  - `packages/jess/src/index.ts` (or new helper in `packages/jess/src/*`)
- **Changes**
  - Implement root algorithm:
    1. plugin-js `jsReadRoot` option if provided by the plugin instance.
    2. else furthest-up of entry-file root and config-file root.
    3. else `process.cwd()` when both are missing.
  - Normalize and compare with `path.resolve()`.
- **Done when**
  - Helper has unit tests for all branches.
  - Plugin-js receives the resolved root when configured by string/proxy.

### Task 3: Scaffold `@jesscss/plugin-js` package

- **Files**
  - `packages/jess-plugin-js/package.json`
  - `packages/jess-plugin-js/src/index.ts`
  - `packages/jess-plugin-js/test/**`
- **Changes**
  - Create plugin package with `name: "js"` and script extensions (`.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`).
  - Add direct dependency on `deno`.
  - Implement plugin factory + `import()` bridge contract.
- **Done when**
  - Package builds independently.
  - Plugin can be instantiated and used by `Context.getModule()`.

### Task 4: Implement broker-backed runtime manager

- **Files**
  - `packages/jess-plugin-js/src/runtime/*` (new)
  - `packages/jess-plugin-js/src/index.ts`
- **Changes**
  - Add runtime manager with states: `idle`, `initializing`, `ready`, `failed`.
  - Start broker + long-lived Deno worker.
  - Support async prewarm and lazy await on first script operation.
  - Cache init failure and return deterministic diagnostics.
- **Done when**
  - Init is idempotent (single promise).
  - Runtime can serve multiple import calls in one compile.

### Task 5: Implement broker policy and dynamic approvals

- **Files**
  - `packages/jess-plugin-js/src/runtime/broker.ts` (new)
  - `packages/jess-plugin-js/src/runtime/policy.ts` (new)
- **Changes**
  - Deny-by-default policy for `env`, `run`, `ffi`, `sys`.
  - `read` allowlist includes:
    - resolved sandbox root,
    - approved external package roots (realpath, resolver-driven).
  - `net` policy from `allowHttp` and `allowNetHosts`.
  - Fail-closed behavior on broker protocol errors/disconnect.
- **Done when**
  - Broker decisions are deterministic and logged for diagnostics.
  - External package roots outside `jsReadRoot` are supported only when resolver-approved.

### Task 6: Wire lazy script-plugin loading in `jess`

- **Files**
  - `packages/jess/src/index.ts`
  - `packages/jess/package.json`
- **Changes**
  - Add optional dependency on `@jesscss/plugin-js`.
  - Attach a context lazy loader that resolves `@jesscss/plugin-js` only for script extensions.
  - Keep explicit `compile.plugins: ['@jesscss/plugin-js']` as the opt-in eager/plugin-list path.
- **Done when**
  - Users with plugin configured get script support at first script use without starting Deno earlier.
  - Compiles with no script usage do not start runtime setup.

### Task 7: Enforce `@jesscss/fns` exemption and core gating updates

- **Files**
  - `packages/core/src/context.ts`
  - (if needed) parser/eval files handling `@-use`, `@-from`, inline JS, `@plugin`
- **Changes**
  - Ensure `@jesscss/fns` imports bypass Deno requirements.
  - Keep non-`@jesscss/fns` paths gated by plugin + runtime availability.
  - Preserve "Feature not supported" errors when plugin is absent.
- **Done when**
  - `@jesscss/fns` executes without Deno.
  - Other script/module paths still enforce policy.

### Task 8: Add diagnostics and user UX messages

- **Files**
  - `packages/jess-plugin-js/src/**`
  - `packages/core/src/context.ts`
- **Changes**
  - Implement `js/runtime-missing`, `js/plugin-missing`, `js/sandbox-violation`, `js/network-denied`, `js/runtime-failure`.
  - Use required runtime-missing copy:
    - `Deno runtime is required for @jesscss/plugin-js, but no usable Deno binary was found.`
    - `If using pnpm, approve build scripts for "deno" (pnpm approve-builds).`
    - `If using npm with ignored scripts, reinstall with lifecycle scripts enabled.`
    - `Or install native Deno and ensure "deno" is on PATH.`
- **Done when**
  - Errors are actionable and stable across repeated failures.

### Task 9: Add test matrix (unit + integration)

- **Files**
  - `packages/jess-plugin-js/test/**`
  - `packages/jess/test/less/**`
  - `packages/core/test/**` (or existing equivalent)
- **Changes**
  - Cover:
    - async prewarm/lazy-await behavior,
    - broker fail-closed behavior,
    - external package root outside `jsReadRoot`,
    - `@jesscss/fns` exemption,
    - missing-plugin feature errors,
    - network default deny and opt-in allow.
- **Done when**
  - New tests pass and assertions are deterministic in CI.

### Task 10: Docs and rollout notes

- **Files**
  - `docs/js-execution-deno-spec.md`
  - user-facing docs under `packages/docs/docs/**`
- **Changes**
  - Add setup instructions for plugin install and common package-manager issues.
  - Document security defaults and exemption boundaries.
- **Done when**
  - Docs match final implemented behavior and error messages.

## Suggested execution order

1. Task 1 -> Task 2 -> Task 3  
2. Task 4 -> Task 5  
3. Task 6 -> Task 7 -> Task 8  
4. Task 9 -> Task 10

## Verification matrix for PR

- Build:
  - `cd packages/config && pnpm build`
  - `cd packages/core && pnpm build`
  - `cd packages/jess-plugin-js && pnpm build`
  - `cd packages/jess && pnpm build`
- Tests:
  - `cd packages/jess-plugin-js && pnpm test`
  - `cd packages/core && pnpm test`
  - `cd packages/jess && pnpm test -- test/less/all-less.test.ts`
- Sanity:
  - scriptless compile path unchanged,
  - plugin installed path lazy-loads at first script extension,
  - first script use awaits runtime readiness,
  - broker failure path returns deterministic diagnostics.
