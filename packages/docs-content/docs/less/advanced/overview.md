---
title: "Advanced"
slug: "/advanced"
audiences:
  - less
origin: less
---

> Deeper semantics and deliberate Less 5.x divergences from 4.x.

These pages document behaviors that are either new in Less 5.x or intentionally
different from Less 4.x. If you are migrating an existing codebase, read
[Migrating to v5](../usage/migrating-to-v5.md) first, then use these pages when you
need the exact rule behind a specific output difference.

- **[Output Model](./output-model.md)** — nested output by default
  (`collapseNesting: false`), no `@media` merging, and `:is()` selector compaction.
- **[Extend and `:is()` Wrapping](./extend-is-wrapping.md)** — how `:extend(... all)`
  grafts `:is(...)` into the matched compound instead of string-replacing selectors.
- **[Merge Operators & Last-Occurrence Anchoring](./merge-anchoring.md)** — `+:` /
  `+_:` merge semantics and the deliberate last-occurrence render position.
- **[Verbatim (Lazy-Print) Values](./verbatim-values.md)** — un-operated literals and
  colors are preserved exactly as written; only computed values canonicalize.
- **[String Formatting (`%()`)](./string-format.md)** — the `%()` compat alias and how
  it lowers to a string-format call.
- **[Inline JavaScript Removed](./inline-javascript.md)** — backtick JS is gone; use
  `@use` / `@-use` script modules.
