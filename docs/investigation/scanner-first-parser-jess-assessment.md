# Scanner-First Parser: Jess Strategy

This note turns the scanner-first parsing idea from
`scanner-first-parser-for-css-like-languages.md` into a concrete package and
integration strategy for Jess.

## Short Answer

A scanner-first parser is plausible as the structural stage for indexing,
folding, node-at-offset queries, and incremental experiments.

It is not safe as a drop-in compiler parser until it can preserve
parser-sensitive semantics for CSS, Less, SCSS, and Jess, or explicitly
document intentional AST/API upgrades. Less is the hardest case: parse-time
work currently decides real semantic shape for guards, math expression
wrapping, variable/index references, media preludes, mixin definitions/calls,
selector nesting, and `:extend()`.

Current parser and AST shapes are compatibility baselines, not sacred
architecture. Chevrotain-derived location structures, current source-location
helpers, parser package boundaries, and even current core AST shapes can be
changed if the replacement is better and the migration is explicit. The plan
should preserve user-visible semantics while allowing intentional shape
upgrades.

Field naming should be boring by default. When a node has one semantic payload,
whether that payload is one child node, one token-like value, or one homogeneous
list of children, the default shape should be `.value`. Alternate child names
such as `left`/`right`, `name`/`value`, `selector`/`rules`, or
`guard`/`body` are justified when the node has multiple distinct roles.
Legacy names such as `List.items`, `Sequence.items`,
`CompoundSelector.components`, and declaration value wrapper fields should be
treated as shape debt and migration candidates, not as names to preserve by
default.
Scanner-first work should not invent more arbitrary list-field names, and the
implementation plan should include a deliberate audit of where existing
single-payload node fields can collapse back to `.value` without breaking
user-visible behavior.

The same rule applies to rules-container bodies. `Rules.rules` is a justified
role name because rules containers have a distinct body role, but at structural
parse time that body can still be thin: a mixed string/node stream plus a cheap
offset/kind metadata surface is a valid target when text can render or defer
work without creating child nodes. Promotion from string segment to node should
happen only for the specific body segment demanded by eval/render/visitor/plugin
behavior.

The best near-term shape is staged:

```text
source text
  -> structural scan
  -> semantic/index materialization where needed
  -> visitor/plugin materialization where needed
  -> eval/render materialization where needed
  -> canonical @jesscss/core AST nodes at demanded boundaries
```

That keeps the DRY goal, but avoids pretending one shallow parser can replace
the existing compiler grammar in one step.

## Parked Scanner Backend Spikes

The first implementation should stay handwritten TypeScript because the
grammar, error recovery, offset/trivia model, progressive node surfaces, and
JIT materialization policy are still changing. Generated scanner backends are
not part of the current CSS/Less prototype path. They are only worth a focused
experiment later, once those contracts are stable enough to compare without
moving the target.

- [ ] Evaluate `re2js` / `re2c` as a generated scanner backend for
  `@jesscss/parser` only as a parked follow-up. The spike should generate
  cursor-based JavaScript from readable checked-in lexer rules, keep the
  generated output checked in or reproducible through one documented package
  script, and compare against the handwritten scanner on the real `.css`,
  `.less`, and `.scss` corpus. The gate is same structural records, same
  diagnostics/recovery ranges, same trivia and offset behavior, neutral or
  better package/build complexity, and measured corpus timing before any
  replacement.
- [ ] Benchmark lazy line-map construction with direct `charCodeAt` scans
  before considering regex/split-based line indexing. The expected production
  shape is a compact line-start table built only on first human-position
  request; avoid `source.split('\n')` because it allocates the line array and
  line substrings before diagnostics, sourcemaps, or LSP consumers prove they
  need them.

## Implementation Checklist

Detailed slice checklists are in [Implementation Plan](#implementation-plan).
Use this section as the high-level tracker. Agents should update these
checkboxes continuously as slices and subtasks are completed; do not wait until
the end of a long pass to mark completed work.

- [ ] Slice 0: plan and corpus inventory
- [ ] Slice 1: `@jesscss/parser` source model
- [x] Slice 2: scanner cursor and structural token helpers
- [x] Slice 3: language profiles
- [x] Slice 4: structural document parser
- [x] Slice 5: parse services and island parse planning
- [x] Slice 6: semantic index builder
- [x] Slice 7: CSS and Less island provider entrypoints
- [ ] Slice 8: CSS and Less e2e compiler/eval prototype
- [ ] Slice 9: plugin and visitor integration
- [ ] Slice 9b: SCSS and Jess island provider entrypoints after CSS/Less e2e
- [ ] Slice 10: language-service consumer
- [ ] Slice 11: compiler opt-in experiment

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
span fidelity. Today's parser has Chevrotain-influenced `LocationInfo` slots
for start and end offsets, lines, and columns, plus a trivia map for skipped
tokens. Those shapes are historical evidence, not fixed requirements. Rule
locations are mostly inferred from the next token at `startRule()` and the last
consumed token at `endRule()`, and newline ownership is not a first-class
structural concept. The CSS token fragments even carry a TODO about using
separator whitespace to attach newlines to node ends. A scanner-first
experiment should improve newline/trivia and span capture, not preserve
today's parser behavior by default.

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
selector and value. It is the first stage of the compile pipeline, not a
separate AST variant and not the final compiler AST.

Editor features are consumers of that same staged pipeline. An editor can stop
after structural scan for folding, symbols, and node-at-offset, then request
chunk-level materialization for syntax coloring or completions. On edits, it
should invalidate the changed structural ranges and only re-run the coloring or
completion materialization for affected chunks.

### 2. Offset-first island cache

Raw selector/value/expression islands fit well if they are explicitly cached by:

- source version
- island start/end offsets
- language mode
- parser config that affects shape, especially Less `mathMode`,
  `wrapOuterExpressions`, `looseMode`, and `leakyRules`

Compiler-facing island executors should return current core AST nodes when a
compile stage demands them. The structural island APIs themselves should stay
core-blind and should not create a second permanent AST type that drifts from
`@jesscss/core`.

The cheapest value/body segment may be a JavaScript string on the node, with
separate compact offset/kind metadata for source identity. Do not freeze the
storage yet. The first implementation should compare at least these candidate
shapes:

```ts
// Simple parallel arrays on the owning node.
interface RawValueField {
  value: (string | Node)[];
  valueOffsets: Uint32Array | number[];
  valueKinds: Uint16Array | ValueKind[];
}

// Dense side table keyed by owning node, field name, and segment index.
// This is attractive because one metadata table can cover selector, name,
// prelude, value, and body strings without allocating arrays on every node.
// The table stores typed/packed arrays, not an object per segment. It should be
// owned by the parsed document/source record, not hidden behind a WeakMap.
type FieldRangeTable = unknown;
```

Rendering/eval can read strings directly, diagnostics can ask the lazy line map
for human positions, and JIT parsing can use stored offsets for the demanded
segment. The important allocation rule is not "never store strings"; it is "do
not create extra wrapper nodes or duplicate parsed subtrees merely to remember
where a string came from." The chosen representation should be the tightest
shape that preserves direct string access, cheap source ranges, and cheap
segment-kind checks under measurement. The packed side table is a serious first
prototype candidate, especially if simple per-node arrays create too many small
arrays across large files. Do not make that table a `WeakMap` by default; parser,
render, diagnostic, and JIT code need a predictable document-owned metadata
surface, and weak lookups should only be introduced if measurement proves they
solve a real lifetime or memory problem.

Declarations should use the same cheap-storage instinct. A scanner-fed
declaration should be able to enter core as ordinary `decl({ name: 'color',
value: 'blue' })` when the name and value are scanner-native text. There is
no inherent value in allocating a keyword/anonymous wrapper solely so a renderer
can print `blue`, especially if the active visitor surface does not expose
keyword leaves and no declaration visitor will inspect the canonical value node.
The cheap declaration target is therefore:

```ts
decl({
  name: 'color',
  value: 'blue',
  important: false
});
```

and, for partially promoted values:

```ts
decl({
  name: 'box-shadow',
  value: ['0 0 2px ', lightenCall]
});
```

The string form is not only test shorthand. It is an allowed runtime shape for
the cheap path. Offsets, segment kinds, and trivia ownership can live in the
document-owned packed side table or a measured per-node field layout. The
node's plain declaration surface should remain ergonomic enough that callers do
not need to know whether a declaration began life as scanner text, a
parser-created node, or a mixed field.

Raw strings are still most valuable as atom-like payloads. A string leaf such
as `.a`, `>`, `screen`, `grid`, or `blue` can be cheap and honest. Selectors,
media queries, and supports conditions are different: a full complex selector,
a supports condition like `(display: grid)`, or a media query with
parenthesized features should not be accepted as one opaque string merely
because a regex can recognize its outer shape. Those parens and separators are
grammar-significant, so if the scanner/sub-parser validates that they are
balanced in a particular query/condition shape, the structural-fed path should
either keep that thin validated shape or fall back until that representation
exists.

Declaration values have a different pressure. A value segment that contains
parens, brackets, strings, or commas may still be a legitimate raw render-only
segment when no current stage needs its internals and the segment's offsets and
kind are tracked. That is a transport claim, not a semantic-value claim. As
soon as a value is referenced, visited, normalized, compared structurally,
evaluated as Less/Jess syntax, or used for a source-map granularity that needs
internal positions, it must be sub-parsed or materialized into a shape that
preserves the relevant structure.

This does not rule out a fast broad-structure pass. A good implementation may
first split the source into large balanced chunks, then sub-parse only the
chunks whose shape matters, and still delay full AST materialization until a
consumer needs it. The important rule is that once a pass validates meaningful
substructure, the parser should keep the useful validated shape for later
render/eval/visitor decisions instead of throwing that information away and
storing the entire chunk as one fuzzy string.

#### Declaration Getter Materialization Candidate

One candidate simplification is to make declaration fields progressively
enhanced through normal property access instead of routing every consumer
through a separate materialization service call.

Conceptually:

```ts
class Declaration {
  #name: string | Any<'property'> | Interpolated<'property'>;
  #value: string | Node | Array<string | Node>;

  get name(): string | Any<'property'> | Interpolated<'property'> {
    return this.#name;
  }

  get value(): string | Array<string | Node> | Node {
    return this.#value;
  }

  /** Explicit semantic boundary for eval, mutation, or compatible visitors. */
  materializeValue(): Node {
    const value = this.#value;
    if (typeof value === 'string' || Array.isArray(value)) {
      return this.#value = parseOrWrapDeclarationValue(value);
    }
    return value;
  }
}
```

There are two variants worth testing:

- **Read-only getter stays textual:** `decl.value` returns a string or mixed segment
  array until a semantic method such as `materializeValue()`, eval, mutation, or
  a compatible visitor asks for a node. This maximizes cheap reads and makes
  direct render simple, but existing callers that assume `value.writeSyntax()`
  must be audited.
- **Getter materializes on node-shaped access:** `decl.value` itself promotes
  textual storage to a canonical node the first time code inspects it. This can
  radically simplify reasoning because ordinary property access becomes the JIT
  boundary, but it can also hide work in innocent-looking reads and make visitor
  planning less explicit. It needs counters and tests so a debug, serialization,
  or visitor path does not accidentally promote the whole tree.

The likely compromise is to expose source-backed public fields for the new Jess
surface while keeping explicit semantic methods for old Less-compatible visitor
adapters and eval paths. That lets code which only renders or compares text
stay allocation-light, while code that genuinely needs canonical nodes can ask
for them through a single well-named boundary.

Guardrails for this experiment:

- do not allocate `Any`/`Keyword`/`Anonymous` wrappers merely to store literal
  declaration values;
- do not create secondary `raw*`, `*Text`, or `*Segments` fields as substitutes
  for semantic fields; cheap text and mixed string/node arrays belong directly
  in `name`, `value`, `important`, `prelude`, or the relevant semantic field;
- do not create both textual and canonical value objects until the canonical value
  is requested;
- property-name indexing should use `name` strings directly when present;
- visitor planning must decide whether `visitDeclaration` requires the
  declaration shell only, canonical name/value nodes, or neither;
- getter-triggered materialization must increment the same counters as explicit
  materialization so tests can prove what was promoted;
- progressive getters/materializers must read each backing field once into a
  local (`const value = this.#value`) and reuse that local for every type check,
  branch, parse input, and return decision in the method. Do not write hot code
  like `typeof this.#value === ...` and then read `this.#value` again for
  `Array.isArray()`, parsing, or returning; repeated private-field/property
  access is avoidable overhead and makes the materialization path harder to
  audit. The intended pattern is:

  ```ts
  const value = this.#value;
  if (typeof value === 'string' || Array.isArray(value)) {
    const parsed = parseOrWrapDeclarationValue(value);
    this.#value = parsed;
    return parsed;
  }
  return value;
  ```

  rather than branching on `this.#value` repeatedly;
- source maps and diagnostics should use offset metadata first and only ask for
  line/column or canonical value nodes when the requested mapping actually needs
  that detail.

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

### 1. Keep selectors raw until selector semantics are demanded

The draft says ordinary selectors can stay raw until needed. That should be the
default at the structural stage. Later compile stages only need selector ASTs
for selector islands whose semantics are actually demanded by the current
consumer, for example:

- a Less `:extend()` candidate is present;
- an `&:extend()` statement appears inside a rule body;
- nested selector composition is needed for a ruleset being evaluated or
  rendered;
- selector lists or selector captures are observed by a visitor, plugin, or
  semantic index;
- extend-root accessibility behavior is needed at render/eval time.

Current Less selector productions build and validate `Extend` nodes during
parse, including target grouping and allowed-selector checks. See
`packages/less-parser/src/productions/selectors.ts` and
`packages/less-parser/src/productions/root.ts`.

Altered shape: structural parse may mark selector islands and cheap candidates
such as obvious `:extend` text, nesting markers, and interpolation. Later
stages should JIT-parse only the selector islands needed to build the relevant
`Ruleset`/`Extend` semantics, satisfy a visitor/plugin, or answer a deeper
semantic-index query.

### 2. Keep values raw until value semantics are demanded

Plain CSS values can often remain raw for a long time. Less/Jess values can
also remain raw until some syntax or operation requires canonical value shape.
The structural parser should classify cheap candidates because these features
can affect runtime behavior when promoted:

- Less math mode decides whether `/` is division or list separator.
- `wrapOuterExpressions` creates `Expression` wrappers for Less-to-Jess
  conversion.
- variable/property references become different `Reference` shapes.
- `default()` and guard forms affect `DefaultGuard` behavior.
- custom properties intentionally parse with different interpolation/reference
  rules.
- at-rule preludes have Less-specific reference/index behavior.

Altered shape: declarations and at-rule preludes stay raw after the structural
stage. Later stages JIT-parse a value/prelude island only when eval/render, a
visitor/plugin, or a semantic index needs the Less/Jess features inside that
range: math candidates, references, interpolation, guards, mixin calls,
custom-property interpolation, or Less-specific at-rule prelude semantics.

### 3. AST compatibility applies at materialization boundaries

`docs/investigation/parser-ast-gap-baseline.md` documents the historical AST
shape that tests and downstream code currently rely on. Treat it as a
compatibility baseline, not a declaration that the existing core AST is the
best possible or permanent shape. High-value compatibility points include
nested namespaced references, `default()` guard semantics, rest params/args,
reference shapes, selector/extend placement, and Less-specific media query
forms.

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

At those materialization boundaries, the promoted shape must either preserve
the relevant compatibility baseline or explicitly document an intentional AST
upgrade. The same source may therefore have two valid test surfaces:
structural snapshots for the first pass, and `serializeTypes(...)` or focused
node assertions for the materialized compiler subtree.

Field-name compatibility should be audited separately from semantic
compatibility. If a node has a single payload currently exposed as
`items`, `components`, or another arbitrary role name, the
scanner-first replacement should evaluate whether that payload can become
`.value` as part of an intentional AST cleanup. Serializer updates for today's
field names are only a way to classify current behavior; they should not
freeze those names into the next parser architecture.

The first cleanup rule is concrete: single-payload collection nodes should use
`.value` as their storage and traversal surface. Old names such as `.items`,
`.components`, and `.selectors` should be migrated at callsites, not preserved
as compatibility aliases. `Rules` is the exception because `.rules` is the
semantic body contract for rule containers, not an old list alias.

`Rules` needs a separate design decision. Today `Ruleset`, `AtRule`, and
`Mixin` each own a `rules: Rules` node, so the child body is a node wrapper
whose own payload is another array. That shape is suspicious for scanner-first
and runtime work because it adds one more object and one more parent boundary
around a block body. The alternative to investigate is making `Rules` a base
class or shared superclass for rule-container behavior. In that model,
`Ruleset`, `AtRule`, and `Mixin` can inherit rules-container behavior and own
`.rules` directly as their body stream, instead of owning `rules: Rules`. At
structural parse time that stream may contain strings and promoted nodes, with
offsets stored in the same compact source map used for declaration values. It
should not be forced into `Node[]` just so traversal can walk it. That keeps
`.rules` as the meaningful semantic body field on multi-role nodes, but removes
the nested wrapper node.

`Rules` should also be understood as a transparent body surface, not as
"whatever prints braces." A stylesheet-root `Rules` serializes as a document.
A plain `Rules` produced by eval, a detached ruleset call, or a transparent
body/grouping block should serialize its child flow directly when it appears
inside another rules array. Braces belong to the enclosing block container
serialization context (`Ruleset`, block-bearing at-rule, or a future explicit
braced grouping node), not to every `Rules` instance by default. That keeps
plain runtime `Rules` useful as an output surface without reintroducing a
wrapper whose only job is to print `{}`.

In that model:

- `Ruleset.rules` is a progressive body stream inherited from the `Rules` base
  behavior, while selector and guard remain separate role fields.
  `AtRuleStatement` owns statement-form at-rules such as `@charset` and
  `@import`; block-bearing `AtRule` inherits from `Rules` and owns
  the same progressive body stream.
- `Mixin.rules` is a progressive body stream, while name/params/guard remain
  separate role fields.
- `If`, `For`, and `While` inherit from `Rules` for their active body streams.
  `If.rules` is the then-body array; `If.else` is an optional alternate
  execution surface (`If` for else-if chains, plain `Rules` for final else).
  There should be no separate `IfBranch`/branch-wrapper AST node.
- Root stylesheets may still need a concrete `Rules` or `Stylesheet` node, but
  nested block bodies do not automatically need a second `Rules` node wrapper.

This should be investigated as an object-reduction and API-simplification
slice, not mixed into parser materialization casually. The migration must prove
that scope frames, lookup, extend bubbling, import/reference boundaries, render
ordering, and parent/source ownership still have a clear owner when the nested
`Rules` wrapper disappears.

Transparent Less/Jess bodies should be named and modeled by their semantics,
not by accidental selector syntax. Less source such as:

```less
.a {
  & {
    color: blue;
  }
}
```

should be normalized to a transparent body/scope concept for the nested block,
not treated as a meaningful `&` selector wrapper. At root, `& {}` is not a
valid ampersand selector context and should not be made valid by synthesizing
a selector. Conditional transparent bodies should be represented by control
nodes such as `$if` or `$when`; unconditional grouping can use a plain `Rules`
output surface or a dedicated transparent-block node only if the runtime needs
an explicit scope boundary.

### 4. Error tolerance must not mean silent semantic repair

The draft correctly asks for broken-code tolerance. For Jess, that should be
stage-specific:

- structural stage: best-effort nodes, diagnostics, scopes, and recovery-mode
  continuation.
- materialization/eval/render stages: preserve current error semantics, produce
  actionable parser errors, and avoid manufacturing AST nodes that later code
  treats as valid.

This split avoids hiding structural bugs behind a forgiving scanner.

Proper error messages are a parser feature, not an afterthought. Scanner-first
work must keep enough source context to report expected constructs, actual
input, source ranges, line/column views, recovery boundaries, and language
profile context. Recovery mode should collect diagnostics and continue to the
next known boundary for language-service and structural-index consumers; normal
compile/materialization paths may still fail when the promoted grammar cannot
produce a semantically valid node. In both cases, malformed input should not
collapse into vague "parse failed" messages.

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
  island parse request planning, optional core adapter, semantic indexes

@jesscss/css-parser / @jesscss/less-parser / @jesscss/scss-parser / @jesscss/jess-parser
  canonical compiler AST parsers and core-aware executors that turn
  structural island requests into core nodes

@jesscss/core
  canonical runtime/eval/render AST and existing plugin host;
  no dependency on parser package or structural parser node types

@jesscss/plugin-less
  exposes the Less structural profile and registers Less island parsers;
  keeps the current Less parser as the default compile pipeline

@jesscss/plugin-scss
  exposes the SCSS structural profile and registers SCSS island parsers as
  covered constructs land

@jesscss/plugin-less-compat
  adapts legacy Less visitor method names to traversal requests for
  Less-adapter-shaped nodes; materialization still happens as needed

@jesscss/language-service
  primary consumer for structural parse, indexes, and node-at-offset APIs
```

Do not create a new "one parser to own everything" package. The compiler AST
parsers remain language-specific. `@jesscss/parser` owns shared parser
infrastructure, source structure, incremental structural shape, and
island parse request planning. Low-level parser modules stay core-blind, while
a dedicated parser service/core-adapter may import `@jesscss/core` if shared
execution should live there. The hard rule is one-way dependency:
`@jesscss/core` does not import `@jesscss/parser`.

## How The Pieces Fit Together

The intended ownership model is:

- `@jesscss/parser` parses source into structural nodes and raw islands. It
  owns spans, trivia, line maps, invalidation, request shapes, cache keys,
  diagnostics envelopes, counters, and the generic executor harness.
- `@jesscss/css-parser`, `@jesscss/less-parser`, `@jesscss/scss-parser`, and
  `@jesscss/jess-parser` own grammar-specific callbacks. They know how to turn
  a requested CSS/Less/SCSS/Jess island into canonical compiler AST nodes.
- `@jesscss/core` owns canonical runtime/eval/render node classes and behavior.
  It does not know structural nodes, raw islands, source ranges, parser
  sessions, or island request state.

Example flow:

```text
source
  -> @jesscss/parser parseStructure()
  -> StructuralDocument:
       RuleNode
       DeclarationNode
       RawIslandNode(value span 120..148)

later, a consumer needs that declaration value:
  -> @jesscss/parser creates IslandParseRequest(value span 120..148)
  -> shared executor handles cache key, slicing, base offset, diagnostics,
     and counters
  -> @jesscss/less-parser grammar callback parses the requested island
  -> callback returns canonical core Value/Expression/Reference nodes
  -> core eval/render sees normal canonical nodes
```

The duplication guard is that downstream parser packages should not each invent
their own request shape, cache key, slicing, diagnostics envelope, or counters.
They provide only grammar-specific callbacks to the shared executor harness.
If a shared helper can remain core-blind, it belongs in `@jesscss/parser`. If a
shared helper needs core node classes, it belongs in a dedicated parser
core-adapter or in the relevant compiler parser package, never in low-level
`source`, `scanner`, `structure`, or `profiles`.

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

Build with the latest TypeScript 7 RC package. TypeScript 7 is the native
compiler line; packages should not rely on declaration plugins that import the
legacy `typescript` module root unless those plugins explicitly support the
TypeScript 7 `unstable/*` APIs. For package artifacts, use `tsdown --no-dts`
for JavaScript output and the TypeScript 7 CLI for declaration emit. Keep strict
type checking as a separate explicit gate so artifact generation is not coupled
to unrelated pre-existing TS7 type debt.

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
  ScannerCursor and delimiter/string/comment helpers

packages/parser/src/structure/
  parseStructure, StructuralDocument, structural node types

packages/parser/src/profiles/
  LanguageProfile, createLanguageProfile, shared profile helper types

packages/parser/src/services/
  IslandParserRegistry, IslandParsePlan, SemanticIndexBuilder
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
- `createLanguageProfile`: helper for parser packages and plugins to provide
  their own syntax profiles.
- generic profile utilities such as `pushIfMissing`, `rangeText`, and
  `normalizeAtRuleName`.
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
- `IslandParsePlan`
- `SemanticIndexBuilder`
- `VisitorMaterializationRule`

`@jesscss/parser` must not export named CSS/Less/SCSS/Jess profiles and must
not bind profiles to file extensions. It is the substrate that CSS+ parser
packages are built on, not a CSS parser package itself.

### `@jesscss/css-parser`

Owns CSS grammar-specific structural services:

- `cssProfile`
- `classifyCssIsland`
- `parseCssStructure(filePath, source, options)`
- `cssIslandParsePlan(filePath, source, registry?, parser?)`
- `registerCssIslandProviders(registry, parser?)`

It should not export `cssStructuralActivation()` or otherwise bind `.css`
extensions. Extension binding belongs to a Jess plugin or adapter layer because
plugins instantiate language parsers and associate them with file extensions.

### `@jesscss/less-parser`

Owns Less grammar-specific structural services:

- `lessProfile`
- `parseLessStructure(filePath, source, options)`
- `lessIslandParsePlan(filePath, source, config?, registry?, parser?)`
- `registerLessIslandProviders(registry, config?, parser?)`

Less may layer on `@jesscss/css-parser` because Less is a CSS+ language, but it
should not require `@jesscss/parser` to know CSS.

### Plugin / Adapter Activation

Jess plugins or adapter modules own `LanguageActivation` objects:

- plugin `name`;
- `supportedExtensions`;
- parser instance ownership;
- parser option binding;
- island provider registration with the parser instance.

This preserves the previous Jess model where plugins instantiate a language
parser and tie it to a file extension, while allowing parser packages to expose
reusable structural services.
- `ParserDiagnostic`
- `ParserStage`

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

`LanguageProfile` should be data plus narrow callbacks, not a parser subclass.
CSS/Less/SCSS/Jess parser packages can publish first-party profiles, but
`@jesscss/parser` must not treat those profiles as a closed enum or export them
as named built-ins. Third-party languages such as Tailwind-oriented dialects,
CSS-in-JS dialects, or project-local CSS extensions should be able to provide
their own profile name, statement starters, interpolation starts, classifiers,
and island providers without forking `@jesscss/parser`.

```ts
interface LanguageProfile {
  name: string;
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

Extension model:

- `@jesscss/parser` owns the generic structural parser, source model, profile
  type, island registry, parse plan, and semantic-index machinery.
- Built-in parser packages register providers for built-in profile names.
- Plugins continue to own language activation: they can instantiate a language
  parser, associate it with one or more file extensions, provide the structural
  `LanguageProfile`, and register island providers under that profile name.
- A third-party package can export `tailwindProfile` or another
  `LanguageProfile`, then a plugin can bind it to extensions such as `.css`,
  `.pcss`, or project-specific files and register providers with
  `IslandParserRegistry`.
- Visitor and plugin materialization should key off registered provider
  capabilities and structural node/island kinds, not a hardcoded list of
  built-in language names.

Purpose:

- make offset-first spans consistent across all parser work;
- avoid each parser inventing its own location/trivia model;
- support lazy line/column mapping;
- preserve newline ownership explicitly;
- provide a structural document parser for language-service work;
- provide shared structural indexing, island parse planning, cache-key, and
  counter services for parser packages and plugins;
- preserve proper parser diagnostics and recovery-mode behavior as shared
  infrastructure, not duplicated language-package policy;
- provide one public package home for shared parser infrastructure.

Implementation sketch for source/scanner:

```ts
function scanStructure(source: SourceText, profile: LanguageProfile) {
  const cursor = new ScannerCursor(source.text);
  const document = new StructuralDocumentBuilder(source);
  const stack = document.blockStack;

  while (!cursor.eof()) {
    const triviaStart = cursor.offset;
    scanTriviaInto(cursor, document.trivia);

    const start = cursor.offset;
    const token = scanStructuralToken(cursor, profile);

    switch (token.kind) {
      case 'block-open':
        document.openBlock(token.blockKind, start, token.headerStart, token.headerEnd);
        break;
      case 'block-close':
        document.closeBlock(start, cursor.offset);
        break;
      case 'statement':
        document.appendStatement(classifyStatement(source, token, profile, stack));
        break;
      case 'error':
        document.appendError(createDiagnostic(source, profile, token, start, cursor.offset));
        recoverToNextBoundary(cursor);
        break;
    }

    document.attachTrivia(triviaStart, cursor.offset);
  }

  return document.finish();
}
```

Performance constraints for this layer:

- store offsets, not eager line/column objects;
- scan with cursor offsets and char codes in hot loops;
- build small structural records, not compiler AST nodes;
- build the structural tree directly instead of allocating an intermediate
  event list;
- store hot spans as numeric offset fields and expose span objects only as API
  views;
- avoid allocating token objects for trivia that can be stored as ranges;
- recover by scanning to known boundaries instead of throwing for normal
  malformed input.
- carry enough expected/actual/context data through diagnostics to produce
  useful human error messages without eagerly computing line/column objects.

First source/scanner coverage:

- line-map conversion for LF, CRLF, CR, and form-feed;
- string/comment scanning with escapes and EOF;
- delimiter span capture for `{}`, `()`, `[]`;
- trivia runs before, after, and inside structural nodes;
- malformed input diagnostics with expected construct, actual source range,
  recovery boundary, and lazy line/column rendering.

Custom property values need special care. CSS Variables defines custom
properties with the permissive `<declaration-value>` grammar, but that does
not mean raw text can ignore all block markers. A declaration value must not
contain unmatched closing `)`, `]`, or `}` tokens, and top-level semicolons end
the declaration. Scanner-first structure should therefore treat quoted strings,
comments, `url(...)`, and nested component-value blocks as opaque while finding
the declaration boundary, but it should not eagerly parse the custom property
payload into semantic CSS values unless a later stage asks for that detail.

### Lazy Line/Column Mapping

Store source locations internally as character offsets only. Parser structures
should use end-exclusive ranges such as:

```ts
interface ParserRange {
  start: number;
  end: number;
}
```

Do not eagerly store `startLine`, `startColumn`, `endLine`, or `endColumn` on
hot parser structures. AST construction, traversal, scope analysis, selector
indexing, extend graph construction, incremental invalidation, and semantic
indexing all need stable source ranges, not human-readable coordinates.

Line/column information should be produced lazily through `LineMap` when a
consumer needs to talk to a person or editor protocol:

- diagnostics;
- editor squiggles;
- hover ranges;
- goto definition;
- rename;
- LSP responses;
- source maps.

Even source maps should not automatically force detailed per-node
line/column storage. Useful CSS source maps may only need coarser mappings for
generated chunks, rules, declarations, or emitted output segments. Add
fine-grained mappings only when a source-map consumer proves it needs that
detail.

`LineMap` should be built on first use by scanning the source once, recording
line-start offsets, and using binary search for offset-to-line/column
conversion. Position-to-offset conversion should use the same line-start table.
Do not build the map with `source.split('\n')` or any equivalent that creates
one substring per line. The first implementation should be a cursor loop over
`charCodeAt()` or `indexOf()` because hot primitive scans should avoid match
arrays and regex-engine control-flow opacity by default. A sticky/global
newline regex is only a benchmark candidate if it makes the implementation
substantially clearer and can walk the source without allocating matched line
text. The stored result should be a numeric line-start table, preferably a
plain `number[]` initially and a typed-array candidate only if measurement
shows the conversion cost is worth the extra construction step.

For incremental parsing, `SourceText.version` and structural document version
become part of the cache key. When source changes, increment the version,
reparse affected ranges, invalidate any old line map, and rebuild line/column
data only if a consumer requests it for the new source.

Benchmark questions:

- full parse time with eager line tracking versus offset-only structures;
- memory consumed by eager line/column fields versus lazy line starts;
- source-map and diagnostic line-map construction with cursor scan versus
  newline regex versus line-splitting substring allocation;
- diagnostic rendering time after a parse;
- completion generation time;
- incremental edit performance when the edit does and does not require
  line/column rendering.

Hypothesis: scanner-first parsing should benefit from offset-first structures,
lazy line mapping, and incremental reparsing because most internal parser work
cares about source ranges rather than human-readable coordinates.

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

The low-level `source`, `scanner`, `structure`, and `profiles` modules should
not expose or import `@jesscss/core` `Node` or `Rules` values. The services
layer owns `IslandParsePlan` for one source version and one structural
document. A core adapter in `@jesscss/parser` or a language parser package can
execute that plan into core nodes without creating a cycle, because
`@jesscss/core` does not depend back on parser.

`IslandParsePlan` exposes:

- `requestIsland(island, target): IslandParseRequestId`
- `requestNode(structuralNode, target): IslandParseRequestId`
- `planVisitorTraversal(visitorShape, phase): IslandParsePlanId`
- `planCompileBoundary(boundary): IslandParsePlanId`
- `getCachedRequest(range, key)`
- `createExecutor<T>(hooks): IslandRequestExecutor<T>`
- `describeRequest(id): IslandParseRequest`

The core-aware executor can live in `@jesscss/parser/services/core-adapter` or
in a language parser package:

- `executeRequest(id): Node | Rules | LessAdapterNode`
- `executeTraversalPlan(plan, visitor): void`
- `executeCompilePlan(plan): Rules`

The executor is where conversion happens. For example, a shared executor
harness can take a Less value island request, slice the source range, call the
Less parser package's grammar callback, and return the canonical core node
shape. Core does not perform that conversion.

To avoid duplicating infrastructure across language parser packages,
`@jesscss/parser` should provide the generic executor harness. The harness is
generic over result type and owns the shared mechanics:

- request de-duplication;
- source range slicing and base-offset context;
- cache lookup and cache write;
- diagnostics envelope;
- counters for request count, execution count, cache hits, promoted bytes, and
  fallback full-tree count.

Language parser packages provide only the grammar-specific callback:

```ts
const executor = plan.createExecutor<Node>({
  parse(request, context) {
    return parseLessValueIsland(context.text, {
      baseOffset: context.baseOffset,
      mathMode: context.parserConfig.mathMode,
      diagnostics: context.diagnostics,
    });
  },
});
```

This keeps grammar ownership in the language parser package while keeping cache
keys, slicing, diagnostics plumbing, and performance counters DRY. If the
shared executor imports core for result types, it must live in a dedicated
service/core-adapter module, not in `source`, `scanner`, `structure`, or
`profiles`.

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
function requestIsland(island: RawIslandRef, target: TargetShape) {
  const key = makeCacheKey(source.version, island, target, parserConfig);
  const cachedId = requestIds.get(key);

  if (cachedId !== undefined) {
    return cachedId;
  }

  const id = requests.add({
    key,
    language: island.language,
    kind: island.kind,
    target,
    contentSpan: island.contentSpan,
    baseOffset: island.contentSpan.start,
    context: island.context,
  });

  requestIds.set(key, id);
  return id;
}
```

Performance constraints for island parse planning and execution:

- plan each stable source/range/config/target at most once per structural
  document version, returning cached request ids where possible;
- execute each stable request at most once per core-aware compile/plugin
  session;
- parser packages parse only the island text and pass a base offset for source
  spans;
- do not copy source strings except where the existing parser entrypoint
  requires a substring;
- keep failed execution diagnostics cached separately from thrown exceptional
  errors;
- record counters for request id count, request object/view count, execution
  count, cache hits, promoted byte ranges, and fallback full-tree
  materializations.

`SemanticIndexBuilder` consumes structural nodes first and issues
island parse requests only when an index needs deeper syntax:

- imports: structural-only for path and at-rule shell;
- variables: structural declaration shell plus value island only when needed;
- mixins: structural signature first, core-aware execution when called or
  visited;
- extends: selector island requests for targets and extenders;
- references: value/prelude requests when the structural scan detects variable,
  property, interpolation, or call syntax.

Implementation sketch:

```ts
function buildIndexes(document: StructuralDocument, plan: IslandParsePlan) {
  for (const node of document.root.children) {
    switch (node.kind) {
      case 'Import':
        imports.add(importFromShell(node));
        break;
      case 'VariableDeclaration':
        variables.add(variableFromShell(node));
        if (needsValueDetail(node.valueIsland)) {
          references.request(plan.requestIsland(node.valueIsland, 'jess-core'));
        }
        break;
      case 'Rule':
        symbols.add(ruleSymbolFromHeader(node));
        if (node.hasExtendCandidate) {
          extends.request(plan.requestIsland(node.selectorIsland, 'jess-core'));
        }
        break;
    }
  }
}
```

The important property is selective promotion without dependency inversion:
indexes should prove which questions they can answer from structure alone and
which questions require a core-aware executor to run island parse requests.

Dependency rule:

- `@jesscss/core` must not import `@jesscss/parser` or structural node types.
- `@jesscss/parser/source`, `scanner`, `structure`, and `profiles` must not
  import `@jesscss/core`, Chevrotain, or language parser packages.
- `@jesscss/parser/services` may have a dedicated core adapter that imports
  `@jesscss/core`; that is a one-way dependency and does not create a cycle.
- `@jesscss/parser` must not import language parser packages directly or
  execute their grammar entrypoints. Language parser packages register or pass
  grammar callbacks into the shared executor harness.
- Compiler parser packages and plugins may depend on both `@jesscss/parser`
  and `@jesscss/core`.

Core simplicity guard:

- Reason: core nodes are the canonical runtime/eval/render representation.
  Their methods should be deterministic over already-materialized children and
  runtime context. If they also own JIT parsing, every hot-path node method has
  to understand source ranges, structural node kinds, parser sessions,
  invalidation, cache state, and diagnostics. That spreads parser policy across
  the runtime and makes performance/correctness harder to test.
- JIT parsing orchestration must not move into ordinary core node methods.
- Core eval/render/visitor methods should receive canonical nodes or adapter
  nodes at the boundary they already operate on.
- Lazy promotion decisions belong in parser services, parser-package executors,
  plugin adapters, or the compile pipeline.
- If a core method starts checking structural node kinds, source ranges, or
  island request state, the boundary has leaked and should be moved back out.

Duplication guard:

- `@jesscss/parser` owns request shape, cache-key construction, source slicing,
  base-offset plumbing, diagnostic envelopes, counters, and the generic
  executor harness.
- Language parser packages own grammar entrypoints and core-node construction.
- If two language parser packages need the same non-grammar helper, move that
  helper down into `@jesscss/parser` only if it can stay core-blind.
- If a helper needs `@jesscss/core` node classes, it belongs either in a
  dedicated `@jesscss/parser` core adapter or in the relevant compiler parser
  package. It must not leak into `source`, `scanner`, `structure`, or
  `profiles`.

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
The structural stage can ship for indexing, highlighting, and language-service
consumers first, while compiler parsers gradually publish reusable island
entrypoints.

## Plugin Integration

Current plugin parsing is centered on `PluginInterface.safeParse(filePath,
source)` and `Context.findParserPlugin(...)`. That should remain the public
compiler entrypoint.

Do not put structural parser types directly into `@jesscss/core`
`PluginInterface` as the first design. That would make core depend on parser
types and blur the boundary. Less compatibility needs an adapter around today's
visitor shape, but Jess-native plugin and visitor shapes can still change while
SCSS parsing is finalized and released as alpha.

Candidate plugin-package capabilities:

```ts
interface StructuralPluginCapabilities {
  structureProfile?: LanguageProfile;
  structureParse?(filePath: string, source: string): StructuralDocument;
  islandParsePlan?(filePath: string, source: string): IslandParsePlan;
  executeIslandParse?(
    request: IslandParseRequest
  ): Node | Rules | LessAdapterNode;
  visitorPlan?(
    visitor: PluginVisitor,
    phase: VisitorPhase
  ): VisitorMaterializationRule | undefined;
}
```

This capability shape belongs in parser-aware plugin packages or adapter
modules, not in core unless the package dependency graph is intentionally
changed later.

Integration rules:

- `safeParse` still returns canonical `Rules` for compiler/eval/render.
- `structureParse` returns structural-stage data and can be used by
  `@jesscss/language-service` without forcing full AST construction.
- `islandParsePlan` is backed by `@jesscss/parser`.
- `executeIslandParse` is core-aware and lives in compiler parser packages
  or plugins that already depend on `@jesscss/core`.
- Existing plugins that implement only `safeParse` continue to work unchanged.
- Plugins that support custom syntax can provide a `LanguageProfile` and island
  parser providers without replacing the whole parser.

Package-specific plugin behavior:

- `@jesscss/plugin-less`
  - owns `.less` `LanguageActivation`;
  - reuses `@jesscss/less-parser` `lessProfile` and island providers;
  - uses current `LessParser.safeParse` for the default compile pipeline;
  - exposes Less adapter targets when Less-compat traversal requests them.
- `@jesscss/plugin-scss`
  - owns `.scss` / Jess-compatible activation when that slice is implemented;
  - uses current SCSS/Jess-compatible parser for the default compile pipeline;
  - registers SCSS island parsers when they are covered by tests.
- `@jesscss/plugin-less-compat`
  - remains adapter-based;
  - maps Less-compatible visitor methods to traversal requests;
  - asks for Less-adapter-shaped nodes as traversal reaches them.
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
  | { kind: 'traversal'; target: 'jess-core' | 'less-adapter' }
  | { kind: 'node-shapes'; nodeTypes: string[]; includeParents: true }
  | { kind: 'structural-only' };
```

Default policy:

- inspect the visitor object registered for the phase and build a method table;
- map method names to node kinds before traversal starts. For example,
  `visitDeclaration` means declaration shells and the parent rule path are
  needed; `visitSelector` means containing rule/ruleset headers and selector
  islands are needed; `visitAtRule` means at-rule shells plus observable
  prelude/body islands are needed;
- a truly generic catch-all handler is a broad handler, but that should be the
  fallback case. Normal Jess/Less visitors should be planned from their unique
  node-specific methods;
- replacing visitors require materialized nodes at the replacement boundary,
  but still request them as traversal reaches those boundaries;
- typed Jess visitor methods materialize the parent shapes needed to reach that
  node type through normal traversal;
- selector methods require ruleset/rule header shape plus selector islands;
- declaration/value methods require containing rules, declaration shell, and
  value islands;
- at-rule methods require at-rule shell and prelude/body islands the method can
  observe;
- Less-compatible visitors use Less method names like `visitRuleset`,
  `visitDeclaration`, `visitSelector`, and `visitAtRule`, and request
  Less-adapter-shaped nodes as those traversal points are reached;
- structural-only consumers do not use `Node.accept`; they receive
  `StructuralDocument` through language-service APIs.

The key rule is parent shape first, child detail second. A visitor registered
for `declaration` does not require every selector value in the file, but it
does require enough parent rules/rulesets/at-rules to traverse to declarations
correctly. A visitor registered for selector nodes requires selector islands and
their containing ruleset headers. Materialization follows the precomputed
visitor method table and traversal path, not a vague global interest list.

JIT visiting is allowed only behind a stable node boundary:

```text
LazyIslandNode.accept(visitor)
  -> core-aware plugin/parser adapter executes an IslandParseRequest
  -> the canonical Node handles accept(visitor)
```

This should not be the initial compiler path. Initial compiler integration
should materialize at traversal boundaries through ordinary session calls. JIT
`accept` on a raw island node is a later optimization once the materialization
cache and visitor method mapping are proven.

## Source Span Strategy

The first structural parser milestone must produce more explicit spans than the
current parser. This is not because the current `LocationInfo` shape is sacred;
it is because scanner-first consumers need start/end/newline/trivia ownership
that the current inferred shape does not reliably express.

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

The structural parser should not copy the current `LocationInfo` behavior by
default, where rule start/end is inferred only from first/last consumed tokens.
It should own range construction directly while scanning. If any current
location shape is preserved, it should be preserved as an intentional
compatibility adapter, not as the internal model.

## Performance Acceptance Strategy

Performance is a primary concern, but it should be tested as a set of concrete
runtime properties instead of a single "is it faster?" claim.

Correctness and compatibility gates still come first:

- structural parser diagnostics and spans are correct;
- default compile pipeline behavior is preserved;
- materialized islands preserve the relevant historical AST contracts;
- plugins and visitors do not observe raw placeholders unless they use the
  structural API.

Performance gates should be added as soon as each layer exists:

- structural parse time on the existing CSS/Less/SCSS corpus;
- peak and retained allocation for structural parse;
- number of structural records per input byte;
- number and total byte size of promoted islands;
- island parse request cache hit/miss counts;
- number of fallback full-tree materializations;
- end-to-end compile/eval/render time once compiler opt-in exists.

The first performance target is not "beat the current compiler parser on every
file." The first target is to prove that structural consumers can answer
indexing, highlighting, folding, and node-at-offset questions without building
full compiler ASTs, and that the default compile pipeline does not regress when
the new services are present but inactive.

Benchmark comparisons should keep these paths separate:

- current compiler parser;
- scanner-first structural parse only;
- scanner-first structural parse plus selected island materialization;
- scanner-first full compile materialization.

Do not claim a speed win without before/after measurements. Also do not accept
a local object-count win if it adds more expensive side maps, recursive walks,
or fallback full-tree materializations in the real path.

Cutting total `packages/core/src` line count by roughly 50% is a stretch goal,
not a release gate and not the primary acceptance metric. The primary target is
faster real Less compile/eval/render behavior with fewer hot-path objects, fewer
unnecessary branches, and simpler canonical runtime state. Line-count reduction
should come from deleting proven redundant machinery, not from compressing code,
moving complexity into equally expensive helpers, or preserving machinery that a
new scanner-first path made obsolete only because it helps hit a numeric target.

## Package Build Performance Guards

As the packages are built, each package should add the smallest benchmark or
counter harness that proves its layer is not hiding work in the next layer.
The guard is evidence, not a promise that the first implementation is faster.

Shared rules:

- Every new stage records structured counters in tests or benchmark output:
  elapsed time, input bytes, node/record counts, island count, promoted island
  count, promoted bytes, cache hits/misses, diagnostics, and fallback full-tree
  materializations.
- Benchmark output should be separated by stage. Do not combine structural
  scan, selected materialization, visitor traversal, and full compile into one
  number.
- Any PR that changes scanner, structure, services, island providers, visitor
  traversal, or compile opt-in must include before/after output for the smallest
  relevant corpus slice.
- A regression is allowed only when it is named with a tradeoff: which counter
  moved, why, and what correctness/API capability required it.
- "Fewer objects" is not enough. Guard against replacing AST nodes with larger
  side maps, repeated walks, substring churn, or fallback full-tree promotion.

Package-specific guards:

- `@jesscss/parser/source`
  - line-map tests cover LF, CRLF, CR, and form-feed;
  - benchmark reports source bytes, line count, line-map entries, construction
    time, and retained line-map memory where measurable;
  - guardrail: line/column objects are not eagerly allocated per token/node.
- `@jesscss/parser/scanner`
  - benchmark reports input bytes, trivia ranges, delimiter scans, string/comment
    scans, recovery scans, and allocations per byte where measurable;
  - guardrail: hot loops use offsets/char codes and do not allocate token
    objects for trivia that can remain ranges;
  - guardrail: recovery-mode diagnostics remain structured data and do not
    allocate `Error` objects for routine malformed input.
- `@jesscss/parser/structure`
  - benchmark reports structural records per input byte, max block depth,
    diagnostics, raw islands, changed ranges, object count where measurable,
    and parse time;
  - guardrail: malformed input recovery does not throw for routine errors;
  - guardrail: user-facing error messages can be rendered from diagnostics with
    expected/actual/context text and accurate source ranges.
- `@jesscss/parser/services`
  - tests assert cache keys include source version, range, language, island
    kind, parser config, and target shape;
  - benchmark reports island parse request ids, request object/view creation,
    actual island parses, cache hits, promoted bytes, semantic-index requests,
    and fallback full-tree count;
  - guardrail: structural-only indexes prove zero materialization for queries
    they claim to answer structurally.
- parser package island providers
  - benchmark selected island parsing separately from full file parsing;
  - report substring/copy behavior, base-offset span correction, diagnostics,
    and promoted shape assertions;
  - guardrail: provider entrypoints do not silently parse sibling islands.
- plugin and visitor integration
  - visitor tests report traversal requests, materialized node count, promoted
    island count, adapter-node requests, replacements, and fallback full-tree
    count;
  - guardrail: registering a visitor does not by itself promote the whole tree.
    Traversal should request shapes as it reaches them.
- `@jesscss/language-service`
  - benchmark folding, symbols, node-at-offset, highlighting chunks, and
    completions separately;
  - report changed ranges and re-highlighted/re-materialized chunks after an
    edit;
  - guardrail: editor-style consumers can stop after structural scan and only
    request chunk materialization for affected ranges.

## Object-Creation And Simplification Cuts

The first implementation should prefer the simplest shape that preserves spans,
trivia ownership, demand-driven island parsing, and stage-specific consumers.
These are design constraints, not measured speed claims.

Cut candidates:

- Avoid an intermediate `StructuralEvent[]` if the structural tree can be built
  directly while scanning. Keep a stack of open blocks and append closed child
  records directly to the current parent.
- Do not allocate nested `SourceSpan` objects inside every hot structural node.
  Store hot spans as numeric fields such as `start`, `end`, `headerStart`,
  `headerEnd`, `valueStart`, and `valueEnd`. Export `SourceSpan` as an API
  view/helper when callers need the object shape.
- Do not allocate `DelimitedSpan` objects for every block up front. Store
  delimiter offsets on the block node and construct a `DelimitedSpan` view only
  for callers that ask for it.
- Do not create `TriviaRun` records for all whitespace by default. Store newline
  ownership and comment ranges first; preserve full whitespace ranges only for
  consumers that need formatting or exact trivia.
- Do not create a standalone `RawIslandNode` for every selector/value if the
  containing rule or declaration can store island kind plus start/end offsets.
  Use standalone island nodes only when tree navigation requires them.
- Do not make `IslandParseRequest` a mandatory object allocation on every
  request. The hot path can return a request id or cache key and expose an
  object view for diagnostics/tests.
- Do not return fresh arrays from visitor planning on every traversal. Compile
  visitor method tables into compact shape masks or cached request plans.
- Do not eagerly build every semantic index. Build cheap structural indexes
  first, and lazily fill deeper selector/value/reference indexes on demand.
- Do not allocate line/column pairs during parse. Keep line starts lazy and
  resolve line/column only for diagnostics, source maps, or external APIs.
- Do not allocate a fresh executor context object for every island parse if a
  reusable context can safely carry source slice, base offset, parser config,
  diagnostics sink, and counters.

Checklist impact:

- Structural parser tasks should report both node count and allocated object
  count where measurable.
- Service tasks should report request ids/objects separately so object view
  creation is visible.
- Visitor tasks should report method-table cache hits and whether traversal
  allocated request arrays.
- Language-service tasks should report whether highlighting/completion reused
  chunk plans after edits.

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

The result should feed `LanguageProfile` classification and island parse
planning, not become a production dependency.

## Implementation Plan

Use these slices as a working checklist. Do not mark a slice complete until its
verification items are green and its performance counters are recorded.
When completing work from this plan, update the relevant checkboxes in the same
change set as the implementation or verification evidence.

Use [`scanner-first-structure-targets.md`](./scanner-first-structure-targets.md)
as the example-driven seed for the eventual structure-parse corpus. Before
widening parser behavior, add or update target examples there with cheap
structure, direct behavior, JIT triggers, and current status.

### Documentation Standard

Every new scanner-first parser file must include useful JSDoc on exported
classes, functions, types, and package-facing helpers. This is required for
`@jesscss/parser`, CSS/Less/SCSS/Jess island provider entrypoints, plugin
activation helpers, and visitor/materialization adapters. JSDoc should explain
ownership boundaries, lazy allocation/materialization behavior, recovery
semantics, performance counters, and extension/plugin registration semantics.
Do not add comments that merely restate parameter names or obvious control
flow.

### Slice 0: Plan And Corpus Inventory

Goal: turn this strategy into a trackable baseline and identify existing
fixture coverage before adding new files.

- [x] Confirm this document is the active scanner-first parser plan.
- [x] Inventory checked-in CSS fixtures for span, trivia, malformed-input, and
  structural-boundary coverage.
- [x] Inventory checked-in Less fixtures for variables, mixins, guards,
  `:extend`, selector nesting, media preludes, and value/reference syntax.
- [x] Inventory checked-in SCSS fixtures or parser tests for `$var`, `#{}`,
  `@use`, `@forward`, and `@include` coverage.
- [ ] Identify fixture gaps that cannot be covered by the existing corpus.
- [ ] Add only scanner-specific fixture files needed for proven gaps.
- [x] Add a structural corpus gate for every checked-in `.css`, `.less`, and
  `.scss` file.
- [x] Add an upstream Less test-data structural corpus gate that reuses the
  existing Jess compatibility blacklist.
- [x] Document that broad `.jess` syntax corpus expansion waits until the SCSS
  parser shape is finalized and shipped as alpha.
- [ ] Verification: structural fixture snapshots assert spans, trivia,
  diagnostics, and island candidates only.
- [x] Verification: `pnpm --filter @jesscss/parser test`.
- [ ] Verification: default compiler parser behavior is unchanged.

### Slice 1: `@jesscss/parser` Source Model

Goal: replace the package internals with offset-first source primitives.

- [x] Create `packages/parser/src/source/`.
- [x] Implement `SourceText` with immutable text, optional `filePath`,
  `version`, and lazy line-map access.
- [x] Implement `SourceSpan` as `{ start: number; end: number }` with
  end-exclusive offsets.
- [ ] Store hot spans internally as numeric fields and expose `SourceSpan`
  objects only as API views.
- [x] Implement `DelimitedSpan` with full, content, open delimiter, and close
  delimiter spans.
- [ ] Store delimiter offsets internally and construct `DelimitedSpan` views
  lazily.
- [x] Implement `TriviaRun` ranges for whitespace, line comments, block
  comments, and newline ownership.
- [ ] Avoid allocating full whitespace trivia runs unless a formatting/exact
  trivia consumer requests them.
- [x] Implement `LineMap` for LF, CRLF, CR, and form-feed.
- [x] Export source primitives from `@jesscss/parser`.
- [x] Add JSDoc for exported source primitives and lazy line-map behavior.
- [x] Test line/column conversion in both directions.
- [x] Test newline ownership and trivia ranges across comments, blank lines,
  and EOF.
- [x] Performance guard: report source bytes, UTF-16 length, lazy line-map
  materialization state, and line-map entries when already materialized.
- [ ] Performance guard follow-up: benchmark construction time and retained
  line-map memory in a dedicated harness instead of the parser hot path.
- [x] Verification: `pnpm --filter @jesscss/parser test`.
- [x] Verification: `pnpm --filter @jesscss/parser build`.

### Slice 2: Scanner Cursor And Structural Token Helpers

Goal: add shared CSS-family scanning primitives without compiler AST nodes.

- [x] Create `packages/parser/src/scanner/`.
- [x] Implement `ScannerCursor` with offset and char-code operations.
- [x] Implement string scanning with escapes and EOF diagnostics.
- [x] Implement line-comment and block-comment scanning.
- [x] Implement delimiter scanning for `{}`, `()`, and `[]`.
- [x] Implement interpolation shell scanning for CSS-family language profiles.
- [x] Implement recovery scanning to the next statement or block boundary.
- [x] Implement structured parser diagnostics with expected construct, actual
  range, context, and recovery boundary data.
- [x] Add JSDoc for scanner helpers, diagnostics, and recovery semantics.
- [x] Test strings, comments, escapes, delimiters, EOF, recovery, and rendered
  error messages.
- [x] Performance guard: report input bytes, trivia ranges, delimiter scans,
  string/comment scans, and recovery scans.
- [ ] Performance guard follow-up: measure scanner allocations per byte in a
  dedicated harness.
- [x] Verification: `pnpm --filter @jesscss/parser test`.
- [x] Verification: `pnpm --filter @jesscss/parser build`.

### Slice 3: Language Profiles

Goal: make CSS/Less/SCSS/Jess classification data-driven and DRY.

- [x] Create `packages/parser/src/profiles/` for generic profile types and
  helpers only.
- [x] Define `LanguageProfile`.
- [x] Move `cssProfile` to `@jesscss/css-parser` with CSS structural service
  tests.
- [x] Move `lessProfile` to `@jesscss/less-parser` with Less structural service
  tests.
- [x] Add `scssProfile` in `@jesscss/scss-parser` or the SCSS/Jess parser
  package when SCSS parser alpha shape is ready.
- [x] Add final Jess-native profile only after SCSS alpha establishes the
  base language shape.
- [x] Test parser substrate profile extensibility with fixture profiles rather
  than exported CSS/Less/SCSS/Jess built-ins.
- [x] Add JSDoc for profile extension points and third-party language
  registration expectations.
- [x] Performance guard: profile callbacks return classification data only and
  do not allocate compiler nodes.
- [x] Verification: `pnpm --filter @jesscss/parser test`.
- [x] Verification: `pnpm --filter @jesscss/parser build`.

### Slice 4: Structural Document Parser

Goal: parse source into a structural document with spans, trivia, diagnostics,
and raw islands.

- [x] Create `packages/parser/src/structure/`.
- [x] Define structural node types: `DocumentNode`, `BlockNode`, `RuleNode`,
  `DeclarationNode`, `AtRuleNode`, `MixinDefinitionNode`, `MixinCallNode`,
  `VariableDeclarationNode`, `ImportNode`, `RawIslandNode`, and `ErrorNode`.
- [x] Implement `parseStructure(source, profile, options)`.
- [x] Build the structural tree directly while scanning instead of allocating
  an intermediate event array.
- [x] Implement `StructuralDocument.root`, `source`, `diagnostics`, and
  `trivia`.
- [x] Implement `findNodeAt(offset)`.
- [x] Implement `scopeAt(offset)`.
- [x] Implement `foldingRanges()`.
- [x] Implement `symbols()`.
- [x] Implement `islands(kind?)`.
- [x] Implement `changedRanges(previousDocument)`.
- [x] Add JSDoc for structural nodes, document queries, islands, and span
  ownership.
- [x] Test multi-line selectors, declaration values, custom properties,
  comments around nodes, incomplete declarations, and EOF blocks.
- [x] Test malformed input recovery without throwing.
- [x] Performance guard: report structural records per input byte, max block
  depth, diagnostics, raw island count, trivia ranges, and changed ranges.
- [ ] Performance guard follow-up: measure structural object count and parse
  time in a dedicated harness instead of storing timing on structural documents.
- [x] Verification: `pnpm --filter @jesscss/parser test`.
- [x] Verification: `pnpm --filter @jesscss/parser build`.

### Slice 5: Parse Services And Island Parse Planning

Goal: add core-blind planning machinery for demand-driven promotion requests.

- [x] Create `packages/parser/src/services/`.
- [x] Implement `IslandParserRegistry`.
- [x] Define provider keys as language, island kind, parser config, and target
  shape.
- [x] Implement `IslandParsePlan` for one `SourceText` version and one
  `StructuralDocument`.
- [x] Implement `requestIsland(island, target)`.
- [x] Implement `requestNode(structuralNode, target)`.
- [x] Return cached request ids on the hot path and expose request objects only
  through debug/test/API views.
- [x] Implement the generic executor harness without allocating a fresh context
  object for every island when a reusable context is safe.
- [x] Implement traversal-boundary island parse requests for
  visitors/plugins.
- [x] Implement cache keys including source version, range, language, island
  kind, parser config, and target shape.
  - [x] Review fix: request/registry cache keys no longer use lossy
    pipe-delimited decoding. Request views are derived from stored provider
    keys plus stored island spans, and delimiter-looking language/config/target
    fields round-trip in tests.
- [x] Cache request/execution diagnostics separately from exceptional failures.
- [x] Add counters for requests, actual parses, cache hits/misses, promoted
  bytes, and fallback full-tree materialization.
- [x] Add JSDoc for registry keys, parse plans, activation registry, counters,
  and fallback/full-tree semantics.
- [x] Test cache hits and misses with mocked providers.
- [x] Test that registering a visitor does not promote the whole tree.
- [x] Performance guard: structural-only service queries prove zero
  materialization when they claim to answer from structure alone.
- [x] Performance guard: report request id count separately from request
  object/view creation.
- [x] Verification: `pnpm --filter @jesscss/parser test`.
- [x] Verification: `pnpm --filter @jesscss/parser build`.

### Slice 6: Semantic Index Builder

Goal: build indexes from structure first and promote only the islands a query
actually needs.

- [x] Implement `SemanticIndexBuilder`.
- [x] Build cheap structural indexes first and lazily fill deeper
  selector/value/reference indexes only when requested.
  - [x] Review fix: lazy semantic indexes are cached per requested target shape
    so `core-*`, adapter, and visitor-shaped requests cannot reuse the wrong
    request ids.
- [x] Index imports from structural at-rule shells.
- [x] Index variable declarations from structural declaration shells.
- [x] Index mixin signatures structurally and issue island parse requests
  only when called or visited.
- [x] Index extend candidates from structural selector candidates, then
  request selector island execution only for target/extender detail.
- [x] Index references by requesting value/prelude island execution only when
  cheap structural classification detects reference-like syntax.
- [x] Test imports, variables, mixins, extends, and references separately.
- [x] Test structural-only indexes avoid materialization.
- [x] Performance guard: report semantic-index requests, materialization
  requests, actual island parses, cache hits, promoted bytes, and lazily filled
  index counts.
- [x] Verification: `pnpm --filter @jesscss/parser test`.
- [x] Verification: `pnpm --filter @jesscss/parser build`.

### Slice 7: CSS And Less Island Provider Entrypoints

Goal: expose narrow parser-package entrypoints for canonical compiler nodes.

Correction after implementation review: the current CSS/Less provider
entrypoints are legacy-parser adapters. They slice structural islands and call
existing parser productions such as `selectorList`, `valueList`, and
`mediaQuery`. That is useful as a comparison harness and AST-contract probe,
but it is not the scanner-first parser replacement. Completion requires
scanner-native materializers for the covered CSS/Less constructs; Chevrotain-
backed provider execution may remain only as an explicit transitional fallback
or comparison mode.

- [x] Map each CSS/Less provider against the current token definitions,
  productions, and parser tests before implementing it. CSS work should use
  `cssTokens.ts` plus CSS productions as compatibility guide rails; Less work
  should use `lessTokens.ts` plus Less overrides/additions the same way. Treat
  those files as a compatibility inventory and regression map, not as a sacred
  implementation template. The mapping should answer "what behavior do we need
  to preserve?" before it answers "which token regex do we copy?".
- [x] For each mapped token/provider behavior, choose an explicit scanner-first
  fidelity tier before implementing it:
  exact hot-path recognition, cheap common-case structural recognition,
  deferred island parsing with canonical fallback, diagnostic-only recovery, or
  intentionally unsupported edge handling. Some existing tokens are more
  spec-complete than useful for the scanner hot path, especially expansive
  Unicode ranges, obscure escape forms, and recovery branches that rarely
  appear in real Sass/Less/CSS authoring. High-cost grammar fidelity should
  earn its place with evidence from Jess corpora, expected authoring patterns,
  diagnostic quality, language-service usefulness, or a clear
  fallback/materialization story. Any divergence from existing productions must
  be documented as an intentional structural-stage cost/coverage tradeoff, not
  accidental grammar drift.

Current legacy-adapter provider map:

| Package | Structural island | Provider target | Existing parser production used by the transitional adapter | Guide rails | Replacement requirement |
| --- | --- | --- | --- | --- | --- |
| `@jesscss/css-parser` | `selector` | `css-selector` | `selectorList` | `cssTokens.ts`; `productions/selectors.ts`; selector parser tests | Replace with scanner-native selector materialization for covered simple/compound/list selectors before CSS completion. |
| `@jesscss/css-parser` | `declaration-value` | `css-value` | `valueList` | `cssTokens.ts`; `productions/values.ts`; declaration/value/custom-property tests | Replace with scanner-native value materialization for covered literal/value-list forms; keep exact scanner boundaries for strings, comments, `url()`, and custom properties. |
| `@jesscss/css-parser` | `at-rule-prelude` | `css-prelude` | `valueList` | `cssTokens.ts`; `productions/atRules.ts`; `productions/misc.ts`; at-rule/container/media tests | Replace covered media/supports/container preludes with scanner-native materializers; fallback for unsupported preludes must be explicit. |
| `@jesscss/less-parser` | `selector` | `less-selector` | `selectorList` | `lessTokens.ts`; Less selector overrides in `productions/selectors.ts`; Less selector/extend tests | Replace with scanner-native Less selector materialization for covered selector forms. |
| `@jesscss/less-parser` | `extend-candidate` | `less-selector` | `qualifiedRule` wrapped as `${source} {}` | `lessTokens.ts`; Less `:extend()` and qualified-rule productions/tests | Replace with scanner-native `:extend()` materialization or keep canonical fallback; wrapper-based adapter is not replacement proof. |
| `@jesscss/less-parser` | `declaration-value` | `less-value` | `valueList` | `lessTokens.ts`; `productions/values.ts`; Less declaration/value/function/custom-property tests | Replace with scanner-native literal, reference, arithmetic, function, list, and custom-property value materializers in slices. |
| `@jesscss/less-parser` | `variable-reference` | `less-value` | `valueList` | `lessTokens.ts`; `productions/values.ts`; variable/reference/accessor tests | Replace with scanner-native reference/accessor materialization before Less variable paths count as structural-fed. |
| `@jesscss/less-parser` | `mixin-definition` | `less-mixin` | `selectorList` | `lessTokens.ts`; `productions/guards.ts`; `mixinName`/mixin definition tests | Replace with scanner-native mixin signature/guard materialization or explicit canonical fallback. |
| `@jesscss/less-parser` | `mixin-call` | `less-mixin` | `valueReference` | `lessTokens.ts`; `productions/values.ts`; `productions/guards.ts`; mixin call/reference tests | Replace with scanner-native call materialization before mixin e2e paths count as scanner-first. |
| `@jesscss/less-parser` | `at-rule-prelude` | `less-media-prelude` | `mediaQuery` | `lessTokens.ts`; `productions/root.ts` Less media overrides; at-rule/media/deprecation tests | Replace covered media/prelude forms with scanner-native materializers; unsupported forms fall back explicitly. |

Pragmatic divergence notes:

- Structural selector recognition intentionally does not copy every selector
  token regex. It finds rule-header spans cheaply and leaves full selector
  grammar, escapes, extend grouping, and compound selector shape to the
  language parser provider.
- Structural declaration/value recognition prioritizes stable source ranges and
  recovery over eager grammar fidelity. The scanner must keep strings, comments,
  `url()`, custom-property blocks, and nested delimiters from corrupting
  statement boundaries; the value grammar itself remains deferred.
- At-rule prelude islands start after the at-keyword, even for adjacent forms
  such as `@supports(display: grid)`, so provider rules receive the same
  prelude text their existing productions expect.
- Less profile hints such as `@` reference detection are deliberately broad.
  They are request-planning hints, not proof that every span is a variable AST;
  exact shape comes only from the provider or canonical fallback.
- The rows above describe adapter coverage, not completion. A checked adapter
  entrypoint means there is a way to compare a selected island against the old
  AST contract; it does not mean the new parser can materialize that construct.
- [x] Add CSS selector island provider in `@jesscss/css-parser`.
- [x] Add CSS value/prelude island providers in `@jesscss/css-parser`.
- [x] Add Less selector island provider in `@jesscss/less-parser`.
- [x] Add Less extend-candidate provider that preserves Less extend nodes by
  using the qualified-rule parser context.
- [x] Add Less value/expression island provider in `@jesscss/less-parser`.
  - [x] Review fix: Less structural `variable-reference` classification now
    skips quoted/commented at-sign text and plain custom-property literal
    values while still admitting real Less variable references.
- [x] Add Less mixin/media-prelude island providers where covered by
  existing tests.
- [x] Add JSDoc for CSS/Less provider registration and wrapper/materialization
  rules.
- [x] Preserve existing parser package public contracts.
- [x] Add materialization-boundary tests for promoted island shapes.
- [x] Use `serializeTypes(...)` or focused node assertions only for promoted
  compiler-visible subtrees.
- [x] Performance guard: selected-island tests report request ids, actual
  parses, cache hits/misses, promoted bytes, and no full-tree fallback
  separately from full source size.
- [x] Verification: `pnpm --filter @jesscss/css-parser test -- --run
  test/island-providers.test.ts`.
- [x] Verification: `pnpm --filter @jesscss/less-parser test -- --run
  test/island-providers.test.ts`.
- [x] Verification: `pnpm --filter @jesscss/css-parser build`.
- [x] Verification: `pnpm --filter @jesscss/less-parser build`.
- [x] Verification: explicit finite CSS parser unit subset passes.
- [x] Verification: existing Less parser tests pass.
- [x] Verification: `pnpm run verify:package-exports`.
- [ ] Replace legacy-parser-backed CSS/Less island adapters with
  scanner-native materializers for the covered completion slice. Adapter calls
  to existing parser productions must be counted as comparison/fallback work,
  not as scanner-first parser replacement work.

### Slice 8: CSS And Less E2E Compiler/Eval Prototype

Goal: first prove scanner-first CSS/Less behavior as a sidecar e2e probe inside
the real compiler/eval/render API, then graduate to a structural-fed
compile/eval path before widening to SCSS/Jess parser packages.

This slice now runs in parallel with the core binding/lookup architecture lane,
not after it as an afterthought. The parser lane owns scanner-native CSS/Less
coverage, corpus gates, and benchmarks. The binding lane owns whether the
resulting AST can evaluate without overlapping direct lookup, scope-frame,
assignment, import, and callable mechanisms fighting each other. If an e2e
parser proof fails because lookup/eval has no cohesive source of truth, stop
and move that blocker to the binding lane instead of adding a parser-local
workaround.

Current focus rule: the next substantial implementation pass must push one
major lane to its completion gate, not keep adding isolated scanner-fed proof
cases. The two acceptable lanes are:

- binding/lookup simplification: make one cohesive live-binding/lookup model
  the source of truth for variables, properties, callables, assignments,
  imports, and generated rules, with redundant `Rules`/`Reference`/direct lookup
  machinery deleted or quarantined behind cold compatibility surfaces; or
- CSS/Less parser replacement: finish the scanner-native CSS/Less parsing
  layer that replaces Chevrotain for the covered CSS/Less language surface,
  with corpus coverage, parser-shape assertions, diagnostics/recovery proof,
  and benchmark output. Eval, render, and late/JIT materialization should be
  staged as the next chunk after the parser layer is coherent; they should not
  be used to disguise an incomplete parser replacement.

Small focused tests remain allowed only as stepping stones inside the chosen
lane. They are not acceptable as standalone progress once the current WIP proof
has either gone green or been committed/recorded as WIP.

Do this before adding or widening SCSS/Jess structural work. CSS/Less is not
complete merely because focused e2e fixtures pass: the structural-fed Less path
must render the existing upstream Less test-data fixture set to its expected CSS
with output equality, and the same corpus must have benchmark output for the
current parser path versus structural-sidecar, selected-materialization, and
structural-fed modes. Until that corpus-plus-benchmark gate exists, SCSS/Jess
work stays limited to recorded/parked provider entrypoint smoke coverage. Do
not mark Slice 9b complete, add new SCSS/Jess structural features, or expand
SCSS/Jess parser surface until this Less corpus-plus-benchmark gate is green.
The first milestone did not replace the default parser path: it ran structural
scan and selected island materialization before canonical parse, then the
existing parser still built the runtime AST used by eval/render. That sidecar
proof is useful, but it was not proof that materialized islands feed evaluation
or rendering.

The current prototype adds a hidden structural-fed path for a deliberately tiny
complete path: ordinary rules whose bodies contain ordinary declarations and
nested ordinary rules where selectors and values are scanner-native tokens.
That now includes simple selectors, adjacent basic compound selectors, and
cheap complex selectors whose parts are still in that same cheap selector
subset and whose combinators are descendant, child, adjacent sibling, or
general sibling, plus comma-separated selector lists whose branches stay inside
those shapes. The
scanner/materializer layer stores token text, kind, and source spans; it does
not treat current canonical selector/value nodes as the parser's internal
representation. The current compiler prototype constructs
experimental progressive core nodes for `Ruleset`, `Declaration`, and a narrow
root `@media` block in that literal subset, so covered selector/declaration/
prelude strings render without `Any` value wrappers, selector AST nodes, or
canonical at-rule prelude nodes. It still returns a root `Rules` tree because
`safeParse` is a core-tree boundary. It records zero requested islands / zero
actual parser execution for that path. The prototype also covers exact
no-argument Less mixin definitions and calls: scanner text builds the current
core `Mixin`/`Call` surfaces, mixin body declarations stay thin-field nodes, and
registration uses declaration names for invalidation keys before semantic
name/value materialization is demanded. Nested block at-rules, other block
at-rule families, Less variable references outside the proven already-seen
subset, arithmetic, functions beyond exact no-argument mixin calls, extends,
import variants beyond exact quoted Less imports, reference import boundaries,
complex/interpolated selectors, parameters, guards, namespaces, and
trivia-preservation cases currently fall back canonically until their
progressive materializers are scanner-native.

- [x] DRY/performance follow-up: make selector subset classification have
  one owner before widening selectors again. The current prototype has a
  plugin-side structural-fed admission check and a core-side selector
  constructor/materializer check. That duplication is tolerable for the current
  narrow proof, but future selector work should move toward a single small
  classifier/materialization plan so plugin admission and core materialization
  cannot drift and so cold semantic materialization does not repeatedly split
  the same selector string.
  - Current implementation: `@jesscss/core` owns the shared scanner-native raw
    selector admission predicates used by the Less plugin's structural-fed
    admission gate and by `Ruleset`'s selector materialization boundary.
    The public export is marked internal scanner-first machinery. The hot
    admission helper is boolean/no-allocation; `Ruleset` still owns the local
    branch splitting arrays needed only when semantics demand materialization,
    including existing trimmed selector-list constructor behavior.
  - Follow-up proof: evaluate whether selector payloads can stay string-backed
    even deeper into core semantics. Simple selectors such as `#id`, `.class`,
    pseudo selectors without parens, pseudo-elements without parens, and `*`
    may not need distinct node objects until a visitor or extend operation
    demands them. Combinators may also be
    string segments rather than `Combinator` nodes, yielding shapes like
    `CompoundSelector { value: ['#id', '.class'] }` and
    `ComplexSelector { value: ['#id', '>', '.class', '+', 'div'] }`. If exact
    combinator locations are needed, a companion relative-selector view could
    start with the combinator, for example
    `RelativeSelector { value: ['>', '.class', '+', 'div'] }`, while offsets
    live in the packed field/range metadata. Attribute selectors can likely
    remain string atoms too, unless equality/matching needs parsed attribute
    fields. Visitor exposure is a separate compatibility decision, not an
    automatic reason to create attribute nodes: plugin research may justify
    exposing some selector internals, while other atoms may intentionally stay
    non-visitable. This is not approved syntax widening yet; it is the next
    selector-shape experiment to prove against extend behavior, selected
    visitor/plugin contracts, and render/source-map needs.
  - [x] First selector-shape proof: `CompoundSelector` can carry scanner-native
    simple selector strings directly, and raw ruleset compound materialization
    now uses those strings instead of allocating `BasicSelector` leaves for the
    proven compound subset. The proof covers direct render, `valueOf()`,
    key-set computation, raw ruleset semantic materialization, and scanner-fed
    adjacent compound/list/complex selector e2e render. A follow-up within the
    same proof admits simple raw attribute selector atoms such as `[data-kind]`
    and `button[data-kind="primary"].active`, plus no-argument pseudo atoms
    such as `:root`, `button:hover`, and `.a::before`. Single string atoms
    stay `CompoundSelector` surfaces across semantic materialization and extend
    processing instead of collapsing into `BasicSelector`. The extend processor
    must preserve string compound components and only recurse into
    already-materialized selector-node components.
    - Current limit: this is compound-only. `ComplexSelector` still owns
      combinator nodes, selector lists still own selector branch nodes, and
      visitor/source-map code is not taught to treat arbitrary strings as full
      selector nodes. Pseudo selectors with argument lists such as `:is(...)`,
      attribute selectors that require structured field equality,
      interpolation, and newline-containing selectors remain outside this proof
      until admitted by separate tests. Attribute and pseudo leaf visitor
      support is not assumed; the outcome may be "no leaf visitor surface" if
      plugin research and Jess semantics do not justify paying for structured
      fields or compatibility adapters.
  - [ ] Extend cleanup follow-up: make `walk-and-consume` the single extend
    matching surface for covered Less semantics, and delete or redirect the old
    location-search fallback wherever it is not absolutely necessary to get a
    correct result.
    - [x] Inventory production and test callers of `findExtendableLocations`,
      `selectorCompare`, `tryExtendSelector`, `extendSelector`,
      `applyExtensionAtLocation`, `normalizeSelectorForExtend`, and
      `walkAndExtend`; classify each as scanner-first path, core public API
      path, tests-only path, or transitional/deletion candidate. Current
      result: `extendSelector` / `applyExtendsToSelector` remain production
      surfaces, `walkAndExtend` is the desired matching implementation surface,
      and the location-search helpers remain transitional debt until
      ampersand/reference/chained extend coverage is moved.
    - [x] Build a coverage matrix for exact extends, `all`, selector lists,
      compound subsets, complex targets, `:is(...)`, visible/invisible
      ampersand, conflict validation, chained extends, and import/reference
      behavior. Mark which cases are already covered by `walkAndExtend` tests,
      which only pass through the legacy location path, and which are missing.
      Current result: simple/compound/selector-list/string/single-component
      complex cases are covered by walk tests; complex dispatch,
      ampersand-boundary behavior, chained extends, and import/reference
      activation still need bounded migration before deletion.
    - [x] Run a deletion probe that disables the location-search fallback after
      `walkAndExtend` declines a match; record the smallest failing tests and
      the exact semantics those failures prove are still missing from the walk
      path. Current result: the safe first slice is exact matching for raw
      string compounds and single-component `ComplexSelector` list items; broad
      fallback deletion is not yet proven.
    - [x] Implement missing walk-path semantics in bounded slices, starting
      with the smallest failure that affects scanner-first CSS/Less output
      equality. Do not preserve a fallback merely because it exists today.
      Current result: string compound matching, single-component complex
      whole-item matching, import root selection, and reference-mode generated
      `:is(...)` simplification are implemented and covered by focused tests.
    - [x] Redirect one proven legacy matcher branch: `applyBatchedExtend` no
      longer uses `findExtendableLocations` / `selectorCompare` for its
      same-target whole-item batch check. It now asks the walk-and-consume
      surface via `classifyExtendMatch`, using a non-self representative
      extender so self-extenders in the batch do not poison classification.
    - [x] Add a walk-side "target exists here" classifier before replacing the
      remaining `extend-roots.ts` `findExtendableLocations(...).hasMatches`
      checks. `wouldExtendChange` and `classifyExtendMatch` intentionally
      suppress self-extends, but root accessibility still needs to distinguish
      "target exists locally" from "this extend would change output".
      Current result: `classifyExtendTargetPresence` reuses the walk
      decomposition without the self-extend output-change guard, and
      `extend-roots.ts` now uses it for parent-target presence and self-extend
      activation checks instead of the legacy location-search surface.
    - [ ] Verify each deletion slice with focused core extend tests,
      scanner-first e2e, and the Less corpus parity/benchmark gates before
      marking this cleanup complete.
  - Visitor research follow-up: survey public Less plugins that register
    visitors to determine which selector/value internals are actually observed
    in practice. Use that evidence before preserving visitor materialization for
    every legacy leaf node shape. Some legacy leaves may deliberately have no
    Jess visitor surface if they are only raw atoms in the scanner-first model.
    - Initial survey result: public Less visitor plugins are rare, and the
      sampled packages showed declaration/value reliance rather than selector
      leaf reliance.
      - `less-plugin-rtl` registers a replacing visitor and touches
        declaration-level and value-level shapes: `Declaration.name`,
        `Declaration.variable`, `Declaration.value`, `Declaration.important`,
        `Declaration.merge`, `Declaration.index`, `Declaration.currentFileInfo`,
        `Declaration.inline`, plus `Anonymous.value`, `Keyword.value`, and
        `Expression.value`. It mutates/replaces declarations and walks values
        for left/right keyword reversal and four-part shorthand reordering. No
        selector leaf dependence was found in the sampled source.
      - `less-plugin-inline-urls` registers a pre-eval replacing visitor and
        touches `Rule` enter/exit state, `Url.value.value`, `Url.index`,
        `Url.currentFileInfo`, and creates `Call("data-uri", [...])`, with a
        wrapper path that calls `subNode.eval(context)`. Its dependence is
        narrow URL/value materialization, not selector materialization.
      - `less-plugin-dls` registers a visitor wrapper but the published visitor
        utility calls `root.variables()` and stores variable names; no typed
        `visit*` hooks over selector/value leaves were found in that visitor.
        The package appears more function/render-extension oriented via a
        `less.tree.Call.prototype.genCSS` patch.
      - Sampled popular plugins without Less AST visitor usage included
        `less-plugin-clean-css`, `less-plugin-autoprefix`,
        `less-plugin-npm-import`, `less-plugin-glob`,
        `less-plugin-css-modules`, `less-plugin-remove-antd-global-styles`, and
        `less-plugin-rewrite-import`; they are mostly postprocessors,
        preprocessors, or file managers.
    - Visitor policy implication: typed visitor hooks should request only the
      shapes they can observe. `visitDeclaration` can materialize declaration
      name/value only when traversal enters those fields; `visitUrl` can request
      URL/value islands; `visitKeyword`, `visitAnonymous`, and `visitExpression`
      can request declaration-value materialization. A generic `visit()` or
      unknown replacing visitor remains the broad compatibility case. Do not
      eagerly materialize selectors merely because a visitor exists; selector
      materialization should be triggered by explicit supported selector visitor
      hooks or traversal into ruleset selector fields. Unsupported leaf hooks
      should be documented as intentionally unavailable rather than simulated by
      allocating nodes the runtime otherwise does not need.

The target runtime shape should be even cheaper than the temporary core bridge,
and it should avoid a second long-lived structural-node hierarchy where possible.
Prefer progressively enhanced core nodes: the parser constructs the normal
`Ruleset`, `Declaration`, `AtRule`, and rules-container surfaces with literal
string payloads plus offset/kind metadata first, then those same nodes parse
and cache richer selector/value/prelude objects only when a compile stage
demands them.

```ts
Ruleset {
  selector: ".a",
  rules: [
    Declaration {
      name: "foo",
      value: ["bar"],
      important: false
    }
  ],
  source: sourceRef
}
```

For declarations, the candidate cheap shape is thinner than separate raw and
parsed slots:

```ts
interface Declaration {
  name: string | Interpolated;
  value: (string | Node)[];
  valueOffsets?: Uint32Array | number[];
  valueKinds?: Uint16Array | ValueKind[];
  important: boolean;
}
```

For the cheapest path, render can write selector strings, declaration name
strings, declaration value string segments, and simple at-rule prelude strings
directly. Offsets/ranges live in compact metadata, not in wrapper nodes
around those strings. Eval can treat literal string segments as scalar payloads
without manufacturing `Any` wrappers until a feature needs node semantics. A
field or segment should JIT-parse only when demanded by a feature that needs
richer meaning: variable/reference resolution, arithmetic, function calls,
selector nesting/ampersand resolution, `:extend()`, interpolation,
plugin/visitor access to typed selector/value nodes, detailed diagnostics, or
source map detail beyond the stored source identity. Put differently:
scanner-first does not mean "create cheaper core AST nodes sooner"; it means
"let the core node itself start raw and progressively enhance its fields."

The progressive fields should be single-owner caches, not adapter outputs.
When a segment is parsed, the parsed node replaces or annotates that segment on
the same declaration:

```ts
Declaration {
  name: "color",
  value: [Reference("@brand")],
  valueKind: "reference",
  source: sourceRef
}
```

Accessors or stage helpers can expose `getParsedValueSegment()` /
`ensureValueNode()`, but ordinary rendering and structural indexing should not
call them. When a segment is parsed, the parsed node is attached to the same
declaration, so later visitors, eval stages, and diagnostics reuse it instead
of allocating a parallel core subtree each time.

Parsed-field caches must be keyed by the source version, field range, language
configuration, and target semantic shape. A field should parse at most once for
that cache key; source edits or parser-configuration changes invalidate the
cached enhancement instead of leaving stale parsed nodes attached to raw text.

Do not take `source`, `sourceRef`, `selector`, `value`, or `valueKind` as fixed
field names. The requirement is stable source identity and raw-or-parsed field
payloads for the cheap path; the storage may be per-node offsets, a packed range
table, field metadata, interned text slices, or another lower-allocation
representation after measurement. The `Declaration { name, value, important }`
shape is the first implementation candidate; other names in examples are
assertion vocabulary until each corresponding core node prototype proves its
storage.

- [x] Identify the narrowest hidden option or test-only entrypoint that can run
  CSS/Less structural parse before compile/eval/render without changing default
  behavior.
- [x] Sidecar probe: prove CSS e2e output equality for at least declarations, nested
  rules/selectors, comments/trivia-safe input, custom properties, at-rules, and
  malformed-recovery diagnostics where applicable.
- [x] Sidecar probe: prove Less e2e output equality for variables, mixin calls, mixin
  definitions, imports where feasible, `:extend`, nested selectors, arithmetic,
  and declaration values that require lazy materialization.
- [x] Prove negative materialization behavior: declarations, rules, at-rules,
  imports, nesting, and other structures that can be handled structurally must
  not request distinct AST node materialization just because traversal/eval
  reached their parent.
- [x] Prove the plain-rule baseline `.a { color: blue; }` renders equal while
  selector/value islands remain available but unrequested.
- [x] Track materialization by island kind and by owning structural node kind so
  tests can assert both "this feature materialized" and "this feature did not
  materialize."
- [x] Audit single-payload AST fields reached by CSS/Less materialization
  (`items`, `components`, and similar names) and decide which can
  collapse to `.value` before scanner-first shapes are treated as replacement
  architecture.
  - Current decision: `List`, `Sequence`, and selector collection nodes already
    use `.value`/`childKeys = ['value']`; old `items`/`components` names are
    not reintroduced. `Rules.rules` remains the semantic body contract for
    rules-bearing containers, and scanner-first structural parsing may make
    that body a mixed string-or-node stream before later promotion. The
    declaration payload shape is `Declaration { name, value, important }`, where
    `value` may be a string, a node, or a mixed string/node array plus compact
    offset/kind metadata (`valueOffsets`/`valueKinds`, a packed side table, or a
    measured equivalent). The old full-payload/value-wrapper split should not be
    preserved.
- [x] Prototype a `Rules` wrapper reduction design: determine whether nested
  `Ruleset`/`AtRule`/`Mixin` can inherit rules-container behavior so their
  `.rules` field is the inherited body surface instead of a nested `Rules` node.
  The body may be a progressive string/node stream plus offset/kind metadata at
  structural parse time and should promote only demanded segments while
  preserving scope frames, lookup, extend, import/reference boundaries, render
  ordering, and parent/source ownership.
- [x] Ensure the e2e proof records whether each materialized subtree came from
  scanner-native materialization, selected-island adapter parsing, fallback
  full-tree parsing, or the existing parser path.
  - Future progressive-node proof should replace this subtree accounting with
    per-field enhancement counters: raw fields rendered directly, fields parsed
    and cached on their owning core node, cache hits, cache invalidations, and
    any fallback full-tree parse.
- [x] Ensure failures report source offsets and human diagnostics through the
  same diagnostic path expected by compiler users.
  - [x] Prototype records offset-first structural diagnostic ranges before
    falling back to the canonical parser.
  - [x] Canonical compiler diagnostics normalize non-finite parser coordinates
    to finite fallback line/column positions before rendering diagnostics.
- [x] Keep default `safeParse` behavior unchanged until the prototype evidence
  says a broader migration is safe.
- [x] Add JSDoc to any hidden/test-only e2e entrypoints explaining that they are
  prototype gates, not public API.
- [x] Performance guard: report structural scan and selected materialization
  timings, promoted bytes, selected island count, fallback full-tree count,
  cache hits/misses, and output equality.
- [x] Structural-fed prototype: use structural results and scanner-native
  materialization in a real compile/eval/render path for a tiny CSS/Less
  subset.
- [x] Structural-fed prototype: support simple selectors, adjacent basic
  compound selectors, cheap complex selectors whose parts stay in the same
  scanner-native subset and whose combinators are descendant, child, adjacent
  sibling, or general sibling, comma-separated selector lists whose branches
  stay inside those shapes, simple and flat literal declaration values,
  conservative quoted/url declaration and Less variable values, conservative raw
  custom property declarations, exact `!important` declaration flags on
  non-custom values, simple root or ruleset-local `@media` prelude/body shape
  including ordinary nested rules, simple root `@layer` blocks with ordinary
  rule bodies, root `@supports` blocks with a single scanner-native declaration
  condition, root `@charset` statement at-rules with scanner-native quoted
  preludes, root `@namespace` statement at-rules with quoted or
  prefix-plus-quoted/quoted-`url(...)` preludes, CSS-preserved root `@import`
  statements with quoted CSS paths or quoted `url(...)` preludes, and simple
  Less variable declaration/reference
  token detection for already-seen and same-scope hoisted simple literal/raw
  values, plus one-step same-unit `+`/`-` arithmetic over scanner-native
  numbers/dimensions, plus scope-only `& { ... }` and bare `{ ... }` blocks that
  map to raw `Rules` containers, plus exact quoted Less imports whose imported
  file also stays in the scanner-native subset, plus the narrow nested
  `&:pseudo` selector branch, with zero legacy island parser executions.
  Dynamic/lazy variable references that need richer Less lookup semantics,
  mixed-unit arithmetic/calc behavior, Less import options, reference/multiple/
  once/de-dupe behavior, unresolved imports, unquoted HTTP `url(...)` imports,
  block at-rule families outside the root `@media` / `@layer` / `@supports` /
  declaration-block `@font-face` / `@page` / `@counter-style` subset,
  pseudo selectors outside the proven nested `&:pseudo` branch,
  attribute/interpolated selectors, and richer nested at-rule bodies remain
  canonical fallbacks until their progressive materializers are proven.
- [x] Keep scanner-native token detection separate from the temporary core AST
  adapter boundary: tokenization/materialization records text, kind, and spans;
  successful structural-fed rules/declarations render without eager selector or
  value wrapper nodes, while unsupported cases fall back to the
  canonical parser.
- [x] Seed structure-target examples for CSS/Less so minimal structural shape
  can be reasoned about before implementing more JIT parsing.
  - [x] Added the first executable thin target proof in
    `packages/jess/test/scanner-first-e2e.test.ts`: plain rule, ordered
    declarations, nested ordinary rule, single-line custom-property raw value,
    and a root `@media` block with raw prelude parse through the structural-fed
    path, render equal CSS, serialize thin-field core nodes, and assert zero
    island requests / zero legacy parser executions / no eager selector,
    prelude, or value child nodes.
  - [x] Extended that proof to packed field-range metadata for the same thin
    targets: structural parse records selector, at-rule name/prelude,
    declaration-name, and value ranges/kinds in `FieldRangeTable`, and the test
    asserts those ranges map back to the exact strings later used by the
    thin-field core nodes. This proves the cheap path is parser-ready without
    per-string wrapper nodes, but it does not yet freeze a core-side field
    metadata API.
- [ ] Replace the temporary core-node bridge with progressively enhanced core
  nodes that carry raw-or-parsed selector/name/value/prelude payloads plus
  stable source identity, render/evaluate simple string segments directly, and
  JIT-parse individual fields/segments onto the same node only when
  eval/render/visitor/plugin behavior requires richer semantics.
  - [x] First thin proof: `ProgressiveRuleset` and `ProgressiveDeclaration`
    render/serialize string-backed selector/name/value/body payloads, preserve
    exact value segments, and handle nested progressive rules without creating
    selector/value child nodes.
  - [x] Second thin proof: `ProgressiveAtRule` renders/serializes string-backed
    root `@media` name/prelude/body payloads and reuses already-supported
    progressive rule/declaration children without creating canonical
    `AtRule`/prelude/value nodes.
  - [x] Third thin proof: `ProgressiveVariableDeclaration` stores invisible
    string-backed Less variable declarations while the structural-fed builder
    resolves already-seen and same-scope hoisted simple `@ident` reads into raw
    declaration value segments. Variable declaration values are simple literals
    or the same conservative raw quoted/url subset used by declaration
    values in this proof; alias declarations such as `@b: @a` and
    interpolation-like strings fall back canonically so broader Less lazy
    lookup semantics are not frozen into scanner-native strings. This proves
    zero `VarDeclaration`/`Reference`/value wrapper nodes for the narrow path
    while only claiming the bounded same-scope hoisting covered by e2e tests.
  - [x] Structural-fed prototype now uses thin-field core `Ruleset` and
    `Declaration` nodes for covered ordinary rule/declaration success cases,
    and thin-field core `AtRule` nodes for covered root and ruleset-local
    `@media` success cases, including ruleset-local `@media` blocks that contain
    already-supported ordinary nested rules.
    The prototype still records `progressiveNodes` as the cheap structural-fed
    node count so tests and corpus logs prove the cheap path was actually used.
  - [x] Added the first root declaration-block at-rule proofs. Root
    `@font-face`, `@page`, and `@counter-style <ident>` now build thin-field
    core `AtRule` nodes with declaration children, render equal CSS,
    serialize raw at-rule names/preludes plus declaration names/values, and
    report zero island requests, zero legacy parser executions, and zero
    promoted bytes. The proof covers the upstream
    `tests-unit/at-rules-declarations/at-rules-declarations.less` shape,
    including `src: url("myfont.woff2")`, but remains a named whitelist:
    nested declaration-block at-rules, `@font-face`/`@page` preludes, and
    missing `@counter-style` preludes still fall back.
  - [x] Fourth thin proof: scope-only rule headers (`&` and an empty header from
    a bare block) map to real core `Rules` containers instead of selector
    `Ruleset` nodes. The tests parse `.a { & { color: blue; } }` and
    `{ @brand: blue; .a { color: @brand; } }`, render/serialize the resulting
    scope containers, and assert zero selected island parser executions, no
    `selector: '&'` / `selector: ''`, no eager `BasicSelector`, and no
    `Any` declaration value wrapper. This is a hidden structural-fed prototype
    proof; bare root scope remains rejected by the current canonical parser.
  - Current limit: invisible progressive bookkeeping nodes are proven for
    normal render output. Full-render/debug surfaces may intentionally force
    invisible nodes, so any broader replacement must specify whether those
    surfaces should expose raw structural bookkeeping.
  - Current performance watchpoint: the proof copies a small variable `Map` per
    structural scope. That is acceptable for the narrow proof, but widening the
    variable path must benchmark this against a cheaper scope stack or packed
    side-table representation before treating it as architecture.
- [x] Add a first thin-field core-node prototype for `Ruleset` and `Declaration`:
  parse `.a { color: blue; }` into normal core nodes with a selector string and
  declaration `decl({ name: "color", value: "blue", important: false })`, render
  from those string segments, maintain per-field/per-segment offsets separately,
  and assert no selector/value child nodes are created until a typed accessor or
  richer feature requests them.
  - [ ] Enforce the progressive-field invariant before widening declaration or
    at-rule coverage further: no node should use secondary `raw*`, `*Text`, or
    `*Segments` fields as substitutes for the actual semantic field. Cheap
    source-backed structure belongs directly in the named field, such as
    `Declaration.name`, `Declaration.value`, `Declaration.important`,
    `AtRule.name`, and `AtRule.prelude`. Those fields may hold `string | Node`
    or, where the value is naturally mixed, `Array<string | Node>`.
    Materialization upgrades the same field to node-backed structure only when a
    semantic operation actually needs it.
  - [x] Connected that proof to the structural-fed Less prototype for covered
    declarations: `.a { color: blue; }` now parses into a thin-field core
    `Ruleset` containing a real core `Declaration` with `name` / `value`
    payloads before semantic materialization. The render/e2e tests still prove
    output equality with zero legacy island parser executions.
  - [x] Extended the thin-field declaration proof to flat literal values such as
    `border: 1px solid red`, `box-shadow: 0 1px #000`, and `font: 16px serif`.
    The structural-fed Less path keeps the entire value as one string
    segment for direct render/serialization and still reports zero selected
    island parser executions. This is deliberately not a general value parser:
    comments, interpolation, rich comma lists, and mixed variable/value streams
    remain outside the proven cheap subset.
  - [x] Added a thin progressive declaration value proof for the simple literal
    Less/CSS color functions currently proven by tests: `lighten(#000, 10%)`,
    `darken(#fff, 10%)`, `rgb(10, 20, 30)`, and
    `rgba(10, 20, 30, 50%)`. The declaration still stores a thin-field payload,
    but the single value segment can now be a core `Call` with `Reference`,
    `List`, and scalar literal argument nodes when the function text is
    trivially scanner-native. Render/eval tests assert output equality, raw
    selector/name serialization, zero full-tree fallback, zero requested
    islands, zero legacy parser executions, and zero promoted bytes.
    - Current limit: this is not general Less value parsing. Function calls with
      variable arguments, nested calls, quoted arguments, comments,
      interpolation, unproven function names, or richer value grammar still fall
      back canonically.
  - [x] Added the first mixed string plus parsed-node value proof:
    `box-shadow: 0 0 2px lighten(#000, 10%)` stores
    `value` as `["0 0 2px ", Call]`, renders equal CSS, serializes
    the declaration payload plus the parsed `Call` segment, and still
    reports zero requested islands, zero legacy parser executions, and zero
    promoted bytes. This deliberately proves only one flat scanner-native
    prefix followed by one supported function call; it is not a general value
    parser.
  - [x] Added the first comment-trivia proof: Less `//` line comments at root,
    inside a rule body, and after a declaration do not force canonical fallback
    because normal CSS output drops them. The structural-fed path ignores those
    line-comment trivia ranges, renders equal CSS, and still reports zero
    requested islands / zero legacy parser executions.
  - [x] Added the first preserved block-comment proof for standalone `/* ... */`
    trivia before root rules, inside rulesets, and inside at-rule bodies. The
    structural-fed path now converts those source-owned trivia ranges directly
    into core `Comment` nodes in source order, renders equal CSS, serializes the
    comment nodes, and still reports zero requested islands / zero legacy parser
    executions. Inline block comments and unterminated block comments remain
    canonical fallbacks because exact placement/recovery has not been proven.
  - [x] Extended thin-field declaration transport to conservative quoted and
    URL-ish declaration values such as `content: "hello } world"`,
    `background: url(/assets/a}/b.png)`, `background: url(/assets/a,b.png)`,
    and `font-family: "Open Sans", sans-serif`. These values are carried as one
    string segment and rely on the structural scanner's existing string/url
    boundary handling; they do not allocate value child nodes or execute legacy
    island parsers. Values that contain Less variable/interpolation-looking
    tokens still fall back so canonical eval behavior is not skipped.
  - [x] Extended thin-field declaration transport to comma-separated flat CSS
    value lists such as `text-shadow: -1px -1px 1px red, 6px 5px 5px yellow`
    and `box-shadow: 0 0 1px red, 0 0 2px blue`. This is still a string
    proof, not list parsing: nested functions, comments, variables,
    interpolation, and multiline values remain outside the subset.
  - [x] Extended thin-field declaration transport to conservative custom
    property declarations such as `--brand: #06c` and raw single-line
    brace/string payloads such as `--raw: { token: "}"; }`. These values are
    carried as one string segment and rely on the structural scanner's
    existing balanced-boundary handling; they do not allocate value child nodes
    or execute legacy island parsers. Custom-property `!important`, multiline
    custom-property values, interpolation, and un-interpolated Less variable-like
    tokens still fall back so canonical warning/eval behavior is not skipped.
  - [x] Extended thin-field declaration transport to trailing important flags on
    already-supported simple/flat literal values, including exact `!important`,
    spaced `! important`, and case-variant `!IMPORTANT` spellings. The
    structural-fed Less path strips the flag into `important` exactly as the
    current renderer preserves it, while keeping the declaration value as one
    string segment, so direct render and serialization still do not allocate
    value or important child nodes. Important Less variable references and
    important variable declarations remain canonical fallbacks.
  - [x] Added the first thin-field core `Ruleset` proof: the normal core
    `Ruleset` constructor accepts a selector string for the scanner-native
    simple selector subset and stores atom selectors as strings without a
    selector child node. If a semantic boundary needs selector structure, the
    atom is promoted to a `CompoundSelector` with a string component rather
    than a `BasicSelector`. The structural-fed
    Less prototype now emits those thin core `Ruleset` nodes for covered
    ordinary rules, and e2e tests assert the string selector/declaration shape
    before semantic materialization.
  - [x] Extended that thin-field `Ruleset` proof to adjacent basic compound
    selectors such as `.a.b` and `button.primary`: the constructor now creates
    a thin `CompoundSelector` containing string components, without
    `BasicSelector` leaves.
  - [x] Extended that thin-field `Ruleset` proof to comma-separated selector
    lists whose branches are already in the scanner-native simple/adjacent
    compound selector subset, such as `.a, .b` and `.a, button.primary`: the
    constructor now creates a thin `SelectorList` containing branch selector
    containers with string leaves. `valueOf()` returns normalized selector
    text; exact source spacing belongs to spans/trivia.
  - [x] Extended that thin-field `Ruleset` proof to cheap complex
    selectors and selector-list branches whose parts are already in the
    scanner-native simple/adjacent compound selector subset and whose
    combinators are descendant, child, adjacent sibling, or general sibling,
    such as `.a .b`, `button > .icon.active`, `.a + .b`, `.a ~ .b`, and
    `.a .b, .c`: the constructor creates thin `ComplexSelector` /
    `SelectorList` containers with `Combinator` nodes and string selector
    components, avoiding richer selector leaf allocation.
  - [x] Extended the selector transport proof to the narrow nested
    ampersand-pseudo branch `&:focus`. Direct render and serialization keep the
    selector as the string `&:focus` with no eager `Ampersand` or
    `PseudoSelector` child nodes; semantic registration materializes a
    canonical
    `CompoundSelector` containing `Ampersand` plus `PseudoSelector` only if
    selector semantics are requested. This is not a general pseudo-selector
    parser and does not claim nested selector collapse.
  - [x] Extended the selector transport proof to nested leading-combinator
    selectors such as `> #second .two` and `+ #third`. The structural-fed path
    admits these only for nested rule bodies and constructs a relative
    `ComplexSelector` with leading `Combinator` nodes plus string selector
    components.
    Root-level relative selectors remain outside the scanner-native admission
    gate.
  - [x] Added the first structural-fed Less extend proof for simple exact
    selector-header extends such as `.button:extend(.base) { width: 1px; }`,
    then widened the same cheap token path to simple `all` selector-header
    extends such as `.button:extend(.base all) { width: 1px; }` and target-only
    cheap complex selectors such as `.button:extend(.base .child)`.
    The builder splits only the participating selector field, keeps the owning
    ruleset selector as raw `.button`, constructs the existing core `Extend`
    node for the target selector and exact/all flag, materializes only the
    target selector nodes needed for Less extend matching, leaves unrelated
    declarations as thin-field payloads, renders equal CSS, and asserts zero
    selected island parser executions / zero full-tree fallback.
    - Current limit: pseudo/attribute/interpolated source selectors,
      compound/pseudo target selectors, `&:extend(...)` statements, multiple
      extend groups, and richer selector semantics still fall back canonically.
  - [x] Added the first thin-field core `AtRule` proof: the normal core `AtRule`
    constructor can store scanner-native at-keyword/prelude strings, renders
    and serializes them as `name` / `prelude` without canonical header
    child nodes, and materializes canonical `Any` name/prelude nodes only when
    semantic registration/eval requests at-rule header semantics. The current
    structural-fed Less prototype emits those thin core `AtRule` nodes for covered
    root `@media`, root `@layer`, root `@supports`, and ruleset-local `@media`
    blocks; other at-rule families remain unproven even though the core raw
    storage primitive is not hard-coded to `@media`.
  - [x] Added the first thin-field core `AtRuleStatement` proof: the normal core
    `AtRuleStatement` constructor can store scanner-native at-keyword/prelude
    strings, renders and serializes root `@charset "UTF-8";` directly from
    `name` / `prelude`, and does not allocate canonical `Any` name/prelude
    nodes during direct render or existing registration/import scanning. The
    structural-fed Less prototype emits that thin statement node for the covered
    root `@charset` subset and records zero legacy island parser executions.
  - [x] Extended the thin-field `AtRuleStatement` proof to CSS-preserved root
    `@import` statements whose prelude is a quoted path or quoted `url(...)`
    plus optional media text. These render through the structural-fed Less path
    with zero legacy island parser executions and serialize with `name` /
    `prelude` instead of canonical `Any` header children. Less import options
    and unquoted HTTP `url(...)` imports still fall back canonically until option
    semantics and URL/comment ownership are proven in the cheap path.
  - [x] Extended the thin-field `AtRuleStatement` proof to root `@namespace`
    statements with quoted preludes and prefix plus quoted `url(...)` preludes.
    This also fixed the structural scanner's declaration-colon detector so
    colons inside quoted strings no longer misclassify statement at-rules as
    declarations. The parser-level structure test covers the quote-aware colon
    boundary, and the Less e2e proof renders/serializes `@namespace` through
    raw `AtRuleStatement` fields with zero legacy island parser executions.
  - [x] Extended the structural-fed import proof to exact quoted Less imports
    such as `@import "tokens.less";` when the imported file itself stays in the
    scanner-native subset. The prototype resolves and reads the imported file,
    recursively builds its thin-field structural-fed tree, inlines those rules,
    merges cheap root variable bindings into the importing file, and tests both
    files for zero legacy island parser executions / zero full-tree fallback.
    Import options, reference/multiple/once/de-dupe behavior, missing files,
    import cycles, package-resolution edge cases, raw URL imports, media
    wrapping, and unsupported imported syntax remain canonical fallbacks.
  - [x] Added the first structural-fed Less mixin proof for exact no-argument
    definitions and calls. The prototype indexes `.rounded()` from scanner text,
    emits the current core `Mixin` plus `Call`/`Reference` surfaces, keeps mixin
    body declarations and nested ordinary rules as thin-field core nodes, renders
    equal CSS, and asserts zero island parser executions / zero full-tree
    fallback. The registration path now reads declaration names for static
    invalidation keys and only materializes declaration name/value nodes when
    registration or eval demands semantic fields. Richer parameters, guards,
    namespaces, overload resolution, richer variable-bearing mixin bodies,
    non-media at-rules inside mixin bodies, and richer call syntax remain
    canonical fallback.
  - [x] Added the first structural-fed Less mixin parameter proof for simple
    positional parameters and literal call arguments. The prototype admits
    both root-level and ruleset-local shapes such as `.paint(@color) { color:
    @color; } .a { .paint(blue); }` and `.a { .paint(@color) { color:
    @color; } .paint(blue); }`, stores the definition params as the existing
    core `List(Any('color', { role: 'property' }))` surface, stores the call
    args as the existing core `List(Any('blue', { role: 'keyword' }))`
    surface, and creates a use-site `Reference` only when a declaration
    actually reads `@color`. The proof renders equal CSS with zero full-tree
    fallback, zero selected island parser executions, zero promoted bytes, and
    serialized `Mixin`/`Call` params/args instead of a legacy island parse.
    - Current limit: this covers only simple positional params with simple
      literal args. Defaults, guards, rest params, named args, variable args,
      duplicate params, interpolated/dynamic names, accessor calls, detached
      rulesets, argument expressions, comments in parameter lists, and richer
      call syntax remain canonical fallback.
  - [x] Extended no-argument mixin-call proof to the cheap namespaced
    no-parens path `#theme > .mixin;`. The scanner-native helper normalizes the
    call name to the same key-path shape as the Less parser
    (`['#theme', '.mixin']`) while ignoring only `>` and descendant namespace
    separators. It does not admit arguments, guards, interpolation, accessors,
    `+`/`~` combinators, or arbitrary selector lists.
  - [x] Corpus movement from the nested-relative-selector, namespaced-mixin,
    corrected-`@supports`, and simple mixin-parameter slices: the Less corpus
    parity audit now reports
    13 structural-fed cases out of 65, selector fallbacks dropped from 9 to 7,
    mixin definition signature fallbacks dropped to 6, mixin-call signature
    fallbacks rose to 2 because one corpus case now passes definition-signature
    admission and stops at richer call syntax, and the corpus still reports
    zero requested islands, zero actual parser executions, and zero promoted
    bytes for the structural-fed path.
  - [x] Extended the no-argument Less mixin proof to scanner-native `@media`
    blocks inside mixin definitions. The structural-fed path emits thin-field
    `AtRule` nodes for the `@media` body, thin-field declaration nodes inside
    the block, and copied callable output that preserves `name` /
    `prelude` instead of materializing canonical at-rule header/value
    children. The focused proof renders equal CSS and serializes with zero
    legacy island parser executions, zero full-tree fallback, zero promoted
    bytes, and no `BasicSelector` or `Any` declaration value nodes for the
    covered shape. Non-media at-rules in mixin bodies remain canonical fallback
    until their runtime semantics are proven as thin progressive structures.
  - [x] Extended the structural-fed at-rule proof to root `@layer` blocks whose
    body contains already-supported ordinary rules. Named layers with a
    scanner-native identifier prelude and anonymous `@layer { ... }` blocks both
    render and serialize from raw at-rule header fields with zero selected island
    parser executions.
  - [x] Corrected the earlier raw-`@supports` proof: `@supports (display:
    grid)` is no longer considered a scanner-native raw prelude because the
    condition has meaningful parenthesized declaration-query structure. Root,
    nested, direct nested, and mixin-body `@supports` cases with one
    scanner-native declaration condition now render through structural-fed
    `Paren(QueryCondition(...))` preludes with zero selected island parser
    executions, zero full-tree fallback, zero promoted bytes, and no raw
    prelude blob for the condition.
  - [x] Extended nested at-rule proof to direct scanner-native `@media`
    children inside already-supported at-rule bodies, covering `@media` inside
    `@media`. The builder recursively emits thin core `AtRule` nodes for the
    direct at-rule child, preserves atom-like raw preludes such as `screen` and
    `print`, renders equal CSS, and asserts zero island parser executions, zero
    full-tree fallback, zero promoted bytes, no eager selector node, and no
    `Any` declaration value wrapper. At-rules nested inside ordinary rules that
    are themselves inside at-rules remain fallback until that wider recursion
    policy is proven.
  - [x] Extended the structural-fed at-rule proof to no-prelude CSS
    `@starting-style` block at-rules. Root `@starting-style { .a { opacity:
    0; } }` and rule-local `.a { opacity: 1; @starting-style { opacity: 0; } }`
    render and serialize from thin-field `AtRule` nodes with zero selected
    island parser executions, zero full-tree fallback, zero promoted bytes, no
    raw prelude, no eager at-rule name wrapper, and no `Any` value wrapper for
    the covered declaration values. `@starting-style` with a prelude remains
    canonical fallback because only the CSS no-prelude block form is proven;
    rule-local nested-rule bodies, rule-local nested at-rule bodies, and
    mixin-body `@starting-style` also remain fallback until separately proven.
  - [x] Completed the parked `starting-style.less` corpus blocker by lowering
    the exact scanner-native Less `each(1 2 3 4, { padding+_: (@value * 10px);
    })` shape inside `@starting-style` to the existing core `For` node with the
    standard Less tuple variables `value`, `key`, and `index`. This proof
    intentionally recognizes only a literal number list and one callback
    declaration with sequence merge plus `@value * <dimension>` arithmetic.
    It renders equal CSS, serializes as `For` rather than a function `Call`,
    and still records zero island parser executions, zero full-tree fallback,
    and zero promoted bytes for the covered shape.
  - Current limit: this proves wrapper avoidance and direct render for normalized
    declaration syntax and raw important-flag spelling, not exact source-token
    preservation for alternate assignment spacing or semicolon trivia.
  - Current limit: semantic materialization preserves an existing single `Node`
    segment as the canonical value and turns mixed string/`Node` segments into a
    reachable sequence container. Rich mixed segment semantics still need a
    broader segment-to-node policy before they can be used as a broad eval path.
  - Current limit: flat literal declaration values are stored as one raw segment
    for parser-ready direct render, not as a pre-tokenized value AST. Any
    consumer that needs value internals still needs an explicit JIT value
    materializer for the requested field/span.
  - Current limit: raw `Ruleset` semantic materialization only covers the
    scanner-native simple selector subset (`*`, tag, `.class`, `#id`, simple
    raw attribute atoms, and no-argument pseudo atoms), adjacent basic compound
    selectors, cheap complex selectors made from those parts with descendant,
    child, adjacent sibling, or general sibling combinators, and comma-separated
    lists whose branches stay inside those shapes, plus the narrow nested
    ampersand-pseudo branch `&:focus` / `&::before`-style names and nested
    leading-combinator selectors such as `> .child`. Pseudo selectors with
    arguments, structured attribute selector internals,
    interpolation, richer nested selectors, and `:extend()` still need a real
    selector materializer or canonical fallback before they count as completed
    scanner-first selector support.
- [x] Structural-fed prototype: add scanner-native Less variable-reference
  materialization for plain Less variable declarations and reads so already-seen
  values and same-scope hoisted simple literal/raw values can run without
  canonical fallback.
  - Current limit: references that depend on dynamic names, alias/lazy values,
    complex variable values, interpolation, arithmetic, functions, accessors,
    guards, mixin scopes, rich comma lists, comments, and variable values
    crossing import/reference boundaries still fall back.
- [x] Structural-fed prototype: add scanner-native one-step Less arithmetic for
  `+` and `-` when both operands are simple numbers or same-unit dimensions,
  either side may be a scanner-native variable reference, and an exact trailing
  `!important` flag may be carried separately. The structural-fed path computes
  the rendered scalar string directly into the declaration segment, with
  zero `Operation`/`Reference`/dimension wrapper nodes and zero legacy island
  parser executions.
  - Current limit: mixed-unit arithmetic that emits `calc(...)`, operation
    chains, multiplication/division, parentheses, functions, and
    math-mode-sensitive expressions still fall back canonically.
- [x] Structural-fed prototype: support root `@media` block at-rules containing
  already supported ordinary rule/declaration bodies without canonical fallback
  when the prelude is scanner-native, and support ruleset-local `@media` blocks
  containing already-supported ordinary nested rules.
  - Current limit: raw `AtRule` semantic materialization is proven for the
    scanner-native root `@media`, ruleset-local `@media`, mixin-body `@media`,
    root `@layer`, no-prelude root/rule-local `@starting-style`, and simple
    parenthesized declaration-condition `@supports` subsets only. Richer
    supports expressions, nested boolean conditions, variable-bearing supports
    values, rule-local nested-rule or nested-at-rule `@starting-style` bodies,
    mixin-body `@starting-style`, and `@starting-style` bodies with richer Less
    merge/function values still stay canonical fallback until their specific
    grammar is proven.
- [x] Structural-fed prototype: support supported at-rules nested inside
  ordinary rules that are themselves inside supported at-rule bodies, while
  keeping raw at-rule headers unmaterialized during ruleset registration.
  - Proof target: `.a { @media screen { .b { @media print { .c { color:
    blue; } } } } }` renders equal CSS through the scanner-fed path, records
    zero full-tree fallback, zero actual parses, zero requested islands, zero
    promoted bytes, and serializes raw at-rule names/preludes plus raw
    declarations rather than eager selector/value wrappers. Core regression
    coverage also proves a thin-field `Ruleset` can prepare under a thin-field
    `AtRule` parent without materializing the at-rule header.
  - Current limit: this proves recursion through supported `@media` families
    only. Unsupported at-rule families, supports expressions, richer
    selectors/values, and declaration-block at-rules still stay outside the
    scanner-fed subset.
- [x] Structural-fed prototype: support simple Less variable declarations inside
  supported `@media` bodies so direct declarations and ordinary
  nested rules can read body-local scanner-native values without canonical
  fallback.
  - Proof target: render parity, `runtimeTreeSource: 'structural-fed'`, zero
    full-tree fallback, zero actual parses, zero requested islands, zero
    promoted bytes, empty island/request owner maps, and serialized runtime
    trees containing `ProgressiveVariableDeclaration` plus declaration
    values rather than `VarDeclaration`, `Reference`, or `Any` value wrappers.
  - Current limit: this is still a thin same-scope/simple-value proof. Less
    variables in root declaration-block at-rules such as `@font-face`, richer
    variable values, alias/lazy references, interpolation, arithmetic beyond the
    already-proven one-step subset, reference/import semantics, supports
    expressions, and other at-rule families remain unproven.
- [x] Structural-fed prototype: support ruleset-local no-argument Less mixin
  definitions and calls when the mixin body stays inside the existing
  scanner-fed declaration/nested-rule subset.
  - Proof target: `.a { .m() { color: blue; } .m(); }` and `.a { .m() { .b {
    color: blue; } } .m(); }` render equal CSS through the scanner-fed path,
    record zero full-tree fallback, zero actual parses, zero requested islands,
    zero promoted bytes, and serialize the local `Mixin`/`Call` plus raw
    selector/declaration fields rather than eager selector/value wrappers.
  - Current limit: ruleset-local mixin definitions now cover only the same
    simple positional-parameter/literal-argument subset as root-level mixins.
    Guards, `!important` mixin calls, dynamic/interpolated mixin names, mixin
    definitions inside mixin bodies, and richer body syntax outside the
    already-proven scanner-fed subset remain unproven.
- [x] Structural-fed prototype: support root-level no-argument Less mixin calls
  when the called mixin itself stays inside the existing scanner-fed subset.
  - Proof target: `.m() { .a { color: blue; } } .m();` renders equal CSS
    through the scanner-fed path, records zero full-tree fallback, zero actual
    parses, zero requested islands, zero promoted bytes, and serializes the root
    `Call` plus selector/declaration fields rather than eager selector/value
    wrappers.
  - Current limit: this proves root placement for exact no-argument calls only.
    Namespaced calls outside the cheap descendant/child no-parens path, chained
    selectors, parameters, guarded calls, important calls, property-accessor
    calls, detached rulesets, and other richer mixin call signatures remain
    canonical fallbacks.
- [x] Structural-fed prototype: support simple deprecated no-parens Less mixin
  calls when the structural node is already classified as a mixin call and the
  name is a scanner-native class/id mixin name.
  - Proof target: `.rounded() { color: blue; } .a { .rounded; }` renders equal
    CSS through the scanner-fed path, records zero full-tree fallback, zero
    actual parses, zero requested islands, zero promoted bytes, serializes a
    `Call`/`Reference` without eager selector/value wrappers, and preserves the
    canonical `parse/deprecated` warning for calling a mixin without
    parentheses.
  - Current limit: the cheap `#theme > .mixin;` no-parens path is covered, but
    chained selectors, selector-list namespaces, arguments, guarded calls,
    important calls, property-accessor calls, detached rulesets, and other
    richer mixin call signatures remain canonical fallbacks.
- [x] Structural-fed prototype: support simple no-argument Less mixin body
  variable declarations and reads inside that same mixin body.
  - Proof target: root and ruleset-local no-argument mixins with `@brand:
    blue;` feeding direct declarations or nested ordinary rules render equal
    CSS through the scanner-fed path, record zero full-tree fallback, zero
    actual parses, zero requested islands, zero promoted bytes, and serialize
    `ProgressiveVariableDeclaration` plus selector/declaration fields
    rather than `VarDeclaration`, `Reference [role=value]`, or `Any` value
    wrappers.
  - Scope guard: a variable declared only inside the mixin body does not leak
    into the caller ruleset. The negative proof intentionally falls back when
    the caller later reads `@brand`, preserving current Less scoping until a
    broader scanner-fed scope model is proven.
  - Current limit: this is a simple same-mixin-body value proof only.
    Parameters, guards, `!important` calls, alias/lazy values, interpolation,
    arithmetic beyond the already-proven one-step subset, richer body syntax,
    and mixin definitions nested inside mixin bodies remain canonical
    fallbacks.
- [x] Structural-fed prototype: support rule-local Tailwind-style `@apply`
  statement at-rules with scanner-native class-token preludes.
  - Proof target: `.box { @apply h-64 w-64; }` renders from a structural-fed
    raw `AtRuleStatement` inside a raw-selector `Ruleset`, records zero
    full-tree fallback, zero actual parses, zero requested islands, and zero
    promoted bytes, and serializes without eager `Any` prelude nodes or
    `BasicSelector` nodes.
  - Current limit: this is deliberately narrower than arbitrary rule-local
    statement at-rules. The accepted prelude is a whitespace-separated set of
    identifier-like class tokens; comments, Less variable-like tokens, multiline
    preludes, other statement names, and richer Tailwind expressions remain
    canonical fallbacks until separately proven.
- [x] Structural-fed prototype: support single-line CSS grid track declaration
  values as scanner-native declaration segments.
  - Proof target: `grid-column: container-left / span 1`,
    `grid-template-columns: [col1-start] 9fr [col1-end] 10px [col2-start] 3fr
    [col2-end]`, and `grid-template-rows: repeat(14, [gutter] 10px [row]
    60px)` render from structural-fed thin `Declaration` nodes. Separate proofs
    cover single-line quoted `grid-template-areas: "head head" "nav main"` and
    multiline quoted `grid-template-areas` rows. All record zero full-tree
    fallback, zero actual parses, zero requested islands, and zero promoted
    bytes, and serialize without `declaration value-node` materialization.
  - Current limit: this is property-sensitive to `grid*` declarations and
    rejects Less variable-like tokens, comments, braces, semicolons,
    unbalanced `[]`/`()`, unproven functions other than `repeat(...)`, and
    multiline values other than quoted `grid-template-areas` rows.
- [x] Structural-fed prototype: support the corpus-observed CSS transform
  function value `scaleX(<number>)` through the existing progressive function
  segment path.
  - Proof target: `transform: scaleX(1)` renders from a string-name declaration
    whose value segment is a `Call` with a numeric argument, records zero
    full-tree fallback, zero actual parses, zero requested islands, and zero
    promoted bytes, and serializes without eager `Any` property wrappers or a
    `declaration value-node`.
  - Current limit: this deliberately admits only a proven function token shape
    with a function-specific one-number argument policy. It does not allow
    arbitrary raw parenthesized declaration strings, dimensions, colors,
    multiple arguments, nested function arguments, Less variable-like tokens,
    comments, strings, or the broader CSS transform grammar until those
    structures are separately represented and proven.
- [x] Structural-fed prototype: support root unknown statement at-rules with
  scanner-native raw preludes when the name does not have Less import/plugin
  semantics.
  - Proof target: Less issue-3660 typo statements such as
    `@impor "impor-typo-dont-parse-as-@import.less";` and
    `@plugi "plugi-typo-dont-parse-as-@plugin";` render from structural-fed
    raw `AtRuleStatement` nodes, record zero full-tree fallback, zero actual
    parses, zero requested islands, and zero promoted bytes, and serialize
    without eager `Any` prelude nodes.
  - Current limit: real `@import`, `@plugin`, `@charset`, and `@namespace`
    names stay on their dedicated semantic paths. Unknown statement preludes
    are limited to quoted strings or simple flat scanner-native value tokens.
- [x] Structural-fed prototype: support root unknown block at-rules with
  scanner-native raw preludes and already-proven ordinary rule children.
  - Proof target: `@unknown-block card { .a { color: blue; } }` renders from a
    structural-fed raw `AtRule` containing a raw-selector `Ruleset` and raw
    `Declaration`, records zero full-tree fallback, zero actual parses, zero
    requested islands, and zero promoted bytes, and serializes without eager
    `Any` name/prelude nodes.
  - Current limit: known semantic block at-rules stay on dedicated paths or
    canonical fallback until their specific grammar is proven. Unknown block
    at-rule names must be identifier-like and non-semantic, and their preludes
    currently share the simple scanner-native at-rule prelude subset.
- [ ] Structural-fed prototype: replace selected-materialization adapter proof
  with scanner-native materialization for each completed CSS/Less construct.
- [x] Prototype performance guard: report structural-fed runtime source,
  promoted bytes, selected island count, fallback full-tree count,
  cache hits/misses, and output equality for the bounded subset.
- [x] Focused performance smoke guard: report parse/eval/render phase timings
  across current parser, structural-sidecar sidecar, selected materialization
  sidecar, and structural-fed prototype paths while preserving output equality.
- [x] Broader Less compiler performance guard: report full parse/eval/render
  phase timings across representative checked-in CSS-shaped and Less fixtures
  so the current parser, structural-sidecar, selected materialization, and
  structural-fed paths can be compared without relying on a single tiny inline
  fixture.
- [ ] Structural-fed Less corpus gate: render every included upstream
  `@less/test-data` `.less` fixture used by `packages/jess/test/less/all-less.test.ts`
  with `scannerFirstProbe.structuralFedPrototype: true`, compare to the expected
  `.css`, and report structural-fed versus canonical fallback counts.
  - [x] Added a corpus parity audit that runs the same included fixture set in
    this isolated worktree and compares structural-fed output to the current
    compiler output.
  - [ ] Promote the parity audit to expected-CSS completion only after current
    compiler expected-CSS failures are zero.
  - Current audit snapshot, 2026-06-20: 64 files / 65 cases, 16
    structural-fed prototype records, 50 canonical fallback records, 19 current
    expected-CSS failures, 16 structural expected-CSS failures, zero
    requested/materialized islands, zero promoted bytes, zero actual parses,
    and 136 progressive nodes from the upstream corpus. That is
    expected for the current conservative subset: most included fixtures contain
    richer selectors/values, mixins, imports, diagnostics, or block comments
    paired with other unsupported constructs that still fall back canonically.
    The current at-rule-family fallback surface is down to one corpus case:
    `tests-unit/at-rules-bubbling/at-rules-bubbling.less`. The
    `tests-unit/starting-style/starting-style.less` file now passes
    `@starting-style` at-rule-family admission, the corpus-observed
    `scaleX(...)` transform values, Less merge declaration names
    (`padding+_`), and direct supported-at-rule mixin-call child admission,
    plus the exact literal-list `each(...)` callback shape used by that
    fixture.
    Declaration-value fallbacks are seven, and declaration-name fallbacks are
    currently gone from the included-corpus first-fallback surface. Legacy
    star-property names such as `*zoom`, statement-form `&:extend(...)`, and
    preserved modern CSS color functions in `tests-unit/color-functions/modern-syntax.less`
    now flow through structural-fed nodes; richer extend selectors now progress
    farther before stopping at selector or at-rule prelude limits.
    The current mixin-related fallback surface is six richer mixin definition
    signatures and two richer mixin call signatures; the earlier generic
    `unsupported rule child mixin-definition`, `unsupported root node mixin-call`,
    and `unsupported mixin-definition child variable-declaration` reasons are
    gone, and the earlier generic `unsupported at-rule child mixin-call` reason
    is now classified as a mixin-call signature boundary.
    The unknown block at-rule proof is root-only and does not change the current
    corpus counts; nested unknown block at-rules and known semantic families
    still fall back until those shapes are separately proven.
    Tailwind `@apply` in `tests-unit/tailwind/tailwind.less` and Less issue-3660
    typo statement at-rules in `tests-unit/impor/impor.less` and
    `tests-unit/plugi/plugi.less` are explicit structural-fed expected-CSS
    overrides because current Jess drops them while the new structural-fed path
    now matches the upstream expected CSS. The
    comma-value, standalone block-comment, mixin-local `@media`, direct nested
    at-rule, recursive nested supported at-rule,
    ruleset-local no-arg mixin, root-level no-arg mixin call, and at-rule-local
    variable proofs above did not change the included-corpus counts because the
    relevant upstream files also contain other unsupported constructs. The CSS
    grid proof moves `tests-unit/css-grid/css-grid.less` onto the structural-fed
    path by preserving single-line grid tracks plus multiline
    `grid-template-areas` rows without parsing declaration values. Progressive
    render/serialize proof is covered by the dedicated thin structure-target
    tests rather than inferred only from this broad upstream corpus.
- [ ] Less corpus benchmark gate: benchmark raw structural parsing, current
  parser/eval/render, structural sidecar full-render probe, selected
  materialization sidecar full-render probe, and structural-fed prototype over
  the included upstream Less fixture set before treating CSS/Less as ready for
  SCSS/Jess widening.
  - [x] Added a raw outer-structure benchmark that calls `parseLessStructure()`
    directly instead of running the compiler. On the upstream Less
    `benchmark/benchmark.less` fixture, the latest raw structural scan measured
    2.78ms median over 20 samples, with 10,259 structural records, 5,738
    raw islands, and zero diagnostics. This is the scanner-first outer-structure
    cost; it is not the same as the full compiler sidecar timings below. The
    same test structurally parsed the 64-file / 65-case included Less corpus in
    10.08ms total, producing 5,301 structural records, 3,070 raw islands, and 5
    structural diagnostics.
  - [x] Added a corpus benchmark smoke audit over the same 64 files / 65 cases
    and four modes. It asserts output parity and records full scanner-first
    instrumentation across entry files and imported/sub-rendered Less files.
  - [x] Promoted the smoke audit to a conservative intra-Jess regression guard
    with repeated samples, warmup or order control, setup/render separation
    where feasible, and explicit broad overhead thresholds. The thresholds
    catch catastrophic regressions against Jess current; they do not prove the
    parser/eval path is competitive.
  - [x] Add a Less 4.x reference comparison gate before this benchmark gate can
    be considered complete. The nearby Less benchmark history reports Less
    4.5.0 `benchmark.less` median render at 42.16ms, while the Jess current
    one-off smoke in this worktree was 450.40ms on the same benchmark input.
    That roughly 10.7x gap is a red flag for the whole Jess parser/eval/render
    path and must not be normalized by comparing scanner-first only against
    Jess current.
    - [x] The scanner-first Less corpus benchmark test now loads the Less 4.5
      median from Less's checked-in historical benchmark JSON and fails if the
      reference entry is missing or malformed. Benchmark-smoke summaries compute
      each Jess mode's median-render ratio against that Less 4.5 reference so
      scanner-first overhead is not only compared to Jess current.
  - Current repeated-sample snapshot over the same 64 files / 65 cases:
    1 warmup run plus 3 recorded samples. Median corpus render times were
    current parser/eval/render 288.26ms, structural sidecar full render
    296.22ms across 306 probe records, selected-materialization sidecar full
    render 336.90ms across 306 probe records with 5,223
    requested/materialized islands and 147,090 promoted bytes, and
    structural-fed prototype 286.57ms across 198 prototype records with 39
    structural-fed records, 159 canonical fallbacks, zero
    requested/materialized islands, zero promoted bytes, and 225 progressive
    nodes. The corresponding ratios against the Less 4.5 `benchmark.less`
    median were current 6.84x, structural sidecar 7.03x, selected
    materialization 7.99x, and structural-fed 6.80x. These medians are gate
    evidence for parity/instrumentation and broad overhead bounds, not a speed
    claim.
  - [x] Ran the upstream Less v5 `benchmark/benchmark.less` fixture as an
    additional smoke input. The selected-materialization sidecar originally
    changed output by leaking sidecar parse trivia/source-root state into the
    canonical render path; island materialization now reuses the plugin-owned
    Less parser but passes a fresh throwaway `TreeContext` per island parse.
    The current structural-fed path for this file records zero island
    executions and falls back for comment-preservation cases instead of
    adopting legacy island nodes. Latest one-off full-render smoke:
    current 450.40ms, structural sidecar 357.69ms, selected-materialization
    407.06ms with 5,900 island parses / 81,083 promoted bytes, and
    structural-fed 313.51ms with three canonical fallbacks for
    comment-preservation. All four modes produced equal CSS. These are
    orientation numbers only, not regression thresholds.
  - Current phase-profile diagnosis for the same Less benchmark input:
    structural parsing itself is cheap, but full Jess render is dominated by
    canonical runtime work. One profiled current render spent about 101ms in
    `getTree`, 301ms in `eval`, and 79ms in `render`; the structural sidecar
    and selected-materialization modes still run that canonical path unless the
    structural-fed prototype can handle the file without fallback.
- [ ] CSS-owned compiler performance guard: add this only if a CSS compiler
  plugin/activation path exists; current compiler e2e timing coverage renders
  CSS-shaped fixtures through the Less-compatible compiler path.
- [x] Verification: focused CSS e2e tests pass.
- [x] Verification: focused Less e2e tests pass.
- [x] Verification: explicit finite CSS parser unit subset passes and remaining
  CSS parser gates are documented separately from scanner-first work.
- [x] Verification: expanded Less parser unit and fixture-backed subset passes,
  including the Less at-rule fixture and Less parser corpus tests.
- [x] Verification: full Less parser package tests pass once
  `test/ast-serialize.test.ts` serializer-baseline drift is classified.

Current broad-parser gate snapshot, 2026-06-20:

- `pnpm --filter @jesscss/parser test` passes: 8 files, 127 tests, including source/line-map,
  scanner recovery, no built-in language profile exports, semantic index,
  services, structural parsing, and checked-in plus upstream Less test-data
  corpus gates.
- `pnpm --filter @jesscss/css-parser test` passes: 11 files, 114 tests,
  including island-provider materialization boundaries and the CSS parser
  benchmark fixture.
- `pnpm --filter @jesscss/less-parser test` passes: 27 files, 426 tests,
  including the Less fixture-backed parser corpus and the classified
  serializer-baseline updates.
- `pnpm --filter @jesscss/jess-parser test` passes: 5 files, 161 tests. The
  test tree validator now skips metadata/root pointers such as `_sourceRoot`
  while still checking owned child parentage. Jess module at-rule island
  providers reconstruct the owning statement from structural owner name offsets
  before invoking the Jess grammar rule; the shared `at-rule-prelude` island
  remains a prelude slice and does not force sibling island parsing.
- `pnpm --filter @jesscss/core build`, focused core
  `control`/`ruleset`/`node-render-buffer` tests, `@jesscss/fns build`,
  `@jesscss/fns test`, `@jesscss/css-parser build`, `@jesscss/less-parser
  build`, `@jesscss/scss-parser build`, `@jesscss/plugin-less build`,
  `@jesscss/plugin-scss build`, and `@jesscss/jess-parser build` pass.
  `defineFunction` now emits declarations through a named `DefinedFunction`
  return type so TypeScript 7 RC declaration output does not erase the richer
  positional/record call surface.
- `pnpm --filter @jesscss/scss-parser test` passes: 5 files, 210 tests. This
  verifies SCSS parser drift after the `Rules` inheritance, `AtRuleStatement`,
  `.value`, and control-node shape changes, plus package-owned SCSS
  selector/value/control island providers with selected-island materialization
  counters.
- `pnpm --filter @jesscss/plugin-scss test` passes: 2 files, 8 tests,
  including plugin-owned structural activation and island-plan wiring.
- `pnpm vitest run packages/core/src/__tests__/jess-error.test.ts
  packages/jess/test/scanner-first-e2e.test.ts` passes, including the
  structural-fed prototype path after the current `Ruleset.rules` body-array
  migration.

### Slice 9b: SCSS And Jess Island Provider Entrypoints

Goal: wire covered SCSS/Jess constructs only after CSS/Less e2e compile/eval
evidence is green.

This slice is intentionally downstream of Slice 8. Do not touch SCSS/Jess
parser packages for scanner-first provider work until the CSS/Less e2e
prototype has successful compile/eval/render evidence.

- [ ] Add SCSS selector/value/control island providers only for constructs with
  tests.
- [ ] Add Jess expression/control/module-at-rule island providers only for
  existing smoke coverage.
- [x] Do not introduce a broad `.jess` syntax corpus in this slice.
- [ ] Add materialization-boundary tests for each covered promoted shape.
- [ ] Performance guard: provider entrypoints do not silently parse sibling
  islands.
- [ ] Verification: existing SCSS/Jess parser tests pass.
- [ ] Verification: `pnpm run verify:package-exports`.

Note: earlier experimental SCSS/Jess provider-entrypoint smoke work exists on
this branch, but Slice 9b is not complete and must not be treated as the active
implementation lane until Slice 8's CSS/Less corpus-plus-benchmark gate is
green.

### Slice 9: Plugin And Visitor Integration

Goal: integrate parser services without freezing future Jess-native plugin or
visitor APIs.

- [x] Prototype parser-aware plugin capabilities or adapter shims outside
  `@jesscss/core`.
- [x] Keep `safeParse(filePath, source)` as the default compiler entrypoint.
- [x] Let `@jesscss/plugin-less` own `.less` activation while reusing
  `@jesscss/less-parser` profile and island providers.
- [x] Let `@jesscss/plugin-scss` own activation while reusing package-owned
  SCSS profile and covered SCSS parse services.
- [x] Map Less-compatible visitor methods to traversal-driven
  Less-adapter-shaped island parse requests.
- [x] Ensure Less-compat visitors receive adapter-shaped nodes as traversal
  reaches them.
  - [x] Primitive selector/value segments remain outside the Less visitor
    surface. Less-compatible visitors return primitive raw segments unchanged,
    `visitArray()` preserves those primitives, and selector adapters do not
    feed strings into `WeakSet`-backed adapter state.
- [x] Ensure structural-only consumers use `StructuralDocument`, not
  `Node.accept`.
  - [x] Shared `LanguageActivationRegistry.parseStructureForExtension(...)`
    returns a `StructuralDocument` without configuring island providers; provider
    setup happens only when `createIslandParsePlanForExtension(...)` is called.
  - [x] Less and SCSS plugin structural-activation tests spy on
    `Node.prototype.accept` and prove structural-only folding/symbol/node-at
    queries do not call core visitor traversal or materialize islands.
- [x] Guard plugin structural activation paths so plugin-level structural-only
  queries use `StructuralDocument` and prove zero island materialization.
- [x] Test `@jesscss/plugin-less` structural activation through the plugin
  extension binding and island parse plan.
- [x] Add JSDoc for plugin activation helpers and why `safeParse` remains the
  default compiler entrypoint.
- [x] Test that plugins implementing only `safeParse` continue to work.
- [x] Add parser-service visitor method-table analysis that derives structural
  node/island request shapes from registered typed or generic visitor methods
  without executing providers.
- [x] Cache visitor method tables and report cache hits/misses for repeated
  visitor planning.
- [x] Test generic, typed, replacing, selector, declaration/value, at-rule, and
  Less-compatible visitors.
- [x] Cache visitor method tables and avoid allocating fresh request arrays on
  repeated traversal.
- [x] Performance guard: visitor tests report traversal requests, materialized
  node count, promoted island count, adapter-node requests, replacements, and
  fallback full-tree count.
- [x] Performance guard: visitor tests report method-table cache hits and
  traversal request-array allocation counts.
- [x] Verification: existing plugin tests pass.
- [x] Verification: `pnpm --filter @jesscss/plugin-less-compat exec vitest
  --run test/integration/plugin-manager.test.ts`.
- [x] Verification: `pnpm --filter @jesscss/plugin-less-compat build`.
- [x] Verification: `pnpm --filter @jesscss/plugin-less test --
  test/structural-activation.test.ts`.
- [x] Verification: `pnpm --filter @jesscss/plugin-less build`.
- [x] Verification: `pnpm --filter @jesscss/plugin-scss test`.
- [x] Verification: `pnpm --filter @jesscss/plugin-scss build`.
- [x] Verification: `pnpm run verify:package-exports`.

### Slice 10: Language-Service Consumer

Goal: prove editor-style consumers can stop after structure and request
chunk-level materialization only when needed.

- [ ] Wire `@jesscss/language-service` to `parseStructure`.
- [ ] Implement folding from structural nodes.
- [ ] Implement symbols from structural nodes.
- [ ] Implement node-at-offset from structural nodes.
- [ ] Implement highlighting chunk requests that materialize only affected
  chunks.
- [ ] Implement completion context requests that materialize only affected
  chunks.
- [ ] Test changed-range invalidation and re-highlight only affected chunks
  after edits.
- [ ] Performance guard: benchmark folding, symbols, node-at-offset,
  highlighting chunks, completions, changed ranges, and re-materialized chunks
  separately.
- [ ] Verification: `pnpm --filter @jesscss/language-service test`.
- [ ] Verification: no full AST is built for structural-only language-service
  queries.

### Slice 11: Compiler Opt-In Experiment

Goal: test structural parse plus demand-driven materialization behind a hidden
option without changing default behavior.

- [ ] Add hidden/experimental option for selected CSS/Less/SCSS/Jess files.
- [ ] Run structural scan first, then materialize islands only as eval/render,
  visitor/plugin traversal, or semantic indexes request them.
- [ ] Collect phase timings for structural scan, materialization, AST
  construction, visitors, eval, and render.
- [ ] Compare current compiler parser behavior with structural-only parse,
  selected materialization, and full materialization paths.
- [ ] Compare relevant Less behavior against Less 4.x reference observations.
- [ ] Preserve default compile pipeline behavior.
- [ ] Performance guard: report end-to-end time, promoted bytes, cache
  hits/misses, fallback full-tree count, and eval/render output equality.
- [ ] Verification: full Less fixture gates pass before considering promotion.
- [ ] Verification: no default behavior change.

## Non-Goals

- Do not make structural nodes the runtime/eval/render AST in `@jesscss/core`.
  Shared structural nodes are expected, but they live in `@jesscss/parser` as
  `StructuralDocument` node types. Compiler parser packages or plugins execute
  island parse requests into canonical core nodes at demanded boundaries.
- Do not hand raw placeholders to current compiler visitors.
- Do not remove Chevrotain from compiler parsers as part of structural parser
  work.
- Do not silently weaken CSS spec behavior in any compile stage.
- Do not add Less 4.x as production parser dependency.

## Recommendation

Replace the current `@jesscss/parser` implementation with the new shared parser
foundation. Do not create new public packages for source spans, structural
parsing, or parse services unless the module boundaries later prove too large
for one package.
Wire `@jesscss/parser` into the language-service and parser-aware plugin
adapters before touching the default compile pipeline. Treat visitor
registration as an island parse planning input. Treat exact spans and
newline/trivia ownership as the first deliverable, not an optimization.

Only after the structural layer proves useful and the island providers preserve
parser AST contracts should Jess consider a compiler opt-in path.
