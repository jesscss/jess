# @jesscss/css-parser

`parse()` produces selectors, at-rule preludes, and declaration values as
structured nodes in the same pass, rather than retaining them as strings for
consumers to re-parse. The reasoning, the PostCSS contrast, and the
counter-considerations are in
[`docs/architecture/parser/PARSE-ONCE-DEEPLY.md`](../../../../docs/architecture/parser/PARSE-ONCE-DEEPLY.md);
it is not restated here.

The CSS package exposes Parseman CSS grammar, canonical AST v2 parsing, and
explicit CST parsing:

- `@jesscss/css-parser` — `parse()` to canonical AST v2 `Stylesheet`, and CST types.
- `@jesscss/css-parser/positions` — the same `parse()` with line/column facts.
- `@jesscss/css-parser/cst` — CST parsing entry.
- `@jesscss/css-parser/cst/positions` — the same CST parsers with line/column facts.
- `@jesscss/css-parser/grammar` — compiled CSS grammar (alias for `/grammar/ast`).

### Line-aware entries

`parse` and the CST parsers come in two bindings, one per compiled table, so an
entry never loads a table it does not parse with:

| Entry | Export | Tree | Positions |
| --- | --- | --- | --- |
| `@jesscss/css-parser` (`.`) | `parse` | AST | no |
| `@jesscss/css-parser/positions` | `parse` | AST | yes |
| `@jesscss/css-parser/cst` | `parseCssCst`, `parseCssDoc` | CST | no |
| `@jesscss/css-parser/cst/positions` | `parseCssCst`, `parseCssDoc` | CST | yes |

The `/positions` entries export the same names bound to the line-aware table:
switching is a change of import specifier, not of call site.

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

The positions variants set `startLine`/`startColumn` on every span. There is no
`trackLines` option: an option would force one module to name both tables, and
Node executes every module it statically imports, so the choice is which entry
you import. Error tolerance is not a property of a build — the CST runner
collects `result.errors` on either CST variant.

The CST and grammar entries expose Parseman types and grammar values. They use
the package's `parseman` peer; install Parseman when consuming either entry.

The former `./jess` Chevrotain/functional-builder surface is deleted. CSS has
no legacy tree parser or construction host. Its public parser constructs the
canonical AST directly through Parseman reductions; the named CST APIs remain
for language-service/document consumers only.
