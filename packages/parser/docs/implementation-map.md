# Scanner-First Implementation Map

This document inventories the scanner-first prototype from
`feature/scanner-first-parser-docs` and maps each piece back to
[requirements-and-scope.md](requirements-and-scope.md). The current branch does
not automatically inherit these files or APIs. Treat this as an import/audit map:
each prototype module has to justify itself before it is copied into
`@jesscss/parser`.

Read order matters:

1. Review and adjust `requirements-and-scope.md`.
2. Use this document to make every module, object, side table, service, and
   counter justify itself against those agreed requirements.

The main direction is prototype code -> requirement. The requirement-to-code
section later in this file is only a secondary index.

## Current Branch And Prototype Layers

This branch currently exports the older recursive-descent parser runtime in
`src/parser.ts` and a deliberately small scanner helper surface in
`src/source-scanner.ts`. The scanner-first prototype branch also contains a
substrate under `src/source`, `src/scanner`, `src/profiles`, `src/structure`,
and `src/services`.

Only the prototype scanner-first substrate is covered here. The purpose is to
decide what should be imported, reshaped, renamed, or deleted before it becomes
current code.

## Critical API Review

Default rule: a public parser surface is rejected unless it is defensible against
the agreed requirements. "Useful later" is not enough.

| Prototype surface | Claimed purpose | Current verdict | Required action before blessing |
| --- | --- | --- | --- |
| `SourceText` | Own source and lazy line map | Keep | Keep small; no per-node copied source strings. |
| `LineMap` | Offset to line/column conversion | Keep | Keep lazy; verify only if source-map/diagnostic cost becomes visible. |
| core `LocationInfo` / `node.location` | Legacy Chevrotain-era source tuple and getter. | Do not use in scanner-first AST construction. | Migrate consumers to offset spans plus lazy `LineMap`; avoid touching `location` just to test for provenance. |
| `source-scanner.ts` helpers | Boundary correctness for AST-producing parser proofs | Keep public but tiny | Root export is intentional for offset-only helpers; keep generic, single-purpose, and free of language profiles or AST construction. |
| broader scanner helpers from prototype | Boundary correctness | Provisional | Import only when they delete parser-local duplication or prove a new AST-producing slice; do not grow into full tokenization without proof. |
| structural container/statement node objects | Broad containment and statements | Provisional | Prove they are cheaper than constructing actual existing CSS/Less AST nodes with deferred-capable fields. |
| `RawIslandNode` objects | Deferred typed parse spans | Suspicious | In the preferred model, this is a string field plus state owned by the AST node, possibly packed inside that node. Delete or rename unless object identity is proven necessary. |
| `FieldRangeTable` | Offsets for source-backed fields | Provisional keep | Keep only if it prevents wrapper/raw fields; redesign if lookup becomes hot. |
| `StructuralDocument` query APIs | Cold symbols/folds/scopes/stats | Provisional | Keep out of compile hot path; consider moving editor-only queries later. |
| `LanguageProfile` | Caller-owned cheap classification | Keep | Keep profiles out of parser package named exports. |
| `LanguageActivationRegistry` | Extension/profile/provider binding | Provisional | May belong in plugin/adapter layer rather than parser substrate. |
| `IslandParserRegistry` | Lazy provider lookup | Provisional | Keep only if deferred parsing needs provider indirection instead of direct field hydration. |
| `IslandParsePlan` | Request dedupe, execution, visitor materialization | High-risk | Split, move, or delete unless CSS/Less proof shows this machinery beats simpler field hydration. |
| `SemanticIndexBuilder` | Structural indexing proof | Move/delete candidate | Do not keep in parser core unless compile or IDE use proves it belongs here. |
| visitor-shape helpers | Demand-driven visitor materialization | Move/delete candidate | Keep only after visitor evidence says what must be visitable. |
| probe summaries/counters | Corpus and performance evidence | Keep as test/reporting | Do not let counters become production architecture. |

## Value Over AST Nodes

This is the blunt test: why should this object exist instead of just producing
or enriching a real AST node?

| Object/surface | Value over AST nodes | Verdict |
| --- | --- | --- |
| `SourceText` | Real AST nodes should not each own the whole source or line map. One source owner is cleaner. | Keep. |
| `LineMap` | Human-facing offset conversion is document-wide, not node-specific. | Keep, lazy. |
| `LocationInfo` tuple | No value for scanner-first AST output over offsets plus lazy line mapping; it stores line/column eagerly and the getter can allocate empty arrays. | Legacy only. |
| `ScannerCursor` | Short-lived parser implementation state; not an output object. | Keep internal. |
| `source-scanner.ts` helpers | Shared boundary logic before AST construction. They return offsets only and let language packages build or skip AST nodes. | Keep public but tiny. |
| broader scanner/prototype helpers | Shared boundary logic before AST construction. | Keep internal until imported and defended. |
| `ParserDiagnostic` | Diagnostics are output records, not AST nodes. | Keep. |
| `TriviaRun` | Trivia can be document-wide and may not belong on every AST node. | Keep provisionally; consider packing. |
| `StructuralContainerNode` / `StructuralStatementNode` | Possible value only for an editor/probe broad parse that deliberately avoids AST construction. For compile/parser replacement, value over existing AST nodes with deferred fields is unproven. | Provisional; likely loses to AST nodes for CSS/Less parser proof. |
| `StructuralDocument` | Possible value as a cold editor/probe facade. It is an AST-like parallel document tree if used as the compile parse result. | Keep out of compile path unless it beats existing AST nodes with deferred fields on correctness, clarity, and measured cost. |
| `Stylesheet extends Rules` | Gives the compiler a real top-level AST/document node without a parallel structural facade. The first core implementation is deliberately just a semantic `Rules` root; root-only source/span/diagnostic/trivia state must be added only when a caller proves the need. | Current preferred target for compiler parse results when plain `Rules` is too weak. Keep slim and avoid eager maps/indexes. |
| `FieldRangeTable` | Avoids per-node offset fields, but makes debugging harder and adds lookup machinery. Node-owned compact state may be better. | Provisional; compare against AST-owned state. |
| `RawIslandNode` | No clear value over a string field plus AST-owned state. It duplicates the idea of "this field is unparsed." | Delete/replace unless a concrete caller proves object identity is needed. |
| `IslandKind` | No clear value if node type plus field name selects the parser. It is a shadow AST taxonomy. | Delete by default. |
| `IslandParserRegistry` | Possible value only for third-party parser extension where direct node methods are insufficient. | Provisional; rename/narrow if kept. |
| `IslandParsePlan` | No clear compile-path value over node field hydration. Too many maps/counters for the current proof. | High-risk delete/split candidate. |
| `SemanticIndexBuilder` | Possible editor/compiler index value, but it can index AST nodes directly. | Move/delete candidate in parser core. |
| visitor-shape helpers | Possible value only after visitor evidence proves which surfaces need hydration. | Move/delete candidate. |

The likely target is not "replace every object with an AST node." The target is:

- document-wide services stay document-wide
- parser-local state stays internal
- diagnostics stay diagnostics
- parsed stylesheet structure should be AST-shaped as early as possible
- deferred parsing state should belong to the AST node whose field is deferred

## Required Shape Changes

This is the concrete direction implied by the review above.

1. Add an existing-AST proof path before expanding services:
   - parse a small CSS/Less subset directly into existing AST node classes
   - current CSS proof: `@jesscss/css-parser` exposes
     `parseFlatCssDeclarationStylesheet(filePath, source)`, which returns a
     scanner parse result containing a core `Stylesheet`, `SourceText`, and
     offset-only diagnostics. The tree uses string-backed `Ruleset.selector`,
     `Declaration.name`, and declaration value fields for a flat qualified-rule
     declaration subset. `Declaration.value` is the semantic declaration value;
     parser code should not introduce parallel payload names for it.
   - introduce or target a real top-level `Stylesheet extends Rules` node if
     root document state cannot fit cleanly on plain `Rules`
   - widen the actual `@jesscss/core` node fields in place where needed
   - do not introduce parallel `Progressive*`, `Parsed*`, or `Structural*`
     versions of existing node classes
   - use string fields for selectors, declaration names, declaration values, and
     simple at-rule preludes where strings serialize correctly
   - make those nodes serializable without consulting `StructuralDocument`
   - make a paused debugger frame legible without service lookups

2. Move deferred parsing state toward the owning AST node:
   - first try ordinary node fields
   - then try compact node-owned field state if loose fields are too heavy
   - only keep an external deferred-span table if node-owned state loses on
     clarity or measured cost

3. Treat `RawIslandNode` as a deletion or rename target:
   - replace the concept with "deferred field"
   - do not expose it as a public node family
   - do not require `IslandParsePlan` to understand a parsed result
   - target names:
     - existing AST fields such as `value`, `selector`, `prelude`, and
       `arguments`
     - compact node-owned `spans?: number[]` keyed by `static childKeys`, if
       offsets/state are needed
     - `DeferredFieldParserRegistry`
     - `DeferredFieldParsePlan` only if a plan object survives at all
     - `configureDeferredFieldParsers`

4. Split compile-path parsing from editor/probe services:
   - compile/eval proof should not require `SemanticIndexBuilder`
   - compile/eval proof should not require visitor method tables
   - compile/eval proof should not require cold symbol/folding query APIs

5. Keep scanner/source pieces only where they support AST production:
   - boundary scanning, string/comment/delimiter handling, lazy line maps, and
     diagnostics remain useful
   - current code imported only `src/source-scanner.ts`, which provides
     offset-only trivia/string/block/top-level-delimiter helpers and creates no
     structural nodes, profiles, side tables, diagnostics, or AST objects
   - structural node objects remain provisional until proven cheaper than direct
     construction of existing AST nodes with deferred-capable fields

The strongest current objection is that the implementation still treats a
separate structural document plus raw islands as the default proof vehicle. A
"raw island" is basically a source span we did not parse yet, which in the
preferred model is just a string field on the owning AST node.
If that field needs offsets, provenance, or hydration state, the owning AST node
should be the first storage candidate. That state can still be compact or packed
inside the node. The next parser proof should compare the current machinery
against a thinner path where the parser directly creates existing AST node
classes with string fields and node-owned field state.

If the parse result needs document-level behavior beyond a `Rules` list,
`Stylesheet extends Rules` is a cleaner candidate than `StructuralDocument`.
The initial core node should remain only a semantic root over a `rules` array.
It can later own source identity, packed span storage, document diagnostics,
trivia, lazy line maps, and other root-only services, but each addition must
replace a heavier service or satisfy a concrete compiler/editor requirement.
Nested containers should not inherit that document payload unless they
genuinely need it.

`Stylesheet` should not be a renamed `StructuralDocument`. Root facts, when
added, should be sparse and compact:

- source identity/reference, not copied source slices
- optional packed field spans, not one object per deferred field
- diagnostics and recovery facts only when errors exist
- trivia/reference tables only if the parse/render/source-map path proves they
  are needed
- cold editor/probe indexes outside the compiler AST until proven otherwise

## Target Deferred Field Storage

The target API should be field-owned and AST-legible:

Do not create parallel node contracts such as `ProgressiveDeclaration` or
`ProgressiveRuleset`. The target is to widen existing node classes/interfaces in
place.

```ts
// Existing @jesscss/core Declaration, widened in place.
class Declaration extends Node {
  static childKeys = ['name', 'value', 'important'] as const;

  type = 'Declaration' as const;
  name: string | Node;
  value: string | Node | (string | Node)[];
  important: boolean | string;
  spans?: number[];
}
```

`LocationInfo` is not the target field-span carrier. It remains a legacy tuple
for old parser and source-map/trivia consumers while those callsites are moved.
Scanner-first AST builders should leave `_location` unset unless they are
explicitly invoking old location-aware behavior, and should never compute
line/column positions merely to populate node provenance.

The same pattern applies to `Ruleset`, `AtRule`, `VarDeclaration`, and other
existing AST nodes: the runtime node has `type`, the static side has
`childKeys`, and `spans` is packed by that static field order.

Direct fields are also the clone source of truth. If a node stores semantic
state in fields such as `name`, `value`, `selector`, `rules`, `prelude`, or
`important`, that node must own a `clone()` override that reconstructs from
those fields. Do not add parser-side copy helpers, `valueNode` bridges, raw
payload mirrors, or external constructor-reconstruction services to keep old
payload assumptions alive.

Base `Node.value` is not the target storage contract. A node may own a semantic
`value` field, but that is different from every node inheriting a generic
constructor payload. Direct-field containers should not duplicate their fields
into `.value`, and generic traversal/copy/detach code should use
`static childKeys` plus direct field reads. The current constructor sentinel used
by migrated direct-field nodes is migration debt; do not model parser APIs after
it.

Generator traversal is also an audit target, not a default for new parser work.
Existing `children()`/`nodes()` callsites remain for visitor and extend paths,
but scanner-first parser code should prefer direct loops over known field arrays
or offsets. Adding a generator, map, side table, or wrapper to make a generic API
look neat must be justified against allocation and callsite evidence.

If a registry remains necessary, use field terminology:

```ts
activationRegistry.register({
  name: languageProfile.name,
  profile: languageProfile,
  supportedExtensions: ['.less'],
  configureDeferredFieldParsers(registry) {
    registerLessDeferredFieldParsers(registry);
  }
});
```

The point is not the exact property spelling. The point is ownership and size:
deferred state belongs with the AST node whose field is deferred, and it should
not carry a redundant `field` discriminator when the slot already identifies the
field. A developer paused in a debugger should see the node, the string field,
and any source span/hydration state without learning an island service model.

Do not introduce a durable `DeferredFieldKind` enum just to keep a shadow AST
taxonomy alive. In the target model, parser selection should normally come from:

- the node type, such as `Ruleset`, `Declaration`, `AtRule`, `Mixin`, or `If`
- the field name, such as `selector`, `value`, `prelude`, `arguments`, or
  `condition`
- parser mode/config when the same field has a real syntax-mode choice
- source text inspection when that is cheaper than storing another discriminator

## Current Name Migration

This table names the current prototype surfaces explicitly so they can be removed
or reshaped deliberately instead of silently surviving under nicer docs.

| Current name/shape | Problem | Target shape/name | Action |
| --- | --- | --- | --- |
| `RawIslandNode` | Pretends a deferred field span is a node-like thing; adds object identity and debugger noise. | Existing AST field values plus optional node-owned `spans?: number[]` keyed by `static childKeys`. | Delete or replace. Keep an object view only if a cold debug API needs one. |
| `StructuralNodeKind: 'raw-island'` | Makes deferred fields appear to be part of the structural node taxonomy. | No structural node kind. Deferred state belongs to fields. | Remove from final public node taxonomy. |
| `RawIslandNode[]` on `StructuralDocumentData` | Central side list of deferred spans is harder to inspect than node-owned state. | Existing AST nodes with string fields and optional packed node-owned spans. | Replace in the existing-AST path; only keep as transitional prototype data. |
| `StructuralDocument.islands(...)` | Requires callers to know a service lookup path instead of inspecting the AST node, and cements `StructuralDocument` as a parallel AST-like result. | Field-specific node state or a cold debug helper such as `deferredFields(node)`. | Do not carry into compile/eval API. |
| compiler parse result as `StructuralDocument` | Creates a second AST-like document object beside the real core tree. | `Stylesheet extends Rules`, or plain `Rules` until `Stylesheet` proves necessary. | Reject for CSS/Less compile path unless measured evidence overturns this. |
| `IslandKind` | Names the storage metaphor and also acts like a shadow AST enum. | Usually no replacement; use node type plus field name. A narrow mode discriminator is allowed only if proven necessary. | Delete by default. Do not blindly rename to `DeferredFieldKind`. |
| `profile.classifyIsland(...)` | Classifies "islands" instead of letting AST construction decide which fields are deferred. | Parser-owned field state while building AST nodes. Maybe `profile.classifyDeferredField(...)` only for true language-mode ambiguity. | Replace or eliminate if direct AST parsing can infer state locally. |
| `IslandParserRegistry` | Registry around the wrong noun and likely too much indirection. | `DeferredFieldParserRegistry`, only if direct field hydration is not enough. | Rename/split/delete based on CSS/Less proof. |
| `IslandProviderKey` | Provider key uses `islandKind`; target shape may still be valid. | `DeferredFieldParserKey` with node type, field name, target shape, and config if a registry survives. | Rename and narrow only if provider registry survives. |
| `IslandParsePlan` | Central plan object owns request maps, visitor planning, execution, diagnostics, and counters. | Prefer node field hydration. If needed, split into `DeferredFieldParsePlan` and keep visitor planning separate. | High-priority deletion/split candidate. |
| `IslandParseRequest` | Request points to a side span, not the owning field. | If request objects survive, make them point at `node` plus the field slot/span. | Replace if request objects survive. |
| `configureIslandProviders` | Teaches the wrong plugin API. | `configureDeferredFieldParsers`. | Rename in target API; current name is transitional only. |
| `registerLanguageIslandProviders` examples | Same naming problem as above. | `registerLanguageDeferredFieldParsers`. | Rename docs/tests as target shape emerges. |
| `SemanticIndexBuilder` using island request ids | Indexes are coupled to island machinery. | Index direct AST nodes and deferred field state. | Move out of parser core or rewrite after AST-owned field state exists. |
| visitor materialization through `IslandParsePlan` | Couples visitor support to the deferred-span service. | Visitor traversal asks AST nodes to expose or hydrate only evidenced visitor surfaces. | Split visitor planning from field parsing. |
| `ProgressiveDeclaration` / `progressivedecl` | Parallel declaration contract for work the real `Declaration` should own. | Existing `Declaration` / `decl` widened in place. | Deleted; do not reintroduce. |
| `ProgressiveRuleset` / `progressiveruleset` | Parallel ruleset contract for work the real `Ruleset` should own. | Existing `Ruleset` / `ruleset` widened in place. | Deleted; do not reintroduce. |
| `ProgressiveAtRule` / `progressiveatrule` | Parallel at-rule contract for work the real at-rule family should own. | Existing at-rule node shapes widened or split intentionally, such as statement vs block at-rules. | Deleted; do not reintroduce. |
| `ProgressiveVariableDeclaration` / `progressivevardecl` | Parallel variable declaration contract for work the real `VarDeclaration` should own. | Existing `VarDeclaration` / `vardecl` widened in place. | Deleted; do not reintroduce. |

The migration should not be a blind rename. The important semantic changes are:

- deferred fields are fields, not nodes
- ownership starts on the AST node
- provider registries are optional, not the normal parse model
- a parsed result must serialize and debug without consulting a central island
  service

## Object-Creation Cut Questions

For each current object, ask in this order:

1. Can the actual CSS/Less AST node carry a string field instead?
2. Can the actual CSS/Less AST node own the field offset/hydration state,
   including a compact node-owned table?
3. Can an external packed table carry the field offset/state only if node-owned
   state is measurably worse?
4. Is object identity needed by a real caller?
5. Is this created during structural-only parse?
6. Does deleting it risk incorrect CSS output, or only a colder editor/visitor
   convenience?

If an object fails these questions, its status is provisional at best.

## Code Inventory

This section is the main accountability map. Every scanner-first module in
`packages/parser/src` should either map to an accepted requirement or be marked
as provisional/cuttable.

### `src/source/source-text.ts`

Objects and state:

- `SourceText`
- optional lazy `#lineMap`
- cold `SourceTextStats` object from `stats()`

Claimed requirements:

- R1 offset-first source model
- R6 recoverable diagnostics

Why it exists:

- gives scanners and structural documents one immutable source owner
- carries `version` for cache/invalidation keys
- keeps line/column data out of the parse path until a human-facing caller asks

Cost classification:

- structural-only: one `SourceText` if the caller passes a string
- opt-in: `LineMap`
- opt-in: stats object

Verdict:

- justified

Review notes:

- Keep this as the single source owner. Do not add per-node copied source strings
  or eager line/column fields.

### `src/source/line-map.ts`

Objects and state:

- `LineMap`
- `lineStarts` array
- cold `LineColumn` return objects

Claimed requirements:

- R1 offset-first source model
- R6 recoverable diagnostics

Why it exists:

- converts offsets to human-facing line/column positions only when diagnostics,
  editor features, or source-map output ask for them

Cost classification:

- not created during structural-only parse
- opt-in on first line/column lookup

Verdict:

- justified

Review notes:

- The char-code loop avoids substring allocation. Revisit only if profiling shows
  line-map creation is material in diagnostic-heavy or source-map-heavy paths.

### `src/source/spans.ts`

Objects and state:

- `SourceSpan`
- `DelimitedSpan`
- `TriviaRun`

Claimed requirements:

- R1 offset-first source model
- R7 trivia and source identity
- R6 recoverable diagnostics

Why it exists:

- source spans are the common offset vocabulary
- delimiter spans are scanner return records
- trivia runs preserve comments/whitespace outside node payloads

Cost classification:

- structural-only: `TriviaRun` objects when trivia exists
- scanner-local: `DelimitedSpan` objects when balanced scanning returns metadata

Verdict:

- concept justified, storage shape provisional

Review notes:

- `TriviaRun` is a likely packing target if object counts matter.
- If delimiter spans are used only internally, avoid retaining them beyond scanner
  decisions.

### `src/scanner/cursor.ts`

Objects and state:

- `ScannerCursor`

Claimed requirements:

- R2 cheap boundary detection and minimal parse surface
- R6 recoverable diagnostics

Why it exists:

- carries current offset and source while scanner helpers advance through input

Cost classification:

- structural-only: one short-lived cursor per parse

Verdict:

- justified

Review notes:

- Keep it small and parser-local.

### `src/scanner/diagnostics.ts`

Objects and state:

- `ParserDiagnostic`

Claimed requirements:

- R6 recoverable diagnostics

Why it exists:

- records recoverable parse/scanner errors with offsets and expected/actual
  context

Cost classification:

- structural-only: only when source is malformed or unsupported recovery is hit

Verdict:

- justified

Review notes:

- Diagnostics should stay plain records. Do not use `Error` objects for ordinary
  parse misses or fallback signals.

### `src/scanner/scan.ts`

Objects and state:

- scanner helper return objects such as balanced spans
- optional scanner stats objects
- caller-owned diagnostics/trivia arrays are populated here

Claimed requirements:

- R2 cheap boundary detection and minimal parse surface
- R6 recoverable diagnostics
- R7 trivia and source identity
- R10 corpus and benchmark gates

Why it exists:

- centralizes string/comment/delimiter/trivia/recovery scanning so language
  packages do not duplicate low-level boundary logic
- prevents false structural boundaries inside strings, comments, `url(...)`,
  parens/brackets, and component values

Cost classification:

- structural-only: function calls and occasional scanner-local return records
- structural-only: trivia/diagnostics pushed into caller arrays
- opt-in/test: scanner stats

Verdict:

- justified for boundary correctness, but scanner return object count should stay
  visible

Review notes:

- Keep scanner helpers generic and cheap.
- Do not expand this into full CSS/Less tokenization unless a later slice proves
  that a tokenized structure pass is necessary.

### `src/profiles/types.ts` And `src/profiles/helpers.ts`

Objects and state:

- `LanguageProfile`
- profile callback closures from helper construction
- language-owned classifier data

Claimed requirements:

- R4 language profiles are caller-owned
- R5 deferred field parsing
- R11 DRY across CSS/Less/SCSS/Jess

Why it exists:

- gives the structural parser cheap language classification without hard-coded
  parser-package dependencies
- lets plugins/language packages decide which spans are raw islands

Cost classification:

- not created by structural parse unless caller constructs a profile there
- callbacks execute during structural parse

Verdict:

- justified

Review notes:

- Keep callbacks cheap and side-effect free.
- Do not export first-party `cssProfile`, `lessProfile`, `scssProfile`, or
  `jessProfile` from this package as baked-in language policy.
- Rename or replace island terminology if this survives into the real API.

### `src/structure/types.ts`

Objects and state:

- `StructuralContainerNode`
- `StructuralStatementNode`
- `RawIslandNode`
- `ErrorNode`
- stats/symbol/folding/range record types

Claimed requirements:

- R2 cheap boundary detection and minimal parse surface
- R5 deferred field parsing
- R6 recoverable diagnostics
- R10 corpus and benchmark gates

Why it exists:

- defines the current experimental structural tree and side-indexed deferred
  field targets

Cost classification:

- structural-only: container/statement nodes
- structural-only: deferred field span objects
- structural-only on malformed input: error nodes
- opt-in: stats/symbol/folding records returned from document queries

Verdict:

- boundary facts are justified
- separate structural node objects are provisional
- deferred field span object storage is suspicious
- exact node taxonomy is provisional

Review notes:

- Every node kind should affect an actual decision.
- Prefer direct existing AST nodes with string fields if they can carry the
  same semantics more cheaply.
- `RawIslandNode` should first be challenged by string fields plus node-owned
  field state. Packed side-table storage is only a fallback if node-owned state
  is measurably worse.
- Current schema is not final API.

### `src/structure/parse.ts`

Objects and state:

- root structural node
- stack array
- diagnostics/trivia/deferred-span arrays
- `FieldRangeTable`
- structural nodes created by classification helpers

Claimed requirements:

- R1 offset-first source model
- R2 cheap boundary detection and minimal parse surface
- R4 language profiles are caller-owned
- R5 deferred field parsing
- R6 recoverable diagnostics
- R7 trivia and source identity

Why it exists:

- implements the structural pass
- scans broad syntax boundaries while leaving typed field parsing to later code

Cost classification:

- structural-only: all core structural parse allocations

Verdict:

- justified as an experiment, but not yet proven as the final parser surface

Review notes:

- This file should not become a full CSS/Less parser.
- It also should not force a separate structural AST if direct construction of
  existing AST nodes is cheaper.
- Boundary scanning must stay correct for strings, comments, `url(...)`, custom
  property-ish blocks, and balanced delimiters.
- If classification grows expensive, split into profile-owned helpers or later
  stages rather than making structural parse do too much.

### `src/structure/field-ranges.ts`

Objects and state:

- `FieldRangeTable`
- parallel arrays for node, field code, kind code, index, start, end
- cold readable `FieldRange` objects

Claimed requirements:

- R1 offset-first source model
- R7 trivia and source identity
- R8 existing AST nodes with deferred fields

Why it exists:

- preserves source-backed field locations without adding wrapper objects or
  secondary raw fields to nodes

Cost classification:

- structural-only: one side-table and primitive array entries
- opt-in: readable `FieldRange` objects from queries

Verdict:

- provisionally justified as a first cut

Review notes:

- Linear lookup is acceptable only while field-range queries are cold.
- The table still stores object references to nodes; node ids may be better if
  this becomes hot or if packed structural nodes are explored.
- If AST nodes can store string fields and packed offsets directly, this table
  may shrink or disappear.

### `src/structure/document.ts`

Objects and state:

- `StructuralDocument`
- private deferred-span array reference
- arrays returned by query methods
- stats object returned by `stats()`

Claimed requirements:

- R2 cheap boundary detection and minimal parse surface
- R6 recoverable diagnostics
- R10 corpus and benchmark gates

Why it exists:

- provides a read-only facade over structural parse results
- exposes cold editor/index/stat queries without forcing deferred field hydration

Cost classification:

- structural-only: one facade object
- opt-in: query result arrays and stats object

Verdict:

- provisional

Review notes:

- Do not turn this into a large semantic cache holder.
- Queries that walk the tree are fine for cold inspection; hot compile paths need
  measured alternatives.
- If the first parser replacement path emits existing AST nodes with deferred-capable fields, this
  facade may be editor/probe-only or unnecessary.

### `src/services/registry.ts`

Objects and state:

- `IslandParserRegistry`
- provider map keyed by provider key string

Claimed requirements:

- R4 language profiles are caller-owned
- R5 deferred field parsing

Why it exists:

- lets language packages register exact deferred-field parsers without the structural
  parser importing those packages

Cost classification:

- opt-in: only when a caller creates a registry/parse plan

Verdict:

- provisional optional service

Review notes:

- Keep matching exact and boring until real provider fallback needs are proven.
- Prefer direct field hydration over provider indirection when it is simpler and
  equally correct.

### `src/services/island-parse-plan.ts`

Objects and state:

- `IslandParsePlan`
- request id map
- request key/provider/island arrays
- owner-to-islands map
- request view map
- execution cache map
- diagnostics map
- visitor plans map
- reusable provider context
- counters object

Claimed requirements:

- R5 deferred field parsing
- R9 visitor support is conditional
- R10 corpus and benchmark gates

Why it exists:

- coordinates deferred field parsing and dedupes repeated requests
- keeps provider execution explicit
- records fallback and materialization counters

Cost classification:

- opt-in: none of this is created by structural-only parse
- opt-in: request views/execution records are created only when requested/executed

Verdict:

- deferred parsing concept justified
- current object/map count suspicious
- likely overbuilt unless CSS/Less proof says otherwise

Review notes:

- This is one of the largest cut targets.
- Visitor planning may need to move out or be split from normal deferred field execution.
- The first CSS/Less parser proof should validate whether request dedupe needs
  this much machinery.
- A direct "field is string, hydrate on access" model may delete most of this.

### `src/services/language-activation.ts`

Objects and state:

- `LanguageActivationRegistry`
- name map
- extension map
- optional provider registry passed through on parse-plan creation

Claimed requirements:

- R4 language profiles are caller-owned
- R11 DRY across CSS/Less/SCSS/Jess

Why it exists:

- lets parser packages/plugins bind profiles to extensions without hard-coded
  language names in `@jesscss/parser`

Cost classification:

- opt-in: caller-created registry only

Verdict:

- provisional; package boundary should be reviewed later

Review notes:

- This may belong in a plugin/adapter package if `@jesscss/parser` is kept as
  only source/scanner/structure/provider primitives.

### `src/services/semantic-index.ts`

Objects and state:

- `SemanticIndexBuilder`
- import/variable arrays
- mixin/extend/reference maps by target shape
- indexed request records
- counters object

Claimed requirements:

- R5 deferred field parsing
- R6 recoverable diagnostics
- R10 corpus and benchmark gates
- R11 DRY across CSS/Less/SCSS/Jess

Why it exists:

- demonstrates that some useful semantic information can be derived from
  structural nodes without typed AST materialization
- queues lazy island request ids for richer shapes

Cost classification:

- opt-in: caller-created service only
- opt-in: each index family builds on first access

Verdict:

- useful proof, not proven core substrate requirement

Review notes:

- Strong candidate to move out of the parser package or keep behind a service
  boundary until IDE/compile usage proves it belongs here.

### `src/services/visitor-shape.ts`

Objects and state:

- visitor method table cache
- method-name analysis records
- materialization rule arrays

Claimed requirements:

- R9 visitor support is conditional

Why it exists:

- explores deriving materialization needs from visitor shape instead of parsing
  everything

Cost classification:

- opt-in: only visitor integration should create/use this

Verdict:

- provisional

Review notes:

- Do not treat this as mandatory until public Less/Jess visitor requirements are
  documented.
- Visitor support may belong in an adapter layer.

### `src/services/probe-summary.ts` And Service Counters

Objects and state:

- summary/counter records for structural probes and island execution

Claimed requirements:

- R10 corpus and benchmark gates

Why it exists:

- makes tests and benchmark probes able to report structural counts

Cost classification:

- opt-in/test/reporting

Verdict:

- justified as instrumentation if kept out of hot parse paths

Review notes:

- Counters are evidence aids, not proof of performance by themselves.

## Prototype Structural-Only Parse Allocation Path

In the scanner-first prototype branch, calling
`parseStructure(input, profile, options)` creates these objects and collections:

| Created during structural parse | Code | Requirement | Why it exists | Review pressure |
| --- | --- | --- | --- | --- |
| `SourceText` when input is a string | `src/source/source-text.ts` | R1 | Owns the immutable source string, optional file path/version, and lazy line map. | Required. Avoid adding per-node source strings. |
| `ScannerCursor` | `src/scanner/cursor.ts` | R2, R6 | Tracks current offset while scanning. | Required. Should stay parser-local and short-lived. |
| `ParserDiagnostic[]` | `src/scanner/diagnostics.ts` | R6 | Records structural scanner errors. | Required, but diagnostics should only allocate for errors. |
| `TriviaRun[]` | `src/source/spans.ts` | R7 | Records whitespace/comment/newline ranges outside nodes. | Required for now, but object-per-trivia-run is a packing candidate. |
| `RawIslandNode[]` | `src/structure/types.ts` | R5 | Records deferred parse targets by kind and owner. | Suspicious implementation of a valid need; prefer string fields plus node-owned field state. |
| `FieldRangeTable` | `src/structure/field-ranges.ts` | R1, R7, R8 | Stores field offsets without adding wrapper objects to nodes. | Mostly justified; lookup is linear and should stay cold or be redesigned. |
| root `StructuralContainerNode` | `src/structure/parse.ts` | R2 | Document container. | Required. |
| one structural node per detected container/statement/error | `src/structure/types.ts` | R2, R6 | Captures containment and source ranges. | Provisional; direct existing AST nodes with deferred-capable fields may be cheaper. |
| `StructuralDocument` facade | `src/structure/document.ts` | R2 | Exposes root, diagnostics, trivia, field ranges, islands, and cold queries. | Provisional broad-scan facade. Keep out of compile hot path; direct AST nodes with deferred fields are the preferred CSS/Less parser proof. |
| `AtRuleStatement` | `../../core/src/tree/at-rule-statement.ts` | R3, R5 | Real core AST node for semicolon-form at-rules such as `@charset` and CSS `@import`. It owns direct `name` and `prelude` fields that may be strings, so the scanner-first path does not create `Any` wrappers where text is enough. It deliberately does not inherit from `Rules` or `AtRule`. | `N` bitmask space is currently exhausted, so this node is type/class-addressable but not yet `isNode(..., N.AtRuleStatement)` addressable. Fix by widening the node-type system, not by pretending it is `N.AtRule`. |
| String-backed block `AtRule` headers | `../../core/src/tree/at-rule.ts` | R3, R5 | Existing block `AtRule` nodes now allow `name` and `prelude` strings, matching `AtRuleStatement` and avoiding `Any` wrapper nodes for scanner-first block headers such as `@media screen { ... }`. String headers render directly, stay static during eval, and skip trivia/source transport; Node headers keep the existing trivia-aware render/eval path. | Keep this limited to header fields. Do not use string prelude support as a reason to parse media/query internals eagerly. |
| CSS `parseFlatCssDeclarationStylesheet` proof | `../css-parser/src/ast.ts` | R2, R3, R5, R6, R10 | Walks source-scanner boundaries into a real core `Stylesheet` for a tiny flat CSS qualified-rule declaration subset, semicolon-form at-rule statements, and cheap block at-rules whose bodies contain the same flat rules. Unsupported nested qualified rules, unsupported at-rule preludes, and malformed unclosed blocks become offset-only diagnostics instead of silently falling back. `../css-parser/test/ast-corpus.test.ts` proves the scanner-backed path can walk every checked-in valid CSS fixture without error diagnostics, but warnings still mark unsupported syntax rather than claiming full CSS parsing. Selector fields stay strings for single cheap atoms, materialize existing `CompoundSelector` / `ComplexSelector` nodes for cheap basic selector/combinator structure, and stay strings for unsupported selector syntax until a real selector-production slice owns it. Declaration name/value payloads remain strings; cheap at-rule preludes share the same `parseCheapAtRulePrelude(...)` helper used by Less. No island plan, structural node, or Chevrotain parse is required. Current `Ruleset.rules: Rules` is inherited core debt, not a parser-owned structural object. | Keep expanding only where CSS output correctness requires it; do not turn it into another structural facade. |
| Less source scanner corpus gate | `../less-parser/test/source-scanner-corpus.test.ts` plus `src/source-scanner.ts` | R2, R6, R10 | Reuses the generic offset scanner against imported `@less/test-data` `tests-unit` and `tests-config` fixtures, excluding the shared `invalidLess` list. Less opts into scanner `lineComments` so `//` trivia does not create false block boundaries. The gate currently walks 190 valid Less fixtures, 1145 top-level blocks, and 309 top-level statements with zero unclosed-block failures. This is a boundary/recovery proof only; it does not claim Less AST production, evaluation, or CSS output equality. | Next Less slice should construct existing core AST nodes for a narrow Less subset using these boundaries, not introduce a Less structural facade. Keep line-comment handling opt-in so CSS remains unchanged. |
| Less `parseLessAstStylesheet` proof | `../less-parser/src/ast.ts` | R2, R3, R5, R6, R10 | Builds on the same scanner boundaries to produce existing core `Stylesheet`, `Ruleset`, `Declaration`, `VarDeclaration`, `Mixin`, `AtRule`, and `AtRuleStatement` nodes for a small Less subset. Simple `@name:` variables become `VarDeclaration` nodes with string values; ordinary declaration values such as `@tone` or `rgb(...)` stay strings until evaluation/hydration proves a typed value is necessary. Detached ruleset variable values of the form `@name: { ... }` become `VarDeclaration` values backed by anonymous `Mixin` nodes with recursively parsed `Rules`. Parameterless `.name() { ... }` / `#name() { ... }` mixin definitions become real `Mixin` nodes with string-backed bodies; mixin parameters, guards, and calls still wait for their own production slices. Cheap block at-rules such as `@media screen { ... }` become real `AtRule` nodes with string `name`/`prelude` fields and recursively parsed rules. Balanced simple preludes such as `screen and (min-width: 1px)` become `QueryCondition` / `Paren` nodes instead of one raw string via the shared CSS parser helper; comma lists, nested conditions, interpolation, and general-enclosed syntax still warn. Cheap selector structure reuses the CSS helper, and block headers must be positively tokenized as cheap selector structure before they become `Ruleset` nodes. Guarded headers still produce diagnostics rather than fallback parsing through Chevrotain. | This is an early Less AST-production proof, not Less output compatibility. Keep expanding productions from current Less tokens/tests one narrow family at a time. |

The prototype generic `parseStructure(input, profile, options)` allocation
accounting has zero allocations for:

- core AST nodes
- selector/value/media-query AST nodes
- island provider registries
- semantic indexes
- visitor method tables
- line maps, unless a caller asks for line/column positions

That is prototype allocation accounting for the generic parser package, not a
design rule for CSS/Less parser packages. A CSS/Less parser replacement may
construct existing core AST nodes directly when that is cheaper, clearer, and
serializable without a side service.

## On-Demand Allocation Path

These allocations should happen only when a caller asks for a service.

| Created on demand | Code | Requirement | Trigger | Review pressure |
| --- | --- | --- | --- | --- |
| `LineMap` and `lineStarts` array | `src/source/line-map.ts` | R1, R6 | `source.lineMap`, `offsetToLineColumn`, or `lineColumnToOffset` | Required; char-code loop avoids substring allocation. |
| readable `FieldRange` objects | `src/structure/field-ranges.ts` | R1, R7 | `fieldRanges.get` or `rangesFor` | Acceptable if cold. Do not use this as a hot parser path. |
| arrays from `foldingRanges()` and `symbols()` | `src/structure/document.ts` | R2, R6 | editor/index queries | Optional service cost. |
| `IslandParserRegistry` | `src/services/registry.ts` | R4, R5 | caller creates a lazy parse plan or activation configures providers | Required for lazy provider proof, but should not exist in structural-only parse. |
| `IslandParsePlan` maps and counters | `src/services/island-parse-plan.ts` | R5, R9 | caller asks for lazy island execution | High review pressure. Direct field hydration may replace most of this. |
| `IslandParseRequest` views | `src/services/island-parse-plan.ts` | R5 | `requestView` or `execute` | Cold allocation; avoid when request ids are enough. |
| provider result values | language provider | R5, R8 | `plan.execute(id)` | Required only for spans that need typed parsing. |
| `SemanticIndexBuilder` indexes | `src/services/semantic-index.ts` | R5, R6, R11 | caller asks for imports, variables, mixins, extends, or references | Useful proof, but optional. May belong above the parser substrate. |
| visitor method tables and rules | `src/services/visitor-shape.ts` | R9 | visitor integration asks for materialization planning | Optional until visitor scope is finalized. |
| `LanguageActivationRegistry` maps | `src/services/language-activation.ts` | R4, R11 | plugin/parser layer registers extensions | Useful concept; package placement is still reviewable. |

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

### R2. Cheap Boundary Detection And Minimal Parse Surface

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

- Partly aligned. The parse stage recognizes broad shape and avoids selector/value
  AST construction, but it currently pays for a separate structural tree.
- It still classifies enough statement/container kind to support later decisions.

Watchlist:

- Every new structural node kind must prove it changes a decision that cannot be
  derived from field ranges plus source text.
- The main alternative to prove is direct construction of existing AST nodes with deferred-capable fields:
  stylesheet/ruleset/at-rule/declaration nodes with string fields and node-owned
  deferred field state.
- A packed representation may still be useful, but packing should not make the
  parse result unreadable in a debugger.

### R4. Language Profiles Are Caller-Owned

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

### R5. Deferred Field Parsing

Implemented by:

- `RawIslandNode`, as the current prototype shape
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
  field without full-tree materialization.
- The current answer is likely overbuilt. In the preferred model, the unparsed
  field is just the string value on the AST node, with optional node-owned state
  for offset/provenance/hydration.

Watchlist:

- `RawIslandNode` as a normal object is the clearest structural-only allocation
  target. The first replacement to test is not an external packed island table;
  it is AST-owned string fields plus AST-owned field state.
- `IslandParsePlan` has enough maps that it must stay out of structural-only parse.
- Missing provider should remain an explicit fallback signal, not normal parser
  success.

### R6. Recoverable Diagnostics

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

### R7. Trivia And Source Identity

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

### R8. Existing AST Nodes With Deferred Fields

Implemented in this package by:

- structural nodes carrying offsets instead of typed payloads
- `FieldRangeTable` preserving source identity for names/values/selectors
- prototype deferred parse records marking possible future typed views

Implemented outside this package:

- actual CSS/Less/core AST node shape changes
- node-owned field state, getters, or field hydration on language AST nodes
- render/eval behavior from mixed string/node values

Objects created:

- no core AST nodes in `@jesscss/parser`
- no existing CSS/Less AST nodes with deferred-capable fields in this package

Current fit:

- The parser substrate supports field-deferred node shapes but does not implement the
  final language AST layer.

Watchlist:

- Do not add `rawName`, `rawValue`, `valueNode`, or parallel payload fields as a
  substitute for correctly named `name`, `value`, `selector`, `rules`, etc.
- If getters are used later, implementations should cache private field reads in
  local variables inside hot getters instead of repeatedly reading private fields.

### R9. Visitor Support Is Conditional

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

### R10. Corpus And Benchmark Gates

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

### R11. DRY Across CSS/Less/SCSS/Jess

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

## Prototype Structural Schema

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

- this is the current prototype's object wrapper for a deferred field span
- in the preferred existing AST model with deferred-capable fields, this should usually be a string field
  on the owning AST node
- if offsets/provenance/hydration state are needed, the owning AST node should
  be the first storage candidate
- external object identity is only justified if a real caller cannot be served
  by node-owned field state

Current prototype deferred field kinds:

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

### 1. RawIslandNode Objects

Problem:

- every classified deferred field span is a standalone object
- the name makes a simple idea harder to understand
- debugger sessions have to understand service-layer APIs before they can see how
  a field would hydrate
- the all-Less structural gate already shows many of these records

Preferred cut:

- create existing AST nodes with string fields
- put offset/provenance/hydration state on the owning AST node when needed
- allow that node-owned state to be compact/packed internally

Fallback cut:

- use an external packed table only if node-owned state is measurably worse
- keep object views only for cold API reads

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

The deferred-field-object and trivia counts are the strongest hint that object
storage needs to be cut before this becomes the canonical parser path. For
deferred fields, first test AST-owned string fields and AST-owned field state;
only then test external packed side tables.

## What Is Not Yet Delivered

The current package does not yet prove:

- full CSS parser replacement
- full Less parser replacement
- Less-to-CSS output equality through the new parser path
- benchmark wins against Less 4.x or current Jess parser/eval/render
- Chevrotain-free late parsing for all CSS/Less production families
- final core AST field shape
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
