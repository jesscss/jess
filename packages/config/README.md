# styles-config

A general-purpose configuration system for styling frameworks including Jess, Less, Sass, Tailwind, and more.

## Overview

`styles-config` provides a unified configuration format and loading system that works across multiple CSS preprocessors and styling frameworks. It allows you to define configuration once and use it with different tools, or maintain separate configurations for different frameworks.

## Features

- **Universal Configuration Format**: Single configuration structure that works with multiple styling frameworks
- **Framework-Specific Options**: Support for Less, Sass, Jess, and other framework-specific settings
- **Per-File Configuration**: Override settings for specific input or output files using paths or glob patterns
- **Flexible Loading**: Supports multiple config file formats (JSON, YAML, JavaScript, TypeScript)
- **Smart Merging**: Combines compile, language, input, and output settings intelligently

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
    equalityMode?: 'coerce' | 'strict';
  };
  input?: InputOptions | InputOptions[];
  output?: OutputOptions | OutputOptions[];
  language?: {
    less?: LessOptions;
    scss?: Record<string, any>;
    css?: Record<string, any>;
    jess?: Record<string, any>;
    [key: string]: any;
  };
}

interface InputOptions {
  file?: string;  // Path or glob pattern to match input files
  mathMode?: MathMode;
  unitMode?: UnitMode;
  equalityMode?: EqualityMode;
  // ... any compile or language options to override
}

interface OutputOptions {
  file?: string;  // Path or glob pattern to match output files
  collapseNesting?: boolean;
  compress?: boolean;
  sourceMap?: boolean;
  // ... any output options to override
}
```

### Example Configuration

```javascript
// styles.config.js
export default {
  compile: {
    mathMode: 'parens-division',
    unitMode: 'loose',
    equalityMode: 'coerce',
    searchPaths: ['./src/styles', './node_modules']
  },
  input: [
    // Default input options (no file pattern)
    { leakyRules: false },
    // Override for legacy files
    { file: 'legacy/**/*.less', mathMode: 'always', leakyRules: true }
  ],
  output: [
    // Default output options
    { sourceMap: true, compress: false },
    // Override for minified builds
    { file: '**/*.min.css', compress: true, sourceMap: false }
  ],
  language: {
    less: {
      strictImports: false
    },
    scss: {
      precision: 10,
      outputStyle: 'expanded'
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

### Getting Merged Options

Use the `getOptions` function to get merged options for a specific file:

```typescript
import { loadConfigSync, getOptions } from 'styles-config';

const config = loadConfigSync();

// Language is inferred from the input file extension
const options = getOptions(config, {
  input: 'src/styles/main.less',
  output: 'dist/main.css'
});

// Or explicitly specify the language
const options = getOptions(config, {
  language: 'less',
  input: 'src/styles/main.less',
  output: 'dist/main.css'
});

// Get default options for a language (no file matching)
const defaults = getOptions(config, { language: 'scss' });
```

### How Options Are Merged

Options are merged in this priority order (later wins):

1. **Compile options** (`compile.*`) - base settings
2. **Language-specific options** (`language.less`, etc.) - language defaults
3. **Matched input options** (`input[]` entries matching the input file)
4. **Matched output options** (`output[]` entries matching the output file)

For example, with this config:

```javascript
{
  compile: { mathMode: 'parens-division' },
  input: [
    { leakyRules: false },
    { file: 'legacy/**/*.less', mathMode: 'always', leakyRules: true }
  ],
  output: [
    { compress: false },
    { file: '**/*.min.css', compress: true }
  ],
  language: {
    less: { collapseNesting: true }
  }
}
```

Calling `getOptions(config, { input: 'legacy/old.less', output: 'dist/old.min.css' })`:
- `mathMode: 'always'` - from matched input (overrides compile)
- `leakyRules: true` - from matched input (overrides default input)
- `collapseNesting: true` - from language.less
- `compress: true` - from matched output (overrides default output)

### File Matching

Both `input` and `output` options support file matching via the `file` property:

- **Exact paths**: `src/styles/main.less`
- **Relative paths**: `main.less` (matches any file with that basename)
- **Glob patterns**: `legacy/**/*.less`, `**/*.min.css`

Entries without a `file` property serve as defaults and always apply.

## Use Cases

### Single Framework Projects

```javascript
// styles.config.js
export default {
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

```javascript
// styles.config.js
export default {
  compile: {
    mathMode: 'parens-division',
    unitMode: 'loose'
  },
  output: {
    sourceMap: true,
    compress: false
  },
  language: {
    less: {
      strictImports: 'error'
    },
    scss: {
      precision: 10,
      outputStyle: 'expanded'
    }
  }
};
```

### Per-File Overrides

```javascript
// styles.config.js
export default {
  compile: {
    mathMode: 'parens-division'
  },
  input: [
    // Modern files use strict math
    { file: 'src/modern/**/*.less', mathMode: 'strict' },
    // Legacy files need legacy behavior
    { file: 'src/legacy/**/*.less', mathMode: 'always', leakyRules: true }
  ],
  output: [
    // Development builds
    { sourceMap: true, compress: false },
    // Production minified builds
    { file: 'dist/**/*.min.css', compress: true, sourceMap: false }
  ]
};
```

### Framework-Agnostic Tools

Build tools can use the configuration format to support multiple styling frameworks:

```typescript
import { loadConfig, getOptions } from 'styles-config';

const config = await loadConfig(projectRoot);

// Options are automatically merged based on input/output files
// Language is inferred from the input extension
const options = getOptions(config, {
  input: file,
  output: outputPath
});
```

## API Reference

### `loadConfig(searchFrom?: string): Promise<StylesConfig | null>`

Asynchronously loads configuration from the file system, searching from the given directory up to the root.

### `loadConfigSync(searchFrom?: string): StylesConfig`

Synchronously loads configuration from the file system.

### `loadConfigFromPath(filePath: string): Promise<StylesConfig | null>`

Loads configuration from a specific file path (async).

### `loadConfigFromPathSync(filePath: string): StylesConfig`

Loads configuration from a specific file path (sync).

### `getOptions(config: StylesConfig, params?: GetOptionsParams): Record<string, any>`

Merges configuration based on language, input file, and output file.

**Parameters:**
- `config`: The styles configuration object
- `params.language`: Language key (e.g., 'less', 'scss'). Inferred from input extension if not provided.
- `params.input`: Input file path for matching input options
- `params.output`: Output file path for matching output options

**Returns:** Merged options object

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
2. Add the extension mapping in `src/options.ts` if needed
3. Update the documentation

## License

MIT
