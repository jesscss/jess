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
JavaScript. Editors underline the complete backtick expression and continue
parsing the rest of the stylesheet.

## What to do instead

**Use a plain Less expression or function** when the value can be expressed in Less:

```less
@columns: max(12, 8);
@version: "2026-03";
```

**Load a JavaScript module with `@use`** when JavaScript is unavoidable. Less
derives the namespace from the file name and makes exported functions available
through that namespace:

```less
@use "./asset.js";

.build {
  version: @asset.version();
}
```

Local or package JavaScript and TypeScript modules run through the opt-in
`@jesscss/plugin-js` Deno sandbox. Scripts cannot read outside the configured
root, access environment variables, or use the network unless policy allows it.
Use `@plugin` only for legacy Less plugin modules; it is deprecated in favor of
`@use`.

To disable executable script modules entirely, use `disableScriptModules` (this
also disables file-based `@plugin`).

Less does not accept an `as` clause on `@use` and does not implement `@from`.
See [Modules and Imports](../features/modules-and-imports.mdx) for the complete
module syntax.

See also: [Plugins](../features/plugins.md) · [Migrating to v5](../usage/migrating-to-v5.md#safer-javascript-execution-model).
