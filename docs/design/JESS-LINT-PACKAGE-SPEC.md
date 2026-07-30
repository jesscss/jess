# Jess lint package design

Status: adversarially reviewed design with the initial Phase 1/2 implementation
slice landed on `origin/dev`: `@jesscss/diagnostics-core`, `@jesscss/lint`, the
shared default compiler stack package, `jess lint` CLI wiring, the CSS
parser/PostCSS oracle, Stylelint comparison harnesses, and line-tracked
diagnostic CST parser entrypoints. Phase 3 semantic diagnostics still need
compiler-owned analysis facts before implementation.

## 1. Goal

Ship a dedicated `@jesscss/lint` package and expose it through `jess lint`.
The package should provide product-facing lint diagnostics for CSS, Less, SCSS,
and Jess source using Jess's own parser, import resolver, source locations,
language-service metadata, and diagnostic model.

`@jesscss/lint` is not a bespoke problem detector. It owns policy and
presentation: which diagnostics are enabled, whether they surface as errors or
warnings, how they are filtered by file, how batch runs are formatted, and which
exit code the CLI returns. Problem detection belongs to the parser, compiler,
and reusable language diagnostics layer.

The goal is not to replace Stylelint for generic CSS style-policy enforcement.
Stylelint remains the ecosystem tool for large configurable rule sets, existing
editor integrations, formatters, cache behavior, and shareable style configs.
Jess lint should improve on Stylelint in the areas where Stylelint is structurally
weak for this project: Jess/Less/SCSS semantic source analysis, real import graph
facts, canonical AST/CST spans, CSS metadata that already powers the language
service, and diagnostics that match Jess compile behavior.

## 2. Non-goals

- Do not make linting the correctness/performance gate for architecture work.
  `docs/architecture/llm-quality-enforcement-design.md` keeps that role with
  deterministic PR gates and evidence-citing review. Lints are product
  diagnostics and precise regression pins, not the enforcement backbone.
- Do not make a PostCSS tree, Stylelint custom syntax, or rendered-CSS pass the
  native lint engine.
- Do not run Stylelint from `jess lint` by default.
- Do not add heavy local git hooks. `jess lint` is explicit CLI/API work.
- Do not introduce a second diagnostic shape. Use Jess diagnostics.
- Do not use regex/text import extraction for product lint facts.
- Do not add a private lint rule engine that redetects problems already known
  to the compiler or language service.

## 3. Stylelint comparison and migration reference

Stylelint 17.14.1 is PostCSS-based and requires Node >=20.19.0, which matches
Jess's current Node floor. Its public strengths are real: more than 100 CSS
rules, plugins, shareable configs, autofix, cache, and several output formats.
Its extension model is:

- custom rules are Stylelint plugins that receive a PostCSS Root and result;
- custom syntaxes are PostCSS parse/stringify modules selected through
  `customSyntax`;
- shareable configs can bundle plugins, syntaxes, rules, and overrides.

The goal is not a Jess adapter for Stylelint. Stylelint should be treated as a
feature guide and migration reference: which diagnostics users expect, how
configuration is shaped, what formatters and exit behavior people rely on, and
which common rules can map to native Jess diagnostics.

The native diagnostic path remains Jess-owned. A separate parallel package can
help Stylelint users migrate without running Stylelint as the detector, for
example:

- read a Stylelint config and report which entries map to native Jess diagnostic
  policy;
- provide a Stylelint-to-Jess diagnostic matrix for high-value rules;
- expose presets whose names intentionally mirror familiar Stylelint bundles
  where the behavior is genuinely equivalent;
- flag unsupported Stylelint rules explicitly rather than approximating them
  over a PostCSS-shaped Jess tree.

That package is a migration aid, not an adapter. It must not make native lint
depend on PostCSS, Stylelint, or rendered CSS.

## 3.1 PostCSS oracle for the CSS parser

Separately, test `@jesscss/css-parser` against PostCSS for plain CSS. This is a
CSS parser compatibility oracle, not a lint engine and not evidence for
Jess/Less/SCSS semantics.

The existing CSS parser corpus already notes that it was forked from
`postcss-parser-tests` in
`packages/syntax/css/css-parser/test/css/README.md`. Make that relationship
explicit with an oracle harness:

- parse the same named CSS fixture set with PostCSS and `@jesscss/css-parser`;
- compare named acceptance/failure sets before comparing counts;
- record known intentional divergences as named baselines with reasons;
- compare stable observable facts such as parse success, diagnostics, source
  spans, and normalized rule/declaration/at-rule nesting where the models
  overlap;
- avoid exact AST-shape equivalence, because PostCSS and Jess do not expose the
  same tree contract;
- pin PostCSS as a dev-only oracle dependency for the CSS parser test package.

This oracle should catch plain-CSS parser regressions and help prioritize
Stylelint-migration feature coverage, but it must not become the authority for
Jess dialect constructs or compiler semantics.

The PostCSS comparison harnesses are opt-in only. They are not referenced from
package `ci`, root `ci`, release preflight, or ordinary `test` scripts. Run them
when changing parser recognition or when taking compatibility/performance
measurements:

```sh
pnpm --filter @jesscss/css-parser oracle:postcss
pnpm --filter @jesscss/css-parser bench:postcss
pnpm --filter @jesscss/less-parser oracle:postcss-less
pnpm --filter @jesscss/less-parser bench:postcss-less
pnpm --filter @jesscss/lint bench:stylelint
```

`@jesscss/lint` compares against Stylelint using the stable Stylelint-comparable
rule set exported from `packages/lint/src/rules.ts`. The hot lint result is the
neutral source diagnostic list with offsets and, on diagnostic/editor paths,
parser-captured line/column coordinates. Legacy Jess
`ErrorDiagnostic`/`WarningDiagnostic` frame objects are opt-in through
`includeLegacyDiagnostics` because building code-frame objects is presentation
work, not rule detection.

Diagnostics-core routes CSS, Less, SCSS, and Jess through diagnostic CST parser
entrypoints compiled from the same grammar factories with `hostMode: 'cst'` and
line tracking enabled. Normal AST/CST parser entrypoints remain offset-only.
The earlier CSS AST fast path was removed so CLI and IDE diagnostics share one
source of spans and coordinates.

## 4. Existing Jess surfaces to reuse

- `packages/core/src/error/diagnostics.ts` already defines
  `ErrorDiagnostic` and `WarningDiagnostic`.
- `packages/core/src/plugin.ts` defines parser plugin results as
  `{ document, errors, warnings }`.
- `packages/compiler/src/index.ts` exposes safe collection paths such as
  `safeCompile()` and `safeRender()`. These are useful for parse diagnostics but
  are not sufficient for semantic lint because they expose mutable context and
  documents, not stable analysis facts.
- `packages/config/src/loader.ts` already searches `styles.config.*`.
- `packages/config/src/options.ts` already infers `css`, `less`, `scss`, and
  `jess` from file extensions.
- `packages/editor/language-service/src/cst-lint.ts` already contains a
  tolerant CST lint pass for editor diagnostics.
- `packages/editor/language-service/src/engine.ts` owns the CSS metadata
  pipeline: VS Code custom-data providers, known CSS properties, known at-rules,
  and the lookup policy for editor diagnostics. That knowledge belongs with the
  language-service diagnostics layer, not in parser/core packages.
- `packages/jess/src/index.ts` currently owns the batteries-included compiler
  plugin stack. That stack cannot be duplicated in lint, and lint cannot import
  `jess` once `jess` depends on lint for CLI wiring.
- `packages/jess/bin/cli.mjs` is small, but it parses options before command
  dispatch today. `jess lint --format json file.less` requires command-specific
  parsing, not the current one-pass parser.

## 4.1 Prerequisite: shared default compiler stack

Before semantic lint or CLI wiring, extract the default Jess compiler stack below
both `jess` and `@jesscss/lint`. The preferred shape is a small reusable package:

```text
packages/compiler-preset/
  package.json              # name: @jesscss/compiler-preset
  src/index.ts
```

It owns the default plugin stack currently embedded in `packages/jess/src/index.ts`
and exports a factory that both product shells can consume, for example:

```ts
export interface DefaultCompilerStack {
  defaultPlugins(context: CompilerPluginContext): readonly PluginInterface[];
  normalizeConfiguredPlugin: CompilerHooks['normalizeConfiguredPlugin'];
  prepareSource: CompilerHooks['prepareSource'];
  scriptPluginSpecifier: string;
  scriptPluginResolveFrom: string;
  dispose(): void;
}

export function createDefaultCompilerStack(resolveFrom: string): DefaultCompilerStack;
```

Allowed dependencies:

- `@jesscss/compiler`;
- `@jesscss/core`;
- `@jesscss/plugin-jess`;
- `@jesscss/plugin-less`;
- `@jesscss/plugin-node-modules`;
- `@jesscss/plugin-scss`.

Then:

- `jess` becomes a thin `Compiler extends BaseCompiler` wrapper that consumes
  `@jesscss/compiler-preset`;
- `@jesscss/lint` consumes the same default stack for semantic analysis;
- neither package imports the other;
- the plugin stack is implemented once.

If this extra package is rejected, the alternative must still satisfy the same
dependency invariant: one shared implementation below both `jess` and lint.

## 4.2 Prerequisite: compiler analysis facts

Semantic lint must consume compiler-owned immutable facts, not private `Context`
internals and not rendered CSS. Add a public or clearly internal-to-workspace
analysis API before Phase 3 semantic diagnostics:

```ts
export interface AnalysisResult {
  document: Stylesheet | null;
  diagnostics: readonly AnalysisDiagnostic[];
  imports: readonly ImportFact[];
  symbols: readonly SymbolFact[];
  references: readonly ReferenceFact[];
}

export function collectFactsForFile(
  filePath: string,
  options?: Partial<ConfigOptions>
): Promise<AnalysisResult>;

export function collectFactsForSource(
  input: SourceContent,
  options?: Partial<ConfigOptions>
): Promise<AnalysisResult>;
```

The exact names can change during implementation, but the ownership cannot:
compiler/parser code owns the facts because it already has the single parsed
source, import resolution, and source contexts. Lint only consumes them.
Do not use a single `string | SourceContent` argument; in this codebase a bare
string normally means a file path, while lint text APIs naturally handle source
strings.

Import facts must come from Parseman parser/compiler structure. Lint may reuse
path resolution helpers, but must not use `style-resolver`'s tolerant
`extractImports()` as product lint evidence.

## 4.3 Prerequisite: reusable language diagnostics core

CSS validity and custom-data diagnostics are language-service knowledge. Findings
such as "unknown property", "unknown at-rule", "not a valid custom property",
and future custom-property value validation must not move into core parsers or
be reimplemented separately by the CLI.

Before exposing the editor CST diagnostics through a product lint surface,
extract the language-service diagnostic engine into a package below both
consumers, for example `@jesscss/diagnostics-core` or
`@jesscss/language-core`.

Do not use `@jesscss/language-service/diagnostics` as the boundary. The current
language-service package is private and depends on VS Code/LSP/server packages;
even a clean subpath would still make CLI users install the whole package graph
and would invite future policy cycles. If the language service is split later,
the publishable package must be the LSP-free diagnostics core, with editor/LSP
hosting layered above it.

The boundary must:

- own tolerant parser routing for CST/CSS metadata diagnostics, so
  `@jesscss/lint` does not depend directly on parser packages to host those
  detections;
- accept source inputs, parsed CST/source facts where already available, and CSS
  metadata providers;
- return neutral, LSP-free diagnostic records that convert losslessly to Jess
  diagnostics and LSP diagnostics;
- avoid importing VS Code/LSP protocol types;
- remain reusable by the editor engine, so native diagnostic improvements
  improve IDE diagnostics by default.

The IDE is the primary interactive consumer of lint-like diagnostics. The CLI
is the batch/reporting shell over the same reusable analysis plus CLI-only
concerns such as globs, output format, and exit status.

Design invariant: if a diagnostic condition can appear in `jess lint`, the same
detector must be usable by the IDE path unless it is purely CLI/configuration
related, such as "no files matched this glob" or "`--max-warnings` was exceeded".

## 5. Package placement and dependency direction

Add a flat package:

```text
packages/lint/
  package.json
  src/index.ts
  src/config.ts
  src/diagnostics.ts
  src/engine.ts
  src/policy.ts
  test/
```

Package name: `@jesscss/lint`.

Dependencies after the prerequisites:

- depends on `@jesscss/compiler`, `@jesscss/compiler-preset`,
  `@jesscss/core`, `@jesscss/diagnostics-core` or `@jesscss/language-core`, and
  `styles-config` as needed;
- may depend on `@jesscss/style-resolver` only for path-resolution helpers that
  do not scrape source text. Do not use `extractImports()` for product lint
  diagnostics;
- must not depend directly on dialect parser packages for CST/CSS metadata
  diagnostics. The diagnostics-core package owns tolerant parser routing;
- must not depend on VS Code/LSP packages or `jess`;
- `jess` may depend on `@jesscss/lint` for CLI wiring;
- `@jesscss/language-service` must consume the same reusable diagnostics-core
  package as lint, adapting diagnostics to LSP only at the boundary.

This keeps the dependency graph flowing from product shells to reusable engines:
`jess` consumes lint; `lint` and `language-service` share diagnostics core
rather than duplicating or layering one full product shell on the other.

## 6. Public API

Initial API:

```ts
export interface LintOptions {
  cwd?: string;
  configFile?: string;
  stylesConfig?: StylesConfig;
  lintConfig?: LintConfig;
  language?: 'css' | 'less' | 'scss' | 'jess';
  maxWarnings?: number;
}

export interface LintTextInput {
  source: string;
  filePath?: string;
  language?: 'css' | 'less' | 'scss' | 'jess';
}

export interface LintResult {
  filePath?: string;
  diagnostics: readonly LintDiagnostic[];
  errors: ErrorDiagnostic[];
  warnings: WarningDiagnostic[];
}

export interface LintRunResult {
  results: LintResult[];
  errored: boolean;
  warningCount: number;
  errorCount: number;
}

export function lintText(input: LintTextInput, options?: LintOptions): Promise<LintResult>;
export function lintFiles(patterns: string | string[], options?: LintOptions): Promise<LintRunResult>;
```

Do not export a public rule-authoring/plugin API in v1. The non-exported
internal surface should be diagnostic policy, not problem detection:

```ts
export type LintSeverity = 'off' | 'warn' | 'error';

interface NeutralDiagnostic {
  readonly code: string;
  readonly phase: Phase;
  readonly defaultSeverity: 'error' | 'warn';
  readonly message: string;
  readonly reason?: string;
  readonly filePath?: string;
  readonly offset?: number;
  readonly endOffset?: number;
}

interface LintDiagnostic extends NeutralDiagnostic {
  readonly severity: 'error' | 'warn';
}

export interface ResolvedLintConfig {
  diagnostics: ReadonlyMap<string, ResolvedDiagnosticPolicy>;
}

export interface ResolvedDiagnosticPolicy {
  severity: LintSeverity;
  options?: Readonly<Record<string, unknown>>;
}

interface DiagnosticPolicyContext {
  filePath?: string;
  language: 'css' | 'less' | 'scss' | 'jess';
  config: ResolvedLintConfig;
}

function applyDiagnosticPolicy(
  diagnostics: readonly NeutralDiagnostic[],
  context: DiagnosticPolicyContext
): readonly LintDiagnostic[];
```

The exported API should avoid exposing LSP types or policy internals. Public
formatters can expose the final `LintDiagnostic[]`, plus convenience
`errors`/`warnings` arrays converted to the existing Jess diagnostic shape after
policy severity has been applied. The conversion must be lossless enough for the
CLI renderer and language-service adapter to recover code, phase, span, message,
reason, and final severity.

## 7. Diagnostic phase

Add a `lint` phase to the core diagnostic `Phase` union before exposing final
lint APIs. Lint diagnostics should use codes like:

- `lint/empty-rules`
- `lint/unknown-property`
- `lint/duplicate-property`
- `lint/no-unresolved-variable`
- `lint/no-unused-binding`
- `lint/unsupported-sass-form`

Do not reuse `parse`, `resolve`, `eval`, or `plugin` phases for diagnostics
whose source is language/compiler diagnostic analysis rather than compiler
execution behavior. Those phases already mean compiler behavior. A distinct
`lint` phase lets formatters, editor adapters, and config treat policy
diagnostics differently.

`@jesscss/lint` must not rewrite compiler or parser diagnostic codes into lint
codes. It may include, suppress, or change severity for diagnostics according to
policy. The detector that creates a diagnostic owns its code and phase.

This is a public type change, so implementation must include API extractor
updates and public API tests.

Existing language-service codes must be migrated deliberately:

| existing code | target code | migration |
| --- | --- | --- |
| `lint/empty-rules` | keep | no change |
| `lint/unknown-property` | keep | no change |
| `lint/unknown-at-rule` | keep | no change |
| `lint/duplicate-property` | keep | no change |
| `lint/hex-color-length` | keep | no change |
| `lint/zero-units` | keep | no change |
| `unsupported/sass-form` | `lint/unsupported-sass-form` | keep an editor alias for one alpha or document a breaking settings migration |
| `var/undefined` | `lint/no-unresolved-variable` | keep an editor alias for one alpha or document a breaking settings migration |
| `mixin/undefined` | `lint/no-unresolved-mixin` | keep an editor alias for one alpha or document a breaking settings migration |

## 8. Diagnostic source and policy model

The lint package composes diagnostic sources and applies policy. It does not
define an independent detection language. The initial diagnostic sources are:

### 8.1 Tolerant CST and CSS metadata lane

Runs on parseman CST documents and should keep producing diagnostics on partial
or invalid source. This lane is owned by the reusable language diagnostics core
from §4.3 and covers editor-style syntactic and CSS metadata rules:

- empty rulesets;
- unknown CSS properties;
- unknown CSS at-rules;
- invalid custom property names;
- invalid custom property values once the language-service metadata can express
  those constraints;
- duplicate properties in one declaration block;
- hex color convention;
- zero length units;
- parsed-but-unsupported Sass forms.

The current language-service `cst-lint.ts` is the starting point, but the shared
engine must remain reusable by the language service. It should report offsets
and parser-captured line/column coordinates on diagnostic paths, then let
adapters convert to compact CLI lines, legacy Jess frames, or LSP ranges.
CSS/custom-data metadata stays with the language diagnostics layer; parser/core
packages do not grow policy tables.

Extraction must replace LSP return types with neutral diagnostics. It must also
classify text access deliberately:

- acceptable: bounded inspection of a CST leaf's already-recognized token text
  for value details that the grammar intentionally leaves opaque;
- unacceptable: regex or text scanning that discovers syntax structure, imports,
  variables, mixins, interpolation, or declaration boundaries that the parser or
  compiler already owns.

### 8.2 Semantic AST lane

Runs only when Jess can build the canonical AST/import graph in collection mode.
This source owns diagnostics that need real Jess semantics:

- unresolved variables/functions/mixins;
- unused variables, mixins, functions, and imports;
- unreachable or no-op Less extend targets;
- deprecated compatibility features;
- strict-mode policy hints that are not hard compiler errors yet;
- import graph cycles or duplicate imports when compile mode tolerates them.

Semantic diagnostics must not reparse source or scrape serialized CSS. They
should be emitted by compiler-owned analysis/fact collection over the same
parser/compiler facts that render uses.

When a semantic diagnostic ships through `@jesscss/lint`, the IDE must consume
the same detector through compiler analysis or diagnostics-core. Existing editor
heuristics for the same condition, such as undefined variable or mixin scans,
must be deleted, replaced, or explicitly kept only as a documented fallback for
files where compiler analysis is unavailable.

### 8.3 Combining sources and applying policy

For each file:

1. Run the tolerant language diagnostics source first.
2. Run compiler analysis diagnostics if `collectFactsForFile()` or
   `collectFactsForSource()` succeeds in collection mode.
3. Include parse diagnostics from the compiler result unless the caller disables
   syntax reporting.
4. De-duplicate diagnostics by `(code, filePath, line, column, endLine,
   endColumn, message)`.
5. Apply `LintConfig` policy after diagnostics have been collected.

If parse fails, `jess lint` still reports tolerant CST findings plus parse
diagnostics. It should not report semantic guesses.

## 9. Config design

Extend `StylesConfig` with a top-level `lint` key. This is distinct from
`LessOptions.lint?: boolean`, which remains a Less compatibility compile option
under `language.less`.

```ts
export interface StylesConfig {
  lint?: LintConfig;
}

export interface LintConfig {
  extends?: Array<'recommended' | 'strict' | 'less-compat' | string>;
  files?: string | string[];
  ignoreFiles?: string | string[];
  reportSyntax?: boolean;
  diagnostics?: Record<
    string,
    LintSeverity | [LintSeverity, Record<string, unknown>]
  >;
}
```

`styles.config.*` remains the one Jess config file family. Do not introduce
`.jesslintrc` in the first pass.

Config precedence:

1. built-in preset defaults;
2. `styles.config.*` compile/language/input/output options for parser/compiler
   behavior;
3. `styles.config.*` top-level lint config for diagnostic policy;
4. `stylesConfig` and `lintConfig` passed directly to the API;
5. CLI flags.

All `files` and `ignoreFiles` patterns are relative to the loaded config file's
directory. If no config file is loaded, they are relative to `cwd`.

Presets:

- `recommended`: high-confidence diagnostics with low false-positive risk;
- `strict`: forward-looking Jess style and compatibility warnings;
- `less-compat`: Less migration diagnostics, including deprecated or unsupported
  Less behavior.

The old `LessOptions.lint?: boolean` means "parse and report errors without
output" for Less compatibility. Do not overload it into the new diagnostic
policy model.
CLI compatibility may map `less lint`-like behavior to `jess lint --syntax-only`
later, but the `lint` config key is separate.

## 10. CLI design

Extend `jess` as:

```text
jess <input> [output] [-o outdir]
jess lint <files...> [--config path] [--format string|json]
          [--max-warnings n] [--quiet] [--syntax-only]
```

Exit codes:

- `0`: no lint errors and warning count is within `--max-warnings`;
- `1`: lint errors, parse errors, or warning count over max;
- `2`: CLI/config/runtime usage failure.

Output:

- default string output should reuse the existing Jess diagnostic renderer where
  possible;
- JSON output returns `LintRunResult`;
- `--quiet` suppresses warnings in terminal output but does not remove them from
  JSON.

The CLI must dispatch before command-specific parsing:

1. inspect `process.argv.slice(2)` for `lint` as the first positional;
2. if present, parse with lint-specific options such as `--format`;
3. otherwise, parse with the existing compile options.

Preserve existing compile forms:

- `jess input.less`;
- `jess input.less output.css`;
- `jess input.less -o dist`.

Add tests for `jess lint --help`, unknown lint options, existing compile forms,
and `jess lint file.less --format json`.

## 11. Fixing

Autofix is not part of the first public implementation. Do not export `fix`,
`fixedSource`, `meta.fixable`, or `jess lint --fix` until at least one real fix
ships. If a hidden prototype needs a flag, it must exit `2` in the public CLI
with "not supported yet".

When fixes land:

- fixes must operate on source spans, not rendered CSS;
- one file's fixes must be composed and conflict-checked before writing;
- parse errors disable unsafe fixes for that file unless a diagnostic source
  explicitly marks the fix as tolerant-safe;
- fixes must be deterministic and idempotent.

## 12. Stylelint-guided migration package

Native lint should ship first. After that, consider a parallel migration package
for users coming from Stylelint. The package should use Stylelint as a feature
catalog and config reference, not as the runtime detector.

Possible scope:

1. `@jesscss/stylelint-migration`: reads Stylelint config and reports a migration
   plan to Jess diagnostic policy.
2. `@jesscss/lint-stylelint-preset`: exposes Jess lint presets whose names map
   to familiar Stylelint bundles where behavior is genuinely equivalent.
3. Documentation tables that group common Stylelint rules as:
   "native equivalent", "planned native diagnostic", "not applicable to Jess",
   or "unsupported because it requires a PostCSS-specific tree contract".

This package must be honest about gaps. It should never silently approximate a
Stylelint rule with a Jess diagnostic that sees different source semantics.
If an actual Stylelint runtime integration is requested later, design it as a
separate product with its own review; do not let that path back into native
`@jesscss/lint`.

## 13. Implementation phases

### Phase 0: Design and review

- Land this spec.
- Run adversarial review.
- Fold in review findings.
- Formalize the `@jesscss/css-parser` PostCSS oracle design from §3.1 before
  using Stylelint migration coverage as a prioritization signal.

### Phase 1: Package skeleton and parse diagnostics

- Extract shared default compiler stack below `jess` and `@jesscss/lint`, or
  land another one-implementation dependency shape that avoids cycles and drift.
- Add compiler-owned `collectFactsForFile()` / `collectFactsForSource()` /
  `prepareForAnalysis()` design stubs or implementation sufficient to prove
  semantic lint will not need context spelunking.
- Extract the non-LSP diagnostics-core boundary from §4.3. It may start with
  current CST diagnostics and metadata lookups, but it must be consumed by the
  language service as well as lint.
- Add `packages/lint`.
- Export `lintText` and `lintFiles`.
- Load `styles.config.*`.
- Route by file extension using the existing config extension map.
- Return parse diagnostics using existing safe compiler/parser results.
- Wire `jess lint <file>` with string and JSON output.
- Add `@jesscss/lint`, diagnostics-core, and any shared default-stack package to
  release allowlists if they are publishable runtime dependencies.
- Tests: package API, CLI command dispatch, config loading, syntax-error output,
  package exports, language-service adapter parity for at least one shared
  diagnostic, and packed consumer import/CLI smoke tests.

### Phase 2: Share tolerant CST lint with the IDE

- Move reusable logic from `packages/editor/language-service/src/cst-lint.ts`
  into the shared diagnostics boundary from §4.3, or expose it there without
  leaking LSP types.
- Update language service and `@jesscss/lint` to consume that shared boundary.
- Add an explicit regression check that a newly added shared lint diagnostic is
  visible through both the CLI/API and the language-service adapter.
- Preserve existing language-service lint tests.
- Add CLI/API tests for the shared diagnostics.

### Phase 3: Semantic diagnostics

- Add compiler-owned semantic diagnostics from analysis facts.
- Expose unresolved/unused binding diagnostics first.
- Add extend/deprecation diagnostics after the fact model is stable.
- Update the language service to consume the same semantic detectors. Delete or
  replace existing editor-only undefined variable/mixin heuristics for shipped
  shared diagnostics.
- Tests: source spans, imported files, parse-failure behavior, de-duplication,
  and CLI/API/IDE parity for each semantic diagnostic.

### Phase 4: Stylelint-guided migration package, if demand exists

- Prototype a separate migration package that maps Stylelint config/rule names
  to native Jess diagnostic policy where possible.
- Keep it optional and documented as migration help, not native detection and
  not a Stylelint adapter.

## 14. Verification

Minimum gates for Phase 1 must start from dependency-order built artifacts. Use
`pnpm run build:release` where practical. If using narrower local gates, show
resolved package path/version evidence and build in this order before trusting
tests:

```sh
pnpm --filter @jesscss/parser-shared build
pnpm --filter @jesscss/css-parser build
pnpm --filter @jesscss/css-parser oracle:postcss
pnpm --filter @jesscss/less-parser build
pnpm --filter @jesscss/scss-parser build
pnpm --filter @jesscss/jess-parser build
pnpm --filter @jesscss/core build
pnpm --filter styles-config build
pnpm --filter @jesscss/style-resolver build
pnpm --filter @jesscss/plugin-jess build
pnpm --filter @jesscss/plugin-less build
pnpm --filter @jesscss/plugin-scss build
pnpm --filter @jesscss/plugin-node-modules build
pnpm --filter @jesscss/compiler build
pnpm --filter @jesscss/compiler-preset build
pnpm --filter @jesscss/diagnostics-core build
pnpm --filter @jesscss/lint build
pnpm --filter @jesscss/lint test
pnpm --filter @jesscss/language-service build
pnpm --filter @jesscss/language-service test
pnpm --filter jess build
pnpm --filter jess test -- cli.test.ts --run --globals
pnpm run verify:package-exports
pnpm run verify:jess-api
pnpm run verify:alpha:packed-consumer
```

When `Phase` or public diagnostics change, also run:

```sh
pnpm --filter @jesscss/core build
pnpm --filter @jesscss/compiler build
pnpm --filter jess build
pnpm run verify:types
```

Before claiming an implementation complete, use the repo's dependency-order
release build or `pnpm run build:release` rather than trusting stale `lib/`
artifacts.

## 14.1 Current tracking items

Current as of July 30, 2026:

- Landed: `@jesscss/diagnostics-core`, `@jesscss/lint`, `jess lint`, compact
  line diagnostics, JSON output, Stylelint comparison harnesses, PostCSS parser
  oracles, and line-tracked diagnostic CST parser entrypoints.
- Wire `@jesscss/language-service` to consume diagnostics-core for every stable
  shared diagnostic, then keep a CLI/API/IDE parity test with each new shared
  detector.
- Expand the stable Stylelint-comparable rule set only where Jess has native
  parser, CST, AST, compiler, or metadata facts. Match high-value Stylelint rule
  names when behavior is equivalent, but do not promise Stylelint's full option
  surface.
- Add compiler-owned semantic analysis facts before unresolved symbol, unused
  binding, import graph, or extend diagnostics. Lint should consume those facts,
  not inspect compiler internals or rendered CSS.
- Improve CSS lint performance by targeting diagnostic CST parse/build object
  cost. Current `packages/jess/benchmark/benchmark.css` evidence on Node
  `v25.9.0`, Stylelint `17.14.1`, and the matched 195-finding rule set:
  Jess lint median `19.55 ms/op`; Stylelint median `12.00 ms/op`; normal CSS
  CST parse median `8.85 ms/op`; line-tracked CSS CST parse median
  `10.60 ms/op`; diagnostics walk median `3.70 ms/op`.
- Keep parser line tracking opt-in. Normal parser entrypoints must not regress
  when diagnostics, linting, or language services do not request coordinates.
- Defer custom formatting, custom rule authoring, and autofix until the source
  span contract and conflict-safe edit composition story are stable.

## 15. Open questions

1. Should `lintFiles` own glob expansion/cache, or should the CLI own globs and
   keep the library file-list based?
2. What is the exact split between `collectFactsForFile()`,
   `collectFactsForSource()`, and any lower-level `prepareForAnalysis()` API,
   and should it be public or workspace-internal for the alpha?
3. Should parse diagnostics be a default part of `jess lint`, or should users
   opt into syntax reporting with `--syntax`?
4. Should `@jesscss/lint` be public in the first alpha, or private until the API
   survives CLI and language-service use?
5. Which existing language-service lint codes are public enough to preserve
   exactly?
6. Should the reusable diagnostics boundary be named
   `@jesscss/diagnostics-core` or `@jesscss/language-core`?
7. What exact facts should the CSS parser PostCSS oracle compare first: parse
   success only, normalized structural facts, source spans, or all of those with
   named baselines?

## 16. Adversarial review findings

Review completed in this worktree. Findings folded in:

- P0: lint had no safe route to the batteries-included Jess plugin stack without
  importing `jess`, creating a cycle, or duplicating behavior. The spec now
  requires a shared default compiler-stack package or equivalent one-owner
  implementation below both `jess` and lint.
- P0: import graph promises were too close to `style-resolver`'s tolerant regex
  extraction. The spec now forbids `extractImports()` for product lint facts and
  requires parser/compiler-owned typed import facts.
- P0: semantic lint was specified before the compiler exposed stable analysis
  facts. The spec now adds prerequisite file/source-specific analysis APIs.
- P1: `LintOptions.config` could not carry compile/language options. The spec
  now separates `stylesConfig` and `lintConfig`.
- P1: CLI parsing must dispatch before option parsing. The spec now requires
  command-specific parsing and tests.
- P1: verification needed dependency-order build evidence. The spec now lists
  the dependency-order gate and packed-consumer coverage.
- P1: diagnostic code migration was not explicit. The spec now includes a code
  migration table and editor alias requirement.
- P2: public rule authoring and autofix were premature. The spec now forbids a
  public rule/plugin API for v1 and removes public fix surface until fixes exist.
- User correction: Stylelint is a feature guide and migration reference, not a
  Jess adapter target. The spec now describes a parallel migration package that
  maps Stylelint expectations to native Jess diagnostic policy without using
  Stylelint or PostCSS as the native detector.
- User correction: test `@jesscss/css-parser` against PostCSS. The spec now
  adds a PostCSS oracle for plain CSS parser compatibility, with named
  acceptance/failure baselines and no authority over Jess/Less/SCSS semantics.
- User correction: CSS validity diagnostics are language-service metadata, and
  lint improvements should improve the IDE. The spec now requires a shared
  non-LSP diagnostics boundary consumed by both the language service and
  `@jesscss/lint`.
- Second adversarial review, P0: a
  `@jesscss/language-service/diagnostics` subpath would still drag LSP/server
  dependencies into CLI installs and risks future cycles. The spec now requires
  an extracted diagnostics-core package below lint and the language service.
- Second adversarial review, P0: semantic diagnostics could still diverge
  between CLI and IDE. The spec now requires each shipped semantic diagnostic to
  be consumed by the language service and to delete, replace, or document
  fallback-only editor heuristics for the same condition.
- Second adversarial review, P1: severity remapping did not fit the current
  separate Jess error/warning shapes. The spec now introduces a neutral
  diagnostic record with detector-owned default severity and policy-owned final
  severity.
- Second adversarial review, P1: the policy example accidentally exported a
  public extension point. The spec now marks the policy machinery as
  non-exported/internal.
- Second adversarial review, P1: lint could quietly become a parser-routing
  host. The spec now forbids direct parser-package dependencies for CST/CSS
  metadata diagnostics and assigns tolerant parser routing to diagnostics-core.
- Second adversarial review, P1: extraction from `cst-lint.ts` needed guidance
  on text inspection. The spec now distinguishes bounded CST-leaf inspection
  from forbidden source scraping.
- Second adversarial review, P1/P2: verification and analysis API shape were
  underspecified. The spec now adds language-service build/test/parity gates and
  splits file/source fact collection APIs.
