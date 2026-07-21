---
id: string
title: String Functions
sidebar_label: String
audiences:
  - jess
origin: jess
---
As with all `@jesscss/fns` helpers, string functions must be imported before use.

### e(_string_)

Returns the content of a quoted string as-is, without quotes. Useful for emitting a
CSS value that isn't valid CSS syntax, or that uses proprietary syntax Jess doesn't
recognize. Mirrors Less's `e()`.

```css
@-from '@jesscss/fns' import (e);
.filter {
  $mscode: "ms:alwaysHasItsOwnSyntax.For.Stuff()";
  filter: e($mscode);
}
```
Output:
```css
.filter {
  filter: ms:alwaysHasItsOwnSyntax.For.Stuff();
}
```

### escape(_string_)

Applies [URL-encoding](https://en.wikipedia.org/wiki/Percent-encoding) to special
characters in the input string. `encodeURI` is applied first, then the characters
`=`, `:`, `#`, `;`, `(` and `)` are additionally escaped. Mirrors Less's `escape()`.

```css
@-from '@jesscss/fns' import (escape);
.box {
  content: escape('a=1');
}
```
Output:
```css
.box {
  content: a%3D1;
}
```

### replace(_string_, _pattern_, _replacement_[, _flags_])

Replaces text within a string using a JavaScript regular expression. When the input
is a non-escaped quoted string the result keeps its quoting; otherwise it is returned
as an unquoted value. `$1`-style group references are supported in the replacement.

```css
@-from '@jesscss/fns' import (replace);
.box {
  a: replace("Hello, Mars?", "Mars\?", "Earth!");
  b: replace("One + one = 4", "one", "2", "gi");
}
```
Output:
```css
.box {
  a: "Hello, Earth!";
  b: "2 + 2 = 4";
}
```

### format(_template_[, _args..._])

The string-format function, mirroring Less's `%(…)`. Placeholders in `template`
start with `%` followed by `s`, `S`, `d`, `D`, `a` or `A`, and are replaced by the
following arguments in order. Uppercase placeholders (`%S`/`%D`/`%A`) URL-encode the
substituted value; `%%` emits a literal `%`.

:::info

This is the internal `%` function exposed under the JavaScript export name `format`.
Its public alias is still being finalized — see the
[String Formatting](../06-Advanced/03-string-formatting.md) guide.

:::

```css
@-from '@jesscss/fns' import (format);
.box {
  a: format("repetitions: %s file: %s", 1 + 2, "directory/file.less");
  b: format("repetitions: %S file: %S", 1 + 2, "directory/file.less");
}
```
Output:
```css
.box {
  a: "repetitions: 3 file: directory/file.less";
  b: "repetitions: 3 file: directory%2Ffile.less";
}
```
