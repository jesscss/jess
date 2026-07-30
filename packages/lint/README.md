# @jesscss/lint

Jess-native stylesheet linting for CSS, Less, SCSS, and Jess.

`@jesscss/lint` is the policy and reporting layer for Jess diagnostics. It does
not invent a second detector stack: syntax errors, CSS validity checks, dialect
support warnings, and editor-facing diagnostics come from the shared Jess
diagnostics engine. The lint package decides which diagnostics are shown, what
severity they use, and how they are reported in CLI or tool output.

That makes linting with Jess feel less like bolting a CSS parser onto a
preprocessor and more like asking the stylesheet engine what it already knows.
The same structure that powers parsing and editor tooling can surface in CI.

## Install

```sh
pnpm add -D @jesscss/lint
```

Most projects should use the `jess` package directly and run `jess lint`. Use
`@jesscss/lint` when you are writing a tool, test harness, editor integration, or
custom command around Jess diagnostics.

## API

```ts
import {
  formatStyledLintResult,
  lintFiles,
  lintText
} from '@jesscss/lint'

const text = await lintText({
  source: '.card { colr: red; width: 0px; }',
  filePath: 'card.css'
})

console.log(text.diagnostics.map(diagnostic => diagnostic.code))

const run = await lintFiles(['src/**/*.{css,less,scss,jess}'], {
  maxWarnings: 0
})

console.log(formatStyledLintResult(run, { colors: true }))
process.exitCode = run.errored ? 1 : 0
```

### `lintText(input, options?)`

Lint one in-memory stylesheet.

```ts
const result = await lintText({
  source: '$color: red; .card { color: $color; width: 0px; }',
  filePath: 'card.scss'
})
```

The language is inferred from `filePath`; pass `language: 'css' | 'less' |
'scss' | 'jess'` when the filename is synthetic.

### `lintFiles(patterns, options?)`

Lint files from glob patterns. If `patterns` is empty, Jess uses `lint.files`
from `styles.config.js`; if that is also absent, it scans
`**/*.{css,less,scss,jess}`.

```ts
await lintFiles([], {
  cwd: process.cwd(),
  maxWarnings: 0
})
```

### Formatting

`formatStyledLintResult(result)` prints compact per-file diagnostic rows with
codes and line/column positions. Pass `{ colors: false }` for stable plain text
in tests.

`formatLintResult(result)` is the plain-text formatter kept for simple output
callers.

## Configuration

Jess reads lint configuration from the `lint` key in `styles.config.js`.

```js
// styles.config.js
export default {
  lint: {
    files: ['src/**/*.{css,less,scss,jess}'],
    ignoreFiles: ['dist/**'],
    reportSyntax: true,
    rules: {
      'property-no-unknown': 'error',
      'length-zero-no-unit': 'warn',
      'jess/unsupported-sass-form': 'warn'
    }
  }
}
```

Severity values are `off`, `warn`, and `error`; `null` also disables a rule.
Jess uses Stylelint rule names where the rule intent is familiar and
Jess-native names for Jess-only diagnostics.

## Stable Rules

The current stable rule set is intentionally small and migration-friendly:

| Rule name | Jess diagnostic code | Stylelint comparison |
| --- | --- | --- |
| `block-no-empty` | `lint/empty-rules` | `block-no-empty` |
| `property-no-unknown` | `lint/unknown-property` | near `property-no-unknown` |
| `at-rule-no-unknown` | `lint/unknown-at-rule` | near `at-rule-no-unknown` |
| `declaration-block-no-duplicate-properties` | `lint/duplicate-property` | `declaration-block-no-duplicate-properties` |
| `color-no-invalid-hex` | `lint/hex-color-length` | `color-no-invalid-hex` |
| `length-zero-no-unit` | `lint/zero-units` | `length-zero-no-unit` |
| `custom-property-no-missing-var-function` | `lint/custom-property-no-missing-var-function` | `custom-property-no-missing-var-function` |
| `keyframe-block-no-duplicate-selectors` | `lint/keyframe-block-no-duplicate-selectors` | `keyframe-block-no-duplicate-selectors` |
| `keyframe-declaration-no-important` | `lint/keyframe-declaration-no-important` | `keyframe-declaration-no-important` |
| `font-family-no-duplicate-names` | `lint/font-family-no-duplicate-names` | near `font-family-no-duplicate-names` |
| `font-family-no-missing-generic-family-keyword` | `lint/font-family-no-missing-generic-family-keyword` | near `font-family-no-missing-generic-family-keyword` |
| `no-invalid-position-at-import-rule` | `lint/no-invalid-position-at-import-rule` | `no-invalid-position-at-import-rule` |
| `no-duplicate-at-import-rules` | `lint/no-duplicate-at-import-rules` | `no-duplicate-at-import-rules` |
| `no-duplicate-selectors` | `lint/no-duplicate-selectors` | near `no-duplicate-selectors` |
| `unit-no-unknown` | `lint/unit-no-unknown` | near `unit-no-unknown` |
| `function-no-unknown` | `lint/function-no-unknown` | near `function-no-unknown` |
| `media-feature-name-no-unknown` | `lint/media-feature-name-no-unknown` | near `media-feature-name-no-unknown` |
| `media-feature-name-value-no-unknown` | `lint/media-feature-name-value-no-unknown` | near `media-feature-name-value-no-unknown` |
| `selector-pseudo-class-no-unknown` | `lint/selector-pseudo-class-no-unknown` | near `selector-pseudo-class-no-unknown` |
| `selector-pseudo-element-no-unknown` | `lint/selector-pseudo-element-no-unknown` | near `selector-pseudo-element-no-unknown` |
| `selector-type-no-unknown` | `lint/selector-type-no-unknown` | near `selector-type-no-unknown` |
| `jess/no-incompatible-math-function-units` | `lint/incompatible-math-function-units` | Jess value diagnostic |
| `jess/unsupported-sass-form` | `unsupported/sass-form` | Jess dialect support diagnostic |

Use `STABLE_LINT_RULES`, `recommendedLintRules()`, or
`stylelintComparisonRules()` when building migration reports. The older
diagnostic-code helpers remain available for tools that already consume Jess
diagnostic codes.

Parser syntax failures are not lint rules. `jess lint` can surface them as
diagnostics when `reportSyntax` is enabled, but they are controlled separately
from rule preferences.

## Stylelint Comparison

Stylelint is still the broad ecosystem linter. It has more than 100 built-in
rules, plugins, shareable configs, autofix, cache behavior, custom syntaxes, and
custom formatters. Jess lint does not try to clone that surface in its first
stable rule set.

Jess lint is strongest where the linter needs Jess's own understanding of the
source:

- `.less`, `.scss`, `.jess`, and modern CSS parsed by the same parser family
  used by Jess tooling.
- Diagnostics that can be shared with the language service instead of
  reimplemented as CLI-only checks.
- CSS metadata checks that know about dialect variables, interpolation, custom
  properties, vendor prefixes, and Jess support boundaries.
- Source diagnostics that run before rendering, so they point at the authored
  stylesheet rather than a PostCSS approximation or emitted CSS.

Use this split as the migration rule:

| Need | Use |
| --- | --- |
| Existing broad CSS convention policy | Stylelint |
| Jess/Less/SCSS support diagnostics | Jess lint |
| Compile/editor parity for syntax and source semantics | Jess lint |
| Autofix for large style-policy configs | Stylelint today |
| CI warning budgets for Jess diagnostics | `jess lint --max-warnings 0` |
| Comparing a small stable rule subset | `STYLELINT_COMPARISON_LINT_CONFIG` |

Jess provides `STYLELINT_COMPARISON_LINT_CONFIG` only for apples-to-apples
checks against rules that have a close native diagnostic. It intentionally
excludes syntax diagnostics, Jess-only support diagnostics, and stable rules
whose useful Jess behavior intentionally differs from Stylelint edge cases.

The local comparison harness is opt-in:

```sh
pnpm --filter @jesscss/lint bench:stylelint
```

The harness times the same source through Jess lint's Stylelint-comparable
diagnostics and through Stylelint configured with the comparable rule subset.
It is a measurement and migration aid, not a product dependency.

## Diagnostics Model

Problem detection belongs below this package, in `@jesscss/diagnostics-core`
and the parser/compiler/language-service facts it consumes. `@jesscss/lint`
applies policy:

- enable or disable rules by name;
- map default severities to `warn` or `error`;
- choose file globs and ignore globs;
- render compact text or JSON;
- decide the process exit status.

That boundary is what lets a new shared diagnostic improve both `jess lint` and
the editor experience. If a check only exists in the CLI, it belongs lower in
the diagnostics stack before it becomes a stable lint rule.

## Priorities

The near-term priority is diagnostic quality:

1. Detect important authored-source problems with Jess parser and language facts.
2. Share those diagnostics between CLI linting and the language service.
3. Keep the rule codes, severities, and source spans stable enough for CI.
4. Expand Stylelint-comparable coverage where Jess can report the same problem
   natively.

Formatting polish, custom formatter compatibility, and autofix should come
after that. Autofix in particular needs a stable source-span contract and
conflict-safe edit composition before `jess lint --fix` exists.

## Why Jess Lint?

- One parser family for CSS, Less, SCSS, and Jess.
- Diagnostics are shared with editor tooling rather than reimplemented for the
  CLI.
- Dialect-aware checks can distinguish CSS custom properties, Less variables,
  SCSS variables, interpolation, and vendor-prefixed names.
- Lint policy stays separate from problem detection, so teams can tune severity
  without losing the underlying language facts.

## Line Coordinates

Compile-facing parser entrypoints stay offset-only unless a diagnostic/editor
caller asks for line information. Linting is one of the paths where line and
column coordinates are useful, so Jess treats line tracking as an opt-in
diagnostic concern rather than a default parser cost.

## License

MIT
