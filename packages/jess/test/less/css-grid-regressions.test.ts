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

describe('Less css-grid serialization regressions', () => {
  it('keeps repeated top-level grid wrappers separate and preserves multiline grid-template-areas', async () => {
    const fixture = path.join(testData, 'tests-unit/css-grid/css-grid.less');
    const expectedFile = path.join(testData, 'tests-unit/css-grid/css-grid.css');
    const { tree, context } = await compiler.compile(fixture, { outputFile: expectedFile });
    const css = tree.toString({ context });

    expect(css.match(/^\.wrapper \{$/gmu)).toHaveLength(3);
    expect(css).toContain(
      '.wrapper {\n'
      + '  display: grid;\n'
      + '  grid-template-columns: [col1-start] 9fr [col1-end] 10px [col2-start] 3fr [col2-end];\n'
      + '  grid-template-rows: auto;\n'
      + '}\n'
      + '.wrapper {\n'
      + '  display: grid;\n'
      + '  grid-template-columns: [left-bound] auto [container-left] 1170px [container-right] auto [right-bound];\n'
      + '  grid-template-rows: [row-1-start] 140px [row-2-start] 390px [row-3-start] 200px [row-4-start] 120px [row-5-start] 120px [row-6-start] 120px;\n'
      + '}'
    );
    expect(css).toContain(
      'grid-template-areas:\n'
      + '    "header header header"\n'
      + '    "content . sidebar"\n'
      + '    "footer footer footer";'
    );
  });
});
