# Research/Experiment Instructions: Scanner-First Parser for CSS/Less/Sass/Jess

## Goal

Explore whether a scanner-first, structural parser can outperform a full parser-generator approach for CSS/Less/Sass-like languages while preserving enough information for IDE tooling, language services, and compiler features such as :extend().

The target architecture is not "never parse deeply." The target is:

```
Fast structural parse first
Lazy/deferred deep parsing where needed
Semantic indexes built separately
Incremental invalidation by source range/block
```

The core theory:

> CSS-family languages often do not require full semantic parsing of selectors and values during the first pass. Many IDE features only need ranges, scopes, declarations, block nesting, and statement boundaries. Deep parsing should happen selectively.

## Main Hypothesis

The likely fastest practical architecture is:

```
Custom scanner
  v
Structural parser
  v
Offset-first AST with raw selector/value islands
  v
Lazy selector/value/expression parsers
  v
Semantic indexes: variables, mixins, imports, extends
  v
IDE services
```

Use a hand-written parser for the highway. Use Chevrotain or another structured parser only for the tricky alleys.

# 1. Build Three Experimental Parsers

## A. Scanner-first parser

Implement a hand-written scanner/parser that creates a shallow structural AST.

It should eagerly parse:

- stylesheet
- blocks
- rules
- declarations
- at-rules
- Less/Sass/Jess variables
- mixin definitions
- mixin calls
- imports/use/forward
- comments
- nesting
- source ranges

It should initially keep these as raw spans:

- selectors
- declaration values
- complex expressions
- function bodies/arguments where possible
- unknown CSS syntax
- custom properties

Example output:

```ts
interface RuleNode {
  kind: "Rule";
  selector: RawSelectorNode;
  block: BlockNode;
  start: number;
  end: number;
}

interface RawSelectorNode {
  kind: "RawSelector";
  start: number;
  end: number;
}

interface DeclarationNode {
  kind: "Declaration";
  property: string;
  propertyStart: number;
  propertyEnd: number;
  value: RawValueNode;
  start: number;
  end: number;
}

interface RawValueNode {
  kind: "RawValue";
  start: number;
  end: number;
}
```

Use offsets first. Do not compute line/column unless requested.

## B. Full parser-generator parser

Build a comparison parser using Chevrotain if practical.

This parser should:

- tokenize more eagerly
- parse selectors and values more deeply
- produce a richer CST/AST
- use parser-generator grammar rules where reasonable

The point is not to make Chevrotain look bad. The point is to measure where it helps and where it adds overhead.

## C. Existing parser baseline

Compare against at least one existing parser if practical:

- Less parser
- PostCSS parser
- Sass parser
- any existing parser already used in the project

Measure both correctness and speed.

# 2. Scanner-First Parser Requirements

## Scanner

Implement a tight scanner over the source string.

Prefer:

```
source.charCodeAt(pos)
```

for hot paths.

The scanner should recognize:

- {
- }
- :
- ;
- ,
- (
- )
- [
- ]
- strings
- comments
- identifiers
- at-keywords
- Less variables: @name
- Sass variables: $name
- Less interpolation: @{name}
- Sass interpolation: #{expr}
- raw chunks

Avoid storing token text unless needed. Store ranges.

```ts
interface Token {
  kind: TokenKind;
  start: number;
  end: number;
}
```

Avoid per-character allocation. Avoid building rich token objects for every tiny thing unless benchmarks prove it is acceptable.

## Structural parser

The first parser pass should answer:

- Where are the blocks?
- Where are the rules?
- Where are declarations?
- Where are at-rules?
- Where are variable definitions?
- Where are mixin definitions/calls?
- What node contains this offset?
- What scope contains this offset?
- What ranges can be folded?
- What symbols can be shown?

It does not need to fully understand every selector/value during the first pass.

# 3. Raw Islands

Use raw islands for syntactic regions that are often expensive and unnecessary to parse eagerly.

## Selector island

Input:

```
.foo:not(.bar) > baz[attr="#{thing}"] {
  color: red;
}
```

Initial output should be closer to:

```ts
{
  kind: "Rule",
  selector: {
    kind: "RawSelector",
    start: 0,
    end: 39
  },
  block: {
    start: 40,
    end: 57
  }
}
```

Do not fully parse .foo:not(.bar) > baz[attr="#{thing}"] unless needed.

## Value island

Input:

```
width: calc(100% - var(--gap));
```

Initial output:

```ts
{
  kind: "Declaration",
  property: "width",
  value: {
    kind: "RawValue",
    start: 7,
    end: 30
  }
}
```

The structural parser only needs to find the value boundary while respecting:

- strings
- comments
- parentheses
- brackets
- braces where valid
- interpolation
- escaped characters

## Complex value

Input:

```
background:
  linear-gradient(
    to right,
    rgb(0 0 0 / 50%),
    hsl(100deg 50% 50%)
  );
```

Initial parser should identify:

```
property = background
valueStart = after colon
valueEnd = before semicolon
```

It should not eagerly parse the gradient unless a feature asks for it.

# 4. Selector Detail and :extend()

Important: selectors cannot remain raw forever.

Less-style :extend() means selectors need semantic detail eventually.

Example:

```
.button {
}

.primary {
  &:extend(.button);
}
```

The system eventually needs:

```
Extender: .primary
Target: .button
```

But this does not require every selector to be deeply parsed during the first pass.

Use a layered model:

```
Pass 1: structural parse
  Rule -> RawSelector + Block

Pass 2: selector parsing/indexing
  parse selectors that may matter

Pass 3: semantic graph
  build extend graph, specificity info, references, etc.
```

Recommended selector subsystem:

```
Structural Parser
  v
Rule Nodes with RawSelector ranges
  v
Selector Service
  v
Selector AST Cache
  v
Extend Graph
  v
IDE/refactor/compiler features
```

Selector parsing should be triggered when:

- selector contains :extend
- selector participates in an extend target lookup
- cursor is inside a selector
- rename/refactor needs selector structure
- formatter/linter needs selector structure
- compiler output requires full selector expansion

Do not make every ordinary edit pay for the full selector engine.

# 5. Lazy Island Parser APIs

Expose APIs like:

```ts
parseSelector(node: RawSelectorNode): SelectorAst;
parseValue(node: RawValueNode): ValueAst;
parseExpression(start: number, end: number): ExpressionAst;
getSelectorAst(rule: RuleNode): SelectorAst;
getValueAst(decl: DeclarationNode): ValueAst;
```

Cache parsed islands by:

- source version
- start/end range
- content hash if useful

Invalidate only affected islands after edits.

# 6. IDE Features to Preserve

The experiment should prove the scanner-first parser can still support:

- find node at offset
- scope stack at offset
- syntax diagnostics
- folding ranges
- document symbols
- property completion context
- value completion context
- hover ranges
- rename/reference ranges
- variable and mixin indexing
- selector indexing
- :extend() graph
- incremental reparsing

Examples:

```
.foo {
  col|
}
```

This only needs:

```
inside block
at declaration property position
```

Example:

```
.foo {
  color: r|
}
```

This needs:

```
inside declaration value
property = color
```

Still no need to parse the entire file deeply.

# 7. Incremental Parsing

Explore incremental reparsing by enclosing block.

For an edit at offset X:

- Find smallest containing block or statement.
- Re-scan/reparse that region.
- Reconnect it to the existing tree.
- Invalidate semantic indexes only for affected ranges.
- Keep raw selector/value islands outside that range cached.

Measure:

- full parse time
- incremental parse time
- affected range size
- cache hit rate
- time to restore IDE context after edit

# 8. Error Tolerance

The parser must handle broken code.

Examples:

```
.foo {
  color: red
  background: calc(100% -
```

```
@mixin thing($x {
  color: red;
```

```
.foo {
  &:extend(.bar
```

Even with broken syntax, return useful structure:

- partial blocks
- partial declarations
- raw spans
- diagnostics with ranges
- best-effort scope at cursor

Do not throw on malformed input.

# 9. Benchmark Corpus

Create benchmark files for:

- Large flat CSS
- Deeply nested Less/SCSS
- Many complex selectors
- Many complex values
- Heavy variable usage
- Heavy mixin usage
- Heavy :extend() usage
- Large files with custom properties
- Broken/incomplete IDE typing snapshots
- Real-world Less/Sass/CSS files if available

Include examples like:

```
.foo:not(.bar) > baz[attr="#{thing}"] {
  width: calc(100% - @gap);
}
```

```
$color: red;

@mixin button($size) {
  padding: $size;
}

.foo {
  @include button(10px);
}
```

```
.button {
}

.primary {
  &:extend(.button);
}
```

# 10. Measurements

Measure:

- cold full parse time
- warm full parse time
- incremental parse time
- memory allocated
- retained memory
- node count
- token count
- time to find node at offset
- time to get completion context
- time to produce folding ranges
- time to produce document symbols
- time to build variable index
- time to build mixin index
- time to build selector/extend index
- time to parse selector island on demand
- time to parse value island on demand

Run enough iterations to reduce noise.

Use realistic file sizes:

- 10 KB
- 100 KB
- 1 MB+
- large generated stress files

# 11. What to Compare

Compare these modes:

## Scanner-first shallow mode

Only structural parsing. Raw selector/value islands.

## Scanner-first plus semantic index mode

Structural parse plus variable/mixin/import/extend indexing.

## Scanner-first plus lazy island mode

Only parse selector/value islands requested by a simulated IDE action.

## Eager full parse mode

Parse everything eagerly.

## Chevrotain mode

Parser-generator-heavy baseline.

## Existing parser mode

Less/PostCSS/Sass baseline if feasible.

# 12. Expected Tradeoffs to Investigate

Likely benefits:

- faster first parse
- fewer allocations
- better IDE typing performance
- better resilience to unknown CSS
- easier incremental invalidation
- good enough IDE context without full semantic parse

Likely costs:

- more custom parser code
- more responsibility for error recovery
- more complex caching model
- possible duplication between structural parser and island parsers
- harder correctness story for full compilation

# 13. Final Deliverables

Produce:

- Prototype implementation.
- Benchmark results.
- Architecture notes.
- Comparison against Chevrotain and/or existing parsers.
- Recommendation: scanner-first, parser-generator-first, or hybrid.
- List of syntax regions that should stay raw initially.
- List of syntax regions that should parse eagerly.
- Notes on how :extend() changes selector parsing needs.
- Notes on IDE feature support.
- Next-step implementation plan.

# 14. Likely Final Recommendation to Test

The likely best architecture is:

```
Hand-written scanner/parser for structure
Raw selector/value islands
Lazy selector/value/expression parsers
Separate selector service for :extend(), specificity, refactors
Offset-first AST
Lazy line/column mapping
Incremental reparsing by enclosing block
Optional Chevrotain for complicated subgrammars
```

The point is not:

> "Never parse selectors or values."

The point is:

> "Do not eagerly deep-parse every selector and value during the first structural pass."

For CSS-family languages, parsing should be layered:

```
structure first
semantics second
deep syntax only when useful
```
