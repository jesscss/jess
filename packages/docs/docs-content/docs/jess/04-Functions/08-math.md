---
id: math
title: Math Functions
sidebar_label: Math
audiences:
  - jess
origin: jess
---

Arithmetic in Jess is a language form, not a function. Wrap the expression in
`$( … )` and Jess evaluates it, preserving node types (dimensions keep their
unit; colors stay colors).

:::caution `op()` is retired

Pre-2.x Jess spelled arithmetic `op(2px * 3)` and required importing `op` from
`@jesscss/fns`. That function no longer exists — it is not in the package and not
in the Jess built-in function set. Use `$( … )` instead; nothing needs importing.

:::

## Example

```css
$myDimension: 3px;

.box {
  one: $(2px * 3);
  two: $(2px * 3 * 2);
  three: $($myDimension * 3);
  color: $(#333 * 2);
}
```
Output:
```css
.box {
  one: 6px;
  two: 12px;
  three: 9px;
  color: #666666;
}
```

:::info

Only what you put inside `$( … )` is evaluated. Everything else is preserved
verbatim.

:::

:::caution Not yet implemented

Parenthesized sub-groups inside `$( … )` — `$(2px * (2 + 1))` — are **not**
accepted by the current parser. Split the expression, or precompute the group
into a variable, until grouping lands.

:::

See [Expressions](/docs/Language/expressions) for operator precedence, unit
conversion, and division rules.
