---
id: nesting
title: Nesting
audiences:
  - jess
origin: jess
---
Jess supports CSS nesting syntax, and unlike Sass and Less 1.x-4.x, will:
 - preserve `&` if possible
 - will "join" with dashes or numerical suffixes (which CSS Nesting does not support)
 - when "collapsing" an `&`, will intelligently wrap the output with an `:is()` selector when possible.

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

### At-Rule bubbling

One of the best ideas to come out of Less/Sass is the idea of at-rule bubbling, which can make your stylesheets easier to read, by putting different property values next to each other. The CSS Nesting syntax has adopted this, and is now available in all major browsers.

However, for legacy Less support, Jess can bubble and collapse at-rules to the root.

For example:

```less
.box {
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

Less has unique logic for bubbling behavior of specific at-rules. In Jess, if `collapseNesting` is set to true, all at-rules will bubble to the root, or the next enclosing at-rule.

:::