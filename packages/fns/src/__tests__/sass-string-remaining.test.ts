import { describe, it, expect } from 'vitest';
import {
  makeDimension,
  makeKeyword,
  makeQuoted,
  type Dimension,
  type Keyword,
  type Quoted
} from '@jesscss/core';
import uniqueId from '../sass/unique-id.js';
import strInsert from '../sass/str-insert.js';
import strIndex from '../sass/str-index.js';
import strSlice from '../sass/str-slice.js';

const quoted = (value: string, quoteChar = '"'): Quoted => makeQuoted(value, quoteChar, false);
const unquoted = (text: string): Keyword => makeKeyword(text);

function expectDimension(value: unknown): Dimension {
  if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'Dimension') {
    throw new TypeError('Expected a Dimension result.');
  }
  return value as Dimension;
}

describe('Sass remaining string functions', () => {
  describe('unique-id()', () => {
    it('returns a unique unquoted string', () => {
      const result = uniqueId();
      expect(result.type).toBe('Keyword');
      expect((result as Keyword).text).toMatch(/^u[0-9a-z]{6}$/);
    });

    it('returns different IDs on subsequent calls', () => {
      const id1 = uniqueId();
      const id2 = uniqueId();
      expect((id1 as Keyword).text).not.toBe((id2 as Keyword).text);
    });

    it('starts with "u"', () => {
      const result = uniqueId();
      expect((result as Keyword).text).toMatch(/^u/);
    });
  });

  describe('str-insert()', () => {
    it('inserts string at positive index (1-based)', () => {
      const str = unquoted('Hello');
      const insert = unquoted('X');
      const index = makeDimension(3);
      const result = strInsert(str, insert, index);
      expect(result).toMatchObject({ type: 'Keyword', text: 'HeXllo' });
    });

    it('inserts at beginning when index is 1', () => {
      const str = unquoted('Hello');
      const insert = unquoted('X');
      const index = makeDimension(1);
      const result = strInsert(str, insert, index);
      expect(result).toMatchObject({ type: 'Keyword', text: 'XHello' });
    });

    it('inserts at end when index is length+1', () => {
      const str = unquoted('Hello');
      const insert = unquoted('X');
      const index = makeDimension(6);
      const result = strInsert(str, insert, index);
      expect(result).toMatchObject({ type: 'Keyword', text: 'HelloX' });
    });

    it('handles negative index', () => {
      const str = unquoted('Hello');
      const insert = unquoted('X');

      const index = makeDimension(-3);
      const result = strInsert(str, insert, index);

      expect(result).toMatchObject({ type: 'Keyword', text: 'HelXlo' });
    });

    it('preserves quote style', () => {
      const str = quoted('Hello');
      const insert = unquoted('X');
      const index = makeDimension(3);
      const result = strInsert(str, insert, index);
      expect(result).toMatchObject({ type: 'Quoted', value: 'HeXllo', quote: '"' });
    });
  });

  describe('str-index()', () => {
    it('returns 1-based index when substring is found', () => {
      const str = unquoted('Hello');
      const substring = unquoted('ll');
      const result = strIndex(str, substring);
      expect(expectDimension(result).number).toBe(3);
    });

    it('returns 1 for first character', () => {
      const str = unquoted('Hello');
      const substring = unquoted('H');
      const result = strIndex(str, substring);
      expect(expectDimension(result).number).toBe(1);
    });

    it('returns Nil when substring is not found', () => {
      const str = unquoted('Hello');
      const substring = unquoted('x');
      const result = strIndex(str, substring);
      expect(result).toMatchObject({ type: 'Nil' });
    });

    it('returns first occurrence index', () => {
      const str = unquoted('Hello Hello');
      const substring = unquoted('ll');
      const result = strIndex(str, substring);
      expect(expectDimension(result).number).toBe(3);
    });
  });

  describe('str-slice()', () => {
    it('extracts substring with start and end', () => {
      const str = unquoted('Hello');
      const start = makeDimension(2);
      const end = makeDimension(4);
      const result = strSlice(str, start, end);
      expect(result).toMatchObject({ type: 'Keyword', text: 'ell' });
    });

    it('extracts from start to end when end not provided', () => {
      const str = unquoted('Hello');
      const start = makeDimension(2);
      const result = strSlice(str, start);
      expect(result).toMatchObject({ type: 'Keyword', text: 'ello' });
    });

    it('handles negative start index', () => {
      const str = unquoted('Hello');
      const start = makeDimension(-3);
      const result = strSlice(str, start);

      expect(result).toMatchObject({ type: 'Keyword', text: 'llo' });
    });

    it('handles negative end index', () => {
      const str = unquoted('Hello');
      const start = makeDimension(2);
      const end = makeDimension(-1);
      const result = strSlice(str, start, end);

      expect(result).toMatchObject({ type: 'Keyword', text: 'ello' });
    });

    it('preserves quote style', () => {
      const str = quoted('Hello');
      const start = makeDimension(1);
      const end = makeDimension(3);
      const result = strSlice(str, start, end);
      expect(result).toMatchObject({ type: 'Quoted', value: 'Hel', quote: '"' });
    });
  });
});
