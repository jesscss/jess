#!/usr/bin/env node
/**
 * The `jess` command.
 *
 *   jess <input> [output] [options]   compile one stylesheet to CSS
 *   jess lint [files...] [options]    lint stylesheets
 *
 * Streams: compiled CSS goes to a file. Diagnostics and errors go to stderr.
 * stdout carries the one-line "Compiled ..." report, and `jess lint`'s report.
 * The CLI sets process.exitCode and returns instead of calling process.exit(),
 * which could cut off output still being written to a pipe.
 *
 * Exit status:
 *   0  success
 *   1  the stylesheet failed to compile, or a file could not be read or
 *      written; for `jess lint`, an error was found or the warnings exceeded
 *      --max-warnings
 *   2  invalid command line: an unknown option, a missing or extra argument,
 *      or a refused output path (see planOutput)
 */
import { randomBytes } from 'node:crypto';
import { lstatSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { open, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { getSystemErrorMap, parseArgs } from 'node:util';
import { colorsByDefault, outputDiagnostics } from '@jesscss/compiler/diagnostics';
import { formatStyledLintResult, lintFiles } from '@jesscss/lint';

const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

/**
 * A stylesheet source name: one that ends in .less, .scss, .sass or .jess, in
 * any case, including a bare `.less`, and with the trailing dots and spaces
 * Windows drops from a file name. CSS is never written to such a name.
 */
const STYLESHEET_SOURCE = /(\.(?:less|scss|sass|jess))[. ]*$/iu;

const MANY_FILES_HINT = `To compile several files, run jess once per file, for example:
  for f in src/*.less; do jess "$f" -o dist; done`;

const COMPILE_USAGE = `Usage: jess <input> [output] [options]
       jess lint [files...] [options]

Compile one .less, .scss, or .jess file to CSS. The CSS is written to
[output], or else next to the input with a .css extension. With -o, [output]
is a file name in <dir>. Reading stdin with - is not supported.

An existing output file is replaced, not written into: the CSS goes to a new
file that is renamed over it. A symlink there is replaced rather than
followed, and other names of a hard-linked file keep their contents. A
terminal, pipe or device (such as /dev/stdout) is written directly.

jess refuses an output that is the input file under any name, that is named
like a stylesheet (.less, .scss, .sass, .jess), or that is a symlink to one.

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
  2  invalid command line, or a refused output path

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
  --version              Print the jess version

Exit status:
  0  no errors, and no more warnings than --max-warnings
  1  an error was found, or the warnings exceeded --max-warnings
  2  invalid command line

Examples:
  jess lint
  jess lint packages/**/*.less --max-warnings 0
  jess lint src/app.scss --format json`;

/** A refusal the CLI reports as `jess: <message>` before exiting with `exitCode`. */
class CliError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

function fail(message, exitCode) {
  throw new CliError(message, exitCode);
}

function printVersion() {
  console.log(createRequire(import.meta.url)('../package.json').version);
}

function parseCliArgs(config) {
  try {
    return parseArgs(config);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err), EXIT_USAGE);
  }
}

/** The system's description of a file-system error, e.g. "no such file or directory". */
function systemReason(err) {
  return getSystemErrorMap().get(err?.errno)?.[1] ?? (err instanceof Error ? err.message : String(err));
}

/** `file` relative to the working directory when it is inside it, else as an absolute path. */
function display(file) {
  const relative = path.relative(process.cwd(), file);
  return relative === '' || relative.startsWith('..') || path.isAbsolute(relative) ? file : relative;
}

/** The stylesheet source extension `file`'s name ends in, as written, or undefined. */
function stylesheetExtension(file) {
  return STYLESHEET_SOURCE.exec(path.basename(file))?.[1];
}

/**
 * Decides how the CSS reaches `outPath`, or refuses it (exit status 2) when the output
 * could cost a stylesheet.
 *
 * Refused: a name that is a stylesheet source (`jess a.less b.less` asks to
 * compile two files, not to replace b.less); a symlink, dangling or not, whose
 * target is such a name; and the input itself under another name, compared on
 * disk by device and inode, never by path string (a case variant on a
 * case-insensitive file system, a hard link).
 *
 * Otherwise the output is replaced (`{ replace: true }`): a regular file,
 * a symlink, or a path with nothing there yet. A terminal, pipe or other
 * device, and any path under /dev (`/dev/stdout` names a regular file when
 * stdout is redirected to one), is not a directory entry to replace and is
 * written in place (`{ replace: false }`).
 */
function planOutput(outPath, input, inFile, outArg) {
  const extension = stylesheetExtension(outPath);
  if (extension !== undefined) {
    const hint = outArg !== undefined && stylesheetExtension(outArg) !== undefined
      ? `\nThe second argument names the output file. ${MANY_FILES_HINT}`
      : '';
    fail(`refusing to write CSS to ${display(outPath)}: ${extension} is a stylesheet source extension${hint}`, EXIT_USAGE);
  }

  let entry;
  try {
    entry = lstatSync(outPath);
  } catch {
    return { replace: true }; // Nothing there yet.
  }
  const link = entry.isSymbolicLink() ? readlinkSync(outPath) : undefined;
  if (link !== undefined && stylesheetExtension(link) !== undefined) {
    fail(`refusing to write CSS to ${display(outPath)}: it is a symlink to the stylesheet ${link}`, EXIT_USAGE);
  }

  let file;
  try {
    file = statSync(outPath, { bigint: true });
  } catch {
    return { replace: true }; // A dangling symlink: replacing it creates no file behind it.
  }
  if (file.dev === input.dev && file.ino === input.ino) {
    fail(`refusing to write CSS over the input file ${inFile}`, EXIT_USAGE);
  }
  if (file.isDirectory()) {
    fail(`${display(outPath)} is a directory; to write the CSS into it, use -o ${display(outPath)}`, EXIT_USAGE);
  }
  if (link !== undefined) {
    let target;
    try {
      target = realpathSync(outPath);
    } catch {
      // A target with no canonical path (a descriptor such as /dev/stdout) is not a stylesheet.
    }
    if (target !== undefined && stylesheetExtension(target) !== undefined) {
      fail(`refusing to write CSS to ${display(outPath)}: it links to the stylesheet ${display(target)}`, EXIT_USAGE);
    }
  }

  // ponytail: /dev is the POSIX device namespace; descriptor aliases elsewhere (/proc/self/fd/N) are replaced like files.
  if (!file.isFile() || path.resolve(outPath).startsWith('/dev/')) {
    return { replace: false };
  }
  return { replace: true, mode: link === undefined ? Number(file.mode & 0o777n) : undefined };
}

/**
 * Writes `css` to `outPath` as `plan` says. Replacing writes a new file beside
 * the output and renames it into place, so no existing file is written into: a
 * reader never sees half the CSS, and a failed write leaves the old output as
 * it was. A replaced regular file keeps its permission bits; its owner and
 * extended attributes are those of a new file.
 */
async function writeOutput(outPath, css, plan) {
  if (!plan.replace) {
    await writeFile(outPath, css);
    return;
  }
  const temp = path.join(path.dirname(outPath), `.${path.basename(outPath)}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`);

  // 'wx' creates the file, or fails without touching anything already there, a symlink included.
  const handle = await open(temp, 'wx');
  try {
    try {
      await handle.writeFile(css);
      if (plan.mode !== undefined) {
        await handle.chmod(plan.mode);
      }
    } finally {
      await handle.close();
    }
    await rename(temp, outPath);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
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
    return;
  }
  if (values.version) {
    printVersion();
    return;
  }
  if (positionals.length === 0) {
    console.error(COMPILE_USAGE);
    process.exitCode = EXIT_USAGE;
    return;
  }
  if (positionals.length > 2) {
    fail(`expected an input file and at most one output file, but got ${positionals.length} arguments.\n${MANY_FILES_HINT}`, EXIT_USAGE);
  }

  const [inFile, outArg] = positionals;
  if (inFile === '-') {
    fail('reading a stylesheet from stdin (-) is not supported; pass a file path', EXIT_USAGE);
  }
  if (outArg === '-') {
    fail('writing CSS to stdout with - is not supported; pass /dev/stdout as the output', EXIT_USAGE);
  }
  if (path.extname(inFile).toLowerCase() === '.css') {
    fail(`${inFile} is CSS already; jess compiles .less, .scss and .jess files to CSS`, EXIT_USAGE);
  }
  if (values.out !== undefined && outArg !== undefined && path.basename(outArg) !== outArg) {
    fail(`the output ${outArg} names a directory, and so does -o ${values.out}; pass the output path alone, or a file name with -o`, EXIT_USAGE);
  }
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
  const plan = planOutput(outPath, input, inFile, outArg);

  const [{ Compiler }, { JessError, toDiagnostic }] = await Promise.all([
    import('../lib/index.js'),
    import('@jesscss/core')
  ]);
  const options = await remoteImportOptions(values['allow-remote-imports']);
  const startTime = Date.now();

  // Undefined unless --color or --no-color is given: diagnostics then color only a terminal.
  const colors = values.color;
  let css;
  try {
    css = await new Compiler(options).render(path.resolve(inFile), { colors });
  } catch (err) {
    /*
     * render() has printed the warnings and any other errors it collected, but
     * never the error it throws: that one is the caller's to report, once. A
     * stylesheet diagnostic is printed as a frame of the authored source;
     * anything else (a styles config or plugin that failed to load) as one line.
     */
    if (err instanceof JessError) {
      outputDiagnostics([toDiagnostic(err)], [], { colors });
    } else {
      console.error(`jess: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exitCode = EXIT_FAILURE;
    return;
  }

  try {
    await writeOutput(outPath, css, plan);
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
      'syntax-only': { type: 'boolean' },
      version: { type: 'boolean' }
    }
  });

  if (values.help) {
    console.log(LINT_USAGE);
    return;
  }
  if (values.version) {
    printVersion();
    return;
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
      colors: values.color ?? colorsByDefault(process.stdout)
    }));
  }

  process.exitCode = result.errored ? EXIT_FAILURE : 0;
}

const args = process.argv.slice(2);
try {
  await (args[0] === 'lint' ? runLint(args.slice(1)) : runCompile(args));
} catch (err) {
  if (!(err instanceof CliError)) {
    throw err;
  }
  console.error(`jess: ${err.message}`);
  process.exitCode = err.exitCode;
}
