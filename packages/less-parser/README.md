# @jesscss/less-parser

The Less grammar, layered on the CSS base parser — the parser behind the language Jess ships today.

> **Status: alpha.** Part of [Jess](https://github.com/jesscss/jess), which *is* Less.js v5. Rendering `.less` is the one surface shipping today; everything else is roadmap. Expect gaps and [report bugs](https://github.com/jesscss/jess/issues). Docs live at [jesscss.github.io](https://jesscss.github.io/).

## What it is

The Less grammar is the shared CSS grammar plus a Less delta:
`lessGrammar = compose([cssGrammar, <Less delta>])`. It adds `@variable` /
`@{interpolation}`, mixins, and the rest of Less on top of the spec-aligned CSS
base in [`@jesscss/css-parser`](https://www.npmjs.com/package/@jesscss/css-parser),
built on [parseman](https://www.npmjs.com/package/parseman) — **the fastest
general-purpose JavaScript parser** in its
[published benchmarks](https://matthew-dean.github.io/parseman/guide/benchmarks)
(see `@jesscss/css-parser` for figures and engineering details). It is the parser
Jess uses when it compiles `.less` — the "Now" tier of the language roadmap, and
the one dialect shipping in the alpha.

Two ways to use it:

- **As part of Jess** — the default `.` entry is wired into `@jesscss/core` and produces the core AST the Jess compiler evaluates (this is what runs when Jess compiles Less). This is the internal, core-coupled path.
- **As a standalone CST parser** — the `./cst` entry has **no dependency on `@jesscss/core`**. Install just this package and parse Less source text into a concrete syntax tree (CST). You can also plug your own builders onto the grammar to produce your own AST instead of the default CST.

## Install

```sh
npm install @jesscss/less-parser
```

`@jesscss/core` is an **optional** peer dependency — needed only for the core-coupled `.` entry, not for `./cst` or `./grammar`.

## Standalone usage (core-free)

```js
import { parseLessCst } from '@jesscss/less-parser/cst'

const result = parseLessCst('@c: red;\n.foo { color: @c; }')

result.ok               // true
result.errors           // ParseError[] (empty when ok)
result.unconsumedFrom   // index of first unparsed char, or null
result.tree             // the CST root (a StyleSheet node)
```

Signature:

```ts
parseLessCst(input: string, startRule = 'Stylesheet', options?: { collapse?: boolean }): LessCstParseResult
```

Pass a different `startRule` (any capitalized grammar rule, e.g. `'SelectorList'`, `'Declaration'`) to parse a fragment.

## Public API

| Entry | Export | Purpose |
| --- | --- | --- |
| `@jesscss/less-parser/cst` | `parseLessCst` | Core-free parse of a Less string to a CST. |
| `@jesscss/less-parser/cst` | `LessCstNode`, `LessCstLeaf`, `LessCstError`, `LessCstChild`, `LessCstParseResult`, `LessCstType` (types) | CST type definitions (aliases of the shared `@jesscss/css-parser/cst` types). |
| `@jesscss/less-parser/grammar` | `lessGrammar` | The compiled Less grammar (a rule map). Extend it with `compose()` or drive it directly with parseman's `run`. |
| `@jesscss/less-parser` (`.`) | `LessParser` (also `Parser`), `parseLessFn`, `lessGrammar`, tokens, … | The Jess-internal barrel. **Core-coupled** (the functional parser builds the core AST). Prefer `./cst` if you don't need `@jesscss/core`. |
| `@jesscss/less-parser/jess` | `LessParser`, `LessGrammar`, `parseLessFn`, … | Internal Jess-facing surface. |

## Default CST shape

The CST is parseman's, produced by the shared `cssCstBuildHost`. Three kinds of node:

- **node** — `{ _tag: 'node', type, grammarType, span: { start, end }, state, children }` (`grammarType` = raw rule name; `type` = friendly public name).
- **leaf** — `{ _tag: 'leaf', value, span }` for terminals.
- **error** — `{ _tag: 'error', type, span, expected, children, state }` where recovery happened.

Spans are `[start, end)` offsets; whitespace, block comments, **and Less line comments (`//`)** are trivia and do not appear as children.

Parsing `@c: red;\n.foo { color: @c; }` yields (abridged):

```jsonc
{
  "_tag": "node", "type": "StyleSheet", "grammarType": "Stylesheet",
  "children": [
    { "_tag": "node", "type": "VarDeclaration", "grammarType": "VarDeclaration", "span": { "start": 0, "end": 8 },
      "children": [
        { "_tag": "leaf", "value": "@c" }, { "_tag": "leaf", "value": ":" },
        { "_tag": "node", "type": "NamedColor", "grammarType": "NamedColor",
          "children": [ { "_tag": "leaf", "value": "red" } ] },
        { "_tag": "leaf", "value": ";" }
      ] },
    { "_tag": "node", "type": "QualifiedRule", "grammarType": "Ruleset", "span": { "start": 9, "end": 28 },
      "children": [
        { "_tag": "leaf", "value": ".foo" }, { "_tag": "leaf", "value": "{" },
        { "_tag": "node", "type": "Declaration", "grammarType": "Declaration",
          "children": [
            { "_tag": "leaf", "value": "color" }, { "_tag": "leaf", "value": ":" },
            { "_tag": "node", "type": "Reference", "grammarType": "Reference",
              "children": [ { "_tag": "leaf", "value": "@c" } ] },
            { "_tag": "leaf", "value": ";" }
          ] },
        { "_tag": "leaf", "value": "}" }
      ] }
  ]
}
```

Note the Less-specific nodes: a top-level `@c: …` becomes a `VarDeclaration`, a `@c` value becomes a `Reference`, and the color keyword `red` parses as `NamedColor` (the CSS-only grammar has no such rule — see `@jesscss/css-parser`).

Pass `{ collapse: true }` to unwrap single-child wrapper types (`Reference`, `NamedColor`, `InterpolatedSelector`) into their child.

### Name-independent condition arguments

A top-level condition operator (`> < >= <= = and or not`) inside **any** call's argument parses as a `Condition` node — there is **no** parse-time name-dispatch on `if`/`boolean`. `if(@a > 5, 1, 2)`, `boolean(not(2 < 1))`, `#ns.if(@a > 5)`, and `foo(@a > 5 and @b < 2)` all route through the ordinary function/mixin `Call` production; the shared call-arg rule (`ArgCondition` → `CondArgOr`/`CondArgAnd`/`CondArgTerm`) layers the condition-operator precedence chain on top of the normal value production. The layer is structurally gated: it only matches when a real operator is present, so a plain value / space-list argument (and mixin-definition params) fall through to the unchanged `valueSequence` byte-identically. Eval treats `if`/`boolean` as ordinary registered functions that consume the parsed `Condition`, so this is a parse-only unification (a deliberate v5 loosening vs Less 4.x, which name-dispatched and errored on the namespaced/generic forms).

One known gap: a namespace/accessor call in **value** position (`b: #ns.if(@a > 5)`, `b: .if(@a > 5)`) is reassembled from a raw permissive-paren capture (`_buildRefCallArgs`), a separate shallow path that does not run the condition layer — its args stay a value list. Statement-position (`#ns.if(@a > 5) { }` / bare `#ns.if(@a > 5)`) and all function-call forms are covered.

## Extending with your own builders

The grammar is decoupled from the tree it builds. Every capitalized rule is a parseman `node()`; when you drive a grammar with a `build` host, each `node()` calls your host instead of constructing the default CST. Use parseman's `run` with your own host and the grammar's trivia rule:

```js
import { run } from 'parseman'
import { lessGrammar } from '@jesscss/less-parser/grammar'

const myHost = (type, children, fields, span) => ({ type, span, children: children.filter(Boolean) })

const result = run(lessGrammar.Stylesheet, '@c: red; .foo { color: @c; }', {
  build: myHost,
  trivia: lessGrammar.rw   // Less trivia = whitespace + block + line comments
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

`parseLessCst(...)` is this pattern with the shared `cssCstBuildHost` (see `@jesscss/css-parser`, `src/cst.ts`) as a reference host.

## Part of Jess

This package is developed as part of [Jess](https://github.com/jesscss/jess), the Less.js v5 rewrite. Jess translates a Less string into the core Jess AST, which the compiler then evaluates and renders to CSS. Licensed MIT.
