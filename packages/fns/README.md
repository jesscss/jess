# Less / Sass / Jess functions

Helper functions, migrated from Less and Sass, with additions.

```less
@-from '@jesscss/fns' import (brighten);

.box {
  color: $brighten(#ABC, 20%);
}
```

Note: in most cases, these functions are called internally and some require a context
object passed into the `this` context. At some point, this library
may be expanded to make the functions a little more general purpose / callable from
JavaScript.

### Tree shaking

Functions and helpers are separated into different files for optimal tree shaking