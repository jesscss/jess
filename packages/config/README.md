# styles-config

A general-purpose configuration system for styling frameworks including Jess, Less, Sass, Tailwind, and more.

## Overview

`styles-config` provides a unified configuration format and loading system that works across multiple CSS preprocessors and styling frameworks. It allows you to define configuration once and use it with different tools, or maintain separate configurations for different frameworks.

## Features

- **Universal Configuration Format**: Single configuration structure that works with multiple styling frameworks
- **Framework-Specific Options**: Support for Less, Sass, Jess, and other framework-specific settings
- **Flexible Loading**: Supports multiple config file formats (JSON, YAML, JavaScript, TypeScript)
- **Smart Merging**: Combines compile, output, and language-specific settings intelligently

## Installation

```bash
npm install styles-config
# or
pnpm add styles-config
# or
yarn add styles-config
```

## Configuration File Format

Create a configuration file in your project root. Supported file names:

- `styles.config.{c,m}?{js,ts}` e.g. `styles.config.ts`

### Configuration Structure

```typescript
interface StylesConfig {
  compile?: {
    plugins?: PluginInterface[];
    searchPaths?: string[];
    enableJavaScript?: boolean;
    mathMode?: 'always' | 'parens-division' | 'parens' | 'strict';
    unitMode?: 'loose' | 'strict';
  };
  output?: {
    collapseNesting?: boolean;
    compress?: boolean;
    sourceMap?: boolean;
  };
  language?: {
    less?: LessOptions;
    scss?: Record<string, any>;
    css?: Record<string, any>;
    jess?: Record<string, any>;
    [key: string]: any;
  };
}
```

### Example Configuration

```javascript
// jess.config.js
module.exports = {
  compile: {
    mathMode: 'parens-division',
    unitMode: 'loose',
    searchPaths: ['./src/styles', './node_modules']
  },
  output: {
    collapseNesting: false,
    compress: false,
    sourceMap: true
  },
  language: {
    less: {
      leakyRules: true,
      strictImports: false
    },
    scss: {
      precision: 10,
      outputStyle: 'expanded'
    },
    jess: {
      // Jess-specific options
    }
  }
};
```

## Usage

### Loading Configuration

```typescript
import { loadConfig, loadConfigSync } from 'styles-config';

// Async loading
const config = await loadConfig('/path/to/project');

// Sync loading
const config = loadConfigSync('/path/to/project');
```

### Getting Framework-Specific Options

The package provides helper functions that intelligently merge compile, output, and language-specific settings:

```typescript
import { getLessOptions, getScssOptions, getJessOptions } from 'styles-config';

const config = loadConfigSync();

// Get Less plugin options (combines compile + output + language.less)
const lessOptions = getLessOptions(config);

// Get Sass/SCSS plugin options (combines compile + output + language.scss)
const scssOptions = getScssOptions(config);

// Get Jess plugin options (combines compile + output + language.jess)
const jessOptions = getJessOptions(config);
```

### How Options Are Merged

The helper functions merge options in this priority order (highest to lowest):

1. **Language-specific options** (`language.less`, `language.scss`, etc.)
2. **Output options** (`output.*`)
3. **Compile options** (`compile.*`)

For example, if you have:

```javascript
{
  compile: { mathMode: 'parens-division' },
  output: { compress: true },
  language: {
    less: { mathMode: 'strict', compress: false }
  }
}
```

The resulting Less options would be:
- `mathMode: 'strict'` (from `language.less`, overrides `compile.mathMode`)
- `compress: false` (from `language.less`, overrides `output.compress`)

## Use Cases

### Single Framework Projects

For projects using a single styling framework:

```javascript
// jess.config.js
module.exports = {
  output: {
    sourceMap: true,
    compress: process.env.NODE_ENV === 'production'
  },
  language: {
    less: {
      leakyRules: false
    }
  }
};
```

### Multi-Framework Projects

For projects using multiple styling frameworks:

```javascript
// jess.config.js
module.exports = {
  compile: {
    mathMode: 'parens-division', // Shared across all frameworks
    unitMode: 'loose'
  },
  output: {
    sourceMap: true, // Shared output settings
    compress: false
  },
  language: {
    less: {
      strictImports: 'error' // Less-specific
    },
    scss: {
      precision: 10, // Sass-specific
      outputStyle: 'expanded'
    },
    jess: {
      // Jess-specific options
    }
  }
};
```

### Framework-Agnostic Tools

Build tools and bundlers can use this configuration format to support multiple styling frameworks:

```typescript
import { loadConfig, getLessOptions, getScssOptions } from 'styles-config';

const config = await loadConfig(projectRoot);

// Use appropriate options based on file extension
if (file.endsWith('.less')) {
  const options = getLessOptions(config);
  // Pass to Less compiler
} else if (file.endsWith('.scss')) {
  const options = getScssOptions(config);
  // Pass to Sass compiler
}
```

## API Reference

### `loadConfig(searchFrom?: string): Promise<StylesConfig | null>`

Asynchronously loads configuration from the file system, searching from the given directory up to the root.

**Parameters:**
- `searchFrom` (optional): Directory path to start searching from. Defaults to `process.cwd()`.

**Returns:** Configuration object or `null` if not found.

### `loadConfigSync(searchFrom?: string): StylesConfig`

Synchronously loads configuration from the file system.

**Parameters:**
- `searchFrom` (optional): Directory path to start searching from. Defaults to `process.cwd()`.

**Returns:** Configuration object or empty object `{}` if not found.

### `loadConfigFromPath(filePath: string): Promise<StylesConfig | null>`

Loads configuration from a specific file path (async).

### `loadConfigFromPathSync(filePath: string): StylesConfig`

Loads configuration from a specific file path (sync).

### `getLessOptions(config: StylesConfig): LessOptions`

Merges compile, output, and `language.less` settings into Less plugin options.

### `getScssOptions(config: StylesConfig): Record<string, any>`

Merges compile, output, and `language.scss` settings into Sass/SCSS plugin options.

### `getJessOptions(config: StylesConfig): Record<string, any>`

Merges compile, output, and `language.jess` settings into Jess plugin options.

## Supported Frameworks

- **Jess** - JavaScript Enhanced Style Sheets
- **Less** - The dynamic stylesheet language
- **Sass/SCSS** - Syntactically Awesome Style Sheets
- **Tailwind CSS** - Utility-first CSS framework (via plugins)
- **PostCSS** - Tool for transforming CSS with JavaScript
- **Any custom framework** - Extensible to support any styling tool

## Contributing

This package is designed to be extensible. To add support for a new framework:

1. Add the framework's options type to `src/types.ts`
2. Create a helper function in `src/options.ts` that merges settings appropriately
3. Update the documentation

## License

MIT

