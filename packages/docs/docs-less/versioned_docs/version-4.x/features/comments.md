---
title: "Comments"
slug: "/features/comments"
audiences:
  - less
origin: less
---
:::note
Comment semantics in Less follow CSS expectations with additional single-line silent comments.
:::

## CSS Comments

CSS-style comments are preserved by Less:

```less
.class {
  /* Hello, I'm a CSS-style comment */
  color: black
}
```

## Less Comments

Single-line comments are also valid in Less, but they are ‘silent’, they don’t show up in the compiled CSS output:

```less
.class {
  // Hi, I'm a silent comment, I won't show up in your CSS
  color: white
}
```

:::info
Future enhancements for this page include documenting `/*! ... */` and `--s0`/`--s1` output options.
:::

