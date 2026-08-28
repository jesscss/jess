---
title: "Writing a plugin"
sidebar_label: Plugins
audiences:
  - jess
origin: jess
---

Jess does not (yet) have a formally-specified plugin API. This page documents the
**de-facto shape** that the built-in plugins actually use, so you can write one in
the same style. Two capabilities are covered:

1. **Registering a language / dialect** — teach the compiler to handle a file
   extension.
2. **Extending parsing and resolution** — bring a parser, register functions, and
   customize how imports are found.

:::note Scope
This page intentionally covers the public language, parser, resolution, and
lifecycle surface. Core has no generic legacy-tree visitor hook. The deprecated
Less 4.x visitor ABI, where needed, is owned exclusively by
`@jesscss/plugin-less-compat`; it is not a Jess plugin interface or AST-v2
extension API.
:::

## The shape of a plugin

A plugin is an object that implements the compiler's plugin interface. The built-in
plugins extend `AbstractPlugin` from `@jesscss/core` (which supplies sensible
default `resolve` / `getSource` implementations) and are exported as a small factory
function. You pass instances to the compiler through the `plugins` option:

```ts
import { Compiler } from 'jess';
import lessPlugin from '@jesscss/plugin-less';

const compiler = new Compiler({
  compile: {
    plugins: [lessPlugin()]
  }
});
```

The fields and methods the compiler looks for:

| Member | Purpose |
| --- | --- |
| `name` | Identifier for the plugin, e.g. `'less'`. |
| `supportedExtensions` | Extensions this plugin can parse, e.g. `['.less']`. |
| `safeParse(filePath, source, opts)` | Parse a file once, returning a canonical document result plus diagnostics (never throws). |
| `expandImport(importPath, currentDir)` | Turn an import specifier into candidate paths. |
| `resolve(path, currentDir, searchPaths)` | Map a specifier to absolute path(s). |
| `locate(candidates, currentDir)` | Pick the first candidate that exists. |
| `getSource(absolutePath)` | Read a file's source (defaults to reading from disk). |

## 1. Registering a language / dialect

The built-in `@jesscss/plugin-jess` owns `.jess` and is registered by `Compiler`
by default. A custom dialect uses the same explicit extension ownership:

To actually compile that language, a plugin declares which extensions it owns and
provides a `safeParse` method. The compiler selects a plugin for a file by matching
`supportedExtensions` against the file's extension:

```ts
import { AbstractPlugin } from '@jesscss/core';

export class MyPlugin extends AbstractPlugin {
  name = 'my-lang';
  supportedExtensions = ['.mylang'];

  safeParse(filePath: string, source: string) {
    // ...parse once through the dialect grammar, returning a Stylesheet and diagnostics
  }
}
```

`safeParse` returns a result object rather than throwing. Its document is the
canonical AST v2 `Stylesheet` (omit it when parsing failed):

- `document` — the parsed `Stylesheet` root.
- `dialectDefaults` — an optional readonly set of evaluation defaults proposed
  by the dialect. The entry parser's defaults establish the session fallback;
  explicit compiler options win, and imported parsers cannot reconfigure the
  active session.
- `errors` — an array of error diagnostics; a non-empty array aborts compilation of
  the file.
- `warnings` — non-fatal diagnostics (for example deprecation notices).

Older plugin examples used `{ tree: Rules, errors, warnings }`. That is legacy
tree terminology, not the AST v2 contract, and must not be copied into a new
plugin or adapter. `Context` remains the dispatcher that calls the installed
plugin's parse and import-resolution methods; this change does not create a
second loader or resolver path.

## 2. Extending parsing and resolution

The Less and SCSS plugins are the full-featured examples. Each one:

The public direction for every dialect, including Less, is direct Parseman
grammar reduction to `Stylesheet` through its package `parse()` operation. A
CST may still be exposed for explicit language-service/document use, but it is
not an AST bridge or a production parser route.

That is the important boundary for dialect plugins: a language front end owns
syntax and import conventions, then hands the compiler the same canonical
stylesheet document every other dialect hands it. Jess is designed as a common
stylesheet runtime in that sense, not as a set of parallel compilers with
parallel output semantics.

**Customizes import resolution.** `expandImport` turns a bare specifier into the
candidate filenames to try (e.g. `foo` → `./foo.less`), and `resolve` maps
specifiers to concrete paths. A plugin whose sole job is resolution can implement
just these — `@jesscss/plugin-node-modules` implements `import()` to load npm
packages and is composed alongside a language plugin:

```ts
const compiler = new Compiler({
  compile: {
    plugins: [lessPlugin(), nodeModulesPlugin()]
  }
});
```

Plugins are consulted in order, so a resolution-only plugin can extend how another
plugin's language finds its imports.

## Options

Give your factory an options object and fold unset values from a single defaults
object, so the CLI and the programmatic API can share one source of truth (the Less
plugin exports `lessPluginDefaults` for exactly this reason):

```ts
const myPlugin = (opts = {}) => new MyPlugin(opts);
export default myPlugin;
```

If those defaults affect evaluation, return a frozen readonly projection as
`dialectDefaults` on each successful parse result. Do not mutate `Context` from
`setContext`; Context resolves the entry dialect's defaults once and keeps the
result immutable for the compilation session.

## Bundler integration

Bundler plugins are thin wrappers around the compiler rather than compiler plugins.
`rollup-plugin-jess`, for example, creates a `Compiler` and calls
`compiler.renderString()` in Rollup's `transform` hook — a useful pattern if you
need to integrate Jess with another build tool.
