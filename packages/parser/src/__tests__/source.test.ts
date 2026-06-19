import { describe, expect, test } from 'vitest';
import {
  LineMap,
  SourceText,
  delimitedSpan,
  sourceSpan,
  type TriviaRun
} from '../index.js';

describe('SourceText', () => {
  test('stores text metadata and slices validated ranges', () => {
    const source = new SourceText('a { color: red; }', {
      filePath: 'style.less',
      version: 7
    });

    expect(source.length).toBe(17);
    expect(source.filePath).toBe('style.less');
    expect(source.version).toBe(7);
    expect(source.slice(4, 9)).toBe('color');
    expect(() => source.slice(9, 4)).toThrow(RangeError);
  });

  test('builds the line map lazily', () => {
    const source = new SourceText('a\nb');

    expect(source.hasLineMap).toBe(false);
    expect(source.offsetToLineColumn(2)).toEqual({ line: 2, column: 1 });
    expect(source.hasLineMap).toBe(true);
  });
});

describe('LineMap', () => {
  test('maps offsets for LF, CRLF, CR, and form-feed', () => {
    const text = 'a\nb\r\nc\rd\fe';
    const map = new LineMap(text);

    expect(map.lineStarts).toEqual([0, 2, 5, 7, 9]);
    expect(map.offsetToLineColumn(0)).toEqual({ line: 1, column: 1 });
    expect(map.offsetToLineColumn(2)).toEqual({ line: 2, column: 1 });
    expect(map.offsetToLineColumn(5)).toEqual({ line: 3, column: 1 });
    expect(map.offsetToLineColumn(7)).toEqual({ line: 4, column: 1 });
    expect(map.offsetToLineColumn(9)).toEqual({ line: 5, column: 1 });
    expect(map.lineColumnToOffset(5, 1)).toBe(9);
  });

  test('allows the EOF offset and rejects out-of-range locations', () => {
    const map = new LineMap('a\nbc');

    expect(map.offsetToLineColumn(4)).toEqual({ line: 2, column: 3 });
    expect(() => map.offsetToLineColumn(5)).toThrow(RangeError);
    expect(() => map.lineColumnToOffset(3, 1)).toThrow(RangeError);
    expect(() => map.lineColumnToOffset(1, 3)).toThrow(RangeError);
  });
});

describe('span helpers', () => {
  test('creates source span views from numeric offsets', () => {
    expect(sourceSpan(1, 4)).toEqual({ start: 1, end: 4 });
  });

  test('creates delimited span views from numeric offsets', () => {
    expect(delimitedSpan(0, 8, 1, 7, 0, 1, 7, 8)).toEqual({
      start: 0,
      end: 8,
      contentStart: 1,
      contentEnd: 7,
      openStart: 0,
      openEnd: 1,
      closeStart: 7,
      closeEnd: 8
    });
  });

  test('represents trivia as ranges', () => {
    const trivia: TriviaRun = { start: 0, end: 2, kind: 'newline' };
    expect(trivia).toEqual({ start: 0, end: 2, kind: 'newline' });
  });
});
