Changes from Less v1-3 to Less4

1. Imports don't have global side effects.
```less
// main.less
@import 'mixins.less';
@import 'stuff.less';

// stuff.less
.mixinCall();  // .mixinCall is undefined


// fixed stuff.less
@import 'main.less';
.mixinCall();
```

2. Mixins don't leak variables
```less
.mixin() {
  @my-var: foo;
}

.box {
  .mixin();
  bar: @my-var;  // undefined
}
```

3. Selectors aren't re-parsed. Instead, lists have merging rules.
```less
@selectors: .one, .two, .three;

.bar@{selectors} {
  .foo {a: b;}
}

// Less 3
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

4. Rules are not mixins. Mixins must be explicit.
```less
.bar {}

.foo {
  .bar();  // not found
}
```

5. Mixin calls require `()`
```less
.bar() {}

.foo {
  .bar;  // error
}
```

6. To reduce developer confusion, maps can access mixins, not rules
```less
.rules {
  color: black;
}

.collection() {
  @main-color: white;
}

.foo {
  color: .collection[@main-color];
  background-color: .rules[color];  // error
}
```

7. `@plugin` is removed for import calls.
```less
// less 3
@plugin 'blah.js';  // dumped imports here

func();

// less 4
@import {func} from 'blah.js';
```

8. Stylesheets are never parsed in the browser; instead, a `.css` file with an optional `.js` module
is exported which supports dynamic evaluation. This will result in much smaller and more efficient bundles.

```html
<link rel="stylesheet" type="text/css" href="compiled.css">
<script type="module" src="compiled.js"></script>
```

9. Less plugins are strictly at compile-time (not in the browser), used to add file resolvers or module importers.

10. Less exports a JS module, not a CSS file, and so can be used in place of CSS modules or CSS-in-JS.

The JS module maps mixins/vars to exports, and props to camelCase.

11. `@{var}` is deprecated in favor of an evaluator `#{@var}` which can have an expression.
