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

There is also a newer `@jesscss/parser` package, but its current implementation
is throwaway. The useful thing to keep is the package name and its role as the
future shared parser foundation, not the existing recursive-descent runtime.

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

### 4. Reclaim `@jesscss/parser`, do not migrate its runtime

The package name should become the shared home for source text, scanner,
structure, profiles, materialization, and indexing. The current package
contents should not be treated as a production runtime candidate or a benchmark
path. The comparison that matters is current compiler parser behavior versus
the new scanner-first structural and materialization paths.

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

The package-level shape should replace the current `@jesscss/parser`
implementation while keeping that package name as the shared parser foundation:

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

## Implementation Language

Implement this in TypeScript, compiled to the same JavaScript module targets as
the rest of the Jess workspace.

Reasons:

- Jess parser, plugin, language-service, and runtime packages already expose
  TypeScript/JavaScript APIs; keeping scanner-first work in-process avoids FFI,
  WASM, worker protocol, and packaging boundaries before the architecture is
  proven.
- Plugins can share `LanguageProfile`, island provider, and materialization
  types directly instead of translating through a second runtime model.
- Existing fixtures, parser tests, `serializeTypes(...)`, package builds, and
  benchmark harnesses can exercise the new path without a parallel toolchain.
- The performance question is mostly architecture and allocation shape:
  offset-first spans, lazy line/column mapping, raw islands, materialization
  boundaries, cache keys, and visitor traversal. Those should be proven in the
  runtime Jess actually ships before considering another implementation
  language.

Do not introduce Rust, C++, or WASM for the first scanner-first pass. A native
or WASM scanner can be reconsidered only after the TypeScript design has clear
hot-path measurements showing that language/runtime overhead, not parser shape,
is the bottleneck.

## Package Specifications

### `@jesscss/parser`

Replacement package using the existing package name. The scanner-first
experiment should replace the current throwaway implementation, not expand it
incrementally. Keep this as one public package instead of creating
`@jesscss/source`, `@jesscss/structure-parser`, or `@jesscss/parse-services`
as public packages.

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
- provide one public package home for shared parser infrastructure.

Implementation sketch for source/scanner:

```ts
function scanStructure(source: SourceText, profile: LanguageProfile) {
  const cursor = new ScannerCursor(source.text);
  const events: StructuralEvent[] = [];
  const trivia: TriviaRun[] = [];
  const stack: BlockFrame[] = [];

  while (!cursor.eof()) {
    const triviaStart = cursor.offset;
    scanTriviaInto(cursor, trivia);

    const start = cursor.offset;
    const token = scanStructuralToken(cursor, profile);

    switch (token.kind) {
      case 'block-open':
        stack.push({ kind: token.blockKind, start, header: token.header });
        break;
      case 'block-close':
        events.push(closeFrame(stack, start, cursor.offset));
        break;
      case 'statement':
        events.push(classifyStatement(source, token.range, profile, stack));
        break;
      case 'error':
        events.push(errorNode(start, cursor.offset));
        recoverToNextBoundary(cursor);
        break;
    }

    attachTrivia(events, triviaStart, cursor.offset);
  }

  return buildStructuralDocument(source, events, trivia, stack);
}
```

Performance constraints for this layer:

- store offsets, not eager line/column objects;
- scan with cursor offsets and char codes in hot loops;
- build small structural records, not compiler AST nodes;
- avoid allocating token objects for trivia that can be stored as ranges;
- recover by scanning to known boundaries instead of throwing for normal
  malformed input.

First source/scanner coverage:

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

Implementation sketch:

```ts
function materializeIsland(island: RawIslandNode, target: TargetShape) {
  const provider = registry.get(island.language, island.kind, target);
  const key = makeCacheKey(source.version, island, target, provider.config);
  const cached = materialized.get(key);

  if (cached) {
    return cached.node;
  }

  const text = source.slice(island.contentSpan);
  const node = provider.parse(text, {
    baseOffset: island.contentSpan.start,
    context: island.context,
    diagnostics,
  });

  materialized.set(key, { node, diagnosticsVersion: diagnostics.version });
  return node;
}
```

Performance constraints for materialization:

- materialize each stable source/range/config/target at most once per session;
- parse only the island text and pass a base offset for source spans;
- do not copy source strings except where the existing parser entrypoint
  requires a substring;
- keep failed materialization diagnostics cached separately from thrown
  exceptional errors;
- record counters for island parse count, cache hits, promoted byte ranges, and
  fallback full-tree materializations.

`SemanticIndexBuilder` consumes structural nodes first and materializes only
when an index needs deeper syntax:

- imports: structural-only for path and at-rule shell;
- variables: structural declaration shell plus value island only when needed;
- mixins: structural signature first, canonical AST when called or visited;
- extends: selector island materialization for targets and extenders;
- references: value/prelude materialization when the structural scan detects
  variable, property, interpolation, or call syntax.

Implementation sketch:

```ts
function buildIndexes(document: StructuralDocument, session: MaterializationSession) {
  for (const node of document.root.children) {
    switch (node.kind) {
      case 'Import':
        imports.add(importFromShell(node));
        break;
      case 'VariableDeclaration':
        variables.add(variableFromShell(node));
        if (needsValueDetail(node.valueIsland)) {
          references.addFrom(session.materializeIsland(node.valueIsland, 'jess-core'));
        }
        break;
      case 'Rule':
        symbols.add(ruleSymbolFromHeader(node));
        if (node.hasExtendCandidate) {
          extends.addFrom(session.materializeIsland(node.selectorIsland, 'jess-core'));
        }
        break;
    }
  }
}
```

The important property is selective promotion: indexes should prove which
questions they can answer from structure alone and which questions require
canonical node materialization.

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
  - owns shared source/scanner/structure/services code;
  - does not preserve the current throwaway runtime as a migration path.

This avoids a false choice between "scanner-first" and "compiler AST parser."
The structural parser can ship for IDE/indexing first, while compiler parsers
gradually publish reusable island entrypoints.

## Plugin Integration

Current plugin parsing is centered on `PluginInterface.safeParse(filePath,
source)` and `Context.findParserPlugin(...)`. That should remain the public
compiler entrypoint.

The following hooks are a migration sketch, not a frozen Jess plugin API. Less
compatibility needs an adapter around today's visitor shape, but Jess-native
plugin and visitor shapes can still change while SCSS parsing is finalized and
released as alpha.

Candidate optional plugin hooks:

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

This section describes a compatibility strategy, not a permanent Jess visitor
contract. Less-compatible visitors need conservative behavior because their
method names and adapter expectations already exist. Jess-native visitors can
be redesigned around the eventual parser/runtime model.

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

## Performance Acceptance Strategy

Performance is a primary concern, but it should be tested as a set of concrete
runtime properties instead of a single "is it faster?" claim.

Correctness and compatibility gates still come first:

- structural parser diagnostics and spans are correct;
- compile mode preserves existing parser/eval/render behavior;
- materialized islands preserve the relevant historical AST contracts;
- plugins and visitors do not observe raw placeholders unless they use the
  structural API.

Performance gates should be added as soon as each layer exists:

- structural parse time on the existing CSS/Less/SCSS corpus;
- peak and retained allocation for structural parse;
- number of structural records per input byte;
- number and total byte size of promoted islands;
- materialization cache hit/miss counts;
- number of fallback full-tree materializations;
- end-to-end compile/eval/render time once compiler opt-in exists.

The first performance target is not "beat the current compiler parser on every
file." The first target is to prove that structural consumers can answer IDE
and indexing questions without building full compiler ASTs, and that compiler
mode does not regress when the new services are present but inactive.

Benchmark comparisons should keep these paths separate:

- current compiler parser;
- scanner-first structural parse only;
- scanner-first structural parse plus selected island materialization;
- scanner-first full compile materialization.

Do not claim a speed win without before/after measurements. Also do not accept
a local object-count win if it adds more expensive side maps, recursive walks,
or fallback full-tree materializations in the real path.

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
- Inventory the existing checked-in CSS, Less, and SCSS fixture corpus and tag
  cases that should become scanner-first structural span coverage.
- Reuse existing corpus files wherever possible. Add new examples only for
  scanner-specific gaps that the current corpus does not cover.
- Initial structural span coverage should include existing examples for:
  - multi-line selectors;
  - multi-line declaration values;
  - custom properties;
  - comments before/inside/after rules;
  - incomplete declarations and EOF blocks;
  - Less variables, mixin definitions/calls, and `:extend`;
  - SCSS `$var`, `#{}`, `@use`, `@forward`, `@include`.
- Do not create a broad `.jess` language corpus in this phase. Existing `.jess`
  runtime/plugin fixtures can smoke-test integration, but final Jess syntax
  coverage should wait until the SCSS parser shape is finalized and shipped as
  alpha.

Verification:

- fixture snapshots define spans and diagnostics only;
- fixture inventory identifies corpus coverage and gaps before new examples
  are added;
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
- micro-benchmark reports line-map, scanner, and trivia allocation baselines.

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
- benchmark on CSS/Less/SCSS corpus files for structural parse only;
- structural parse reports record count, diagnostic count, and allocated bytes
  per input byte where the harness can measure it.

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
- semantic index tests prove structural-only indexes avoid materialization;
- materialization tests assert island parse count, cache hits, and fallback
  full-tree materialization count.

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
  placement, and Less media query forms;
- provider benchmarks report selected-island materialization separately from
  full compile parsing.

### Phase 6: plugin integration

Deliverables:

- prototype candidate plugin hooks or adapter shims in `@jesscss/core`;
- `@jesscss/plugin-less` exposes `lessProfile` and parse services;
- `@jesscss/plugin-scss` exposes `scssProfile` where useful;
- `@jesscss/plugin-less-compat` maps Less visitor methods to materialization
  rules, defaulting to full adapted-tree materialization;
- `@jesscss/language-service` consumes structural parse directly.

Verification:

- existing plugin tests continue to pass without plugins implementing new
  candidate hooks;
- Less-compat visitors force materialization before traversal;
- language service can produce symbols/folding/node-at-offset without full AST;
- visitor tests report whether traversal required selected islands or fallback
  full-tree materialization.

### Phase 7: compiler opt-in experiment

Deliverables:

- hidden/experimental option to use structural parse plus materialization for
  selected Less/Jess files;
- phase timings for structural parse, island materialization, AST construction,
  visitors, eval, render;
- comparison against current compiler parser behavior and Less 4.x reference
  behavior where relevant.

Verification:

- no default behavior change;
- full Less/Jess fixture gates pass before considering promotion;
- end-to-end timings compare current compiler parser, structural-only parse,
  selected materialization, and full materialization paths.

## Non-Goals

- Do not replace `@jesscss/core` AST with structural nodes.
- Do not hand raw placeholders to current compiler visitors.
- Do not remove Chevrotain from compiler parsers as part of structural parser
  work.
- Do not silently weaken CSS spec behavior in compile mode.
- Do not add Less 4.x as production parser dependency.

## Recommendation

Replace the current `@jesscss/parser` implementation with the new shared parser
foundation. Do not create new public packages for source spans, structural
parsing, or parse services unless the module boundaries later prove too large
for one package.
Wire `@jesscss/parser` into the language-service and plugin hooks before
touching the default compiler parse path. Treat visitor registration as a
materialization policy input. Treat exact spans and newline/trivia ownership as
the first deliverable, not an optimization.

Only after the structural layer proves useful and the island providers preserve
parser AST contracts should Jess consider a compiler opt-in path.
