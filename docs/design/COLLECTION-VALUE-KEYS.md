# Collections are value-keyed maps — `CollectionEntry`

Design of record for ledger rows **P14** (value-keyed, data-only collections) and
**P15** (subscript type decides). The AST/value-domain `CollectionEntry` model,
computed keys, and ordered shallow spreads are implemented.

## The ruling

A Collection is a **value-keyed map that holds data only**.

```jess
$m: {
  small: 4px;      // key = the KEYWORD "small"
  [1px]: a;        // key = the NUMBER 1px
  [#c6538c]: b;    // key = the COLOR #c6538c
  [$key]: c;       // key = the current VALUE of $key
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
- **Key lookups take a nonnumeric value**: `$foo[red]`, `$foo[$k]`. Numeric
  subscripts are positional under P15, so numeric keys use `map.get($foo, 1px)`.
- **A numeric subscript is always positional** (P15), so numeric keys are not
  reachable by bracket; `map.get($m, 1px)` is their accessor.

Bare words remain keywords. In particular, `red:` and `[red]:` are two
spellings of the same Keyword key. Jess only resolves a named color when an
operation requires a color value; use an authored color such as `[#c6538c]:`
when the key itself must be a Color.

## Ordered overlays

Collection spread is a shallow, left-to-right overlay:

```jess
$theme: {
  ...$defaults;
  ...$brand;
  radius: 6px;
}
```

Every spread operand must evaluate to a Collection. Existing keys retain their
original position and receive the later value; new keys append. The same rule
applies to explicit duplicates, so `{ a: 1; a: 2; }` evaluates as `{ a: 2; }`.
This is necessary for a dynamic spread to compose predictably with the entries
around it.

The `jess/no-duplicate-collection-keys` diagnostic warns when two explicit keys
in one literal are statically provable as equal. It does not reject the source,
and it does not guess about computed expressions or spread contents.

Spread is deliberately shallow. Recursive merging uses the Sass map function:

```jess
@-use '#sass/map' as map;
$theme: $map.deep-merge($defaults, $overrides);
```

The function is exported by `@jesscss/fns/sass/map`; Jess module at-rules still
only parse and round-trip today, so the `@-use` example records the formal module
shape rather than claiming that the resolver is already wired.

## `foo:` and `["foo"]:` are the SAME key

```jess
{
  foo: bar;
  ["foo"]: bar;    // identical key
}
```

A quoted key and a bare Keyword compare equal, so `$["foo"]` and `$[foo]`
resolve the same entry. The current AST still retains a `Quoted` node; P14's
plain-string storage and serialization normalization is a separate, recorded
piece of work and is not claimed as implemented here.

That remaining normalization has two consequences:

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

Until that work lands, authored quoting can still appear in collection output;
map equality does not depend on that retained spelling.

## Why the node has to change

`Declaration.name` is `string | Interpolation`. That type is the defect: a key's
type is destroyed at parse, and the only way to get it back is to sniff the bytes —
which is a direct violation of *parser owns structure, core never re-derives from
bytes*.

Moving entries off `Declaration` removes the loss entirely. `1` parses to a
`Dimension` and `"1"` to a `Quoted`; the key type is then carried structurally by
construction. **No normalisation or sniffing may be added to recover it** — there
is nothing to recover.

The same argument settles the subscript question: "is `$x[0]` a position or a
key?" is answered by the node type of the subscript, not by inspecting bytes;
Jess positions are zero-based.

## Implementation notes

This originally did not land with `${…}` because `Collection.entries` was typed
as `(Declaration | VariableDeclaration)[]`, i.e. **`Statement[]`**, and those
entries were fed straight into ordinary statement machinery. Retyping them to
non-`Statement` `CollectionItem[]` (`CollectionEntry | CollectionSpread`)
required each of these sites to get a real Collection-specific branch. The
evaluated value-domain Collection remains entry-only `CollectionEntry[]` because
spreads have already been folded there.

| Site | Former dependency |
|---|---|
| `packages/core/src/ast/nodes.ts` `valueBlockBody` | returns `Collection.entries` **as `Statement[]`** — the single seam every consumer below goes through |
| `packages/core/src/ast/nodes.ts` `classifyValueBlock` | promotes a block to a Collection iff **every** statement is a `VariableDeclaration` — precisely the promotion P14 inverts |
| `packages/core/src/ast/serialize.ts` `valueCollectionToDeclMap` | indexes effective typed entries for member lookup without reducing key identity to bytes |
| `packages/core/src/ast/serialize.ts` `resolveBaseDeclMap` | evaluates a Collection once, then indexes its effective typed entries for member lookup |
| `packages/core/src/ast/serialize-value.ts` | serializes effective value-domain entries after spreads and duplicate keys have been folded |
| `packages/core/src/ast/serialize.ts` `collectNestedProperty` | expands the distinct SCSS `NestedPropertyBlock` structure |
| `packages/core/src/ast/serialize.ts` (≈8 `valueBlockBody` call sites) | detached-ruleset call, `$for` iteration, source-owner resolution, lambda bodies |
| `packages/syntax/scss/scss-parser/src/grammar.ts` | SCSS map literals and nested properties |
| `packages/syntax/less/less-parser/src/grammar.ts` | the sole `classifyValueBlock` caller |
| `packages/syntax/jess/jess-parser/src/grammar.ts` | Jess collection entry and spread grammar |

Two further facts made this its own landing rather than a rider:

1. **The lookup machinery is byte-keyed strings end to end.** `DeclMap` is
   `Map<string, DeclEntry>`. Value-equality keys are not a parser change at all at
   that layer — they are a value-domain change, which is exactly what the
   `core-value-domain-map` branch is building (`Value`/`ValueGroup` gain an ordered-entry
   `Collection` whose `key` is deliberately wider than the parser can produce).
   Landing a second, parser-side redefinition of the same node concurrently would
   collide.
2. **`classifyValueBlock` is no longer a promotion heuristic.** A Less detached
   ruleset that declares variables (`@dr: { @a: 1 }`) remains an executable
   `AnonymousMixin`; only the Sass and Jess collection grammars construct data
   `Collection` nodes.

## Data and nested-property structure are distinct

A `Collection` is always data and serializes as `{ a: 1; b: 2 }`, regardless of
where the value appears. SCSS property-root structure is parser-owned and uses a
distinct `NestedPropertyBlock`, which expands to hyphenated declarations such as
`font-family`. A custom-property value remains ordinary data because `--foo-a`
has no CSS-defined relationship to `--foo`.

`NestedPropertyBlock` retains leaf `CollectionEntry` records because nested
properties still need entry `merge` and `important` facts. Position no longer
changes a Collection's meaning; the parser selects the structural node directly.

## Landed order

1. **Value domain first** — the `@jesscss/core` semantic value API owns ordered
   `CollectionEntry` projection and value-equality keying.
2. **Collection items in the AST** — `Collection.entries` is `CollectionItem[]`,
   consumers have Collection branches, and `valueBlockBody` is honest: it only
   accepts executable `AnonymousMixin` value blocks.
3. **`[expr]` keys and `...value;` spreads in `.jess`** — Jess collection
   entries admit bracketed value keys and ordered shallow overlays.
   Collection-only; neither form reaches CSS property names.
4. **Less value-block classification** — Less `{ ... }` values remain executable
   `AnonymousMixin` blocks. Jess parses collections through its explicit entry
   grammar instead of sniffing statement blocks.

The canonical Jess/SCSS map AST is data-only `CollectionItem` records; its
evaluated value-domain form contains effective `CollectionEntry` records only.
SCSS nested-property structure is a `NestedPropertyBlock`.
