---
title: "Inline JavaScript Removed (@use)"
slug: "/advanced/inline-javascript"
audiences:
  - less
origin: less
---

> Backtick inline JavaScript (`` `expr` ``) is removed in Less 5.x. Script behavior
> now goes through explicit `@from` / `@-from` or `@use` / `@-use` module
> boundaries.

Legacy Less could execute inline JavaScript embedded in backticks anywhere a value
was expected:

```less
// 4.x (removed in 5.x)
@columns: `Math.max(12, 8) `;
@version: ` "2026-03" `;
```

This was a real security concern — any string that reached the compiler could run
arbitrary JavaScript — and it made values hard to reason about statically. Less 5.x
**removes inline backtick JavaScript entirely.** It is not an opt-in flag; the
syntax reports a fatal unsupported-syntax diagnostic and no longer evaluates as
JavaScript.

## What to do instead

**Use a plain Less expression or function** when the value can be expressed in Less:

```less
@columns: max(12, 8);
@version: "2026-03";
```

**Use `@from` / `@-from` or a `@use` / `@-use` script module** when you genuinely
need JavaScript. Script modules replace implicit inline execution with an
explicit, sandboxed
import:

```less
@use "./columns.js";

.grid {
  grid-template-columns: repeat(columns.count(), 1fr);
}
```

Script modules run under an opt-in runtime (`@jesscss/plugin-js`, executing on
Deno), which is secure by default: scripts cannot read outside the configured
sandbox root, cannot access environment variables, and cannot use the network
unless policy explicitly allows it. JSON imports are data-only and need no runtime.

To disable executable script modules entirely, use `disableScriptModules` (this
also disables file-based `@plugin`).

## The `@-` compiler at-rules

`@use` is one of the namespace-safe **compiler at-rules**. In `.less` files the bare
form is tolerated; the dash-prefixed `@-use` form makes it explicit that this is the
compiler directive rather than a CSS at-rule. See
[Modules and Imports](../features/modules-and-imports.mdx) for the full family
(`@-import`, `@-compose`, `@-use`, `@-from`, `@-export`).

See also: [Plugins](../features/plugins.md) · [Migrating to v5](../usage/migrating-to-v5.md#safer-javascript-execution-model).
