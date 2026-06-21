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

## Non-Goals For The First Milestone

These are explicitly not first-milestone requirements:

- Complete SCSS parser replacement.
- Complete Jess language parser replacement.
- Full visitor compatibility before CSS/Less parsing is proven.
- Eager selector/value/media-query parsing for every node.
- Creating `@jesscss/core` AST nodes during the structural pass.
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

### R2. Cheap Structural Containment

The first parse stage must identify containers and statements without fully
parsing selector/value/prelude syntax.

The minimum structure is:

- document
- rule-like container
- at-rule block container
- mixin-definition-like container when the language profile can recognize it
- statement-form at-rule
- import statement
- declaration
- variable declaration
- mixin-call-like statement
- recoverable error marker

This stage must understand strings, comments, balanced delimiters, `url(...)`
payloads, and component-value blocks well enough to avoid false structural
boundaries.

### R3. Language Profiles Are Caller-Owned

`@jesscss/parser` must not hard-code CSS, Less, SCSS, Jess, Tailwind, or other
language profiles as named exports.

The parser package may define generic profile types and helper constructors.
Language packages/plugins own:

- extension binding
- syntax classification heuristics
- island classification
- provider registration
- fallback policy

### R4. Lazy Typed Parsing

The structural parse must be able to mark source spans that may need later typed
parsing without parsing them immediately.

Examples:

- selector matching for Less `:extend`
- mixin signatures and calls
- declaration values that contain variables, functions, interpolation, or math
- at-rule preludes that require structured query parsing
- visitor-visible node families, if the visitor shape demands them

Lazy parsing must be demand-driven. Registering a provider or visitor must not
materialize every possible island.

### R5. Recoverable Diagnostics

The scanner-first path must support useful parse errors and recovery mode.

Required behavior:

- record offset ranges for diagnostics
- keep scanning after recoverable structural errors where possible
- distinguish malformed source from unsupported-but-valid syntax
- defer line/column conversion until diagnostic rendering asks for it

### R6. Trivia And Source Identity

Trivia should not force AST node growth.

Whitespace/comments/newlines need to be available for:

- formatting or editor features
- diagnostics
- source maps if a mapping strategy needs them
- preserving source identity during progressive parsing

But trivia should live outside the core node payload unless a later stage proves
that a node must own it directly.

### R7. Progressive Node Shapes

Language AST nodes may accept cheaper textual values where typed nodes are not
required for correctness.

Examples of shapes that should remain possible:

```ts
Declaration {
  name: string | InterpolatedName;
  value: string | readonly (string | Node)[];
  important: boolean | string;
}

Ruleset {
  selector: string | Selector;
  rules: readonly (string | Node)[];
}
```

The exact core AST shape is not sacred. The important rule is that a node should
only materialize richer structure when correctness requires it or a caller
observes that richer structure.

### R8. Visitor Support Is Conditional

Less supports visitors, but Jess does not need to preserve every leaf-level
historical visitor shape unless evidence says users depend on it.

Visitor planning must be based on registered visitor methods or declared visitor
shape. It should determine which parent structures and islands are needed, then
request those lazily as traversal reaches them.

### R9. Corpus And Benchmark Gates

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

### R10. DRY Across CSS/Less/SCSS/Jess

Shared code should live at the scanner, source, structural, and provider-contract
levels.

The parser substrate should avoid:

- copy/pasted scanners per language
- copy/pasted source location services
- language-specific hard-coded node constructors
- parallel plugin activation systems

Language-specific grammar details still belong in language packages/providers.
DRY does not mean flattening all languages into one eager parser.

## Scope Slices

### Slice 1. Structural Substrate

Status target:

- source text and lazy line map
- scanner helpers
- structural document tree
- field-range metadata
- diagnostics and recovery
- language profile contract
- raw island records
- parser-only corpus gates

This is the minimum substrate scope for this package before language-specific
parser replacement can be judged.

### Slice 2. CSS/Less Parser Replacement Proof

Status target:

- CSS/Less productions rebuilt on the scanner-first stack
- cheap progressive AST shapes where strings are sufficient
- JIT parsing only where output correctness requires it
- corpus proof against CSS and Less fixtures
- benchmark proof against current parser/eval/render paths

This slice should complete before expanding into SCSS/Jess parser replacement.

### Slice 3. Evaluation And Late Parsing Integration

Status target:

- render/evaluate from progressive CSS/Less nodes
- late parse values/selectors only when extend, mixin, variable, arithmetic,
  visitor, or function behavior needs it
- no Chevrotain island parsing in the new path
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
6. Does this allocate during structural-only parse?
7. Does this belong in `@jesscss/parser`, or in a CSS/Less/Jess provider layer?

If the answer is not clear, document the shape as provisional and keep it out of
hot paths.
