# @jesscss/plugin-less-compat

**A Less compatibility bridge for Jess.**

[Jess](https://github.com/jesscss/jess) accepts typed AST-v2 `Fn` values here
and provides the shared Jess-owned bridge for Less-style plugin function
registration and Less-shaped function values.

The public compiler does **not** support Less 4 visitors, post-processors, file
manager plugins, or a full Less tree AST adapter.

## How it works

- **Native functions only** — pass `Fn` values from `@jesscss/core`; their
  bodies receive typed values and `FnCtx` capabilities.
- **Less plugin function bridge** — pass Less-style plugins with
  `install(less, manager, functions)` through `plugins`. The bridge supplies a
  Less-shaped `functions.functionRegistry` and the supported `less.tree`
  constructor facades, then lazily adapts function arguments and return values at
  the Jess boundary.

For example, migrate a Less `functionRegistry.add('increment', fn)` contribution
to a typed function and register it through `functions`:

```ts
import { Compiler } from 'jess';
import { defineFunction, makeDimension } from '@jesscss/core';
import lessCompatPlugin from '@jesscss/plugin-less-compat';

const increment = defineFunction('increment', {
  params: [{ type: 'Dimension' }] as const,
  body: value => makeDimension(value.number + 1, value.unit)
});

const compiler = new Compiler({
  compile: { plugins: [lessCompatPlugin({ functions: [increment] })] }
});
```

For legacy Less function plugins:

```ts
const legacyPlugin = {
  install(less, _manager, functions) {
    functions.add('increment', value =>
      new less.tree.Dimension(value.value + 1, value.unit)
    );
  }
};

const compiler = new Compiler({
  compile: { plugins: [lessCompatPlugin({ plugins: [legacyPlugin] })] }
});
```

Less-shaped values are boundary values only. Jess owns their conversion back
into typed AST-v2 values. The current bridge supports function registration and
value conversion; it does not install a broad Less tree facade for visitors or
prototype-patching plugins.

## Status

**Alpha / experimental.** The supported public routes are native function
contribution and Less plugin function bridging. If you need Less visitors,
post-processors, file managers, or broad Less tree AST mutation support today,
use Less.js directly.

The programmatic plugin/compiler API is **not yet stabilized** — the `jess` CLI
is the documented public surface for the alpha. Watch the
[docs site](https://jesscss.github.io/) for the API once it settles. Current
design notes live in [DESIGN.md](./DESIGN.md).

- Project overview & positioning: <https://github.com/jesscss/jess#readme>
- Docs: <https://jesscss.github.io/> (currently pre-alpha content)
- Issues: <https://github.com/jesscss/jess/issues>
- License: MIT
