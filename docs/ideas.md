## Changes to make for 2.0 release

- Jess is a common runtime for CSS pre-processors
- Should execute in an isolated VM? https://www.npmjs.com/package/isolated-vm
- In addition, function calls to Jess functions should receive plain arguments with primitive values, but when called internally, should bind to a `this` object that has AST arguments. Each function, therefore should call something like `getArguments(this, args)` and either parse primitives or get the passed arguments.
- For interoperability with JavaScript, Jess mixins should return serialized plain objects, but have a non-enumerable property with an AST return UNLESS they were passed a `this` object with AST args, in which case they should return AST nodes
- The runtime should be written in AssemblyScript. The generated code should be AssemblyScript. When running locally, it will simply transpile with `swc`, bundle, and execute quickly. When creating the browser bundle, it will compile to `.wasm`

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