# @jesscss/css-parser

The CSS package exposes Parseman CSS grammar and CST parsing:

- `@jesscss/css-parser` — grammar, CST parser, and CST types.
- `@jesscss/css-parser/cst` — CST parsing entry.
- `@jesscss/css-parser/grammar` — compiled CSS grammar.

The former `./jess` Chevrotain/functional-builder surface is deleted. CSS has
no legacy tree parser or construction host. Parser-local AST grammar experiments
remain private implementation details.
