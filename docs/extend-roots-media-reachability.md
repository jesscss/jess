# Extend roots: media and reachability

See [extend-roots-architecture.md](./extend-roots-architecture.md) for the full extend-root architecture.

**Short version:**

- Extends can target only the **extend root** and its **descendant roots** (no ancestor targeting).
- “Do extend inside”: root rules **can** extend selectors inside `@media` (outside → inside). We do **not** support inside → ancestor.
- Compose creates a boundary (no extending across unless the stylesheet allows mutation); @import allows mutation and does not create that boundary.
- All rulesets and their descendants belong to the current extend root until a descendant is another extend root.
