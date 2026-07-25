# @jesscss/css-parser

The CSS package exposes Parseman CSS grammar, canonical AST v2 parsing, and
explicit CST parsing:

- `@jesscss/css-parser` — `parse()` to canonical AST v2 `Stylesheet`, grammar, and CST types.
- `@jesscss/css-parser/cst` — CST parsing entry.
- `@jesscss/css-parser/grammar` — compiled CSS grammar.

The CST and grammar entries expose Parseman types and grammar values. They use
the package's `parseman` peer; install Parseman when consuming either entry.

The former `./jess` Chevrotain/functional-builder surface is deleted. CSS has
no legacy tree parser or construction host. Its public parser constructs the
canonical AST directly through Parseman reductions; the named CST APIs remain
for language-service/document consumers only.
