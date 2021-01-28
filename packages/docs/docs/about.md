---
id: about
title: About Jess
---

:::caution

Jess is in early alpha, so features and syntax are likely to change!

:::

Jess is a CSS pre-processing language like Less and Sass. In fact, Jess started as a re-write of Less from the ground-up, but evolved into a new language.

### What makes Jess different from Less?

Jess can transpile directly to JavaScript; in fact, Jess's variable and mixin features are simply JavaScript variables and functions. Jess's rule scope is just JavaScript function scope.

Because of this, Jess can import and export JavaScript functions, primitive values, and objects, making it more interoperable with modern component libraries.

### Why do some of Jess's features look like Sass?

Less was based on Sass when it used only indented syntax. Sass based `.scss` syntax on Less's model of "extending CSS". So Sass inspired Less, and Less inspired Sass, and both inspired Jess. (Jess also takes inspiration from CSS modules, Rollup and React, among others.)

A more detailed explanation: Less's mixin patterns, ultimately, function very differently from JavaScript. Less mixins can be overloaded, and JavaScript functions can't. Less mixins can have guards (evaluation conditions); JavaScript has no direct parallel. Sass mixin syntax was most compatible with programming patterns you're already familiar with in JavaScript.

Jess's goal is to borrow the best ideas, and lean into what web developers already know.

### How is Jess different from both Sass and Less?

Jess variables and mixin names must be valid JavaScript identifiers (meaning they can't contain hyphens). They get exported from a JS module! For the same reason, you can't use JS reserved words in your identifiers.

As noted, individual Jess files are exported as JS modules, so each file has a local scope. As such, you can't declare variables locally and then consume them in another file without directly importing.