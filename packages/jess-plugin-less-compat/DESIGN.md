# Less compat plugin (design + status)

> **AST-v2 cutover status:** This document preserves future adapter ideas for the
> legacy tree model. Core no longer exposes a visitor field on `PluginInterface`,
> and the public AST-v2 compiler does not run this package's visitor adapter.
> Do not use the visitor sections below as a current execution contract.

This package retains Less compatibility conversion work for an explicitly
designed future adapter; active compiler integration is limited to its supported
plugin-loading, function, and post-processing capabilities.

## Canonical docs

- **User-facing usage**: `README.md`
- **Code**:
  - `src/plugin.ts` (integration point)
  - `src/transform/` (to/from Less + typed adapter support)
  - `test/` (integration/unit coverage)

Historical transition analyses were removed from the working tree to keep the
package root small. Use git history for archaeology.

## Approach (high-level)

- **Lazy, adapter-based conversion**:
  - Convert Jess nodes to Less-compatible shapes *on demand* via typed adapter instances.
  - Cache conversions (prefer `WeakMap`) to avoid repeated work and allow GC.
- **Bidirectional conversion**:
  - Jess → Less for running visitors
  - Less → Jess when visitors return replacement nodes

## Compatibility hotspots to watch

- **Visitor expectations**:
  - Some Less plugins expect `node.accept(visitor)` and/or `visitor.visitArray(...)` patterns.
  - If a plugin manipulates arrays of nodes, ensure the adapter layer handles `visitArray`.
- **Replacement semantics**:
  - Less visitors may run in replacing vs non-replacing mode (`isReplacing`).
  - Be explicit about whether return values from visitors are treated as replacements.
- **Function registry surface**:
  - Less plugins may expect a Less-like `functionRegistry` API; a small adapter/wrapper may be required.

## Status (as of 2026-02-09)

This package is intentionally **experimental** (see `README.md`). Keep the
package root focused on current adapter behavior:

- Make adapter + conversion behavior correct for the plugins you care about
- Grow tests around real plugin integrations in `test/integration/`
