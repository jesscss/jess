# Structural Schema

This document maps the current `@jesscss/parser` structural model to the fixed
requirements it is supposed to satisfy. It is also an audit surface: if a shape
does not clearly serve a requirement, it should be simplified, moved to a colder
stage, or removed.

The guiding question is: is this work absolutely necessary to get a correct
result?

## Fixed Requirements

| Requirement | Current schema answer | Notes |
| --- | --- | --- |
| Offset-first parsing | Every structural node uses `start` / `end` UTF-16 offsets | Line/column is lazy through `SourceText.lineMap` |
| Fast broad parse | `parseStructure` emits containers, statements, trivia, diagnostics, field ranges, and raw islands | It should not build selector/value ASTs |
| Recovery mode | Scanner diagnostics plus `error` nodes mark recoverable boundaries | Ordinary recovery should not throw |
| Plugin-owned languages | `LanguageProfile` is supplied by language/parser packages | This package should not export `cssProfile`, `lessProfile`, etc. |
| Demand-driven typed parsing | `RawIslandNode` marks spans that may later be parsed | Island providers run only through explicit plan execution |
| Demand-driven visitors | Visitor helpers derive possible materialization rules | Traversal still requests islands only for reached nodes |
| Source-backed fields | `FieldRangeTable` stores offsets for `name`, `value`, `selector`, `prelude`, and `body` | Avoid wrapper objects on every field |
| Editor/index support | `StructuralDocument` exposes `findNodeAt`, `scopeAt`, `symbols`, `foldingRanges`, and `changedRanges` | These are cold query APIs and may allocate result arrays |
| Performance accountability | Stats and counters expose object/range counts | Probes are evidence tools, not production requirements |

## Source Model

`SourceText` owns immutable source text plus optional `filePath` and `version`.
Offsets are half-open UTF-16 ranges into `SourceText.text`.

`LineMap` is built lazily on the first call that needs human-readable positions:

```ts
source.offsetToLineColumn(offset);
source.lineColumnToOffset(line, column);
```

Structural parsing, semantic indexing, island planning, and incremental
invalidation should stay offset-first. Diagnostics, editor squiggles, hover
ranges, source maps, and other human-facing outputs can force the line map when
they need it.

## Node Kinds

Structural nodes describe broad source ownership, not language AST semantics.

| Kind | Fields | Represents | Does not represent |
| --- | --- | --- | --- |
| `document` | `children`, `headerStart`, `headerEnd`, `bodyStart` | Root container for one source file | A compiler stylesheet node |
| `rule` | `children`, header/body offsets | Rule-like block, usually a selector block | Parsed selector list or normalized selector AST |
| `at-rule` | `children`, header/body offsets | Block at-rule such as media/supports/keyframes containers | Statement at-rules without bodies |
| `block` | `children`, header/body offsets | Generic nested block when the profile cannot classify more specifically | A final language-level block node |
| `mixin-definition` | `children`, header/body offsets | Less-like mixin definition container | Parsed parameter/default/guard AST |
| `declaration` | name/value offsets | Property declaration boundary | Parsed property/value nodes |
| `variable-declaration` | name/value offsets | Less/Sass/Jess variable declaration boundary | Bound variable runtime entry |
| `import` | name/value offsets | Import statement boundary | Resolved import or loaded file |
| `at-rule-statement` | name/value offsets | Non-block at-rule such as `@charset` or namespace/import-like statements | Block at-rule container |
| `mixin-call` | name/value offsets | Less-like mixin call statement boundary | Evaluated mixin call |
| `raw-island` | `islandKind`, `owner` | Lazy parse target indexed beside the tree | A child in normal structural traversal |
| `error` | `diagnostic` | Recoverable parse boundary | Fatal parser exception |

All nodes share:

```ts
type StructuralNodeBase = {
  kind: StructuralNodeKind;
  start: number;
  end: number;
  parent?: StructuralContainerNode;
};
```

Container nodes add:

```ts
type StructuralContainerNode = StructuralNodeBase & {
  kind: 'at-rule' | 'block' | 'document' | 'mixin-definition' | 'rule';
  headerStart: number;
  headerEnd: number;
  bodyStart: number;
  children: StructuralNode[];
};
```

Statement nodes add:

```ts
type StructuralStatementNode = StructuralNodeBase & {
  kind: 'at-rule-statement' | 'declaration' | 'import' | 'mixin-call' | 'variable-declaration';
  nameStart: number;
  nameEnd: number;
  valueStart: number;
  valueEnd: number;
};
```

## Field Ranges

`FieldRangeTable` is a side table keyed by node object identity. It stores field
metadata in parallel arrays rather than allocating a range object for every
field during parsing.

Supported field names:

```ts
type FieldRangeName = 'body' | 'name' | 'prelude' | 'selector' | 'value';
```

Supported coarse field kinds:

```ts
type FieldRangeKind =
  | 'at-rule-name'
  | 'body-text'
  | 'declaration-name'
  | 'import-name'
  | 'mixin-name'
  | 'prelude'
  | 'selector'
  | 'value';
```

Readable `FieldRange` objects are allocated only when callers request them:

```ts
document.fieldRanges.get(node, 'value');
document.fieldRanges.rangesFor(node);
```

This table is the current answer to "store strings or offsets separately": the
structural layer keeps source-backed offsets, while downstream progressive AST
nodes may choose literal strings, mixed string/node arrays, or typed nodes as
their own runtime representation.

## Raw Islands

Raw islands are side-indexed lazy parse targets:

```ts
type RawIslandNode = StructuralNodeBase & {
  kind: 'raw-island';
  islandKind: IslandKind;
  owner: StructuralNode;
};
```

Current island kinds:

```ts
type IslandKind =
  | 'at-rule-prelude'
  | 'control-condition'
  | 'declaration-value'
  | 'extend-candidate'
  | 'interpolation'
  | 'mixin-call'
  | 'mixin-definition'
  | 'selector'
  | 'variable-reference';
```

An island says "this span can be promoted if a later stage asks." It does not
mean the span must be parsed, visited, normalized, or converted to core AST
during the structural pass.

## Example Shape

For:

```less
.button {
  color: @brand;
}
```

the structural tree should stay close to:

```txt
document 0..29
  rule 0..28
    declaration 12..26
```

Side metadata carries the useful subranges:

```txt
rule.selector              ".button"
rule.body                  "\n  color: @brand;\n"
declaration.name           "color"
declaration.value          "@brand"
raw-island(selector)       owner: rule
raw-island(value)          owner: declaration
raw-island(variable-ref)   owner: declaration
```

No `BasicSelector`, keyword, color, call, expression, or reference node is
created by this package during the structural pass.

## Language Profiles

A `LanguageProfile` supplies cheap structural heuristics:

- variable prefixes
- interpolation openers
- statement starter classification
- at-rule classification
- declaration-name classification
- rule-header classification
- island classification

Profiles must stay cheap and side-effect free. They classify source ranges; they
do not build AST nodes or run plugin behavior.

Third-party language support should come from parser/plugin packages registering
profiles and island providers. This package must not hardcode a closed set of
language names or extensions.

## Services

Services sit after structural parsing. They should not be treated as part of the
parse hot path unless a caller explicitly constructs and uses them.

| Service | Purpose | Allocation profile |
| --- | --- | --- |
| `LanguageActivationRegistry` | Associates extensions with language profiles and provider setup callbacks | Registry setup, not per-node parse work |
| `IslandParserRegistry` | Maps language/island/target/config keys to providers | Provider lookup table |
| `IslandParsePlan` | Deduplicates lazy parse requests and executes providers on demand | Several maps and request arrays; keep out of broad parse hot path |
| `SemanticIndexBuilder` | Indexes imports/variables structurally and queues lazy reference/mixin/extend requests | Cold index-building maps/arrays |
| `VisitorMethodTableCache` | Derives visitor-observable node/island sets from method names | WeakMap cache keyed by visitor object |

## Visitor Planning

Visitor planning answers "what could this visitor observe if traversal reaches a
matching structural node?"

It does not answer "parse the whole file now."

For example, a visitor with `visitDeclaration` can imply declaration-value
islands. Traversal still has to reach a `declaration` node before
`requestVisitorNode(...)` asks for that declaration's islands. A generic
`visit(node)` may produce broad rules, but it still materializes only the
islands owned by reached nodes.

The current method table intentionally mirrors known Less/Jess visitor surfaces,
but it is not final. Public visitor research should keep reducing which leaves
are actually visitable.

## Object Creation Map

### Structural Parse Hot Path

Expected object creation:

- one `SourceText` when the caller provides a string
- one mutable scanner cursor while scanning
- one root `document` container
- one structural node per broad container or statement
- one `RawIslandNode` per lazy parse target that has a known consumer
- one trivia record per skipped trivia run
- one diagnostic and `error` node per recovery boundary
- side-table numeric entries for source-backed fields

### Cold Query / Planning Paths

These allocate by design and should be measured separately from structural parse:

- `FieldRangeTable.get(...)` and `rangesFor(...)` allocate readable range objects
- `StructuralDocument.symbols()` and `foldingRanges()` allocate result arrays
- `StructuralDocument.stats()` walks the tree and returns a report object
- `IslandParsePlan` allocates maps, request ids, execution records, and counters
- `SemanticIndexBuilder` allocates index maps and query results
- `VisitorMethodTableCache` allocates method tables per visitor/target shape
- probe summaries allocate reports for tests and benchmark inspection

## Simplification Targets

These are open review points, not blessed architecture:

- `RawIslandNode` count may be too high if public visitor research shows fewer
  leaf surfaces should be visible.
- `IslandParsePlan` currently owns many maps and counters. That is acceptable as
  a cold coordinator, but it should not become a normal parse-loop dependency.
- `FieldRangeTable` still stores node references and parallel JS arrays. A more
  packed side table or typed-array representation may be worth testing after the
  feature set stabilizes.
- Parent pointers make `scopeAt` cheap to implement but add graph edges to every
  node. If parent lookup is cold enough, this should be benchmarked against a
  parent side table.
- `block` and some island kinds may be transitional if CSS/Less structural
  parsing can classify those spans more directly.

## Acceptance Checklist For New Shapes

Before adding a structural node, side table, island kind, or service map:

- [ ] Identify the requirement it satisfies.
- [ ] State whether it is created during structural parse, cold query, or
  provider execution.
- [ ] Check whether an existing node plus `FieldRangeTable` can represent it.
- [ ] Identify the consumer that requests it.
- [ ] Add a test proving unsupported consumers do not force materialization.
- [ ] Add a corpus or fixture test proving the scanner boundary.
- [ ] Update this document if the schema changes.

## Non-Goals

The structural schema is not:

- a replacement compiler AST
- a normalized selector or declaration-value model
- a source map output format
- a final Less/Jess visitor API
- a binding, lookup, eval, or render model
- proof that all current objects are justified

Those responsibilities belong to downstream parser packages, adapter layers, or
the compiler/runtime architecture work.
