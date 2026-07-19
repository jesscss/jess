# AST Reorganization — Current Program

The core parse host, action list, and bridge are deleted. They have no
replacement. AST construction belongs in the dialect parser: a Parseman grammar
reduction creates the exact canonical node data for its already-structured
children.

## Direct parser construction

1. Keep the core AST leaf dependency-free and retain the one-way package graph
   `parser → core`.
2. Replace each remaining legacy builder production with a parser-local typed
   node constructor. Do not add a host, dispatch map, callback ABI, migration
   alias, source reparse, or compatibility adapter.
3. Make imports, interpolation, trivia, declaration bounds, and `:extend`
   explicit first-parse grammar facts. Imported source may be parsed once as a
   new file; already-read source is never sniffed, spliced, or reparsed.

## Scanner and grammar program

Grammar structure owns recognition. In parser packages, handwritten regexes,
scanners, character loops, byte slicing, and recovery parsing are deletion
targets. Prioritize interpolation-bearing quoted strings, at-rule preludes,
custom-property names and values, import specifiers, and coarse legacy builder
shapes. Use Parseman combinators to preserve typed segments.

## Core organization and performance

Continue the family co-location work for value, expression, selector, rule,
mixin, at-rule, extend, and engine emission. Favor one canonical source tree,
placement-local state, direct rendering, and fewer allocations and rediscovery
walks. A helper or traversal must remove more hot-path work than it adds.

## Evidence

Start with focused parser/core behavior tests. When recognition changes, run the
parser-runtime boundary verifier. At integration boundaries, rebuild dependency
packages, run core tests, the Jess production spine ratchet, and the Less corpus.
Use the independent Less reference for contested output behavior.

Historical host, action-list, and bridge analysis is preserved in
[`archive/AST-REORG-EXECUTION-host-bridge-history-2026-07-19.md`](./archive/AST-REORG-EXECUTION-host-bridge-history-2026-07-19.md).
