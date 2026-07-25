# Less v5 Browser Build Spec

This draft defines what Jess should mean by "browser support" for the Less v5
alpha track. It intentionally does not promise the historical Less behavior of
parsing arbitrary `.less` files in the browser with filesystem-like import
resolution.

## Goal

Browser consumers should be able to bundle tree-shaken Jess modules without
pulling in Node-only filesystem, config-discovery, process, or disk-plugin
machinery.

The first browser contract is a build-shape contract, not a browser-side Less
CLI contract.

## Non-Goals

The first Less v5 alpha browser story should not promise:

- parsing `.less` files from URLs, the local filesystem, or virtual filesystem
  shims;
- automatic `styles.config.*` discovery;
- Node module resolution;
- Less plugin loading from disk;
- custom file-manager plugins;
- `@plugin` JavaScript execution;
- source-map artifact writing;
- parity with upstream Less browser tests that depend on the above behaviors.

## Proposed Import Surface

Keep the existing `jess` package root as the Node entrypoint for alpha:

- `Compiler`
- `ConfigOptions`
- `render`
- `renderString`
- `renderToResult`
- `dispose`

Add a future browser-specific entrypoint only after the implementation can be
proved browser-safe, for example:

- `jess/browser`

That entrypoint should export only browser-safe APIs. Candidate surface:

- `renderString(source, options)`
- `renderToResult({ source, filePath?, language?, extension? }, options)`
- types needed by those APIs

It should not export `Compiler` unless the constructor can be made browser-safe
without retaining Node-only defaults.

## Browser-Safe Behavior

The browser entrypoint may support string-input rendering when all inputs are
already available to the caller:

- explicit `source` string input;
- explicit `language` or `extension`;
- explicit in-memory importer/import map if designed later;
- no implicit file reads;
- no implicit config discovery;
- no disk plugin loading.

The browser entrypoint may reject or return structured diagnostics for imports
that need external resolution until an explicit browser importer API exists.

## Node-Only Behavior

These features stay on the Node entrypoint for alpha:

- `render(filePath, options)`;
- filesystem-relative imports;
- include-path lookup from Less `paths`;
- config discovery and config metadata;
- package/plugin loading from disk;
- source-map file output;
- custom Less file manager compatibility.

## Test Plan

Add browser-build tests only after this spec is accepted and a browser
entrypoint exists:

- bundle smoke test for `jess/browser` in a browser-like bundler target;
- assertion that Node builtins are not included in the browser bundle;
- tree-shaking smoke test importing only `renderString` or `renderToResult`;
- string-input render test for a no-import Less source;
- diagnostic test for unsupported filesystem imports;
- package export verification for the browser entrypoint.

Until then, upstream Less browser fixtures remain out of the Less alpha
readiness lane.
