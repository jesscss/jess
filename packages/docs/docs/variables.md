---
id: variables
title: Variables
---

In Jess, you can declare variables using the `@let` at-rule.

```scss
@let myColor: #ABC;
```
_Note: variables at the root of the document are automatically exported (with `export let`)._

Variables are referenced using the `$` symbol.
```scss
.box {
  color: $myColor;  // or $(myColor)
}
```

### Collections and Maps

You can create a collection/map like this:
```less
@let theme {
  colors {
    primary: blue;
    secondary: green;
  }
  other: value;
}
```
This can be referenced like a JS object (which it is), like this:
```less
.box {
  color: $theme.colors.primary;
}
```

## Theming

Variables in Jess stylesheets are _default values_. Meaning that you can pass in new values to a stylesheet when `@include`-ing that stylesheet.

Say I have this stylesheet:

```scss
// library.jess
@let colors {
  primary: blue;
}

.box {
  color: $colors.primary;
}
```
I can change the way it evaluates with the following:
```scss
@import library from './library.jess';

@let overrides {
  colors {
    primary: rebeccapurple;
  }
}

@include library($overrides);
```

This will produce the following:
```scss
.box {
  color: rebeccapurple;
}
```

