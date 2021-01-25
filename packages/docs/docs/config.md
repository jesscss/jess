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

### global

Determines whether class names should be global / output as-is or will be hashed per module. By default the `jess` CLI will set this option to true. The Rollup / Webpack plugins, when bundling Jess files as part of your project, will default to false.

## rollup

### plugins

_WIP in alpha and not yet supported_

Add a compile-time plugin or plugins to use when importing modules. Note that this is separate from (and in addition to) your Rollup setup if you are using `rollup-plugin-jess`, which creates a runtime bundle.