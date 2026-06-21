import { SourceText } from '../index.js';

describe('SourceText', () => {
  test('maps offsets to one-based line and column lazily', () => {
    const source = new SourceText('a\nbb\r\nccc', 'sample.css');

    expect(source.filePath).toBe('sample.css');
    expect(source.offsetToPosition(0)).toEqual({ line: 1, column: 1 });
    expect(source.offsetToPosition(2)).toEqual({ line: 2, column: 1 });
    expect(source.offsetToPosition(6)).toEqual({ line: 3, column: 1 });
    expect(source.positionToOffset({ line: 3, column: 2 })).toBe(7);
  });

  test('bounds position and offset lookups to the source text', () => {
    const source = new SourceText('abc');

    expect(source.offsetToPosition(99)).toEqual({ line: 1, column: 4 });
    expect(source.positionToOffset({ line: 99, column: 1 })).toBe(0);
    expect(source.positionToOffset({ line: 99, column: 99 })).toBe(3);
  });
});
