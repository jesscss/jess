# @jesscss/css-parser

The CSS package exposes Parseman CSS grammar, canonical AST v2 parsing, and
explicit CST parsing:

- `@jesscss/css-parser` — `parse()` to canonical AST v2 `Stylesheet`, grammar, and CST types.
- `@jesscss/css-parser/cst` — CST parsing entry.
- `@jesscss/css-parser/grammar` — compiled CSS grammar (alias for `/grammar/ast`).

### Choosing a grammar build

Each compiled grammar is a standalone multi-megabyte artifact, so the four
variants ship as four separate files. Importing one never loads the others.
Pick by the two questions the subpath name answers — which tree, and whether
source positions are tracked:

| Subpath | Export | Tree | Positions |
| --- | --- | --- | --- |
| `@jesscss/css-parser/grammar/ast` | `cssGrammar` | AST | no |
| `@jesscss/css-parser/grammar/ast/positions` | `cssPositionsGrammar` | AST | yes |
| `@jesscss/css-parser/grammar/cst` | `cssCstGrammar` plus the individual CST rule handles (`Stylesheet`, `Ruleset`, …) | CST | no |
| `@jesscss/css-parser/grammar/cst/positions` | `cssCstPositionsGrammar` | CST | yes |

`@jesscss/css-parser/grammar` is an alias for `/grammar/ast`, the build the
shipping `parse()` route uses. It is not a barrel: it exposes the AST variant
only, so importing it cannot pull the other three in. The main entry no longer
re-exports compiled grammars — that would have made every `parse()` consumer
load all four builds.

Positions are the `trackLines` option: the variant sets `startLine`/`startColumn`
on every span. Error tolerance is not a property of a build — the CST runner
collects `result.errors` on either CST variant.

The CST and grammar entries expose Parseman types and grammar values. They use
the package's `parseman` peer; install Parseman when consuming either entry.

The former `./jess` Chevrotain/functional-builder surface is deleted. CSS has
no legacy tree parser or construction host. Its public parser constructs the
canonical AST directly through Parseman reductions; the named CST APIs remain
for language-service/document consumers only.
