# @jesscss/parser

Shared parser infrastructure for Jess-family stylesheet parsers.

This package currently has two layers:

1. A hand-written recursive-descent parser runtime used by existing parser packages.
2. A scanner-first structural parsing substrate for the next CSS/Less/Jess parser work.

The scanner-first layer is experimental. Its job is to provide cheap source,
scanner, range, diagnostic, trivia, and recovery primitives that language parser
packages can use without eagerly parsing every selector/value/prelude. The
preferred CSS/Less replacement proof should produce existing AST nodes with
string/deferred fields as early as that is cheaper and clearer than a parallel
structural tree.

## What This Package Is

`@jesscss/parser` owns generic parsing infrastructure:

- immutable source text and lazy line/column mapping
- low-level scanning helpers for strings, comments, delimited blocks, trivia, and recovery
- half-open source offsets and optional structural records for broad scanning
- optional side tables for source-backed fields such as selector, name, prelude,
  body, and value when node-owned state is not enough
- experimental deferred-parse records for fields a language package may parse
  later; these are cut candidates, not target architecture
- optional services for deferred field hydration, visitor materialization plans, semantic indexes, and language activation

Language packages and plugins provide language-specific profiles and deferred field parsers.
The parser package should not need hard-coded exports such as `cssProfile` or
`lessProfile`.

## What This Package Is Not

The scanner-first layer is not a complete CSS, Less, SCSS, or Jess parser by itself.

It does not:

- require `@jesscss/parser` itself to import `@jesscss/core`
- prevent CSS/Less parser packages from constructing existing core AST nodes
  directly
- decide final Less/Jess language semantics
- eagerly parse every selector, value, function call, media query, or interpolation
- require every visitor-visible historical node shape to survive
- make today's structural schema sacred

Language-specific parser packages decide the first useful output. For CSS/Less,
the preferred proof is existing AST nodes with string fields and node-owned
hydration state. Temporary structural records are allowed only where they prove
cheaper or clearer than those nodes.

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

The current prototype stores offsets into one `SourceText`. The readable field
labels above come from a side table. The target CSS/Less path may instead store
string values directly on existing AST fields, with optional packed spans on the
owning node when offsets or hydration state are needed.

Packed span terminology:

- `node.fieldSpans` is for direct fields, keyed by that node's static `childKeys`
  order as `[start, end, flags]` triples.
- array-backed fields use field-specific segment tables, such as
  `node.valueSpans`, keyed by array index inside that field.

That split keeps `Declaration.value` as a plain string, node, or array without
making one packed table mean both "the whole value field" and "each value item."
It also means simple ordered declaration values can eventually be represented as
plain arrays plus segment spans instead of wrapper nodes whose only purpose is
ordering.

If a profile marks `.foo` as an unparsed selector field or `red` as an unparsed
declaration-value field, the current prototype can store those spans separately
and request a typed value later. That current API is still named around "islands";
the concept should be understood as deferred field parsing, not a new public node
family.

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

In the current implementation, this flow allocates the experimental structural
tree, field range side table, trivia ranges, diagnostics, and deferred parse
records discovered by the profile. Those shapes are accounting targets, not final
requirements.

### Deferred Field Parsing

Use this when a caller reaches an AST field and needs typed structure instead of
the cheap string value.

Preferred target shape:

```ts
const declaration = {
  type: 'Declaration',
  name: 'color',
  value: 'rgb(10, 20, 30)',
  important: false
};
```

If evaluation later needs call details, the owning declaration can hydrate its
`value` field while preserving the same serialized output. Any offset,
provenance, or hydration state should first be considered as state owned by that
AST node, possibly in a compact internal table.

The current prototype still has `IslandParsePlan` and `RawIslandNode` APIs for
deferred spans. Treat those names as implementation accounting targets, not the
recommended public model.

### Language Activation

`LanguageActivationRegistry` binds caller-owned profiles and optional provider setup
to extensions:

```ts
activationRegistry.register({
  name: languageProfile.name,
  profile: languageProfile,
  supportedExtensions: ['.example'],
  configureDeferredFieldParsers(registry) {
    registerLanguageDeferredFieldParsers(registry);
  }
});
```

The activation registry is the intended extension point for first-party and
third-party stylesheet languages. It records profile/extension bindings without
hard-coding language names into the parser package.

The current prototype still contains `configureIslandProviders`; target APIs
should use deferred-field terminology if this provider layer survives.

## Requirements And Implementation Map

Start with these package-local docs:

- [docs/requirements-and-scope.md](docs/requirements-and-scope.md) defines the
  fixed needs, non-goals, slice order, and questions every new shape has to
  answer.
- [docs/implementation-map.md](docs/implementation-map.md) accounts for the
  current code and objects, then maps them back to those requirements.

## Current Status

The scanner-first layer is a prototype for replacing CSS/Less parser machinery.
It is expected to change as the CSS/Less path proves a complete parse path and as
object creation is measured against real corpus and benchmark gates.

Do not treat current service placement, visitor planning shapes, or deferred-span
object storage as final API. The fixed design pressure is smaller: parse cheaply,
store offsets first, preserve recoverable diagnostics, keep language-specific work
out of the broad boundary pass, and materialize typed shapes only when a caller
proves it needs them.
