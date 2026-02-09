# @jesscss/plugin-less-compat

Less.js compatibility layer for Jess. This plugin enables Less.js plugins and visitors to work seamlessly with Jess-compiled stylesheets by providing bidirectional transformation between Jess AST nodes and Less.js AST nodes.

## ⚠️ Experimental Status

**This package is experimental and largely LLM-generated.** It was created to explore compatibility between Jess and Less.js plugins, but:

- **No long-term maintenance commitment**: This package is unlikely to be actively maintained in the future
- **Use at your own risk**: While it may work for some use cases, it has not been thoroughly tested across all Less.js plugins
- **Breaking changes likely**: The API and implementation may change or be removed without notice
- **Not production-ready**: This is an experimental exploration, not a production-grade compatibility layer

If you need Less.js plugin compatibility, consider:
- Using Less.js directly for projects that require extensive Less.js plugin support
- Contributing improvements if you find this package useful
- Creating your own compatibility layer tailored to your specific needs

## Features

- 🔄 **Bidirectional Transformation**: Convert between Jess and Less AST nodes
- 🎯 **Lazy Conversion**: Proxy-based lazy conversion for optimal performance
- 🔌 **Plugin Compatibility**: Use existing Less.js plugins with Jess
- 🧩 **Visitor Support**: Run Less.js visitors on Jess AST trees
- 📦 **Type Safe**: Full TypeScript support

## Installation

```bash
pnpm add @jesscss/plugin-less-compat
```

## Usage

### Basic Usage with Less Plugins

```typescript
import { Compiler } from '@jesscss/jess';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import autoprefix from 'less-plugin-autoprefix';

const compiler = new Compiler({
  plugins: [
    lessPlugin(),
    lessCompatPlugin({
      visitors: [autoprefix]
    })
  ]
});

const result = await compiler.compile('styles.less');
```

### Advanced: Direct Transformation

```typescript
import { toLessTree, fromLessTree } from '@jesscss/plugin-less-compat/transform';
import customLessVisitor from './custom-visitor';

const jessTree = parseJess(source);
const lessTree = toLessTree(jessTree);

// Apply custom Less visitor
lessTree.accept(customLessVisitor);

// Convert back to Jess
const modifiedJessTree = fromLessTree(lessTree);
```

### Using with Multiple Less Plugins

```typescript
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import autoprefix from 'less-plugin-autoprefix';
import cleanCSS from 'less-plugin-clean-css';

const compiler = new Compiler({
  plugins: [
    lessPlugin(),
    lessCompatPlugin({
      visitors: [
        autoprefix,
        cleanCSS
      ]
    })
  ]
});
```

## Supported Less Plugins

This package has been tested with:

- ✅ `less-plugin-autoprefix` - Automatic vendor prefixing
- ✅ `less-plugin-clean-css` - CSS minification
- ✅ `less-plugin-dls` - Design Language System support

Other Less.js plugins should work, but may require additional testing.

## API

### `lessCompatPlugin(options?)`

Creates a Jess plugin that enables Less.js compatibility.

**Options:**
- `visitors?: LessVisitor[]` - Array of Less.js visitors to apply
- `cache?: boolean` - Enable conversion caching (default: `true`)

### `toLessTree(jessRules: Rules)`

Converts a Jess `Rules` tree to a Less.js-compatible tree.

### `fromLessTree(lessTree: LessNode)`

Converts a Less.js tree back to a Jess `Rules` tree.

### `toLessNode(jessNode: Node, options?)`

Converts a single Jess node to a Less.js-compatible node.

### `fromLessNode(lessNode: LessNode, options?)`

Converts a single Less.js node back to a Jess node.

## Implementation Status

This package is currently in **alpha**.

Developer notes and historical analyses live in [DESIGN.md](./DESIGN.md) and `_archive/`.

## Contributing

Contributions welcome! Please see the main Jess repository for contribution guidelines.

## License

MIT
