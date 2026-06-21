import { SourceText } from '../index.js';

describe('SourceText', () => {
  test('maps offsets to one-based line and column lazily', () => {
    const source = new SourceText('a\nbb\r\nccc', 'sample.css');

    expect(source.filePath).toBe('sample.css');
    expect(source.hasLineMap).toBe(false);
    expect(source.offsetToPosition(0)).toEqual({ line: 1, column: 1 });
    expect(source.offsetToPosition(2)).toEqual({ line: 2, column: 1 });
    expect(source.offsetToPosition(6)).toEqual({ line: 3, column: 1 });
    expect(source.positionToOffset(3, 2)).toBe(7);
    expect(source.hasLineMap).toBe(true);
  });

  test('rejects out-of-range position and offset lookups', () => {
    const source = new SourceText('abc');

    expect(() => source.offsetToPosition(99)).toThrow(RangeError);
    expect(() => source.positionToOffset(99, 1)).toThrow(RangeError);
    expect(() => source.positionToOffset(1, 99)).toThrow(RangeError);
  });
});
