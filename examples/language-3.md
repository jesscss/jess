WIP - STILL PLAYING WITH SYNTAX


First, like Less or Sass, a valid `.css` file is a valid `.jess` file.
```less
// box.jess

.box {
  color: red;
}
```

However, unlike Less/Sass, this doesn't immediately transpile to CSS. Instead, it transpiles to an intermediate JS module,
which will look something like:
```js
const def = () => {
  return {
    css: [`
      .box {
        color: red;
      }
    `],
    box: 'box'
  }
}

export default def
```

So far, so good. It looks something like a CSS module. Big deal.

However, the Jess file itself allows you to import other modules. Unlike Sass and Less,
these can be any other JS module, or another Jess file, using `@import` for either.

### Imports

Here's an example:

```less
@import {colors} from './constants.js';
```
How would you use that? You can imagine the rest of the file as a JS template block, wrapped in ``` `` ``` characters.
This means you can use `${}` tags in your styles to evaluate a JS expression and output a string.
```less
@import {colors} from './constants.js';

.box {
  color: ${colors.foreground};
}
```

For convenience, you can declare JavaScript variables inline with `@var`.

```less
@var blockType: 'inline';

.box {
  display: ${blockType === 'inline' ? 'inline' : 'block'};
}
```
In simplified terms, this will return what you would expect, a template string that looks like:
```js
// this is an oversimplification of output code, but demonstrates the 1-to-1 relationship with JS
let blockType = 'inline'

return css`.box {
  display: ${String(blockType === 'inline' ? 'inline' : 'block')};                 
}`
```
_Note: this isn't what the "final" `<style>` tag will look like returned to your component or stylesheet,
as Jess will do a number of other optimizations to create efficient style injection. See: Advanced (TODO)_

### Wrapping CSS in JS expressions

While you're in a `${}` JavaScript expression, you can "switch" back into CSS mode with backticks, and use that as part of the returned expression. (This is also useful for determining code coloring / hinting in IDEs.)

```less
@import {each} from 'jess/helpers';

@var arr: ['50px', '100px', '200px'];

${each(arr, (value, index) => `
  .col-${index} {
    width: ${value};
  }
`)}
```
This will get translated pretty straightforwardly.
```js
import {each} from 'jess/helpers';

let arr = ['50px', '100px', '200px'];

each(arr, (value, index) => `
  .col-${index} {
    width: ${value};
  }
`)
```
The `each` helper is pretty simple:
```js
import {CSSBuilder} from 'jess'

// for CSS blocks you need to concat and return
let css = new CSSBuilder()

export const each = (arr, func) => {
  arr.forEach((value, index) => {
    css(func(value, index))
  })
  return css
}
```

When all is said and done, you would end up with styles like:
```css
.col-1 {
  width: 50px;
}
.col-2 {
  width: 100px;
}
.col-3 {
  width: 200px;
}
```

### Migrating from Sass / Less

Because you have the entire power of JavaScript at your disposal, nothing else really needs to be added into the language.
For example, need a mixin? Just use a function.

```js
// functions.js
import {css} from 'jest';

export function square(size) {
  return css`
    width: ${size}px;
    height: ${size}px;
  `
}
```

```less
@import {square} from './functions.js';

.box {
  ${square(50)}
}
```

Want to add color functions?

```less
@import {mix} from 'jess/color';
@import {Colors} from './constants';

.box {
  background: ${mix(Colors.theme, `#000000`, 0.5)};
}
```
This will evaluate at compile time, and you'll end up with something like:
```css
.box {
  background: #ec0233;
}
```
Sass control blocks like `@each`, `@for`, and `@if` are not needed, because all of those constructs exist in JavaScript, and you can add additional helper functions that you pass blocks of declarations to.


### State variables

So far, all the examples have demonstrated how to create essentially static CSS. The JavaScript is evaluated at compile-time, and either used as a `.css` in a `<link>` tag or as `<style>` HTML injected with your component.

Jess has one more syntax variant for variables which is a `@public` at-rule. What it is is an exposed state property used to create dynamic styling. This makes Jess more powerful than straight CSS modules.

```less
// main.jess

// state variable
@public color: 'red';

.box {
  background: white;
  color: ${color};
}
```

In your component:
```jsx
import styles from './main.jess'

const MyComponent = props => {
  const style = styles({color: props.color})
  <div className={style.box} />
}

export default MyComponent
```

In order to keep things efficient, Jess will split styles that are dynamic. Meaning, the output will eventually look something like:
```html
<style>
  .box {
    background: white;
    color: var(--box-1, red);
  }
</style>

<!-- only this style tag will get updated on state changes, for a limited render tree update -->
<style>
  .box-variant-1 {
    --box-1: red;
  }
</style>

<div class="box box-variant-1" />

```

### Importing from other Jess files

`@var` and `@public` are available as exports on Jess-compiled files. So why is one marked public? _(Should it be marked `@interface` or `@state`?)_ Basically, `@var`s are a way to mark values that are safe for static compile-time evaluation. That means that anything depending on a `@var` variable will not change, and the CSS can be statically exported.

Conversely, as noted above, `@public` variables expose an interface in the JS module that means that anything evaluated using it must also export a function (and any dependencies) in a bundle so that it can be re-computed in the future.

```less
// theme.jess
@import {mix} from 'jess/color';

// This is just a regular JS object
@var {
  colors: {
    background: `#000`,
    foreground: `#FFF`,
    halfway: mix(colors.background, colors.foreground, 0.5)
  }
}
```
```less
@import {colors} from './theme.jess';

.box {
  color: ${colors.foreground};
}
```
Jess files can use the same JS API to change evaluation of an instance of the underlying module. Because they're marked with `@var`, the resulting output is still static at compile-time.

```less
// main.jess

@import styles from './theme.jess';

@var {colors: styles({colors: {background: `#F00`}}).colors}

.box {
  color: ${colors.halfway};
}
```
Output is:
```less
.box {
  color: #fffefe;
}
```

If, however, the colors were marked with public, the output would be more like:
```less
.box {
  color: var(--box-color, #fffefe);
}

// this would be marked for dynamic updates
.box {
  --box-color: #fffefe;
}
```
With a JS object that would have...
```js
import {mix} from 'jess/functions';
// ...
['--box-color', () => mix(colors.background, colors.foreground, 0.5)]
// ... does stuff
```
... as part of the bundle.
