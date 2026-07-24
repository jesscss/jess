---
id: list
title: List Functions
sidebar_label: List
audiences:
  - jess
origin: jess
---

Jess has no list-iteration *function*. Iterating a list is a language form,
`$for`, not something you import from `@jesscss/fns`.

:::caution `each()` is retired

Pre-2.x Jess spelled list iteration `@include $each(list, mixin);` with an
`@mixin` definition. That syntax no longer exists: `each` is not registered in
the Jess built-in function set, and `@let` / `@mixin` / `@include` are not Jess
at-rules. Use `$for` instead. (The `each()` helper still ships in `@jesscss/fns`
for **Less** sources — it is Less's `each()`, not a Jess API.)

:::

## Iterating a list with `$for`

```css
$list: 1, 2, 3;

iterate($value, $key) {
  .icon-$[value] {
    width: $value;
    height: $key;
  }
}

$for ($value, $key of $list) {
  $ > iterate($value, $key);
}
```

This outputs:
```css
.icon-1 {
  width: 1;
  height: 1;
}
.icon-2 {
  width: 2;
  height: 2;
}
.icon-3 {
  width: 3;
  height: 3;
}
```

:::info

For a list, the key is its **1-based** source-order position. (In the example
above the values happen to equal their positions, so `width` and `height` match.)
For a Jess collection the key is the declaration name.

:::

You don't need a mixin at all if the body is simple:

```css
$sections: header, sidebar, footer;

$for ($section, $i of $sections) {
  .box-$[section] {
    padding-left: $($i * 20px);
  }
}
```

See [Conditionals & iteration](/docs/Language/conditionals-iteration) for ranges,
collection destructuring, and the full set of `$for` header shapes.
