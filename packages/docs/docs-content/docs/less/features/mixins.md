---
title: "Mixins"
slug: "/features/mixins"
audiences:
  - less
origin: less
---
Mixins let you package reusable style patterns.

:::info
If you are used to Tailwind `@apply`, mixins provide a similar composition workflow with extra capabilities (parameters, guards, and map-like value access).
:::

You can mix in class selectors and id selectors:

```less
.u-text-sm, #u-compact {
  font-size: 0.875rem;
  line-height: 1.25rem;
}
.card-title {
  .u-text-sm();
}
.nav-caption {
  #u-compact();
}
```
This compiles to:
```css
.u-text-sm, #u-compact {
  font-size: 0.875rem;
  line-height: 1.25rem;
}
.card-title {
  font-size: 0.875rem;
  line-height: 1.25rem;
}
.nav-caption {
  font-size: 0.875rem;
  line-height: 1.25rem;
}
```

Historically, the parentheses in a mixin call are optional, but optional parentheses are deprecated and will be required in a future release.

```less
.a(); 
.a;    // currently works, but deprecated; don't use
.a (); // white-space before parentheses is also deprecated
```

## Mixins With Parentheses

If you want to create a mixin but you do not want that mixin to be in your CSS output, put parentheses after the mixin definition.

```less
.utility-border {
  border: 1px solid var(--border-subtle);
}
.utility-surface() {
  background: var(--surface-elevated);
}

.panel {
  .utility-border();
  .utility-surface();
}
```
Outputs:

```css
.utility-border {
  border: 1px solid var(--border-subtle);
}
.panel {
  border: 1px solid var(--border-subtle);
  background: var(--surface-elevated);
}
```

## Selectors in Mixins

Mixins can contain more than just properties, they can contain selectors too.

For example:

```less
.my-hover-mixin() {
  &:hover {
    border: 1px solid red;
  }
}
button {
  .my-hover-mixin();
}
```

Outputs

```css
button:hover {
  border: 1px solid red;
}
```

## Namespaces

If you want to mixin properties inside a more complicated selector, you can stack up multiple ids or classes.

```less
#outer() {
  .inner {
    color: red;
  }
}

.c {
  #outer.inner();
}
```

Note: legacy Less syntax allows `>` and whitespace between namespaces and mixins. This syntax is deprecated and may be removed. Currently, these do the same thing.

```less
#outer > .inner(); // deprecated
#outer .inner();   // deprecated
#outer.inner();    // preferred
```

Namespacing your mixins like this reduces conflicts with other library mixins or user mixins, but can also be a way to "organize" groups of mixins.

Example:

```less
#my-library {
  .my-mixin() {
    color: black;
  }
}
// which can be used like this
.class {
  #my-library.my-mixin();
}
```

## Guarded Namespaces

If a namespace has a guard, mixins defined by it are used only if the guard condition returns true. A namespace guard is evaluated exactly the same as a guard on a mixin, so the following two mixins work the same way:

```less
#namespace when (@mode = huge) {
  .mixin() { /* */ }
}

#namespace {
  .mixin() when (@mode = huge) { /* */ }
}
```

The `default` function is assumed to have the same value for all nested namespaces and mixin. The following mixin is never evaluated; one of its guards is guaranteed to be false:

```less
#sp_1 when (default()) {
  #sp_2 when (default()) {
    .mixin() when not(default()) { /* */ }
  }
}
```

## The `!important` keyword

Use the `!important` keyword after mixin call to mark all properties inherited by it as `!important`:

Example:

```less
.foo (@bg: #f5f5f5, @color: #900) {
  background: @bg;
  color: @color;
}
.unimportant {
  .foo();
}
.important {
  .foo() !important;
}
```

Results in:

```css
.unimportant {
  background: #f5f5f5;
  color: #900;
}
.important {
  background: #f5f5f5 !important;
  color: #900 !important;
}
```

## Parametric Mixins {#mixins-parametric-feature}

Mixins can take arguments, which are variables passed to the selector block when it is mixed in.

```less
.stack(@gap) {
  display: grid;
  gap: @gap;
}

.settings-panel {
  .stack(0.75rem);
}
```

### Default parameter values

```less
.stack(@gap: 1rem) {
  display: grid;
  gap: @gap;
}

.card-list {
  .stack();
}
```

### Parameter separators

Parameters can be comma-separated or semicolon-separated. Semicolons are often used when passing comma-separated lists as a single argument.

```less
.name(1, 2, 3; something, else) // two args, each is a list
.name(1, 2, 3)                   // three args
.name(1, 2, 3;)                  // one comma-list argument
.name(~(1, 2, 3))                // one comma-list argument (escaped)
```

### Overloading and named parameters

Less allows multiple mixins with the same name and different arities/patterns. Matching definitions are merged.

```less
.chip(@tone) {
  color: @tone;
}
.chip(@tone, @padding: 0.375rem 0.625rem) {
  color: @tone;
  padding: @padding;
}
```

You can also call by parameter name:

```less
.badge(@fg: #0f172a; @radius: 9999px; @pad: 0.25rem 0.5rem) {
  color: @fg;
  border-radius: @radius;
  padding: @pad;
}

.status-pill {
  .badge(@fg: #0b3a67; @pad: 0.25rem 0.625rem);
}
```

### `@arguments` and rest arguments

Use `@arguments` for the full argument list, and `...` for variable-length argument lists.

```less
.elevation(@x: 0, @y: 8px, @blur: 24px, @color: rgb(15 23 42 / 0.12)) {
  box-shadow: @arguments;
}

.mixin(@a, @rest...) {
  // @rest is arguments after @a
  // @arguments is all arguments
}
```

### Pattern matching {#mixins-parametric-feature-pattern-matching}

Different mixin definitions can match on literal values or arity.

```less
.mixin(dark, @color) {
  color: darken(@color, 10%);
}
.mixin(light, @color) {
  color: lighten(@color, 10%);
}
.mixin(@_, @color) {
  display: block;
}
```

## Mixins As Functions

### Property / value accessors

_Released [v3.5.0](https://github.com/less/less.js/blob/master/CHANGELOG.md)_

You can select values from evaluated mixin calls, which enables function-like usage.

```less
.average(@x, @y) {
  @result: ((@x + @y) / 2);
}

div {
  padding: .average(16px, 50px)[@result];
}
```

### Overriding mixin values

If multiple mixins match, all rules are merged, and the last matching value for a key is selected.

```less
#library() {
  .mixin() {
    prop: foo;
  }
}

#library() {
  .mixin() {
    prop: bar;
  }
}

.box {
  my-value: #library.mixin[prop];
}
```

### Unnamed lookups

Using `[]` returns the final cascaded value:

```less
@dr: {
  value: foo;
}

.box {
  my-value: @dr[];
}
```

### Deprecated scope unlocking behavior

Older Less behavior allowed variables/mixins defined inside a mixin to become visible in the caller scope. This is deprecated; prefer explicit property/value accessors.

## Mixin Aliasing {#mixins-aliasing-feature}

_Released [v3.5.0](https://github.com/less/less.js/blob/master/CHANGELOG.md)_

Mixins can be assigned to variables and used for map lookups or variable calls.

```less
#theme.dark.navbar {
  .colors(light) {
    primary: purple;
  }
  .colors(dark) {
    primary: black;
    secondary: grey;
  }
}

.navbar {
  @colors: #theme.dark.navbar.colors(dark);
  background: @colors[primary];
  border: 1px solid @colors[secondary];
}
```

### Variable calls

```less
#library() {
  .colors() {
    background: green;
  }
}

.box {
  @alias: #library.colors();
  @alias();
}
```

When assigning a no-argument mixin call to a variable, keep parentheses in the assignment call to avoid ambiguity.

## Mixin Guards {#mixin-guards-feature}

Guards let mixins match on expressions, not just arity or literals.

```less
.mixin(@a) when (lightness(@a) >= 50%) {
  background-color: black;
}
.mixin(@a) when (lightness(@a) < 50%) {
  background-color: white;
}
.mixin(@a) {
  color: @a;
}
```

### Guard operators

Comparison operators: `>`, `>=`, `=`, `=<`, `<`.  
Logical operators: `and`, `,` (or), `not`.

```less
.mixin(@a) when (isnumber(@a)) and (@a > 0) { ... }
.mixin(@a) when (@a > 10), (@a < -10) { ... }
.mixin(@b) when not (@b > 0) { ... }
```

### Type-checking helpers

Common helpers include `iscolor`, `isnumber`, `isstring`, `iskeyword`, `isurl`, and unit checks like `ispixel`, `ispercentage`, `isem`, `isunit`.

## Mixin Loops {#mixin-loops-feature}

Recursive mixins + guards can generate iterative output patterns.

```less
.loop(@counter) when (@counter > 0) {
  .loop((@counter - 1));
  width: (10px * @counter);
}

div {
  .loop(5);
}
```

### Grid class generation example

```less
.generate-columns(4);

.generate-columns(@n, @i: 1) when (@i =< @n) {
  .column-@{i} {
    width: (@i * 100% / @n);
  }
  .generate-columns(@n, (@i + 1));
}
```
