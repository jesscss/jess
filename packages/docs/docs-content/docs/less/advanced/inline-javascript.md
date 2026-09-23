---
title: "Inline JavaScript Removed"
slug: "/advanced/inline-javascript"
audiences:
  - less
origin: less
---

> Backtick inline JavaScript (`` `expr` ``) is removed in Less 5.x.

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

**Use a preloaded plugin or the deprecated `@plugin` bridge** when JavaScript is
unavoidable today. Executable plugin files run through the opt-in
`@jesscss/plugin-js` Deno sandbox: scripts cannot read outside the configured
root, access environment variables, or use the network unless policy allows it.

To disable executable script modules entirely, use `disableScriptModules` (this
also disables file-based `@plugin`).

## Planned script modules

`@use` and `@from` are reserved for explicit script and data module imports,
but Less 5 does not recognize or execute them as modules yet. See
[Modules and Imports](../features/modules-and-imports.mdx) for the canonical
support status. Do not migrate production code to those spellings until that
page marks them available.

See also: [Plugins](../features/plugins.md) · [Migrating to v5](../usage/migrating-to-v5.md#safer-javascript-execution-model).
