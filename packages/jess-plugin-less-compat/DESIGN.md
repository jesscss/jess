# Less compat plugin (design + status)

This package provides a **Less.js compatibility layer** for Jess by converting between **Jess AST** and **Less AST**, so Less plugins/visitors can run against Jess trees.

## Canonical docs

- **User-facing usage**: `README.md`
- **Code**:
  - `src/plugin.ts` (integration point)
  - `src/transform/` (to/from Less + proxy support)
  - `test/` (integration/unit coverage)

Historical analyses and plans were moved to `_archive/` to keep the package root small.

## Approach (high-level)

- **Lazy, proxy-based conversion**:
  - Convert Jess nodes to Less-compatible shapes *on demand* via Proxies.
  - Cache conversions (prefer `WeakMap`) to avoid repeated work and allow GC.
- **Bidirectional conversion**:
  - Jess → Less for running visitors
  - Less → Jess when visitors return replacement nodes

## Compatibility hotspots to watch

- **Visitor expectations**:
  - Some Less plugins expect `node.accept(visitor)` and/or `visitor.visitArray(...)` patterns.
  - If a plugin manipulates arrays of nodes, ensure the proxy layer handles `visitArray`.
- **Replacement semantics**:
  - Less visitors may run in replacing vs non-replacing mode (`isReplacing`).
  - Be explicit about whether return values from visitors are treated as replacements.
- **Function registry surface**:
  - Less plugins may expect a Less-like `functionRegistry` API; a small adapter/wrapper may be required.

## Status (as of 2026-02-09)

This package is intentionally **experimental** (see `README.md`). The root-level deep-dive docs were archived; the current focus should be:

- Make proxy + conversion behavior correct for the plugins you care about
- Grow tests around real plugin integrations in `test/integration/`

