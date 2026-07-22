# Grammar-to-AST Fusion — Current Program

Parseman grammar reductions construct canonical AST nodes directly. There is no
separate construction host, action map, parser callback ABI, or bridge. Core
provides node definitions and evaluation/render behavior; dialect parsers own
syntax recognition and construction.

## Construction rules

- Each reduction consumes only typed grammar children and creates its exact node.
- Preserve interpolation, trivia, declaration bounds, imports, and `:extend` as
  first-parse facts; do not recover them from bytes.
- Keep parser packages one-way consumers of core. Do not add parser imports to
  core or an adapter to preserve a former node model.

## Performance work

Fusion is also an allocation/capture reduction program. Measure capture and
node-construction costs by grammar family, then remove unneeded capture,
state, traversal, and object work at the owning grammar boundary. Do not trade
one deleted dispatch for generic helper machinery or a second parse.

## Landing and proof

Land small grammar-family slices with focused parser/core behavior tests. Run
the parser-runtime boundary verifier whenever recognition changes. At the batch
boundary use fresh builds, the Jess AST-v2 production-route ratchet, and the Less
corpus; validate disputed output against the independent Less reference.

The historical host and callback analysis is preserved in
[`archive/GRAMMAR-AST-FUSION-DESIGN-host-bridge-history-2026-07-19.md`](./archive/GRAMMAR-AST-FUSION-DESIGN-host-bridge-history-2026-07-19.md).
