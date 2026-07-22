# @jesscss/plugin-less-compat

**An AST-v2 native-function contribution package.**

[Jess](https://github.com/jesscss/jess) accepts typed AST-v2 `Fn` values here.
The public compiler does **not** support Less 4 visitors, `functionRegistry`
callbacks, `@plugin` scripts, post-processors, or conversion between Less tree
nodes and Jess values.

## How it works

- **Native functions only** — pass `Fn` values from `@jesscss/core/value`; their
  bodies receive typed values and `FnCtx` capabilities.

For example, migrate a Less `functionRegistry.add('increment', fn)` contribution
to a typed function and register it through `functions`:

```ts
import { Compiler } from 'jess';
import { defineFunction, makeDimension } from '@jesscss/core/value';
import lessCompatPlugin from '@jesscss/plugin-less-compat';

const increment = defineFunction('increment', {
  params: [{ kinds: ['Dimension'] }] as const,
  body: value => makeDimension(value.number + 1, value.unit)
});

const compiler = new Compiler({
  compile: { plugins: [lessCompatPlugin({ functions: [increment] })] }
});
```

The old `plugins`/`functionRegistry` option is not a compatibility shim: it is
not part of this package's public options. Legacy Less visitors, tree values,
and script-plugin hooks must be migrated to an AST-v2 plugin or run under
Less.js directly.

## Status

**Alpha / experimental.** The supported public route is native function
contribution only. If you need Less visitors, `functionRegistry`, script-plugin,
or post-processor support today, use Less.js directly.

The programmatic plugin/compiler API is **not yet stabilized** — the `jess` CLI
is the documented public surface for the alpha. Watch the
[docs site](https://jesscss.github.io/) for the API once it settles. Current
design notes live in [DESIGN.md](./DESIGN.md).

- Project overview & positioning: <https://github.com/jesscss/jess#readme>
- Docs: <https://jesscss.github.io/> (currently pre-alpha content)
- Issues: <https://github.com/jesscss/jess/issues>
- License: MIT
