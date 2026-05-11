import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { getTestCases } from '../test-utils.js';

const require = createRequire(import.meta.url);
const testData = path.dirname(require.resolve('@less/test-data'));
const baseCompiler = new Compiler({
  output: { collapseNesting: true },
  compile: {
    plugins: [
      lessPlugin(),
      lessCompatPlugin()
    ]
  }
});

describe.todo('debug extend pipeline', () => {
  it('compares compile(file) and renderString for extend.less', async () => {
    const lessPath = path.join(testData, 'tests-unit/extend/extend.less');
    const [testCase] = getTestCases(lessPath);
    if (!testCase) {
      throw new Error('No test case found for extend.less');
    }

    const source = readFileSync(lessPath, 'utf8');
    const expected = readFileSync(testCase.expectedFile, 'utf8');
    const mk = (plugins: any[]) => new Compiler({
      output: {
        collapseNesting: true,
        ...(testCase.config.output || {})
      },
      compile: { plugins }
    });

    const lessOnly = mk([lessPlugin()]);
    const withCompat = mk([lessPlugin(), lessCompatPlugin()]);
    const allLessStyle = new Compiler({
      ...baseCompiler.opts,
      ...testCase.config,
      compile: {
        ...(baseCompiler.opts.compile || {}),
        ...((testCase.config.compile || {}) as Record<string, any>),
        plugins: [
          ...(baseCompiler.opts.compile?.plugins || [])
        ]
      },
      output: {
        ...baseCompiler.opts.output,
        ...(testCase.config.output || {})
      }
    });

    const lessOnlyRender = await lessOnly.render(lessPath, { outputFile: testCase.expectedFile });
    const withCompatRender = await withCompat.render(lessPath, { outputFile: testCase.expectedFile });
    const lessOnlyRendered = await lessOnly.renderString(source, {
      filePath: lessPath,
      config: testCase.config
    });
    const withCompatRendered = await withCompat.renderString(source, {
      filePath: lessPath,
      config: testCase.config
    });
    const allLessStyleRender = await allLessStyle.render(lessPath, { outputFile: testCase.expectedFile });

    expect.soft(lessOnlyRender).toBe(expected);
    expect.soft(withCompatRender).toBe(expected);
    expect.soft(lessOnlyRendered).toBe(expected);
    expect.soft(withCompatRendered).toBe(expected);
    expect.soft(allLessStyleRender).toBe(expected);
  });
});
