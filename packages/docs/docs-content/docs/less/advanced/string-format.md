---
title: "String Formatting (%()) "
slug: "/advanced/string-format"
audiences:
  - less
origin: less
---

> The `%(...)` format function still works in Less 5.x, but it is now a thin compat
> alias that lowers to an ordinary string-format call. Interpolation is the
> canonical way to build strings.

Less has long supported a `printf`-style format function written with the `%`
symbol: `%("format", args...)`. In 5.x this is treated as a **compatibility alias**.
It parses as a plain call to the built-in string-format function; it is no longer a
special syntactic form.

## Basic usage (unchanged)

```less
.a {
  width: %("rgb(%d, %d, %d)", 255, 0, 0);
}
```

```css
.a {
  width: "rgb(255, 0, 0)";
}
```

The tokens work as before:

- `%d`, `%s`, `%a` — insert the next argument. `%s` inserts a quoted string with its
  quotes stripped.
- An uppercase token (`%A`, `%S`, `%D`) URL-encodes the inserted value.
- `%%` emits a literal `%`.

```less
.b { x: %("hello %s", "world"); }        // -> "hello world"
.c { x: %("red is %A", #ff0000); }       // -> "red is %23ff0000"
.d { x: %(~"hello %s", "escaped world"); } // -> hello escaped world (unquoted)
```

The quote style of the format string is preserved, and an escaped (`~"..."`) format
string renders unquoted.

## Values inside the format string stay verbatim

Because arguments are inserted as their [verbatim value](./verbatim-values.md), a color
like `#123` prints as `#123`, not a canonicalized form:

```less
.e { x: %("%s", #123); }   // -> "#123"
```

## Prefer interpolation for new code

String interpolation is the canonical, forward-looking way to assemble strings in
the 5.x line — it is clearer and does not depend on positional `%` tokens. Reach
for `%()` mainly when porting existing Less that already uses it.

:::note
`%(...)` is the compatibility alias; the underlying function is the public
**`string-format`** function. (It is deliberately not named `format`, to avoid
colliding with CSS `format()`.) You can call `string-format(...)` directly instead
of `%(...)`:

```less
.a { x: string-format("rgb(%d, %d, %d)", 255, 0, 0); }  // -> "rgb(255, 0, 0)"
```
:::

See also: [Verbatim values](./verbatim-values.md) · [String functions](../functions/string-functions.md).
