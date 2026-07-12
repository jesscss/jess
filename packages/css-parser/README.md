# @jesscss/css-parser

A spec-aligned CSS parser, built on [parseman](https://www.npmjs.com/package/parseman) — the shared base grammar that the Less and SCSS grammars extend, and the real-AST foundation behind Jess's PostCSS-*like* transform-layer vision.

> **Status: alpha.** Part of [Jess](https://github.com/jesscss/jess), which *is* Less.js v5. Rendering `.less` is the one surface shipping today; everything else is roadmap. Expect gaps and [report bugs](https://github.com/jesscss/jess/issues). Docs live at [jesscss.github.io](https://jesscss.github.io/).

## What it is

`cssGrammar` is a functional grammar over the CSS syntax spec: capitalized rules
map to CSS productions (stylesheets, qualified rules, at-rules, selectors,
declarations, values), and whitespace/comments are handled as trivia rather than
tree nodes. Every other Jess grammar is *this* grammar plus a delta —
`compose([cssGrammar, …])` — so the Less and SCSS parsers stay in lockstep with
the CSS base instead of re-implementing it.

Because the grammar builds a real, span-annotated tree and is decoupled from the
tree it builds (see [Extending](#extending-with-your-own-builders)), it is also
the intended seed for a future PostCSS-*like* layer of open, AST-level
transforms. That layer isn't designed yet — treat it as direction, not a shipped
plugin API.

## Built on Parséman — the fastest general-purpose JS parser

Parséman is **the fastest general-purpose JavaScript parser** in
[its published benchmarks](https://matthew-dean.github.io/parseman/guide/benchmarks),
beating Peggy, Chevrotain, Nearley, Parsimmon, and Jison at every grammar and
size measured:

| Grammar (input) | Parséman | Chevrotain | Peggy |
| --- | --- | --- | --- |
| CSV (14.8 kB) | **74 µs** | 1,045 µs | 430 µs |
| JSON (12 kB) | **125 µs** | 312 µs | 472 µs |
| GraphQL (7.8 kB) | **131 µs** | 342 µs | 373 µs |

"General-purpose" is the honest, defensible claim: native `JSON.parse` still
beats it on JSON (≈44 µs vs 125 µs), but that's a specialized native built-in,
not a general parser. Among general-purpose JS parsers, Parséman is fastest.

Note the scope: parsing is only ~17% of the total cost of a Jess compile, so a
fast parser under the hood is true *and* the whole compiler's speed is still
being earned (see the [root README](https://github.com/jesscss/jess)) — both
hold at once.

What makes it fast, and what Jess builds on:

- **Composable functional combinators** that compile to optimized parsers —
  grammars are written as combinators, not hand-rolled state machines.
- **In-repo, spec-aligned grammars.** The CSS grammar's rules cite
  [CSS Syntax Level 3](https://www.w3.org/TR/css-syntax-3/) anchors; the spec
  algorithms are the oracle.
- **Dual-use grammars.** The *same* grammar runs strict (single-error, for the
  compiler) or tolerant with error recovery (for tooling/editors).
- **Incremental reparse.** `.edit()` re-parses only the region that changed.

Two ways to use it:

- **As part of Jess** — the default `.` entry is wired into `@jesscss/core` and produces the core AST the Jess compiler evaluates. This is the internal, core-coupled path.
- **As a standalone CST parser** — the `./cst` entry has **no dependency on `@jesscss/core`**. Install just this package and parse CSS source text into a concrete syntax tree (CST). You can also plug your own builders onto the grammar to produce your own AST instead of the default CST.

## Install

```sh
npm install @jesscss/css-parser
```

`@jesscss/core` is an **optional** peer dependency — it is only needed for the core-coupled `.` entry, not for `./cst` or `./grammar`.

## Standalone usage (core-free)

```js
import { parseCss } from '@jesscss/css-parser/cst'

const result = parseCss('.foo { color: red; }')

result.ok               // true
result.errors           // ParseError[] (empty when ok)
result.unconsumedFrom   // index of first unparsed char, or null
result.tree             // the CST root (a StyleSheet node)
```

`parseCssCst` is an alias of `parseCss`. Signature:

```ts
parseCss(input: string, startRule = 'Stylesheet', options?: { collapse?: boolean }): CssCstParseResult
```

Pass a different `startRule` (any capitalized rule name in the grammar, e.g. `'SelectorList'`, `'Declaration'`) to parse a fragment instead of a whole stylesheet.

## Public API

| Entry | Export | Purpose |
| --- | --- | --- |
| `@jesscss/css-parser/cst` | `parseCss` / `parseCssCst` | Core-free parse of a string to a CST. |
| `@jesscss/css-parser/cst` | `parseCst` | The generic driver — `parseCst(grammar, input, startRule?, options?)`. Runs *any* grammar with the default CST build host. |
| `@jesscss/css-parser/cst` | `cssCstBuildHost` | The `BuildHost` that produces the default CST shape (see below). |
| `@jesscss/css-parser/cst` | `CssCstNode`, `CssCstLeaf`, `CssCstError`, `CssCstChild`, `CssCstParseResult`, `CssCstParseOptions` (types) | CST type definitions. |
| `@jesscss/css-parser/grammar` | `cssGrammar` | The compiled grammar (a rule map). Extend it with `compose()` or drive it directly with parseman's `run`. |
| `@jesscss/css-parser` (`.`) | `parseCss`, `cssGrammar`, tokens, `runFunctionalParse`, … | The Jess-internal barrel. **Core-coupled** (re-exports the core-AST driver). Prefer `./cst` if you don't need `@jesscss/core`. |
| `@jesscss/css-parser/jess` | `CssParser`, `parseCssFn`, `productions`, … | Legacy/internal Jess-facing surface. |

## Default CST shape

The default host produces three kinds of node:

- **node** — `{ _tag: 'node', type, grammarType, span: { start, end }, state, children }`
  `grammarType` is the raw grammar rule name; `type` is a friendly public name (e.g. `Ruleset` → `QualifiedRule`, `Num` → `Number`, `Call` → `Function`, `Paren` → `SimpleBlock`).
- **leaf** — `{ _tag: 'leaf', value: string, span }` for matched terminals (`.foo`, `{`, `:`, `;`).
- **error** — `{ _tag: 'error', type, span, expected, children, state }` embedded where recovery happened.

Spans are `[start, end)` byte offsets into the source. Whitespace and comments are consumed as trivia and do **not** appear as children (they are tracked separately in `result.triviaLog`).

Parsing `.foo { color: red; }` yields (abridged):

```jsonc
{
  "_tag": "node", "type": "StyleSheet", "grammarType": "Stylesheet", "span": { "start": 0, "end": 20 },
  "children": [
    { "_tag": "node", "type": "QualifiedRule", "grammarType": "Ruleset", "span": { "start": 0, "end": 20 },
      "children": [
        { "_tag": "node", "type": "SelectorList", "grammarType": "SelectorList",
          "children": [ /* ComplexSelector → CompoundSelector → BasicSelector → leaf ".foo" */ ] },
        { "_tag": "leaf", "value": "{", "span": { "start": 5, "end": 6 } },
        { "_tag": "node", "type": "Declaration", "grammarType": "Declaration", "span": { "start": 7, "end": 18 },
          "children": [
            { "_tag": "leaf", "value": "color", "span": { "start": 7, "end": 12 } },
            { "_tag": "leaf", "value": ":", "span": { "start": 12, "end": 13 } },
            { "_tag": "node", "type": "Function", "grammarType": "Call", "span": { "start": 14, "end": 17 },
              "children": [ { "_tag": "leaf", "value": "red", "span": { "start": 14, "end": 17 } } ] },
            { "_tag": "leaf", "value": ";", "span": { "start": 17, "end": 18 } }
          ] },
        { "_tag": "leaf", "value": "}", "span": { "start": 19, "end": 20 } }
      ] }
  ]
}
```

Note that the plain CSS grammar has no color-keyword rule, so a bare ident value like `red` comes through as a `Function`/`Call` (a call with no args). The Less/SCSS/Jess grammars add a `NamedColor` rule, so the same value parses differently there.

Pass `{ collapse: true }` to unwrap a small set of single-child wrapper node types (`Reference`, `NamedColor`, `InterpolatedSelector`) into their child.

## Extending with your own builders

The grammar is decoupled from the tree it builds. Every capitalized rule is a parseman `node()`; when you run a grammar with a `build` host, each `node()` calls your host instead of constructing the default CST. The host signature is parseman's `BuildHost`:

```ts
type BuildHost = (
  type: string,
  children: readonly unknown[],   // built children (whatever your host returned)
  fields: FieldMap | undefined,   // named field() captures
  span: { start: number; end: number },
  rawChildren: readonly unknown[],// children + leaves, in source order
  triviaLog: readonly number[],
  state: unknown
) => unknown                      // your node — becomes a child of the parent's build call
```

Drive the grammar with parseman's `run`, supplying your own host and the grammar's trivia rule:

```js
import { run } from 'parseman'
import { cssGrammar } from '@jesscss/css-parser/grammar'

// Build a minimal { type, span } tree of your own.
const myHost = (type, children, fields, span) => ({ type, span, children: children.filter(Boolean) })

const result = run(cssGrammar.Stylesheet, '.foo { color: red; }', {
  build: myHost,
  trivia: cssGrammar.rw   // the grammar's trivia (whitespace + comments) rule
})

result.ok      // true
result.value   // the root node your host returned
```

`parseCss(...)` is exactly this pattern with `build: cssCstBuildHost`. You can read `cssCstBuildHost` (in `src/cst.ts`) as a reference host: it shows how `grammarType`, `rawChildren`, and `span` map into a node.

## Part of Jess

This package is developed as part of [Jess](https://github.com/jesscss/jess), the Less.js v5 rewrite. The core-coupled `.` entry integrates with `@jesscss/core`; the `./cst` and `./grammar` entries are usable on their own. Licensed MIT.
