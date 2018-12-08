The Jess language is a super-simple concept. Much like JSX is a mix of JS and HTML (without wrapping markup in template tags),
Jess is a mix of JS and CSS (without wrapping CSS in template tags).

Jess takes two languages you know and combines them in one structure, then transpiles to CSS + JS.
Jess is not a new "CSS-like" language (although it does have some minor syntax additions).

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
these can be any other JS module, or another Jess file. This is done using the `@{}` preamble block.

### JS all up in your CSS

Here's an example of a preamble:

```less
@{
  import {Colors} from './constants.js'
}
```
How would you use that? You can imagine the rest of the file as a JS template block, wrapped in ``` `` ``` characters.
This means you can use `${}` tags to evaluate any JS to output a string.
```less
@{
  import {Colors} from './constants.js'
}

.box {
  color: ${Colors.foreground};
}
```

There are two more ways to use JavaScript in your Jess file.

When you prepend a line with `$`, you can use literally any JS. That means declaring vars, for loops, if statements, etc.
The `$` will "stop" evaluating as JS at the end of the line, unless that line starts a block,
in which case it will evaluate the line of the matching closing block. This is best done by example.

```less
$let type = 'inline' // this line is JS
// now we're back in CSS

.box {
  $if (type === 'inline') {    // JS, opening {
    display: inline;           // CSS
  } else {                     // this entire line is JS because of matching }, so you don't need a special $else
    display: block;            // CSS
  }                            // JS
}
```
In simplified terms, this will return what you would expect, a template string that looks like:
```js
t = ''
t += `.box {`
if (type === 'inline') {    
  t += `display: inline;`       
} else {                   
  t += `display: block;`        
}                       
t += `}`
return t
```
_Note: this isn't what the "final" `<style>` tag will look like returned to your component or stylesheet,
as Jess will do a number of other optimizations to create efficient style injection. See: Advanced (TODO)_

### Matching JS blocks

The JS matching is smart enough that any opening `{` `(` `[` will look for block ends, meaning you can also do something like:

```less
@{
  let arr = ['50px', '100px', '200px']
}

$arr.forEach((value, index) => {
  .col-${index + 1} {
    width: ${value};
  }
})
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

```less
$const square = (size) => {
  width: ${size}px;
  height: ${size}px;
}

.box {
  ${square(50)}
}
```
Need more logic in your mixin? Just add some `if` statements.
```less
$const shape = (size) => {
  height: ${size}px;
  
  $if (width === < 100) {
    width: ${size}px;
  } else { // rectangular
    width: ${size * 2}px;
  }
}

.box-1 {
  ${shape(50)}
}
.box-2 {
  ${shape(100)}
}
```
The above would output, as expected:
```css
.box-1 {
  height: 50px;
  width: 50px;
}
.box-2 {
  height: 50px;
  width: 100px;
}
```

Want to add color functions?

```less
@{
  import {mix} from 'third-party'
  import {Colors} from './constants'
}

.box {
  background: ${mix(Colors.theme, '#000000', 0.5)};
}
```
This will evaluate at compile time, and you'll end up with something like:
```css
.box {
  background: #ec0233;
}
```

### State variables

So far, all the examples have demonstrated how to create essentially static CSS. The JavaScript is evaluated at compile-time, and either used as a `.css` in a `<link>` tag or as `<style>` HTML injected with your component.

Jess has one more special construct which is a `$$` JavaScript statement. What it is is an exposed state property used to create dynamic styling. This makes Jess more powerful than straight CSS modules.

```less
// main.jess

// state variable
$$color = 'red'

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
