import { Quoted, Context, Dimension } from '@jesscss/core';
import { beforeAll, describe, it, expect } from 'vitest';
import uniqueId from '../unique-id.js';
import strInsert from '../str-insert.js';
import strIndex from '../str-index.js';
import strSlice from '../str-slice.js';

let context: Context;

describe('Sass remaining string functions', () => {
  beforeAll(() => {
    context = new Context();
  });

  describe('unique-id()', () => {
    it('returns a unique unquoted string', () => {
      const result = uniqueId();
      expect(result).toBeInstanceOf(Quoted);
      expect((result as Quoted).quote).toBeUndefined();
      expect((result as Quoted).valueOf()).toMatch(/^u[0-9a-z]{6}$/);
    });

    it('returns different IDs on subsequent calls', () => {
      const id1 = uniqueId();
      const id2 = uniqueId();
      expect((id1 as Quoted).valueOf()).not.toBe((id2 as Quoted).valueOf());
    });

    it('starts with "u"', () => {
      const result = uniqueId();
      expect((result as Quoted).valueOf()).toMatch(/^u/);
    });
  });

  describe('str-insert()', () => {
    it('inserts string at positive index (1-based)', () => {
      const str = new Quoted('Hello', { quote: undefined });
      const insert = new Quoted('X', { quote: undefined });
      const index = new Dimension({ number: 3 });
      const result = strInsert(str, insert, index);
      expect(result).toBeInstanceOf(Quoted);
      expect((result as Quoted).valueOf()).toBe('HeXllo');
    });

    it('inserts at beginning when index is 1', () => {
      const str = new Quoted('Hello');
      const insert = new Quoted('X');
      const index = new Dimension({ number: 1 });
      const result = strInsert(str, insert, index);
      expect((result as Quoted).valueOf()).toBe('XHello');
    });

    it('inserts at end when index is length+1', () => {
      const str = new Quoted('Hello');
      const insert = new Quoted('X');
      const index = new Dimension({ number: 6 });
      const result = strInsert(str, insert, index);
      expect((result as Quoted).valueOf()).toBe('HelloX');
    });

    it('handles negative index', () => {
      const str = new Quoted('Hello');
      const insert = new Quoted('X');
      const index = new Dimension({ number: -3 });
      const result = strInsert(str, insert, index);
      expect((result as Quoted).valueOf()).toBe('HelXlo');
    });

    it('preserves quote style', () => {
      const str = new Quoted('Hello', { quote: '"' });
      const insert = new Quoted('X');
      const index = new Dimension({ number: 3 });
      const result = strInsert(str, insert, index);
      expect((result as Quoted).quote).toBe('"');
    });
  });

  describe('str-index()', () => {
    it('returns 1-based index when substring is found', () => {
      const str = new Quoted('Hello');
      const substring = new Quoted('ll');
      const result = strIndex(str, substring);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).data.number).toBe(3);
    });

    it('returns 1 for first character', () => {
      const str = new Quoted('Hello');
      const substring = new Quoted('H');
      const result = strIndex(str, substring);
      expect((result as Dimension).data.number).toBe(1);
    });

    it('returns null when substring is not found', () => {
      const str = new Quoted('Hello');
      const substring = new Quoted('x');
      const result = strIndex(str, substring);
      expect(result).toBeNull();
    });

    it('returns first occurrence index', () => {
      const str = new Quoted('Hello Hello');
      const substring = new Quoted('ll');
      const result = strIndex(str, substring);
      expect((result as Dimension).data.number).toBe(3);
    });
  });

  describe('str-slice()', () => {
    it('extracts substring with start and end', () => {
      const str = new Quoted('Hello');
      const start = new Dimension({ number: 2 });
      const end = new Dimension({ number: 4 });
      const result = strSlice(str, start, end);
      expect(result).toBeInstanceOf(Quoted);
      expect((result as Quoted).valueOf()).toBe('ell');
    });

    it('extracts from start to end when end not provided', () => {
      const str = new Quoted('Hello');
      const start = new Dimension({ number: 2 });
      const result = strSlice(str, start);
      expect((result as Quoted).valueOf()).toBe('ello');
    });

    it('handles negative start index', () => {
      const str = new Quoted('Hello');
      const start = new Dimension({ number: -3 });
      const result = strSlice(str, start);
      expect((result as Quoted).valueOf()).toBe('llo');
    });

    it('handles negative end index', () => {
      const str = new Quoted('Hello');
      const start = new Dimension({ number: 2 });
      const end = new Dimension({ number: -1 });
      const result = strSlice(str, start, end);
      expect((result as Quoted).valueOf()).toBe('ell');
    });

    it('preserves quote style', () => {
      const str = new Quoted('Hello', { quote: '"' });
      const start = new Dimension({ number: 1 });
      const end = new Dimension({ number: 3 });
      const result = strSlice(str, start, end);
      expect((result as Quoted).quote).toBe('"');
    });
  });
});
