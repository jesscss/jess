---
id: about
title: About Jess
slug: /
---

```scss
// I am a Jess file
@-use './sizes.ts';
@-use '#less';
@-compose './theme.jess';

.container {
  width: less.unit(sizes.width);
  color: theme.$primary-color;
  display: flex;
}
```

### What is Jess?

Jess is a stylesheet system designed to replace 99% of use cases for:
 - Sass
 - Less (Node.js and in-browser compilation)
 - the Tailwind compiler
 - CSS-in-JS
 - CSS modules

Jess is both a compiler and a language. As a compiler, it's a CSS pre-processor like Less or Sass and, in most cases, can replace them. In fact, Jess started as a re-write of Less from the ground-up, and, as a result, powers Less 5+. However, by converting your `.scss` and `.less` files to `.jess`, you can enable features and functions accessible to both. But, also, by using Jess, you can import Sass[^1] into Less and Less into Sass.

[^1]: Sass is quite a bloated language, so there is some lesser-used syntax that is not supported, and some Jess features are exposed while compiling `.scss` files. Therefore, Jess defines the supported language as "Sass+".

### Speed / etc?


### How is Jess different from CSS-in-JS?

CSS-in-JS, for a long time, was thought to be the only way to produce "dynamic" styles, but it comes with trade-offs. Jess has these advantages over CSS-in-JS:
1. You don't have to put your CSS in a JavaScript file (gross).
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

I mean, you tell me. (Todo: add new socials.)