# Collections are value-keyed maps — `CollectionEntry`

Design of record for ledger rows **P14** (value-keyed, data-only collections) and
**P15** (subscript type decides). The sigil half of the same conversation, **P13**
(`${…}`), is landed; this half is not, and this document says exactly why and what
it costs.

## The ruling

A Collection is a **value-keyed map that holds data only**.

```jess
$m: {
  small: 4px;      // key = the STRING "small"
  [1px]: a;        // key = the NUMBER 1px
  [red]: b;        // key = the COLOR
}
```

- **Keys are values**, matched by **value equality**. This follows Sass, where
  `map.get($m, 1px)` must match the number `1px` and not the text `"1px"`.
- **Computed `[expr]:` keys are collection-only.** A CSS property name can never be
  a computed expression, so `[expr]:` must not leak into declarations generally.
- **Entries are a distinct node**, `CollectionEntry { key, value }` — both value
  slots — not `Declaration` / `VariableDeclaration`.
- **No variable declarations inside a Collection.** Collection = data,
  AnonymousMixin = code.
- **Lookups just take a value**: `$foo[1px]`, `$foo[red]`, `$foo[$k]`. No new
  syntax.
- **A numeric subscript is always positional** (P15), so numeric keys are not
  reachable by bracket; `map.get($m, 1px)` is their accessor.

## Why the node has to change

`Declaration.name` is `string | Interpolation`. That type is the defect: a key's
type is destroyed at parse, and the only way to get it back is to sniff the bytes —
which is a direct violation of *parser owns structure, core never re-derives from
bytes*.

Moving entries off `Declaration` removes the loss entirely. `1` parses to a
`Dimension` and `"1"` to a `Quoted`; the key type is then carried structurally by
construction. **No normalisation or sniffing may be added to recover it** — there
is nothing to recover.

The same argument settles the subscript question: "is `$x[1]` a position or a
key?" is answered by the node type of the subscript, not by inspecting bytes.

## Why it did not land with `${…}`

`Collection.entries` is currently typed `(Declaration | VariableDeclaration)[]`,
i.e. **`Statement[]`**, and that is load-bearing: a Collection's entries are fed
straight into the ordinary statement machinery. Retyping them to a non-`Statement`
`CollectionEntry[]` breaks every one of those paths, each of which needs its own
Collection-specific branch:

| Site | What it does with entries today |
|---|---|
| `packages/core/src/ast/nodes.ts` `valueBlockBody` | returns `Collection.entries` **as `Statement[]`** — the single seam every consumer below goes through |
| `packages/core/src/ast/nodes.ts` `classifyValueBlock` | promotes a block to a Collection iff **every** statement is a `VariableDeclaration` — precisely the promotion P14 inverts |
| `packages/core/src/ast/serialize.ts` `evalToDeclMap` | builds `byProp` / `byVar` as `Map<string, …>` keyed by **byte-serialized names** |
| `packages/core/src/ast/serialize.ts` `resolveBaseDeclMap` | routes a Collection base through `resolveForRuleset` → `evalToDeclMap` |
| `packages/core/src/ast/serialize.ts` `collectionBytes` | branches on `entry.type === 'Declaration'` vs a `@`-sigil variable entry |
| `packages/core/src/ast/serialize.ts` `collectNestedProperty` | the SCSS nested-property role, which reads `Declaration` `name`/`merge`/`important` |
| `packages/core/src/ast/serialize.ts` (≈8 `valueBlockBody` call sites) | detached-ruleset call, `$for` iteration, source-owner resolution, lambda bodies |
| `packages/scss-parser/src/ast/grammar.ts` (2 sites) | SCSS map literals and nested properties |
| `packages/less-parser/src/ast/grammar.ts` | the sole `classifyValueBlock` caller |
| `packages/jess-parser/src/ast/grammar.ts` | `DirectJessCollectionEntry` / `DirectJessCollection` |

Two further facts make this its own landing rather than a rider:

1. **The lookup machinery is byte-keyed strings end to end.** `DeclMap` is
   `Map<string, DeclEntry>`. Value-equality keys are not a parser change at all at
   that layer — they are a value-domain change, which is exactly what the
   `core-value-domain-map` branch is building (`ValueObj` gains an ordered-entry
   `Collection` whose `key` is deliberately wider than the parser can produce).
   Landing a second, parser-side redefinition of the same node concurrently would
   collide.
2. **Inverting `classifyValueBlock` moves Less output.** Every Less detached
   ruleset that declares variables (`@dr: { @a: 1 }`) currently becomes a
   Collection and serializes through `collectionBytes`; after the inversion it is
   an AnonymousMixin. That is a render-visible change to the Less corpus and needs
   its own byte-identity pass.

## The two-role model still holds

A `Collection` is selected by POSITION, and that does not change:

- **value / argument position** → **data**; serializes as `{ a: 1; b: 2 }`
- **property root** → **structure**; expands to hyphenated declarations
  (`font: 20px { family: serif }`)
- **custom property** → **data** (the carve-out: `--foo-a` bears no CSS-defined
  relationship to `--foo`)

The nested-property role is why the ripple is wide: it is the one place that
currently *depends* on entries being `Declaration`s, for `merge` and `important`.
Under `CollectionEntry` its key becomes a `Keyword` holding the leaf property name
and the carrier flags move onto the entry.

## Landing order

1. **Value domain first** — let `core-value-domain-map` land its `CollectionEntry`
   projection and value-equality keying. The parser change is what lets it receive
   real typed keys instead of sniffing, so it wants a receiver that already exists.
2. **`CollectionEntry` in the AST** — retype `Collection.entries`, give each
   consumer above its Collection branch, keep `valueBlockBody` honest by splitting
   the data path from the statement path.
3. **`[expr]` keys in `.jess`** — extend `DirectJessCollectionEntry` with a
   bracketed value key. Collection-only; it must not reach `CssAstSyntaxProperty`.
4. **Invert the less-parser promotion** — `classifyValueBlock` stops promoting;
   a var-declaring block stays an AnonymousMixin, and the `variable` round-trip
   flag dies. Gate on Less byte-identity.

Steps 3 and 4 both move output and are the ones to report before landing.
