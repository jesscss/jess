# @jesscss/scss-parser

An SCSS grammar for Jess, layered on the CSS base parser — **experimental, and not the focus of the Less alpha.**

> **Status: experimental / roadmap.** Part of
> [Jess](https://github.com/jesscss/jess). The current alpha ships through
> `.less`; SCSS is **not a goal of this phase**. This parser is early and exists
> to seed the future **"Sass+"** dialect. Don't rely on it for production;
> prefer [`@jesscss/css-parser`](https://www.npmjs.com/package/@jesscss/css-parser).
> [Report bugs](https://github.com/jesscss/jess/issues); docs live at
> [jesscss.github.io](https://jesscss.github.io/).

## What it is

The SCSS grammar extends the spec-aligned CSS base in `@jesscss/css-parser`:
unchanged CSS structure remains CSS-owned, and SCSS changes only the smallest
child, value slot, or reference its syntax requires. Parseman currently compiles
the CSS and SCSS host factories from shared recognition artifacts rather than
literally composing a terminal CSS grammar artifact; that macro boundary does
not relax the ownership rule. It is built on
[parseman](https://www.npmjs.com/package/parseman) — **the fastest
general-purpose JavaScript parser** in its
[published benchmarks](https://matthew-dean.github.io/parseman/guide/benchmarks)
(see `@jesscss/css-parser` for figures and engineering details).

The current goal is **parse coverage**: the surface `$`-variable / SCSS syntax
should parse into a tree, but not every Sass/SCSS feature is necessarily
*evaluated*. This is the least-mature of the Jess parsers (the `.jess` parser
trails it), and the seed for the roadmap "Sass+" dialect rather than a shipped
Sass replacement. The language roadmap is ordered: **Now Less.js → Next Sass+ →
Final `.jess`.**

Two parser representations are available:

- **Canonical AST v2** — the default `parse()` entry constructs a `Stylesheet`
  directly through parser-local Parseman reductions.
- **Explicit CST** — the `./cst` entry has **no dependency on
  `@jesscss/core`** and parses SCSS source text into a concrete syntax tree for
  language-service/document consumers.

## Install

```sh
npm install @jesscss/scss-parser
```

`@jesscss/core` is an **optional** peer dependency — needed for the default
AST v2 `parse()` entry, not for `./cst` or `./grammar`.
Those explicit entries expose Parseman types and grammar values, so consumers
of them must also provide the package's `parseman` peer.

## Canonical AST parsing

```js
import { parse } from '@jesscss/scss-parser'

const stylesheet = parse('$c: red;\n.foo { color: $c; }')

stylesheet.type // 'Stylesheet'
```

## Standalone usage (core-free)

```js
import { parseScssCst } from '@jesscss/scss-parser/cst'

const result = parseScssCst('$c: red;\n.foo { color: $c; }')

result.ok               // true
result.errors           // ParseError[] (empty when ok)
result.unconsumedFrom   // index of first unparsed char, or null
result.tree             // the CST root (a StyleSheet node)
```

Signature:

```ts
parseScssCst(input: string, startRule = 'Stylesheet', options?: { collapse?: boolean }): ScssCstParseResult
```

Pass a different `startRule` (any capitalized grammar rule) to parse a fragment.

## Public API

| Entry | Export | Purpose |
| --- | --- | --- |
| `@jesscss/scss-parser/cst` | `parseScssCst` | Core-free parse of an SCSS string to a CST. |
| `@jesscss/scss-parser/cst` | `ScssCstNode`, `ScssCstLeaf`, `ScssCstError`, `ScssCstChild`, `ScssCstParseResult`, `ScssCstType` (types) | CST type definitions (aliases of the shared `@jesscss/css-parser/cst` types). |
| `@jesscss/scss-parser/grammar` | `scssGrammar` | The compiled SCSS AST grammar (a rule map). Extend it with `compose()` or drive it directly with parseman's `run`. See the variant table below. |
| `@jesscss/scss-parser` (`.`) | `parse` | Parse SCSS directly to canonical AST v2 `Stylesheet`. It does not load the CST grammar. |

### Line-aware entries

`parse` and the CST parsers come in two bindings, one per compiled table, so an
entry never loads a table it does not parse with:

| Entry | Export | Tree | Positions |
| --- | --- | --- | --- |
| `@jesscss/scss-parser` (`.`) | `parse` | AST | no |
| `@jesscss/scss-parser/positions` | `parse` | AST | yes |
| `@jesscss/scss-parser/cst` | `parseScssCst`, `parseScssDoc` | CST | no |
| `@jesscss/scss-parser/cst/positions` | `parseScssCst`, `parseScssDoc` | CST | yes |

The `/positions` entries export the same names bound to the line-aware table:
switching is a change of import specifier, not of call site.

### Choosing a grammar build

Each compiled grammar is a standalone multi-megabyte artifact, so the four
variants ship as four separate files. Importing one never loads the others.
Pick by the two questions the subpath name answers — which tree, and whether
source positions are tracked:

| Subpath | Export | Tree | Positions |
| --- | --- | --- | --- |
| `@jesscss/scss-parser/grammar/ast` | `scssGrammar` | AST | no |
| `@jesscss/scss-parser/grammar/ast/positions` | `scssPositionsGrammar` | AST | yes |
| `@jesscss/scss-parser/grammar/cst` | `scssCstGrammar` | CST | no |
| `@jesscss/scss-parser/grammar/cst/positions` | `scssCstPositionsGrammar` | CST | yes |

`@jesscss/scss-parser/grammar` is an alias for `/grammar/ast`, the build the
shipping `parse()` route uses. It is not a barrel: it exposes the AST variant
only, so importing it cannot pull the other three in.

The positions variants set `startLine`/`startColumn` on every span. There is no
`trackLines` option: an option would force one module to name both tables, and
Node executes every module it statically imports, so the choice is which entry
you import. Error tolerance is not a property of a build — the CST runner
collects `result.errors` on either CST variant.


## Default CST shape

The CST is parseman's, produced by the shared `cssCstBuildHost`. Three kinds of node:

- **node** — `{ _tag: 'node', type, grammarType, span: { start, end }, state, children }` (`grammarType` = raw rule name; `type` = friendly public name).
- **leaf** — `{ _tag: 'leaf', value, span }` for terminals.
- **error** — `{ _tag: 'error', type, span, expected, children, state }` where recovery happened.

Spans are `[start, end)` offsets; whitespace and comments are trivia and do not appear as children.

Parsing `$c: red;\n.foo { color: $c; }` yields (abridged):

```jsonc
{
  "_tag": "node", "type": "StyleSheet", "grammarType": "Stylesheet",
  "children": [
    { "_tag": "node", "type": "VarDeclaration", "grammarType": "VarDeclaration", "span": { "start": 0, "end": 8 },
      "children": [
        { "_tag": "leaf", "value": "$c" }, { "_tag": "leaf", "value": ":" },
        { "_tag": "node", "type": "Keyword", "grammarType": "Keyword",
          "children": [ { "_tag": "leaf", "value": "red" } ] },
        { "_tag": "leaf", "value": ";" }
      ] },
    { "_tag": "node", "type": "QualifiedRule", "grammarType": "Ruleset", "span": { "start": 9, "end": 28 },
      "children": [
        { "_tag": "node", "type": "InterpolatedSelector", "grammarType": "InterpolatedSelector",
          "children": [ { "_tag": "leaf", "value": "." }, { "_tag": "leaf", "value": "foo" } ] },
        { "_tag": "leaf", "value": "{" },
        { "_tag": "node", "type": "Declaration", "grammarType": "Declaration",
          "children": [
            { "_tag": "leaf", "value": "color" }, { "_tag": "leaf", "value": ":" },
            { "_tag": "node", "type": "Reference", "grammarType": "Reference",
              "children": [ { "_tag": "leaf", "value": "$c" } ] },
            { "_tag": "leaf", "value": ";" }
          ] },
        { "_tag": "leaf", "value": "}" }
      ] }
  ]
}
```

Note the SCSS-specific nodes: `$c: …` becomes a `VarDeclaration`, `$c` in value position becomes a `Reference`, selectors parse through `InterpolatedSelector` (so `#{…}` interpolation is captured in place), and the color keyword `red` parses as a plain `Keyword` — the same node every dialect uses (NamedColor→Keyword convergence).

Pass `{ collapse: true }` to unwrap single-child wrapper types (`Reference`, `InterpolatedSelector`) into their child.

## Extending with your own builders

The grammar is decoupled from the tree it builds. Every capitalized rule is a parseman `node()`; when you drive a grammar with a `build` host, each `node()` calls your host instead of constructing the default CST. Use parseman's `run` with your own host and the grammar's trivia rule:

```js
import { run } from 'parseman'
import { scssGrammar } from '@jesscss/scss-parser/grammar'

const myHost = (type, children, fields, span) => ({ type, span, rules: children.filter(Boolean) })

const result = run(scssGrammar.Stylesheet, '$c: red; .foo { color: $c; }', {
  build: myHost,
  trivia: scssGrammar.rw
})

result.value   // the root node your host returned
```

The `BuildHost` signature (from parseman):

```ts
type BuildHost = (
  type: string,
  rules: readonly unknown[],
  fields: FieldMap | undefined,
  span: { start: number; end: number },
  rawChildren: readonly unknown[],
  triviaLog: readonly number[],
  state: unknown
) => unknown
```

`parseScssCst(...)` is this pattern with the shared `cssCstBuildHost` (see `@jesscss/css-parser`, `src/cst.ts`) as a reference host.

## Part of Jess

This package is developed as part of [Jess](https://github.com/jesscss/jess).
SCSS is the least-mature Jess dialect and is not the focus of the current
alpha; it seeds the roadmap "Sass+" dialect. For production use, prefer
`@jesscss/css-parser`. Licensed MIT.
