---
"@jesscss/core": patch
"@jesscss/parser-shared": patch
"@jesscss/css-parser": patch
"@jesscss/less-parser": patch
"@jesscss/scss-parser": patch
"@jesscss/jess-parser": patch
"@jesscss/fns": patch
---

AST nodes are built by constructors instead of object literals, so V8 cannot pretenure them per process: every process now parses in the same mode whatever the bundle layout. Nodes are still plain objects with the same keys in the same order, and output is byte-identical. Eval and render values are constructor-built too, and a changed node is rebuilt through its constructor (`withFields`, exported from `@jesscss/core`), never copied by spread. The parsers require `parseman@^0.59.0`, whose engine builds its own tree objects with constructors.
