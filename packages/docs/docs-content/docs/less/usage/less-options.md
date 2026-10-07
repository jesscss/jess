---
title: "Less.js Options"
slug: "/usage/less-options"
audiences:
  - less
origin: less
---
## Cross-Platform Options

Less 5 also reads a `styles.config.*` file beside (or above) the file it compiles. An option passed to `less.render()` or `lessc` wins over the same option in that file's `language.less` block and over a `compile` mode (including the `strict` preset); the config file applies to the options the call leaves unset.

The mode options (`math`, `unitMode`, `strictUnits`, …) are worked out for each file the compile reads, so an imported file compiles the same way whichever file imports it:

- An option passed to `less.render()` or `lessc` applies to every file, imported `.jess` and `.scss` files included.
- A `styles.config.*` applies to the files in its folder and in the folders below it that have no config of their own; an imported file in another folder uses that folder's config, not the entry's. Its `language.less` block applies only to `.less` files.
- With neither, each file uses its own language's defaults: a `.less` file uses `unitMode: 'preserve'`, while a `.jess` file imported by it keeps `.jess`'s default, where `$(1px + 3em)` is an error.

The mode options (`math`, `unitMode`, `moduleMode`) accept only the values listed for them. Any other value is an error, not a fallback to another mode.

### Include Paths

| | |
|---|---|
| `lessc --include-path=PATH1;PATH2` | `{ paths: ['PATH1', 'PATH2'] }` |

If the file in an `@import` rule does not exist at that exact location, Less will look for it at the location(s) passed to this option. You might use this for instance to specify a path to a library which you want to be referenced simply and relatively in the Less files.

### Rootpath

| | |
|---|---|
| `lessc -rp=resources/`<br>`lessc --rootpath=resources/` | `{ rootpath: 'resources/' }` |


Allows you to add a path to every generated import and url in your css. This does not affect Less import statements that are processed, just ones that are left in the output css.

For instance, if all the images the css use are in a folder called resources, you can use this option to add this on to the URL's and then have the name of that folder configurable.

An escaped string inside `url()` (`url(~"@{base}/x.png")`, or a variable holding one) is text you wrote verbatim, so `rootpath`, `rewriteUrls` and `urlArgs` all leave it as written. Less 4 rewrote it, which could write a broken URL: under `rootpath: 'r/'`, `url(~"'b.png'")` became `url(r/'b.png')`. Use a quoted string (`url("@{base}/x.png")`) when you want the options to apply.

### Rewrite URLs

| | |
|---|---|
| `lessc -ru=off`<br>`lessc --rewrite-urls=off` | `{ rewriteUrls: 'off' }` |
| `lessc -ru=all`<br>`lessc --rewrite-urls=all` | `{ rewriteUrls: 'all' }` |
| `lessc -ru=local`<br>`lessc --rewrite-urls=local` | `{ rewriteUrls: 'local' }` |

By default URLs are kept as-is (`off`), so if you import a file in a sub-directory that references an image, exactly the same URL will be output in the css. This option allows you to rewrite URLs in imported files so that the URL is always relative to the base file that has been passed to Less. E.g.

```css
/* main.less */
@import "./global/fonts.less";
```

```css
/* global/fonts.less */
@font-face {
  font-family: 'MyFont';
  src: url('myfont/myfont.woff2') format('woff2');
}
```

With nothing set or with `rewriteUrls:  'off'`, compiling `main.less` will output:

```css
/* main.less */
/* global/fonts.less */
@font-face {
  font-family: 'MyFont';
  src: url('myfont/myfont.woff2') format('woff2');
}
```

With `rewriteUrls: 'all'`, it will output:

```css
/* main.less */
/* global/fonts.less */
@font-face {
  font-family: 'MyFont';
  src: url('./global/myfont/myfont.woff2') format('woff2');
}
```

With `rewriteUrls: 'local'`, it will only rewrite URLs that are explicitly relative (those starting with a `.`):

```css
url('./myfont/myfont.woff2') /* becomes */ url('./global/myfont/myfont.woff2')
url('myfont/myfont.woff2') /* stays */ url('myfont/myfont.woff2')
```

This can be useful in case you're combining Less with [CSS Modules](https://github.com/css-modules/css-modules) which use similar resolving semantics like Node.js.

You may also want to consider using the data-uri function instead of this option, which will embed images into the css.

### Math

_Released v3.7.0_

| | |
|---|---|
| `lessc -m=[option]`<br>`lessc --math=[option]` | `{ math: '[option]' }` |

Less has re-built math options to offer an in-between feature between the previous `strictMath` setting, which required parentheses all the time, and the default, which performed math in all situations.

In order to cause fewer conflicts with CSS, which now liberally uses the `/` symbol between values, there is now a math mode that _only_ requires parentheses for division. (This is now the default in Less 4.) "Strict math" has also been tweaked to operate more intuitively.

The four options available for `math` are:

- `always`  (3.x default) - Less does math eagerly
- `parens-division` **(4.0 default)** - No division is performed outside of parens using `/` operator. (Less 4 also let the `./` operator force a division outside parens; Less 5 removed it, and `2px ./ 2` is a parse error.)
- `parens` | `strict` - Parens required for all math expressions.
- `strict-legacy` (removed in 4.0) - Still accepted, and means `parens`, as in Less 4.

**always**
Example:
```less
.math {
  a: 1 + 1;
  b: 2px / 2;
  c: (2px / 2);
}
```
Outputs:
```css
.math {
  a: 2;
  b: 1px;
  c: 1px;
}
```

**parens-division**

Example:
```less
.math {
  a: 1 + 1;
  b: 2px / 2;
  c: (2px / 2);
}
```
Outputs:
```css
.math {
  a: 2;
  b: 2px / 2;
  c: 1px;
}
```

**strict**
```less
.math {
  a: 1 + 1;
  b: 2px / 2;
  c: (2px / 2) + (3px / 1);
}
```
Output:
```css
.math {
  a: 1 + 1;
  b: 2px / 2;
  c: 1px + 3px;
}
```

#### Strict Math (Deprecated)

| | |
|---|---|
| `lessc -sm=on`<br>`lessc --strict-math=on` | `{ strictMath: true }` |

_This has been replaced by the [`math`](#math) option._ Less 5 still accepts it as an alias: `on` / `true` is `math: 'parens'`, and `off` / `false` leaves the default (`parens-division`). As in Less 4.x, `lessc` also takes `t`, `y`, `yes`, `f`, `n` and `no`, in any case. An explicit `math` wins. When `strictMath` decides the math mode, that is, when no `math` is set, a deprecation warning names the mapping.



#### Relative URLs (deprecated)

| | |
|---|---|
| `lessc -ru`<br>`lessc --relative-urls` | `{ relativeUrls: true }` |

_Has been replaced by `rewriteUrls: "all"`._ Less 5 ignores `relativeUrls`, without a warning, so setting it rewrites nothing, and `lessc` no longer accepts `--relative-urls`.


### Unit Mode

| | |
|---|---|
| `lessc --unit-mode=MODE` | `{ unitMode: MODE }` |

`MODE` is one of `preserve` (the default), `strict`, or `loose`, and controls how unit conversions are handled in math operations.

Without strict units, Less attempts to guess at the output unit when it does maths. For instance

```less
.class {
  property: 1px * 2px;
}
```

In this case, things are clearly not right - a length multiplied by a length gives an area, but css does not support specifying areas. So we assume that the user meant for one of the values to be a value, not a unit of length and we output `2px`.

- `loose` — this guessing behavior (the Less 1.x–4.x default).
- `strict` — assume this is a bug in the calculation and throw an error.
- `preserve` (the default) — `strict` without the error: anything `strict` would reject is emitted as the authored expression inside `calc()` (`1px + 3em` → `calc(1px + 3em)`, the example above → `calc(1px * 2px)`) instead of guessing, with an `eval/unexpressible-unit` warning; anything `strict` computes, `preserve` computes identically.

A unitless number added to or subtracted from a dimension takes the dimension's unit in every mode, as in Less 4 and Sass: `4 + 3px` is `7px` and `1.5 - 1rem` is `0.5rem`, under `strict` too. `strict` keeps its Less 4 meaning — an error only where two different real units meet (`1px + 1em`).

Math `preserve` keeps stays one `calc()`. The parts of the expression that do compute are computed, and the kept expression keeps its grouping, whether you wrote the parentheses or it reached an operator through a variable or a mixin argument (`@x * 2` with `@x: 1px + 1em` is `calc((1px + 1em) * 2)`); an outer pair of parentheses you wrote becomes the `calc()`'s own. Inside a math function the kept math is its arithmetic, never a nested `calc()`, however it gets there — a variable, a group around it, a mixin argument (`calc(@x * 2)` and `calc((@x) * 2)` are `calc((1px + 1em) * 2)`, `max(@x, 1px)` is `max(1px + 1em, 1px)`) — and it warns there too; math you write inside the `calc()` is yours and stays silent. A guard, an `if()` or a function that reads kept math gets no number from it: the comparison is not true and the call is written out as-is, each with the warning. A unitless `min()`/`max()` argument compares as carrying the other arguments' unit, and takes that unit when it wins (`max(4, 3px)` is `4px`, as `4 + 3px` is `7px`); only two different real units are not comparable.

#### Strict Units (deprecated)

| | |
|---|---|
| `lessc -su=on`<br>`lessc --strict-units=on` | `{ strictUnits: true }` |

_Deprecated alias for `unitMode`: `on` / `true` sets `unitMode: 'strict'`; `off` / `false` means "not strict", i.e. the default `preserve` (the Less 4.x fold is only selected by an explicit `unitMode: 'loose'`). `lessc` takes the same on/off spellings as `--strict-math`. When `strictUnits` decides the unit mode, that is, when no `unitMode` is set, a deprecation warning names the mapping during compile._

### Module Mode

| | |
|---|---|
| `lessc --module-mode=MODE` | `{ moduleMode: MODE }` |

`MODE` is `auto` (the default) or `modern`, and decides whether the Less built-in functions are available in a `.less` file without importing them.

- `auto` — decided per file. A file that uses `@use` or `@compose` is in modern mode (`@export` will join them when Less implements it). Any other file is in legacy mode, and a call to a Less built-in such as `min()` or `darken()` computes as it did in Less 4.
- `modern` — every `.less` file is in modern mode.

In modern mode a Less built-in must be imported, for example `@use "#less";` and then `@less.darken(red, 10%)`. A call that is not imported is treated like an unknown CSS function: it keeps its name and call shape, and its arguments are evaluated like any other value, so `padding: min(-5px, 1px)` stays `min(-5px, 1px)`. See [Modules and Imports](../features/modules-and-imports.mdx#modern-mode).

#### IE8 Compatibility (Deprecated)

| | |
|---|---|
| `lessc --ie-compat` | `{ ieCompat: true }` |

Less 5 ignores `ieCompat`, and `lessc` no longer accepts `--ie-compat`. In Less 4 it was false by default and only made `data-uri()` fall back to `url()` for a file too large for IE8; `data-uri()` now always inlines the file.

#### Enable Inline JavaScript (Deprecated)

| | |
|---|---|
| `lessc --js` | `{ javascriptEnabled: true }` |

False by default starting in v3.0.0. Enables evaluation of JavaScript inline in `.less` files. This created a security problem for some developers who didn't expect user input for style sheets to have executable code.

Replaced with the `@plugin` option.

#### Global Variables

| | |
|---|---|
| `lessc --global-var="color1=red"` | `{ globalVars: { color1: 'red' } }` |

This option defines a variable that can be referenced by the file. Effectively the declaration is put at the top of your base Less file, meaning it can be used but it also can be overridden if this variable is defined in the file.

#### Modify Variables

| | |
|---|---|
| `lessc --modify-var="color1=red"` | `{ modifyVars: { color1: 'red' } }` |

As opposed to the global variable option, this puts the declaration at the end of your base file, meaning it will override anything defined in your Less file.

#### URL Arguments

| | |
|---|---|
| `lessc --url-args="cache726357"` | `{ urlArgs: 'cache726357' }` |

This option allows you to specify a argument to go on to every URL. This may be used for cache-busting for instance. An escaped `url(~"…")` body is left as written, so it gets no argument (Less 4 appended one): in `url(~"'e.png'")` it would land after the closing quote, `url('e.png'?v=1)`, which is not a valid URL.

#### Line Numbers (Deprecated)

| | |
|---|---|
| `lessc --line-numbers=comments`<br>`lessc --line-numbers=mediaquery`<br>`lessc --line-numbers=all` | `{ dumpLineNumbers: 'comments' }` |

In Less 4.x this generated inline source-mapping, the only option before browsers supported source maps. Less 5 accepts the option but ignores it: no line-number comments or debug media queries are emitted, and setting it reports a `deprecation/dump-line-numbers-option` warning. Use [source maps](#source-map-options) instead.

#### Pre-Loaded Plugin

See: [Pre-Loaded Plugins](./plugins)


#### Lint

| | |
|---|---|
| `lessc --lint -l` | `{ lint: true }` |

Runs the less parser and just reports errors without any output.


#### Compress

| | |
|---|---|
| `lessc --compress -x` | `{ compress: true }` |

Emits minified CSS. In 5.x, compressed output is a supported feature rather than a deprecated one: it applies every safe fold that Less 4.x `compress` and dart-sass `compressed` apply, and never a transform that could change what the CSS means. It also replaces minifying plugins such as `less-plugin-clean-css`. See [Compressed Output](../advanced/compressed-output) for exactly what it changes.


#### Remote Imports

| | |
|---|---|
| `lessc --allow-remote-imports=cdn.example.com` | `{ allowRemoteImports: ['cdn.example.com'] }` |
| | `styles.config.*`: `compile: { plugins: [remoteImportPlugin({ allow: ['cdn.example.com'] })] }` |

Less 4.x downloaded every `@import` of an `http(s)://` URL. Less 5 downloads nothing by default: a URL import is left in the output as a plain CSS `@import`. A URL import that can never be plain CSS — `(reference)`, `(less)`, `(inline)`, `@compose` — is a compile error instead. To import Less from hosts you trust, install `@jesscss/plugin-remote-import` and add it to `compile.plugins` in a `styles.config.*` file beside (or above) your entry file. That config file is read by every Less 5 entry point that compiles a file: `lessc`, `less.render()` with a `filename`, and the `jess` CLI. `lessc` and the `jess` CLI also take the hosts directly: `--allow-remote-imports cdn.example.com,fonts.example.com` (comma-separated, and the flag may repeat), as does `less.render()` with `allowRemoteImports`; the flag and the option need the plugin installed next to `less` or `jess`.

```js
// styles.config.mjs
import { remoteImportPlugin } from '@jesscss/plugin-remote-import';

export default {
  compile: {
    plugins: [
      remoteImportPlugin({
        allow: ['cdn.example.com'], // required: exact host names
        maxBytes: 512 * 1024,       // optional: the default, in bytes
        timeout: 5000               // optional: the default, in milliseconds
      })
    ]
  }
};
```

With the plugin configured:

- Only `https://` URLs on an `allow` host are downloaded. Hosts are matched exactly by name — no wildcards, no ports, and no IP addresses. A host that resolves to a private, loopback or link-local address is refused.
- A URL Less treats as CSS — one written with a `.css` file name, such as `@import "@{cdn}/theme.css"`, or one marked `(css)` — is never downloaded, on an allowed host or not. A URL spelled entirely by a variable (`@import "@{url}"`) is judged by how it is written, not its value, so it follows the rules below.
- A URL on an allowed host is downloaded exactly as written, with or without a file extension. One without an extension is parsed in the language of the file that imports it.
- A URL without a file extension that isn't downloaded — on another host, an IP address, or plain `http://` — stays in the output as a plain CSS `@import`, so a Google Fonts stylesheet such as `@import url("https://fonts.googleapis.com/css?family=Open+Sans");` keeps working.
- Any other URL import that isn't downloaded — one with a file extension, such as `.less`, or an `(inline)`, `(reference)` or `(less)` import, which can never stay CSS — is a compile error. `(optional)` does not hide that error.
- An import that stays CSS keeps its media query: `@import url("https://fonts.googleapis.com/css?family=Open+Sans") screen;` comes out as written. An import that is downloaded is wrapped in `@media screen { … }`, as a local one is.
- `(optional)` skips a URL the server answers with 404 or 410, as it skips a missing local file.
- `@import (inline)` of an allowed URL downloads it and inlines it like a local file.
- Every path inside a downloaded file — in `@import`, `@import (inline)`, `data-uri()`, `@use` or `@plugin` — is resolved against the file's URL, so `@import "vars.less"` in `https://cdn.example.com/theme/main.less` loads `https://cdn.example.com/theme/vars.less`. A downloaded file can't read a file from your disk.
- `rewriteUrls` and `rootpath` work inside a downloaded file as they do inside a local import. When `rewriteUrls` rewrites a relative `url()`, it points it at the downloaded file's location: `url(img/a.png)` in `https://cdn.example.com/theme/main.less` becomes `url(https://cdn.example.com/theme/img/a.png)`.
- `data-uri()` and `image-size()` never download: a URL in `data-uri()` keeps its `url()` fallback. `@use` and `@plugin` load from local files only, so a URL there is an error, with or without the plugin.
- Redirects are followed only within the same origin, at most five times.
- A response larger than `maxBytes`, or an import that takes longer than `timeout` (redirects and body included), is an error.
- Downloads are not pinned to a lockfile or an integrity hash: a host that changes a file changes your build.

Under [Deno](https://deno.com/), also run with `--allow-net` set to the same hosts (for example `deno run --allow-net=cdn.example.com …`). Deno then refuses a connection to any other host even if the plugin's own check were wrong. The plugin refuses to start under Deno with unrestricted network access (`--allow-net` with no host list, or `-A`), because then nothing at runtime backs the allow list. Node has no per-host network permission, so on Node the plugin's check is the only one.

#### Allow Imports from Insecure HTTPS Hosts

| | |
|---|---|
| `lessc --insecure` | `{ insecure: true }` |

Less 5 ignores `insecure`, and `lessc` no longer accepts `--insecure`. [Remote imports](#remote-imports) are https-only and always verify the server's certificate.


## Source Map Options

Most of these options are not applicable to using Less.js in the browser, as you should generate a source map with your pre-compiled Less files.

#### Generate a Source Map

| | |
|---|---|
| `lessc --source-map` | `{ sourceMap: {} }` |

Tells less to generate a sourcemap.

The CSS ends with a `/*# sourceMappingURL=… */` annotation. Without a [Source Map URL](#source-map-url), the URL is the map's file name: `sourceMapFilename`, else `sourceMapOutputFilename` with `.map` appended, else the input file's name with `.css.map` (`main.less` → `main.css.map`). With none of those known, as for `less.render()` without a `filename`, no annotation is written. Empty output gets neither a map nor an annotation.

#### Source Map Output Filename

| | |
|---|---|
| `lessc --source-map=file.map` | `{ sourceMap: { outputFilename: 'file.map' } }` |

#### Source Map Rootpath

| | |
|---|---|
| `lessc --source-map-rootpath=dev-files/` | `{ sourceMap: { sourceMapRootpath: 'dev-files/' } }` |

Specifies a rootpath that should be prepended to each of the less file paths inside the sourcemap and also to the path to the map file specified in your output css.

Because the basepath defaults to the directory of the input less file, the rootpath defaults to the path from the sourcemap output file to the base directory of the input less file.

Use this option if for instance you have a css file generated in the root on your web server but have your source less/css/map files in a different folder. So for the option above you might have

```bash
output.css
dev-files/output.map
dev-files/main.less
```

#### Source Map Basepath

| | |
|---|---|
| `lessc --source-map-basepath=less-files/` | `{ sourceMap: { sourceMapBasepath: 'less-files/' } }` |

This is the opposite of the rootpath option, it specifies a path which should be removed from the output paths. For instance if you are compiling a file in the less-files directory but the source files will be available on your web server in the root or current directory, you can specify this to remove the additional `less-files` part of the path.

It defaults to the path to the input less file. It is also removed from the front of the `sourceMappingURL` written into the CSS, so a map URL under the basepath becomes relative to it.

#### Include Less Source in the Source Map

| | |
|---|---|
| `lessc --source-map-include-source` | `{ sourceMap: { outputSourceFiles: true } }` |

This option specifies that we should include all of the Less files in to the sourcemap. This means that you only need your map file to get to your original source.

This can be used in conjunction with the map inline option so that you do not need to have any additional external files at all.

#### Source Map Map Inline

| | |
|---|---|
| `lessc --source-map-inline` | `{ sourceMap: { sourceMapFileInline: true } }` |

This option specifies that the map file should be inline in the output CSS. This is not recommended for production, but for development it allows the compiler to produce a single output file which in browsers that support it, use the compiled css but show you the non-compiled less source.

#### Source Map URL

| | |
|---|---|
| `lessc --source-map-url=../my-map.json` | `{ sourceMap: { sourceMapURL: '../my-map.json' } }` |

Allows you to override the URL in the css that points at the map file. This is for cases when the rootpath and basepath options are not producing exactly what you need.
