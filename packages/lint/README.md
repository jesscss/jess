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

console.log(text.diagnostics.map(diagnostic => [diagnostic.ruleName, diagnostic.code]))

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

Pass `metadata` when a tool has project CSS data that should participate in
shared diagnostics, such as design-system properties, custom at-rules, or known
project values:

```ts
await lintText(
  {
    source: '@tokens base; .card { project-tone: brand; }',
    filePath: 'card.css'
  },
  {
    metadata: {
      isKnownAtRule: name => name === 'tokens',
      isKnownProperty: name => name === 'project-tone',
      isKnownPropertyValue: (name, value) =>
        name === 'project-tone' && value.normalized === 'brand'
    }
  }
)
```

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
lint rule names and line/column positions. Structured diagnostics also keep the
shared Jess diagnostic `code`. Pass `{ colors: false }` for stable plain text in
tests.

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
      'block-no-empty': ['warn', { include: ['mixins'] }],
      'property-no-unknown': 'error',
      'declaration-property-value-no-unknown': 'warn',
      'declaration-block-no-duplicate-properties': ['warn', { ignore: ['consecutive-duplicates'] }],
      'at-rule-descriptor-value-no-unknown': 'warn',
      'no-unknown-custom-properties': 'warn',
      'length-zero-no-unit': 'warn',
      'function-linear-gradient-no-nonstandard-direction': 'warn',
      'font-face-no-missing-required-properties': 'warn',
      'property-ignored-due-to-display': 'warn',
      'vendor-prefix': 'warn',
      'compatible-vendor-prefixes': 'off',
      'unknown-vendor-specific-properties': 'off',
      'value-no-vendor-prefix': 'off',
      'selector-class-pattern': ['off', { pattern: '^[a-z][a-z0-9-]*$' }],
      'custom-property-pattern': ['off', { pattern: '^--[a-z][a-z0-9-]*$' }],
      'keyframes-name-pattern': ['off', { pattern: '^[a-z][a-z0-9-]*$' }],
      'color-function-notation': ['off', { notation: 'modern' }],
      'alpha-value-notation': ['off', { notation: 'percentage' }],
      'hue-degree-notation': ['off', { notation: 'angle' }],
      'box-model': 'off',
      'float': 'off',
      'color-function-no-invalid-arguments': 'error',
      'jess/no-invalid-typed-custom-property-registration': 'warn',
      'jess/no-invalid-typed-custom-property-value': 'warn',
      'jess/no-shadowed-token': 'off',
      'jess/no-unused-variable': 'off',
      'jess/no-unused-mixin': 'off',
      'jess/no-unused-function': 'off',
      'jess/no-leaky-scope-dependence': 'warn',
      'jess/no-ambiguous-mixin-call': 'warn',
      'jess/no-impossible-guard': 'warn',
      'jess/no-unused-default-branch': 'warn',
      'jess/no-duplicate-module-load': 'warn',
      'jess/no-unbounded-extend': 'warn',
      'jess/no-dead-extend': 'warn',
      'jess/no-suspicious-map-key-access': 'warn',
      'jess/unsupported-sass-form': 'warn'
    },
    diagnostics: {
      'var/undefined': 'warn',
      'mixin/undefined': 'warn',
      'call/unknown-named-argument': 'error'
    }
  }
}
```

Severity values are `off`, `warn`, and `error`; `null` also disables a rule.
Rules can also use a Stylelint-like tuple, `['warn', { ...options }]`, when a
rule supports secondary options. Jess uses Stylelint rule names where the rule
intent is familiar and Jess-native names for Jess-only diagnostics.

Every stable lint rule has two identifiers: a public `lint.rules` key and a
shared Jess diagnostic `code`. Jess uses Stylelint rule names when that helps
migration, while JSON output preserves both `ruleName` and `code`.
`stylelint-near` is comparison metadata only, not a third name: the lint rule
name and diagnostic code stay stable, but detection may intentionally be a
Jess-native or VSCode-data-backed subset.

Compiler-style diagnostics are configured by diagnostic code under
`lint.diagnostics`. They are not lint rules and do not appear in
`STABLE_LINT_RULES` unless Jess intentionally adds a lint rule alias for them,
but `jess lint` can report them in the same compact and JSON outputs.
`SEMANTIC_CODES` exports the current shared semantic diagnostic codes. The
initial semantic set includes same-file undefined variables, same-file
Less/SCSS/Jess undefined mixin calls, and simple Less unknown named arguments.

`block-no-empty` warns on empty rulesets by default. Add
`['warn', { include: ['mixins'] }]` when empty Less, SCSS, or Jess mixin bodies
should also be reported; they stay quiet by default because empty mixins can be
intentional API placeholders.

Naming convention rules such as `selector-class-pattern`,
`custom-property-pattern`, and `keyframes-name-pattern` are opt-in and require a
secondary `pattern` option. Jess uses that regex against the authored static
name and reports only names that do not match.

Notation convention rules such as `color-function-notation`,
`alpha-value-notation`, and `hue-degree-notation` are also opt-in and require a
secondary `notation` option. The rule names match Stylelint for migration
familiarity, while detection uses Jess's shared CSS diagnostics and currently
covers a static authored-source subset.

## Stable Rules

The current stable rule set is intentionally small and migration-friendly:

| Rule name | Jess diagnostic code | Comparison metadata |
| --- | --- | --- |
| `block-no-empty` | `lint/empty-rules` | `block-no-empty` |
| `property-no-unknown` | `lint/unknown-property` | near `property-no-unknown` |
| `property-no-deprecated` | `lint/property-no-deprecated` | near `property-no-deprecated` |
| `declaration-property-value-no-unknown` | `lint/unknown-property-value` | near `declaration-property-value-no-unknown` |
| `at-rule-no-unknown` | `lint/unknown-at-rule` | near `at-rule-no-unknown` |
| `at-rule-descriptor-no-unknown` | `lint/at-rule-descriptor-no-unknown` | near `at-rule-descriptor-no-unknown` |
| `at-rule-descriptor-value-no-unknown` | `lint/at-rule-descriptor-value-no-unknown` | near `at-rule-descriptor-value-no-unknown`, VSCode descriptor data subset |
| `declaration-block-no-duplicate-properties` | `lint/duplicate-property` | `declaration-block-no-duplicate-properties` |
| `declaration-block-no-shorthand-property-overrides` | `lint/declaration-block-no-shorthand-property-overrides` | near `declaration-block-no-shorthand-property-overrides` |
| `declaration-block-no-duplicate-custom-properties` | `lint/declaration-block-no-duplicate-custom-properties` | `declaration-block-no-duplicate-custom-properties` |
| `color-no-invalid-hex` | `lint/hex-color-length` | `color-no-invalid-hex` |
| `length-zero-no-unit` | `lint/zero-units` | `length-zero-no-unit` |
| `custom-property-no-missing-var-function` | `lint/custom-property-no-missing-var-function` | `custom-property-no-missing-var-function` |
| `no-unknown-custom-properties` | `lint/no-unknown-custom-properties` | near `no-unknown-custom-properties` |
| `custom-property-pattern` | `lint/custom-property-pattern` | near `custom-property-pattern`, opt-in |
| `keyframe-block-no-duplicate-selectors` | `lint/keyframe-block-no-duplicate-selectors` | `keyframe-block-no-duplicate-selectors` |
| `keyframe-declaration-no-important` | `lint/keyframe-declaration-no-important` | `keyframe-declaration-no-important` |
| `keyframes-name-pattern` | `lint/keyframes-name-pattern` | near `keyframes-name-pattern`, opt-in |
| `declaration-no-important` | `lint/declaration-no-important` | near `declaration-no-important` |
| `named-grid-areas-no-invalid` | `lint/named-grid-areas-no-invalid` | `named-grid-areas-no-invalid` |
| `font-family-no-duplicate-names` | `lint/font-family-no-duplicate-names` | near `font-family-no-duplicate-names` |
| `font-family-no-missing-generic-family-keyword` | `lint/font-family-no-missing-generic-family-keyword` | near `font-family-no-missing-generic-family-keyword` |
| `font-face-no-missing-required-properties` | `lint/font-face-missing-required-properties` | VSCode `fontFaceProperties` parity |
| `property-ignored-due-to-display` | `lint/property-ignored-due-to-display` | VSCode `propertyIgnoredDueToDisplay` parity |
| `box-model` | `lint/box-model` | VSCode `boxModel` parity, opt-in |
| `float` | `lint/float` | VSCode `float` parity, opt-in |
| `property-no-vendor-prefix` | `lint/property-no-vendor-prefix` | near `property-no-vendor-prefix`, opt-in |
| `at-rule-no-vendor-prefix` | `lint/at-rule-no-vendor-prefix` | near `at-rule-no-vendor-prefix`, opt-in |
| `value-no-vendor-prefix` | `lint/value-no-vendor-prefix` | near `value-no-vendor-prefix`, opt-in |
| `vendor-prefix` | `lint/vendor-prefix` | VSCode `vendorPrefix` parity |
| `compatible-vendor-prefixes` | `lint/compatible-vendor-prefixes` | VSCode `compatibleVendorPrefixes` parity, opt-in |
| `unknown-vendor-specific-properties` | `lint/unknown-vendor-specific-property` | VSCode `unknownVendorSpecificProperties` parity, opt-in |
| `import-statement` | `lint/import-statement` | VSCode `importStatement` parity, opt-in |
| `no-invalid-position-at-import-rule` | `lint/no-invalid-position-at-import-rule` | `no-invalid-position-at-import-rule` |
| `no-duplicate-at-import-rules` | `lint/no-duplicate-at-import-rules` | `no-duplicate-at-import-rules` |
| `no-unknown-animations` | `lint/no-unknown-animations` | near `no-unknown-animations` |
| `no-duplicate-selectors` | `lint/no-duplicate-selectors` | near `no-duplicate-selectors` |
| `unit-no-unknown` | `lint/unit-no-unknown` | near `unit-no-unknown` |
| `function-no-unknown` | `lint/function-no-unknown` | near `function-no-unknown` |
| `function-linear-gradient-no-nonstandard-direction` | `lint/function-linear-gradient-no-nonstandard-direction` | `function-linear-gradient-no-nonstandard-direction` |
| `color-function-notation` | `lint/color-function-notation` | near `color-function-notation`, opt-in |
| `alpha-value-notation` | `lint/alpha-value-notation` | near `alpha-value-notation`, opt-in |
| `hue-degree-notation` | `lint/hue-degree-notation` | near `hue-degree-notation`, opt-in |
| `media-feature-name-no-unknown` | `lint/media-feature-name-no-unknown` | near `media-feature-name-no-unknown` |
| `media-feature-name-no-vendor-prefix` | `lint/media-feature-name-no-vendor-prefix` | near `media-feature-name-no-vendor-prefix`, opt-in |
| `media-feature-name-value-no-unknown` | `lint/media-feature-name-value-no-unknown` | near `media-feature-name-value-no-unknown` |
| `selector-pseudo-class-no-unknown` | `lint/selector-pseudo-class-no-unknown` | near `selector-pseudo-class-no-unknown` |
| `selector-pseudo-element-no-unknown` | `lint/selector-pseudo-element-no-unknown` | near `selector-pseudo-element-no-unknown` |
| `selector-no-vendor-prefix` | `lint/selector-no-vendor-prefix` | near `selector-no-vendor-prefix`, opt-in |
| `selector-class-pattern` | `lint/selector-class-pattern` | near `selector-class-pattern`, opt-in |
| `selector-anb-no-unmatchable` | `lint/selector-anb-no-unmatchable` | `selector-anb-no-unmatchable` |
| `selector-type-no-unknown` | `lint/selector-type-no-unknown` | near `selector-type-no-unknown` |
| `selector-max-id` | `lint/selector-max-id` | near `selector-max-id`, opt-in |
| `selector-max-universal` | `lint/selector-max-universal` | near `selector-max-universal`, opt-in |
| `jess/no-incompatible-math-function-units` | `lint/incompatible-math-function-units` | Jess value diagnostic |
| `color-function-no-invalid-arguments` | `lint/invalid-color-function-channels` | VSCode `argumentsInColorFunction` parity |
| `jess/no-invalid-typed-custom-property-registration` | `lint/invalid-typed-custom-property-registration` | Jess CSS validity diagnostic |
| `jess/no-invalid-typed-custom-property-value` | `lint/invalid-typed-custom-property-value` | Jess value diagnostic |
| `jess/no-shadowed-token` | `lint/no-shadowed-token` | Jess same-file symbol diagnostic, opt-in |
| `jess/no-unused-variable` | `lint/no-unused-variable` | Jess same-file symbol diagnostic, opt-in |
| `jess/no-unused-mixin` | `lint/no-unused-mixin` | Jess same-file callable diagnostic, opt-in |
| `jess/no-unused-function` | `lint/no-unused-function` | Jess same-file callable diagnostic, opt-in |
| `jess/no-leaky-scope-dependence` | `lint/no-leaky-scope-dependence` | Jess Less migration diagnostic |
| `jess/no-ambiguous-mixin-call` | `lint/no-ambiguous-mixin-call` | Jess same-file Less callable diagnostic |
| `jess/no-impossible-guard` | `lint/no-impossible-guard` | Jess static guard diagnostic |
| `jess/no-unused-default-branch` | `lint/no-unused-default-branch` | Jess Less default-branch diagnostic |
| `jess/no-duplicate-module-load` | `lint/no-duplicate-module-load` | Jess same-file module diagnostic |
| `jess/no-unbounded-extend` | `lint/no-unbounded-extend` | Jess static extend target diagnostic |
| `jess/no-dead-extend` | `lint/no-dead-extend` | Jess exact same-file extend diagnostic |
| `jess/no-suspicious-map-key-access` | `lint/no-suspicious-map-key-access` | Jess same-file map/key diagnostic |
| `jess/unsupported-sass-form` | `unsupported/sass-form` | Jess dialect support diagnostic |

Use `STABLE_LINT_RULES`, `recommendedLintRules()`, or
`stylelintComparisonRules()` when building migration reports. Each
`STABLE_LINT_RULES` entry exposes both `ruleName` and `diagnosticCode`; the
diagnostic-code helpers remain available for tools that already consume Jess
diagnostic codes.

The rule name is the user-facing configuration key and the compact lint output
label. The diagnostic code is the shared problem identity used by
diagnostics-core, the language service, JSON output, and compatibility aliases.
JSON diagnostics include both `ruleName` and `code` for stable tool migration.
Comparison labels such as "near Stylelint" or "VSCode parity" are status
metadata only: they do not rename a rule or diagnostic, and they only decide
which checks belong in matched Stylelint comparison runs.

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
- CSS metadata checks from VSCode web custom data that know about properties,
  descriptors, simple static values, dialect variables, interpolation, custom
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
