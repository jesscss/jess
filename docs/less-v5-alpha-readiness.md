# Less v5 Alpha Readiness

This is the living readiness tracker for the first Jess alpha focused on Less
v5 compatibility. The publish mechanics live in
[`releasing-alpha.md`](./releasing-alpha.md); this file tracks what must be true
before that runbook should be used. Features **deliberately deferred past this
alpha** (config-lane URL/import handling, source maps, …) are sequenced in
[`less-v5-release-plan.md`](./less-v5-release-plan.md).

## Historical direct-Less benchmark (not an acceptance gate; 2026-07-21)

These measurements are retained as reproducibility evidence only. They were
captured before the present migration worktree was clean and must not be used
as an alpha gate. The current clean baseline and the open performance-
comparison blocker are recorded in the performance section of
[`HANDOFF.md`](./future/core-architecture/HANDOFF.md). The public route is a
built direct parser on Parseman `0.28.0`; older 20–30 ms source-driver and
legacy-tree numbers measured different work and are not an A/B.

| Phase | Protocol and identity | Result |
| --- | --- | --- |
| Direct parse | `packages/less-parser/lib/index.js`: SHA-256 `52d88a95557a821815d9f15f2d6ab05bbb5c64a55f0189fb97a050d7aea50285`, 1,797,831 bytes; `benchmark.less`, 106,802 bytes; Node v24.11.1 arm64; 20 warmups + 3×45 samples | 63.321 ms median (p25 61.776, p75 64.487); `Stylesheet` JSON SHA-256 `2ba996a1c46eb6d77ce8f1748b35d1135848c128104e00f46dadf7e9651c53bd` (957,390 bytes). |
| Public compiler | `node scripts/measure-less-hotpath.mjs --fixture packages/jess/benchmark/benchmark.less --iterations 45 --warmup 20 --repeat 3 --trim 0.1 --json`; built Jess/Less-plugin chain | 77.492 ms round-median across 135 samples (usable 0.78% round RSD); CSS SHA-256 `ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6` (122,390 bytes). |

The remaining benchmark blocker is evidence quality, not a timing threshold:
there is no valid matched Parseman 0.27/0.28 generated-bundle A/B yet. The
current grammar requires `composeLeaf`, which the 0.27 package does not export,
and generated reducer identifiers include the absolute worktree path. Until a
matched, clean artifact protocol exists, timing movement is reported as a
baseline only and never as a performance acceptance claim.

## Current verification snapshot (2026-07-22)

- Core behavior: the complete `@jesscss/core` suite is **3,192 passed, 9
  skipped, and 2 todo**. The skipped/todo cases remain visible and are not
  converted into passing evidence.
- Source quality: the repository-wide production ESLint audit reports **0
  errors and 317 warnings**. The warnings are tracked lint debt; there is no
  current ESLint-error blocker.
- Strict types: `pnpm run verify:types` reports **4 diagnostics**, all four
  parser-entry `FusedRule` declaration mismatches against published Parseman
  `0.28.0`. The prepared Parseman `0.28.1` release-branch fix removes these
  four diagnostics, but it is not yet published or consumed here. No claim of
  an all-package strict-type pass is valid until that package is published,
  installed, and the parser packages are rebuilt.
- Alpha closure: `scripts/release/alpha-allowlist.json` contains **18
  allowlisted runtime packages**. `rollup-plugin-jess` is intentionally
  excluded because it depends on `jess` and is not part of the runtime closure.
  The allowlist and packed-consumer checks must still pass on the final
  `2.0.0-alpha.9` snapshot.

Normal public parse/compile provides neither Parseman coverage nor trace
instrumentation. Diagnostic coverage/trace uses a separate macro transform and
must never be used for this timing protocol. The rejected namespace gate did
not land: direct parse was 62.881 ms versus its 59.502 ms baseline and compiler
74.022 ms versus 73.772 ms (noise), so no production change remains. The next
choice investigation is the opt-in stable choice-arm trace design in
[`parseman-diagnostic-trace-design.md`](./future/parseman-diagnostic-trace-design.md).

## External Less `5.0.0-alpha.1` package audit (2026-07-21)

The sibling Less repository is on its `alpha` branch at `805c89e`, with the
working tree carrying the intended v5 wrapper, CLI, publish-script, and test
changes. Its package manifests are exactly `5.0.0-alpha.1`; the branch is not
yet synchronized with `upstream/master` (`54` commits ahead, `32` behind), and
the attempted merge has real conflicts in the v5/legacy build and test-data
surfaces. Do not merge that upstream history blindly or discard the dirty
alpha changes.

The built `lessc` smoke suite passes, as do the five publish-version/dependency
rewrite tests and the package typecheck. The full Less node suite exits with six
known v5 divergences (plugin-global/visitor behavior, advanced parser fixtures,
URL/process-import behavior, and source-map artifacts); these remain classified
known limitations rather than hidden or deleted failures.

The first packed Less tarball exposed a release blocker: its local Jess
dependencies were published as `link:` URLs, and a clean npm consumer fails
with `EUNSUPPORTEDPROTOCOL`. The Less alpha publish script now requires an
explicit `JESS_VERSION` (for example `2.0.0-alpha.9`), temporarily rewrites the
four Jess runtime dependencies to that exact registry version for `npm publish`,
and restores the local workspace-linked manifest afterward. Publication order
is therefore: publish and clean-consumer-verify Jess `2.0.0-alpha.9` first,
then publish Less with `JESS_VERSION=2.0.0-alpha.9`. The helper has a packed
manifest proof; a real clean Less consumer remains pending the Jess alpha.9
registry artifacts.

With no Deno/plugin execution on `benchmark.less`, three repeated 8-run/3-warmup
rounds measured Less alpha render medians of `99.44`, `98.56`, and `92.80` ms
(round mean `96.9` ms), versus the historical Less 4.5.1 `47.4` ms average.
The earlier `205.12` ms one-run result was a cold-start outlier; these numbers
are still not a comparable Less-4 A/B until the exact fixture/options and build
identity are recorded, but they establish the current warm-path signal.

## Status Key

- `[ ]` not started or not proven
- `[~]` in progress, with known gaps
- `[?]` needs owner decision before implementation should proceed
- `[x]` complete with evidence linked in this file

## Per-change-slice review protocol

Every delegated change slice gets two separate reviews before integration:

1. Run the slice's focused behavior tests, build/type checks, ESLint, and any
   applicable parser-boundary or aggressive-cutting verification.
2. Review only that diff for over-engineering using the Ponytail rubric. A
   callable Ponytail plugin invocation must be labeled **Ponytail invocation**
   and include one finding per line using `delete`, `stdlib`, `native`,
   `yagni`, or `shrink`, followed by `net: -N lines possible.`
3. In this workspace/session, Ponytail is not exposed as a callable tool, so
   an agent may instead report **Ponytail-style manual review**. That is an
   explicitly manual application of the cached rubric, not a claim that the
   plugin ran; it must still say `Lean already. Ship.` when no safe cut is
   found.
4. Disposition every finding before the slice is integrated. Ponytail is an
   over-engineering review only; correctness, type, lint, performance, and
   release gates remain independent and cannot be replaced by it.

## Alpha Release Gates

The first alpha is **not** a promise of complete Less 4.x corpus parity. It is
allowed to ship with the classified known limitations below, provided they stay
discoverable in the release notes and each has a concrete symptom, scope, and
follow-up. The runnable corpus remains a regression signal; expected failures
must never be hidden, deleted, or described as passing behavior.

The alpha blocks only on these advertised correctness and release-safety gates:

- the public direct `parse()` → canonical `Stylesheet` → one-engine compiler
  route, with no bridge/host/reparse fallback;
- core safety and correctness on the advertised route: no known crash, hang,
  duplicate evaluation engine, or silent output corruption in a supported use;
- the documented `jess` package API, package exports, builds, and clean
  consumer-install proof;
- the advertised `lessc` commands and options, including built-artifact CLI
  smoke/compatibility tests; and
- a release-note known-limitations section that links the complete inventory and
  states the unsupported or divergent behavior honestly.
- `[~]` **Strict source quality is blocking until the Parseman fix is
  published.** The current integration candidate with published Parseman
  `0.28.0` reports four strict parser-entry `FusedRule` diagnostics and no
  core strict-type diagnostics. Prepared but unpublished Parseman `0.28.1`
  removes those four declaration mismatches; after publication Jess must
  install it, rebuild the parser packages, and rerun `verify:types`. The
  production ESLint audit currently reports 0 errors and 317 warnings. The
  warnings are tracked debt, not an ESLint-error gate, and neither the type
  diagnostics nor warnings may be hidden by bundlers' `--noCheck` builds.
- `[x]` **F5 deferred CSS color-call gate.** Through the public Less/Jess route,
  CSS-shaped `rgb()`/`rgba()`/`hsl()`/`hsla()` calls with three or more argument
  slots remain authored, verbatim CSS calls even under `functionMode: 'error'`;
  they do not eagerly invoke a native function. Modern space/slash and relative
  forms arrive as one structured slot and use the same three-slot rule. Less's
  one- and two-slot color overloads (including `rgba(#5F59)` and
  `rgba(#5F59, .5)`) dispatch normally, so recognized Less forms are evaluated
  and malformed numeric arities are rejected by the call-level `functionMode`
  policy rather than leaking authored invalid output. An un-operated relative-
  color call remains authored; only a consumer that demands its value may reach
  an implementation rejection. Evidence:
  `pnpm --filter jess test -- function-error-public-semantics.test.ts --run
  --globals` (17/17 passing, including zero dispatches for installed native
  three-/four-slot CSS color functions); settled semantics:
  `DESIGN-DECISIONS.md` F5. The runnable Less unit corpus now has two F5
  expected-failure markers (`operations.less` and `functions/functions.less`),
  while `color-functions/rgba.less` is green because its one-/two-slot Less
  overloads are evaluated. These are intentional alpha semantics, not hidden
  failures.

Full upstream parity, unadvertised Less 4.x CLI parity, browser compilation,
source-map artifacts, and performance parity remain follow-up work unless they
are expressly advertised for a later alpha.

- `[~]` **Performance — baseline required for alpha; numeric gate for GA remains
  an owner decision.** The alpha has no measured timing threshold and must not
  cite incomparable historical numbers. The alpha review record captures the
  built artifact, direct-parse AST hash, compiler CSS hash, and disabled normal
  instrumentation with the protocol above; no release command currently
  enforces a timing threshold. Any claimed improvement/regression needs a
  matched rebuilt-artifact A/B with identical output. Less-4.x speed parity (or
  a bounded multiple) remains a future stable/GA gate once the owner sets the
  numeric bar.
- `[~]` **Advertised `lessc` CLI behavior** (alpha gate). The built Less v5
  alpha binary must run safely and correctly for its documented command/options
  set. Unsupported Less 4.x flags or divergent advanced behavior are alpha
  limitations only when listed in the release notes with a follow-up; they do
  not create an implied drop-in-parity promise.
- `[~]` Stabilize the public `jess` package API before the first Less alpha.
- `[~]` Maintain package-level Less coverage and the `find`/path-resolution
  surface. The complete upstream corpus remains a classified compatibility
  signal, not an implied all-fixtures-must-pass alpha gate.
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
  Its internal result is `{ document: Stylesheet, context }`, produced through
  the same Context-selected parser-plugin dispatcher as render; it is not a
  legacy-tree return. Jess does not have a public two-stage compile model today,
  and exposing the raw session Context would promise implementation detail.
- `[x]` `Compiler.render(...)` decision: public method shape.
- `[x]` `Compiler.renderString(...)` decision: public method shape.
- `[x]` `Compiler.renderToResult(...)` decision: public method shape. Keep the
  result shape even though fields such as `loadedUrls` may need follow-up
  implementation before or during alpha. Public contract: never reject for
  Jess/Less render failures; return structured diagnostics instead.
- `[x]` `Compiler.safeCompile(...)` decision: hide from first alpha public
  types because it exposes the same internal document/session-Context surface
  as `compile(...)`.
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
- `[?]` Direct `{ document: Stylesheet, context }` `compile(...)` result as a
  stable API, versus retaining it as internal while recommending render APIs
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
  covers the alpha public method shapes for `render(...)`,
  `renderString(...)`, `renderToResult(...)`, and `dispose()`; the current rerun
  is 8/8 green.
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

## Known limitations: runnable upstream corpus inventory

The runnable corpus has **30** explicit expected-failure markers in
`packages/jess/test/less/all-less.test.ts`. They are test instrumentation,
not passing compatibility evidence: each marker makes a mismatching render pass
the harness while preserving the observed failure. This is the complete first
alpha known-limitations inventory. A marker may be removed only with
byte-identical fixture proof; otherwise its release-note classification must
remain explicit and be updated when its symptom or scope changes.

| Class | Current fixtures | Symptom and alpha scope | Follow-up / evidence |
| --- | --- | --- | --- |
| Callable/reference and scope semantics | `detached-rulesets`, `functions-each`, `mixins`, `namespacing-5`, `namespacing-8`, `namespacing-functions`, `namespacing-media`, `variables`, `variables-in-at-rules` | Advanced Less callable, detached-ruleset, `each()`, namespace, and live/scoped lookup results can diverge. Missing mixins are still errors; ordinary unregistered `foo()` remains an optional CSS-function fallback, not a missing-mixin success. | Typed callable/reference lookup and binding semantics in core; graduate only with focused core proof plus byte-identical fixture output. |
| Imports and conditional at-rules | `import-reference`, `import`, `import-remote`, `urls`, `process-imports/google`, `plugin/plugin` | Some reference/remote/interpolated imports, process-import filtering, and media-query merging diverge. `@plugin` script execution itself is separately proved; its fixture mismatch shares the import/media rendering gap. | Context/plugin-owned import execution and typed media wrapping; no dialect-local resolver or source reparse. |
| Parser/evaluator edge syntax | `selectors`, `property-name-interp`, `parse-interpolation`, `parser-slashed-combinator`, `permissive-parse`, `media`, `container` | Specific selector interpolation/pseudo, property interpolation, slashed-combinator, and permissive at-rule-prelude forms are rejected or render differently. | Extend the direct Parseman grammar and canonical AST only where the syntax has an agreed semantic shape; retain migration-policy questions as documented decisions. |
| Less math/unit evaluation | `tests-config/units/no-strict/no-strict.less`, `tests-config/units/strict/strict-units.less` | Context option wiring is present. Remaining mismatches are (a) structural bare-slash precedence under `math: 0`/`mathMode: 'always'` while `parens-division` preserves bare slash values, and (b) strict-unit singularity validation occurring before a later operation can cancel units. | Promote the existing typed `ValueSlot[]` structure without reparsing source bytes; defer strict singularity validation to final typed materialization/emission while retaining strict incompatible `+`/`-` errors. The no-strict fixture's `test-division`, `t3`, and `t6` must evaluate; equivalent bare slash values under `parens-division` remain authored. Focused core/evaluator tests and these two public fixtures are authoritative. |
| F5 lazy CSS color calls | `color-functions/operations`, `functions/functions` (the `color-functions/rgba` overload cases are green) | CSS-shaped un-operated rgb-family calls with three or more slots remain authored and byte-faithful; Less 4's goldens expect eager clamping or canonicalization for the two remaining boundary fixtures. Less one-/two-slot overloads are dispatched and tested. | Preserve the call-level demand boundary; only a consumer that needs a typed color may invoke the implementation. The focused F5 contract is 17/17. |
| URL-option behavior | `static-urls`, `url-args` | Some configured static-URL/query-argument behavior differs from Less. The four rewrite/rootpath fixtures are byte-identical public-route passes, not limitations. | One Context/plugin-owned URL transform contract, with public compiler fixture proof; do not add a dialect-local resolver. |
| Source-map artifacts | `sourcemaps-basepath`, `sourcemaps-include-source`, `sourcemaps-rootpath`, `sourcemaps-url` | Source-map annotations and emitted artifacts are not alpha-supported behavior. | Dedicated artifact harness and documented public source-map contract, rather than render-string assertions. |

The grouped paths above deliberately name every marker; do not summarize the
list as broad “advanced math/color” or “known-hang” buckets. Existing
non-runnable skips (helper files, no-CSS fixtures, compression/debug fixtures,
and plugin API scope decisions) are a separate inventory and are not evidence
that a runnable expected failure is non-blocking.

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

- 2026-07-21 (historical baseline, superseded below): Made source quality an
  explicit blocking alpha gate rather than inferring it from release builds
  that use `--noCheck`. The dependency-ordered `verify:types` audit on the
  then-current integration candidate with published Parseman 0.28.0 reported
  245 diagnostics: 241 in core plus four parser-entry `FusedRule` diagnostics.
  The bounded `lint:production` audit reported 1,357 findings. Those counts are
  retained as historical burn-down evidence only.
- 2026-07-22: Reconciled the current source-quality audit: core strict types
  are clean, four parser-entry `FusedRule` diagnostics remain solely because
  published Parseman 0.28.0 predates the prepared 0.28.1 declaration fix, and
  production ESLint reports 0 errors and 317 warnings. The 18-package alpha
  allowlist and intentionally excluded `rollup-plugin-jess` are now recorded
  with the current package-closure evidence. The benchmark remains a baseline
  investigation with no valid matched 0.27/0.28 performance A/B yet.
- 2026-07-21: Replaced the stale dirty/behind Less package snapshot with the
  clean `5.0.0-alpha.1` release candidate at `1fc6d76b`. Verified
  `HEAD..upstream/master=0`, `npm run test:lessc`, `npm run typecheck`, and the
  five publish-version/dependency rewrite tests. Recorded the clean local Jess
  `2.0.0-alpha.9` candidate at `3081a94fe` without claiming either registry
  publication or final clean Less consumer verification.
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
