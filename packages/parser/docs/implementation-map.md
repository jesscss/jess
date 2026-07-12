# Scanner-First Implementation Map

This document maps the current `@jesscss/parser` package to
[requirements-and-scope.md](requirements-and-scope.md).

Read order:

1. Review `requirements-and-scope.md`.
2. Check this file against the current code.
3. Delete any parser object or public API that cannot justify itself against
   those requirements.

## Current Package Shape

`@jesscss/parser` now exposes one public entrypoint: `@jesscss/parser`.

The old scanner-first prototype packages were removed from the base parser API:

- no `@jesscss/parser/structure/index`
- no `@jesscss/parser/services/index`
- no `@jesscss/parser/profiles/index`
- no `parseStructure`
- no `StructuralDocument`
- no `RawIslandNode`
- no `IslandParsePlan`
- no `IslandParserRegistry`
- no `LanguageProfile`

That removal is intentional. The base parser should not produce a parallel
structural schema that competes with the real compiler AST.

## Kept Surfaces

| Surface | Requirement | Why It Stays |
| --- | --- | --- |
| Recursive parser runtime (`parser.ts`, `types.ts`) | Existing parser packages still depend on it while Chevrotain replacement proceeds slice by slice. | It is the current parser runtime boundary, not the new structural result model. |
| `SourceText` and `LineMap` | R1 offset-first source model. | One source owner plus lazy line/column conversion; avoids eager per-node location tuples. |
| Packed span helpers | R1, R5, R8. | AST nodes can store compact direct-field and array-segment spans without separate deferred-field objects. |
| Scanner helpers | R2, R6. | Boundary finding, trivia, comments, strings, delimiters, `url(...)`, custom properties, and recovery support direct AST construction. |
| Cheap selector/prelude scanners | R2, R3, R5. | They return strings/tuples that language parsers can turn into core AST fields without allocating a parallel tree. |
| Parser diagnostics | R6. | Diagnostics are records, not AST nodes, and remain offset-first. |

## Removed Surfaces

The deleted structural/services/profile code used to create these objects:

- `StructuralContainerNode`
- `StructuralStatementNode`
- `StructuralDocument`
- `RawIslandNode`
- `FieldRangeTable`
- `IslandParsePlan`
- `IslandParseRequest`
- `IslandParserRegistry`
- `SemanticIndexBuilder`
- visitor-shape planning tables
- language activation/profile registries

Those objects failed the current first-principles test for the compiler parse
path: they made a second schema instead of producing or hydrating existing AST
nodes. If an editor-only broad-scan artifact is reintroduced later, it must live
outside the compiler parser result and prove its object cost separately.

## Current CSS Proof

`@jesscss/css-parser` owns the first AST-shaped proof:

- `parseCssStylesheet(filePath, source)`
- `parseFlatCssDeclarationStylesheet(filePath, source)`

Those functions return a core `Stylesheet` with real `Ruleset`, `AtRule`,
`AtRuleStatement`, and `Declaration` nodes. Cheap fields may be strings:

```ts
Declaration {
  type: 'Declaration',
  name: 'color',
  value: 'rgb(10, 20, 30)',
  important: false
}
```

The proof must remain understandable in a debugger and serializable without
consulting a structural document, island plan, or provider registry.

## Deferred Field Target

Deferred state belongs first on the owning AST node:

```ts
class Declaration extends Node {
  static childKeys = ['name', 'value', 'important'] as const;

  type = 'Declaration' as const;
  name: string | Node;
  value: string | Node | (string | Node)[];
  important: boolean | string;
  fieldSpans?: number[];
  valueSpans?: number[];
}
```

Rules:

- `fieldSpans` is keyed by direct field order from `childKeys`.
- `valueSpans` or another field-specific table is keyed by array index inside
  an array-backed field.
- Do not add `raw*`, `valueNode`, `Progressive*`, or `Structural*` node variants.
- Do not create a generic `{ field, start, end, hydrated }` object unless a
  measured caller proves node-owned packed state is worse.

## Next Implementation Slices

1. Keep `@jesscss/parser` green with only scanner/source/runtime primitives.
2. Keep `@jesscss/css-parser` green with AST-shaped scanner-first tests only.
3. Move Less parser proof tests onto the same AST-shaped model.
4. Expand Less parsing slice by slice until Chevrotain productions can be
   replaced for that slice.
5. Only after CSS/Less parsing is stable, revisit late field hydration,
   visitors, and editor-only broad-scan artifacts.

## Review Questions

Every new parser object must answer:

1. Why can this not be a real core AST node with string/direct fields?
2. Why can deferred state not live on the owning AST node?
3. Does this allocate during the cheap parse path?
4. Is object identity required by a real caller?
5. Can a paused debugger user understand the parse result without a side service?
6. Which test proves the object is required for correct CSS/Less output?
