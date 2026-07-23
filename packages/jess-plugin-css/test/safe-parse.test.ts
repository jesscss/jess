import { describe, expect, it } from 'vitest';
import cssPlugin from '../src/index.js';

describe('@jesscss/plugin-css', () => {
  it('returns a canonical Stylesheet through safeParse', () => {
    const result = cssPlugin().safeParse!('entry.css', '.entry { color: red; }');

    expect(result.errors).toEqual([]);
    expect(result.document?.type).toBe('Stylesheet');
  });

  it('returns diagnostics rather than throwing for invalid CSS', () => {
    const source = '.entry { color: red; }\n!broken';
    const result = cssPlugin().safeParse!('entry.css', source);

    expect(result.document).toBeUndefined();
    expect(result.errors).toMatchObject([{
      code: 'parse/syntax-error',
      phase: 'parse',
      message: expect.stringMatching(/^CSS parser error\./),
      filePath: 'entry.css',
      line: 2,
      column: 1,
      file: { source }
    }]);
    expect(result.errors[0]?.lines?.[2]).toBe('!broken');
  });
});
