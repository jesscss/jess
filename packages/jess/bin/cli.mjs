#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { Compiler } from '../lib/index.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: {
    out: { type: 'string', short: 'o' },
    color: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' }
  }
});

if (values.help || positionals.length === 0) {
  console.log(`Usage: jess <input> [output] [-o outdir]

Compile .less / .jess files to CSS.

Options:
  --no-color    Disable ANSI color and terminal hyperlinks in diagnostics.

Examples:
  jess input.less
  jess input.less output.css
  jess input.less -o dist`);
  process.exit(values.help ? 0 : 1);
}

const inFile = positionals[0];
const outFile = positionals[1]
  ?? inFile.replace(/\.(less|jess)$/, '.css');
const outDir = path.resolve(values.out ?? path.dirname(outFile));
const outName = path.basename(outFile);

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
  console.error(err.message ?? err);
  process.exit(1);
}
