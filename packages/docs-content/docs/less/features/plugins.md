---
title: "Plugins"
slug: "/features/plugins"
audiences:
  - less
origin: less
---
Released [v2.5.0](https://github.com/less/less.js/blob/master/CHANGELOG.md)

> Import JavaScript plugins to add Less.js functions and features

:::warning 5.x+ status
In the 5.x+ track, `@plugin` is **deprecated** and **experimentally supported**.

Prefer `@use` / `@-use` for new script integration when compiling `.less` through the Less CLI compatibility path.
Dedicated script-module documentation is not published yet and will be added in a follow-up docs update.
:::

## Writing your first plugin

Using a `@plugin` at-rule is similar to using an `@import` for your `.less` files.
```less
@plugin "my-plugin";  // automatically appends .js if no extension
```
Since Less plugins are evaluated within the Less scope, the plugin definition can be quite simple.
```js
registerPlugin({
    install: function(less, pluginManager, functions) {
        functions.add('pi', function() {
            return Math.PI;
        });
    }
})
```
or you can use `module.exports` (shimmed to work in browser as well as Node.js).
```js
module.exports = {
    install: function(less, pluginManager, functions) {
        functions.add('pi', function() {
            return Math.PI;
        });
    }
};
```
Note that other Node.js CommonJS conventions, like `require()` are not available in the browser. Keep this in mind when writing cross-platform plugins.

What can you do with a plugin? A lot, but let's start with the basics. We'll focus first on what you might put inside the `install` function. Let's say you write this:

```js
// my-plugin.js
install: function(less, pluginManager, functions) {
    functions.add('pi', function() {
        return Math.PI;
    });
}
// etc
```
Congratulations! You've written a Less plugin! 

If you were to use this in your stylesheet:
```less
@plugin "my-plugin";
.show-me-pi {
  value: pi();
}
```
You would get:
```less
.show-me-pi {
  value: 3.141592653589793;
}
```
However, you would need to return a proper Less node if you wanted to, say, multiply that against other values or do other Less operations. Otherwise the output in your stylesheet is plain text (which may be fine for your purposes).

Meaning, this is more correct:
```js
functions.add('pi', function() {
    return new tree.Dimension(Math.PI);
});
```
_Note: A dimension is a number with or without a unit, like "10px", which would be `less.Dimension(10, "px")`. For broader API reference, see [Less API](../usage/api)._

Now you can use your function in operations.
```less
@plugin "my-plugin";
.show-me-pi {
  value: pi() * 2;
}
```

You may have noticed that there are available globals for your plugin file, namely a function registry (`functions` object), and the `less` object. These are there for convenience.


## Plugin Scope

Functions added by a `@plugin` at-rule adheres to Less scoping rules. This is great for Less library authors that want to add functionality without introducing naming conflicts.

For instance, say you have 2 plugins from two third-party libraries that both have a function named "foo".
```js
// lib1.js
// ...
    functions.add('foo', function() {
        return "foo";
    });
// ...

// lib2.js
// ...
    functions.add('foo', function() {
        return "bar";
    });
// ...
```
That's ok! You can choose which library's function creates which output.
```less
.el-1 {
    @plugin "lib1";
    value: foo();
}
.el-2 {
    @plugin "lib2";
    value: foo();
}
```
This will produce:
```less
.el-1 {
    value: foo;
}
.el-2 {
    value: bar;
}
```

For plugin authors sharing their plugins, that means you can also effectively make private functions by placing them in a particular scope. As in, this will cause an error:
```less
.el {
    @plugin "lib1";
}
@value: foo();
```

As of Less 3.0, functions can return any kind of Node type, and can be called at any level.

Meaning, this would throw an error in 2.x, as functions had to be part of the value of a property or variable assignment:
```less
.block {
    color: blue;
    my-function-rules();
}
```
In 3.x, that's no longer the case, and functions can return At-Rules, Rulesets, any other Less node, strings, and numbers (the latter two are converted to Anonymous nodes).

## Null Functions

There are times when you may want to call a function, but you don't want anything output (such as storing a value for later use). In that case, you just need to return `false` from the function.
```js
var collection = [];

functions.add('store', function(val) {
    collection.push(val);  // imma store this for later
    return false;
});
```
```less
@plugin "collections";
@var: 32;
store(@var);
```
Later you could do something like:
```js
functions.add('retrieve', function(val) {
    return new tree.Value(collection);
});
```
```less
.get-my-values {
    @plugin "collections";
    values: retrieve();   
}
```

## The Less.js Plugin Object

A Less.js plugin should export an object that has one or more of these properties.
```js
{
    /* Called immediately after the plugin is 
     * first imported, only once. */
    install: function(less, pluginManager, functions) { },

    /* Called for each instance of your @plugin. */
    use: function(context) { },

    /* Called for each instance of your @plugin, 
     * when rules are being evaluated.
     * It's just later in the evaluation lifecycle */
    eval: function(context) { },

    /* Passes an arbitrary string to your plugin 
     * e.g. @plugin (args) "file";
     * This string is not parsed for you, 
     * so it can contain (almost) anything */
    setOptions: function(argumentString) { },

    /* Set a minimum Less compatibility string
     * You can also use an array, as in [3, 0] */
    minVersion: ['3.0'],

    /* Used for lessc only, to explain 
     * options in a Terminal */
    printUsage: function() { },

}
```
The PluginManager instance for the `install()` function provides methods for adding visitors, file managers, and post-processors.

Here are some example repos showing the different plugin types. <!-- TODO: updated examples -->
 - post-processor: https://github.com/less/less-plugin-clean-css
 - visitor: https://github.com/less/less-plugin-inline-urls
 - file-manager: https://github.com/less/less-plugin-npm-import

## Visitors

A **visitor** is a plugin hook that lets you inspect and transform nodes as Less
processes a stylesheet — for example rewriting a `url()`, replacing a dimension,
or capturing values for later use. The classic examples are
[`less-plugin-inline-urls`](https://github.com/less/less-plugin-inline-urls) and
right-to-left transforms.

:::warning 5.x+ breaking change: visitors are per-node
Less 4.x handed a visitor the **entire materialized tree** to walk, so a visitor
could look at arbitrary ancestors, siblings, or cross-subtree state.

In the 5.x track, output is **streamed** — there is no materialized output tree.
Visitors are now **per-node transforms**: the engine fires your callbacks as it
serializes, in **enter → children → exit** order, and hands you **one node at a
time**. A visitor **cannot** rely on whole-tree traversal, ancestry, arbitrary
siblings, or accumulated cross-subtree state.

See [Migrating to v5](../usage/migrating-to-v5#plugin-visitors) for the migration
path.
:::

### The visitor object

A visitor is a plain object. It may define:

- **`enter(node)`** — called when the engine reaches a node, before its children.
  Return a replacement node to swap it out, return nothing to leave it unchanged,
  or return `ABORT` to skip transforming this node.
- **`exit(node)`** — called on the way back out, after the node's children have
  been emitted.
- **type-named methods** — a method named after the node type (lower-cased first
  letter), e.g. `declaration(node)`, `atRule(node)`, `dimension(node)`,
  `color(node)`. Each is called for nodes of that type and may return a
  replacement node (or nothing to leave it as-is).
- **`visit(node)`** — a generic catch-all called for every node when no
  type-named method matches.

Leaf / value-node replacement (returning a new node from a type-named method or
`enter`) is the fully supported, exercised case.

### Registering a visitor

A plugin exposes visitors through one of two hooks, depending on **when** the
visitor should run:

```js
export default {
  name: 'my-plugin',

  // Runs BEFORE evaluation, over the parsed input tree.
  // Use for pre-eval transforms: rewriting url(), appending to the
  // root, capturing the root's variables, etc. Unchanged in spirit
  // from Less 4.x and fully supported.
  beforeEvalVisitor: {
    declaration(node) { /* inspect / replace */ }
  },

  // Runs at RENDER time on the RESOLVED nodes, fired inline as output
  // is serialized (not by walking a separate output tree).
  // `postEvalVisitor` is an accepted alias for the same hook.
  preRenderVisitor: {
    enter(node) { /* set a depth-scope flag */ },
    dimension(node) { /* replace a resolved value node */ },
    exit(node) { /* clear the depth-scope flag */ }
  }
};
```

Legacy Less 4.x plugins that register visitors via `pluginManager.addVisitor()`
inside `install()` continue to work through the Less compatibility layer, which
routes them onto the pre-evaluation (`beforeEvalVisitor`) hook.

### Carrying state across nodes: the depth-1 scope flag

Because there is no whole tree to walk, the supported "cross-node" pattern is a
**depth-1 scope flag**: set a flag when you *enter* a container node, read it
from that node's **direct children**, and clear it on the node's **exit** edge.
This is exactly what real traversing visitors (inline-urls, rtl) used.

```js
// A visitor that only rewrites url()s inside a specific at-rule.
preRenderVisitor: {
  _inScope: false,
  enter(node) {
    if (node.type === 'AtRule' && node.name === '@font-face') {
      this._inScope = true;
    }
  },
  call(node) {
    if (this._inScope && node.name === 'url') {
      // ...return a replacement Call node
    }
  },
  exit(node) {
    if (node.type === 'AtRule' && node.name === '@font-face') {
      this._inScope = false;
    }
  }
}
```

`visitDeeper`-style pruning of the traversal is **not** part of the 5.x contract.

### Why the contract narrowed

An audit of the published Less plugin ecosystem found **no** real plugin that
relied on whole-tree or ancestry state. The only genuinely-traversing visitors
(such as inline-urls and rtl) are per-node transforms whose only state is that
depth-1 scope flag, and bundler integrations (webpack `less-loader`, Vite,
Rollup) register no visitors at all. The narrowed per-node contract therefore
covers 100% of real-world usage while enabling the faster streaming
architecture.

If you have a visitor that walked the whole tree or used ancestry, it needs
rework into a per-node form. If that is infeasible, Less v4 remains available as
a fallback, and additional compatibility can be considered on request.

## Pre-Loaded Plugins

While a `@plugin` call works well for most scenarios, there are times when you might want to load a plugin before parsing starts.

See: [Pre-Loaded Plugins](../usage/plugins) in the "Using Less.js" section for how to do that.
