# Scanner-First Structure Targets

This file is a seed corpus for deciding the cheapest parser-ready shape that can
still render, evaluate, and JIT-parse correctly. These are targets, not frozen
AST contracts. The preferred implementation direction is progressively enhanced
core nodes: normal `Ruleset`, `Declaration`, `AtRule`, and rules-container nodes
start with literal string payloads plus offset/kind metadata, then parse/cache
richer field payloads only when demanded.

Each target separates:

- cheap structure: strings, child lists, coarse kind/classification, and compact
  source-offset metadata;
- direct behavior: what render/eval can do without deeper parsing;
- JIT triggers: conditions that require field-level parsing or richer semantic
  objects.

The goal is for these examples to become a structure-parse corpus: parse source,
compare cheap raw field facts, assert no eager JIT parse or child-node creation,
then run targeted JIT requests only for the listed triggers.

## Illustrative Assertion Vocabulary

The pseudo-types below are a compact way to write expected corpus facts. They
are not implementation interfaces and should not force a separate structural
runtime node layer. Automated cases may assert equivalent facts on progressive
core nodes with different property names, enum names, or source-identity
storage. `StructuralDeclaration` mirrors the first implementation candidate,
but `StructuralRule` is only a shorthand for "an existing core node once that
body segment has been promoted." Fields like `selector`, `prelude`, `sourceRef`,
and `valueKind` are assertion facts/placeholders until the matching core-node
prototype proves its storage. `OffsetKindRef` stands in for compact offset/kind
metadata such as `valueOffsets`/`valueKinds`, a packed side table, or a measured
equivalent. The packed side table is a first-class candidate because it can cover
selector/name/prelude/value/body strings without per-node metadata arrays. It is
not a wrapper node around every string.

```ts
type OffsetKindRef = unknown; // maps node fields/segment indexes to offsets/kinds
type Node = unknown; // existing core node when a segment is already parsed
type Interpolated = unknown; // existing core interpolated name/value node

type StructuralRuleset = {
  kind: 'ruleset';
  selector: string;
  selectorKind: 'simple' | 'compound' | 'list' | 'complex' | 'unknown';
  sourceRef: OffsetKindRef;
  rules: (string | StructuralRule)[];
};

type StructuralDeclaration = {
  kind: 'declaration';
  name: string | Interpolated;
  nameKind: 'property' | 'custom-property' | 'less-variable' | 'interpolated';
  value: (string | Node)[];
  valueOffsets?: OffsetKindRef;
  valueKinds?: OffsetKindRef;
  valueKind:
    | 'literal'
    | 'reference'
    | 'expression'
    | 'function-call'
    | 'custom-property-raw'
    | 'unknown';
  important: boolean;
  sourceRef: OffsetKindRef;
};

type StructuralAtRule = {
  kind: 'at-rule';
  name: string;
  prelude: string;
  preludeKind: 'literal' | 'query' | 'reference' | 'unknown';
  sourceRef: OffsetKindRef;
  rules: (string | StructuralRule)[];
};

type StructuralAtRuleStatement = {
  kind: 'at-rule-statement';
  name: string;
  prelude: string;
  preludeKind: 'literal' | 'query' | 'reference' | 'unknown';
  sourceRef: OffsetKindRef;
};

type StructuralRule =
  | StructuralRuleset
  | StructuralDeclaration
  | StructuralAtRule
  | StructuralAtRuleStatement;
```

## CSS Targets

### CSS-001 Plain Rule

```css
.a {
  color: blue;
}
```

```ts
Ruleset {
  selector: ".a",
  selectorKind: "simple",
  rules: [
    Declaration {
      name: "color",
      nameKind: "property",
      value: ["blue"],
      valueKind: "literal"
    }
  ]
}
```

Direct behavior: render selector, property name, and literal value from strings.

JIT triggers: selector visitor, source-map detail beyond stored source identity,
or a plugin requesting typed selector/value nodes.

Current status: structural-fed prototype handles this without island parser
execution, and `packages/jess/test/scanner-first-e2e.test.ts` includes it in
the executable thin structure-target proof: parse to raw core fields, render
equal CSS, serialize raw fields, and assert no selector/value child nodes.

### CSS-002 Declaration Order

```css
.a { width: 1px; color: blue; }
```

Target structure:

```ts
Ruleset {
  selector: ".a",
  selectorKind: "simple",
  rules: [
    Declaration { name: "width", value: ["1px"], valueKind: "literal" },
    Declaration { name: "color", value: ["blue"], valueKind: "literal" }
  ]
}
```

Direct behavior: preserve declaration order and render both literal values as
strings.

JIT triggers: none for ordinary render; typed value visitor for `1px` may parse
only that value field.

Current status: structural-fed prototype handles this without island parser
execution, and the executable thin structure-target proof asserts declaration
ordering, raw value segments, equal render output, and no eager value nodes.

### CSS-003 Nested Rule

```css
.a {
  color: blue;
  .b { width: 1px; }
}
```

Target structure: nested `Ruleset` stays a child rule with its own selector
string. Do not build selector ASTs merely because nesting exists.

```ts
Ruleset {
  selector: ".a",
  selectorKind: "simple",
  rules: [
    Declaration { name: "color", value: ["blue"], valueKind: "literal" },
    Ruleset {
      selector: ".b",
      selectorKind: "simple",
      rules: [
        Declaration { name: "width", value: ["1px"], valueKind: "literal" }
      ]
    }
  ]
}
```

Direct behavior: render/eval can preserve nested rule placement using parent
rule context.

JIT triggers: `&`, selector-list merging, `:extend()`, or visitor access to
typed selector nodes.

Current status: structural-fed prototype handles this simple nested form, and
the executable thin structure-target proof asserts nested raw selector fields,
raw declaration fields, equal render output, and zero island parser requests.

### CSS-004 Selector List

```css
.a, .b {
  color: blue;
}
```

Target structure:

```ts
Ruleset {
  selector: ".a, .b",
  selectorKind: "list",
  rules: [
    Declaration { name: "color", value: ["blue"], valueKind: "literal" }
  ]
}
```

Direct behavior: preserve the selector text and render declarations directly.

JIT triggers: selector-list splitting beyond scanner-native branches,
`:extend()`, visitor access to typed selector nodes, or diagnostics that need
selector component positions.

Current status: structural-fed prototype handles comma-separated lists whose
branches are already in the scanner-native selector subset, such as `.a, .b`,
`.a, button.primary`, and `.a .b, .c`, without island parser requests.
Descendant-only complex branches whose parts stay in the cheap subset are
covered; non-descendant combinators, pseudos, attributes, comments,
interpolation, nested selectors, and `:extend()` remain outside this proof.

### CSS-005 Nested Ampersand Selector

```css
.a {
  &:hover { color: blue; }
}
```

Target structure: the nested rule keeps selector text `&:hover` with a coarse
selector classification that marks parent-reference syntax without building a
selector AST.

Direct behavior: ordinary CSS output cannot render this as-is; the nesting
stage must JIT-parse or otherwise resolve only the selector fields involved in
parent merging.

JIT triggers: `&` in selector text.

Current status: structural-fed prototype handles descendant-only chains whose
parts are already in the scanner-native simple/adjacent compound selector
subset, such as `.a .b` and `button .icon.active`, without island parser
requests. Non-descendant combinators, pseudos, attributes, comments,
interpolation, nested selectors, and `:extend()` remain outside this proof.

### CSS-006 Custom Property Raw Value

```css
.a {
  --theme: { token: "}"; };
}
```

Target structure: declaration name is `--theme`; value is one raw string with
`valueKind: "custom-property-raw"`. Scanner must preserve strings, comments,
`url()`, and unbalanced-looking braces inside the custom-property value.

Direct behavior: render raw value without tokenizing it.

JIT triggers: custom-property-specific tooling or diagnostics, not ordinary
compile render.

Current status: structural-fed prototype handles the single-line raw brace/string
case without island parser execution. The executable thin structure-target proof
asserts the raw custom-property value is one segment and does not allocate a
canonical value node. Multiline/trivia-exact custom-property cases are still
unproven.

### CSS-007 Media Rule

```css
@media screen {
  .a { color: blue; }
}
```

Target structure: `AtRule { name: "@media", prelude: "screen", rules: [...] }`.
Prelude stays a string with `preludeKind: "literal"` until query semantics are
needed.

Direct behavior: render simple prelude and child rules directly.

JIT triggers: media-query semantic analysis, deprecated Less prelude variable
handling, or typed at-rule visitor access.

Current status: structural-fed prototype handles simple literal preludes.

### CSS-008 Statement At-Rule

```css
@charset "UTF-8";
@import url("theme.css") screen;
.a { color: blue; }
```

Target structure: `@charset` and `@import` are `AtRuleStatement` records with
name, prelude string, and source identity. They do not inherit rules-container
behavior because they have no block body.

Direct behavior: render the statements and following ordinary rules without
building prelude ASTs.

JIT triggers: import resolution, charset diagnostics, media-query tooling, or a
visitor requesting typed statement-prelude nodes.

Current status: statement-form at-rules are a first-wave corpus gap.

## Less Targets

### LESS-001 Variable Declaration, No Read

```less
@brand: blue;
```

Target structure:

```ts
Declaration {
  name: "@brand",
  nameKind: "less-variable",
  value: ["blue"],
  valueKind: "literal"
}
```

Direct behavior: register a variable binding whose value remains a literal
string/token until read.

JIT triggers: value operation, function call, interpolation, or visitor request
for a typed value node.

Current status: structural-fed bridge can create the current core var-decl
surface for literal values.

### LESS-002 Variable Read

```less
@brand: blue;
.a { color: @brand; }
```

Target structure: declaration value `@brand` should remain a single string
segment with `valueKind: "reference"` plus offset/kind metadata; it should not
eagerly become a full value AST.

Direct behavior: eval needs a cheap reference lookup against structural
variable bindings. If the referenced value is literal, render the literal
without parsing either field into a full value AST.

JIT triggers: reference accessors (`@map[key]`), variable variables (`@@name`),
fallback behavior, missing-variable diagnostics, or visitor access to typed
reference nodes.

Current status: not complete. A temporary core `Reference` bridge did not
resolve correctly in this prototype, so this should become a design target
before another implementation attempt.

### LESS-003 Hoisted Variable Read

```less
.a {
  color: @brand;
  @brand: blue;
}
```

Target structure:

```ts
Ruleset {
  selector: ".a",
  selectorKind: "simple",
  rules: [
    Declaration { name: "color", value: ["@brand"], valueKind: "reference" },
    Declaration { name: "@brand", value: ["blue"], valueKind: "literal" }
  ]
}
```

Direct behavior: structural eval must preserve Less variable lookup semantics,
including declarations that affect earlier sibling reads where Less allows it.
Build binding indexes only for containers whose cheap structure contains
variable declarations or reference-like syntax; do not allocate full-tree
binding maps for files that do not need them.

JIT triggers: dynamic names, guards, mixin scopes, or ambiguous lookup
semantics.

Current status: not complete.

### LESS-004 Arithmetic

```less
@gap: 4px;
.a { width: @gap + 2px; }
```

Target structure: value segment list `["@gap + 2px"]` with
`valueKind: "expression"`.

Direct behavior: cannot render as raw string because Less arithmetic changes
output. Eval should JIT-parse this value field only when evaluating the
declaration value.

JIT triggers: arithmetic operator detection is itself the trigger.

Current status: canonical fallback.

### LESS-005 Function Call

```less
@brand: #336699;
.a { color: lighten(@brand, 10%); }
```

Target structure: value segment list with one function-call string segment and
`valueKind: "function-call"`.

Direct behavior: no direct render; evaluating the value demands JIT parsing
only that value field and its argument substructure.

JIT triggers: function call marker plus eval demand.

Current status: canonical fallback.

### LESS-006 Mixin Definition And Call

```less
.rounded() {
  border-radius: 4px;
}
.button {
  .rounded();
}
```

Target structure: mixin signature can be indexed from raw selector text on the
owning mixin node; body rules can remain raw-field core nodes. Call statement
stays raw text/source identity until call resolution.

Direct behavior: registering a mixin should not parse every body value. Calling
the mixin should instantiate/evaluate only the body parts that are needed for
the call.

JIT triggers: parameters, guards, variadics, namespace access, overload
resolution, or visitor access to typed mixin nodes.

Current status: canonical fallback.

### LESS-007 Extend

```less
.base { color: blue; }
.button:extend(.base) { width: 1px; }
```

Target structure: ruleset selector string includes an extend marker and is
classified as needing selector semantics. Do not parse unrelated declaration
values just because extend exists.

Direct behavior: declaration bodies remain raw-field payloads. Extend graph
construction JIT-parses only selector fields participating in extend and caches
those parsed selectors on their owning rulesets.

JIT triggers: `:extend(` in selector text.

Current status: canonical fallback for structural-fed; selected adapter path
is legacy-parser adapter comparison only; it is never completion proof.

### LESS-008 Import

```less
@import "tokens.less";
.a { color: @brand; }
```

Target structure:

```ts
AtRuleStatement {
  name: "@import",
  prelude: "\"tokens.less\"",
  preludeKind: "literal"
}
```

Import resolution is a compile stage, not a reason to parse every selector/value
in either file.

Direct behavior: resolve/load imported file, parse it into raw-field core nodes,
and merge cheap bindings/rules according to Less import semantics.

JIT triggers: import options, reference/inline/css/plugin imports, media
wrapping, or imported-file constructs that demand richer parsing.

Current status: canonical fallback in structural-fed corpus.

### LESS-009 Parent Scope Block

```less
& {
  @brand: blue;
  .a { color: @brand; }
}
```

Target structure: during scanner-first parse, `& { ... }` is eligible to become
a direct rules-container/scope core node when parent-selector resolution would
otherwise produce no concrete selector. It should not become a synthetic ruleset
that later serializes `&`.

Direct behavior: create scope isolation and evaluate child raw-field rules in
that scope. Its `.rules` body may start as a mixed string/node stream with
offset/kind metadata at structural parse time, promoting only demanded body
segments. The block itself should not serialize braces when emitted directly as
a rules-container node.

JIT triggers: non-trivial parent selector merging, guarded/control semantics,
or visitor access to a typed selector node for the original `&` text.

Current status: not complete; this exists to keep Less parent scope handling
distinct from ordinary selector rulesets.

### LESS-010 Bare Scope Block

```less
{
  @brand: blue;
  .a { color: @brand; }
}
```

Target structure: a direct `Rules`/rules-container block with a thin body stream,
not a synthetic `&` selector and not a nested wrapper node inside `.rules`.

Direct behavior: create scope isolation and evaluate child raw-field rules in
that scope. Its `.rules` body may be a string/node stream during structural
parsing, with offsets stored separately; string body segments are promoted only
when a stage demands node semantics. The block itself should not serialize
braces when emitted directly as a rules-container node.

JIT triggers: guard/control semantics if the same body form is later attached to
`$if`, `$when`, loops, or mixins.

Current status: not complete; this exists to keep scope blocks distinct from
selector rulesets before widening Less control-node parsing.

## Corpus Promotion Rules

Before a target graduates into an automated structure corpus case:

- assert the cheap structure shape, including classifications and stable source
  identity availability, not the exact source-identity representation;
- assert no legacy parser execution during the structural parse;
- assert no field-level JIT parse until the target's listed trigger is invoked;
- assert selector, declaration-name, at-rule-prelude, value-segment, and body
  strings have cheap offset/kind metadata by owning node/field/segment index
  where diagnostics, JIT parsing, source maps, or fast kind checks may need it;
- compare candidate metadata shapes before freezing storage:
  `valueOffsets`/`valueKinds` parallel arrays, a packed side table that stores
  typed/dense metadata for many nodes, or another lower-allocation equivalent;
- assert raw `.rules` string segments preserve ordering, source identity, and
  renderable boundaries without reparsing adjacent body text merely so traversal
  can walk the body;
- assert triggered JIT parsing caches onto the owning core node and does not
  create repeated adapter-owned core subtrees for the same field/cache key;
- assert segment promotion replaces or annotates only the demanded field/body
  segment on the owning node; rebuilding whole `value` or `.rules` arrays must
  be measured and justified before it is accepted as the default strategy;
- when direct render/eval is claimed, compare CSS output to the current compiler
  or upstream expected CSS;
- when fallback is expected, record the fallback reason as part of the case.

The first executable structure-target proof currently lives in
`packages/jess/test/scanner-first-e2e.test.ts` under
`parses thin structure targets into raw core nodes that render and serialize
without eager field materialization`. That test is intentionally small: it
parses source through the structural-fed Less path, compares render output to
the current compiler, serializes the resulting raw-field core tree, and asserts
zero requested islands / zero legacy parser executions. It also asserts the
parser-side packed `FieldRangeTable` maps selector, declaration-name, and value
fields back to the same raw strings. That proves cheap field metadata exists for
these targets without blessing a final core-side metadata API. Add new target
rows there before widening a target's status in this document.
