import { describe, expect, it } from 'vitest';
import * as glob from 'glob';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Compiler } from '../src/index.js';

const compiler = new Compiler();
const testData = path.join(path.dirname(fileURLToPath(import.meta.url)), 'files');
const semanticOutputs = new Map([
  [
    'import-func.jess',
    '.box {\n  area: 78.53981634;\n}\n'
  ]
]);

describe('Output files', () => {
  glob.sync(path.join(testData, '*.jess'))
    .map(value => path.relative(testData, value))
    .sort()
    .forEach((file) => {
      it(`${file}`, async () => {
        const jessFile = path.join(testData, file);
        const cssFile = jessFile.replace(/\.jess$/, '.css');

        const output = await compiler.render(jessFile);

        /*
         * Script-module execution supersedes this case's pre-implementation
         * passthrough golden. Keep owner-managed `.css` fixtures untouched and
         * pin the new semantic bytes here; every other case still reads its
         * paired golden from disk.
         */
        const referenceCss = semanticOutputs.get(file)
          ?? (await fs.promises.readFile(cssFile)).toString();
        expect(output).toBe(referenceCss);
      });
    });
});
