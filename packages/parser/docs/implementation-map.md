# Scanner-First Implementation Map

This document maps the current `@jesscss/parser` scanner-first code to
[requirements-and-scope.md](requirements-and-scope.md).

It is intentionally an accounting document. If an object exists, this document
should say which requirement pays for it. If the requirement is weak, optional,
or unproven, the object should be treated as a cleanup target.

## Current Package Layers

`@jesscss/parser` currently exports both:

1. the older recursive-descent parser runtime in `src/parser.ts`
2. the scanner-first substrate under `src/source`, `src/scanner`, `src/profiles`,
   `src/structure`, and `src/services`

Only the second layer is covered here.

## Structural-Only Parse Allocation Path

Calling `parseStructure(input, profile, options)` currently creates these objects
and collections:

| Created during structural parse | Code | Requirement | Why it exists | Review pressure |
| --- | --- | --- | --- | --- |
| `SourceText` when input is a string | `src/source/source-text.ts` | R1 | Owns the immutable source string, optional file path/version, and lazy line map. | Required. Avoid adding per-node source strings. |
| `ScannerCursor` | `src/scanner/cursor.ts` | R2, R5 | Tracks current offset while scanning. | Required. Should stay parser-local and short-lived. |
| `ParserDiagnostic[]` | `src/scanner/diagnostics.ts` | R5 | Records structural scanner errors. | Required, but diagnostics should only allocate for errors. |
| `TriviaRun[]` | `src/source/spans.ts` | R6 | Records whitespace/comment/newline ranges outside nodes. | Required for now, but object-per-trivia-run is a packing candidate. |
| `RawIslandNode[]` | `src/structure/types.ts` | R4 | Records deferred parse targets by kind and owner. | Required concept; object-per-island is a major packing candidate. |
| `FieldRangeTable` | `src/structure/field-ranges.ts` | R1, R6, R7 | Stores field offsets without adding wrapper objects to nodes. | Mostly justified; lookup is linear and should stay cold or be redesigned. |
| root `StructuralContainerNode` | `src/structure/parse.ts` | R2 | Document container. | Required. |
| one structural node per detected container/statement/error | `src/structure/types.ts` | R2, R5 | Captures containment and source ranges. | Required concept; exact object shape is not sacred. |
| `StructuralDocument` facade | `src/structure/document.ts` | R2 | Exposes root, diagnostics, trivia, field ranges, islands, and cold queries. | Required facade; avoid adding hot-path cached indexes here. |

The structural parse should not create:

- core AST nodes
- selector/value/media-query AST nodes
- island provider registries
- semantic indexes
- visitor method tables
- line maps, unless a caller asks for line/column positions

## On-Demand Allocation Path

These allocations should happen only when a caller asks for a service.

| Created on demand | Code | Requirement | Trigger | Review pressure |
| --- | --- | --- | --- | --- |
| `LineMap` and `lineStarts` array | `src/source/line-map.ts` | R1, R5 | `source.lineMap`, `offsetToLineColumn`, or `lineColumnToOffset` | Required; char-code loop avoids substring allocation. |
| readable `FieldRange` objects | `src/structure/field-ranges.ts` | R1, R6 | `fieldRanges.get` or `rangesFor` | Acceptable if cold. Do not use this as a hot parser path. |
| arrays from `foldingRanges()` and `symbols()` | `src/structure/document.ts` | R2, R5 | editor/index queries | Optional service cost. |
| `IslandParserRegistry` | `src/services/registry.ts` | R3, R4 | caller creates a lazy parse plan or activation configures providers | Required for lazy provider proof, but should not exist in structural-only parse. |
| `IslandParsePlan` maps and counters | `src/services/island-parse-plan.ts` | R4, R8 | caller asks for lazy island execution | High review pressure. The concept is required; the current map count may be too high. |
| `IslandParseRequest` views | `src/services/island-parse-plan.ts` | R4 | `requestView` or `execute` | Cold allocation; avoid when request ids are enough. |
| provider result values | language provider | R4, R7 | `plan.execute(id)` | Required only for spans that need typed parsing. |
| `SemanticIndexBuilder` indexes | `src/services/semantic-index.ts` | R4, R5, R10 | caller asks for imports, variables, mixins, extends, or references | Useful proof, but optional. May belong above the parser substrate. |
| visitor method tables and rules | `src/services/visitor-shape.ts` | R8 | visitor integration asks for materialization planning | Optional until visitor scope is finalized. |
| `LanguageActivationRegistry` maps | `src/services/language-activation.ts` | R3, R10 | plugin/parser layer registers extensions | Required concept; should remain small and not instantiate parsers eagerly. |

## Requirement-To-Code Map

### R1. Offset-First Source Model

Implemented by:

- `SourceText`
- `LineMap`
- `SourceSpan`
- `FieldRangeTable`
- all structural nodes using `start`/`end`

Objects created:

- one `SourceText` per string input
- zero `LineMap` objects during structural-only parse
- one `LineMap` plus one line-start array only when line/column conversion is requested

Current fit:

- Good. The package already stores offsets first.
- `SourceText.stats()` computes byte length with `TextEncoder`; this is a cold
  reporting path, not parser work.

Watchlist:

- Do not add per-node line/column fields.
- Do not add per-node source slices as canonical state.

### R2. Cheap Structural Containment

Implemented by:

- `parseStructure`
- `scanToStructuralBoundary`
- `createContainerNode`
- `createStatementNode`
- `StructuralContainerNode`
- `StructuralStatementNode`
- `StructuralDocument`

Objects created:

- one object per structural container
- one object per structural statement
- one `children` array per container

Current fit:

- Mostly aligned. The parse stage recognizes broad shape and avoids selector/value
  AST construction.
- It still classifies enough statement/container kind to support later decisions.

Watchlist:

- Every new structural node kind must prove it changes a decision that cannot be
  derived from field ranges plus source text.
- The structural tree is object-based. A packed table might reduce allocations,
  but it would make the current API harder to use. Do not change without
  benchmark pressure.

### R3. Language Profiles Are Caller-Owned

Implemented by:

- `LanguageProfile`
- `createLanguageProfile`
- `LanguageActivation`
- `LanguageActivationRegistry`

Objects created:

- no profile objects by the structural parser
- registry maps only if a caller creates a `LanguageActivationRegistry`

Current fit:

- Good. The parser package defines profile contracts but does not need named
  CSS/Less/SCSS/Jess profile exports.

Watchlist:

- Do not add hard-coded language profiles or default extension bindings to this
  package.
- Provider setup should stay outside structural-only parse.

### R4. Lazy Typed Parsing

Implemented by:

- `RawIslandNode`
- `profile.classifyIsland`
- `IslandParserRegistry`
- `IslandParsePlan`
- `IslandProviderKey`
- `IslandParseRequestId`
- `IslandExecutionRecord`

Objects created during structural parse:

- one `RawIslandNode` object per classified island

Objects created only when planning/executing:

- `IslandParsePlan`
- request-key arrays
- several maps for request ids, request views, executions, diagnostics, visitor
  plans, and owner-to-island lookup
- provider result records

Current fit:

- The requirement is valid: later stages need a way to parse a selector/value
  span without full-tree materialization.
- The current service implementation may be too complex for the proven scope.

Watchlist:

- `RawIslandNode` as a normal object is the clearest structural-only allocation
  target. A packed island table could store owner index, kind code, start, and end.
- `IslandParsePlan` has enough maps that it must stay out of structural-only parse.
- Missing provider should remain an explicit fallback signal, not normal parser
  success.

### R5. Recoverable Diagnostics

Implemented by:

- `ParserDiagnostic`
- `createParserDiagnostic`
- `recoverToNextBoundary`
- `ErrorNode`
- unclosed-block recovery in `parseStructure`
- lazy line/column conversion through `SourceText`

Objects created:

- diagnostics only when errors are found
- `ErrorNode` only for structural recovery markers

Current fit:

- Aligned with requirements. Error objects are not used for normal control flow.

Watchlist:

- Do not throw/catch for expected parser misses.
- Diagnostics should keep offsets and defer human-readable location mapping.

### R6. Trivia And Source Identity

Implemented by:

- `TriviaRun`
- `scanTriviaInto`
- `FieldRangeTable`

Objects created:

- one `TriviaRun` per trivia range
- one side-table row per recorded field segment

Current fit:

- The design keeps trivia and field offsets outside node payloads.
- The object count for trivia may be significant in large corpora.

Watchlist:

- Pack trivia if corpus allocation pressure says it matters.
- Avoid creating wrapper nodes for string values only to carry offsets.

### R7. Progressive Node Shapes

Implemented in this package by:

- structural nodes carrying offsets instead of typed payloads
- `FieldRangeTable` preserving source identity for names/values/selectors
- raw islands marking possible future typed views

Implemented outside this package:

- actual CSS/Less/core AST node shape changes
- getters or progressive materialization on language AST nodes
- render/eval behavior from mixed string/node values

Objects created:

- no core AST nodes in `@jesscss/parser`
- no progressive CSS/Less AST nodes in this package

Current fit:

- The parser substrate supports progressive shapes but does not implement the
  final language AST layer.

Watchlist:

- Do not add `rawName`, `rawValue`, `valueNode`, or parallel payload fields as a
  substitute for correctly named `name`, `value`, `selector`, `rules`, etc.
- If getters are used later, implementations should cache private field reads in
  local variables inside hot getters instead of repeatedly reading private fields.

### R8. Visitor Support Is Conditional

Implemented by:

- `VisitorShape`
- `VisitorMaterializationRule`
- `VisitorMethodTableCache`
- `IslandParsePlan.planVisitor`
- `IslandParsePlan.requestVisitorNode`

Objects created:

- visitor method cache entries when analyzing visitor objects/classes
- materialization rule arrays
- visitor-related request ids only as traversal reaches matching nodes

Current fit:

- Conceptually aligned: visitor planning is demand-driven by shape and traversal.
- Scope is not yet proven enough to treat this as required structural machinery.

Watchlist:

- Public Less visitor survey results must document exactly what is visited.
- Some selector/value leaves may intentionally never be visitor-visible in Jess.
- If visitor planning stays optional, consider whether it belongs in a separate
  adapter package or service layer rather than the core parser substrate.

### R9. Corpus And Benchmark Gates

Implemented by:

- parser package tests under `src/__tests__`
- Less corpus structural tests in downstream packages
- `StructuralDocument.stats()`
- service counters in `IslandParsePlan` and `SemanticIndexBuilder`

Objects created:

- stats objects only when requested
- counters live on service objects, not structural nodes

Current fit:

- Structural corpus gates exist and are useful.
- Counters are instrumentation, not performance proof.

Watchlist:

- Do not claim faster parsing/evaluation until measured against real Less
  benchmark files and corpus paths.
- Structural-only success is not the same as CSS/Less parse/eval/render success.

### R10. DRY Across CSS/Less/SCSS/Jess

Implemented by:

- shared source/scanner helpers
- shared structural node contracts
- shared profile contract
- shared island provider contract
- language activation registry

Objects created:

- no language-specific parser instances during structural parse
- activation/provider objects only when caller creates them

Current fit:

- Good direction for scanner/source/profile reuse.
- Language-specific parser productions still need to be rebuilt on this stack.

Watchlist:

- DRY should not mean one package owns all language semantics.
- CSS/Less should prove the path before SCSS/Jess expansion.

## Current Structural Schema

All source ranges are half-open UTF-16 offsets into `document.source.text`.

### StructuralDocument

```ts
class StructuralDocument {
  readonly source: SourceText;
  readonly profile: LanguageProfile;
  readonly root: StructuralContainerNode;
  readonly diagnostics: readonly ParserDiagnostic[];
  readonly trivia: readonly TriviaRun[];
  readonly fieldRanges: ReadonlyFieldRangeTable<StructuralNode>;

  findNodeAt(offset: number): StructuralNode | undefined;
  scopeAt(offset: number): readonly StructuralContainerNode[];
  foldingRanges(): readonly FoldingRange[];
  symbols(): readonly DocumentSymbol[];
  islands(kind?: IslandKind): readonly RawIslandNode[];
  changedRanges(previous: StructuralDocument): readonly ChangedRange[];
  stats(previous?: StructuralDocument): StructuralDocumentStats;
}
```

### StructuralContainerNode

```ts
type StructuralContainerNode = {
  kind: 'document' | 'rule' | 'at-rule' | 'mixin-definition' | 'block';
  start: number;
  end: number;
  parent?: StructuralContainerNode;
  headerStart: number;
  headerEnd: number;
  bodyStart: number;
  children: StructuralNode[];
};
```

Meaning:

- `start..end` covers the structural container.
- `headerStart..headerEnd` covers the text before `{`.
- `bodyStart` is just after `{`.
- body end is derived from `end` and the closing `}`.
- typed selector/prelude/signature parsing is not done here.

### StructuralStatementNode

```ts
type StructuralStatementNode = {
  kind:
    | 'at-rule-statement'
    | 'declaration'
    | 'import'
    | 'mixin-call'
    | 'variable-declaration';
  start: number;
  end: number;
  parent?: StructuralContainerNode;
  nameStart: number;
  nameEnd: number;
  valueStart: number;
  valueEnd: number;
};
```

Meaning:

- `start..end` covers the statement without the semicolon boundary.
- `nameStart..nameEnd` covers the declaration/property/import/mixin name.
- `valueStart..valueEnd` covers the value/prelude/call tail.
- typed value parsing is not done here.

### RawIslandNode

```ts
type RawIslandNode = {
  kind: 'raw-island';
  islandKind: IslandKind;
  owner: StructuralNode;
  start: number;
  end: number;
  parent?: StructuralContainerNode;
};
```

Meaning:

- an island is a deferred parse target
- it is side-indexed, not a structural child
- `owner` links it to the structural node that caused the island
- `islandKind` says what kind of later parsing might be useful

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

### ErrorNode

```ts
type ErrorNode = {
  kind: 'error';
  start: number;
  end: number;
  parent?: StructuralContainerNode;
  diagnostic: ParserDiagnostic;
};
```

Meaning:

- records a recovery point in the structural tree
- only created for malformed source or recovery boundaries

## Structural Parse Pipeline

Current high-level flow:

1. Wrap input in `SourceText` if needed.
2. Create `ScannerCursor`, root document node, field range table, diagnostics,
   trivia, and island arrays.
3. Scan trivia into the trivia side list.
4. Scan to the next structural boundary.
5. While scanning, skip strings, comments, balanced parens/brackets, `url(...)`,
   and component-value blocks that should not open structural containers.
6. On `{`, create a container node and push it on the stack.
7. On `;` or `}`, create a statement node if the trimmed range is non-empty.
8. On `}`, close the current block and add body field metadata.
9. On EOF, recover unclosed blocks with diagnostics and error nodes.
10. Return `StructuralDocument`.

## Current Object-Creation Hotspots

These are the highest-priority review areas because they allocate during or near
the intended parser path.

### 1. Raw Islands As Objects

Problem:

- every classified island is a standalone object
- the all-Less structural gate already shows many island records

Possible cut:

- replace `RawIslandNode[]` with a packed island table:
  - owner index or owner reference
  - island kind code
  - start offset
  - end offset

Keep object views only for cold API reads.

### 2. Trivia Runs As Objects

Problem:

- every trivia run is a standalone object
- large files can have many whitespace/comment runs

Possible cut:

- packed trivia table with kind code, start, end
- allocate readable `TriviaRun` objects only for callers that ask

### 3. FieldRangeTable Lookup Shape

Problem:

- storage is compact-ish, but lookup scans linearly and holds node references

Current defense:

- field-range queries are cold metadata queries
- structural parse avoids per-field wrapper objects

Possible cut:

- keep as-is until field lookups enter a hot path
- if hot, add node-indexed ranges or use structural node ids instead of object keys

### 4. IslandParsePlan Map Count

Problem:

- the plan owns several maps and arrays:
  - request id cache
  - request views
  - execution cache
  - diagnostics
  - visitor plans
  - islands by owner
  - request key/provider/island arrays

Current defense:

- none of this is allocated during structural-only parse
- request ids and execution records are needed for lazy provider proof

Possible cut:

- split visitor planning from normal island execution
- move visitor support out of the parser substrate until visitor scope is proven
- simplify request caching once real CSS/Less late parsing shows actual needs

### 5. SemanticIndexBuilder Placement

Problem:

- semantic indexes may be useful, but they are not required for structural parse
- maps/arrays may belong in language-service or compiler adapter layers

Current defense:

- builder is opt-in and demonstrates structural-only indexing

Possible cut:

- keep it opt-in
- move it if the parser package should remain only source/scanner/structure/provider
  contracts

## Current Corpus Accounting

Recent Less structural gate after raw `url(...)` scanner support:

```txt
files: 320
structural records: 24,968
raw islands: 14,152
trivia ranges: 23,410
diagnostic files: 10
diagnostics: 14
```

This is evidence for object-accounting discussion, not proof that the current
shape is optimal.

The raw island and trivia counts are the strongest hint that packed side tables
may matter before this becomes the canonical parser path.

## What Is Not Yet Delivered

The current package does not yet prove:

- full CSS parser replacement
- full Less parser replacement
- Less-to-CSS output equality through the new parser path
- benchmark wins against Less 4.x or current Jess parser/eval/render
- Chevrotain-free late parsing for all CSS/Less production families
- final progressive core AST shape
- final visitor compatibility policy

Those belong to the next CSS/Less parser replacement slices, not to the current
structural substrate alone.

## Cut-Line Checklist

Before keeping or adding an object in this package, require one of these answers:

- It is part of structural containment or recovery.
- It stores source offsets that cannot be cheaply derived later.
- It allows a later parser/provider to avoid full-tree materialization.
- It is allocated only when a caller asks for an optional service.
- It is instrumentation needed to verify performance or object count.

If none apply, the shape should be deleted, moved out of `@jesscss/parser`, or
held as a documented experiment instead of folded into the substrate.
