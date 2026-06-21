# Scanner-First Parser Requirements And Scope

This document defines what `@jesscss/parser` is expected to support for the
scanner-first parser experiment. It is the contract the implementation map should
be checked against.

The important distinction:

- Needs explain why this project exists.
- Requirements define what must be true for the project to be useful.
- Scope boundaries define what should not be built yet.
- Open questions identify places where the current implementation may be larger
  than the proven requirement.

## Project Need

Jess needs a parser path that can eventually replace Chevrotain-based CSS/Less
parsing without carrying forward unnecessary node creation, eager parsing, or
language-specific assumptions.

The desired path is:

```txt
source
  -> cheap structure and offsets
  -> render/evaluate from that structure where possible
  -> parse only the spans that a later decision proves necessary
  -> serialize or report diagnostics
```

The first milestone is CSS/Less, not SCSS/Jess. The parser substrate should be
generic enough for future Jess-family languages, but CSS/Less must prove the
approach before the project expands.

## Primary Goals

1. Parse as little as possible up front.
2. Store source offsets first; compute line/column positions lazily.
3. Preserve recoverable diagnostics and enough recovery state for useful errors.
4. Avoid hard-coded language profiles in `@jesscss/parser`.
5. Support third-party language activation through plugin-owned profiles and
   providers.
6. Enable lazy parsing/materialization when evaluation, extend matching, imports,
   visitors, diagnostics, or editor features prove they need it.
7. Measure object creation, branching, and runtime cost against real CSS/Less
   corpora and benchmark files.
8. Keep the design DRY across CSS, Less, SCSS, and Jess by sharing scanner and
   structural primitives, not by forcing every language into one eager AST.
9. Keep the parse result understandable in a debugger. A developer paused in JS
   execution should be able to recognize the stylesheet/ruleset/declaration/value
   shape, understand which fields are unparsed, and know how serialization or
   hydration will proceed.

## Non-Goals For The First Milestone

These are explicitly not first-milestone requirements:

- Complete SCSS parser replacement.
- Complete Jess language parser replacement.
- Full visitor compatibility before CSS/Less parsing is proven.
- Eager selector/value/media-query parsing for every node.
- Requiring the generic `@jesscss/parser` package to import `@jesscss/core`.
- Forbidding CSS/Less parser packages from constructing existing core AST nodes
  directly when that is the cheaper and clearer parse result.
- Preserving transitional or accidental parser/package API shapes.
- Supporting every obscure CSS token edge case if the runtime cost is not
  justified by real corpus use or compatibility tests.
- Source maps with detailed node-by-node mappings before useful output mappings
  are defined.

## Fixed Requirements

### R1. Offset-First Source Model

The parser must store stable half-open source offsets for structural data.
Line/column data is human-facing metadata and should be computed lazily.

Required because:

- parsing, containment, invalidation, indexing, and lazy promotion only need
  source ranges
- diagnostics, editor ranges, and source maps can ask for line/column data later
- eager line/column fields multiply object size across large files

### R2. Cheap Boundary Detection And Minimal Parse Surface

The first parse stage must find the boundaries needed to produce correct output
without fully parsing selector/value/prelude syntax.

Required boundary facts include:

- where a block starts and ends
- where a statement starts and ends
- where a declaration-like name and value split, if a top-level colon exists
- where an at-rule name and prelude/body split, if an at-rule is present
- where malformed input can recover enough to keep scanning

Those facts do not automatically require a separate "structural AST" node for
each category. The first parser replacement proof should decide whether the
cheapest correct surface is:

- existing CSS/Less AST nodes with string fields
- existing CSS/Less AST nodes with node-owned field hydration state,
  including compact/packed storage owned by the node when useful
- a temporary structural record
- only a field-state marker on an AST node
- a packed table row, only if node-owned state is measurably worse

`at-rule container`, `mixin-definition-like container`, and similar categories
are therefore candidate implementation shapes, not fixed requirements. They are
only justified if they let the parser/evaluator make a necessary decision more
cheaply than constructing the actual AST node with deferred-capable fields.

This stage must understand strings, comments, balanced delimiters, `url(...)`
payloads, and component-value blocks well enough to avoid false structural
boundaries.

### R3. Intelligible Parse Result

The parse result must be easy to inspect and reason about.

This is a functional requirement, not polish. If corpus tests pass but a
developer cannot tell what was parsed, what is deferred, and how the result would
serialize, the API shape is not good enough.

Preferred output shape:

- actual stylesheet/ruleset/at-rule/declaration/value-like AST objects where
  those objects are cheap enough
- a real top-level `Stylesheet` AST node, likely extending `Rules`, rather than
  a parallel `StructuralDocument` facade for compiler parse results
- string fields for unparsed values/selectors/preludes when strings are enough
- explicit field state on the owning AST node where a field can hydrate later;
  that state may be a compact node-owned table rather than loose object fields
- a straightforward serialization path for the cheap shape

Less desirable output shape:

- a separate structural tree that does not resemble the compiler AST
- side-indexed islands that require knowing service-layer APIs before the result
  can be understood
- debug views where the most important information is only recoverable through
  range-table lookups

Structural records are still allowed as an internal or transitional shape, but
they must justify themselves against debugger ergonomics as well as speed and
object count.

`StructuralDocument` is included in that warning. It may be useful as a cold
broad-scan/probe/editor artifact, but it is still a parallel document tree plus
side services. It should not become the CSS/Less compiler parse result unless it
beats existing AST nodes with deferred fields on correctness, clarity, and
measured cost.

A `Stylesheet extends Rules` shape is the preferred way to represent the root
document when plain `Rules` is not expressive enough. That keeps root-only
document concerns such as source identity, packed field spans, diagnostics,
trivia, and lazy line mapping on the actual AST result instead of in a separate
facade. It must not become a reason to push document-wide state onto every
nested `Rules`, `Ruleset`, `AtRule`, or `Mixin` container.

`Stylesheet` should still be aggressively slim. Extra facts are acceptable only
when they replace heavier side services or are required by diagnostics,
incremental invalidation, source maps, or deferred field hydration. Prefer
source references and compact numeric tables over object-heavy maps, indexes,
or eager query services. Cold editor/probe indexes should stay outside the
compiler result until measured evidence says otherwise.

### R3a. LocationInfo Is Legacy Storage

Existing core nodes still expose `location` and accept `LocationInfo` because
the Chevrotain parser, trivia, source syntax, source maps, and some runtime
paths have not been migrated yet. Scanner-first parser work should treat that
tuple as legacy compatibility storage, not the target representation.

New scanner-first AST construction should not pass eager
`[startOffset, startLine, startColumn, endOffset, endLine, endColumn]` tuples.
It should store offsets only:

- whole-node source ranges only when a whole-node range is needed
- packed field spans on the owning AST node when field provenance or hydration
  state is needed
- line/column conversion through the root `SourceText`/`LineMap` only when a
  human-facing caller asks for diagnostics, editor ranges, or source maps

Touching `node.location` on a source-free node currently allocates an empty
array through the legacy getter. New scanner-first paths should avoid that
getter unless they are deliberately interacting with old location-aware code.

### R4. Language Profiles Are Caller-Owned

`@jesscss/parser` must not hard-code CSS, Less, SCSS, Jess, Tailwind, or other
language profiles as named exports.

The parser package may define generic profile types and helper constructors.
Language packages/plugins own:

- extension binding
- syntax classification heuristics
- deferred field classification
- deferred field parser registration
- fallback policy

### R5. Deferred Field Parsing

The parser must be able to leave fields untyped when typed parsing is not yet
needed. This does not require a standalone `RawIslandNode` object.

Acceptable representations include:

- a string value on the actual AST node. This is the preferred default.
- a mixed string/node field on the actual AST node
- node-owned field state that says which fields are unparsed/hydrated
- node-owned packed field state, if that is simpler or cheaper than loose fields
- a packed field-state table, only if node-owned state is measurably worse
- a temporary lazy parse record, only if no cheaper representation can support
  the required caller

Examples:

- selector matching for Less `:extend`
- mixin signatures and calls
- declaration values that contain variables, functions, interpolation, or math
- at-rule preludes that require structured query parsing
- visitor-visible node families, if the visitor shape demands them

Deferred parsing must be demand-driven. Registering a provider or visitor must
not materialize every possible field. Accessing or evaluating a field may hydrate
that field if doing so does not change its serialization shape.

The default mental model should be:

```ts
Declaration {
  name: 'color',
  value: 'rgb(10, 20, 30)',
  important: false
}
```

If later evaluation needs typed function-call details, it can parse `value`.
Until then, the string is the deferred field. If the parser needs offsets,
hydration state, or original-source provenance, the owning AST node should be the
first place to store that state. That node-owned state can still be compact or
packed. A separate "raw island" object is not required by the requirement.

Target storage shape:

The target is not a parallel `ProgressiveDeclaration`, `ParsedDeclaration`, or
scanner-only declaration shape. The target is to widen the existing AST
node classes/interfaces in place where that is the correct runtime model.

Do not treat base `Node.value` as the source of truth. Value-bearing nodes may
own a `value` field when that field is semantically real, such as declaration
values, selector lists, lists, sequences, and scalar leaves. Direct-field nodes
such as `Ruleset`, `AtRule`, `Mixin`, and future `Stylesheet` should store their
semantic state in named fields and should not receive a duplicate constructor
payload field just to satisfy generic copy/traversal code.

Keep the deferred state as small as the owning node allows. A generic
`{ field, start, end, hydrated }` object is easy to explain, but it is not the
preferred runtime shape. If the node already declares field order through
`static childKeys`, source spans can be packed by field index.

```ts
// Existing @jesscss/core Declaration, widened in place.
class Declaration extends Node {
  static childKeys = ['name', 'value', 'important'] as const;

  type = 'Declaration' as const;
  name: string | Node;
  value: string | Node | (string | Node)[];
  important: boolean | string;

  // Packed by childKeys index: [nameStart, nameEnd, nameFlags,
  // valueStart, valueEnd, valueFlags, importantStart, importantEnd,
  // importantFlags].
  spans?: number[];
}
```

This schema is intentionally field-first:

- `value: 'rgb(10, 20, 30)'` is the deferred value
- `spans` preserves offsets/provenance only if needed
- `Declaration.childKeys` already maps the `value` field to its packed slot
- the owning node type plus field slot should usually be enough to select the
  parser/hydrator
- the AST node remains the thing a developer inspects, serializes, and mutates
- a compact node-owned table avoids redundant field names and per-field objects
- generic traversal, clone, and detach logic should read `static childKeys`, not
  reconstruct from an old constructor payload
- do not add a generic field object unless one node really needs multiple
  deferred fields that cannot be expressed as field-specific slots
- do not add a `DeferredFieldKind` enum unless one node field truly has multiple
  valid hydration strategies that cannot be inferred from node type, field name,
  source text, or parser mode

Target language activation names should follow the same terminology:

```ts
type LanguageActivation = {
  name: string;
  profile: LanguageProfile;
  supportedExtensions: readonly string[];
  configureDeferredFieldParsers?(registry: DeferredFieldParserRegistry): void;
};
```

If a provider registry survives, it should be named around deferred fields:

```ts
type DeferredFieldParserKey = {
  language: string;
  nodeType: string;
  field: DeferredFieldName;
  targetShape: string;
  parserConfigKey?: ParserConfigKey;
};

type DeferredFieldParseRequest = {
  node: Node;
  field: DeferredFieldName;
  start: number;
  end: number;
  sourceVersion: string | number;
};
```

Names to avoid in target APIs:

- `island`
- `rawIsland`
- `RawIslandNode`
- `IslandParsePlan`
- `IslandParserRegistry`
- `ProgressiveDeclaration`
- `ProgressiveRuleset`
- `ParsedDeclaration`
- `StructuralDeclaration`

### R6. Recoverable Diagnostics

The scanner-first path must support useful parse errors and recovery mode.

Required behavior:

- record offset ranges for diagnostics
- keep scanning after recoverable structural errors where possible
- distinguish malformed source from unsupported-but-valid syntax
- defer line/column conversion until diagnostic rendering asks for it

### R7. Trivia And Source Identity

Trivia should not force AST node growth.

Whitespace/comments/newlines need to be available for:

- formatting or editor features
- diagnostics
- source maps if a mapping strategy needs them
- preserving source identity during field-deferred parsing

But trivia should live outside the core node payload unless a later stage proves
that a node must own it directly.

### R8. Existing AST Nodes With Deferred Fields

Language AST nodes may accept cheaper textual values where typed nodes are not
required for correctness.

Examples of shapes that should remain possible:

```ts
Declaration {
  name: string | InterpolatedName;
  value: string | (string | Node)[];
  important: boolean | string;
}

Ruleset {
  selector: string | Selector;
  rules: (string | Node)[];
}
```

The exact core AST shape is not sacred. The important rule is that a node should
only materialize richer structure when correctness requires it or a caller
observes that richer structure. Nodes may hydrate or mutate internal field
representation when the serialized output shape remains the same.

Clone and placement ownership must follow the same rule. A node with direct
semantic fields owns its own `clone()` implementation; parser work should not
add external copy helpers that rebuild nodes from an assumed generic payload.
Temporary constructor migration sentinels are debt, not target architecture.

### R9. Visitor Support Is Conditional

Less supports visitors, but Jess does not need to preserve every leaf-level
historical visitor shape unless evidence says users depend on it.

Visitor support must be evidence-driven:

- document what public Less visitors actually visit
- decide which node families Jess intentionally exposes
- do not preserve leaf visitors merely because older internal nodes existed
- do not parse child fields just because a broad visitor exists

If visitor planning is implemented, it must be based on registered visitor
methods or declared visitor shape. It should determine which parent structures
and fields are needed, then request or hydrate those fields lazily as traversal
reaches them.

### R10. Corpus And Benchmark Gates

The project must test against existing corpora before claiming parser success.

Required gates for CSS/Less work:

- scanner/structure can process the checked-in CSS corpus
- scanner/structure can process the imported Less test-data corpus
- valid Less fixtures either parse structurally or produce documented,
  semantically justified fallback
- malformed fixtures produce diagnostics and recover where reasonable
- benchmark Less files are measured against current Less parsing/evaluation
  baselines

Performance proof must include runtime and object allocation pressure where
possible. Object-count reduction is useful only when it supports speed, memory,
or the target runtime model.

### R11. DRY Across CSS/Less/SCSS/Jess

Shared code should live at the scanner, source, structural, and provider-contract
levels.

The parser substrate should avoid:

- copy/pasted scanners per language
- copy/pasted source location services
- language-specific hard-coded node constructors
- parallel plugin activation systems
- generic generator traversal as the default hot-path primitive without callsite
  evidence

Language-specific grammar details still belong in language packages/providers.
DRY does not mean flattening all languages into one eager parser.

## Scope Slices

### Slice 1. Structural Substrate

Status target:

- source text and lazy line map
- scanner helpers
- boundary representation, which may be existing AST nodes with string fields,
  temporary structural records, or packed field state depending on proof
- field-range metadata
- diagnostics and recovery
- language profile contract
- node-owned deferred field state if justified
- parser-only corpus gates

This is the minimum substrate scope for this package before language-specific
parser replacement can be judged.

### Slice 2. CSS/Less Parser Replacement Proof

Status target:

- CSS/Less productions rebuilt on the scanner-first stack
- existing AST node shapes with string fields where strings are sufficient
- JIT parsing only where output correctness requires it
- corpus proof against CSS and Less fixtures
- benchmark proof against current parser/eval/render paths

This slice should complete before expanding into SCSS/Jess parser replacement.

### Slice 3. Evaluation And Late Parsing Integration

Status target:

- render/evaluate from existing CSS/Less nodes with deferred-capable fields
- late parse values/selectors only when extend, mixin, variable, arithmetic,
  visitor, or function behavior needs it
- no Chevrotain deferred-field parsing in the new path
- no compatibility shims that reintroduce eager AST materialization

### Slice 4. Visitor And Plugin Semantics

Status target:

- document what public Less visitors actually visit
- define which node families remain visitor-visible in Jess
- materialize only the nodes demanded by visitor shape and traversal position
- keep plugin registration separate from eager materialization

### Slice 5. IDE And Incremental Services

Status target:

- structural reparsing/invalidation
- editor symbols/folds/ranges
- targeted reparse for syntax coloring and completions
- lazy line/column conversion
- optional semantic indexes

This is not allowed to distort compile-path requirements.

## Out-Of-Scope Until Proven Necessary

These should not be added just because they are convenient:

- wrapper objects for strings that already have offset side-table entries
- visitor compatibility for selector/value leaves that no public visitor uses
- per-node line/column fields
- per-node trivia ownership
- eager media/prelude/query object trees
- object graphs for semantic indexes during structural-only parse
- full-tree fallback as the normal compile strategy

## Questions To Ask Before Adding A Shape

Every new object, side table, method, map, or node kind should answer:

1. Is this necessary to produce correct CSS output?
2. Is it necessary for recoverable diagnostics?
3. Is it necessary for a proven visitor/plugin surface?
4. Is it necessary for a measured editor or incremental parsing need?
5. Can the same result be derived from offsets and source text when requested?
6. Can this state live on the owning AST node instead?
7. Does this allocate during structural-only parse?
8. Does this belong in `@jesscss/parser`, or in a CSS/Less/Jess provider layer?
9. Does it add generator/iterator, map/set, side-table, wrapper, or clone work
   in a parser/eval/render hot path that could be a direct loop or direct field?

If the answer is not clear, document the shape as provisional and keep it out of
hot paths.
