# Collections are value-keyed maps — `CollectionEntry`

Design of record for ledger rows **P14** (value-keyed, data-only collections) and
**P15** (subscript type decides). The sigil half of the same conversation, **P13**
(`${…}`), is landed, and the AST/value-domain `CollectionEntry` model described
here has now landed in `codex/ast-v2-dx-fns`.

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

## `foo:` and `["foo"]:` are the SAME key — stored as a plain string

```jess
{
  foo: bar;
  ["foo"]: bar;    // identical key
}
```

A quoted key is stored as a **plain string**, never as a `Quoted` node. The
reasons are symmetry with JS (`{foo: 1}` ≡ `{"foo": 1}`) and reasonability: if
`$["foo"]` resolved differently from `$[foo]`, no author could predict a lookup.
Sass already agrees — it treats `"a"` and `a` as equal map keys.

Two consequences that must be built in from the start, not normalized in later:

1. **Quoting is a SERIALIZATION decision, not a storage one.** A stored string
   that is not a valid identifier — `["foo bar"]` — has to be **re-quoted on
   output**, or the emitted `{ foo bar: 1 }` is garbage. The serializer therefore
   needs an "is this bare-emittable as an identifier?" test. Storing the author's
   quotes to avoid writing that test is the wrong trade: it reintroduces two
   spellings for one key.
2. **The author's original quoting does not round-trip.** SCSS `("a": 1)`
   converts to `a: 1` in `.jess`. That is a formatting change, not a semantic
   one, because Sass considers the two the same key — but it belongs in the
   conversion notes so it is not later reported as data loss.

This also settles a divergence flagged on the value-domain map work:
`nth(("a": 1), 1)` yielding `a 1` where dart-sass yields `"a" 1` is **intended**,
not an artifact of quotes being dropped at parse.

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

## Landing notes

This originally did not land with `${…}` because `Collection.entries` was typed
as `(Declaration | VariableDeclaration)[]`, i.e. **`Statement[]`**, and those
entries were fed straight into ordinary statement machinery. Retyping them to
non-`Statement` `CollectionEntry[]` required each of these sites to get a real
Collection-specific branch:

| Site | Former dependency |
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

Two further facts made this its own landing rather than a rider:

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

## Landed order

1. **Value domain first** — `@jesscss/core/value` owns ordered
   `CollectionEntry` projection and value-equality keying.
2. **`CollectionEntry` in the AST** — `Collection.entries` is retyped, consumers
   have Collection branches, and `valueBlockBody` is honest: it only accepts
   executable `AnonymousMixin` value blocks.
3. **`[expr]` keys in `.jess`** — Jess collection entries admit bracketed value
   keys. Collection-only; they do not reach CSS property names.
4. **Less value-block classification** — Less keeps its deliberate legacy
   heuristic for value-position `{ ... }` detached/data ambiguity; Jess parses
   collections through its explicit entry grammar instead of sniffing statement
   blocks.

Less compatibility remains the only intentional heuristic lane here. The
canonical Jess/SCSS AST collection shape is data-only `CollectionEntry` records.
