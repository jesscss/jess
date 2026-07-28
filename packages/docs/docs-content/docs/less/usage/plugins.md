---
title: "Pre-Loaded Plugins"
slug: "/usage/plugins"
audiences:
  - less
origin: less
---
:::info
Load plugins before parsing begins in Less.js so plugin features are available during compilation.
:::

:::warning 5.x+ status
In the 5.x+ track, `@plugin` is **deprecated** and currently **experimental**.

Prefer `@use` / `@-use` for new script integration when compiling `.less` through the Less CLI compatibility path.
We have not published dedicated script-module documentation yet.
:::

### Less 5.x script runtime policy

Legacy file-based `@plugin` scripts are treated as executable code. They do not
run in the Node host process. To load a local or package `.js`/`.ts` plugin file,
configure `@jesscss/plugin-js`; that path runs the legacy Less wrapper inside a
Deno sandbox with Less-compatible injected variables such as `functions`, `tree`,
`less`, and `registerPlugin`.

The sandbox read root defaults to the entry Less file/config root unless the
plugin-js options provide a narrower `jsReadRoot`. File reads outside that root
are denied, environment/process access is denied, and network access is disabled
unless explicitly allowed by plugin-js policy.

Use `disableScriptModules` to disable executable script modules entirely,
including file-based `@plugin`. The old Less-compatible `disablePluginRule`
option is accepted as a deprecated alias for the same behavior; new configs and
CLI flags should use `disableScriptModules`.

While the easiest way to use a plugin is using the [`@plugin` at-rule](../features/plugins), in a Node.js environment, you can pre-load a global Less.js plugin via the command line or by specifying it in the [Less options](./less-options).

### Preprocessing

Pre-loading plugins is necessary if you want to add a Less.js Pre-processor. That is, a plugin that gets called and passed the raw Less source before parsing even starts. An example of this would be a [Sass-To-Less Pre-processor plugin](../tools/plugins).

Note: pre-loading is not necessary for _pre-evaluation_ plugins (after Less source is parsed, but before it is evaluated).

## Node.js

### Using the Command Line

If you are using lessc, the first thing you need to do is install that plugin. In registries like NPM, we recommend a Less.js plugin is registered with the "less-plugin-" prefix (for easier searching), though that isn't required. So, for a custom plugin, you might install with:
```
npm install less-plugin-myplugin
```
To use the plugin, you can pass this on the command line by simply writing:
```
lessc --myplugin
```
Less.js will try to load either the "less-plugin-myplugin" and the "myplugin" modules as plugins whenever there's an unknown Less option (like "myplugin").

You can also explicitly specify the plugin with:
```
lessc --plugin=myplugin
```

To pass options to the plugin, you can write that in one of two ways.
```
lessc --myplugin="advanced"
lessc --plugin=myplugin=advanced
```

Loading a Plugin via Less.js
----------------------

In Node, require the plugin and pass it to `less` in an array as an option plugins. E.g.

```js
var LessPlugin = require('less-plugin-myplugin');
less.render(myCSS, { plugins: [LessPlugin] })
  .then(
    function(output) { },
    function(error) { }
  );
```
