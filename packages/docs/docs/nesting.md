---
id: nesting
title: Nesting
---

To make migrating from Less / Sass easier, Jess supports the same nesting syntax.

Here's a basic example of nesting:

```less
.categories {
  margin: 0 0 20px;
  width: auto;
  p {
    margin: 0;
    color: blue;
    &:hover {
      color: rebeccapurple;
    }
  }
}
```

:::caution

While you _can_ write nested blocks like the above, too much nesting should be avoided, as it
can really inflate the size of your stylesheets. In general, browsers are more performant when
you use single class selectors for each type of element.

:::

### At-Rule bubbling

One of the best ideas to come out of Less/Sass is the idea of at-rule bubbling, which can make
your stylesheets easier to read, by putting different property values next to each other.

For example:

```less
html {
  font-size: 10px;

  @media (min-width: 800px) {
    font-size: 12px;
  }
  @media (min-width: 1200px) {
    font-size: 14px;
  }
}
```
This will produce:
```css
html {
  font-size: 10px;
}
@media (min-width: 800px) {
  html {
    font-size: 12px;
  }
}
@media (min-width: 1200px) {
  html {
    font-size: 14px;
  }
}
```

:::caution

Less has unique logic for bubbling behavior of specific at-rules. In Jess, all at-rules will bubble to the root,
or the next enclosing at-rule.

:::