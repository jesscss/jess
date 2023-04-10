## Changes to make for 2.0 release

- Jess is a common runtime for CSS pre-processors
- Should execute in an isolated VM? https://www.npmjs.com/package/isolated-vm
- For interoperability with JavaScript, Jess mixins should return plain objects, but have a non-enumerable property with an AST return
- In addition, function calls to Jess functions should receive plain arguments with primitive values, but when called internally, should bind to a `this` object that has AST arguments. Each function, therefore should call something like `getArguments(this, args)` and either parse primitives or get the passed arguments.
- The runtime should be written in AssemblyScript. The generated code should be AssemblyScript. When running locally, it will simply transpile with `swc`, bundle, and execute quickly. When creating the browser bundle, it will compile to `.wasm`

## Some syntax changes
```
// plain imports
import { myFunction } from 'foo.js'

.rule {
  foo: bar;
}

// Mixin calls and functions don't need `@include`
$myFunction();

// Everything is an expression, not just un-escaped JavaScript, meaning you can do:

$myFunction($sass-var);
```