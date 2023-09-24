## Changes to make for 2.0 release

- Jess is a common runtime for CSS pre-processors
- Should execute in an isolated VM? https://www.npmjs.com/package/isolated-vm
- In addition, function calls to Jess functions should receive plain arguments with primitive values, but when called internally, should bind to a `this` object that has AST arguments. Each function, therefore should call something like `getArguments(this, args)` and either parse primitives or get the passed arguments.
- For interoperability with JavaScript, Jess mixins should return serialized plain objects, but have a non-enumerable property with an AST return UNLESS they were passed a `this` object with AST args, in which case they should return AST nodes

## TypeScript / JavaScript calls


## Some syntax changes
```less
/**
 * Maps to JS/TS import syntax
 * Mirrors @use syntax.
 *
 * This will be ported to Less 6 to replace `@plugin`.
 *
 * @note `import` should not be needed, but provides intuitive symmetery with JS
 */
@from './foo.js' import (myFunction); // also allow `@from './foo.js' import { myFunction } ?
@from '#less' import * as less;

@include './file.css' (type: 'less');

// declaring vars
@let count; // a Node of `Nil`

// setting vars - note, this avoids the need for !global in Sass
// Note also that this will throw an error in Jess without `@let count`
$count: 1;

// `$` is a referencer, to reduce ambiguity
$count: $count + 1;

// allow destructuring
@let list: one, two;

// This avoids the need for extract() in Less
@let (one, two): $list;

// To dis-ambiguate mixin calls for Less, Sass, they need `@include`
@include mixin();

// #() to wrap expressions, to avoid repeating `$`
.bar {
  foo: #($count + 1);
}

// var expressions will be re-output as "live" expression functions
// i.e. changing the value of `count` will update `--live`
.bar {
  foo: var(--live, $count + 1);
}

// Function calls can use $
.bar {
  // You can write this in two ways:
  value: $myFunction($sass-var);
  value: #($myFunction($sass-var));
}

// you can also do:
.bar {
  value: $something.prop.func(#FFF).value;
}

// Parenthesized expressions
.selector#(expr) {
  prop: #($value + 1);
}
```

## Features
- Mixin guards (like Less)
- `@if` / `@else` (like Sass)
- All Less / Sass functions available
- Extend

```css
.foo {
  // Glob expression to limit extend
  // '~' is compilation root
  // @todo - remove?
  :extend(.bar '~/*');
}
```

- Jess should not flatten selectors by default. See: https://www.w3.org/TR/css-nesting-1/
  - In flattening mode, Jess should follow CSS nesting convention in `.jess` files, and SCSS/Less convention in respective files.

### Sass+
Sass is an overly-complex stylesheet language. Jess aims to be:
- 100% compatible with Less
- Compatible with a common subset of Sass called Sass+ (to be defined)

### `@use ('(' type ')')? [file|object|map] [namespace|'(' imports ')']? ('with' reference|declarationList)?`

Non-leaky replacement for `@import`. Will import the scope (mixins, variables, and selector references) of the object, as well as render rules.

Can be at the root or nested.

### `@ref ('(' type ')')? [file|object|map] [namespace|'(' imports ')']? ('with' reference|declarationList)?`

(In Less, this will be `@reference`)

```scss
@ref 'colors.less';
// or override variables
@ref 'colors.less' with {
  // should throw an error if primary-color is not defined
  $primary-color: #333;
}
// or
@ref 'colors.less' colors;

//or
@ref 'colors.less' (primary-color);
```


```less
// or ultimate customization
@use 'bootstrap.scss' with {
  // Transitively apply a different use
  @ref 'variables.scss' with variables;
  @use 'some-classes.scss' with {
    // Replace a class
    .class {
      color: blue;
    }
  }
}

.foo {
  color: $colors.primary-color;
}
// or
.foo {
  @use 'colors.less';
  color: $primary-color;
}

//
```

### `@use` without `@forward`

In Jess, variables defined or imported with `@use` will be re-exported. This means you do not have to use the Sass `@forward` rule. Just `@use` them.

Q: what happens if a two files use `@use` on the same file with different params?

They would be subject to evaluation order.
```scss
// use1.jess
@use './file.jess' with {
  $foo: one;
}

// use2.jess
@use './file.jess' with {
  $foo: two;
}

// final.jess
@use './use1.jess';
@use './use2.jess';

.rule {
  value: $foo; // two
}
```

Q: What if you don't want to forward variables / mixins?

You can use the `@private` at-rule:

```scss
// This is a private `@use`
@private @ref './somefile.jess';
// can also be used with variables
@private @let -private: var;
```


Therefore, a SCSS file like this:
```scss
@use './file1.scss' as *;
$not-private: var;
$-private: var;
@forward './file2.scss';
```
Would be converted to:
```scss
@private @use './file1.jess';
@let not-private: var;
@private @let -private: var;
@use './file2.jess';

```



## `@include [file|object|selector|mixin] ('with' reference|declarationList)?`

Will import the rules (but not pollute the variable scope).

Can be at the root or nested.

```scss
// main.jess
@ref 'colors.jess' colors;
@include 'rules.jess' with colors;

// rules.jess
// Doesn't have access to vars in main.jess w/o:
@use 'main.jess';
// this would include the vars in colors.jess
```
Using an `@include` that's the _result_ of a `@ref`:
```scss
@ref 'theme.jess' theme with {
  // Using +: with a collection will merge values
  $colors +: {
    primary: #3a3a3a;
  }
}
@include theme();
```
You could also do the above like:
```scss
@include 'theme.jess' with {
  $colors +: {
    primary: #3a3a3a;
  }
}
```
### Include for mixins / inter-operability
```scss
@use 'mixins.less';

@include .root-mixin();

// this will do the same thing, except not include selectors?
@include root-mixin();
```

## Mixins are functions, and functions are called with a consistent signature
```scss
call: $my-func(one: $value, $two, $three);
```
JS representation:
```js
myFunc({ one: value }, value, two, three);

// defined with https://typia.io/docs/
/**
 * @see https://github.com/microsoft/TypeScript/issues/55736 - a solution!!
 */
function myFunc(one: Color, two?: any, three?: any) {}
```



## Limiting types for a design system (Experimental)
```scss
@type Size: 1rem, 1.2rem, 1.4rem;
@type Props:
  <Size> size,
  <color> color;

@mixin set-size(<Size> size) {
  font-size: $size;
}

// How do we get this to just return class names and var() injections?
@mixin my-component(<Props> (size, color)) {

}
```
