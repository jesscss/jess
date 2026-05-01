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

describe('Less selector and at-rule header trivia serialization', () => {
  it('preserves comments.less selector-list and at-rule header seams through compile + toString', async () => {
    const fixture = path.join(testData, 'tests-unit/comments/comments.less');
    const expectedFile = path.join(testData, 'tests-unit/comments/comments.css');
    const { tree, context } = await compiler.compile(fixture, { outputFile: expectedFile });
    const css = tree.toString({ context });

    expect(css).toContain('#comments /* boo *//* boo again*/,\n.comments {');
    expect(css).toContain('.selector /* .with */,\n.lots,\n/* of */ .comments {');
    expect(css).toContain('@-webkit-keyframes /* Safari */ hover /* and Chrome */ {');
  });
});
