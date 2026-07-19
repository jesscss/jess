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
- **[Value & Separator Formatting](./value-formatting.md)** — operators and list
  separators emit spaced (`12px / 16px`), commas normalize to `, `, and the
  `:nth-*()` `An+B` microsyntax stays unspaced.
- **[Selector Compaction (`:is()` Nesting)](./selector-compaction.md)** — a `&`-less
  nested descendant factors its common ancestor out once, wrapping multi-branch sides
  in `:is(...)` instead of cartesian-expanding.
- **[Number Precision](./number-precision.md)** — computed declaration values round to
  8 decimal places; interpolation splices keep full precision.
- **[Color Output (Alpha, Hex, Gamut)](./color-output.md)** — computed alpha → `rgba`,
  authored alpha-hex preserved, out-of-range channels clamp.
- **[String Formatting (`%()`)](./string-format.md)** — the `%()` compat alias and how
  it lowers to a string-format call.
- **[Inline JavaScript Removed](./inline-javascript.md)** — backtick JS is gone; use
  `@use` / `@-use` script modules.
