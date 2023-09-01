## Changes to make for 2.0 release

- Jess is a common runtime for CSS pre-processors
- Should execute in an isolated VM? https://www.npmjs.com/package/isolated-vm
- In addition, function calls to Jess functions should receive plain arguments with primitive values, but when called internally, should bind to a `this` object that has AST arguments. Each function, therefore should call something like `getArguments(this, args)` and either parse primitives or get the passed arguments.
- For interoperability with JavaScript, Jess mixins should return serialized plain objects, but have a non-enumerable property with an AST return UNLESS they were passed a `this` object with AST args, in which case they should return AST nodes


## Some syntax changes
```less
/**
 * Maps to JS/TS import syntax
 * Mirrors @use syntax.
 *
 * This will be ported to Less 5 to replace `@plugin`.
 */
@from './foo.js' (myFunction);
@from '#less' (rgb);

@include './file.css' as less;

.rule {
  foo: bar;
}

// Mixin calls and functions don't need `@include`
$myFunction();

// You can write this in two ways:
$myFunction(sass-var);
$myFunction($sass-var);

// if you need a keyword:
$myFunction('sass-var');

// Parenthesized expressions
.selector$(expr) {
  prop: $(value + 1);
}
$myFunction()
```

## Features
- Mixin guards (like Less)
- `@if` / `@else` (like Sass)
- All Less / Sass functions available
- Extend?
- Jess should not flatten selectors by default. See: https://www.w3.org/TR/css-nesting-1/
  - In flattening mode, Jess should follow CSS nesting convention in `.jess` files, and SCSS/Less convention in respective files.
- Conversion of Less/Scss to Jess (restrict some things from converting? like `@import`s?)

### `@use [file|object] [namespace|'(' imports ')']? declarationList?`

Will import the scope (mixins and variables) of the object. Can be a stylesheet or other scope object.
Note that `@use` will also re-export.

```scss
@use 'colors.less';
// or override variables
@use 'colors.less' with {
  // should throw an error if primary-color is not defined
  primary-color: #333;
}
// or
@use 'colors.less' colors;

//or
@use 'colors.less' (primary-color);

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

## `@include [file|object] declarationList?`

Will import the rules (but not pollute the variable scope)
```scss
// main.jess
@use 'colors.jess';
@include 'rules.jess';

// rules.jess
// Doesn't have access to vars in main.jess w/o:
@use 'main.jess';
```
Using an `@include` that's the _result_ of a `@use`:
```scss
@use 'theme.jess' theme with {
  colors {
    primary: #3a3a3a;
  }
}
~theme();
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
