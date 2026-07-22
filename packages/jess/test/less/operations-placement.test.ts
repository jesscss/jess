import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { resolveLessTestDataRoot } from '../test-utils.js';

describe('Less operations fixture placement', () => {
  it('keeps direct arithmetic declarations in one parent block around a nested rule', async () => {
    const testData = resolveLessTestDataRoot();
    const input = join(testData, 'tests-unit/operations/operations.less');
    const expected = readFileSync(join(testData, 'tests-unit/operations/operations.css'), 'utf8');
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: { plugins: [lessPlugin()] }
    });

    await expect(compiler.render(input)).resolves.toBe(expected);
  });
});
