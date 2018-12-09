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

For convenience, you can declare JavaScript variables inline with `@set`.

```less
@set blockType = 'inline';

.box {
  display: ${blockType === 'inline' ? 'inline' : 'block'};
}
```
In simplified terms, this will return what you would expect, a template string that looks like:
```js
// this is an oversimplification of output code, but demonstrates the 1-to-1 relationship with JS
let blockType = 'inline'

return `.box {
  display: ${blockType === 'inline' ? 'inline' : 'block'};                 
}`
```
_Note: this isn't what the "final" `<style>` tag will look like returned to your component or stylesheet,
as Jess will do a number of other optimizations to create efficient style injection. See: Advanced (TODO)_

### Functions in Jess

Jess offers a convenient `@function` wrapper in the form of:

```less
@function block(val) {
  .box {
    foo: ${val};
  }
}
```
This is the same as writing:
```js
export function block(val) {
  return `  .box {
    foo: ${val};
  }`
}
```
Technically, `@function` isn't needed. But it exists in Jess to make integration with IDEs easier, and to reduce lengthy expressions.

For example, you could have an expression as complex as the following:

```less
@set arr = ['50px', '100px', '200px']

${arr.map((value, index) => `
  .col-${index + 1} {
    width: ${value};
  }
`).join('\n')}
```
However, this just looks a bit nicer.

```less
@import {each} from 'jess/helpers';

@set arr = ['50px', '100px', '200px'];

@function makeColumns(value, index) {
  .col-${index + 1} {
    width: ${value};
  }
}

${each(arr, makeColumns)}
```
It's really your preference how you want to write templating functions.

However you do it, the output is fairly predictable. It will evaluate pretty much like:
```js
import {each} from 'jess/helpers';

let arr = ['50px', '100px', '200px'];

function makeColumns(value, index) {
  return `.col-${index + 1} {
    width: ${value};
  }`
}
return `
  ${each(arr, makeColumns)}
`
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
Similarly, `@media` and `@supports` rules will bubble.
```less
.button {
  padding: 20px;
  @media (min-width: 800px) {
    padding: 40px;
  }
}
```

#### Variables

Variables are just JavaScript, because they're referenced in JS expressions.

```less
// Less variable
@color-brand: #AAAAFC;

// Sass variable
@color-brand: #AAAAFC;

// Jess variable
@set {colorBrand: `#AAAAFC`}
```
Unlike Sass / Less, Jess variables don't "leak" across imports. Jess imports follow the rules of ES6 imports, which has the benefit of meaning that evaluation is much faster, IDEs can implement code-completion on variables, and there are fewer side effects.

If you want a variable from another `.jess` stylesheet, you need to `@import` it.

```less
@import {colorBrand} from './variables.jess';

// ...
color: ${colorBrand};
```
#### Maps

Variables are written in JS object syntax. As in:
```less
@set {colorBrand: '#AAAAFC`}
```

What this means is that you can declare groups of variables, or create map-like structures.
```less
// everything after `@set` is evaluated as JavaScript until a closing outer `}`
@set {
  colors: {
    background: `#000`,
    foreground: `#FFF`
  }
}

.box {
  color: ${colors.foreground};
}
```
For faster processing, Jess variables must be at the root of the stylesheet, and will have a value per evaluation of the stylesheet.

#### Dynamic Variables

Instead of declaring variables with `@set`, you can use `@var`, as in:
```
@var boxSize = `20px`;
```
What's the difference? Basically, `@set`s are a way to mark values that are safe for static compile-time evaluation. That means that anything depending on a `@set` variable will not change, and the CSS can be statically exported. This changes the export of the Jess module. `@var` variables means that anything evaluated using it must also export a function (and any dependencies) in a bundle so that it can be re-computed in the future.

Here's an example to illustrate, first using `@set`.

```less
// theme.jess
@import {mix} from 'jess/color';

@set colors: {
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
Jess files can use the Jess styles API to change evaluation of an instance of the underlying module. Because they're marked with `@set`, the resulting output is still static at compile-time.

```less
// main.jess

@import styles from './theme.jess';

@set {colors: styles({colors: {background: `#F00`}}).colors}

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

If, however, the colors were marked with `@dynamic`, the output would be more like:
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
... as part of the JavaScript bundle.

#### Variables from JavaScript modules

Any values imported from other JS modules are considered to be "set" and will be evaluated at compile-time only. As in, if we have this JS file:
```js
// colors.js
export let someColor = '#AAA';
```
... and then import it...
```
@import {someColor} from './colors.js';

.box {
  color: ${someColor};
}
```
Output is static:
```
.box {
  color: #AAA;
}
```

#### Rules for JS expressions

An `${}` expression can appear almost anywhere, but only declaration values can have JS expressions that refer to `@dynamic` variables. This is because the CSS must be able to be parsed at compile-time for static analysis of class names and values that will change, and to flatten any nested rules.

#### Mixins

Because you have the entire power of JavaScript at your disposal, you don't need mixins or Sass's `@function` constructs. Just write a JS function.

```js
// functions.js
import {css} from 'jess';

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
Sass control blocks like `@each`, `@for`, and `@if` are not needed, because all of those constructs exist in JavaScript. For convenience, though, Jess has `each`, `for`, and `if` helpers.


### Using Jess in components

So far, all the examples have demonstrated how to create essentially static CSS. The JavaScript is evaluated at compile-time, and either used as a `.css` in a `<link>` tag or as `<style>` HTML injected with your component.

When you're expose a `@dynamic` variable, what it is is a kind of state property used to create dynamic styling. This makes Jess more powerful than straight CSS modules.

```less
// main.jess

// state variable
@dynamic {color: 'red'}

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
