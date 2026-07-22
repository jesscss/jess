import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

const fixtures = path.resolve(__dirname, '../../benchmark/import-placement');

function createCompiler(): Compiler {
  return new Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [lessPlugin(), lessCompatPlugin()] }
  });
}

describe('static multiple-import fixture', () => {
  it.each([1, 2, 3])('%i× is byte-identical to repeated source bytes', async (multiplier) => {
    const compiler = createCompiler();
    const source = await compiler.renderToResult(path.join(fixtures, 'source.less'));
    const result = await compiler.renderToResult(path.join(fixtures, `${multiplier}x.less`));

    expect(result.css).toBe(source.css.repeat(multiplier));
  });
});
