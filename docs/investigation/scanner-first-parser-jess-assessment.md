# Scanner-First Parser: Jess Strategy

This note turns the scanner-first parsing idea from
`scanner-first-parser-for-css-like-languages.md` into a concrete package and
integration strategy for Jess.

## Short Answer

A scanner-first parser is plausible for IDE structure, indexing, folding,
node-at-offset queries, and incremental experiments.

It is not safe as a drop-in compiler parser until it can preserve the current
parser-sensitive AST contracts for CSS, Less, SCSS, and Jess. Less is the
hardest case: parse-time work currently decides real semantic shape for guards,
math expression wrapping, variable/index references, media preludes, mixin
definitions/calls, selector nesting, and `:extend()`.

The best near-term shape is hybrid:

```text
shared scanner/token layer
  -> structural document parser for IDE/indexing
  -> existing AST parser or island parsers for semantic/compiler nodes
  -> shared services for selectors, values, references, imports, mixins, extends
```

That keeps the DRY goal, but avoids pretending one shallow parser can replace
the existing compiler grammar in one step.

## Current Parser Shape

The parser family is already layered:

- CSS is the base parser. `CssRecursiveParser` still extends Chevrotain's
  `EmbeddedActionsParser`, filters skipped tokens into a trivia map, and uses
  max lookahead 1. See `packages/css-parser/src/cssRecursiveParser.ts`.
- Less extends the CSS parser and overrides/adds productions. Its config
  includes Less-specific semantic controls such as `looseMode`, `leakyRules`,
  `mathMode`, and `wrapOuterExpressions`. See
  `packages/less-parser/src/lessRecursiveParser.ts`.
- SCSS extends CSS with SCSS variables, interpolation, placeholder selectors,
  flags, namespaced function starts, and condition/math hooks. See
  `packages/scss-parser/src/scssRecursiveParser.ts`.
- Jess extends SCSS with Jess-specific `$if`, `$for`, `$while`, `$()`, `$!`,
  mixin-call, control-flow, and module at-rule productions. See
  `packages/jess-parser/src/jessRecursiveParser.ts`.

The token layer is also partly DRY already:

- CSS defines fragments/tokens in `packages/css-parser/src/cssTokens.ts`.
- Less and SCSS build from CSS fragments/tokens and merge language-specific
  tokens in `packages/less-parser/src/lessTokens.ts` and
  `packages/scss-parser/src/scssTokens.ts`.
- Jess builds from SCSS tokens and inserts its `$`-prefixed keywords with
  explicit priority rules in `packages/jess-parser/src/jessTokens.ts`.
- Lexer construction is shared through `createLexerDefinition` in
  `packages/css-parser/src/util/index.ts`.

There is also a newer `@jesscss/parser` package. It is a hand-written
recursive-descent runtime with Chevrotain-compatible helper methods, skipped
token filtering, content-assist hooks, and a `SPEC_FAIL` sentinel for cheap
speculative backtracking. See `packages/parser/src/parser.ts` and
`packages/parser/src/types.ts`. That package already points toward reducing
generator overhead without requiring a fully raw scanner-first design.

Current source-location support is also not the same thing as robust source
span fidelity. The parser has `LocationInfo` slots for start and end offsets,
lines, and columns, plus a trivia map for skipped tokens. But rule locations
are mostly inferred from the next token at `startRule()` and the last consumed
token at `endRule()`, and newline ownership is not a first-class structural
concept. The CSS token fragments even carry a TODO about using separator
whitespace to attach newlines to node ends. A scanner-first experiment should
therefore improve newline/trivia and span capture, not merely preserve today's
parser behavior.

## What Is Plausible

### 1. Structural parse for language services

The scanner-first document model is strongest for:

- balanced block structure
- declaration/rule/at-rule boundaries
- exact start/end source spans
- newline and trivia ownership
- comments and trivia ranges
- folding ranges
- document symbols
- node-at-offset and scope-at-offset queries
- rough completion context
- import, variable, mixin, and extend candidate indexes
- incremental invalidation by block or statement range

This can be built without constructing full Jess `Node` trees for every
selector and value. It should be treated as a language-service document tree,
not as the compiler AST.

### 2. Offset-first island cache

Raw selector/value/expression islands fit well if they are explicitly cached by:

- source version
- island start/end offsets
- language mode
- parser config that affects shape, especially Less `mathMode`,
  `wrapOuterExpressions`, `looseMode`, and `leakyRules`

The island APIs should return current core AST nodes when used by compiler
paths, not a second permanent AST type that drifts from `@jesscss/core`.

### 3. Shared scanner/token classification

DRY should happen at a lower level than one mega-parser:

- one scanner/token definition substrate for CSS-family lexical primitives
- language overlays for Less, SCSS, and Jess tokens
- shared delimiter/string/comment/interpolation scanning
- shared structural parser machinery for blocks, declaration boundaries,
  at-rule shells, trivia, and source ranges
- language-specific hooks for ambiguous constructs

That matches the current inheritance model better than four independent parser
rewrites.

### 4. Hand-written parser runtime migration

The existing `@jesscss/parser` runtime may be the more direct first experiment
than a brand-new scanner. It already preserves token-stream compatibility while
removing Chevrotain self-analysis/GAST overhead. A sensible benchmark path is:

```text
current Chevrotain-backed parser
vs
same tokenization + @jesscss/parser runtime
vs
structural scanner-first document parser
```

That separates "parser generator overhead" from "full AST construction cost"
and from "token object/scanner allocation cost".

## What Must Change From The Draft

### 1. Do not make selectors raw for compile mode

The draft says ordinary selectors can stay raw until needed. That is fine for
IDE mode, but compile mode needs selector ASTs early enough to support:

- Less `:extend()` placement and grouping
- `&:extend()` statements inside rule bodies
- nested selector composition
- selector lists and selector captures
- extend-root accessibility behavior at render/eval time

Current Less selector productions build and validate `Extend` nodes during
parse, including target grouping and allowed-selector checks. See
`packages/less-parser/src/productions/selectors.ts` and
`packages/less-parser/src/productions/root.ts`.

Altered shape: structural parse may mark selector islands and detect obvious
`:extend` text, but any compiler/eval path must parse selector islands into
the canonical selector AST before building `Ruleset`/`Extend` semantics.

### 2. Do not make all values raw for Less/Jess compile mode

Plain CSS values can often remain raw longer. Less/Jess values cannot, because
parse-time shape affects runtime behavior:

- Less math mode decides whether `/` is division or list separator.
- `wrapOuterExpressions` creates `Expression` wrappers for Less-to-Jess
  conversion.
- variable/property references become different `Reference` shapes.
- `default()` and guard forms affect `DefaultGuard` behavior.
- custom properties intentionally parse with different interpolation/reference
  rules.
- at-rule preludes have Less-specific reference/index behavior.

Altered shape: values can be raw for IDE structure, but compiler mode needs
eager parsing for declarations or at-rule preludes that contain Less/Jess
features, math candidates, references, interpolation, guards, or mixin calls.

### 3. AST contracts apply at materialization boundaries

`docs/investigation/parser-ast-gap-baseline.md` says the historical AST is a
minimum shape contract. High-value contracts include nested namespaced
references, `default()` guard semantics, rest params/args, reference shapes,
selector/extend placement, and Less-specific media query forms.

That contract does not mean the first structural parse must produce the same
`serializeTypes(...)` output as today's eager parser. If selectors, values,
guards, or mixin bodies are raw islands after pass one, their first-pass
structural shape should be tested as structural data: spans, diagnostics,
island kind, parent context, and invalidation behavior.

The compatibility gate applies when an island is promoted into compiler-visible
AST:

- before eval/render observes it;
- before a registered visitor can traverse or mutate it;
- before semantic indexes need selector/value/reference detail;
- before a plugin asks for a canonical Jess node or Less adapter node.

At those materialization boundaries, the promoted shape must preserve the
relevant historical contracts or document an intentional AST upgrade. The same
source may therefore have two valid test surfaces: structural snapshots for the
first pass, and `serializeTypes(...)` or focused node assertions for the
materialized compiler subtree.

### 4. Error tolerance must not mean silent semantic repair

The draft correctly asks for broken-code tolerance. For Jess, that should be
split:

- IDE structural parser: best-effort nodes, diagnostics, and scopes.
- Compiler parser: preserve current error semantics and avoid manufacturing
  AST nodes that later eval/render code treats as valid.

This split avoids hiding structural bugs behind a forgiving scanner.

## Concrete Strategy

The strategy is to add a structural parsing layer that is useful on its own,
then wire it into the existing parser/plugin system without immediately
replacing compiler parsing.

The package-level shape should reuse the existing `@jesscss/parser` package as
the shared parser foundation:

```text
@jesscss/parser
  source text, spans, trivia, line maps, scanner primitives,
  structural parser, language profiles, island registry,
  materialization policy, semantic indexes

@jesscss/css-parser / @jesscss/less-parser / @jesscss/scss-parser / @jesscss/jess-parser
  canonical compiler AST parsers and parser-package island providers

@jesscss/core
  PluginInterface extensions and lazy-materialization protocol

@jesscss/plugin-less / @jesscss/plugin-scss / @jesscss/plugin-less-compat
  opt-in use of structural parse results and visitor materialization policy

@jesscss/language-service
  primary consumer for structural parse, indexes, and node-at-offset APIs
```

Do not create a new "one parser to own everything" package. The compiler AST
parsers remain language-specific. `@jesscss/parser` owns shared parser
infrastructure, source structure, incremental IDE shape, and the policy for
when raw ranges become canonical `@jesscss/core` nodes.

## Package Specifications

### `@jesscss/parser`

Existing package, repurposed as the shared parser foundation. It already
contains the hand-written recursive-descent parser runtime. Expand it rather
than creating `@jesscss/source`, `@jesscss/structure-parser`, or
`@jesscss/parse-services` as public packages.

Internal module layout:

```text
packages/parser/src/source/
  SourceText, LineMap, SourceSpan, DelimitedSpan, TriviaRun

packages/parser/src/scanner/
  ScannerCursor and CSS-family delimiter/string/comment helpers

packages/parser/src/structure/
  parseStructure, StructuralDocument, structural node types

packages/parser/src/profiles/
  cssProfile, lessProfile, scssProfile, jessProfile

packages/parser/src/services/
  IslandParserRegistry, MaterializationSession, SemanticIndexBuilder

packages/parser/src/runtime/
  current RecursiveDescentParser runtime, SPEC_FAIL, parse errors
```

Public exports should be grouped but still come from `@jesscss/parser`:

Exports:

- `SourceText`: immutable source string plus `version`, `filePath`, and line
  start table.
- `SourceSpan`: `{ start: number; end: number }`, end-exclusive.
- `DelimitedSpan`: full span, content span, open delimiter span, close
  delimiter span.
- `TriviaRun`: raw whitespace/comment range plus classification:
  `whitespace`, `line-comment`, `block-comment`, `newline`.
- `LineMap`: offset to line/column and line/column to offset.
- `ScannerCursor`: char-code cursor with helpers for strings, comments,
  escapes, bracket balancing, interpolation shells, and delimiter scanning.
- `parseStructure(source, profile, options): StructuralDocument`
- `LanguageProfile`
- built-in profiles: `cssProfile`, `lessProfile`, `scssProfile`,
  `jessProfile`
- structural node types:
  - `DocumentNode`
  - `BlockNode`
  - `RuleNode`
  - `DeclarationNode`
  - `AtRuleNode`
  - `MixinDefinitionNode`
  - `MixinCallNode`
  - `VariableDeclarationNode`
  - `ImportNode`
  - `RawIslandNode`
  - `ErrorNode`
- `IslandParserRegistry`
- `MaterializationPolicy`
- `MaterializationSession`
- `SemanticIndexBuilder`
- `VisitorMaterializationRule`
- `ParserMode`

`StructuralDocument` must provide:

- `root`
- `source`
- `diagnostics`
- `trivia`
- `findNodeAt(offset)`
- `scopeAt(offset)`
- `foldingRanges()`
- `symbols()`
- `islands(kind?)`
- `changedRanges(previousDocument)`

`LanguageProfile` should be data plus narrow callbacks, not a parser subclass:

```ts
interface LanguageProfile {
  name: 'css' | 'less' | 'scss' | 'jess';
  variablePrefixes: readonly string[];
  interpolationStarts: readonly string[];
  atRuleClassifiers: Record<string, AtRuleKind>;
  statementStarters: StatementStarter[];
  classifyDeclarationName(source, range): DeclarationNameKind;
  classifyRuleHeader(source, range): RuleHeaderKind;
  classifyIsland(source, range, context): IslandKind[];
}
```

The callbacks answer classification questions only. They do not build
`@jesscss/core` nodes.

Purpose:

- make offset-first spans consistent across all parser work;
- avoid each parser inventing its own location/trivia model;
- support lazy line/column mapping;
- preserve newline ownership explicitly;
- provide a structural document parser for language-service work;
- provide shared materialization/index services for parser packages and plugins;
- continue hosting the hand-written recursive-descent runtime.

First implementation for source/scanner:

- line-map conversion for LF, CRLF, CR, and form-feed;
- string/comment scanning with escapes and EOF;
- delimiter span capture for `{}`, `()`, `[]`;
- trivia runs before, after, and inside structural nodes.

First implementation for structure:

- CSS profile handles ordinary rules, declarations, at-rules, custom
  properties, comments, strings, and balanced blocks.
- Less profile adds `@var`, `${property}`, mixin definition/call candidates,
  `:extend` candidate detection, and Less interpolation ranges.
- SCSS profile adds `$var`, `#{}`, placeholder selector candidates, `@use`,
  `@forward`, and `@include` candidates.
- Jess profile adds `$if`, `$for`, `$while`, `$()`, `$!`, and Jess module
  at-rule candidates.

`IslandParserRegistry` maps:

```text
language + island kind + parser config -> parse function
```

Examples:

- CSS selector island -> `@jesscss/css-parser` selector rule
- Less selector island -> `@jesscss/less-parser` selector rule
- Less declaration value island -> `@jesscss/less-parser` value/expression rule
- Jess expression island -> `@jesscss/jess-parser` expression rule

`MaterializationSession` owns one source version and one structural document.
It exposes:

- `materializeIsland(island, target): Node`
- `materializeNode(structuralNode, target): Node`
- `materializeForVisitor(visitor, phase, parent): Rules | Node`
- `materializeForCompile(): Rules`
- `getCached(range, key)`

Cache key must include:

- source version;
- range;
- language;
- island kind;
- parser config such as Less `mathMode`, `looseMode`, `leakyRules`, and
  `wrapOuterExpressions`;
- target shape: Jess core node vs Less adapter.

`SemanticIndexBuilder` consumes structural nodes first and materializes only
when an index needs deeper syntax:

- imports: structural-only for path and at-rule shell;
- variables: structural declaration shell plus value island only when needed;
- mixins: structural signature first, canonical AST when called or visited;
- extends: selector island materialization for targets and extenders;
- references: value/prelude materialization when the structural scan detects
  variable, property, interpolation, or call syntax.

Dependency rule:

- `@jesscss/parser` may use `@jesscss/core` types only where materialization
  services need them.
- The low-level `source`, `scanner`, `structure`, and `profiles` modules must
  not import `@jesscss/core`, Chevrotain, or parser packages.
- Parser packages register island providers with `@jesscss/parser`; the shared
  parser package must not import language parser packages directly.

### Existing parser packages

The existing compiler parser packages keep their current public contract. New
work adds narrow entrypoints, not a replacement parser:

- `@jesscss/css-parser`
  - expose selector/value/prelude parse entrypoints as island parser providers;
  - keep strict CSS AST tests as the compatibility gate.
- `@jesscss/less-parser`
  - expose Less selector/value/mixin/guard/media-prelude island providers;
  - keep Less AST baselines as the compatibility gate.
- `@jesscss/scss-parser`
  - expose SCSS selector/value/control island providers as coverage grows.
- `@jesscss/jess-parser`
  - expose Jess expression/control/mixin/module at-rule island providers.
- `@jesscss/parser`
  - owns shared source/scanner/structure/services/runtime code;
  - remains the candidate runtime for replacing Chevrotain mechanics inside
    the compiler parsers; that runtime migration is benchmarked separately
    from structural parsing.

This avoids a false choice between "scanner-first" and "compiler AST parser."
The structural parser can ship for IDE/indexing first, while compiler parsers
gradually publish reusable island entrypoints.

## Plugin Integration

Current plugin parsing is centered on `PluginInterface.safeParse(filePath,
source)` and `Context.findParserPlugin(...)`. That should remain the public
compiler entrypoint.

Add optional plugin hooks:

```ts
interface PluginInterface {
  structureProfile?: LanguageProfile;
  structureParse?(filePath: string, source: string): StructuralDocument;
  parseServices?(filePath: string, source: string): MaterializationSession;
  visitorMaterialization?(
    visitor: PluginVisitor,
    phase: VisitorPhase
  ): VisitorMaterializationRule | undefined;
}
```

Integration rules:

- `safeParse` still returns canonical `Rules` for compiler/eval/render.
- `structureParse` returns structural data for IDE/indexing and can be used by
  `@jesscss/language-service` without forcing full AST construction.
- `parseServices` is optional and is backed by `@jesscss/parser` only for
  compiler code that opts into lazy materialization.
- Existing plugins that implement only `safeParse` continue to work unchanged.
- Plugins that support custom syntax can provide a `LanguageProfile` and island
  parser providers without replacing the whole parser.

Package-specific plugin behavior:

- `@jesscss/plugin-less`
  - exposes `lessProfile`;
  - uses current `LessParser.safeParse` for compile mode;
  - registers Less island parsers in `parseServices`;
  - forces full materialization when Less-compat visitors are present.
- `@jesscss/plugin-scss`
  - exposes `scssProfile`;
  - uses current SCSS/Jess-compatible parser for compile mode;
  - registers SCSS island parsers when they are covered by tests.
- `@jesscss/plugin-less-compat`
  - remains adapter-based;
  - defaults Less-compatible visitors to materialize the adapted tree shape
    they can traverse;
  - can later narrow materialization by inspecting known Less visitor methods.
- `@jesscss/plugin-js`
  - should not affect structural parsing except for `@plugin` / JS import
    detection; script execution remains compile/eval-time only.

## Visitor Strategy

Visitors must not receive raw placeholders unless they explicitly opt into the
structural API.

Do not add a second "visitor interest" declaration layer. The materialization
policy should derive from the visitor that is actually registered for the
current phase.

```ts
type VisitorPhase = 'beforeEval' | 'postEval' | 'preRender' | 'languageService';

type VisitorMaterializationRule =
  | { kind: 'full-tree'; target: 'jess-core' | 'less-adapter' }
  | { kind: 'node-shapes'; nodeTypes: string[]; includeParents: true }
  | { kind: 'structural-only' };
```

Default policy:

- inspect the visitor object registered for the phase;
- `visit(node)` with no typed methods means the visitor may observe anything,
  so materialize the whole relevant tree;
- replacing visitors materialize the whole relevant tree unless the plugin
  supplies a narrower `visitorMaterialization(...)` rule;
- typed Jess visitor methods materialize the parent shapes needed to reach that
  node type through normal traversal;
- selector methods require ruleset/rule header shape plus selector islands;
- declaration/value methods require containing rules, declaration shell, and
  value islands;
- at-rule methods require at-rule shell and prelude/body islands the method can
  observe;
- Less-compatible visitors use Less method names like `visitRuleset`,
  `visitDeclaration`, `visitSelector`, and `visitAtRule`, but default to
  `full-tree` with `less-adapter` target until the compat layer has proven a
  narrower mapping;
- structural-only consumers do not use `Node.accept`; they receive
  `StructuralDocument` through language-service APIs.

The key rule is parent shape first, child detail second. A visitor registered
for `declaration` does not require every selector value in the file, but it
does require enough parent rules/rulesets/at-rules to traverse to declarations
correctly. A visitor registered for selector nodes requires selector islands and
their containing ruleset headers. Materialization follows the traversal path,
not a vague global interest list.

JIT visiting is allowed only behind a stable node boundary:

```text
LazyIslandNode.accept(visitor)
  -> MaterializationSession materializes the island to canonical Node
  -> the canonical Node handles accept(visitor)
```

This should not be the initial compiler path. Initial compiler integration
should materialize before visitor traversal. JIT `accept` is a later
optimization once the materialization cache and visitor method mapping are
proven.

## Source Span Strategy

The first structural parser milestone must produce better spans than the
current parser. This is not optional.

Required structural spans:

- full node span;
- header span for rules and at-rules;
- value span for declarations;
- content span for delimited blocks;
- delimiter spans;
- semicolon/comma/colon separator spans;
- leading/trailing/interior trivia spans;
- newline ownership.

Line/column numbers remain lazy through `LineMap`. All stored locations should
be offset-first.

The structural parser should not copy the current `LocationInfo` behavior where
rule start/end is inferred only from first/last consumed tokens. It should own
range construction directly while scanning.

## Less 4.x Reference Work

Less 4.x is both a behavior oracle and an architecture reference. It should be
used in a dedicated package-local test helper, not embedded into production
code.

Add test helpers under `packages/less-parser/test/reference/` or
`packages/parser/test/reference/`:

- load installed `less@4.6.3` parser source by package export path;
- parse selected Less fixtures;
- compare categories of behavior, not object identity;
- record where Less skips literal value parsing and where it forces deeper
  parsing.

Concrete questions to answer:

- Which Less values does Less keep effectively literal?
- Which syntax forces value parsing: variables, property accessors,
  interpolation, operations, functions, guards, mixin calls?
- How does Less attach source index/debug info for multi-line nodes?
- How do visitors observe the parsed tree after plugin registration?

The result should feed `LanguageProfile` classification and
`MaterializationPolicy`, not become a production dependency.

## Work Specification

### Phase 1: Spec and fixtures

Deliverables:

- This strategy doc replaces the assessment as the active plan.
- Fixture set for structural spans:
  - multi-line selectors;
  - multi-line declaration values;
  - custom properties;
  - comments before/inside/after rules;
  - incomplete declarations and EOF blocks;
  - Less variables, mixin definitions/calls, and `:extend`;
  - SCSS `$var`, `#{}`, `@use`, `@forward`, `@include`;
  - Jess `$if`, `$for`, `$()`, `$!`, module at-rules.

Verification:

- fixture snapshots define spans and diagnostics only;
- no compiler parser behavior changes.

### Phase 2: `@jesscss/parser` source/scanner modules

Deliverables:

- new `source/` and `scanner/` modules inside `packages/parser/src`;
- `SourceText`, `LineMap`, `SourceSpan`, `DelimitedSpan`, `TriviaRun`,
  `ScannerCursor`;
- tests for line maps, strings, comments, escapes, delimiter scanning, and
  trivia runs.

Verification:

- `pnpm --filter @jesscss/parser test`
- `pnpm --filter @jesscss/parser build`

### Phase 3: `@jesscss/parser` structural parser modules

Deliverables:

- new `structure/` and `profiles/` modules inside `packages/parser/src`;
- `parseStructure`;
- CSS/Less/SCSS/Jess profiles;
- structural AST types;
- `findNodeAt`, `scopeAt`, `foldingRanges`, `symbols`, `islands`;
- diagnostics for incomplete blocks/declarations without throwing.

Verification:

- span fixture tests;
- malformed-input tests;
- benchmark on CSS/Less test fixtures for structural parse only.

### Phase 4: `@jesscss/parser` parse services modules

Deliverables:

- new `services/` modules inside `packages/parser/src`;
- island parser registry;
- materialization cache;
- semantic index builder;
- visitor method inspection and default materialization policy.

Verification:

- mocked island parser tests prove cache keys include source version, range,
  language, island kind, and parser config;
- semantic index tests prove structural-only indexes avoid materialization.

### Phase 5: parser package island providers

Deliverables:

- `@jesscss/css-parser` provider for selector/value/prelude islands;
- `@jesscss/less-parser` provider for selector/value/mixin/guard/media islands;
- SCSS/Jess providers only for covered constructs;
- materialization-boundary tests for promoted island shapes.

Verification:

- existing parser test suites;
- structural snapshots for first-pass raw islands;
- `serializeTypes(...)` or focused node assertions at materialization
  boundaries for Less references, guards, mixin boundaries, selector/extend
  placement, and Less media query forms.

### Phase 6: plugin integration

Deliverables:

- optional `PluginInterface` extensions in `@jesscss/core`;
- `@jesscss/plugin-less` exposes `lessProfile` and parse services;
- `@jesscss/plugin-scss` exposes `scssProfile` where useful;
- `@jesscss/plugin-less-compat` maps Less visitor methods to materialization
  rules, defaulting to full adapted-tree materialization;
- `@jesscss/language-service` consumes structural parse directly.

Verification:

- existing plugin tests continue to pass without plugins implementing new hooks;
- Less-compat visitors force materialization before traversal;
- language service can produce symbols/folding/node-at-offset without full AST.

### Phase 7: compiler opt-in experiment

Deliverables:

- hidden/experimental option to use structural parse plus materialization for
  selected Less/Jess files;
- phase timings for structural parse, island materialization, AST construction,
  visitors, eval, render;
- comparison against current parser, `@jesscss/parser` runtime migration, and
  Less 4.x reference behavior.

Verification:

- no default behavior change;
- full Less/Jess fixture gates pass before considering promotion.

## Non-Goals

- Do not replace `@jesscss/core` AST with structural nodes.
- Do not hand raw placeholders to current compiler visitors.
- Do not remove Chevrotain from compiler parsers as part of structural parser
  work; benchmark `@jesscss/parser` migration separately.
- Do not silently weaken CSS spec behavior in compile mode.
- Do not add Less 4.x as production parser dependency.

## Recommendation

Expand the existing `@jesscss/parser` package into the shared parser foundation.
Do not create new public packages for source spans, structural parsing, or parse
services unless the module boundaries later prove too large for one package.
Wire `@jesscss/parser` into the language-service and plugin hooks before
touching the default compiler parse path. Treat visitor registration as a
materialization policy input. Treat exact spans and newline/trivia ownership as
the first deliverable, not an optimization.

Only after the structural layer proves useful and the island providers preserve
parser AST contracts should Jess consider a compiler opt-in path.
