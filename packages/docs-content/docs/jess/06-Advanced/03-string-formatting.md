---
title: "String formatting & interpolation"
sidebar_label: String formatting
audiences:
  - jess
origin: jess
---

In Jess, **interpolation is the canonical way to build strings.** It reads clearly
and does not depend on positional format tokens:

```jess
$name: world;
.a {
  content: "hello $[name]";   // -> "hello world"
}
```

## The `%()` compatibility alias

Jess also accepts Less's `printf`-style `%(...)` format function for compatibility.
It is a thin alias that lowers to an ordinary string-format call — not a special
syntactic form:

```jess
.a { x: %("rgb(%d, %d, %d)", 255, 0, 0); }  // -> "rgb(255, 0, 0)"
.b { x: %("hello %s", "world"); }            // -> "hello world"
```

Tokens: `%d`/`%s`/`%a` insert the next argument (`%s` strips quotes); an uppercase
token URL-encodes; `%%` emits a literal `%`. Because arguments insert as their
[verbatim value](./02-verbatim-values.md), `%("%s", #123)` yields `"#123"`.

**Prefer interpolation for new Jess code**; reach for `%()` mainly when porting
existing Less.

:::note
`%(...)` is the compatibility alias for the public **`string-format`** function
(named `string-format` rather than `format` to avoid colliding with CSS `format()`).
You can call it directly:

```jess
.a { x: string-format("rgb(%d, %d, %d)", 255, 0, 0); }  // -> "rgb(255, 0, 0)"
```
:::

See also the Less
[String Formatting](https://lesscss.org/docs/advanced/string-format) page.
