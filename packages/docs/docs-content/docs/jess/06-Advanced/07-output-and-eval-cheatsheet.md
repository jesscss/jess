---
title: "Output & evaluation cheat sheet"
sidebar_label: Output & eval cheat sheet
audiences:
  - jess
origin: jess
---

A quick reference for **how Jess formats output** and **how it evaluates** the
trickier corners, each with a tiny input → output. The shared formatting and
evaluation rules are the same engine as the Less site; the Jess-flavored
specifics (interpolation spelling, Sass+ strictness) are at the end.

## Output formatting

### Un-operated values are source-verbatim
Un-operated dimensions, colors, keywords, and quoted strings emit exactly as
written; only computed results (and compressed output) canonicalize.

```jess
.a { width: 1.0px; height: 2PX; color: #989; }
```
```css
.a { width: 1.0px; height: 2PX; color: #989; }
```
See [Verbatim values](./02-verbatim-values.md).

### Operators and separators are spaced
`/`, `+`, `-`, `*`, and list commas print **with surrounding spaces**, no matter
how you wrote them — they are separators, not values.

```jess
.a { margin: 12px/16px; grid-area: 1/2/3/4; }
```
```css
.a { margin: 12px / 16px; grid-area: 1 / 2 / 3 / 4; }
```

### Exception: `:nth-*()` `An+B` stays unspaced
The `An+B` microsyntax is selector syntax — never spaced, never evaluated.

```jess
.a:nth-child(2n+1) { color: red; }
```
```css
.a:nth-child(2n+1) { color: red; }
```

### Function shape passes through verbatim
`name(...)` with **no space** before `(` emits verbatim, even for names that are
not real CSS functions.

```jess
.a { border: 1px solid(#a8000b); }
```
```css
.a { border: 1px solid(#a8000b); }
```

### Grouping parens dissolve after evaluation
`keyword (expr)` — a **space** then parens — is math grouping. Once the
expression computes, the parens do not survive to output. (A no-space
`keyword(expr)` is the function shape above and stays verbatim.)

```jess
$a: #a80000; $b: #00000b;
.a { border: 1px solid ($a * .66 + $b * .33); }
```
```css
.a { border: 1px solid #a8000b; }
```

### Color functions pass through un-operated
CSS-shaped `rgb`/`rgba`/`hsl`/`hsla` with three or more argument slots and no
operation emit verbatim; the function runs when the value is operated on or
given a Less overload/variable argument. Less one-/two-slot overloads such as
`rgba(#fff)` dispatch normally.

```jess
.a { color: hsl(200, 50%, 40%); }               // verbatim
.b { color: lighten(hsl(200,50%,40%), 10%); }   // computed
```

### Nested output + `:is()` compaction
Output is nested by default (`collapseNesting: false`); `@media` is not merged;
extend cascades are `:is()`-compacted. See [Output model](./01-output-model.md)
and [Extend](./05-extend.md).

## Evaluation

### Escaped `~"..."` is opaque
An escaped string is never sniffed as a number. `=` compares by content
(`3 = ~"3"` is true); `<`/`>` against a number is not comparable, so a guard
using them does not fire.

### Mixin self-reference is a no-op
A non-parametric ruleset that calls itself excludes its own frame — it renders
once and never errors.

### Mixin variable leaks are low priority
A variable a mixin unlocks into the caller is low priority: a lexical binding
always wins, and the leaked variable is used only where nothing lexical binds.

### `if()` / `boolean()` are branch-lazy
The branch not taken is never evaluated.

```jess
.a { width: if(false, 1/0, 7px); }
```
```css
.a { width: 7px; }
```

### `@import (reference)` is hidden until pulled in
Reference imports emit nothing on their own; their rules appear only where you
`$extend` them or call an imported mixin.

### Resolve failures are errors
Any failed variable resolve is a hard error unless the resolve is explicitly
optional. There are no cyclic variables — `$a: 1; $a: $a + 1;` yields `2`. See
[Advanced variable resolution](../02-Language/02a-advanced-variable-resolution.mdx).

## Jess-flavored specifics

- **Three `$` forms, one per position**: `${…}` interpolates in identifier
  positions (selectors, property names, at-rule preludes) and in strings;
  `$[…]` (lookup) and `$(...)` (expression) are value-position forms, and
  `$(...)` is also allowed in strings. Inside `${…}`, `${tone}` is the variable
  and `${[tone]}` the lookup — see
  [Interpolation](../02-Language/08-interpolation.mdx).
- **Variables:** `$name` is a live reference; `$$name` is the scoped/final
  lookup. `$name := value` updates the live/current binding; `$$name := value`
  updates the scoped/final binding.
- **Sass+ rejects invalid CSS**: where Sass tolerates invalid CSS (escaped at-rule
  keywords, bogus combinators), Jess's "Sass+" dialect rejects it — valid CSS is
  the target, not Sass parity.
