# Aug 2, 2025

After working through more scenarios, I think both access and assignment of vars needs to be `$name`, because it's too confusing for patterns like `$foo +: 1;` whether it should start with `$` or `~`

This also resolves this:

```scss
/** Declaring mixins
  Pattern matching mixins (not often-used in Less) like this
*/
.mixin(red; @width: 20px; @height: 10px) {
  padding: $width $height;
}
.mixin(blue; @width: 10px; @height: 5px) {
  padding: $width $height;
}
/** Get translated into this in Jess */
.mixin(red; $width: 20px; $height: 10px) {
  padding: $width $height;
}
.mixin(blue; $width: 10px; $height: 5px) {
  padding: $width $height;
}
```

# Aug 1, 2025

- Syntax ideas

```scss
~color: red; // scope var 
^color: red; // set var
!color: red; // readonly var
~_color: red; // private var named _color

.box {
  value: $color; // reference (var or prop)
  $ > .mixin(); // call mixin named fn
  value: $fn(); // function named `fn`
}

~brand-color: orange;

mixin() {
  $color: red;
  color: $brand-color;
  border-color: $color; // variable named 'color'
  border-color: $.color; // variable or property named 'color'
  border-color: $['color']; // property named 'color'
  ns: $ns.$color; // variable named 'color' in $ns
  ns: $ns.color; // variable or property named 'color' in $ns
  ns: $ns['color'] // property named 'color' in $ns

}

mixin-2() {
  background-color: $brand-color;
}

~double: @(~size) > $(size * 2);

.container {
  $ > .mixin();
  width: $double(10px);
}
```


# Jul 31, 2025

- Destructuring ideas:

```scss
[$one, $two]: $list; // parsing conflict with attributes?
$[$one, $two]: $list; // less ambiguous but a lot of `$`
($one, $two): $list; // maybe more CSS-like?

$for ([$one, $two] of $items) {}
```

# Jul 27, 2025

- Switch `@-use` to `@-compose` (for stylesheets) and use `@-use` for JS/TS imports. Why? Because "use" implies importing values, but a `@-compose` can output rules as well as can be evaluated differently based on input values.
- Enabling `@-module` and inline JS for Less requires the `jess-plugin-js` plugin. The reasoning being that it installs the Deno runtime to safely execute JS.
- Sass defaulting a namespace to the file / module name I think has merit and probably resembles some other languages... on the other hand... file names can have spaces?

Apparently, Sass just replaces any un-supported character in a file name with underscores. (CSS identifiers can't start with numbers, so filenames starting with a number prepend an underscore at the start.)

# Jul 25, 2025

Tons of work on syntax, especially around imports. Added `@-module` rule for loading JS/TS. Enforced that modules must have namespaces.

# Jul 20, 2025

Did refactoring with Claude to support preserving comments when extending selectors.

# Jul 19, 2025

Selector matching and extend logic maybe done?? Used Claude 4 Sonnet quite a bit.


# Jul 12, 2025

Finished migrating generating a function from mixins to rules. Started work on registering mixins / rulesets to the rules scope.

# Jun 18, 2025

## Idea

After reviewing some of the reasoning for Tailwind, let's explore this:

1. Define a `module` mode for Jess (or `component`?)
2. Only mixins / classes are allowed, with an optional type (to not default to `div`)
   a. Mixins essentially become like styled components with props
   b. Classes are static components
   c. Must start with a capital letter

e.g.
```vue
<script>
// Jess, on the JavaScript level, exports a function, always.
// This function can be passed an object, which then maps props
// as "scope".
// therefore, this is like:
import Link from './Link.vue'
import styles from '_component.jess'

const { StyledLink } = styles({ Link })
</script>
<style lang="jess">
// component mode requires type tags
@-mode component;

// After the function is called, Jess will return an object
// with scoped items.
//
// from the return object
// has .Bar in it
@-use 'somefile.jess';

// In component mode, the export is { Foo }
!Foo(<string> $one; <string> $two) {
  :-is(section); // parens also optional?
  /** Imported .Bar? */
  :-extends(.flex, .foo);
  
  // component reference -- must be defined
  !Bar {
    // when <Bar /> is inside <Foo />
  }
}
// Error, Foo is defined
Foo() {
  :is(a);
} 

// add additional styles to Foo
!Foo {

}

// allow imported components, this is like styled(Link)`color: red;`
// this must be visible in the host component scope, or imported with JS
// as a function. Less just exports a function that then calls Link()
// and passes in any extra attributes
StyledLink($style-prop: 1) {
  // 1. uses the Link generated calss
  // 2. creates a class for the default static value hash
  // 3. creates props for var injections?
  :extends Link($style-prop; $static: value);
  // this will call Link like
  Link({
    attrs: {
      ['style-prop']: 1,
      static: 'value'
    },
    classes: ['']
  })
}
</style>

<template>
  <Foo />
</template>
```

# May 26, 2025
- Am going to let the healing begin on complexity by removing all ArrayLists,
  HashMaps, or other non-native collection structures. Types defined on the 
  Node will be the type stored on the `value` prop, full stop. "Normalization",
  where needed, will be supported by collection utility functions instead of
  in custom array or object abstractions. Value assignment will be value assignment.
  Processing of nodes will be handled by `set value()` in the Node class.
- Updated all the nodes to use similar collections, but now there are compilation issues

# May 24, 2025
- Added the ability to look in a `@use` but not a `@use` child of `@use`
- Rules tests passing again, including basic nested rules serialization
- Started back on Ampersand tests

# May 23, 2025

- Replaced ArrayList and HashMap
- All tests passing

# May 22, 2025

- Solved issues with evaluation
- Test failing for "optionality" of optional value

# May 21, 2025

- Go back to the idea that NodeData instances should hold a map
  of nodes to identifiers, and then nested structures within (arrays,
  ArrayLists, HashMaps) just hold identifers? This would make
  cloning more trivial as we should only need to create a
  new NodeData instance. Or is cloning already fine because we
  collect the data in node.value to make a new instance anyway?
  It's hard to say if object creation or node mapping lookups are
  more expensive, so maybe I keep overthinking it.

- Use ternaries in place of Less's if(), to eliminate the (special parsing) function?
  width: #($test = true ? 30px : 40px);
  width: if(#($test = true), 30px, 40px); // ChatGPT argues this is clearer.

$for (($value, $key, $index) of $items) {}
$for ($item of $items) {
  $value: $item[1];
}

$if ($test = true) {
  width: 30px;
} $else {
  width: 40px;
}

$if ($test = true)
  width: 30px;
$else <!-- add $else to parsing options after $if
  width: 40px;


# May 20, 2025

- All tests passing!

# May 19, 2025

- Got stuck trying to understand how I broke the scope inheritance tests :(

# May 18, 2025

- Consider merging scope and rules somehow? There's an unfortunate duplication of "parentScope" and "parentNode" and all rules have scope.
  - Maybe "register" nodes on eval()? And have those registration structures within rules?
- Was working on figuring out scope tests w.r.t. nested rules and trying to see if scope could just "work"
  - Maybe rework evalNode() on Rules from scratch and just do registration

# May 13, 2025

- In the case of selectors, resolve that simple and compound can match partially, but complex selectors have to match exhaustively

```scss
.a.b.c {
  color: red;
}

// matches and transforms to `.a:is(.b, .d).c`
.d:extend(.b !all);

.a > .b.c {
  color: red;
}
// this does not match, because "joining" `.c` to `.d` does not make logical sense
.d:extend(.a > .b !all);

// in contrast, this will work
.a > .b > .c {
  color: red;
}
// matches and transforms to: `:is(.a > .b, .d) > .c`
.d:extend(.a > .b !all);
```

- document / flush out preEval

- establish how collections work with operations

- allow merging props with collections when rendering

- finish scope tests

- register individual selectors in scope map
  - each simple selector gets registered as a key
  - the selector has a keySet that must be overlapping
  - if they have a compatible keySet, then it can search
    for a proper match.

- THEN finish selector extends