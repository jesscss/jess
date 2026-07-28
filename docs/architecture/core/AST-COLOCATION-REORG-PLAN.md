# AST Family Co-location — Current Program

Core owns canonical node definitions and evaluation/render behavior; dialect
parsers own grammar recognition and direct node construction. Keep the package
graph one-way: `parser → core`.

## Family layout

Co-locate the retained core implementation by semantic family: value,
expression, selector, rule, mixin, at-rule, extend, and engine emission. Keep
the core AST leaf free of parser dependencies. Construction, parser trivia, and
syntax-specific facts stay in the relevant parser package.

## Grammar and scanner cleanup

Delete coarse builder recovery as grammar structure becomes available. The
highest-value shapes are interpolation-bearing quoted strings and paths,
at-rule preludes, declaration boundaries, import facts, and `:extend` facts.
Parseman grammar combinators are the only parser recognition mechanism; do not
move handwritten scanners, regexes, byte slicing, reparsing, or side-channel
marker state into another package.

## Performance direction

Measure before claiming a win. Prefer direct rendering, carried facts, sparse
placement state, and fewer allocations or rediscovery walks. Do not trade a
deleted node or helper for a larger state graph, cache protocol, or recursive
walk.

## Verification

Use focused parser/core behavior tests while iterating, the parser-runtime
boundary verifier for recognition changes, and fresh integration builds plus the
Jess AST-v2 production-route ratchet and Less corpus at the batch boundary.

The detailed former host/action/bridge inventory is preserved in
[`archive/AST-COLOCATION-REORG-PLAN-host-bridge-history-2026-07-19.md`](./archive/AST-COLOCATION-REORG-PLAN-host-bridge-history-2026-07-19.md).
