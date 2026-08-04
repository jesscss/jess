# Jess lint roadmap

Status: current architecture plus roadmap. `@jesscss/lint`,
`@jesscss/diagnostics-core`, `@jesscss/compiler-preset`, `jess lint`, compact
diagnostic output, JSON output, named rule config, PostCSS parser oracles,
Stylelint comparison harnesses, and opt-in line-tracked diagnostic CST
entrypoints are landed on `origin/dev`.

This is the single tracking doc for Jess stylesheet diagnostics. It replaces
the older `docs/design/JESS-LINT-PACKAGE-SPEC.md` design spec and the local
`lint-roadmap.md` draft.

## Goal

Jess diagnostics should first target parity with VSCode's stylesheet language
service for CSS/Less/SCSS author feedback, then use Stylelint as the migration
and naming guide for CLI lint users. Jess lint should expose the problems Jess
already understands, not grow a second detector stack. The lint package owns
policy and presentation:

- which diagnostics are enabled;
- whether each diagnostic is a warning or error;
- which files are included or ignored;
- text and JSON output;
- CLI exit policy such as `--max-warnings`.

Problem detection belongs below lint: parsers, diagnostics-core, compiler facts,
resolver facts, and the language service. A diagnostic that appears in
`jess lint` should also be usable by the editor unless it is purely CLI policy,
such as "no files matched".

Normal parse, eval, and render paths must not pay for diagnostics. Diagnostic
CST entrypoints may opt into line tracking and metadata checks; ordinary parser
and compiler entrypoints should remain offset-only and diagnostics-free unless a
caller explicitly asks for diagnostics.

## Editor message categories

Jess should cover the same kinds of stylesheet author messages that Microsoft's
CSS/Less/SCSS extension surfaces, while allowing richer TypeScript-style
presentation for hovers and completions:

| Message family | Jess direction |
| --- | --- |
| CSS symbol information | Use `@vscode/web-custom-data` for properties, at-rules, descriptors, pseudos, functions, media features, browser notes, and syntax summaries. |
| Validity diagnostics | Share diagnostics-core checks for unknown/deprecated properties, values, at-rules, descriptors, units, functions, pseudos, media features, color arguments, selectors, and typed custom properties. |
| Browser/compatibility advice | Surface VSCode-equivalent vendor prefix, compatible prefix, unknown vendor property, `@import`, box-model, float, ID/universal selector, display/property interaction, and IE-hack message families through shared diagnostics where the parser exposes the authored shape. |
| Project CSS data | Accept VSCode-style `validProperties` as a lightweight unknown-property escape hatch, and prefer custom data providers for richer property, descriptor, value, hover, and completion metadata. |
| Document navigation | Keep CST-owned symbols, definitions, references, document highlights, folding, selection ranges, and links in the language service. |
| Authoring help | Prefer TypeScript-like rich completion and hover details: concise labels, typed/syntax detail, Markdown docs, examples where useful, color swatches, selector specificity, and Jess symbol definitions. |

Microsoft parity is a coverage floor, not a UX ceiling. If a VSCode message is
weakly formatted, Jess should keep the same diagnostic category but present it
with clearer wording, better metadata, and richer editor affordances.

## Current packages and commands

| Surface | Current role |
| --- | --- |
| `@jesscss/diagnostics-core` | Shared, LSP-free source diagnostics over diagnostic CST plus CSS metadata. |
| `@jesscss/lint` | Public API, rule policy, file globs, JSON and compact terminal formatting. |
| `@jesscss/compiler-preset` | Shared default plugin stack below both `jess` and lint. |
| `jess lint` | CLI wrapper around `@jesscss/lint`. |
| `styles.config.*` | Owns `lint.files`, `lint.ignoreFiles`, `lint.reportSyntax`, and `lint.rules`. |

Compile and lint are separate commands:

```sh
jess input.less output.css
jess lint "src/**/*.{css,less,scss,jess}" --max-warnings 0
jess lint src/card.scss --format json
```

## Current rule baseline

`packages/lint/src/rules.ts` exposes these stable rule names. Rule names follow
Stylelint when the behavior is close enough to be familiar; Jess-only checks use
a `jess/` prefix. Every entry in `STABLE_LINT_RULES` carries both public names:
the `ruleName` is the user-facing `lint.rules` key, while the `diagnosticCode`
is the shared identity used by diagnostics-core, the language service, JSON
output, and compatibility aliases. Lint JSON carries both names when a
diagnostic maps to a stable lint rule.

Comparison status is separate metadata, not a third public name.
`stylelint-equivalent`,
`stylelint-near`, `vscode-equivalent`, and `jess-only` describe evidence and
benchmark eligibility; they never replace either name. A `stylelint-near` rule
still has a stable lint rule name and a stable diagnostic code, but its detector
may intentionally be a VSCode-data-backed or Jess-native subset and can stay out
of matched benchmark mode until its behavior is comparable enough.

| Rule | Diagnostic code | Comparison metadata |
| --- | --- | --- |
| `block-no-empty` | `lint/empty-rules` | Stylelint-equivalent |
| `property-no-unknown` | `lint/unknown-property` | Stylelint-near |
| `property-no-deprecated` | `lint/property-no-deprecated` | Stylelint-near |
| `declaration-property-value-no-unknown` | `lint/unknown-property-value` | Stylelint-near |
| `at-rule-no-unknown` | `lint/unknown-at-rule` | Stylelint-near |
| `at-rule-descriptor-no-unknown` | `lint/at-rule-descriptor-no-unknown` | Stylelint-near |
| `at-rule-descriptor-value-no-unknown` | `lint/at-rule-descriptor-value-no-unknown` | Stylelint-near |
| `declaration-block-no-duplicate-properties` | `lint/duplicate-property` | Stylelint-equivalent |
| `declaration-block-no-shorthand-property-overrides` | `lint/declaration-block-no-shorthand-property-overrides` | Stylelint-near |
| `declaration-block-no-duplicate-custom-properties` | `lint/declaration-block-no-duplicate-custom-properties` | Stylelint-equivalent |
| `color-no-invalid-hex` | `lint/hex-color-length` | Stylelint-equivalent |
| `length-zero-no-unit` | `lint/zero-units` | Stylelint-equivalent |
| `custom-property-no-missing-var-function` | `lint/custom-property-no-missing-var-function` | Stylelint-equivalent |
| `no-unknown-custom-properties` | `lint/no-unknown-custom-properties` | Stylelint-near |
| `custom-property-pattern` | `lint/custom-property-pattern` | Stylelint-near, opt-in |
| `keyframe-block-no-duplicate-selectors` | `lint/keyframe-block-no-duplicate-selectors` | Stylelint-equivalent |
| `keyframe-declaration-no-important` | `lint/keyframe-declaration-no-important` | Stylelint-equivalent |
| `keyframes-name-pattern` | `lint/keyframes-name-pattern` | Stylelint-near, opt-in |
| `declaration-no-important` | `lint/declaration-no-important` | Stylelint-near |
| `named-grid-areas-no-invalid` | `lint/named-grid-areas-no-invalid` | Stylelint-equivalent |
| `font-family-no-duplicate-names` | `lint/font-family-no-duplicate-names` | Stylelint-near |
| `font-family-no-missing-generic-family-keyword` | `lint/font-family-no-missing-generic-family-keyword` | Stylelint-near |
| `font-face-no-missing-required-properties` | `lint/font-face-missing-required-properties` | VSCode-equivalent |
| `property-ignored-due-to-display` | `lint/property-ignored-due-to-display` | VSCode-equivalent |
| `box-model` | `lint/box-model` | VSCode-equivalent, opt-in |
| `float` | `lint/float` | VSCode-equivalent, opt-in |
| `property-no-vendor-prefix` | `lint/property-no-vendor-prefix` | Stylelint-near, opt-in |
| `at-rule-no-vendor-prefix` | `lint/at-rule-no-vendor-prefix` | Stylelint-near, opt-in |
| `value-no-vendor-prefix` | `lint/value-no-vendor-prefix` | Stylelint-near, opt-in |
| `vendor-prefix` | `lint/vendor-prefix` | VSCode-equivalent |
| `compatible-vendor-prefixes` | `lint/compatible-vendor-prefixes` | VSCode-equivalent, opt-in |
| `unknown-vendor-specific-properties` | `lint/unknown-vendor-specific-property` | VSCode-equivalent, opt-in |
| `ie-hack` | `lint/ie-hack` | VSCode-equivalent, opt-in |
| `import-statement` | `lint/import-statement` | VSCode-equivalent, opt-in |
| `no-invalid-position-at-import-rule` | `lint/no-invalid-position-at-import-rule` | Stylelint-equivalent |
| `no-duplicate-at-import-rules` | `lint/no-duplicate-at-import-rules` | Stylelint-equivalent |
| `no-unknown-animations` | `lint/no-unknown-animations` | Stylelint-near |
| `no-duplicate-selectors` | `lint/no-duplicate-selectors` | Stylelint-near |
| `unit-no-unknown` | `lint/unit-no-unknown` | Stylelint-near |
| `function-no-unknown` | `lint/function-no-unknown` | Stylelint-near |
| `function-linear-gradient-no-nonstandard-direction` | `lint/function-linear-gradient-no-nonstandard-direction` | Stylelint-equivalent |
| `color-function-notation` | `lint/color-function-notation` | Stylelint-near, opt-in |
| `alpha-value-notation` | `lint/alpha-value-notation` | Stylelint-near, opt-in |
| `hue-degree-notation` | `lint/hue-degree-notation` | Stylelint-near, opt-in |
| `media-feature-name-no-unknown` | `lint/media-feature-name-no-unknown` | Stylelint-near |
| `media-feature-name-no-vendor-prefix` | `lint/media-feature-name-no-vendor-prefix` | Stylelint-near, opt-in |
| `media-feature-name-value-no-unknown` | `lint/media-feature-name-value-no-unknown` | Stylelint-near |
| `selector-pseudo-class-no-unknown` | `lint/selector-pseudo-class-no-unknown` | Stylelint-near |
| `selector-pseudo-element-no-unknown` | `lint/selector-pseudo-element-no-unknown` | Stylelint-near |
| `selector-no-vendor-prefix` | `lint/selector-no-vendor-prefix` | Stylelint-near, opt-in |
| `selector-class-pattern` | `lint/selector-class-pattern` | Stylelint-near, opt-in |
| `selector-anb-no-unmatchable` | `lint/selector-anb-no-unmatchable` | Stylelint-equivalent |
| `selector-type-no-unknown` | `lint/selector-type-no-unknown` | Stylelint-near |
| `selector-max-id` | `lint/selector-max-id` | Stylelint-near, opt-in |
| `selector-max-universal` | `lint/selector-max-universal` | Stylelint-near, opt-in |
| `selector-max-specificity` | `lint/selector-max-specificity` | Stylelint-near, opt-in |
| `no-descending-specificity` | `lint/no-descending-specificity` | Stylelint-near, opt-in |
| `jess/no-incompatible-math-function-units` | `lint/incompatible-math-function-units` | Jess-only value diagnostic |
| `color-function-no-invalid-arguments` | `lint/invalid-color-function-channels` | VSCode-equivalent |
| `jess/no-invalid-typed-custom-property-registration` | `lint/invalid-typed-custom-property-registration` | Jess-only CSS validity diagnostic |
| `jess/no-invalid-typed-custom-property-value` | `lint/invalid-typed-custom-property-value` | Jess-only value diagnostic |
| `jess/no-shadowed-token` | `lint/no-shadowed-token` | Jess-only symbol diagnostic, opt-in |
| `jess/no-unused-variable` | `lint/no-unused-variable` | Jess-only symbol diagnostic, opt-in |
| `jess/no-unused-mixin` | `lint/no-unused-mixin` | Jess-only callable diagnostic, opt-in |
| `jess/no-unused-function` | `lint/no-unused-function` | Jess-only callable diagnostic, opt-in |
| `jess/no-impossible-guard` | `lint/no-impossible-guard` | Jess-only static guard diagnostic |
| `jess/no-unused-default-branch` | `lint/no-unused-default-branch` | Jess-only Less default-branch diagnostic |
| `jess/no-duplicate-module-load` | `lint/no-duplicate-module-load` | Jess-only module diagnostic |
| `jess/no-unbounded-extend` | `lint/no-unbounded-extend` | Jess-only selector diagnostic |
| `jess/no-dead-extend` | `lint/no-dead-extend` | Jess-only selector diagnostic |
| `jess/no-suspicious-map-key-access` | `lint/no-suspicious-map-key-access` | Jess-only value diagnostic |
| `jess/unsupported-sass-form` | `unsupported/sass-form` | Jess-only support diagnostic |

Syntax failures are not lint rules. `jess lint` can surface parser/compiler
diagnostics when `reportSyntax` is enabled, but those diagnostics keep their
parser/compiler codes and are configured separately from lint rule preferences.

## Diagnostic ownership

`jess lint` can present parser errors, compiler errors, compatibility warnings,
and lint rules in one report. That does not mean they all live in lint.

| Owner | Examples | Config surface | User intuition |
| --- | --- | --- | --- |
| Parser/source validity | Unclosed blocks, malformed strings, invalid grammar forms | Dialect/parser options | Always an error. |
| Config and module resolution | Missing import, disallowed load path, module cycle | `styles.config` and resolver options | The project cannot be understood. |
| Compiler/evaluator semantics | Definite unresolved variable, no matching mixin/function, unknown named argument | Compile options and language semantics, surfaced through `lint.diagnostics` by diagnostic code | The source does not compile. |
| Compatibility diagnostics | Parsed SCSS migration forms, Less leakage patterns | Dialect/migration/strictness options | This may compile differently than expected. |
| Conditional compatibility lint | Less leakage patterns when leakage is enabled | Compile option plus rule config | This compiles only because compatibility mode permits it. |
| Lint rules | Empty blocks, duplicate selectors, naming patterns, broad extends, unused variables, project style contracts | `lint.rules` | Team preference or maintainability warning. |

Compiler-owned problems should keep compiler-style codes even when reported by
the lint CLI or language service. Lint may suppress, include, or remap severity;
it should not rebrand compiler failures as optional style rules.

## Shared diagnostics path

Diagnostics-core routes CSS, Less, SCSS, and Jess through diagnostic CST parser
entrypoints compiled from the same grammar factories with `hostMode: 'cst'` and
line tracking enabled. Normal AST/CST parser entrypoints remain offset-only.

The diagnostics package is consumed by `@jesscss/lint` and
`@jesscss/language-service`; it is not imported by core parse/eval/render
packages. Keep that dependency boundary intact when adding diagnostics.
Tooling hosts may pass `CssDiagnosticMetadata` into `@jesscss/lint` when
project CSS data should suppress or refine unknown-property, unknown-value,
unknown-at-rule, descriptor, and descriptor-value diagnostics. The language
service's `setDataProviders` bridge uses the same metadata route so custom CSS
data improves completions, hovers, lint diagnostics, and IDE diagnostics
together.

The hot diagnostic record is neutral and LSP-free: code, severity, message,
source offsets, and parser-captured line/column coordinates. The lint CLI turns
that into compact per-file lines. The language service should adapt the same
records to LSP ranges. Legacy Jess frame diagnostics are presentation objects
and should stay opt-in.

Language-service defaults should surface the same shared diagnostics as
`@jesscss/lint` recommended policy unless a rule is explicitly opt-in. Opt-in
rules still need shared detection and editor configuration support; they should
not become IDE noise by accident. The language service accepts severity
configuration by shared diagnostic code and by stable lint rule-name aliases.
Public lint configuration keys are rule names, and diagnostics-core exposes the
alias table so editor settings can use the same migration-friendly names without
depending on lint's CLI package.

## Stylelint story

Stylelint is the broad ecosystem CSS linter. It has more than 100 built-in
rules, plugins, shareable configs, custom syntaxes, autofix, cache behavior, and
custom formatters. Jess should not clone that whole surface.

Jess should use Stylelint as a feature guide and migration reference:

- choose high-value rules with native Jess facts;
- use Stylelint rule names for migration-familiar lint configuration when the
  intent is recognizable;
- keep Jess diagnostic codes as the shared problem identity for diagnostics-core
  and the language service;
- document equivalence, near matches, and VSCode-data-backed subsets honestly;
- do not depend on Stylelint, PostCSS, rendered CSS, or a Jess-to-PostCSS
  adapter for native detection.

The local comparison harness is opt-in:

```sh
pnpm --filter @jesscss/lint bench:stylelint
```

Current CSS benchmark evidence on `packages/jess/benchmark/benchmark.css`
using Node `v25.9.0`, Stylelint `17.14.1`, and the matched 251-finding
comparison config:

| Path | Median |
| --- | --- |
| Jess lint comparison config | `23.96 ms/op` |
| Stylelint comparable rules | `26.25 ms/op` |

The current optimization target is diagnostic CST parse/build object cost, not
the lint walk.

`no-duplicate-selectors` is stable and recommended, but it is not part of the
matched comparison config yet: Stylelint skips selectors containing `//` as
non-standard syntax, while Jess treats valid CSS attribute selectors such as
`a[href^="http://"]` as duplicate-selector candidates.

## Stylelint parity backlog

Prioritize rules that are useful before full semantic facts exist and that Jess
can detect over authored source.

| Priority | Stylelint rule family | Jess rule name | Notes |
| --- | --- | --- | --- |
| P0 | Unknown CSS | existing `property-no-unknown`, `at-rule-no-unknown` | Keep metadata current and dialect-aware. |
| Landed | Deprecated properties | `property-no-deprecated` | Flags CSS properties marked obsolete or deprecated in VSCode web custom data; nonstandard and vendor-prefixed properties stay out of this rule. |
| Landed | Property values | `declaration-property-value-no-unknown` | Flags definite unknown simple CSS property values from VSCode web custom data values and restrictions, including simple comma-list members; compound, dynamic, and dialect values stay unknown until richer value facts exist. |
| Landed | Supports declaration conditions | existing `property-no-unknown`, `declaration-property-value-no-unknown` | Reuses the shared CSS property/value metadata checks for static `@supports (property: value)` declaration conditions, while keeping `@media` feature diagnostics separate in nested query contexts. |
| Landed | Duplicates | existing `declaration-block-no-duplicate-properties` | `ignore: ["consecutive-duplicates"]` landed through Stylelint-like rule options; shorthand override coverage is tracked by the dedicated shorthand row. |
| Landed | Empty blocks | `block-no-empty` | Flags empty rulesets by default; empty Less/SCSS/Jess mixin bodies use the same shared diagnostic code with a `mixin-body` qualifier and surface only with `include: ["mixins"]`. Empty mixins can be API placeholders. |
| Landed | Custom properties | `custom-property-no-missing-var-function`, `no-unknown-custom-properties` | Flags `color: --x` and same-file unknown `var(--x)` references; reference files and import graph facts remain future work. |
| Landed | Invalid positioning | `no-invalid-position-at-import-rule` | CSS `@import` placement after style rules or blocking at-rules. Jess `@-import` is separate. |
| Landed | Duplicate imports | `no-duplicate-at-import-rules` | Flags repeated same-file imports with the same target/options/conditions; import-graph duplicate modules remain Jess-only semantic work. |
| Landed | Unknown animations | `no-unknown-animations` | Flags definite CSS animation names without same-file `@keyframes`; imported reference roots and dialect animation facts remain semantic-facts work. |
| Landed | Duplicate custom properties | `declaration-block-no-duplicate-custom-properties` | Flags repeated custom property declarations in one parsed block with exact name matching. |
| Landed | Shorthand overrides | `declaration-block-no-shorthand-property-overrides` | Flags common CSS shorthands that override earlier longhands in the same parsed block; the static table covers physical, logical, layout, text, transition, animation, border, and font shorthand families. |
| Landed | Duplicate selectors | `no-duplicate-selectors` | CSS selector-list duplicates are CST-owned: duplicate entries inside one list and duplicate whole lists among sibling rules. Dialect nested resolution still needs selector facts. |
| Landed | Keyframes | `keyframe-block-no-duplicate-selectors`, `keyframe-declaration-no-important` | Duplicate selector and `!important` checks are CST-owned. |
| Landed | Important declarations | `declaration-no-important` | Flags CSS `!important` declarations outside keyframes; keyframes use the dedicated keyframe rule to avoid duplicate default diagnostics. |
| Landed | Named grid areas | `named-grid-areas-no-invalid` | Flags empty, ragged, or non-rectangular named grid area strings in CSS `grid`, `grid-template`, and `grid-template-areas` declarations. |
| Landed | Fonts | `font-family-no-duplicate-names`, `font-family-no-missing-generic-family-keyword`, `font-face-no-missing-required-properties` | Checks definite `font-family` values and CSS `@font-face` blocks missing `font-family`/`src`; dynamic values and dialect-injected descriptors stay unknown. |
| Landed | Display/property interactions | `property-ignored-due-to-display` | Matches VSCode `propertyIgnoredDueToDisplay` for CSS `display: inline-block` with non-`none` `float`, and `display: block` with `vertical-align`; dynamic and dialect values stay unknown until semantic facts exist. |
| Landed | Box model | `box-model` | Opt-in VSCode `boxModel` parity for definite CSS `width`/`height` with non-zero padding or border; `box-sizing` suppresses the rule, and dynamic/dialect values stay unknown until semantic facts exist. |
| Landed | Float layout | `float` | Opt-in VSCode `float` parity for definite CSS `float` declarations whose value is not `none`; dynamic/dialect values stay unknown until semantic facts exist. |
| Landed | Vendor prefixes | `vendor-prefix` | Matches VSCode `vendorPrefix` for CSS vendor-prefixed declarations and keyframe at-rules whose standard form is missing. |
| Landed | Vendor-prefix style policy | `property-no-vendor-prefix`, `at-rule-no-vendor-prefix`, `value-no-vendor-prefix` | Opt-in Stylelint-named lint rules backed by Jess diagnostic codes for authored CSS vendor-prefixed property names, keyframe at-rules, and removable value keywords/functions; distinct from recommended VSCode `vendor-prefix` missing-standard diagnostics. |
| Landed | Compatible vendor prefixes | `compatible-vendor-prefixes` | Opt-in VSCode `compatibleVendorPrefixes` parity for CSS declarations and keyframe at-rules that use one known vendor-prefixed form but omit other known vendor-prefixed siblings. |
| Landed | Unknown vendor-specific properties | `unknown-vendor-specific-properties` | Opt-in VSCode `unknownVendorSpecificProperties` parity for CSS single-hyphen prefixed declarations whose full property name is not known; `lint.validProperties` and language-service `diagnostics.validProperties` can whitelist project properties for unknown-property checks. |
| Landed | Import statement warning | `import-statement` | Opt-in VSCode `importStatement` parity for CSS `@import` rules that may block parallel stylesheet loading. |
| Landed | Selector pseudos | `selector-pseudo-class-no-unknown`, `selector-pseudo-element-no-unknown` | Uses CSS metadata and suppresses custom, vendor, and dialect pseudos. |
| Landed | Selector vendor prefixes | `selector-no-vendor-prefix` | Opt-in Stylelint-named lint rule backed by `lint/selector-no-vendor-prefix` for authored CSS vendor-prefixed pseudo-class and pseudo-element selectors. |
| Landed | Selector validity | `selector-type-no-unknown`, `selector-anb-no-unmatchable` | Flags unknown CSS type selectors from HTML, SVG, and MathML metadata, plus nth-selector An+B expressions that can never match; custom elements and dialect selectors are skipped until rule options and selector facts exist. |
| Landed | Selector policy | `selector-max-id`, `selector-max-universal`, `selector-max-specificity` | Opt-in VSCode `idSelector` and `universalSelector` parity plus Stylelint-named specificity policy. Specificity accepts `max` or `maxSpecificity` in `a,b,c` form and reports static CSS selector branches, including structural selector arguments for `:is()`, `:not()`, `:has()`, `:where()`, and `:nth-* of ...`. |
| Landed | Selector ordering | `no-descending-specificity` | Opt-in Stylelint-named rule for static CSS selector branches that target the same final compound selector in one parent context. Nested dialect selector resolution remains future selector-facts work. |
| Landed | Naming conventions | `selector-class-pattern`, `custom-property-pattern`, `keyframes-name-pattern` | Opt-in Stylelint-named lint rules backed by static authored name diagnostics. CLI and language-service configuration require a secondary `pattern` option; matching names are suppressed by policy. |
| Landed | CSS functions | `function-no-unknown` | Flags unknown CSS declaration functions with `css-functions-list`; dialect callable checks wait for semantic facts. |
| Landed | Gradient directions | `function-linear-gradient-no-nonstandard-direction` | Flags old side-or-corner direction syntax and unitless numeric directions in CSS `linear-gradient()` / `repeating-linear-gradient()` calls. |
| Landed | Media feature names and values | `media-feature-name-no-unknown`, `media-feature-name-value-no-unknown` | Flags unknown CSS `@media` feature names and definite invalid static values; dialect media facts remain future work. |
| Landed | Media feature vendor prefixes | `media-feature-name-no-vendor-prefix` | Opt-in Stylelint-named lint rule backed by `lint/media-feature-name-no-vendor-prefix` for authored CSS vendor-prefixed `@media` feature names. |
| Landed | At-rule descriptors | `at-rule-descriptor-no-unknown` | Flags unknown descriptors in parsed CSS descriptor blocks, including `@page` page-context and margin-box descriptors. |
| Landed | At-rule descriptor values | `at-rule-descriptor-value-no-unknown` | Flags definite invalid descriptor values in parsed CSS descriptor blocks; covers special `@property` `syntax` checks plus simple static descriptor values from VSCode web custom data such as `@font-face font-style` and `@counter-style system`. |
| Landed | Color function arguments | `color-function-no-invalid-arguments` | Matches VSCode `argumentsInColorFunction` for definite rgb()/rgba()/hsl()/hsla() channel arity/type errors; dynamic, nested, and dialect value facts remain future work. |
| Landed | Typed custom properties | `jess/no-invalid-typed-custom-property-registration`, `jess/no-invalid-typed-custom-property-value` | Flags CSS `@property` rules missing required `syntax`/`inherits` descriptors, missing `initial-value` for non-universal syntax, and definite `initial-value` mismatches for simple syntax descriptors; full CSS value-definition syntax and dialect value facts remain future work. |
| Landed | Browser legacy hacks | `ie-hack` | Opt-in VSCode `ieHack` parity for CSS underscore-prefixed declarations whose stripped property is known. Current tolerant CST does not expose `*property` as a declaration; do not add a source scan or parser change just for that form. |
| Landed | Modern notations | `color-function-notation`, `alpha-value-notation`, `hue-degree-notation` | Opt-in Stylelint-named convention rules for static color function notation, alpha values, and HSL hue units. CLI and language-service configuration require a secondary `notation` option; comparison remains Stylelint-near until the option surface is broader. |
| P3 | Formatting/stylistic legacy | Deprecated Stylelint stylistic rules | Do not chase whitespace rules before formatter/autofix work. |

## Semantic facts layer

The missing shared layer is dry semantic analysis:

```ts
interface SemanticFacts {
  symbols: SymbolFacts;
  values: ValueFacts;
  callables: CallableFacts;
  css: CssFacts;
  modules: ModuleFacts;
}
```

The fact builder should parse once, resolve imports when configured, and
evaluate only the parts needed for diagnostics. It must not render CSS, write
output, or depend on output order unless a diagnostic explicitly needs final CSS
order. With a complete `styles.config` and import graph, dry semantic analysis
should agree with the real compiler about hard errors.

### Compiler diagnostics surfaced by lint

These are not lint preferences, but they should be reported by `jess lint` and
the language service because they are often the most useful author feedback.

| Diagnostic | Owner | Notes |
| --- | --- | --- |
| Definite unresolved variable | Future evaluator | Requires evaluated project/module scope facts before reporting. CST-only same-file declarations are not enough because imports, modules, plugins, guards, and ambient definitions can change resolution. |
| Missing import or module cycle | Resolver/compiler | Report the path and config context. |
| Undefined mixin/function | Future evaluator | Same ownership as symbol resolution; requires evaluated callable facts before reporting. |
| No matching mixin/function overload | Future evaluator | Requires evaluated ambient/project callable facts before reporting. Static same-file CST facts are not enough because Less, Sass, and Jess can add callables through imports, modules, guards, plugins, and evaluation. |
| Unknown named argument | Future evaluator | Same ownership as call resolution; needs the evaluated candidate set and signature model before reporting. |
| Less scope leakage | Future evaluator | Needs actual Less/Jess evaluation and scope facts. CST can identify suspicious shapes, but it cannot prove whether a read depends on leakage. |
| Private member access | Compiler later | Language rule, not style preference. |
| Readonly assignment | Compiler later | Language rule, not style preference. |
| Unsupported SCSS runtime form | Compatibility/compiler | Current lint can report it; long-term owner is dialect support policy. |

### Jess-only lint ideas

These are what make Jess lint valuable even in projects that already run
Stylelint.

| Rule | Default | Required facts | What it catches |
| --- | --- | --- | --- |
| `jess/no-unused-variable` | off, then warn when project facts land | Symbol refs | Initial opt-in same-file variable check landed and suppresses SCSS `!default` configuration variables; full token analysis still needs export/reference/import exceptions. |
| `jess/no-unused-mixin` | off, then warn when project facts land | Callable refs | Initial opt-in same-file Less/SCSS/Jess mixin check landed; suppresses files with imports/modules/plugins and still needs project export/reference/import facts. |
| `jess/no-unused-function` | off, then warn when project facts land | Callable refs | Initial opt-in same-file SCSS `@function` and Jess yielding function-value check landed; suppresses files with imports/modules/plugins and still needs project export/reference/import facts. |
| `jess/no-shadowed-token` | off | Scope facts | Initial opt-in same-file nested variable shadowing diagnostic landed; imported/exported token shadowing still needs module graph facts. |
| Callable resolution conflicts | future | Evaluator-backed callable facts | A call resolves to an actually conflicting overload set after imports, guards, plugins, and ambient definitions are known. Ordinary Less/Jess overloads are valid and must not be reported merely because multiple definitions match. |
| Less scope leakage | future | Evaluator-backed scope/effect facts | Less patterns that actually depend on mixin or detached-ruleset variable leakage after evaluation. CST-only suspicion is not enough. |
| `jess/no-mixin-output-mismatch` | off | Call signatures | A mixin used as declarations emits nested rules, or a value callable emits declarations. |
| `jess/no-unsafe-reference-compose` | warn | Module facts | Extending or reading through a protected boundary that cannot surface output. |
| `jess/no-impossible-guard` | warn | Static guard facts now; semantic facts later | Initial Less/SCSS/Jess diagnostic flags literal false/null, same-unit numeric comparisons, keyword/string equality, and boolean not/and/or guard compositions that are definitely false; variables, `default()`, type predicates, and dynamic values stay unknown. |
| `jess/no-unused-default-branch` | warn | Less CST now; callable facts later | Initial Less diagnostic flags one contradictory guard-branch subset: a single AND branch containing both bare `default()` and `not(default())`. Full Less default-branch selection still needs callable facts. |
| `jess/no-duplicate-module-load` | warn | Module refs now; import graph/config later | Initial same-file static SCSS/Jess duplicate directive check landed; same resolved file through multiple specifiers still needs module graph facts. |
| `jess/no-unbounded-extend` | warn | Static targets now; selector facts later | Initial Less/SCSS/Jess diagnostic flags static extend targets with no top-level class, id, placeholder, or parent selector anchor; selector graph facts can later catch broad resolved targets more precisely. |
| `jess/no-dead-extend` | warn | Same-file exact targets now; selector graph later | Initial import-free Less/SCSS/Jess diagnostic flags exact static extend targets that match no same-file selector; accessible imported surfaces and partial extend submatching still need selector graph facts. |
| `jess/no-suspicious-map-key-access` | warn | Same-file map-like declarations now; value facts later | Initial Less/SCSS/Jess diagnostic flags numeric bracket or `map-get()` access against same-file map-like variables; real collection/list type facts can later catch reassignment and imported values precisely. |

## Type and value linting

Type linting is the constraint face of the Jess type-system proposal in
[`docs/design/TYPE-SYSTEM-DESIGN.md`](../design/TYPE-SYSTEM-DESIGN.md). Keep the
full type-system design there until it is built; track lint-facing slices here.

The first value diagnostic should be math-function argument compatibility for
`min()`, `max()`, and `clamp()`:

- infer CSS numeric kind: length, angle, time, frequency, resolution,
  percentage, number, flex, or unknown;
- determine whether all args can resolve to a common type;
- preserve unresolved variables/interpolation as unknown instead of guessing;
- report only definite mismatches such as `min(1px, 2s)`.

Status: landed as `jess/no-incompatible-math-function-units` for CSS-authored
bare numeric arguments. It reports definite non-percentage kind mismatches and
leaves dynamic, percentage, nested, or compound math expressions for future
value facts.

Follow-on value/type diagnostics:

| Diagnostic | Likely owner | Notes |
| --- | --- | --- |
| Incompatible units | Compiler or strict lint | Arithmetic and comparisons with impossible unit families. If Jess rejects it, compiler owns it; if Jess can still emit useful CSS, lint owns it. |
| Invalid color channel | CSS validity/compiler | Initial CSS-authored rgb()/rgba()/hsl()/hsla() arity/type checks landed as `color-function-no-invalid-arguments`; broader color functions and semantic value facts remain future work. |
| Invalid typed custom property registration/value | Diagnostics-core/type facts | Initial CSS `@property` descriptor checks landed as `jess/no-invalid-typed-custom-property-registration` for missing required descriptors and `jess/no-invalid-typed-custom-property-value` for simple static syntax/value pairs; future work is full CSS value-definition syntax and Jess constraints. |
| Impossible guard | Lint preference | Initial static CST-backed guard diagnostic landed as `jess/no-impossible-guard`; richer callable/type facts can expand coverage without guessing. |
| Unused default branch | Lint preference | Initial Less contradictory-branch subset landed as `jess/no-unused-default-branch`; full mixin `default()` branch reachability still needs callable facts. |
| Suspicious map key access | Lint preference | Initial same-file Less map, SCSS map, and Jess collection diagnostic landed as `jess/no-suspicious-map-key-access`; richer collection/list value facts remain future work. |

Use TypeScript-adjacent names for callable/type facts:

| Jess concept | Proposed name | Why |
| --- | --- | --- |
| One callable shape for a mixin/function | `CallSignature` | Aligns with TypeScript callable object/type terminology. |
| Signature facts learned from body/defaults/guards | `InferredSignatureFacts` | A `CallSignature` may mix explicit annotations with inferred facts. |
| Literal value or pattern in a callable parameter | `LiteralValueConstraint` | Similar to TypeScript literal types. |
| Several candidate signatures for one callable name | `OverloadSet` | Less/Jess mixins are naturally overloaded by repeated definitions and guards. |
| Later explicit annotations | `SignatureAnnotation` | Avoids prematurely calling annotations "types" when syntax may include constraints, rest args, or CSS grammar fragments. |
| A call site matched to candidates | `SignatureResolution` | Useful for diagnostics and hovers. |

Do not split the public model into "explicit signatures" and "inferred
signatures." `CallSignature` is the normalized callable shape. Individual facts
can record whether they came from an annotation, literal pattern, inference, or
more than one source.

## Future explicit type syntax

Explicit syntax is not public yet. The proposed direction is CSS value
definition syntax, not TypeScript syntax:

```scss
.space(<number> $scale, <keyword> $axis?) { ... }
.tone(<color> $x) { ... }
.stroke([ <color> | none ] $paint) { ... }
```

In callable parameter positions, `<...>` type references can appear directly
before the parameter. Bare or complex value grammars should be wrapped in
`[ ... ]` because keywords and value fragments already have meaning in
mixin/function parameter lists. Inside future `@-types` and `@-constrain`, the
grammar owns the whole right-hand side, so bare keyword and enum grammars do not
need that wrapper.

Custom type names should start with a capital letter:

| Shape | Meaning |
| --- | --- |
| `<length>`, `<color>`, `<custom-ident>` | CSS data types. |
| `<Spacing>`, `<BrandColor>` | Jess custom types. |
| `[ auto ]`, `[ none | solid ]` | Literal keyword grammar in callable parameters. |
| `<length> | auto` | Exactly one alternative. |
| `<length> && <color>` | Both values, in any order. |
| `<length> || <color>` | One or both values, in any order. |
| `<color>?`, `<length>+`, `<length>{2,4}`, `<length>#` | CSS multipliers. |
| `<integer [0,]>`, `<angle [0,180deg]>` | Numeric ranges; omitted endpoint means infinity. |
| `<'border-width'>` | The grammar of a CSS property value. |

## Implementation order

1. Keep rule inventory and config names current as rules land.
2. Wire `@jesscss/language-service` to consume diagnostics-core for every stable
   shared diagnostic.
3. Add one CLI/API/IDE parity test with each new shared diagnostic.
4. Expand Stylelint P1 rules where Jess has native source facts.
5. Expand symbol facts beyond the initial same-file unused variable diagnostic:
   variables, custom properties, mixins, functions, modules, definitions,
   references, exports.
6. Surface compiler diagnostics through lint and LSP without rebranding them as
   style rules.
7. Add preference diagnostics: unused/shadowed symbols, broad/dead extends, and
   duplicate module loads.
8. Add callable facts: `CallSignature` and `OverloadSet` for mixins/functions.
9. Add dry semantic analysis for bounded evaluator-backed facts without CSS
   emission.
10. Add value facts: math function compatibility, unit families, and map key
   access.
11. Defer custom formatting, public custom rule authoring, and autofix until
   source spans and edit composition are stable.

## Non-goals

- Do not implement whitespace lint rules just to match old Stylelint configs.
- Do not add CLI-only checks that the language service cannot share.
- Do not render CSS just to lint authored source.
- Do not turn compiler errors into optional style rules.
- Do not report speculative type errors through interpolation, dynamic imports,
  or unknown function calls. Prefer `unknown` over false positives.
- Do not make explicit type syntax public before parser, evaluator, language
  service, and SCSS compatibility tests exist.

## Verification

Useful focused commands:

```sh
pnpm --filter @jesscss/diagnostics-core test -- --run
pnpm --filter @jesscss/lint test -- --run
pnpm --filter jess test -- cli.test.ts --run
pnpm --filter @jesscss/lint bench:stylelint
pnpm --filter @jesscss/css-parser oracle:postcss
pnpm --filter @jesscss/css-parser bench:postcss
pnpm --filter @jesscss/less-parser oracle:postcss-less
pnpm --filter @jesscss/less-parser bench:postcss-less
pnpm run check:macro
pnpm run build:release
```

Before making performance claims, show the loaded package versions, source file,
warmup/round counts, and named diagnostic sets. Parser line tracking must stay
opt-in: ordinary parser entrypoints should not pay for line/column capture when
diagnostics, linting, or editor features do not ask for it.

## References

- [`packages/lint/README.md`](../../packages/lint/README.md)
- [`packages/lint/src/rules.ts`](../../packages/lint/src/rules.ts)
- [`packages/diagnostics-core/src/tolerant-cst.ts`](../../packages/diagnostics-core/src/tolerant-cst.ts)
- [`docs/design/TYPE-SYSTEM-DESIGN.md`](../design/TYPE-SYSTEM-DESIGN.md)
- MDN: "Value definition syntax"
- CSS Values and Units Module Level 4: "Value Definition Syntax"
- Stylelint docs: `docs/user-guide/rules.md` and `docs/user-guide/configure.md`
- TypeScript handbook: "Call Signatures", "Function Overloads", and
  "Contextual Typing"

## Operation diagnostics — surface the rules `OPERATIONS.md` already settles

**Owner note, 2026-08-01: all four grammars need lint / IDE diagnostics for
incorrect operations.** Not a new detector stack — this is the roadmap's own
principle applied to `docs/design/OPERATIONS.md`, which settles a set of rules
that currently only fail at EVAL time, when they should be visible in the editor
as the author types.

The division is already the standing one
(`memory:parser-accepts-shapes-not-semantics`): the parser accepts SHAPES, and
validity belongs to the language service. Every rule below is a shape the parser
admits and the operations spec calls wrong.

Candidates, each with its spec section:

| diagnostic | rule | severity |
| --- | --- | --- |
| incompatible-unit arithmetic | `1px + 3em` (§4.7) | error under `strict`, warning under `preserve`/`loose` |
| incompatible-unit comparison | `2px > 1em` (§4.7, landed `5c516dbb1`) | as above |
| inexpressible unit | `1 / 2px` — no `px⁻¹` (§4.7) | never silent; warn or throw per mode |
| cross-ground relational | `1px > red` (§4.2) | error — no common ground |
| bare arithmetic outside `$( )` | `1 + 2` in a value slot (P17) | error — already a parse error, so this is a BETTER MESSAGE, not new detection |
| non-Boolean condition | `.jess` `$if` on a non-Bool (§4.4) | error |
| comparison in an `and`/`or` chain without parens | §4.5.4 | error — today it reports at the enclosing rule, which reads as a broken ruleset |

Two things make this worth doing rather than leaving to eval:

- **Several are currently reported at the wrong place.** A guard parse failure
  surfaces at the enclosing rule, not the offending token (§4.5.4), so the author
  sees "broken ruleset" for a missing paren.
- **The mode-dependent ones are invisible by design.** Under `preserve` a unit
  clash emits `calc(…)` and compiles; the warning is the only signal, and a
  warning nobody reads in a build log is worth much more in the editor.

Sequencing: this follows the operations implementation (`OPERATIONS.md` §10), not
precedes it — the rules have to exist in core before lint can surface them, and
the diagnostics should read the SAME predicates rather than reimplementing them,
per the "one set of semantics" ruling.
