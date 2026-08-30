import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

const makeCompiler = (sourceMap: boolean) => new Compiler({
  output: { collapseNesting: true, sourceMap },
  compile: { plugins: [lessPlugin(), lessCompatPlugin()] }
});

describe('Q-40 evaluator/serializer frame boundary', () => {
  it('keeps the direct body path byte-identical with source maps on and off', async () => {
    const source = '.a { color: red; margin: 0; padding: 1px 2px; }';
    const expected = '.a {\n  color: red;\n  margin: 0;\n  padding: 1px 2px;\n}\n';

    const withoutSourceMap = await makeCompiler(false).renderString(source, {
      language: 'less',
      extension: '.less'
    });
    const withSourceMap = await makeCompiler(true).renderString(source, {
      language: 'less',
      extension: '.less'
    });

    expect(withoutSourceMap).toBe(expected);
    expect(withSourceMap).toBe(expected);
  });

  it('keeps frame-aware mixin output exact through the caller-owned render buffer', async () => {
    const source = '.m() { color: red; } .a { .m(); }';
    const expected = '.a {\n  color: red;\n}\n';

    const withoutSourceMap = await makeCompiler(false).renderString(source, {
      language: 'less',
      extension: '.less'
    });
    const withSourceMap = await makeCompiler(true).renderString(source, {
      language: 'less',
      extension: '.less'
    });

    expect(withoutSourceMap).toBe(expected);
    expect(withSourceMap).toBe(expected);
  });
});
