### The Quick and Dirty

TL;DR --

Be able to do this...
```jsx
import styles, { myMixin } from 'component.jess'
const css = styles()

export const myComponent = props => {
  return <div className={css.box} style={myMixin(props.something)}>foo</div>
}
```
...with this...
```less
@mixin myMixin(something) {
  width: $something;
  color: white;
}
.box {
  display: flex;
  align-items: center;
}
```
### The Reason for Jess

Less and Sass are powerful tools to create styles. Then came reactive front-end component development. We wanted modules, and we wanted scoped CSS. So we created CSS modules. But what about dynamic modules? So we tried to put CSS in JavaScript.

But what if your stylesheets:

1. Could be in stylesheets, like CSS, Less, and Sass.
2. Could be JS modules, like CSS modules.
3. Could be completely dynamic when it needed to be, like CSS-in-JS, or Less in the browser.

Instead of having a whole programming language just for your stylesheet, like Sass, why not just use JavaScript where you need it?

Instead of putting CSS in your JavaScript, why not put JavaScript in your CSS?


First, like Less or Sass, a valid `.css` file is a valid `.jess` file.
```less
// box.jess
.box {
  color: red;
}
```

However, unlike Less/Sass, this doesn't immediately transpile to CSS. Instead, it transpiles to an intermediate JS module, which you can use like:
```jsx
import styles from 'box.jess'

function myComponent() {
  return <div className={styles.box}>foo</div>
}
```

So far, so good. It looks something like a CSS module. Big deal.

However, the Jess file itself allows you to import other modules. Unlike Sass and Less, these can be any other JS module, or another Jess file, using `@import` for either.

### Imports

Here's an example:

```less
@import {colors} from './constants.js';
```
How would you use that? You can reference JS expressions with `$`

```less
@import {colors} from './constants.js';

.box {
  color: $colors.foreground;
}
```

`$` treats everything as JavaScript until it hits something it can detect as the end of the expression, like white-space, a semi-colon, or an independently-parseable token.

If you need to, you can wrap your JS expression in parens, like:

```less
@import { WIDTH } from './constants.js';

.box {
  width: $(WIDTH + 10)px;
}
```

To clarify, the following JS expression is continuous because of matching parens:
```less
@import { myColor } from './colors.jess';
@import { Color } from './util.js';

.box {
  color: $Color.mix(myColor, 0.5);
}
```

### Jess Variables

Jess variables are declared using the `@let` at-rule. Like Less or Sass, the value of a Jess variable can look like a CSS value.

For the most part, it's very similar to what you're used to in Less / Sass, with the only difference in Jess being variable names need to follow JS identifier rules (because they need to be callable, valid JS exports).

```less
@let color: #333;
@let myBorder: 1px solid black;
```
It can be pretty much any JS value as well, as long as it can be stringified with a `.toString()` method
```less
@let foo: $myValue;
@let bar: $'keyword';
```
And, of course, like Less or Sass, you can inter-mix JS and CSS values:
```less
@let myBorder: 1px solid $myColor;
```

#### Collections and Maps

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

#### Evaluating CSS in JS functions

You can "send" a CSS value to a TS/JS function in one of two ways.

1. you can assign your CSS values to Jess variables.

```less
@import { mix } from './color-functions.ts';

.box {
  @let color1: #FF0;
  @let color2: #3F0;
  background-color: $mix(color1, color2, 0.5);
}
```
2. For convenience, however, like Less you can call functions in a CSS context, and it will be forwarded to the function within the current scope, as in:
```less
@import { mix } from './color-functions.ts';

.box {
  background-color: mix(#FF0, #3F0, 0.5);
}
```
Note, though, that in the first example, the last argument will be a primitive JavaScript `Number`, and in the second example, as the arguments are being parsed in Jess, it will be a `Dimension` with a `value` property set to 0.5.

_NOTE: Also like Less, functions that are not defined in the current scope will output a CSS function, as you would expect._

As in, the following's output will be like its input.
```less
.box {
  color: rgb(1, 1, 1);
}
```

#### Dynamic Runtime evaluation

_To be explained in detail elsewhere_

TL;DR version is -- a `.jess` file can/will output:

1. A `.css` file with a `.css.map` source map
2. A `.js` module with a `.js.map` source map

This means that a `.jess` file is, unlike Sass / Less, tree shake-able. The Jess Rollup or Webpack plugin will do this automatically, and bundle your `.js` module, as well as output static `.css` for your assets, for a rapid first paint.

### Theming

```less
// library/theme.jess
@import mix from '@jesscss/functions/mix';

@let themeColor: blue;
@let colors {
  darkTheme: mix(themeColor, white, 50%);
}

// main.jess
@import css from 'library/theme.jess';

@let theme {
  themeColor: red;
}
@let colors: $css(theme).colors;

.box {
  color: $colors.darkTheme;
}
```
Output is:
```less
.box {
  color: #660000;
}
```

#### Creating a custom theme

You can create a custom theme by passing new values into the theme stylesheet, like:
```less
// my-theme.jess
@import css from 'library/theme.jess';
@import * as colors from './colors.jess';
@import * as otherVars from './vars.jess';

@let config {
  colors: something
}
@let theme: $css(config).theme;

// main.jess
@import { theme } from './my-theme.jess';

.box {
  color: $(theme.color); // or $theme.color
}
```

### Migrating from Sass / Less
#### Nesting

To make migration / code compatibility easier, like Less and Sass, Jess supports basic CSS + Nesting.
```less
.button {
  color: red;
  &:hover {
    color: blue;
  }
}
```

#### At-Rule bubbling

```less
a {
  color: blue;
  @media all { 
    color: rebeccapurple;
  }
}
```
```less
a {
  color: blue;
}
@media all {
  a {
    color: rebeccapurple;
  }
}
```

#### Mixins / Functions

You can easily define the equivalent of a "mixin" by writing a normal function.

```js
// functions.js
import { dimension } from 'jess/tree'

export const square = (size) => ({
  width: dimension({value: size, unit: 'px'}),
  height: dimension({value: size, unit: 'px'})
})
```

_TODO_
```less
@import {square} from './functions.js';

.box {
  @include square(50);
}
```

However, for syntactic convenience, you can write: 
```less
@mixin square (size) {
  width: $size;
  height: $size;
}
.box {
  @include square(50);
}
```
The mixin is similar to the JS export. In fact, you could have done:
```less
// Notice the import is from a `.jess` file instead of a `.js` file
@import {square} from './mixins.jess';

.box {
  @include square(50);
}
```

**Similarly, functions are just as easy**

You can just use JS functions!
```js
import { dimension } from 'jess/tree'
// calcPercent.js
export function calcPercent(target, container) {
  return dimension({
    value: (target / container) * 100,
    unit: '%'
  });
}
```
```less
@import { calcPercent } from './calcPercent.js';

.my-module {
  width: $calcPercent(650, 1000);
}
```


### React-like style binding

You can use mixins to bind to the style property on a component. Like:
```jsx
import styles, { myMixin } from 'component.jess'
const css = styles()

export const myComponent = props => {
  return <div className={css.box} style={myMixin(props.something)}>foo</div>
}
```
