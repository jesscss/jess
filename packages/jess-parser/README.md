# @jesscss/jess-parser

A parser for the [Jess](https://github.com/jesscss/jess) language, built on [parseman](https://www.npmjs.com/package/parseman). Jess is CSS extended with `$variables`, `$(…)` arithmetic, mixins, `@-compose`/`@-from` imports, and control flow (`$if`/`$for`/`$while`). The grammar is the CSS grammar plus a Jess delta: `jessGrammar = compose([cssGrammar, <Jess delta>])`, layered on the shared CSS base in `@jesscss/css-parser`.

Two parser representations are available:

- **Canonical AST v2** — the default `parse()` entry constructs a `Stylesheet`
  directly through parser-local Parseman reductions.
- **Explicit CST** — the `./cst` entry has **no dependency on
  `@jesscss/core`** and parses Jess source text into a concrete syntax tree for
  language-service/document consumers.

> **Status:** the direct AST v2 parser is in active feature closure. `parse()`
> either returns a complete canonical `Stylesheet` or rejects the source; it does not
> silently substitute an empty stylesheet for unsupported input.

## Install

```sh
npm install @jesscss/jess-parser
```

`@jesscss/core` is an **optional** peer dependency — needed for the default
AST v2 `parse()` entry, not for `./cst` or `./grammar`.

## Canonical AST parsing

```js
import { parse } from '@jesscss/jess-parser'

const stylesheet = parse('$brand: #3366ff;')

stylesheet.type // 'Stylesheet'
```

## Standalone usage (core-free)

```js
import { parseJessCst } from '@jesscss/jess-parser/cst'
// or: import { parseJessCst } from '@jesscss/jess-parser'

const result = parseJessCst('$brand: #3366ff;')

result.ok               // true
result.errors           // ParseError[] (empty when ok)
result.unconsumedFrom   // index of first unparsed char, or null
result.tree             // the CST root (a StyleSheet node)
```

Signature:

```ts
parseJessCst(input: string, startRule = 'Stylesheet', options?: { collapse?: boolean }): JessCstParseResult
```

Pass a different `startRule` (any capitalized grammar rule) to parse a fragment.

## Public API

| Entry | Export | Purpose |
| --- | --- | --- |
| `@jesscss/jess-parser` (`.`) | `parse` | Parse Jess directly to canonical AST v2 `Stylesheet`. |
| `@jesscss/jess-parser` (`.`) | `parseJessCst`, `jessGrammar` | Convenience exports for the grammar and explicit CST surface. |
| `@jesscss/jess-parser` (`.`) | `JessCstNode`, `JessCstLeaf`, `JessCstError`, `JessCstChild`, `JessCstParseResult`, `JessCstType` (types) | CST type definitions (aliases of the shared `@jesscss/css-parser/cst` types). |
| `@jesscss/jess-parser/cst` | `parseJessCst`, CST types | Same core-free CST parser (explicit subpath). |
| `@jesscss/jess-parser/grammar` | `jessGrammar` | The compiled Jess grammar (a rule map). Extend it with `compose()` or drive it directly with parseman's `run`. |

## Default CST shape

The CST is parseman's, produced by the shared `cssCstBuildHost` (from `@jesscss/css-parser`). Three kinds of node:

- **node** — `{ _tag: 'node', type, grammarType, span: { start, end }, state, children }` (`grammarType` = raw rule name; `type` = friendly public name).
- **leaf** — `{ _tag: 'leaf', value, span }` for terminals.
- **error** — `{ _tag: 'error', type, span, expected, children, state }` where recovery happened.

Spans are `[start, end)` offsets; whitespace and comments are trivia and do not appear as children.

Parsing `$brand: #3366ff;` yields:

```jsonc
{
  "_tag": "node", "type": "StyleSheet", "grammarType": "Stylesheet", "span": { "start": 0, "end": 16 },
  "children": [
    { "_tag": "node", "type": "VarDeclaration", "grammarType": "VarDeclaration", "span": { "start": 0, "end": 16 },
      "children": [
        { "_tag": "leaf", "value": "$brand", "span": { "start": 0, "end": 6 } },
        { "_tag": "leaf", "value": ":", "span": { "start": 6, "end": 7 } },
        { "_tag": "node", "type": "Color", "grammarType": "Color", "span": { "start": 8, "end": 15 },
          "children": [ { "_tag": "leaf", "value": "#3366ff", "span": { "start": 8, "end": 15 } } ] },
        { "_tag": "leaf", "value": ";", "span": { "start": 15, "end": 16 } }
      ] }
  ]
}
```

Jess-specific grammar rules the delta adds include `VarDeclaration` (`$x: …`), `Reference` (`$x`, `$x.prop`, `$x[0]`), `Expression` / `Operation` / `Condition` (inside `$(…)`), `Mixin`, `MixinCall`, `InterpolatedSelector` (`.widget-$[side]`), and the `@-compose`/`@-export`/`@-from`/`@-use` import at-rules.

Pass `{ collapse: true }` to unwrap single-child wrapper types (`Reference`, `NamedColor`, `InterpolatedSelector`) into their child.

### Current parse coverage

`parse()` is deliberately strict: it returns a complete AST v2 `Stylesheet` only for
input represented by its direct grammar. Use the explicit CST result's
`unconsumedFrom` field when a language-service consumer needs partial-parse
diagnostics.

## Extending with your own builders

The grammar is decoupled from the tree it builds. Every capitalized rule is a parseman `node()`; when you drive a grammar with a `build` host, each `node()` calls your host instead of constructing the default CST. Use parseman's `run` with your own host and the grammar's trivia rule:

```js
import { run } from 'parseman'
import { jessGrammar } from '@jesscss/jess-parser/grammar'

const myHost = (type, children, fields, span) => ({ type, span, children: children.filter(Boolean) })

const result = run(jessGrammar.Stylesheet, '$brand: #3366ff;', {
  build: myHost,
  trivia: jessGrammar.rw
})

result.value   // the root node your host returned
```

The `BuildHost` signature (from parseman):

```ts
type BuildHost = (
  type: string,
  children: readonly unknown[],
  fields: FieldMap | undefined,
  span: { start: number; end: number },
  rawChildren: readonly unknown[],
  triviaLog: readonly number[],
  state: unknown
) => unknown
```

`parseJessCst(...)` is this pattern with the shared `cssCstBuildHost` (see `@jesscss/css-parser`, `src/cst.ts`) as a reference host.

## Part of Jess

This package is developed as part of [Jess](https://github.com/jesscss/jess). It shares its CSS base and CST machinery with `@jesscss/css-parser`, `@jesscss/less-parser`, and `@jesscss/scss-parser`.
