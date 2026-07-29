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
    diagnostics: {
      'lint/unknown-property': 'error',
      'lint/zero-units': 'warn'
    }
  }
}
```

Severity values are `off`, `warn`, and `error`.

## Stable Rules

The current stable rule set is intentionally small and migration-friendly:

| Jess code | Stylelint comparison |
| --- | --- |
| `parse/syntax-error` | Parser error surface |
| `lint/empty-rules` | `block-no-empty` |
| `lint/unknown-property` | near `property-no-unknown` |
| `lint/unknown-at-rule` | near `at-rule-no-unknown` |
| `lint/duplicate-property` | `declaration-block-no-duplicate-properties` |
| `lint/hex-color-length` | `color-no-invalid-hex` |
| `lint/zero-units` | `length-zero-no-unit` |
| `unsupported/sass-form` | Jess dialect support diagnostic |

Use `STABLE_LINT_RULES`, `recommendedLintDiagnostics()`, or
`stylelintComparisonDiagnostics()` when building migration reports.

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
