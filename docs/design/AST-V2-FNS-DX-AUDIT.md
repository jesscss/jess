# AST v2 and `@jesscss/fns` naming/DX audit

Status: audit/recommendations, no implementation.

Context: this audit compares the current canonical AST v2 and `packages/fns`
usage against Less 4.x tree naming, the public CSS/Less CST surface, and the
newer value-domain API. Deviation is acceptable when it improves Jess UX/DX or
fixes poor Less semantics.

## Executive summary

The value-domain direction is mostly right. Modern `packages/fns` code imports
from `@jesscss/core/value`, reads typed value objects, and avoids legacy tree
materialization. Those fields mostly have good DX:

- `Dimension.number`/`unit` is better than Less 4.x `Dimension.value` plus a
  mutable `Unit` object.
- `Color.rgb`/`hsl`/`alpha`/`format` is close to Less 4.x where useful and more
  explicit where Sass/Jess need exact source-format preservation.
- `Quoted.value`/`quote`/`escaped` follows Less 4.x and is friendly.
- `List.value` follows the repo rule that a single payload should be `.value`.
- `Collection.entries` in the value domain is the right map model.

The problematic parts are the straddling surfaces:

1. Sass map functions in `packages/fns/src/sass/map/*.ts` still use legacy tree
   classes from `@jesscss/core`: `Collection.rules`, `Declaration`, `Node`,
   `Any`, `List`, `Bool`, `Nil`, `N.*`, and `isNode`.
2. AST v2 `Collection` still stores `(Declaration | VariableDeclaration)[]`,
   while the value domain has the better `CollectionEntry { key, value }`.
3. A few AST/value field names are unnecessarily awkward for visitors and
   function authors: `MixinDef`, mixed `body`/`rules` container fields,
   `Block.inner`, `Important.inner`, `Color.node`, selector payload fields that
   should be `.value`, and abbreviated `comb`.

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

## Unnecessary or harmful deviations

### `Collection` is split-brained

Current AST v2:

- `packages/core/src/ast/nodes.ts` has `Collection.entries:
  (Declaration | VariableDeclaration)[]`.
- `collection()` accepts `Declaration[]`.
- `classifyValueBlock()` promotes a variable-declaration-only block to
  `Collection`.

Current value domain:

- `packages/core/src/ast/value-eval.ts` has
  `CollectionEntry { key: ValueGroup, value: ValueGroup }`.
- `Collection.entries` is `readonly CollectionEntry[]`.
- `packages/core/src/ast/value-collection.ts` owns key lookup through
  `collectionKeyIndex()` and value equality.

Recommendation: fix this split and converge AST v2 on `CollectionEntry`.

This is a high-priority architectural fix, not a cosmetic rename. Entries are
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

- They import legacy tree classes from `@jesscss/core`, not
  `@jesscss/core/value`.
- They inspect `map.rules` and filter `Declaration` nodes.
- They compare keys with `String(key.valueOf())`, not Sass/Jess value equality.
- They allocate tree nodes (`new Declaration`, `new Collection`, `new List`,
  `new Bool`, `new Nil`, `new Any`) inside a package that should live on the
  value-domain function contract.
- `set.ts` contains explicit `any` pressure around property-shaped keys, which
  is exactly what `CollectionEntry.key` avoids.

Recommendation: port the Sass map module to value-domain `Fn`s.

Use `Collection.entries`, `makeCollection`, `makeList`, `makeBool`, a shared
`NIL` constructor/constant, and `collectionKeyIndex()`. This should delete the
string-key declaration shim and make map functions naturally line up with Sass
semantics.

### `Color.node` is bad field DX

Value-domain `Color.node` means "original literal/source spelling"; it is not a
node. Fns read it in color helpers, for example Less alpha/hex preservation and
named-color handling.

Recommendation: rename to `src`.

`src` lines up with AST authored leaves and makes the old meaning honest: this
field is the optional authored source spelling. It was historically able to hold
an actual AST node, but the current value-domain field should not imply that.
Prefer one field and migrate callers; avoid keeping long-lived aliases.

### Single-payload wrappers use `inner`

AST and value-domain `Block` use `inner`; AST `Important` uses `inner`. Less
4.x `Paren` uses `value`, and the repo's AST contract says single-payload nodes
should expose that payload as `.value`.

Recommendation: rename:

- `Block.inner` -> `Block.value`
- `Important.inner` -> `Important.value`

The delimiter/importance fields already carry the extra metadata. The payload
should be `.value` for visitor and function-author DX.

### `MixinDef` is an unnecessary abbreviation

Less 4.x and the Less grammar use `MixinDefinition`; AST v2 uses `MixinDef`.
The abbreviation saves little and leaks into visitor hook names.

Recommendation: rename `MixinDef` -> `MixinDefinition`.

The factory can stay `mixinDef()` if desired, but the node type should be the
clear public shape. A Less bridge can then map it directly.

### Statement containers should align on `.rules`

AST v2 currently mixes `body`, `children`, and `rules` for statement containers.
That makes visitors and Less-compat facades carry avoidable special cases.

Recommendation: align statement-container payloads on `.rules`.

This is not a new convention: AST v1 already established it. `For.rules` is
already the preferred direction. Other block-like canonical nodes should move
toward `.rules` rather than renaming `For.rules` to `body`.

### `Rule` is ambiguous

AST v2 `Rule` means a selector-qualified CSS rule. It deviates from:

- Less 4.x `Ruleset`
- CSS/Less CST public `QualifiedRule`

Recommendation: rename canonical AST `Rule` to `Ruleset`.

`Ruleset` is legitimate CSS terminology and is more intuitive than `QualifiedRule`
for the canonical AST. `QualifiedRule` can remain the CST-facing CSS term. The
important part is removing generic `Rule`, which gets confusing around lint
rules, `rules` arrays, rule bodies, and visitor hook names.

### Selector payloads should use `.value`

Current shapes:

- `CompoundSelector.simples`
- `ComplexSegment.comb`
- `PathSeg.comb`
- `ComplexSelector.head` / `tail`
- no explicit `RelativeSelector` node in AST v2, though the shape is distinct

Recommendation:

- `CompoundSelector.simples` -> `CompoundSelector.value`
- `ComplexSelector.head` / `tail` -> `ComplexSelector.value`
- add/keep `RelativeSelector` as the relative-selector counterpart when that
  authored shape matters
- keep combinators as primitive string values inside the selector sequence; do
  not introduce a full object wrapper just to carry a combinator

The stronger rule is the repo's existing single-payload convention: when a node
has one semantic payload, that field should be `.value`. Selector nodes should
not invent local payload names per type. `comb` is also just an avoidable
abbreviation in the current implementation; the canonical sequence should carry
the combinator string directly.

The intended selector shapes are sequence-shaped:

- `ComplexSelector.value` is exactly `[selector, combinator, selector,
  combinator, selector, ...]`: always starts and ends with a selector term.
- `RelativeSelector.value` is exactly `[combinator, selector, combinator,
  selector, ...]`: same alternation, but always starts with a combinator string.

That is clearer than `head`/`tail`, preserves the authored selector grammar
shape, and gives visitors one payload field to traverse.

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

### `List.sep` is acceptable

Both AST and value-domain lists use `sep`. It is compact, already consistent,
and clear enough as a separator fact.

Recommendation: keep `List.sep` unless later public API feedback shows it is a
real authoring problem. Do not spend rename budget here while higher-value AST
shape fixes are pending.

## Recommended change list

### P0: Fix map semantics before expanding visitor consumers

1. Port `packages/fns/src/sass/map/*` to `@jesscss/core/value`.
2. Use `Collection.entries` and `collectionKeyIndex()` for value-equality keys.
3. Replace legacy tree results with value-domain constructors.
4. Add tests for typed keys: quoted vs unquoted string equality, numeric keys,
   color keys, nested maps, replacement order, and list-of-pairs behavior.

### P0: Fix split-brained `Collection`

1. Add AST `CollectionEntry { key: ValueSlot, value: ValueSlot, variable?,
   important? }`.
2. Retype AST `Collection.entries` away from declarations.
3. Split "collection as map data" from "nested property structure" at the
   consumer sites that currently rely on `Declaration`.
4. Update traversal edge ownership so collection entries expose key and value
   edges, not a fake declaration node.

### P1: Clean node and field names that affect visitation

1. Rename `MixinDef` to `MixinDefinition`.
2. Align statement-container payload fields on `.rules`.
3. Rename `Block.inner` and `Important.inner` to `.value`.
4. Rename AST `Rule` to `Ruleset`.
5. Rename selector single-payload fields to `.value`; do not keep
   `CompoundSelector.simples`.
6. Model `ComplexSelector.value` as alternating selector-term/combinator-string
   pieces and `RelativeSelector.value` as the same sequence starting with a
   combinator string.
7. Keep combinators as primitive strings, not `{ combinator }` wrapper objects.
8. Preserve simple selector terms directly: `.a > .b` should have
   `BasicSelector` terms on each side of the combinator, not synthetic one-item
   compounds.
9. Apply the no-aggressive-wrapping rule generally: do not introduce
   single-element arrays or one-child wrapper nodes without authored structure
   that justifies them.

### P1: Rename misleading value fields

1. Rename value-domain `Color.node` to `src`.
2. Audit docs/tests for "node" meaning "source spelling".
3. Keep `bytes` as canonical emitted bytes and avoid overloading it with source.

### P2: Public function-author ergonomics

1. Document the AST-vs-value lane split: AST leaves have `src`, value objects
   have `bytes`.
2. Keep legacy Less field names in the compatibility facade, not the canonical
   AST, when Less semantics are worse.

## Non-recommendations

- Do not add `Element` to canonical AST.
- Do not move fns back to legacy tree classes for Less parity.
- Do not compare map keys by rendered strings.
- Do not preserve declarations as map entries for convenience.
- Do not add visitor-only aliases that hide bad field names; fix the canonical
  shape while AST v2 is still movable.
