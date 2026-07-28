#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { formatLintResult, lintFiles } from '@jesscss/lint';

function parseCliArgs(config) {
  try {
    return parseArgs(config);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  }
}

function printCompileUsage() {
  console.log(`Usage: jess <input> [output] [-o outdir]
       jess lint [files...] [--format text|json]

Compile .less / .jess files to CSS.

Options:
  --no-color    Disable ANSI color and terminal hyperlinks in diagnostics.

Examples:
  jess input.less
  jess input.less output.css
  jess input.less -o dist
  jess lint src/**/*.less`);
}

function printLintUsage() {
  console.log(`Usage: jess lint [files...] [options]

Lint .css / .less / .scss / .jess files using Jess diagnostics.

Options:
  --config <path>        Load a specific styles config file
  --format <text|json>  Output format (default: text)
  --max-warnings <n>    Exit non-zero when warnings exceed n
  --quiet               Suppress warnings in text output
  --syntax-only         Report parser diagnostics only
  -h, --help            Show this help

Examples:
  jess lint
  jess lint packages/**/*.less --max-warnings 0
  jess lint src/app.scss --format json`);
}

function quietResult(result) {
  return {
    ...result,
    results: result.results.map(file => ({
      ...file,
      diagnostics: file.diagnostics.filter(diagnostic => diagnostic.severity === 'error'),
      warnings: []
    }))
  };
}

async function runCompile(args) {
  const { values, positionals } = parseCliArgs({
    args,
    allowPositionals: true,
    allowNegative: true,
    options: {
      out: { type: 'string', short: 'o' },
      color: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  });

  if (values.help || positionals.length === 0) {
    printCompileUsage();
    process.exit(values.help ? 0 : 1);
  }

  const inFile = positionals[0];
  const outFile = positionals[1]
    ?? inFile.replace(/\.(less|jess)$/, '.css');
  const outDir = path.resolve(values.out ?? path.dirname(outFile));
  const outName = path.basename(outFile);

  const { Compiler } = await import('../lib/index.js');
  const compiler = new Compiler();
  const startTime = Date.now();

  try {
    const css = await compiler.render(path.resolve(inFile), {
      colors: values.color ?? true
    });
    await writeFile(path.join(outDir, outName), css);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Compiled ${inFile} → ${path.join(outDir, outName)} (${elapsed}s)`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

async function runLint(args) {
  const { values, positionals } = parseCliArgs({
    args,
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c' },
      format: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      'max-warnings': { type: 'string' },
      quiet: { type: 'boolean' },
      'syntax-only': { type: 'boolean' }
    }
  });

  if (values.help) {
    printLintUsage();
    process.exit(0);
  }

  const format = values.format ?? 'text';
  if (format !== 'text' && format !== 'json') {
    console.error(`Unsupported lint format: ${format}`);
    process.exit(2);
  }

  const maxWarnings = values['max-warnings'] === undefined
    ? undefined
    : Number(values['max-warnings']);
  if (maxWarnings !== undefined && (!Number.isInteger(maxWarnings) || maxWarnings < 0)) {
    console.error('--max-warnings must be a non-negative integer');
    process.exit(2);
  }

  const result = await lintFiles(positionals, {
    configFile: values.config,
    maxWarnings,
    syntaxOnly: values['syntax-only'] === true
  });

  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatLintResult(values.quiet === true ? quietResult(result) : result));
  }

  process.exit(result.errored ? 1 : 0);
}

const args = process.argv.slice(2);
if (args[0] === 'lint') {
  await runLint(args.slice(1));
} else {
  await runCompile(args);
}
