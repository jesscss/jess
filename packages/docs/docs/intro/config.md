---
id: config
title: Configuration
---

Jess can be configured by including a `jess.config.js` file at the root of your project.

```js
// jess.config.js
module.exports = {
  options: {}
}
```

## options

### module

Overrides whether Jess files should be compiled as modules or not (globally). By default, any Jess file with the pattern `[filename].module.jess` or `[filename].m.jess` is treated as a module, and class names are hashed.

## rollup

### plugins

_WIP in alpha and not yet supported_

Add a compile-time plugin or plugins to use when importing modules. Note that this is separate from (and in addition to) your Rollup setup if you are using `rollup-plugin-jess`, which creates a runtime bundle.