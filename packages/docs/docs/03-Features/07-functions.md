---
id: functions
title: Functions
---

You can, of course, import functions and call them in a JS expression, like:

```less
@import { myFunction } from './functions.js';

.box {
  content: $myFunction();
}
```
However, Jess has a feature where, like Less, it will attempt to evaluate CSS functions as JS functions calls if that call was imported in scope.

The reason you might want to do that is to parse a function value as, say, a dimension, like:

```less
@import { double } from './functions.js';

.box {
  width: double(10px);
}
```
Your `double` function may output something like:
```css
.box {
  width: 20px;
}
```