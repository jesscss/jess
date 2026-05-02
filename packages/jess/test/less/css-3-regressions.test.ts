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

describe('Less css-3 serialization regressions', () => {
  it('preserves the css-3 fixture output for long lists and compact pseudo/function args', async () => {
    const fixture = path.join(testData, 'tests-unit/css-3/css-3.less');
    const expectedFile = path.join(testData, 'tests-unit/css-3/css-3.css');
    const { tree, context } = await compiler.compile(fixture, { outputFile: expectedFile });
    const css = tree.toString({ context });

    expect(css).toContain(
      '-moz-box-shadow: 0pt 0pt 2px rgba(255, 255, 255, 0.4) inset,\n'
      + '    0pt 4px 6px rgba(255, 255, 255, 0.4) inset;'
    );
    expect(css).toContain('@-x-document url-prefix(""github.com"") {');
    expect(css).toContain(':host(.sel.a),\n:host-context(.sel.b),');
  });
});
