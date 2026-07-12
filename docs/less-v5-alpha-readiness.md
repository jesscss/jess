# Less v5 Alpha Readiness

This is the living readiness tracker for the first Jess alpha focused on Less
v5 compatibility. The publish mechanics live in
[`releasing-alpha.md`](./releasing-alpha.md); this file tracks what must be true
before that runbook should be used.

Owner-reported baseline on 2026-06-19: `benchmark.less` renders at about
133 ms, which is good enough for the first Less alpha. Release readiness is now
about API stability, Less API coverage, and CI guards rather than another
performance cutting pass.

## Status Key

- `[ ]` not started or not proven
- `[~]` in progress, with known gaps
- `[?]` needs owner decision before implementation should proceed
- `[x]` complete with evidence linked in this file

## Release Gates

- `[~]` Stabilize the public `jess` package API before the first Less alpha.
- `[~]` Expand package-level Less tests to cover all non-browser Less API
  fixtures and the `find`/path-resolution surface.
- `[x]` Add Less v5 alpha CI guards that run the stable readiness tests after
  the API and fixture lanes are addressed. `.github/workflows/less-alpha-readiness.yml`
  runs `pnpm run verify:less-alpha` on pull requests, pushes to `main` and
  `alpha`, and manual dispatch.
- `[?]` Browser-build spec is drafted in
  [`less-v5-browser-build-spec.md`](./less-v5-browser-build-spec.md), but needs
  owner acceptance before adding browser package exports or browser fixture
  parity. Jess should support tree-shaken browser builds, but the alpha should
  not imply that arbitrary `.less` files are parsed in the browser.

## API Stabilization

Goal: make the package boundary intentional enough that the alpha does not
accidentally promise transitional internals.

Current public entrypoint:

- `packages/jess/package.json` exports only `.` and `./package.json`.
- The package types currently come from `packages/jess/lib/index.d.ts`.
- Source entrypoint is `packages/jess/src/index.ts`.

Initial public candidate set:

- `[x]` `Compiler`
- `[x]` `ConfigOptions`
- `[x]` `Compiler.compile(...)` decision: hide from first alpha public types.
  It is a legacy tree-returning path, Jess does not have a public two-stage
  compile model today, and it should not be treated as an internal production
  path either.
- `[x]` `Compiler.render(...)` decision: public method shape.
- `[x]` `Compiler.renderString(...)` decision: public method shape.
- `[x]` `Compiler.renderToResult(...)` decision: public method shape. Keep the
  result shape even though fields such as `loadedUrls` may need follow-up
  implementation before or during alpha. Public contract: never reject for
  Jess/Less render failures; return structured diagnostics instead.
- `[x]` `Compiler.safeCompile(...)` decision: hide from first alpha public
  types because it exposes the same legacy tree/context surface as
  `compile(...)`.
- `[x]` `Compiler.safeRender(...)` decision: hide from first alpha public types;
  a separate "safe" render name does not currently describe a distinct public
  value clearly enough.
- `[x]` `Compiler.createContext(...)` decision: hide from first alpha public
  types. If plugin authors need this area later, design a narrower explicit API
  instead of promising raw `@jesscss/core` `Context`.
- `[x]` `Compiler.dispose()` decision: public stable method shape for
  long-lived build tools, watch mode, servers, and tests that need compiler and
  plugin cleanup.

Initial likely-internal or quarantine candidates:

- `[?]` Public constructor field `Compiler.opts`
- `[?]` Direct tree-returning `compile(...)` as stable API, versus retaining it
  as compatibility-only while recommending render APIs
- `[?]` `createContext(...)`, because it exposes core runtime details
- `[?]` Re-exported core diagnostic/value types that appear in public result
  shapes only because implementation currently imports them
- `[?]` `packages/jess/src/config.ts` helpers such as `getConfig`,
  `getConfigWithMeta`, and `getExpectedOutputFiles`
- `[?]` `packages/jess/src/output.ts` `OutputCollector`
- `[?]` `packages/jess/src/diagnostics.ts` `outputDiagnostics`
- `[?]` `packages/jess/src/visitor/index.ts` `Visitor`

Implementation options to evaluate:

- `[x]` Audit emitted declarations from `pnpm --filter jess build`.
- `[x]` Add an API-report style fixture for the emitted public declarations:
  `packages/jess/etc/jess.api.md`, checked by `pnpm run verify:jess-api`.
- `[x]` Decide whether to post-process `.d.ts` output to strip/quarantine
  methods and fields that must remain runtime-accessible but should not be
  typed as supported public API. Decision: use API Extractor d.ts rollup with
  `@internal` tags and disabled missing-release-tag warnings, so Jess does not
  need to mark every public item explicitly.
- `[x]` Add `pnpm run verify:package-exports` to the final alpha readiness
  guard set if API files or exports change.

Owner interview queue:

- `[x]` Should alpha users be encouraged to call only `render`, `renderString`,
  and `renderToResult`, with `compile` hidden until a real public need exists?
  Yes.
- `[x]` Is `safeCompile`/`safeRender` part of the public contract, or should
  errors flow through thrown diagnostics for alpha? Hide both; `render(...)` and
  `renderString(...)` may reject like normal promise APIs, while
  `renderToResult(...)` is the non-throwing structured diagnostics API.
- `[x]` Should `Compiler.opts` disappear from public types even if it remains a
  runtime field for now?
- Yes. It remains runtime-accessible for existing harness/internal use, but is
  marked `@internal` and trimmed from the public API Extractor rollup.
- `[x]` Should `createContext` be public for plugin authors, or hidden until the
  core runtime model settles? Hide for alpha; design a narrower plugin-author
  API later if needed.
- Should `jess` re-export any Less-compatible tree/value classes, or should
  those stay behind compatibility plugins for alpha?
- Are config helpers package-public, test-only, or internal?

## Less API Test Expansion

Goal: package-level Less tests should cover the Less API surface we claim for
alpha, using upstream Less test data where possible and focused Jess tests where
upstream fixtures do not map cleanly.

Current signal:

- `packages/jess/test/less/all-less.test.ts` runs upstream
  `tests-unit/*/*.less` and selected `tests-config/*/*.less` through
  `Compiler.renderToResult(...)`.
- `JESS_LESS_FIXTURE=tests-unit/ pnpm run test:less:test-data` covers 64 unit
  fixture cases in the current readiness lane.
- `JESS_LESS_FIXTURE=tests-config/ pnpm run test:less:test-data` covers 29
  config fixture cases in the current readiness lane.
- Browser tests are intentionally out of scope for this tracker until the
  browser-build spec exists.

Known gaps to add or close:

- `[~]` Include `tests-config/**/*.less` fixtures that exercise Less options,
  config files, include paths, rewrite URLs, source-map modes, plugins, and
  relative path handling. Runnable config fixtures are now included, with
  expected-failure labels for unsupported or mismatching behavior.
- `[x]` Cover Less `find`/path-resolution behavior explicitly, including
  relative imports and include-path lookup.
  Include-path lookup for imports and file functions is covered by
  `tests-config/include-path*`; `packages/jess/test/path-resolution.test.ts`
  now covers current-file-relative import precedence, include-path fallback,
  and `renderString(...)` filePath-based import resolution.
- `[x]` Add or validate tests for Less public API entrypoints that are not
  covered by file render fixtures. `packages/jess/test/public-api-contract.test.ts`
  now covers the alpha public method shapes for `render(...)`,
  `renderString(...)`, `renderToResult(...)`, and `dispose()`.
- `[~]` Convert fixture skips from broad comments into categorized expected
  failures with reasons and owners.
  The active harness now has expected-failure reasons for runnable mismatches
  and skip reasons for helper/no-CSS, plugin-scope, source-map artifact, and
  known hang fixtures. Owner/staging decisions still need release-note wording.
- `[ ]` Keep browser fixtures excluded, with an explicit skip category that
  points to the browser-build spec.
- `[ ]` Decide whether plugin, preprocessor, postprocessor, visitor, and custom
  file-manager fixtures are in the first alpha or staged after alpha. If staged,
  document the unsupported surface in release notes.
- `[ ]` Add focused core tests when a Less fixture exposes a parser/runtime
  invariant gap, then use the package-level fixture as the compatibility proof.

Current expected-failure backlog:

- Unit output mismatches: reference import filtering, advanced math/color
  behavior, default guard resolution, property accessor precedence, scope
  leakage, and `@starting-style` shorthand expansion.
- Config output mismatches: namespacing/detached map lookup, `processImports:
  false`, `rewriteUrls`, `rootpath`, `relativeUrls: false`, `urlArgs`, and
  source-map annotation/artifact output.
- Skipped known hangs include `extend-exact`, advanced variables/merge/selectors
  and older async-deadlock fixtures. These remain alpha compatibility blockers
  unless explicitly staged after alpha.

Do not use the older `describe.todo` Less files as release evidence until each
test is revalidated against upstream Less behavior, Jess behavior docs, or a
focused core contract test.

## Browser Build Spec

Goal: avoid accidentally promising browser-side Less file parsing while still
supporting tree-shaken browser builds.

- `[x]` Specify what browser consumers can import. Draft:
  [`less-v5-browser-build-spec.md`](./less-v5-browser-build-spec.md).
- `[x]` Specify which Node-only features are excluded: filesystem imports,
  config discovery, plugin loading from disk, Node module resolution, and direct
  `.less` file parsing.
- `[x]` Specify what the tree-shaken browser build should support, such as
  precompiled/runtime-free helpers or explicit string-input APIs if approved.
- `[?]` Owner acceptance needed before adding package export or bundler tests.

## CI Guards

Goal: add CI jobs that prove the alpha stays releasable after the API and test
lanes are addressed.

Candidate guard set:

- `[x]` Install with frozen lockfile.
- `[x]` Build publishable alpha packages.
- `[x]` Verify package exports.
- `[x]` Verify public API declarations/API report.
- `[x]` Run public `jess` API contract tests for alpha-approved methods.
- `[x]` Run dedicated Less path-resolution tests for Node alpha behavior.
- `[x]` Run Less v5 fixture readiness tests, including the expanded non-browser
  Less API suite.
- `[x]` Run `release:alpha:check` after readiness tests are stable.

CI should not publish automatically from normal pushes. The existing manual
publish workflow remains the publishing path; readiness guards should fail
earlier, before a manual publish attempt.

## Evidence Log

- 2026-06-19: Created this tracker after owner declared the current
  `benchmark.less` performance good enough for first Less alpha and identified
  API stabilization, expanded Less API tests, and CI guards as release blockers.
- 2026-06-19: Added API Extractor public declaration trimming and API report
  guard. Verified with `pnpm --filter jess build`, `pnpm run verify:jess-api`,
  and `pnpm run verify:package-exports`.
- 2026-06-19: Fixed Less `paths` option normalization into core
  `searchPaths`, which closed `tests-config/include-path*` coverage for
  imports, `data-uri(...)`, and `image-size(...)`. Verified with
  `JESS_LESS_FIXTURE='tests-config/(include-path|include-path-string)/' pnpm run test:less:test-data`.
- 2026-06-19: Expanded the Less test-data harness to include `tests-config`,
  `JESS_LESS_FIXTURE` filtering, explicit expected-failure reasons, and
  stricter no-expected-CSS failures. Verified split lanes:
  `JESS_LESS_FIXTURE=tests-unit/ pnpm run test:less:test-data` (64 tests) and
  `JESS_LESS_FIXTURE=tests-config/ pnpm run test:less:test-data` (29 tests).
- 2026-06-19: Added `pnpm run verify:less-alpha`, which builds `jess`, checks
  package exports, checks API Extractor output, and runs the split Less unit
  and config readiness lanes. `release:alpha:check` now runs this guard before
  baseline verification and alpha dry-run publish. Verified with
  `pnpm run verify:less-alpha`.
- 2026-06-19: Fixed optimized leaf at-rule rendering so unknown at-rules and
  `@namespace` preserve the required boundary space after trimming authored
  prelude whitespace. This graduated `tests-unit/impor/impor.less` and
  `tests-unit/plugi/plugi.less` from expected-failure, and narrowed
  `tests-unit/css-3/css-3.less` to the remaining tiny rotate normalization
  mismatch. Verified with the focused at-rule test assertions,
  `pnpm --filter @jesscss/core build`, `pnpm --filter jess build`, and
  `JESS_LESS_FIXTURE='^(tests-unit/css-3/css-3\.less|tests-unit/impor/impor\.less|tests-unit/plugi/plugi\.less)$' pnpm run test:less:test-data`.
- 2026-06-19: Fixed optional CSS fallback call rendering so structured
  `Dimension` arguments use normal dimension serialization instead of raw
  JavaScript number interpolation. This graduated `tests-unit/css-3/css-3.less`
  from expected-failure coverage. Verified with
  `pnpm --filter @jesscss/core test -- src/tree/__tests__/call.test.ts --run --globals --reporter=verbose`,
  `pnpm --filter @jesscss/core build`, `pnpm --filter jess build`, and the
  focused `JESS_LESS_FIXTURE='^(tests-unit/css-3/css-3\.less|tests-unit/impor/impor\.less|tests-unit/plugi/plugi\.less)$' pnpm run test:less:test-data`
  run after removing the expected-failure marker.
- 2026-06-19: Added `packages/jess/test/public-api-contract.test.ts` and
  `pnpm run test:jess-public-api` to guard the alpha-approved public methods:
  `render(...)`, `renderString(...)`, `renderToResult(...)`, and `dispose()`.
  `verify:less-alpha` now runs this public API contract test after API
  Extractor/package export checks and before Less fixture readiness tests.
  Verified with `pnpm run test:jess-public-api` and
  `pnpm run verify:less-alpha`.
- 2026-06-19: Added `packages/jess/test/path-resolution.test.ts` and
  `pnpm run test:jess-path-resolution` to guard Node alpha path behavior:
  current-file imports win before include paths, include paths are used as
  fallback, and `renderString(...)` uses `filePath` as the import base. The
  full `verify:less-alpha` guard now includes this dedicated path-resolution
  test.
- 2026-06-19: Added `.github/workflows/less-alpha-readiness.yml`, a non-publish
  CI workflow that runs `pnpm run verify:less-alpha` for pull requests, pushes
  to `main` and `alpha`, and manual dispatch. The manual publish workflow
  remains separate.
- 2026-06-19: Drafted `docs/less-v5-browser-build-spec.md`. The draft keeps the
  alpha `jess` root as the Node entrypoint, proposes a future `jess/browser`
  entrypoint for browser-safe string-input APIs, and explicitly excludes
  filesystem imports, config discovery, disk plugin loading, Node module
  resolution, custom file managers, and upstream Less browser fixture parity
  until the browser contract is accepted.
- 2026-06-19: Fixed escaped tag selector rendering so authored CSS escape
  casing is preserved for selector syntax instead of being lowercased with
  ordinary tag names. This graduated `tests-unit/css-escapes/css-escapes.less`
  from expected-failure coverage. Verified with
  `pnpm --filter @jesscss/core test -- src/tree/__tests__/selector-basic.test.ts --run --globals --reporter=verbose`,
  `pnpm --filter @jesscss/core build`, `pnpm --filter jess build`, and
  `JESS_LESS_FIXTURE='^tests-unit/css-escapes/css-escapes\.less$' pnpm run test:less:test-data`
  after removing the expected-failure marker.
- 2026-06-19: Fixed custom property interpolation rendering so source-owned
  trivia before a one-item interpolated custom-property value is still written
  when the evaluated replacement becomes scalar text. This graduated
  `tests-unit/comments/comments.less` from expected-failure coverage while
  preserving raw custom-property comment strings without invented spacing.
  Verified with
  `pnpm --filter @jesscss/core test -- src/tree/__tests__/declaration.test.ts --run --globals --reporter=verbose`,
  `pnpm --filter @jesscss/core build`, `pnpm --filter jess build`, and
  `JESS_LESS_FIXTURE='^tests-unit/comments/comments\.less$' pnpm run test:less:test-data`
  after removing the expected-failure marker.
- 2026-06-19: Fixed optional CSS fallback call materialization so source-owned
  comment trivia between function arguments is preserved in the generated
  scalar call text. This graduated `tests-unit/comments/comments2.less` from
  expected-failure coverage. Verified with
  `pnpm --filter @jesscss/core test -- src/tree/__tests__/call.test.ts --run --globals --reporter=verbose`,
  `pnpm --filter @jesscss/core build`, `pnpm --filter jess build`, and
  `JESS_LESS_FIXTURE='^tests-unit/comments/comments2\.less$' pnpm run test:less:test-data`
  after removing the expected-failure marker.
- 2026-06-19: Fixed CSS `@page` selector parsing so page names such as
  `Test:first` are modeled as identifier text instead of tag selectors, which
  preserves authored casing through Less render. This graduated
  `tests-unit/media/media.less` from expected-failure coverage. Verified with
  `pnpm --filter @jesscss/css-parser test -- ast-serialize.test.ts --run --globals --reporter=verbose -t "page selector names preserve authored casing"`,
  `pnpm --filter @jesscss/core test -- src/tree/__tests__/at-rule.test.ts --run --globals --reporter=verbose`,
  `pnpm --filter @jesscss/css-parser build`, `pnpm --filter @jesscss/less-parser build`,
  `pnpm --filter @jesscss/core build`, `pnpm --filter jess build`, and
  `JESS_LESS_FIXTURE='^tests-unit/media/media\.less$' pnpm run test:less:test-data`
  after removing the expected-failure marker.
