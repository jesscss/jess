---
title: "Browser Usage"
slug: "/usage/using-less-in-the-browser"
audiences:
  - less
origin: less
---
Using Less.js in the browser is convenient for development, but pre-compiling in CI/build pipelines is recommended for production reliability and performance.

To start off, link your `.less` stylesheets with the `rel` attribute set to "`stylesheet/less`":

```html
<link rel="stylesheet/less" type="text/css" href="styles.less" />
```

Next, [download less.js](https://github.com/less/less.js/archive/master.zip) and include it in a `<script></script>` tag in the `<head>` element of your page:

```html
<script src="less.js" type="text/javascript"></script>
```

### Setting Options

You can set options either programmatically, by setting them on a less object **before** the script tag - this then affects all initial link tags and programmatic usage of less.

```html
<script>
  less = {
    env: "development",
    async: false,
    fileAsync: false,
    poll: 1000,
    functions: {},
    dumpLineNumbers: "comments",
    relativeUrls: false,
    rootpath: ":/a.com/"
  };
</script>
<script src="less.js"></script>
```

The other way is to specify the options on the script tag, e.g.

```html
<script>
  less = {
    env: "development"
  };
</script>
<script src="less.js" data-env="development"></script>
```

Or for brevity they can be set as attributes on the script and link tags:

```html
<script src="less.js" data-poll="1000" data-relative-urls="false"></script>
<link data-dump-line-numbers="all" data-global-vars='{ "myvar": "#ddffee", "mystr": "\"quoted\"" }' rel="stylesheet/less" type="text/css" href="less/styles.less">
```

### Browser Support

Less.js supports all modern browsers (recent versions of Chrome, Firefox, Safari, and Edge). While it is possible to use Less on the client side in production, please be aware that there are performance implications for doing so.

### Tips

* Make sure you include your stylesheets **before** the script.
* When you link more than one `.less` stylesheet each of them is compiled independently.
* Due to the same origin policy of browsers, loading external resources requires [enabling CORS](http://enable-cors.org/).

### Watch Mode

To enable Watch mode, option `env` must be set to `development`. Then AFTER the less.js file is included, call `less.watch()`, like this:

```html
<script>less = { env: 'development'};</script>
<script src="less.js"></script>
<script>less.watch();</script>
```

Alternatively, you can enable Watch mode temporarily by appending `#!watch` to the URL.

### Modify Variables

Enables run-time modification of Less variables. When called with new values, the Less file is recompiled without reloading.

```js
less.modifyVars({
  '@buttonFace': '#5B83AD',
  '@buttonText': '#D9EEF2'
});
```

### Debugging

You can output rules in your CSS which allow tools to locate the source of the rule.

Either specify the option `dumpLineNumbers` or add `!dumpLineNumbers:mediaquery` to the URL.

### Options

Set options in a global `less` object **before** loading the less.js script:

```html
<script>
  less = {
    env: "development",
    logLevel: 2,
    async: false,
    fileAsync: false,
    poll: 1000,
    functions: {},
    dumpLineNumbers: "comments",
    relativeUrls: false,
    globalVars: {
      var1: '"quoted value"',
      var2: 'regular value'
    },
    rootpath: ":/a.com/"
  };
</script>
<script src="less.js"></script>
```

## Options specific to Less.js in the browser

_For all other options, see [Less Options](./less-options)._

#### async
Type: `Boolean`  
Default: `false`

Whether to request the import files with the async option or not.

#### env
Type: `String`  
Default: depends on page URL

Environment to run may be either `development` or `production`.

#### errorReporting
Type: `String`  
Options: `html`|`console`|`function`  
Default: `html`

Set the method of error reporting when compilation fails.

#### fileAsync
Type: `Boolean`  
Default: `false`

Whether to request imports asynchronously when on a file protocol.

#### functions (Deprecated - use @plugin)
Type: `object`

User functions, keyed by name.

#### logLevel
Type: `Number`  
Default: `2`

The amount of logging in the JavaScript console.

#### poll
Type: `Integer`  
Default: `1000`

The amount of time (in milliseconds) between polls while in watch mode.

#### relativeUrls
Type: `Boolean`  
Default: `false`

Optionally adjust URLs to be relative.

#### useFileCache
Type: `Boolean`  
Default: `true` (previously `false` before v2)

Whether to use the per-session file cache.
