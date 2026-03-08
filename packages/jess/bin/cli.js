#!/usr/bin/env node
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { Compiler } from '../lib/index.js';

const args = yargs(hideBin(process.argv))
  .check((argv) => {
    const filePaths = argv._;
    if (!filePaths.length) {
      throw new Error(chalk.yellow('Input filename required.'));
    }
    return true;
  })
  .option('o', {
    alias: 'out',
    describe: 'Output folder',
    type: 'string'
  })
  .example([
    ['$0 input.jess', 'Compile to input.css'],
    ['$0 input.less', 'Compile Less to input.css'],
    ['$0 input.jess output.css', 'Customize output file'],
    ['$0 input.jess -o dist', 'Output to the dist directory']
  ]);

const argv = args.parseSync();

const start = async () => {
  const startTime = Date.now();
  const files = argv._;
  const inFile = String(files[0]);
  let cssFile = files[1] ? String(files[1]) : inFile.replace(/\.(jess|less)$/, '.css');
  const outDir = path.resolve(process.cwd(), argv.o || path.dirname(cssFile));
  cssFile = path.basename(cssFile);

  try {
    await fs.promises.access(path.resolve(process.cwd(), inFile), fs.constants.R_OK);
  } catch {
    throw new Error(`Could not read "${inFile}"`);
  }

  const compiler = new Compiler();
  const css = await compiler.render(inFile, {});

  await fs.promises.writeFile(path.resolve(outDir, cssFile), css);

  const seconds = Math.round((Date.now() - startTime) / 10) / 100;
  console.log(`${chalk.blue('Finished in')} ${chalk.cyan(seconds + 's')}`);
};

start().catch((e) => {
  console.error(chalk.red(e.message));
  process.exit(1);
});
