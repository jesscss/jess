import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getTestCases } from '../test-utils.js';

const compiler = new Compiler({
  output: {
    collapseNesting: true
  },
  compile: {
    plugins: [lessPlugin(), lessCompatPlugin()]
  }
});

const baseCompiler = new Compiler({
  output: { collapseNesting: true },
  compile: {
    plugins: [lessPlugin(), lessCompatPlugin()]
  }
});

const require = createRequire(import.meta.url);
const testData = path.dirname(require.resolve('@less/test-data'));

describe.todo('Less comments2 scope lookup', () => {
  it('resolves later same-scope vars in the minimal grid snippet', async () => {
    const lessCode = `
      #planadvisor,
      /*comment*//*comment*/
      .first,/*comment*//*comment*/.planning {
          margin:10px;
          total-width: @total-width;
      }
      @base                       :   1;
      @column-width               :   @base * 6em;
      @gutter-width               :   2em;
      @columns                    :   12;
      @gridsystem-width           :   (@column-width * @columns) + (@gutter-width * @columns);
      @total-width                :   @gridsystem-width;
    `;

    const css = await compiler.renderString(lessCode, { language: 'less' });
    expect(css).toContain('total-width: 96em;');
  });

  it('compiles the real comments2 fixture file', async () => {
    const fixture = path.join(testData, 'tests-unit/comments/comments2.less');
    const css = await compiler.render(fixture);
    expect(css).toContain('total-width: 96em;');
  });

  it('matches the all-less compile + toString path for comments2', async () => {
    const fixture = path.join(testData, 'tests-unit/comments/comments2.less');
    const expectedFile = path.join(testData, 'tests-unit/comments/comments2.css');
    const { tree, context } = await compiler.compile(fixture, { outputFile: expectedFile });
    const css = tree.toString({ context });
    expect(css).toContain('total-width: 96em;');
  });

  it('matches the all-less per-test compiler reconstruction path for comments2', async () => {
    const fixture = path.join(testData, 'tests-unit/comments/comments2.less');
    const expectedFile = path.join(testData, 'tests-unit/comments/comments2.css');
    const testCompiler = new Compiler({
      ...baseCompiler.opts,
      compile: {
        ...(baseCompiler.opts.compile || {}),
        plugins: [
          ...(baseCompiler.opts.compile?.plugins || [])
        ]
      },
      output: {
        ...baseCompiler.opts.output
      }
    });
    const { tree, context } = await testCompiler.compile(fixture, { outputFile: expectedFile });
    const css = tree.toString({ context });
    expect(css).toContain('total-width: 96em;');
  });

  it('matches the inherited testCase config from all-less', async () => {
    const fixture = path.join(testData, 'tests-unit/comments/comments2.less');
    const [testCase] = getTestCases(fixture);
    const testCompileConfig = (testCase?.config.compile || {}) as Record<string, any>;
    const {
      plugins: testCasePlugins = [],
      ...restCompileConfig
    } = testCompileConfig;
    const testCompiler = new Compiler({
      ...baseCompiler.opts,
      ...testCase?.config,
      compile: {
        ...(baseCompiler.opts.compile || {}),
        ...restCompileConfig,
        plugins: [
          ...(baseCompiler.opts.compile?.plugins || []),
          ...testCasePlugins
        ]
      },
      output: {
        ...baseCompiler.opts.output,
        ...(testCase?.config.output || {})
      }
    });
    const { tree, context } = await testCompiler.compile(fixture, { outputFile: testCase!.expectedFile });
    const css = tree.toString({ context });
    expect(css).toContain('total-width: 96em;');
  });
});
