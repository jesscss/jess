# @jesscss/plugin-node-modules

Jess plugin for resolving and loading npm packages from `node_modules`.

## Overview

This plugin provides npm/node_modules resolution and loading capabilities for all Jess language plugins. It uses Node's module resolution algorithm (`require.resolve`) to find and load npm packages.

## Usage

```typescript
import { Compiler } from '@jesscss/jess';
import nodeModulesPlugin from '@jesscss/plugin-node-modules';

const compiler = new Compiler({
  compile: {
    plugins: [
      nodeModulesPlugin(),
      // ... other plugins
    ]
  }
});
```

## API

### `resolvePackage(packageName: string): string | null`

Resolve an npm package name to its absolute path.

```typescript
const plugin = new NodeModulesPlugin();
const path = plugin.resolvePackage('less-plugin-clean-css');
// Returns: '/path/to/node_modules/less-plugin-clean-css/index.js' or null
```

### `loadPackage(packageName: string): Promise<Record<string, any> | null>`

Load an npm package module.

```typescript
const plugin = new NodeModulesPlugin();
const module = await plugin.loadPackage('less-plugin-clean-css');
// Returns: the module exports, or null if not found
```

### `tryResolvePackages(packageNames: string[]): Promise<{ name: string; module: Record<string, any> } | null>`

Try to resolve a package name with multiple possible names. Returns the first successfully resolved package.

```typescript
const plugin = new NodeModulesPlugin();
const result = await plugin.tryResolvePackages([
  'clean-css',
  'less-plugin-clean-css'
]);
// Returns: { name: 'less-plugin-clean-css', module: {...} } or null
```

## Integration with Other Plugins

Other plugins (like `@jesscss/plugin-less-compat`) can use this plugin to resolve npm packages:

```typescript
// In jess-plugin-less-compat
const nodeModulesPlugin = plugins.find(p => p.name === 'node-modules');
if (nodeModulesPlugin instanceof NodeModulesPlugin) {
  const module = await nodeModulesPlugin.loadPackage('less-plugin-clean-css');
}
```

## Options

- `enabled` (boolean, default: `true`): Whether to enable auto-resolution of npm packages.
