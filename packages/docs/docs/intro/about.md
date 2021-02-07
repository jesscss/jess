---
id: about
title: About Jess
slug: /
---

```less
// I am a Jess file
@import { width } from './sizes.js';

.container {
  width: $(width)px;
  display: flex;
}
```

### What is Jess?

You can think of Jess as a CSS pre-processor like Less and Sass. In fact, Jess started as a re-write of Less from the ground-up, but evolved into something much more **powerful and dynamic**.

**Less** and **Sass** are _interpreted languages_, and run on top of another language environment. They have their own variables, scopes, and mixins which are interpreted at runtime by the host language.

Jess takes another approach. **Jess converts to JavaScript.** Jess variables are just JavaScript variables. Jess mixins are just JavaScript functions. **Jess is JavaScript.**

```jsx
import { myMixin } from './mixins.jess';

export default (props) => (
  <div style={myMixin(props.value)}>Styled by Jess</div>
);
```

This gives Jess a few tremendous advantages over Sass and Less, such as:
1. Jess is fast because modern JavaScript engines are fast. Jess benchmarks at about **2x faster than Less** for the same size stylesheet.
2. Jess can import from and export to ES6 modules (or anything that can be converted to a module!)
3. Jess can perform "live" style updates in the browser, without re-parsing stylesheets. This is similar to CSS-in-JS.

### Why does Jess syntax somewhat resemble Sass?

Jess believes in [_paving the cowpaths_](https://en.wikipedia.org/w/index.php?title=Paving_the_cowpaths&redirect=no). Jess is designed to be easy to transition to from Sass or Less (depending on features). Some concepts / syntax are borrowed from Sass, and some from Less. See [the migration guide](./intro/migrating).

```scss
@mixin square(dimension) {
  width: $dimension;
  height: $dimension;
}

.box {
  @include square(20px);
}
```

### How is Jess different from CSS-in-JS?

CSS-in-JS, for a long time, was thought to be the only way to produce "dynamic" styles, but it comes with trade-offs. Jess has these advantages over CSS-in-JS:
1. You don't have to put your CSS in a JavaScript file.
2. Many CSS-in-JS libraries don't produce static CSS at build-time (or take some effort to do so). Not only can Jess produce static CSS, but it can produce "patch-able" CSS, along with a module that can patch your CSS at any time. **It's kinda magic.**
3. Many CSS-in-JS libraries give you dynamic styles at the cost of performance. Jess focuses on making CSS updates fast with minimal overhead.

```less
// I am Jess's static output
.container {
  width: 640px;
  display: flex;
}
```
```less
// I am Jess's patch-able output, enabled
// with the `dynamic` flag
.container {
  width: var(--v123456-0, 640px);
  display: flex;
}
```
```less
// I was computed and added to a style-sheet at runtime
.container {
  --v123456-0: 800px;
}
```

### Why am I not already using Jess?

I mean, you [tell me](https://twitter.com/CssJess)?