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
This page intentionally covers only the language + parser/resolution surface. The
`visitor` / `beforeEvalVisitor` / `postEvalVisitor` hooks on the plugin interface
exist to support the internal Less 4.x compatibility layer
(`@jesscss/plugin-less-compat`) and are **not** a stable, supported public API — do
not build against them.
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
| `safeParse(filePath, source, opts)` | Parse a file, returning `{ tree, errors, warnings }` (never throws). |
| `parse(filePath, source)` | Throwing variant, if you prefer it over `safeParse`. |
| `expandImport(importPath, currentDir)` | Turn an import specifier into candidate paths. |
| `resolve(path, currentDir, searchPaths)` | Map a specifier to absolute path(s). |
| `locate(candidates, currentDir)` | Pick the first candidate that exists. |
| `getSource(absolutePath)` | Read a file's source (defaults to reading from disk). |

## 1. Registering a language / dialect

The minimal case — associating a name with a file extension — is what the base
`jess-plugin` package does:

```ts
import { definePlugin } from 'jess-plugin';

export default definePlugin({
  language: {
    name: 'jess',
    ext: '.jess'
  }
});
```

To actually compile that language, a plugin declares which extensions it owns and
provides a `safeParse` method. The compiler selects a plugin for a file by matching
`supportedExtensions` against the file's extension:

```ts
import { AbstractPlugin, type ISafeParseResult } from '@jesscss/core';

export class MyPlugin extends AbstractPlugin {
  name = 'my-lang';
  supportedExtensions = ['.mylang'];

  safeParse(filePath: string, source: string): ISafeParseResult {
    // ...parse, returning { tree, errors, warnings }
  }
}
```

`safeParse` returns a result object rather than throwing:

- `tree` — the parsed `Rules` root (omit it when parsing failed).
- `errors` — an array of error diagnostics; a non-empty array aborts compilation of
  the file.
- `warnings` — non-fatal diagnostics (for example deprecation notices).

## 2. Extending parsing and resolution

The Less and SCSS plugins are the full-featured examples. Each one:

**Brings its own parser** and threads a per-file `TreeContext` through it. The
context carries the compiler options the parser and evaluator need (math mode, unit
mode, equality mode, `collapseNesting`, and so on):

```ts
import { AbstractPlugin, TreeContext, type Rules } from '@jesscss/core';
import { Parser } from '@jesscss/less-parser/jess';

export class LessPlugin extends AbstractPlugin {
  name = 'less';
  supportedExtensions = ['.less'];
  parser = new Parser();

  safeParse(filePath, source) {
    const context = new TreeContext({
      file: { /* name, path, fullPath, source */ },
      mathMode: this.mathMode,
      unitMode: this.unitMode,
      collapseNesting: this.collapseNesting
      // ...other options
    });
    const { tree, errors, warnings } = this.parser.parse(source, 'Stylesheet', { context });
    // register functions on the tree, then:
    return { tree, errors, warnings };
  }
}
```

**Registers built-in functions** onto the parsed tree with
`tree.setFunctionBinding(name, fn)`. The Less plugin, for instance, walks the
`@jesscss/fns` exports and binds each one so `.less` sources can call them:

```ts
import * as lessFunctions from '@jesscss/fns';
import { JsFunction } from '@jesscss/core';

for (const [key, value] of Object.entries(lessFunctions)) {
  if (typeof value !== 'function') continue;
  const name = value.name || key;
  tree.setFunctionBinding(name, new JsFunction({ name, fn: value }));
}
```

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

## Bundler integration

Bundler plugins are thin wrappers around the compiler rather than compiler plugins.
`rollup-plugin-jess`, for example, creates a `Compiler` and calls
`compiler.renderString()` in Rollup's `transform` hook — a useful pattern if you
need to integrate Jess with another build tool.
