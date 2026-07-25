---
title: "Getting Started"
slug: "/home/getting-started"
audiences:
  - less
origin: less
---
Less is a CSS pre-processor that makes stylesheet work faster and cleaner: variables for consistency, mixins for reuse, and functions for repeatable design logic.

Less builds on Node and also supports dynamic style attachment in the browser during development. You can plug it into most existing toolchains quickly, and the fastest way to try it is the [online editor](http://lesscss.org/less-preview/).

If you are coming from Less 4.x, this workflow still feels familiar. When you are ready to evaluate modern compiler behavior, you can test the same codebase against the Less 5.x track incrementally.

For example:

```less
@base: #f938ab;

.elevation(@blur, @alpha: 20%) when (isnumber(@alpha)) {
  box-shadow: 0 10px @blur rgb(15 23 42 / @alpha);
}

.box {
  border-radius: 0.75rem;
  padding: 1rem;
  color: saturate(@base, 5%);
  border-color: lighten(@base, 30%);
  div { .elevation(24px, 24%) }
}
```

compiles to

```css
.box {
  border-radius: 0.75rem;
  padding: 1rem;
  color: #fe33ac;
  border-color: #fdcdea;
  div {
    box-shadow: 0 10px 24px rgb(15 23 42 / 0.24);
  }
}
```
