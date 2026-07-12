#!/usr/bin/env node
// lessc drop-in CLI for Jess.
//
// This is a drop-in for the `lessc` *command surface* (flags, stdin/stdout,
// exit codes), but its default OUTPUT follows Less v5 semantics: nesting is
// preserved. The v5 defaults come from the Less plugin (`lessPluginDefaults`,
// imported below) so the CLI can never drift from the engine — notably
// `collapseNesting: false`. Less 4.x-style selector flattening is an explicit
// opt-in via `--collapse-nesting`. The Compiler wires `lessPlugin()` by default.
//
// Argument parsing is hand-rolled (not `node:util` parseArgs) so that (a) an
// unknown flag produces a graceful lessc-style error instead of a raw Node
// crash, and (b) we can accept lessc's `-m=value` / `-su=on` / `--flag=value`
// attached-value syntax exactly.

import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { Compiler } from '../lib/index.js';
import { logger } from '@jesscss/core';
import { lessPluginDefaults } from '@jesscss/plugin-less';

const require = createRequire(import.meta.url);

// The engine's `render()`/`renderString()` log thrown errors via `logger.error`
// before rethrowing. This CLI catches and formats every error itself (a single
// lessc-style line), so silence the engine's own error channel to avoid a
// duplicate, chalk-colored copy on stderr.
logger.configure({ error() {} });

function lessVersion() {
  try {
    return require('less/package.json').version;
  } catch {
    try {
      const pkg = require('../package.json');
      return pkg.version;
    } catch {
      return '0.0.0';
    }
  }
}

const USAGE = `usage: lessc [option option=parameter ...] <source> [destination]

If source is set to \`-' (dash or hyphen-minus), input is read from stdin.

options:
  -h, --help                   Prints help (this message) and exit.
  --include-path=PATHS         Sets include paths. Separated by \`:'. \`;' also supported on windows.
  -I, --include-path=PATHS     Alias of --include-path.
  -M, --depends                Outputs a makefile import dependency list to stdout.
  --no-color                   Disables colorized output.
  --js                         Enables inline JavaScript in less files (gates @plugin).
  -l, --lint                   Syntax check only (lint).
  -s, --silent                 Suppresses output of error messages.
  --quiet                      Suppresses output of warnings.
  --strict-imports             Ignores .less imports inside selector blocks.
  --insecure                   Allows imports from insecure https hosts.
  -v, --version                Prints version number and exit.
  --verbose                    Be verbose.
  --source-map[=FILENAME]      Outputs a v3 sourcemap to the filename (or output filename.map).
  --source-map-rootpath=X      Adds this path onto the sourcemap filename and less file paths.
  --source-map-basepath=X      Sets sourcemap base path, defaults to current working directory.
  --source-map-include-source  Puts the less files into the map instead of referencing them.
  --source-map-inline          Puts the map as a base64 data uri into the output css file.
  --source-map-url=URL         Sets a custom URL to map file, for sourceMappingURL comment.
  --source-map-no-annotation   Excludes the sourceMappingURL comment from the output css file.
  -rp, --rootpath=URL          Sets rootpath for url rewriting in relative imports and urls.
  -ru=, --rewrite-urls=        Rewrites URLs to make them relative to the base less file.
    all|local|off              'all' rewrites all URLs, 'local' just those starting with a '.'
  -m=, --math=
     always                    Less will eagerly perform math operations always.
     parens-division           Math performed except for division (/) operator.
     parens | strict           Math only performed inside parentheses.
  -su=on|off                   Allows mixed units, e.g. 1px+1em or 1px*1px.
  --strict-units=on|off        Same as -su.
  --global-var='VAR=VALUE'     Defines a variable that can be referenced by the file.
  --modify-var='VAR=VALUE'     Modifies a variable already declared in the file.
  --url-args='QUERYSTRING'     Adds params into url tokens (e.g. 42, cb=42 or 'a=1&b=2').
  --plugin=PLUGIN=OPTIONS      Loads a plugin.
  --disable-plugin-rule        Disallow @plugin statements.
  -x, --compress               Compresses output by removing some whitespaces.
  --collapse-nesting[=on|off]  Flatten nested selectors (Less 4.x-style). v5 preserves
                               nesting by default; use this to opt into 4.x output.

Report bugs to: http://github.com/jesscss/jess/issues
Home page: <http://lesscss.org/>`;

function printUsage(stream = process.stdout) {
  stream.write(USAGE + '\n');
}

function fail(message, exitCode = 1) {
  process.stderr.write(`lessc: ${message}\n`);
  process.exit(exitCode);
}

/** Parse a `NAME=VALUE` pair (used by --global-var / --modify-var). */
function parseVarAssignment(raw) {
  const eq = raw.indexOf('=');
  if (eq === -1) {
    return { name: raw.trim(), value: '' };
  }
  return { name: raw.slice(0, eq).trim(), value: raw.slice(eq + 1) };
}

/**
 * Map a lessc `--math` value to the engine's `mathMode`. Less 4.x treats
 * `strict` and `strict-legacy` as equivalent to `parens` ("math only inside
 * parentheses"), which is the engine's `parens` mode.
 */
function mapMath(value) {
  switch (value) {
    case 'always':
    case '0':
      return 'always';
    case 'parens-division':
    case '1':
      return 'parens-division';
    case 'parens':
    case 'strict':
    case 'strict-legacy':
    case '2':
    case '3':
      return 'parens';
    default:
      return null;
  }
}

function onOff(value) {
  if (value === undefined || value === '' || value === 'on' || value === 'true') {
    return true;
  }
  if (value === 'off' || value === 'false') {
    return false;
  }
  return true;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function main(argv) {
  const args = argv.slice(2);

  // Accumulated engine option pieces.
  const lessOptions = {};
  const outputOptions = {};
  let mode = 'compile'; // 'compile' | 'lint' | 'depends'
  let silent = false;
  let quiet = false;
  let verbose = false;
  const positionals = [];
  const globalVars = {};
  const modifyVars = {};
  let hasGlobalVars = false;
  let hasModifyVars = false;
  const plugins = [];
  let sourceMap;
  const sourceMapOptions = {};

  const takeValue = (token, eqIdx) => (eqIdx === -1 ? undefined : token.slice(eqIdx + 1));

  for (let i = 0; i < args.length; i++) {
    const token = args[i];

    // `-` on its own is the stdin marker (a positional).
    if (token === '-' || token[0] !== '-') {
      positionals.push(token);
      continue;
    }

    const eqIdx = token.indexOf('=');
    const name = eqIdx === -1 ? token : token.slice(0, eqIdx);
    const inlineValue = takeValue(token, eqIdx);

    switch (name) {
      case '-h':
      case '--help':
        printUsage();
        process.exit(0);
        break;
      case '-v':
      case '--version':
        process.stdout.write(`lessc ${lessVersion()} (Less Compiler) [Jess]\n`);
        process.exit(0);
        break;
      case '-l':
      case '--lint':
        mode = 'lint';
        break;
      case '-M':
      case '--depends':
        mode = 'depends';
        break;
      case '-s':
      case '--silent':
        silent = true;
        break;
      case '--quiet':
      case '--quiet-deprecations':
        quiet = true;
        break;
      case '--verbose':
        verbose = true;
        break;
      case '-x':
      case '--compress':
        outputOptions.compress = true;
        break;
      case '--collapse-nesting':
      case '--flatten':
        // v5 preserves nesting by default; this opts into Less 4.x-style
        // selector flattening (byte-for-byte 4.x output).
        outputOptions.collapseNesting = onOff(inlineValue);
        break;
      case '--no-color':
        lessOptions.color = false;
        break;
      case '--js':
        lessOptions.javascriptEnabled = true;
        break;
      case '--insecure':
        lessOptions.insecure = true;
        break;
      case '--ie-compat':
        // Accepted for compatibility; no-op in the modern engine.
        break;
      case '--strict-imports':
        lessOptions.strictImports = true;
        break;
      case '--disable-plugin-rule':
        lessOptions.disableScriptModules = true;
        break;
      case '-I':
      case '--include-path': {
        const value = inlineValue ?? args[++i];
        if (value === undefined) {
          fail(`option ${name} requires a value`);
        }
        const paths = value.split(/[:;]/).filter(Boolean);
        lessOptions.paths = [...(lessOptions.paths ?? []), ...paths];
        break;
      }
      case '-m':
      case '--math': {
        const value = inlineValue ?? args[++i];
        const mapped = mapMath(value);
        if (mapped === null) {
          fail(`could not parse math option ${JSON.stringify(value)}`);
        }
        lessOptions.mathMode = mapped;
        break;
      }
      case '-sm':
      case '--strict-math':
        // Deprecated legacy toggle: on => parens, off => default (parens-division).
        lessOptions.mathMode = onOff(inlineValue) ? 'parens' : 'parens-division';
        break;
      case '-su':
      case '--strict-units':
        lessOptions.strictUnits = onOff(inlineValue);
        break;
      case '-rp':
      case '--rootpath': {
        const value = inlineValue ?? args[++i];
        if (value === undefined) {
          fail(`option ${name} requires a value`);
        }
        lessOptions.rootpath = value;
        break;
      }
      case '-ru':
      case '--rewrite-urls': {
        const value = inlineValue ?? 'all';
        lessOptions.rewriteUrls = value;
        break;
      }
      case '--url-args': {
        const value = inlineValue ?? args[++i];
        if (value === undefined) {
          fail(`option ${name} requires a value`);
        }
        lessOptions.urlArgs = value;
        break;
      }
      case '--global-var': {
        const value = inlineValue ?? args[++i];
        if (value === undefined) {
          fail(`option ${name} requires a value`);
        }
        const { name: varName, value: varValue } = parseVarAssignment(value);
        globalVars[varName] = varValue;
        hasGlobalVars = true;
        break;
      }
      case '--modify-var': {
        const value = inlineValue ?? args[++i];
        if (value === undefined) {
          fail(`option ${name} requires a value`);
        }
        const { name: varName, value: varValue } = parseVarAssignment(value);
        modifyVars[varName] = varValue;
        hasModifyVars = true;
        break;
      }
      case '--plugin': {
        const value = inlineValue ?? args[++i];
        if (value === undefined) {
          fail(`option ${name} requires a value`);
        }
        plugins.push(value);
        break;
      }
      case '--source-map':
        sourceMap = true;
        if (inlineValue) {
          sourceMapOptions.sourceMapFullFilename = inlineValue;
        }
        break;
      case '--source-map-rootpath':
        sourceMap = true;
        sourceMapOptions.sourceMapRootpath = inlineValue ?? args[++i];
        break;
      case '--source-map-basepath':
        sourceMap = true;
        sourceMapOptions.sourceMapBasepath = inlineValue ?? args[++i];
        break;
      case '--source-map-url':
        sourceMap = true;
        sourceMapOptions.sourceMapURL = inlineValue ?? args[++i];
        break;
      case '--source-map-include-source':
        sourceMap = true;
        sourceMapOptions.outputSourceFiles = true;
        break;
      case '--source-map-inline':
        sourceMap = true;
        sourceMapOptions.sourceMapFileInline = true;
        break;
      case '--source-map-no-annotation':
        sourceMap = true;
        sourceMapOptions.disableSourcemapAnnotation = true;
        break;
      case '--line-numbers':
        // Deprecated dumpLineNumbers; accepted and ignored (use --source-map).
        if (inlineValue === undefined) {
          i++;
        }
        break;
      default:
        fail(`unknown option ${JSON.stringify(name)}. Run 'lessc --help' for usage.`);
    }
  }

  // Assemble engine config.
  if (hasGlobalVars) {
    lessOptions.globalVars = globalVars;
  }
  if (hasModifyVars) {
    lessOptions.modifyVars = modifyVars;
  }
  if (sourceMap) {
    outputOptions.sourceMap = Object.keys(sourceMapOptions).length > 0 ? sourceMapOptions : true;
  }
  return {
    lessOptions,
    outputOptions,
    mode,
    silent,
    quiet,
    verbose,
    positionals,
    plugins
  };
}

function formatError(err) {
  if (err && typeof err === 'object' && 'code' in err) {
    const where = err.filePath
      ? ` in ${err.filePath} on line ${err.line ?? 1}, column ${err.column ?? 1}`
      : '';
    const label = err.phase === 'parse' ? 'ParseError' : 'Error';
    const detail = err.reason ? `${err.message}: ${err.reason}` : err.message;
    return `${label}: ${detail}${where}`;
  }
  return err instanceof Error ? err.message : String(err);
}

async function run() {
  const parsed = main(process.argv);
  const { lessOptions, outputOptions, mode, silent, quiet, positionals } = parsed;

  if (positionals.length === 0) {
    // Match lessc: no input files prints a notice + usage and exits 0.
    process.stdout.write('lessc: no input files\n\n');
    printUsage();
    process.exit(0);
  }

  const sourceArg = positionals[0];
  const destArg = positionals[1];
  const isStdin = sourceArg === '-';

  // Pre-check so a missing input yields a single clean lessc-style line rather
  // than the engine's path-resolution error logged twice.
  if (!isStdin && !existsSync(path.resolve(sourceArg))) {
    fail(`ENOENT: no such file or directory, open '${path.resolve(sourceArg)}'`);
  }

  if (mode === 'depends' && !destArg) {
    fail('option --depends requires an output path to be specified');
  }

  // Build render config.
  const renderConfig = {
    output: {
      // v5 default comes from the Less plugin (nested; `collapseNesting: false`),
      // imported so the CLI and engine can never drift. `--collapse-nesting`
      // opts into Less 4.x-style flattening.
      collapseNesting: lessPluginDefaults.collapseNesting,
      ...outputOptions
    },
    language: { less: lessOptions },
    ...(parsed.plugins.length > 0 ? { compile: { plugins: parsed.plugins } } : {}),
    suppressWarnings: quiet || silent,
    // Keep terse: don't emit the interactive framed diagnostic in a pipe.
    errors: 'line',
    warnings: 'line'
  };

  const compiler = new Compiler();

  try {
    let css;

    if (mode === 'depends') {
      // Compile through render() (which honors include paths) purely to validate
      // + to surface errors; then emit the makefile target line. NOTE: the engine
      // does not yet expose the resolved import list to this API (renderToResult's
      // `loadedUrls` is a stub and does not honor include paths), so the dependency
      // list is currently empty. The target line itself is correct.
      if (isStdin) {
        await compiler.renderString(await readStdin(), {
          language: 'less',
          extension: '.less',
          config: renderConfig
        });
      } else {
        await compiler.render(path.resolve(sourceArg), renderConfig);
      }
      const deps = []; // engine limitation: import list not yet exposed here.
      process.stdout.write(`${destArg}: ${deps.join(' ')} \n`);
      process.exit(0);
    }

    if (isStdin) {
      const source = await readStdin();
      css = await compiler.renderString(source, {
        language: 'less',
        extension: '.less',
        config: renderConfig
      });
    } else {
      css = await compiler.render(path.resolve(sourceArg), renderConfig);
    }

    if (outputOptions.compress) {
      process.stderr.write(
        'The compress option has been deprecated. We recommend you use a dedicated css minifier, for instance see less-plugin-clean-css.\n'
      );
    }

    if (mode === 'lint') {
      // Lint: parse/compile only, no output. Success => exit 0.
      process.exit(0);
    }

    if (destArg) {
      await writeFile(path.resolve(destArg), css);
    } else {
      process.stdout.write(css);
    }
    process.exit(0);
  } catch (err) {
    if (!silent) {
      process.stderr.write(formatError(err) + '\n');
    }
    process.exit(1);
  }
}

run().catch((err) => {
  process.stderr.write(`lessc: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
