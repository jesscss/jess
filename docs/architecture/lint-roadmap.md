# Jess lint roadmap

This is the working target for Jess style linting. It covers two tracks:

- **Stylelint parity**: familiar CSS lint rules that make migration easy.
- **Jess-only diagnostics**: checks that need Jess's parser, imports, symbols,
  and semantic facts.

The current stable lint package is intentionally small. `@jesscss/lint` applies
policy to shared diagnostics; problem detection belongs in
`@jesscss/diagnostics-core`, the language service, and the compiler facts they
share. New rules should follow that boundary so `jess lint` and the editor report
the same problem with the same span.

## Current baseline

`packages/lint/src/rules.ts` exposes these stable rule names:

| Rule | Kind |
| --- | --- |
| `block-no-empty` | Stylelint-equivalent |
| `property-no-unknown` | Stylelint-near |
| `at-rule-no-unknown` | Stylelint-near |
| `declaration-block-no-duplicate-properties` | Stylelint-equivalent |
| `color-no-invalid-hex` | Stylelint-equivalent |
| `length-zero-no-unit` | Stylelint-equivalent |
| `jess/unsupported-sass-form` | Jess-only |

Stylelint itself has more than 100 built-in rules, plugin support, autofix,
custom syntaxes, custom formatters, and shareable configs. Jess should not clone
that surface blindly. Its advantage is authored-source knowledge across CSS,
Less, SCSS, and Jess.

## Diagnostic ownership

`jess lint` can present parser errors, compiler errors, compatibility warnings,
and lint rules in one report. That does not mean they all live in the lint rule
layer.

Lint rules should mostly be for preferences and advisory checks: things beyond
normal parse/compile/eval errors. If the same source would fail a real Jess build
with the same `styles.config`, lint should surface the compiler diagnostic
directly instead of rebranding it as a configurable style rule.

There is an important exception: a construct can be legal because a compatibility
or legacy option is enabled, and still be worth warning about. In that case the
compiler should allow it, while lint can help teams move away from it. If the
same option is disabled, the compiler owns the error regardless of the lint rule
setting.

| Owner | Examples | Config surface | User intuition |
| --- | --- | --- | --- |
| Parser/source validity | Unclosed blocks, malformed strings, invalid grammar forms | Dialect/parser options | Always an error. |
| Config and module resolution | Missing import, disallowed load path, module cycle when cycles cannot evaluate | `styles.config` and resolver options | The project cannot be understood. |
| Compiler/evaluator semantics | Definite unresolved variable, no matching mixin/function call, unknown named argument, illegal private/readonly write once those features land | Compile options and language semantics | The source does not compile. |
| Compatibility diagnostics | SCSS forms parsed for migration but not supported semantically, Less leakage patterns even when leakage is enabled | Dialect/migration/strictness options | "This may compile differently than you expect." |
| Conditional compatibility lint | Less leakage patterns when leakage is enabled | Compile option plus rule config | "This compiles only because compatibility mode permits it." |
| Lint rules | Empty blocks, duplicate selectors, naming patterns, broad extends, unused variables, project style contracts | Rule config | Team preference or maintainability warning. |

This split should be visible in diagnostic codes. Rule names are good for
Stylelint parity and Jess preferences. Compiler-owned problems should keep
compiler-style codes even when reported by the lint CLI or language service.

## Naming for type work

Use TypeScript-adjacent names:

| Jess concept | Proposed name | Why |
| --- | --- | --- |
| One callable shape for a mixin/function | `CallSignature` | Aligns with TypeScript's callable object/type terminology. |
| Signature facts learned from a definition body/defaults/guards | `InferredSignatureFacts` | A `CallSignature` may mix explicit annotations with inferred facts. |
| Literal value or pattern in a callable parameter | `LiteralValueConstraint` | Similar to TypeScript literal types: the author wrote the accepted value directly. |
| Several candidate signatures for one callable name | `OverloadSet` | Less/Jess mixins are naturally overloaded by repeated definitions and guards. |
| Later explicit annotations | `SignatureAnnotation` | Avoids prematurely calling annotations "types" when the syntax may include names, constraints, rest args, or CSS grammar fragments. |
| A call site matched to one or more candidates | `SignatureResolution` | Useful for diagnostics and hovers. |

Do not split the public model into "explicit signatures" and "inferred
signatures." `CallSignature` should be the normalized callable shape. Individual
parameter, return, output, and constraint facts can record whether they came from
an annotation, a literal value pattern, inference, or more than one source. Do
not call this `TypeScript types` or `schema` in public APIs. Jess needs CSS-value
types, callable signatures, declaration output facts, and selector facts;
`SemanticFacts` is the better umbrella.

## The missing layer: semantic facts

The language service and lint should share one fact builder:

```ts
interface SemanticFacts {
  symbols: SymbolFacts;
  values: ValueFacts;
  callables: CallableFacts;
  css: CssFacts;
  modules: ModuleFacts;
}
```

The builder should parse once, resolve imports when configured, and evaluate only
the parts needed for diagnostics. It must not render CSS, write output, or depend
on output order except where a diagnostic explicitly needs final CSS order.

Think of this as **dry semantic analysis**, not "lint eval." It may reuse the
compiler evaluator, but the product surface is facts and diagnostics. With a
complete `styles.config` and import graph, dry semantic analysis should agree
with the real compiler about hard errors.

### Callable facts

For each mixin/function definition:

- declared name and namespace path;
- parameter names, optional/default/rest status, and default value types;
- literal value constraints from Less/Jess pattern parameters;
- guard predicates and whether they narrow the signature;
- output kind: declaration block, nested rules, at-rules, value result, unknown;
- declaration facts emitted by the body, including property names and inferred
  value types when stable;
- read/write effects on variables, if visible to callers.

For each call site:

- candidate set;
- matched candidates;
- missing required args;
- unknown named args;
- ambiguous overloads;
- argument type mismatches;
- body-output mismatches when a team opts into strict style contracts.

This enables signature-contract linting: a mixin call can be warned when the
selected overload's inferred signature does not match the assigned argument
values or the expected output kind.

## Stylelint parity backlog

Prioritize rules that are useful even before semantic facts exist.

| Priority | Stylelint rule family | Jess rule name | Notes |
| --- | --- | --- | --- |
| P0 | Unknown CSS | existing `property-no-unknown`, `at-rule-no-unknown` | Keep metadata current and dialect-aware. |
| P0 | Duplicates | existing `declaration-block-no-duplicate-properties` | Add options for ignore-consecutive-duplicates and shorthand/longhand awareness. |
| P0 | Empty blocks | existing `block-no-empty` | Extend to empty Less/Jess mixin bodies only when configured; empty mixins can be intentional API placeholders. |
| P1 | Custom properties | `custom-property-no-missing-var-function` | Flag `color: --x` in CSS value positions; suppress inside custom-property declarations and Jess interpolation. |
| P1 | Invalid positioning | `no-invalid-position-at-import-rule` | CSS `@import` placement, with Jess `@-import` handled separately. |
| P1 | Duplicate imports/selectors | `no-duplicate-at-import-rules`, `no-duplicate-selectors` | Requires source-level normalization and import awareness. |
| P1 | Keyframes | `keyframe-block-no-duplicate-selectors`, `keyframe-declaration-no-important` | Good CSS-validity checks, low Jess-specific risk. |
| P1 | Fonts | `font-family-no-duplicate-names`, `font-family-no-missing-generic-family-keyword` | Useful authored-source checks; watch variable/interpolation false positives. |
| P2 | Selector validity | `selector-type-no-unknown`, `selector-pseudo-class-no-unknown`, `selector-pseudo-element-no-unknown` | Needs modern selector metadata and dialect escapes. |
| P2 | Function/value validity | `function-no-unknown`, `media-feature-name-no-unknown`, `unit-no-unknown` | Better once value typing exists. |
| P2 | Modern notations | `color-function-notation`, `alpha-value-notation`, `hue-degree-notation` | Convention rules; consider leaving formatting-ish fixes to a formatter. |
| P2 | Naming conventions | `selector-class-pattern`, `custom-property-pattern`, `keyframes-name-pattern` | Useful but project-policy heavy; opt-in only. |
| P3 | Formatting/stylistic legacy | deprecated Stylelint stylistic rules | Do not chase whitespace rules. Formatting belongs to formatter/autofix work. |

## Compiler diagnostics surfaced by lint

These are not lint preferences. They belong to parser/config/compiler ownership,
but `jess lint` and the language service should report them because they are the
most useful feedback an author can get.

| Diagnostic | Owner | Notes |
| --- | --- | --- |
| Definite unresolved variable | Compiler/evaluator | If full project analysis has the same `styles.config` as a build, this is already a compile error. Partial editor analysis can downgrade to "unresolved in current analysis" when imports/config are missing. |
| Missing import or module cycle | Resolver/compiler | Report the path and config context; do not model as a style rule. |
| No matching mixin/function overload | Compiler/evaluator | `CallSignature`/`OverloadSet` facts help produce better messages, but the failure is semantic. |
| Unknown named argument | Compiler/evaluator | Same ownership as call resolution. |
| Private member access | Compiler later | Once private syntax exists, this is a language rule, not a style preference. |
| Readonly assignment | Compiler later | Once readonly syntax exists, this is a language rule, not a style preference. |
| Unsupported SCSS runtime form | Compatibility/compiler | Current lint can keep reporting it, but the long-term owner is dialect support policy. |

## Jess-only lint rule ideas

These are the rules that make Jess lint worth using even in projects that already
run Stylelint. They assume normal parser/compiler diagnostics are reported
separately.

| Rule | Default | Required facts | What it catches |
| --- | --- | --- | --- |
| `jess/no-unused-variable` | warn | Symbol refs | Tokens defined but never read, with export/reference/import exceptions. |
| `jess/no-shadowed-token` | off | Scope facts | Local token shadows an imported/exported token unexpectedly. |
| `jess/no-leaky-scope-dependence` | warn when allowed | Scope/effect facts, compile options | Less patterns that depend on mixin/detached-ruleset variable leakage. If the compatibility option is off, this is a compiler error no matter how the lint rule is configured. |
| `jess/no-ambiguous-mixin-call` | warn | Callable facts | A call matches multiple overloads with incompatible bodies or signatures. |
| `jess/no-mixin-output-mismatch` | off | Call signatures | A mixin used as a declaration block emits nested rules, or a value-like callable emits declarations. |
| `jess/no-unsafe-reference-compose` | warn | Module facts | Extending or reading through a reference/protected boundary that cannot surface output. |
| `jess/no-duplicate-module-load` | warn | Import graph/config | Same file loaded through multiple specifiers or overload mode unintentionally. |
| `jess/no-unbounded-extend` | warn | Selector facts | Broad `$extend` target likely to match much more than intended. |
| `jess/no-dead-extend` | warn | Selector facts | `$extend` target matches no selector in accessible surfaces. |

## Value/type diagnostics

The language service tracker already names one important rule:
math-function argument-type validity for `min()`, `max()`, and `clamp()`.

That should become the first `ValueFacts` diagnostic. It is closer to authored
CSS validity than team preference:

- infer CSS numeric kind: length, angle, time, frequency, resolution,
  percentage, number, flex, unknown;
- determine whether all args can resolve to a common type;
- preserve unresolved variables/interpolation as unknown instead of guessing;
- report only when the mismatch is definite, such as `min(1px, 2s)`.

Follow-on value diagnostics:

| Diagnostic | Likely owner | Notes |
| --- | --- | --- |
| Incompatible units | Compiler or strict lint | Arithmetic and comparisons with impossible unit families. If Jess semantics reject it, compiler owns it; if Jess can still emit useful CSS, lint owns it. |
| Invalid color channel | CSS validity/compiler | Definite channel arity/type errors before color output. |
| Impossible guard | Lint preference | Guard condition that is statically always false. |
| Unused default branch | Lint preference | Mixin `default()` branch that cannot be selected. |
| Suspicious map key access | Lint preference | Numeric bracket access against a collection when the author likely meant a value key. |

## Mixin signature inference

Start with implicit signatures. Explicit annotations can come later.

Example inferred signature:

```scss
.space($scale, $axis: x) {
  margin-left: $($scale * 1px);
}
```

Possible fact:

```ts
{
  name: ".space",
  parameters: [
    { name: "scale", optional: false, inferredType: "number" },
    { name: "axis", optional: true, inferredType: "keyword" }
  ],
  output: { kind: "declarations", properties: ["margin-left"] }
}
```

Overloads should be represented as an `OverloadSet`, not collapsed:

```scss
.tone($x) when ($type.iscolor($x)) { color: $x; }
.tone($x) when ($type.isnumber($x)) { opacity: $x; }
```

Less/Jess value-pattern parameters are also signature constraints:

```scss
.theme(dark, $color) { color: $color; }
.theme(light, $color) { background: $color; }
```

Here `dark` and `light` are not inferred guesses. They are explicit strict
literal constraints on separate signatures, even though the author did not write
a `[ ... ]` annotation.

The language service can then show both signatures on hover/completion, and lint
can report mismatches when the call site is definite:

```scss
.box { $ > .tone("red"); } // no overload accepts a string
```

### Future explicit syntax

When explicit types land, use prefix type annotations:

```scss
.space(<number> $scale, <keyword> $axis?) { ... }
.tone(<color> $x) { ... }
```

This keeps the annotation close to CSS `@property syntax`, avoids inventing a
new type language, and still maps cleanly onto `CallSignature`. It also leaves
room to assign a value while expanding the accepted type.

The author-facing syntax should follow CSS value definition syntax, not
TypeScript type syntax. MDN's "Value definition syntax" guide is the friendly
reference; CSS Values and Units is the spec source. Jess should support the same
core shapes:

In callable parameter positions, annotations must have an obvious boundary:
`<...>` type references can appear directly before the parameter, while bare or
complex value grammars should be wrapped in `[ ... ]`. That is where ambiguity
lives: bare words and value fragments already have meaning in mixin/function
parameter lists, so an unbracketed keyword grammar could be mistaken for a
pattern/default/value shape. Inside `@-types` and `@-constrain`, the grammar owns
the whole right-hand side, so bare keyword and enum grammars do not need an extra
wrapper.

| Shape | Meaning in Jess annotations |
| --- | --- |
| `<length>`, `<color>`, `<custom-ident>` | CSS data types. |
| `<Spacing>`, `<BrandColor>` | Jess custom types. Custom type names must start with a capital letter. |
| `auto`, `none | solid` | Literal keyword values. Wrap as `[ auto ]` or `[ none | solid ]` in callable parameters because these do not start with `<...>`. |
| `/`, `,`, `+` | Literal separators or delimiters, quoted only when CSS value-definition syntax requires it. |
| `<length> | auto` | Exactly one alternative. It can appear directly in callable parameters because it starts with a `<...>` type reference. |
| `<length> && <color>` | Both values, in any order. |
| `<length> || <color>` | One or both values, in any order. |
| `[ <length> | auto ]` | Grouping to control precedence. |
| `<color>?`, `<length>+`, `<length>{2,4}`, `<length>#` | CSS multipliers: optional, one-or-more, bounded repetition, comma-separated repetition. |
| `<integer [0,∞]>`, `<angle [0,180deg]>` | Numeric ranges inside CSS type notation. |
| `<'border-width'>` | The grammar of a CSS property value. |

Jess can add one small authoring convenience for ranges: an omitted endpoint
means infinity. The explicit infinity character can still be accepted, but it
should not be required.

```scss
<integer [,]>              // negative infinity to positive infinity
<integer [,-1]> | <integer [1,]> // any non-zero integer
```

That gives Jess annotations room to describe real CSS shapes:

```scss
.space(<length-percentage> $gap) { ... }
.stroke([ <color> | none ] $paint) { ... }
.inset([ <length-percentage> | auto ]{1,4} $value) { ... }
.stack(<Spacing>{1,4} $gap) { ... }
```

Naming choice:

- `CallSignature` for the API/fact type.
- "signature annotation" in docs for author-written syntax.
- "inferred signature facts" for what Jess learns from unannotated source.

## Suggested implementation order

1. **Diagnostic ownership and codes**: separate compiler/config/parser codes from
   configurable lint rule names.
2. **Rule inventory doc + config names**: keep this file current as rules land.
3. **Stylelint parity P1**: custom property missing `var()`, invalid import
   placement, duplicate imports/selectors, keyframe checks.
4. **Symbol facts**: variables, custom properties, mixins, functions, modules,
   definitions, references, exports.
5. **Compiler diagnostics passthrough**: unresolved variables, bad calls, bad
   imports, and compatibility warnings reported by CLI lint and LSP without
   pretending they are style rules.
6. **Preference diagnostics**: unused/shadowed symbols, broad/dead extends, and
   duplicate module loads.
7. **Callable facts**: infer `CallSignature` / `OverloadSet` for mixins and
   functions without executing bodies.
8. **Dry semantic analysis**: allow bounded evaluator-backed facts without CSS
   emission.
9. **Value facts**: math function compatibility, unit families, map key access.
10. **Autofix**: only after spans and edit composition are stable.

## Non-goals

- Do not implement whitespace lint rules just to match old Stylelint configs.
- Do not add CLI-only checks that the language service cannot share.
- Do not render CSS just to lint authored source.
- Do not turn compiler errors into optional style rules.
- Do not report speculative type errors through interpolation, dynamic imports,
  or unknown function calls. Prefer "unknown" over false positives.
- Do not make explicit type syntax public before parser, evaluator, and SCSS
  compatibility tests exist.

## References

- `packages/lint/README.md`
- `packages/lint/src/rules.ts`
- `packages/diagnostics-core/src/tolerant-cst.ts`
- `packages/editor/language-service/TRACKER.md`
- MDN: "Value definition syntax"
- CSS Values and Units Module Level 4: "Value Definition Syntax"
- Stylelint docs: `docs/user-guide/rules.md` and `docs/user-guide/configure.md`
- TypeScript handbook: "More on Functions" (`Call Signatures`,
  `Function Overloads`) and "Everyday Types" (`Contextual Typing`)
