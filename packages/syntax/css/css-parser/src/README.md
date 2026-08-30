# @jesscss/css-parser

This is the base CSS parser. It's maintained separately from the Jess parser so that we can define CSS syntax / grammar and then show just the extensions / modifications by Jess or Less.

See [some notes](./CSS_NOTES.md) on CSS syntax.

## Public parsing model

`parse(source)` is the compiler-facing API. It macro-compiles Parseman grammar
reductions directly to canonical AST v2 `Stylesheet` nodes; it does not scan
source into a parallel schema, convert CST to AST, or call a construction host.

The separately named CST/document APIs remain available only for
language-service and document consumers. New parser work belongs in Parseman
grammar structure with parser-local AST reductions.
