import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { readFileSync } from 'node:fs';
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

const baseCompiler = new Compiler({
  output: { collapseNesting: true },
  compile: {
    plugins: [lessPlugin(), lessCompatPlugin()]
  }
});

const require = createRequire(import.meta.url);
const testData = path.dirname(require.resolve('@less/test-data'));

describe.todo('Less scope height leakage', () => {
  it('leaks mixin-defined vars to later siblings without exposing them to earlier siblings', async () => {
    const lessCode = `
      .setHeight(@h) { @height: 1024px; }
      .useHeightInMixinCall(@h) { .useHeightInMixinCall { mixin-height: @h; } }
      @mainHeight: 50%;
      .setHeight(@mainHeight);
      .heightIsSet { height: @height; }
      .useHeightInMixinCall(@height);
    `;

    const css = await compiler.renderString(lessCode, { language: 'less' });
    expect(css).toContain('.heightIsSet');
    expect(css).toContain('height: 1024px;');
    expect(css).toContain('.useHeightInMixinCall');
    expect(css).toContain('mixin-height: 1024px;');
  });

  it('compiles the real scope.less fixture file', async () => {
    const fixture = path.join(testData, 'tests-unit/scope/scope.less');
    const css = await compiler.render(fixture);
    expect(css).toContain('.heightIsSet');
    expect(css).toContain('height: 1024px;');
    expect(css).toContain('.useHeightInMixinCall');
    expect(css).toContain('mixin-height: 1024px;');
  });

  it('renders the full scope.less source as a string', async () => {
    const fixture = path.join(testData, 'tests-unit/scope/scope.less');
    const source = readFileSync(fixture, 'utf8');
    const css = await compiler.renderString(source, {
      language: 'less',
      filePath: fixture
    });
    expect(css).toContain('.heightIsSet');
    expect(css).toContain('height: 1024px;');
    expect(css).toContain('.useHeightInMixinCall');
    expect(css).toContain('mixin-height: 1024px;');
  });

  it('matches the all-less compile + toString path for scope.less', async () => {
    const fixture = path.join(testData, 'tests-unit/scope/scope.less');
    const expectedFile = path.join(testData, 'tests-unit/scope/scope.css');
    const { tree, context } = await compiler.compile(fixture, { outputFile: expectedFile });
    const css = tree.toString({ context });
    expect(css).toContain('.heightIsSet');
    expect(css).toContain('height: 1024px;');
    expect(css).toContain('.useHeightInMixinCall');
    expect(css).toContain('mixin-height: 1024px;');
  });

  it('matches the all-less per-test compiler reconstruction path', async () => {
    const fixture = path.join(testData, 'tests-unit/scope/scope.less');
    const expectedFile = path.join(testData, 'tests-unit/scope/scope.css');
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
    expect(css).toContain('.heightIsSet');
    expect(css).toContain('height: 1024px;');
    expect(css).toContain('.useHeightInMixinCall');
    expect(css).toContain('mixin-height: 1024px;');
  });
});
