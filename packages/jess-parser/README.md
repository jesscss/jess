# @jesscss/jess-parser

A parser for the [Jess](https://github.com/jesscss/jess) language, built on [parseman](https://www.npmjs.com/package/parseman). Jess is CSS extended with `$variables`, `$(…)` arithmetic, mixins, `@-compose`/`@-from` imports, and control flow (`$if`/`$for`/`$while`).

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
Those explicit entries expose Parseman types and grammar values, so consumers
of them must also provide the package's `parseman` peer.

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
| `@jesscss/jess-parser` (`.`) | `parse`, `JessParseError` | Parse Jess directly to canonical AST v2 `Stylesheet`; malformed input throws `JessParseError` with an offset and expected facts. |
| `@jesscss/jess-parser` (`.`) | `parseJessCst`, `jessGrammar` | Convenience exports for the explicit language-service CST surface. |
| `@jesscss/jess-parser` (`.`) | `JessCstNode`, `JessCstLeaf`, `JessCstError`, `JessCstChild`, `JessCstParseResult`, `JessCstType` (types) | CST type definitions (aliases of the shared `@jesscss/css-parser/cst` types). |
| `@jesscss/jess-parser/cst` | `parseJessCst`, CST types | Same core-free CST parser (explicit subpath). |
| `@jesscss/jess-parser/grammar` | `jessGrammar` | The explicit CST/language-service grammar rule map. It is not the production compiler parser route. |

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

## Compiler boundary

Production Jess parsing is `parse()` or `@jesscss/plugin-jess` through a
`Compiler`/`Context`. The direct grammar reductions construct canonical AST facts
themselves; there is no BuilderHost, parser action registry, CST-to-AST bridge, or
second parse route. `jessGrammar` and `parseJessCst()` are retained only for
explicit language-service/document consumers that need CST fidelity. Published
parser packages expose only their macro-compiled `lib` artifacts, so a consumer
does not need the workspace-private recognition package.

## Part of Jess

This package is developed as part of [Jess](https://github.com/jesscss/jess). It shares its CSS base and CST machinery with `@jesscss/css-parser`, `@jesscss/less-parser`, and `@jesscss/scss-parser`.
