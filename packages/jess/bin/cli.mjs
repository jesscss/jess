#!/usr/bin/env node
/**
 * The `jess` command.
 *
 *   jess <input> [output] [options]   compile one stylesheet to CSS
 *   jess lint [files...] [options]    lint stylesheets
 *
 * Streams: compiled CSS goes to a file. Diagnostics and errors go to stderr.
 * stdout carries the one-line "Compiled ..." report, and `jess lint`'s report.
 *
 * Exit status:
 *   0  success
 *   1  the stylesheet failed to compile, or a file could not be read or
 *      written; for `jess lint`, an error was found or the warnings exceeded
 *      --max-warnings
 *   2  invalid command line: an unknown option, a missing or extra argument,
 *      or an output path that would overwrite the input or another stylesheet
 */
import { realpathSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { getSystemErrorMap, parseArgs } from 'node:util';
import { formatStyledLintResult, lintFiles } from '@jesscss/lint';

const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

/** Stylesheet sources jess reads. CSS is never written to a file with one of these extensions. */
const STYLESHEET_SOURCE_EXTENSIONS = new Set(['.less', '.scss', '.sass', '.jess']);

const MANY_FILES_HINT = `To compile several files, run jess once per file, for example:
  for f in src/*.less; do jess "$f" -o dist; done`;

const COMPILE_USAGE = `Usage: jess <input> [output] [options]
       jess lint [files...] [options]

Compile one .less, .scss, or .jess file to CSS. The CSS is written to
[output], or else next to the input with a .css extension. jess refuses to
write over its input or over any .less, .scss, .sass, or .jess file.

Options:
  -o, --out <dir>                 Write the CSS into <dir>, which must exist.
  --allow-remote-imports <hosts>  Fetch and inline https @imports from these
                                  hosts (comma-separated; repeatable). Needs
                                  @jesscss/plugin-remote-import.
  --color, --no-color             Turn ANSI color and terminal hyperlinks in
                                  diagnostics on or off. Default: on only when
                                  stderr is a terminal and NO_COLOR is unset.
  -h, --help                      Show this help.
  --version                       Print the jess version.

Diagnostics are written to stderr.

Exit status:
  0  the CSS was written
  1  the stylesheet failed to compile, or a file could not be read or written
  2  invalid command line, or an output path that would overwrite a stylesheet

${MANY_FILES_HINT}

Examples:
  jess input.less
  jess input.less output.css
  jess input.less -o dist
  jess input.less --allow-remote-imports cdn.example.com
  jess lint src/**/*.less`;

const LINT_USAGE = `Usage: jess lint [files...] [options]

Lint .css / .less / .scss / .jess files using Jess diagnostics.

Options:
  --config <path>        Load a specific styles config file
  --format <text|json>   Output format (default: text)
  --max-warnings <n>     Exit non-zero when warnings exceed n
  --color, --no-color    Turn ANSI color and terminal hyperlinks on or off.
                         Default: on only when stdout is a terminal and
                         NO_COLOR is unset.
  --quiet                Suppress warnings in text output
  --syntax-only          Report parser diagnostics only
  -h, --help             Show this help

Exit status:
  0  no errors, and no more warnings than --max-warnings
  1  an error was found, or the warnings exceeded --max-warnings
  2  invalid command line

Examples:
  jess lint
  jess lint packages/**/*.less --max-warnings 0
  jess lint src/app.scss --format json`;

/** Prints `jess: <message>` to stderr and exits with `code`. */
function fail(message, code) {
  console.error(`jess: ${message}`);
  process.exit(code);
}

function parseCliArgs(config) {
  try {
    return parseArgs(config);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err), EXIT_USAGE);
  }
}

/**
 * Whether to write ANSI color and OSC-8 hyperlinks to `stream`: as `--color` or
 * `--no-color` says when one is given; otherwise only to a terminal, and never
 * while NO_COLOR is set to a non-empty value (https://no-color.org).
 */
function useColor(flag, stream) {
  return flag ?? (stream.isTTY === true && !process.env.NO_COLOR);
}

/** The system's description of a file-system error, e.g. "no such file or directory". */
function systemReason(err) {
  return getSystemErrorMap().get(err?.errno)?.[1] ?? (err instanceof Error ? err.message : String(err));
}

/** `file` relative to the working directory, as the user would type it. */
function display(file) {
  return path.relative(process.cwd(), file) || file;
}

function isStylesheetSource(file) {
  return STYLESHEET_SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

/**
 * Exits (status 2) when writing CSS to `outPath` would destroy a stylesheet.
 *
 * The input is compared on disk, by device and inode, never by path string: a
 * case variant on a case-insensitive file system (`a.css` / `A.CSS`), a symlink
 * and a hard link all name the input as surely as its own path does. An output
 * that has, or links to a file that has, a stylesheet source extension is
 * refused too: `jess a.less b.less` is a request to compile two files, not to
 * replace b.less with CSS.
 */
function refuseUnsafeOutput(outPath, input, inFile, outArg) {
  let existing;
  try {
    existing = statSync(outPath, { bigint: true });
  } catch {
    // Nothing there yet; a write failure is reported when the write happens.
  }
  if (existing !== undefined && existing.dev === input.dev && existing.ino === input.ino) {
    fail(`refusing to write CSS over the input file ${inFile}`, EXIT_USAGE);
  }

  const hint = outArg !== undefined && isStylesheetSource(outArg)
    ? `\nThe second argument names the output file. ${MANY_FILES_HINT}`
    : '';
  if (isStylesheetSource(outPath)) {
    fail(`refusing to write CSS to ${display(outPath)}: ${path.extname(outPath)} is a stylesheet source extension${hint}`, EXIT_USAGE);
  }
  if (existing !== undefined) {
    const target = realpathSync(outPath);
    if (isStylesheetSource(target)) {
      fail(`refusing to write CSS to ${display(outPath)}: it links to the stylesheet ${display(target)}`, EXIT_USAGE);
    }
  }
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

/**
 * `--allow-remote-imports` adds the opt-in remote-import plugin with that
 * allow list, as `compile.plugins` in a styles config would; it replaces one
 * configured there.
 */
async function remoteImportOptions(hosts) {
  if (hosts === undefined) {
    return undefined;
  }
  let plugin;
  try {
    ({ remoteImportPlugin: plugin } = await import('@jesscss/plugin-remote-import'));
  } catch {
    fail('--allow-remote-imports needs @jesscss/plugin-remote-import. Install it next to jess.', EXIT_USAGE);
  }
  try {
    return { compile: { plugins: [plugin({ allow: hosts.flatMap(list => list.split(',')) })] } };
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err), EXIT_USAGE);
  }
}

async function runCompile(args) {
  const { values, positionals } = parseCliArgs({
    args,
    allowPositionals: true,
    allowNegative: true,
    options: {
      out: { type: 'string', short: 'o' },
      'allow-remote-imports': { type: 'string', multiple: true },
      color: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' }
    }
  });

  if (values.help) {
    console.log(COMPILE_USAGE);
    process.exit(0);
  }
  if (values.version) {
    console.log(createRequire(import.meta.url)('../package.json').version);
    process.exit(0);
  }
  if (positionals.length === 0) {
    console.error(COMPILE_USAGE);
    process.exit(EXIT_USAGE);
  }
  if (positionals.length > 2) {
    fail(`expected an input file and at most one output file, but got ${positionals.length} arguments.\n${MANY_FILES_HINT}`, EXIT_USAGE);
  }

  const [inFile, outArg] = positionals;
  let input;
  try {
    input = statSync(inFile, { bigint: true });
  } catch (err) {
    fail(`cannot read ${inFile}: ${systemReason(err)}`, EXIT_FAILURE);
  }
  if (input.isDirectory()) {
    fail(`cannot read ${inFile}: it is a directory`, EXIT_FAILURE);
  }

  const outFile = outArg ?? inFile.replace(/\.[^./\\]*$/, '') + '.css';
  const outPath = path.resolve(values.out ?? path.dirname(outFile), path.basename(outFile));
  refuseUnsafeOutput(outPath, input, inFile, outArg);

  const [{ Compiler }, { JessError }] = await Promise.all([
    import('../lib/index.js'),
    import('@jesscss/core')
  ]);
  const options = await remoteImportOptions(values['allow-remote-imports']);
  const startTime = Date.now();

  let css;
  try {
    css = await new Compiler(options).render(path.resolve(inFile), {
      colors: useColor(values.color, process.stderr)
    });
  } catch (err) {
    /*
     * render() has already printed the stylesheet's diagnostics, the thrown one
     * included. Anything else (a styles config or plugin that failed to load)
     * reaches only this handler.
     */
    if (!(err instanceof JessError)) {
      console.error(`jess: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(EXIT_FAILURE);
  }

  try {
    await writeFile(outPath, css);
  } catch (err) {
    fail(`cannot write ${display(outPath)}: ${systemReason(err)}`, EXIT_FAILURE);
  }
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`Compiled ${inFile} → ${outPath} (${elapsed}s)`);
}

async function runLint(args) {
  const { values, positionals } = parseCliArgs({
    args,
    allowPositionals: true,
    allowNegative: true,
    options: {
      config: { type: 'string', short: 'c' },
      format: { type: 'string' },
      color: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      'max-warnings': { type: 'string' },
      quiet: { type: 'boolean' },
      'syntax-only': { type: 'boolean' }
    }
  });

  if (values.help) {
    console.log(LINT_USAGE);
    process.exit(0);
  }

  const format = values.format ?? 'text';
  if (format !== 'text' && format !== 'json') {
    fail(`unsupported lint format: ${format}`, EXIT_USAGE);
  }

  const maxWarnings = values['max-warnings'] === undefined
    ? undefined
    : Number(values['max-warnings']);
  if (maxWarnings !== undefined && (!Number.isInteger(maxWarnings) || maxWarnings < 0)) {
    fail('--max-warnings must be a non-negative integer', EXIT_USAGE);
  }

  const result = await lintFiles(positionals, {
    configFile: values.config,
    maxWarnings,
    includeLegacyDiagnostics: format === 'text',
    syntaxOnly: values['syntax-only'] === true
  });

  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatStyledLintResult(values.quiet === true ? quietResult(result) : result, {
      colors: useColor(values.color, process.stdout)
    }));
  }

  process.exit(result.errored ? EXIT_FAILURE : 0);
}

const args = process.argv.slice(2);
if (args[0] === 'lint') {
  await runLint(args.slice(1));
} else {
  await runCompile(args);
}
