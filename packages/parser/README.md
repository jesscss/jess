# @jesscss/parser

Shared parser infrastructure for Jess-family stylesheet parsers.

This package currently has two layers:

1. A hand-written recursive-descent parser runtime used by existing parser packages.
2. A scanner-first structural parsing substrate for the next CSS/Less/Jess parser work.

The scanner-first layer is experimental. Its job is to identify stylesheet structure,
source ranges, diagnostics, trivia, and lazy parse targets without creating compiler
AST nodes or eagerly parsing every selector/value/prelude.

## What This Package Is

`@jesscss/parser` owns generic parsing infrastructure:

- immutable source text and lazy line/column mapping
- low-level scanning helpers for strings, comments, delimited blocks, trivia, and recovery
- structural document nodes with half-open source offsets
- side tables for source-backed fields such as selector, name, prelude, body, and value
- raw islands that mark spans a language package can parse later
- optional services for island providers, visitor materialization plans, semantic indexes, and language activation

Language packages and plugins provide language-specific profiles and island providers.
The parser package should not need hard-coded exports such as `cssProfile` or
`lessProfile`.

## What This Package Is Not

The scanner-first layer is not a complete CSS, Less, SCSS, or Jess parser by itself.

It does not:

- import `@jesscss/core` or create core AST nodes in the structural pass
- decide final Less/Jess language semantics
- eagerly parse every selector, value, function call, media query, or interpolation
- require every visitor-visible historical node shape to survive
- make today's structural schema sacred

Language-specific parser packages decide when a structural node or raw island becomes
a typed language AST shape. That conversion layer is still under design.

## Structural Example

Input:

```less
.foo {
  color: red;
  @width: 12px;
}
```

Simplified structural shape:

```txt
document 0..35
  rule 0..34
    selector field: 0..4
    body field: 10..32
    declaration 10..20
      name field: 10..15
      value field: 17..20
    variable-declaration 23..34
      name field: 23..29
      value field: 31..34
```

The actual runtime stores offsets into one `SourceText`. The readable field labels
above come from a side table; they are not copied string fields on every node.

If a profile marks `.foo` as a selector island or `red` as a declaration-value
island, those islands are stored separately and can be requested later by an
`IslandParsePlan`.

## Common Flows

### Structural Only

Use this when a caller needs containment, folding, document symbols, diagnostics,
or coarse indexing without typed AST materialization.

```ts
import { parseStructure } from '@jesscss/parser';

const document = parseStructure(sourceText, languageProfile);
const symbols = document.symbols();
const ranges = document.foldingRanges();
const stats = document.stats();
```

This flow should allocate only the structural tree, field range side table, trivia
ranges, diagnostics, and raw island records discovered by the profile.

### Lazy Island Parsing

Use this when a caller reaches a structural node and needs one typed view of a
specific source span.

```ts
import { IslandParsePlan, IslandParserRegistry } from '@jesscss/parser';

const registry = new IslandParserRegistry();
registry.register(
  { language: languageProfile.name, islandKind: 'selector', targetShape: 'selector' },
  context => ({ value: parseSelector(context.document.source.slice(context.island.start, context.island.end)) })
);

const plan = new IslandParsePlan(document, registry);
const [requestId] = plan.requestNode(ruleNode, 'selector');
const result = plan.execute(requestId);
```

Provider execution is explicit. Creating a structural document does not configure
providers or parse islands.

### Language Activation

`LanguageActivationRegistry` binds caller-owned profiles and optional provider setup
to extensions:

```ts
activationRegistry.register({
  name: languageProfile.name,
  profile: languageProfile,
  supportedExtensions: ['.example'],
  configureIslandProviders(registry) {
    registerLanguageIslandProviders(registry);
  }
});
```

The activation registry is the intended extension point for first-party and
third-party stylesheet languages. It records profile/extension bindings without
hard-coding language names into the parser package.

## Schema And Complexity Map

Start with these package-local docs:

- [docs/requirements-and-scope.md](docs/requirements-and-scope.md) defines the
  fixed needs, non-goals, slice order, and questions every new shape has to
  answer.
- [docs/STRUCTURAL-SCHEMA.md](docs/STRUCTURAL-SCHEMA.md) maps the current
  structural schema, side tables, services, and allocations back to those
  requirements.

## Current Status

The scanner-first layer is a prototype for replacing CSS/Less parser machinery.
It is expected to change as the CSS/Less path proves a complete parse path and as
object creation is measured against real corpus and benchmark gates.

Do not treat current service placement, visitor planning shapes, or raw-island
object storage as final API. The fixed design pressure is smaller: parse cheaply,
store offsets first, preserve recoverable diagnostics, keep language-specific work
out of the structural pass, and materialize typed shapes only when a caller proves
it needs them.
