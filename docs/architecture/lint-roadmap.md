# Jess lint roadmap

Status: current architecture plus roadmap. `@jesscss/lint`,
`@jesscss/diagnostics-core`, `@jesscss/compiler-preset`, `jess lint`, compact
diagnostic output, JSON output, named rule config, PostCSS parser oracles,
Stylelint comparison harnesses, and opt-in line-tracked diagnostic CST
entrypoints are landed on `origin/dev`.

This is the single tracking doc for Jess linting. It replaces the older
`docs/design/JESS-LINT-PACKAGE-SPEC.md` design spec and the local
`lint-roadmap.md` draft.

## Goal

Jess lint should expose the problems Jess already understands, not grow a second
detector stack. The lint package owns policy and presentation:

- which diagnostics are enabled;
- whether each diagnostic is a warning or error;
- which files are included or ignored;
- text and JSON output;
- CLI exit policy such as `--max-warnings`.

Problem detection belongs below lint: parsers, diagnostics-core, compiler facts,
resolver facts, and the language service. A diagnostic that appears in
`jess lint` should also be usable by the editor unless it is purely CLI policy,
such as "no files matched".

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
a `jess/` prefix.

| Rule | Diagnostic code | Kind |
| --- | --- | --- |
| `block-no-empty` | `lint/empty-rules` | Stylelint-equivalent |
| `property-no-unknown` | `lint/unknown-property` | Stylelint-near |
| `at-rule-no-unknown` | `lint/unknown-at-rule` | Stylelint-near |
| `declaration-block-no-duplicate-properties` | `lint/duplicate-property` | Stylelint-equivalent |
| `color-no-invalid-hex` | `lint/hex-color-length` | Stylelint-equivalent |
| `length-zero-no-unit` | `lint/zero-units` | Stylelint-equivalent |
| `custom-property-no-missing-var-function` | `lint/custom-property-no-missing-var-function` | Stylelint-equivalent |
| `keyframe-block-no-duplicate-selectors` | `lint/keyframe-block-no-duplicate-selectors` | Stylelint-equivalent |
| `keyframe-declaration-no-important` | `lint/keyframe-declaration-no-important` | Stylelint-equivalent |
| `font-family-no-duplicate-names` | `lint/font-family-no-duplicate-names` | Stylelint-near |
| `font-family-no-missing-generic-family-keyword` | `lint/font-family-no-missing-generic-family-keyword` | Stylelint-near |
| `no-duplicate-at-import-rules` | `lint/no-duplicate-at-import-rules` | Stylelint-equivalent |
| `unit-no-unknown` | `lint/unit-no-unknown` | Stylelint-near |
| `function-no-unknown` | `lint/function-no-unknown` | Stylelint-near |
| `media-feature-name-no-unknown` | `lint/media-feature-name-no-unknown` | Stylelint-near |
| `selector-pseudo-class-no-unknown` | `lint/selector-pseudo-class-no-unknown` | Stylelint-near |
| `selector-pseudo-element-no-unknown` | `lint/selector-pseudo-element-no-unknown` | Stylelint-near |
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
| Compiler/evaluator semantics | Definite unresolved variable, no matching mixin/function, unknown named argument | Compile options and language semantics | The source does not compile. |
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

The hot diagnostic record is neutral and LSP-free: code, severity, message,
source offsets, and parser-captured line/column coordinates. The lint CLI turns
that into compact per-file lines. The language service should adapt the same
records to LSP ranges. Legacy Jess frame diagnostics are presentation objects
and should stay opt-in.

## Stylelint story

Stylelint is the broad ecosystem CSS linter. It has more than 100 built-in
rules, plugins, shareable configs, custom syntaxes, autofix, cache behavior, and
custom formatters. Jess should not clone that whole surface.

Jess should use Stylelint as a feature guide and migration reference:

- choose high-value rules with native Jess facts;
- use Stylelint rule names when the behavior is genuinely equivalent;
- document near matches honestly;
- do not depend on Stylelint, PostCSS, rendered CSS, or a Jess-to-PostCSS
  adapter for native detection.

The local comparison harness is opt-in:

```sh
pnpm --filter @jesscss/lint bench:stylelint
```

Current CSS benchmark evidence on `packages/jess/benchmark/benchmark.css`
using Node `v25.9.0`, Stylelint `17.14.1`, and the matched 236-finding rule set:

| Path | Median |
| --- | --- |
| Jess lint stable rules | `21.97 ms/op` |
| Stylelint comparable rules | `21.34 ms/op` |

The current optimization target is diagnostic CST parse/build object cost, not
the lint walk.

## Stylelint parity backlog

Prioritize rules that are useful before full semantic facts exist and that Jess
can detect over authored source.

| Priority | Stylelint rule family | Jess rule name | Notes |
| --- | --- | --- | --- |
| P0 | Unknown CSS | existing `property-no-unknown`, `at-rule-no-unknown` | Keep metadata current and dialect-aware. |
| P0 | Duplicates | existing `declaration-block-no-duplicate-properties` | Add ignore-consecutive and shorthand/longhand awareness. |
| P0 | Empty blocks | existing `block-no-empty` | Extend to empty mixin bodies only when configured. Empty mixins can be API placeholders. |
| Landed | Custom properties | `custom-property-no-missing-var-function` | Flags `color: --x`; suppresses inside custom-property declarations and `var()`. |
| P1 | Invalid positioning | `no-invalid-position-at-import-rule` | CSS `@import` placement. Jess `@-import` is separate. |
| Landed | Duplicate imports | `no-duplicate-at-import-rules` | Flags repeated same-file imports with the same target/options/conditions; import-graph duplicate modules remain Jess-only semantic work. |
| P1 | Duplicate selectors | `no-duplicate-selectors` | Needs selector normalization over the canonical selector AST. |
| Landed | Keyframes | `keyframe-block-no-duplicate-selectors`, `keyframe-declaration-no-important` | Duplicate selector and `!important` checks are CST-owned. |
| Landed | Fonts | `font-family-no-duplicate-names`, `font-family-no-missing-generic-family-keyword` | Checks definite `font-family` values; dynamic values stay unknown. |
| Landed | Selector pseudos | `selector-pseudo-class-no-unknown`, `selector-pseudo-element-no-unknown` | Uses CSS metadata and suppresses custom, vendor, and dialect pseudos. |
| P2 | Selector validity | `selector-type-no-unknown` | Needs element/custom-element metadata and dialect escapes. |
| Landed | Units | `unit-no-unknown` | Flags unknown Dimension units; URL values and resolution `x` contexts are suppressed. |
| Landed | CSS functions | `function-no-unknown` | Flags unknown CSS declaration functions with `css-functions-list`; dialect callable checks wait for semantic facts. |
| Landed | Media feature names | `media-feature-name-no-unknown` | Flags unknown CSS `@media` feature names; dialect media facts and value validation remain future work. |
| P2 | Function/value validity | `media-feature-name-value-no-unknown` | Better once value facts exist. |
| P2 | Modern notations | `color-function-notation`, `alpha-value-notation`, `hue-degree-notation` | Convention rules; likely formatter-adjacent. |
| P2 | Naming conventions | `selector-class-pattern`, `custom-property-pattern`, `keyframes-name-pattern` | Project-policy heavy; opt-in only. |
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
| Definite unresolved variable | Compiler/evaluator | Partial editor analysis may downgrade when imports/config are missing. |
| Missing import or module cycle | Resolver/compiler | Report the path and config context. |
| No matching mixin/function overload | Compiler/evaluator | `CallSignature` and `OverloadSet` facts can improve the message. |
| Unknown named argument | Compiler/evaluator | Same ownership as call resolution. |
| Private member access | Compiler later | Language rule, not style preference. |
| Readonly assignment | Compiler later | Language rule, not style preference. |
| Unsupported SCSS runtime form | Compatibility/compiler | Current lint can report it; long-term owner is dialect support policy. |

### Jess-only lint ideas

These are what make Jess lint valuable even in projects that already run
Stylelint.

| Rule | Default | Required facts | What it catches |
| --- | --- | --- | --- |
| `jess/no-unused-variable` | warn | Symbol refs | Tokens defined but never read, with export/reference/import exceptions. |
| `jess/no-shadowed-token` | off | Scope facts | Local token shadows an imported/exported token unexpectedly. |
| `jess/no-leaky-scope-dependence` | warn when allowed | Scope/effect facts, compile options | Less patterns that depend on mixin/detached-ruleset variable leakage. |
| `jess/no-ambiguous-mixin-call` | warn | Callable facts | A call matches multiple overloads with incompatible bodies or signatures. |
| `jess/no-mixin-output-mismatch` | off | Call signatures | A mixin used as declarations emits nested rules, or a value callable emits declarations. |
| `jess/no-unsafe-reference-compose` | warn | Module facts | Extending or reading through a protected boundary that cannot surface output. |
| `jess/no-duplicate-module-load` | warn | Import graph/config | Same file loaded through multiple specifiers or overload mode unintentionally. |
| `jess/no-unbounded-extend` | warn | Selector facts | Broad `$extend` target likely to match more than intended. |
| `jess/no-dead-extend` | warn | Selector facts | `$extend` target matches no selector in accessible surfaces. |

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

Follow-on value/type diagnostics:

| Diagnostic | Likely owner | Notes |
| --- | --- | --- |
| Incompatible units | Compiler or strict lint | Arithmetic and comparisons with impossible unit families. If Jess rejects it, compiler owns it; if Jess can still emit useful CSS, lint owns it. |
| Invalid color channel | CSS validity/compiler | Definite channel arity/type errors before color output. |
| Invalid typed custom property value | Diagnostics-core/type facts | Validate `@property syntax` and future Jess constraints without guessing through dynamic values. |
| Impossible guard | Lint preference | Guard condition that is statically always false. |
| Unused default branch | Lint preference | Mixin `default()` branch that cannot be selected. |
| Suspicious map key access | Lint preference | Numeric bracket access against a collection when the author likely meant a value key. |

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
5. Add symbol facts: variables, custom properties, mixins, functions, modules,
   definitions, references, exports.
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
