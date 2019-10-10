Changes from Less v1-3 to Less4

### Imports can import individual rules, which then don't leak to other files

```less
// main.less
@import [.mixinCall] from 'mixins';
@import 'stuff';

// stuff.less
.mixinCall();  // .mixinCall is undefined


// fixed stuff.less
@import [.mixinCall] 'mixins'; // or @import * from 'mixins';
.mixinCall();
```

### Imports can import all rules, but not leak to other imports
```less
// main.less
@import * from 'mixins';
@import 'stuff';

.mixinCall();  // works

// stuff.less
.mixinCall();  // .mixinCall is undefined
```

### Theming can be done by calling with a ruleset
```less
// my-theme.less
@import * as .theme from 'theme';

@my-theme: .theme({
  @color: blue;
});

// main.less
@import * from 'my-theme';

.foo {
  color: @my-theme[@color];
}
```

### Mixins don't leak variables
```less
.mixin() {
  @my-var: foo;
}

.box {
  .mixin();
  bar: @my-var;  // undefined
}
```

### Variables within a scope also aren't leaked to mixins, meaning mixins don't have side effects and can be statically analyzed, unlike Less 3.x
```less
.mixin() {
  color: @foo;
}

.box {
  @foo: black;
  .mixin();  // works in Less 3.x, error in Less 4.x
}
```
Instead, just pass vars to mixins for predictable output:
```less
.mixin(@foo) {
  color: @foo;
}
.box {
  @foo: black;
  .mixin(@foo);
}
```

### Selectors are never re-parsed. Instead, lists have merging rules that match `&` behavior
```less
@selectors: .one, .two, .three;

.bar@{selectors} {
  .foo {a: b;}
}

// Less 3 turns this into the string ".bar.one, .two, .three", and then re-parses
.bar.one .foo,
.two .foo,
.three .foo {
  a: b;
}

// Less 4
// List 1 is [.bar] which is merged with Less 2 [.one, .two, .three]
// So no re-parsing is necessary
.bar.one .foo,
.bar.two .foo,
.bar.three .foo {
  a: b;
}
```

### Mixin calls require `()`
```less
.bar() {}

.foo {
  .bar;  // error
}
```


### Technically, the Less parser until now has allowed "partial" rulesets, such as props in the root.

For instance, this is valid in Less 3.
```less
.box {
  @import 'rules.less';
}

// rules.less

prop1: value;
prop2: value;
```
Many Less linters (such as in IDEs) don't realize this, and mark this as invalid code. However, it's also just plain messy. In Less 4, Less stylesheets must contain well-formed rulesets.

```less
// rules.less

prop1: value;  // error
```

#### @import (reference)
Deprecated. Instead use the `*`.
```less
// Less 3.x
@import (reference) 'mixins.less';

//Less 4.x
@import * from 'mixins.less';
```

### `@plugin` is removed for import calls.
```less
// less 3
@plugin 'blah.js';  // dumped imports here

func();

// less 4
@import 'blah.js';
```

As such, Less functions must be imported* to a) reduce CSS conflict, b) utilize tree-shaking during export.

_* I'm thinking for back-compat, there could instead be a default option to import Less functions, as needed. It could still utilize tree-shaking semantics in an exported module._
```less
@import [fadeout] from 'less/functions';

.blah {
  color: fadeout(#000, 10%);
}
```

### Stylesheets are never parsed in the browser
Instead, a `.css` file with an optional `.js` module is exported which supports dynamic evaluation. This will result in much smaller and more efficient bundles.

```html
<link rel="stylesheet" type="text/css" href="compiled.css">
<script type="module" src="compiled.js"></script>
```

* Less plugins are strictly at compile-time (not in the browser), used to add file resolvers or module importers.
* Less exports a JS module, not a CSS file, and so can be used in place of CSS modules or CSS-in-JS.

The JS module maps mixins/vars to exports, and props to camelCase.

Possibly:
* `@{var}` is deprecated in favor of an evaluator `#{@var}` which can have an expression. This allows a little more expressiveness in interpolation, as well as making `@{var}` look less odd, since the identifier is actually `@var`, not `var`.

### Live variable modification

This part needs research / testing, but essentially, Less would "manage" the inserted styles vs a giant innerHTML dump, to reduce style recalculation in the browser.

The idea I have now is this could be done like this:

1. At compile-time, Less produces a `.css` file and a corresponding `.js` bundle that produced it. The CSS file can be used as-is (!), OR the `.js` file can be used without it.
2. At browser runtime, Less essentially "hydrates" the Stylesheet (similar to Vue / React hydration), by evaluating the `.js` bundle, and checking that against the stylesheets on the page to make sure that they correspond in value. The link or style block is then marked as hydrated.
3. If we modify any vars or call mixins with different values, the Less compiler should know, because of the way it compiled, _exactly_ what rules now need to be re-evaluated. Because we've removed side-effects (documented above in the document), each rule path or mixin call should have a completely clear, linear dependency chain. Unlike PostCSS, Less nodes can not be modified globally. A mixin / function may only create a node or not. (This would need to be verified in tests that don't yet exist.)
4. Less would maintain a "virtual CSSOM" for each Stylesheet. When the Less tree is re-evaluated, it would perform a diff to be able to tell which rules need to be added / removed / changed.
5. Less would then dispatch `insertRule()` and/or `deleteRule()` to modify the stylesheet as needed (or create a new stylesheet, depending on the size of the diff?)

Essentially (ideally), you would have a very, very tiny Less bundle with a built-in CSSOM manager, responsibily for only updating parts of CSS as needed.

_TODO: the user would need to indicate in some way if mixin vars / var changes should produce global class values, or should just produce an inline style object for a particlar element._

One option: Less exports could be in the form of `var()` with a default variable.
```less
@color: #666;

.foo {
  color: @color;
}

// exports

.foo {
  color: var(--foo-color-0, #666);
}
```
_This may not be efficient....There are performance tests that show the further away a custom property is from a var() reference, the longer the style recalculation. Instead, Less should either produce classes (some of which could be dynamic) or an inline style, as requested by the user._

### Less functions

```ts
import {Color, IColor} from 'less/tree/color';

export let fadeout = (color, percent): IColor => {
  return Color(); //...
}
fadeout.evalVars = false;
```

### Less API changes

Less tree nodes would become 1st-class JS citizens, meaning that every node would implement (or inherit) `.valueOf()`, `.toString()`, and `toJSON()`.  (`toJSON()` is used not just for interoperability, but also for memoization of function/mixin values to determine object equality in passed-in parameters)

For instance:
```js
class Dimension extends Node {
  constructor(value, unit) {
    this.value = value;
    this.unit = unit;
  }
  // Probably would be abstrated into Node by default
  valueOf() {
    return this.value;
  }
  toString() {
    return `${this.value}${this.unit}`;
  }
  toPlainObject() {
    return {value:this.value,unit:this.unit};
  }
  toJSON() {
    return JSON.stringify(this.toPlainObject())
  }
}

let val = new Dimension(3, 'px');
console.log(val + 7);  // 10
console.log(val + ''); // 3px
```
Also, every node would optionally implement a `children` property (or directly attach props in the case of rules?), vs an arbitrary named property like `rules` or `values`. This will not only simplify code within Less (that seeks a different property name based on node type), but can also be abstrated in `valueOf` and `toString` calls to aggregate those values into array primitives or space-separated string sequences for export.

### Interoperability with JS

Less 4 can just import from JS
```js
// rules.js
export const rule = {
  backgroundColor: 'black' // note that this would be an anonymous value, so is not parsed as a color
};
```
```less
@import (rule) from 'rules.js';

.box {
  rule();
}
```
Would produce:
```
.box {
  background-color: black;
}
```
With a Rollup / Wepback plugin, Less 4 stylesheets can also be imported into JS

```less
// rules.less
.rules() {
  background-color: black;
}
```
```jsx
import React from 'react';
import styles from 'rules.less';

export const Component = (props) => {
  return <div style={styles.rules()} />;
};
```
#### TODO: Rewrite - this probably wouldn't work. I think what's needed is some kind of `$id` selector, for a scoped-identifier that generates a class name and can be used in other selectors.

##### Idea 1 (not great)
When a mixin's `toString()` is called in a browser runtime-like environment, it will create a CSS class name based on a memoization of the function. In other words, the `<style>` innerHTML will not be re-written if the params to the mixin are the same.

```jsx
import React from 'react';
import styles from 'rules.less';

export const Component = (props) => {
  return <div className={styles.rules()} />;
};
```

```html
<style>
  .rules-foo123 {
    background-color: black;
  }
</style>
<div class="rules-foo123"></div>
```
Also, in a browser environment (or SSR), accessing the `styles` of a Less stylesheet (during import) will immediately attach (unless already attached) all raw CSS to the page (or be added to the raw CSS export in pre-compile).

_NOTE: A smarter, more dev-friendly way would be something like `.attach()` or `.hydrate()`. Look at JSS's API._

```less
// main.less
.plain-ruleset {
  color: blue;
}
```

```js
import styles from 'main.less'
styles();

// would also fire the function if styles.prop is accessed the first time,
// because styles is a Proxy object to a function
```
Outputs:
```html
<head>
  <style>
    .plain-ruleset {
      color: blue;
    }
  </style>
</head>
```
This alleviates the need for concepts like the `:global` pseudo-selector in CSS modules.

##### Idea 2
Use an `$id` selector that creates a module-scoped ID, and can be passed around / modified like other selectors.

_NOTE: this conflicts with the property accessor.... but it allows it to be accessible directly from JS...?_

```less
$rules {
  background-color: black;
  &:hover {
    background-color: blue;
  }
}
```

```js
import React from 'react';
import styles from 'rules.less';

export const Component = (props) => {
  return <div className={styles.$rules} />;
};
```
I still don't like the CSS modules convention. With the approach documented so far, it should be clear when I'm returning a ruleset vs when I'm returning just the name of the class. In short, somehow this should be made easier and more automatic than CSS modules. The need for `:global` in CSS modules is unruly. We should be able to define module-scoped classes directly, in the form of identifying which identifiers are which.
