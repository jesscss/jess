# @jesscss/scss-parser

A [SCSS/Sass](https://sass-lang.com/) parser built on [parseman](https://www.npmjs.com/package/parseman). The grammar is the CSS grammar plus an SCSS delta: `scssGrammar = compose([cssGrammar, <SCSS delta>])`, layered on the shared CSS base in `@jesscss/css-parser`.

The goal is **parse coverage**: not every Sass/SCSS feature is necessarily *evaluated*, but the surface syntax should parse. This is the earliest-stage of the four Jess parsers (`2.0.0-alpha.1`).

Two ways to use it:

- **As part of Jess** — the default `.` entry is wired into `@jesscss/core` and produces the core AST the Jess compiler evaluates. This is the internal, core-coupled path.
- **As a standalone CST parser** — the `./cst` entry has **no dependency on `@jesscss/core`**. Install just this package and parse SCSS source text into a concrete syntax tree (CST). You can also plug your own builders onto the grammar to produce your own AST instead of the default CST.

## Install

```sh
npm install @jesscss/scss-parser
```

`@jesscss/core` is an **optional** peer dependency — needed only for the core-coupled `.` entry, not for `./cst` or `./grammar`.

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
| `@jesscss/scss-parser/grammar` | `scssGrammar` | The compiled SCSS grammar (a rule map). Extend it with `compose()` or drive it directly with parseman's `run`. |
| `@jesscss/scss-parser` (`.`) | `ScssParser` (also `Parser`), `parseScssFn`, `scssGrammar`, tokens, … | The Jess-internal barrel. **Core-coupled** (the functional parser builds the core AST). Prefer `./cst` if you don't need `@jesscss/core`. |
| `@jesscss/scss-parser/jess` | `ScssParser`, `ScssGrammar`, `parseScssFn`, … | Internal Jess-facing surface. |

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
        { "_tag": "node", "type": "NamedColor", "grammarType": "NamedColor",
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

Note the SCSS-specific nodes: `$c: …` becomes a `VarDeclaration`, `$c` in value position becomes a `Reference`, selectors parse through `InterpolatedSelector` (so `#{…}` interpolation is captured in place), and the color keyword `red` parses as `NamedColor`.

Pass `{ collapse: true }` to unwrap single-child wrapper types (`Reference`, `NamedColor`, `InterpolatedSelector`) into their child.

## Extending with your own builders

The grammar is decoupled from the tree it builds. Every capitalized rule is a parseman `node()`; when you drive a grammar with a `build` host, each `node()` calls your host instead of constructing the default CST. Use parseman's `run` with your own host and the grammar's trivia rule:

```js
import { run } from 'parseman'
import { scssGrammar } from '@jesscss/scss-parser/grammar'

const myHost = (type, children, fields, span) => ({ type, span, children: children.filter(Boolean) })

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
  children: readonly unknown[],
  fields: FieldMap | undefined,
  span: { start: number; end: number },
  rawChildren: readonly unknown[],
  triviaLog: readonly number[],
  state: unknown
) => unknown
```

`parseScssCst(...)` is this pattern with the shared `cssCstBuildHost` (see `@jesscss/css-parser`, `src/cst.ts`) as a reference host.

## Part of Jess

This package is developed as part of [Jess](https://github.com/jesscss/jess). The core-coupled `.` entry integrates with `@jesscss/core`; the `./cst` and `./grammar` entries are usable on their own. SCSS is the least-mature of the Jess dialects — prefer `@jesscss/css-parser` / `@jesscss/less-parser` for production use.
