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
<style component lang="jess">
@-use 'somefile.jess' (.Bar);

!div.Foo($one, $two) {
  /** Imported .Bar? */
  :extend(.flex, .foo);
  .Bar {
    // when <Bar /> is inside <Foo />
  }
}
a.Foo {} // Error 
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