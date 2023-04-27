## Changes to make for 2.0 release

- Jess is a common runtime for CSS pre-processors
- Should execute in an isolated VM? https://www.npmjs.com/package/isolated-vm
- In addition, function calls to Jess functions should receive plain arguments with primitive values, but when called internally, should bind to a `this` object that has AST arguments. Each function, therefore should call something like `getArguments(this, args)` and either parse primitives or get the passed arguments.
- For interoperability with JavaScript, Jess mixins should return serialized plain objects, but have a non-enumerable property with an AST return UNLESS they were passed a `this` object with AST args, in which case they should return AST nodes
- The runtime should be written in AssemblyScript. The generated code should be AssemblyScript. When running locally, it will simply transpile with `swc`, bundle, and execute quickly. When creating the browser bundle, it will compile to `.wasm`


## Differences with Sass
An important difference is that defining a variable is done with a plain identifier, and _referencing_ a variable or identifier is done with `$`. This is so there isn't ambiguity in places in the syntax

## Some syntax changes
```js
/**
 * Plain JS/TS imports. In Vue, this would be in the `<script>` tag.
 */
import { myFunction } from 'foo.js'

.rule {
  foo: bar;
}

// Mixin calls and functions don't need `@include`
$myFunction();

// Everything is an expression, not just un-escaped JavaScript, meaning you can do:

$myFunction($sass-var);

// Q: Why can't we do `$myFunction(sass-var)`?
// A: Because we need to parse parameters, and the meaning is ambiguous.
//    CSS keywords (including colors) and functions are plain identifiers.

// Parenthesized expressions
.selector~($expr) {
  prop: ~($value + 1);
}
~($myFunction())
```

## Features
- Mixin guards (like Less)
- `@if` / `@else` (like Sass)
- All Less / Sass functions available
- Extend?
- Jess should not flatten selectors by default. See: https://www.w3.org/TR/css-nesting-1/
  - In flattening mode, Jess should follow CSS nesting convention in `.jess` files, and SCSS/Less convention in respective files.
- Conversion of Less/Scss to Jess (restrict some things from converting? like `@import`s?)

### `@use [file|object] [namespace|'('imports')'? declarationList?`

Will import the scope (mixins and variables) of the object. Can be a stylesheet or other scope object.

```scss
@use 'colors.less';
// or override variables
@use 'colors.less' {
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
@use 'theme.jess' theme {
  colors {
    primary: #3a3a3a;
  }
}
@include $theme();
```

## Limiting types for a design system (Experimental)
```scss
@type Size: 1rem, 1.2rem, 1.4rem;
@type Props:
  [Size] size,
  [color] color;

@mixin set-size([Size] size) {
  font-size: $size;
}

// How do we get this to just return class names and var() injections?
@mixin my-component([Props] (size, color)) {

}
```
