import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { createRequire } from 'node:module';
import path from 'node:path';

const compiler = new Compiler({
  output: {
    collapseNesting: true
  },
  compile: {
    plugins: [lessPlugin(), lessCompatPlugin()]
  }
});

const require = createRequire(import.meta.url);
const testData = path.dirname(require.resolve('@less/test-data'));

describe('Less css-escapes serialization regressions', () => {
  it('does not duplicate escaped-selector comments and preserves Less fixture spacing for escaped font lists', async () => {
    const fixture = path.join(testData, 'tests-unit/css-escapes/css-escapes.less');
    const expectedFile = path.join(testData, 'tests-unit/css-escapes/css-escapes.css');
    const { tree, context } = await compiler.compile(fixture, { outputFile: expectedFile });
    const css = tree.toString({ context });

    expect(css.match(/This hideous test of hideousness/g)).toHaveLength(1);
    expect(css).toContain(
      'font-family: \'helvetica neue\', \'wenquanyi micro hei\', \\5FAE\\8F6F\\96C5\\9ED1, \\5B8B\\4F53, sans-serif;'
    );
  });
});
