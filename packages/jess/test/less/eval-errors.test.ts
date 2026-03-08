import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import * as path from 'path';
import lessPlugin from '@jesscss/plugin-less';
import { Compiler } from '../../src/index.js';

const require = createRequire(import.meta.url);
const testData = path.dirname(require.resolve('@less/test-data'));

describe('Less eval error fixtures', () => {
  it.skip('matches ampersand merge template eval error', async () => {
    const fixtureRelPath = 'tests-error/eval/ampersand-merge-template-invalid.less';
    const fixturePath = path.join(testData, fixtureRelPath);
    const expectedPath = fixturePath.replace(/\.less$/, '.txt');
    const expectedMessage = readFileSync(expectedPath, 'utf8').trim();
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: {
        plugins: [lessPlugin()]
      }
    });

    await expect(async () => {
      await compiler.compile(fixturePath);
    }).rejects.toThrow(expectedMessage);
  });
});
