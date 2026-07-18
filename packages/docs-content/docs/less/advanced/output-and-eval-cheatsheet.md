---
title: "Output & Evaluation Cheat Sheet"
slug: "/advanced/output-and-eval-cheatsheet"
audiences:
  - less
origin: less
---

> A quick reference for **how Less 5.x formats output** and **how it evaluates**
> the trickier corners — with a tiny input → output for each rule.

The individual Advanced pages go deeper; this page is the fast lookup. Rules that
are *Less-flavored* (interpolation spelling, escapes) are called out at the end.

## Output formatting

### Un-operated values are source-verbatim
Un-operated dimensions, colors, keywords, and quoted strings emit exactly as
written; only *computed* results (and compressed output) canonicalize.

```less
.a { width: 1.0px; height: 2PX; color: #989; }
```
```css
.a { width: 1.0px; height: 2PX; color: #989; }
```
See [Verbatim Values](./verbatim-values.md).

### Operators and separators are spaced
`/`, `+`, `-`, `*`, and list commas print **with surrounding spaces**, regardless
of how you wrote them. They are separators, not values.

```less
.a { margin: 12px/16px; grid-area: 1/2/3/4; }
```
```css
.a { margin: 12px / 16px; grid-area: 1 / 2 / 3 / 4; }
```

### Exception: `:nth-*()` `An+B` stays unspaced
The `An+B` microsyntax is selector syntax — it is never spaced and never
evaluated.

```less
.a:nth-child(2n+1) { color: red; }
```
```css
.a:nth-child(2n+1) { color: red; }
```

### Function shape passes through verbatim
`name(...)` with **no space** before `(` is emitted verbatim, even for names that
are not real CSS functions.

```less
.a { border: 1px solid(#a8000b); }
```
```css
.a { border: 1px solid(#a8000b); }
```

### Grouping parens dissolve after evaluation
`keyword (expr)` — a **space** then parens — is math grouping. Once the
expression computes, the parens do not survive to output. (A no-space
`keyword(expr)` is the function shape above and stays verbatim.)

```less
@a: #a80000; @b: #00000b;
.a { border: 1px solid (@a * .66 + @b * .33); }
```
```css
.a { border: 1px solid #a8000b; }
```

### Color functions pass through un-operated
`rgb`/`rgba`/`hsl`/`hsla` with literal args and no operation emit verbatim; the
function only runs when the value is operated on or given Less/variable arguments.

```less
.a { color: hsl(200, 50%, 40%); }        // verbatim
.b { color: lighten(hsl(200,50%,40%), 10%); }  // computed
```
```css
.a { color: hsl(200, 50%, 40%); }
.b { color: #4d9fd9; }
```

### Nested output + `:is()` compaction
Output is nested by default (`collapseNesting: false`); `@media` is not merged;
extend cascades are `:is()`-compacted. See [Output Model](./output-model.md) and
[Extend and `:is()` Wrapping](./extend-is-wrapping.md).

## Evaluation

### Escaped `~"..."` is opaque
An escaped string is never sniffed as a number. `=` compares by content
(`3 = ~"3"` is true); `<`/`>` against a number is not comparable, so a guard
using them does not fire.

### Mixin self-reference is a no-op
A non-parametric ruleset that calls itself excludes its own frame — it renders
once and never errors.

```less
.a { color: red; .a(); }
```
```css
.a { color: red; }
```

### Bare `@var` in an at-rule prelude is an error
A bare variable in an at-rule prelude is rejected in 5.x (use `@{var}`
interpolation). A `@var` inside a declaration-value paren is fine.

```less
@supports (@{cond}) { .a { color: red; } }   // ok
// @supports (@cond) { ... }                 // error in 5.x
```

### `if()` / `boolean()` are branch-lazy
The branch that is not taken is never evaluated.

```less
.a { width: if(false, 1/0, 7px); }
```
```css
.a { width: 7px; }
```

### `@import (reference)` is hidden until pulled in
Reference imports emit nothing on their own; their rules appear only where you
`:extend` them or call an imported mixin.

### Resolve failures are errors
Any failed variable resolve is a hard error unless the resolve is explicitly
optional. There are no cyclic variables — `@a: 1; @a: @a + 1;` yields `2`.

## Less-flavored specifics

- **Interpolation** uses `@{name}` and resolves a **single identifier** into
  selectors, property names, and values.
- **Variables** are written `@name`; regular variables are lazy and last-wins
  within a scope.
- **Escaping** uses `~"..."` (see the opaque-comparison rule above).

See also: [Output Model](./output-model.md) ·
[Verbatim Values](./verbatim-values.md) · [Operations](../features/strictmath.md).
