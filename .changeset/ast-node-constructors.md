---
"@jesscss/core": patch
"@jesscss/less-parser": patch
"@jesscss/scss-parser": patch
"@jesscss/jess-parser": patch
---

AST nodes are built by constructors instead of object literals, so V8 cannot pretenure them per process: every process now parses in the same mode whatever the bundle layout. Nodes are still plain objects with the same keys in the same order, and output is byte-identical. Node factories own the arrays they keep.
