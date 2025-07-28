---
id: variables
title: Variables
---

Jess variables are named with `$`.

```css
$my-color: #ABC;
```

Variables are referenced using the `$` symbol.
```css
.box {
  color: $my-color;  // or #($my-color)
}
```

### Collections and Maps

You can create a collection/map like this:
```less
$theme: {
  colors: {
    primary: blue;
    secondary: green;
  }
  other: value;
}
```
This can be referenced like a JS object, like this:
```less
.box {
  color: $theme.colors.primary;
}
```

## Theming

You can compose themes with stylesheets by passing in new values to use when evaluating it.

Say I have this stylesheet:

```css
// library.jess
$colors: {
  primary: blue;
}

.box {
  color: $colors.primary;
}
```
I can change the way it evaluates with the following:
```css
@-compose './library.jess' with {
  $colors +: {
    primary: rebeccapurple;
  }
}
```

:::info

The `+:` means `$colors = $colors + { ... }`. When Jess adds a collection to another collection (or a JS object to another object), it will merge values.

:::


This will produce the following:
```css
.box {
  color: rebeccapurple;
}
```

