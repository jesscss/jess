import { describe, expect, it } from 'vitest';
import lessPlugin from '../src/index.js';
import { LessDynamicCharsetError, parse } from '@jesscss/less-parser';

describe('@jesscss/plugin-less', () => {
  it('returns a source-backed parser diagnostic for invalid Less', () => {
    const source = '.entry { color: red; }\n!broken';
    const result = lessPlugin().safeParse!('entry.less', source);

    expect(result.document).toBeUndefined();
    expect(result.errors).toMatchObject([{
      code: 'parse/syntax-error',
      phase: 'parse',
      message: expect.stringMatching(/^Less parser error\./),
      filePath: 'entry.less',
      line: 2,
      column: 1,
      file: { source }
    }]);
    expect(result.errors[0]?.lines?.[2]).toBe('!broken');
  });

  it('reports the Less 5 dynamic-charset policy at the authored statement', () => {
    const source = '@Eight: 8;\n@charset "UTF-@{Eight}";';
    const result = lessPlugin().safeParse!('entry.less', source);

    expect(result.document).toBeUndefined();
    expect(result.errors).toMatchObject([{
      code: 'parse/dynamic-charset',
      phase: 'parse',
      message: 'Less 5 does not support interpolation in @charset.',
      filePath: 'entry.less',
      line: 2,
      column: 1,
      file: { source }
    }]);
    expect(result.errors[0]?.lines?.[2]).toBe('@charset "UTF-@{Eight}";');

    expect(() => parse(source)).toThrow(LessDynamicCharsetError);
    try {
      parse(source);
    } catch (error) {
      expect(error).toMatchObject({
        code: 'parse/dynamic-charset',
        offset: source.indexOf('@charset'),
        endOffset: source.length
      });
      expect(String(error)).not.toContain('offset');
    }
  });

  it('continues to accept a static CSS @charset statement', () => {
    const result = lessPlugin().safeParse!('entry.less', '@charset "UTF-8";');

    expect(result.errors).toEqual([]);
    expect(result.document).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'AtRuleStatement', name: '@charset' }]
    });
  });
});
