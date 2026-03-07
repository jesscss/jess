#!/usr/bin/env node
/**
 * Compile container.less and print the first @container block from output.
 * Usage: node scripts/container-output.mjs
 * Use with different core checkouts to see when :is() appeared/disappeared.
 */
import { Compiler } from '../lib/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const testData = path.dirname(require.resolve('@less/test-data'));
const lessPath = path.join(testData, 'tests-unit/container/container.less');

const compiler = new Compiler({
  output: { collapseNesting: true },
  compile: { plugins: [lessPlugin()] }
});

const { tree, context } = await compiler.compile(lessPath, { outputFile: path.join(testData, 'tests-unit/container/container.css') });
const css = tree.toString({ context });
const match = css.match(/@container \(max-width: 350px\) \{[^}]+\}/s);
const snippet = match ? match[0] : css.slice(0, 600);
console.log(snippet);
if (!snippet.includes(':is(')) {
  console.error('\n>>> NO :is() in output');
}
