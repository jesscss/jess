# @jesscss/parser

Shared parser infrastructure for Jess-family stylesheet parsers.

This package is not a CSS, Less, SCSS, or Jess parser. It owns the generic
pieces that language parser packages use to build real compiler AST nodes:

- the existing recursive-descent parser runtime
- immutable source text with lazy line/column mapping
- offset and packed-span helpers
- scanner helpers for comments, strings, trivia, delimiters, declaration splits,
  selectors, at-rule preludes, and recoverable diagnostics

Language packages own language syntax and compiler AST construction. The
scanner-first replacement path should produce existing `@jesscss/core` nodes
such as `Stylesheet`, `Ruleset`, `AtRule`, `AtRuleStatement`, and `Declaration`
as early as that is the cheapest understandable shape.

## Removed Prototype API

The old scanner-first prototype produced a parallel `StructuralDocument` tree,
`RawIslandNode` records, `IslandParsePlan`, language profiles, visitor planning,
and semantic-index services. Those shapes were confusing because they looked like
the parser result even though the target parse result is AST-shaped.

That prototype API is no longer exported from this package and should not be
reintroduced under softer names. If a future deferred parser registry proves
necessary, it should start from AST-owned fields:

```ts
Declaration {
  type: 'Declaration',
  name: 'color',
  value: 'rgb(10, 20, 30)',
  important: false,
  fieldSpans: [/* packed direct-field spans */]
}
```

The owning AST node is the first place to store deferred state. A separate object
for "the span we might parse later" has to prove value over a string field plus
node-owned packed spans.

## Current Direction

The first useful replacement proof is CSS, then Less. Keep the base parser small
and DRY:

1. Use scanner/source helpers to find cheap boundaries.
2. Construct real core AST nodes in the language parser package.
3. Store strings for fields that do not need typed parsing yet.
4. Store offsets as packed spans only when diagnostics, source maps, hydration,
   or tests prove they are needed.
5. Hydrate fields later only when evaluation, extend matching, visitors, or
   diagnostics prove a typed shape is required.

See `docs/requirements-and-scope.md` and `docs/implementation-map.md` for the
active parser strategy and deletion criteria.
