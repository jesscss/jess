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

describe('Less comments2 evaluated-source trivia', () => {
  it('keeps selector comment seams and drops evaluated source comments at use sites', async () => {
    const fixture = path.join(testData, 'tests-unit/comments/comments2.less');
    const expectedFile = path.join(testData, 'tests-unit/comments/comments2.css');
    const { tree, context } = await compiler.compile(fixture, { outputFile: expectedFile });
    const css = tree.toString({ context });

    expect(css).toContain('#planadvisor,\n/*comment*//*comment*/\n.first,');
    expect(css).toContain('/*comment*//*comment*/.planning {');
    expect(css).toContain('  c: yes;');
    expect(css).not.toContain('/* comment */  /* comment */  c: yes;');
  });
});
