# AST v2 and `@jesscss/fns` naming/DX audit

Status: audit/recommendations plus implementation tranche.

Implemented in `codex/ast-v2-dx-fns`:

- AST v2 `Collection.entries` now uses `CollectionEntry { key, value }`.
- Jess collection literals parse through a dedicated entry grammar; explicit
  `@{ ... }` remains the anonymous-mixin/callable spelling.
- SCSS map keys preserve typed authored shape instead of squeezing through
  declaration names.
- Sass map functions in `packages/fns` use the value-domain map API.
- Literal colors use `Color.src` for authored source spelling instead of the old
  misleading `Color.node` name.
- Single-payload wrappers use `.value` for `Block`, `Important`,
  `CompoundSelector`, and `ComplexSelector`.
- Canonical selector construction uses `term`/`combinator` at construction
  boundaries and emits flat `ComplexSelector.value` sequences.
- The canonical AST uses `Ruleset` and `MixinDefinition`; no compatibility alias
  is being preserved for older accidental names.
- SCSS nested-property grammar labels are internal construction labels, now
  `NestedPropertyDeclaration` / `NestedPropertyMember`, not public
  `Static...Leaf`-style names.
- Statement containers now align on `.rules`; function definitions still use
  `body` for executable callbacks because they are not AST statement containers.
- Canonical authored traversal is exported from `@jesscss/core/ast`, with
  explicit ruleset/value/selector/guard edges and no diagnostics-local object
  crawls.
- `@jesscss/core` no longer re-exports old tree helpers/utilities from its root
  package entrypoint.
- Relative selectors are first-class `RelativeSelector` branches; the former
  leading-combinator side field is gone, and parser tests assert relative
  selectors only in valid contexts.
- Sass global `str-length` is exported from the Sass dialect index and therefore
  participates in the derived Sass registry.
- `defineFunction` authoring now uses `type: 'Color'` /
  `type: ['Keyword', 'Quoted']` style parameter declarations. `kinds` remains
  accepted only as a deprecated compatibility spelling.
- `@jesscss/core` root exports the value-domain function authoring API
  (`Value`, `Color`, `Dimension`, `defineFunction`, `createFnRegistry`, and
  related types) so fns and plugin authors do not need a `/value` escape hatch.
- Function bodies receive typed semantic value nodes at the author boundary,
  not parser literals, raw source strings, or old tree classes.

Still recommended, not implemented here: continue deleting old tree internals
rather than treating them as protected API. The exception is evidence-based
Less/plugin compatibility: if published Less visitors or plugin functions
actually use `instanceof`, constructors, or prototype methods, a lazy
compatibility facade may be justified for that observed shape. Jess v2 should
not resurrect tree classes speculatively.

Context: this audit compares the current canonical AST v2 and `packages/fns`
usage against Less 4.x tree naming, the public CSS/Less CST surface, and the
newer value-domain API. Deviation is acceptable when it improves Jess UX/DX or
fixes poor Less semantics.

## Executive summary

The value-domain direction is mostly right. Modern `packages/fns` code imports
from `@jesscss/core`, reads typed value objects, and avoids legacy tree
materialization. Those fields mostly have good DX:

- `Dimension.number`/`unit` is better than Less 4.x `Dimension.value` plus a
  mutable `Unit` object.
- `Color.rgb`/`hsl`/`alpha`/`format` is close to Less 4.x where useful and more
  explicit where Sass/Jess need exact source-format preservation.
- `Quoted.value`/`quote`/`escaped` follows Less 4.x and is friendly.
- `List.value` follows the repo rule that a single payload should be `.value`.
- `Collection.entries` in the value domain is the right map model.

The remaining problematic parts are the straddling/runtime surfaces: old tree
internals and future visitor/facade needs. Accidental labels are not protected
API during the AST v2 cutover. Compatibility facades are a demand-driven bridge,
not the canonical model.

## What should intentionally deviate from Less 4.x

### Keep no `Element`

Less 4.x `Element` is a poor semantic unit. AST v2's selector split into
`SelectorList`, `ComplexSelector`, `CompoundSelector`, `SimpleSelector`, and
`PseudoSelector` is a good deviation and lines up better with CSS concepts and
the CST surface. A Less visitor bridge can lazily expose Less-shaped `Element`s
for compatibility, but canonical AST should not adopt it.

### Keep `FunctionCall` over Less `Call`

Less 4.x `Call` is short but ambiguous. AST v2 has `FunctionCall`, `MixinCall`,
and reference `Call` steps. Keeping the main value node as `FunctionCall` is good
DX because it tells authors which call space they are in. The Less visitor bridge
can map `FunctionCall` to `Call`.

### Keep `AnonymousMixin`

Less 4.x calls this area `DetachedRuleset`, but the canonical distinction is
better: `Collection` is data and `AnonymousMixin` is code. That name applies the
right design pressure to map/function work. The Less bridge can expose a
`DetachedRuleset` facade lazily.

### Keep typed literals with `src`

AST literal nodes reuse value-domain type strings (`Dimension`, `Color`,
`Quoted`, `Keyword`) but carry authored spelling in `src`; value-domain objects
carry canonical `bytes`. That split is worth keeping. It lets diagnostics and
the language service read authored facts without forcing value materialization.

### Function authors receive semantic value nodes

Jess functions should feel like old Jess tree functions and useful Less 4.x
functions in the place that matters: a declared color parameter arrives as a
`Color`, a declared dimension parameter arrives as a `Dimension`, and so on.
They should not receive parser leaves with only `src`, nor raw strings that make
each function re-parse the same value.

Implemented recommendation: public function specs use `type`, not `kinds`.

Examples:

```ts
defineFunction('lightness', {
  params: [{ name: 'color', type: 'Color' }] as const,
  body: color => makeDimension(colorHsl(color).l, '%')
});

defineFunction('str-index', {
  params: [
    { name: 'string', type: ['Keyword', 'Quoted'] },
    { name: 'substring', type: ['Keyword', 'Quoted'] }
  ] as const,
  body: (string, substring) => ...
});
```

`kinds` is accepted only as a deprecated spelling for compatibility with the
first value-domain fn API. It should not appear in new fns.

This is the materialization boundary: parsed literals may stay cheap internally,
but once a function, visitor, plugin bridge, diagnostic typed-value rule, or
language-service semantic fact asks for a typed value, Jess materializes the
semantic value node before user code observes it. This slice does not decide a
cache location for materialized values. A future reviewed design can choose
between node-local caching, a side table, or no cache based on eval/render
pressure; do not add an ad-hoc cache in a function or visitor helper.

Public naming:

- `Value` is the typed scalar value union (`Color | Dimension | ...`).
- `ValueGroup` is the structural value carrier (`Value` or nested groups).
- `EvalValue` is the internal lane that may still hold inert literal bytes.
- `ValueObj` is not public API and should disappear from author docs.

## Unnecessary or harmful deviations

### `Collection` is split-brained

Prior AST v2:

- `packages/core/src/ast/nodes.ts` had `Collection.entries:
  (Declaration | VariableDeclaration)[]`.
- `collection()` accepted `Declaration[]`.
- `classifyValueBlock()` promoted a variable-declaration-only block to
  `Collection` by keeping variable declarations as entries.

Current value domain:

- `packages/core/src/ast/value-eval.ts` has
  `CollectionEntry { key: ValueGroup, value: ValueGroup }`.
- `Collection.entries` is `readonly CollectionEntry[]`.
- `packages/core/src/ast/value-collection.ts` owns key lookup through
  `collectionKeyIndex()` and value equality.

Implemented recommendation: fix this split and converge AST v2 on
`CollectionEntry`.

This was a high-priority architectural fix, not a cosmetic rename. Entries are
not declarations. A map key is a value, not a CSS property name; squeezing it
through `Declaration.name: string | Interpolation` destroys the authored key
type and forces consumers to recover meaning from bytes. This directly affects
fns, visitation, Sass map parity, and language-service facts.

### Sass map fns use the wrong model

Files:

- `packages/fns/src/sass/map/get.ts`
- `packages/fns/src/sass/map/has-key.ts`
- `packages/fns/src/sass/map/keys.ts`
- `packages/fns/src/sass/map/merge.ts`
- `packages/fns/src/sass/map/remove.ts`
- `packages/fns/src/sass/map/set.ts`
- `packages/fns/src/sass/map/values.ts`

Problems:

- They import legacy tree classes from `@jesscss/core`, not the value-domain
  API.
- They inspect `map.rules` and filter `Declaration` nodes.
- They compare keys with `String(key.valueOf())`, not Sass/Jess value equality.
- They allocate tree nodes (`new Declaration`, `new Collection`, `new List`,
  `new Bool`, `new Nil`, `new Any`) inside a package that should live on the
  value-domain function contract.
- `set.ts` contains explicit `any` pressure around property-shaped keys, which
  is exactly what `CollectionEntry.key` avoids.

Implemented recommendation: port the Sass map module to value-domain `Fn`s.

Use `Collection.entries`, `makeCollection`, `makeList`, `makeBool`, a shared
`NIL` constructor/constant, and `collectionKeyIndex()`. This should delete the
string-key declaration shim and make map functions naturally line up with Sass
semantics.

### `Color.node` was bad field DX

Former value-domain `Color.node` meant "original literal/source spelling"; it
was not a node. Fns read it in color helpers, for example Less alpha/hex
preservation and named-color handling.

Implemented recommendation: rename to `src`.

`src` lines up with AST authored leaves and makes the old meaning honest: this
field is the optional authored source spelling. It was historically able to hold
an actual AST node, but the current value-domain field should not imply that.
Prefer one field and migrate callers; do not keep a compatibility alias solely
because the old name existed.

### Single-payload wrappers use `.value`

AST and value-domain `Block` use `.value`; AST `Important` uses `.value`. Less
4.x `Paren` uses `value`, and the repo's AST contract says single-payload nodes
should expose that payload as `.value`.

Implemented recommendation:

- `Block.value`
- `Important.value`

The delimiter/importance fields already carry the extra metadata. The payload
should be `.value` for visitor and function-author DX.

### `MixinDefinition` is the right canonical name

Less 4.x and the Less grammar use `MixinDefinition`; AST v2 should use the same
clear name. Shorter construction helpers can exist for ergonomics, but the node
type should not abbreviate the concept.

Current state: the canonical node is `MixinDefinition`.

The factory can stay `mixinDef()` if desired, but the node type should be the
clear public shape. A Less bridge can then map it directly.

### Statement containers should align on `.rules`

Prior AST v2 mixed `body`, `children`, and `rules` for statement containers.
That made visitors and Less-compat facades carry avoidable special cases.

Implemented recommendation: align statement-container payloads on `.rules`.

This is not a new convention: AST v1 already established it. `For.rules` is
already the preferred direction. Other block-like canonical nodes should move
toward `.rules` rather than renaming `For.rules` to `body`.

### `Ruleset` is the right canonical name

The canonical AST node for a selector-qualified CSS rule should be `Ruleset`.
That matches Less 4.x and legitimate CSS terminology better than a generic
`Rule` name, while `QualifiedRule` can remain the CST-facing CSS term.

Current state: the canonical node is `Ruleset`.

The important part is avoiding a generic `Rule` node name, which gets confusing
around lint rules, `rules` arrays, rule bodies, and visitor hook names.

### Selector payloads should use `.value`

Prior shapes:

- `CompoundSelector.simples`
- `PathSeg.comb`
- `ComplexSelector.head` / `tail`
- no explicit `RelativeSelector` node in AST v2, though the shape is distinct

Implemented recommendation:

- `CompoundSelector.value`
- `ComplexSelector.value`
- `PathSeg.combinator` / `PathSeg.selector`
- construction helpers accept `term` and `combinator`, then emit flat canonical
  selector values

Remaining recommendation:

- add/keep `RelativeSelector` as the relative-selector counterpart when that
  authored shape matters
- keep combinators as primitive string values inside the selector sequence; do
  not introduce a full object wrapper just to carry a combinator

The stronger rule is the repo's existing single-payload convention: when a node
has one semantic payload, that field should be `.value`. Selector nodes should
not invent local payload names per type. `comb` was also just an avoidable
abbreviation; construction boundaries now spell it `combinator`, while the
canonical selector sequence carries the combinator string directly.

The intended selector shapes are sequence-shaped:

- `ComplexSelector.value` is exactly `[selector, combinator, selector,
  combinator, selector, ...]`: always starts and ends with a selector term.
- `RelativeSelector.value` is exactly `[combinator, selector, combinator,
  selector, ...]`: same alternation, but always starts with a combinator string.

That is clearer than `head`/`tail`, preserves the authored selector grammar
shape, and gives visitors one payload field to traverse.

The selector-list branch domain should be `SelectorTerm | ComplexSelector |
RelativeSelector`. A branch with no combinator is a selector term directly. A
`ComplexSelector` must contain at least one combinator. A `RelativeSelector`
must contain its leading combinator and at least one selector term. A
`CompoundSelector` must contain multiple adjacent simple selector tokens.
One-term complex selectors and one-item compounds are illegal parser outputs,
not shapes to reject at runtime.

The selector term in those sequences is not necessarily a
`CompoundSelector`. A `SimpleSelector` can occupy that position directly when
the authored shape is simple. The sequence type should express that directly,
for example as `SelectorTerm | Combinator` where `Combinator` is the existing
string union, not an object wrapper.

Parser reductions should preserve that simplicity. For example, `.a > .b`
should parse as a `ComplexSelector` whose value is
`[BasicSelector('.a'), '>', BasicSelector('.b')]`, not as a complex selector
with synthetic one-item `CompoundSelector` wrappers at each end. A compound is
only needed when the authored selector term is actually compound, such as
`.a.b`, `button:hover`, or `&.active`.

This is the general parser principle, not a selector-only preference: do not
aggressively wrap authored facts for implementation convenience. No
single-element arrays or single-child wrapper nodes should appear merely because
an older representation required a uniform container. The parser should emit the
smallest semantic shape the authored grammar justifies.

Parser reductions own those invariants. This is a performance rule as much as a
shape rule. Core nodes should remain dumb and cheap: they trust parser
construction and should not spend hot-path work branching over shape validity.
Use grammar-time decisions, macro-compilable Parseman structure, typed factory
boundaries, and parser AST tests. Diagnostics may optionally audit invalid AST
shapes for tooling, but diagnostics are not the mechanism that makes the
canonical nodes valid.

Leading-combinator selectors also need contextual grammar pressure. They should
not be accepted by a generic selector production and normalized later. Each
dialect should admit relative selectors only in positions where that dialect
allows them, such as nested selector contexts or selector-function arguments
whose grammar permits relative selectors.

### `List.sep` is acceptable

Both AST and value-domain lists use `sep`. It is compact, already consistent,
and clear enough as a separator fact.

Recommendation: keep `List.sep` unless later public API feedback shows it is a
real authoring problem. Do not spend rename budget here while higher-value AST
shape fixes are pending.

## Recommended change list

### Implemented P0: Fix map semantics before expanding visitor consumers

1. Port `packages/fns/src/sass/map/*` to the `@jesscss/core` value-domain API.
2. Use `Collection.entries` and `collectionKeyIndex()` for value-equality keys.
3. Replace legacy tree results with value-domain constructors.
4. Add tests for typed keys: quoted vs unquoted string equality, numeric keys,
   color keys, nested maps, replacement order, and list-of-pairs behavior.

### Implemented P0: Fix split-brained `Collection`

1. Add AST `CollectionEntry { key: ValueSlot, value: ValueSlot, variable?,
   important? }`.
2. Retype AST `Collection.entries` away from declarations.
3. Split "collection as map data" from "nested property structure" at the
   consumer sites that currently rely on `Declaration`.
4. Update traversal edge ownership so collection entries expose key and value
   edges, not a fake declaration node.

### P1: Clean remaining node and field names that affect visitation

1. Decide whether/when to export the internal canonical traversal surface.
2. Model selector-list branches as `SelectorTerm | ComplexSelector |
   RelativeSelector`.
3. Model `ComplexSelector.value` as alternating selector-term/combinator-string
   pieces and `RelativeSelector.value` as the same sequence starting with a
   combinator string where relative selectors become first-class.
4. Require `ComplexSelector` to contain at least one combinator, require
   `RelativeSelector` to contain its leading combinator and at least one selector
   term, and require `CompoundSelector` to contain multiple simple selector
   tokens.
5. Enforce those requirements in parser reductions and parser AST tests, not
   runtime node constructors or eval/render visitors.
6. Audit CSS/Less/SCSS/Jess selector productions so leading-combinator branches
   are accepted only in relative-selector contexts, not globally through generic
   selector parsing.
7. Keep combinators as primitive strings, not `{ combinator }` wrapper objects.
8. Preserve simple selector terms directly: `.a > .b` should have
   `BasicSelector` terms on each side of the combinator, not synthetic one-item
   compounds.
9. Apply the no-aggressive-wrapping rule generally: do not introduce
   single-element arrays or one-child wrapper nodes without authored structure
   that justifies them.

### P1: Finish deleting protected old-tree assumptions

1. Keep old tree utilities off `@jesscss/core` root exports.
2. Move remaining tests that need old tree internals to direct internal imports
   until that test surface is deleted.
3. Delete old tree classes/helpers in coherent follow-up batches instead of
   preserving bridges.
4. Before reintroducing any class/prototype facade for Less visitor or plugin
   compatibility, record corpus evidence in a table: package, version, visitor
   or plugin entrypoint, observed shape (`instanceof`, constructor equality,
   prototype method call, plain property read), and the minimal lazy facade
   needed. Plain property-read compatibility is not evidence that canonical
   Jess nodes should become classes.

### P2: Public function-author ergonomics

1. Document the AST-vs-value lane split: AST leaves have `src`, value objects
   have `bytes`.
2. Prefer `type: 'Color'` / `type: ['Keyword', 'Quoted']` parameter metadata;
   keep `kinds` as deprecated compatibility only.
3. Keep legacy Less field names in the compatibility facade, not the canonical
   AST, when Less semantics are worse.

## Non-recommendations

- Do not add `Element` to canonical AST.
- Do not move fns back to legacy tree classes for Less parity.
- Do not compare map keys by rendered strings.
- Do not preserve declarations as map entries for convenience.
- Do not add visitor-only aliases that hide bad field names; fix the canonical
  shape while AST v2 is still movable.
