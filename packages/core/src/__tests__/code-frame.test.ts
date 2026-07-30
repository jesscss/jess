import { describe, expect, it } from 'vitest';
import { extractRelevantLines, lineColAt } from '../error/code-frame.js';

describe('code-frame source index', () => {
  it('returns correct locations and frame slices for CRLF source without splitting it', () => {
    const source = 'first\r\nsecond\r\nthird\r\n';
    const file = { source };

    expect(lineColAt(source, source.indexOf('second'), file)).toEqual({ line: 2, column: 1 });
    expect(lineColAt(source, source.indexOf('third') + 3, file)).toEqual({ line: 3, column: 4 });
    expect(extractRelevantLines(source, 2, 1, file)).toEqual({
      1: 'first',
      2: 'second',
      3: 'third'
    });
  });

  it('refreshes the per-file index when that file supplies different source', () => {
    const file = {};
    expect(lineColAt('one\ntwo', 4, file)).toEqual({ line: 2, column: 1 });
    expect(lineColAt('one\ntwo\nthree', 8, file)).toEqual({ line: 3, column: 1 });
  });
});
