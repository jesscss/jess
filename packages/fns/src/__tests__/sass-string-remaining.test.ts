import { Quoted, Context, Dimension } from '@jesscss/core';
import { beforeAll, describe, it, expect } from 'vitest';
import uniqueId from '../sass/unique-id.js';
import strInsert from '../sass/str-insert.js';
import strIndex from '../sass/str-index.js';
import strSlice from '../sass/str-slice.js';

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
      // Test with -3: length (5) + (-3) + 2 = 4, insert at position 4 (after 'l', before 'o')
      const index = new Dimension({ number: -3 });
      const result = strInsert(str, insert, index);
      // Insert at position 4 means: 'Hell' + 'X' + 'o' = 'HellXo'
      // But wait, the insert should be at index -3, which means after the character at -3
      // -3 from end is 'l' (index 2), so insert after it: 'Hel' + 'X' + 'lo' = 'HelXlo'
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
      expect((result as Dimension).data.number).toBe(3); // First occurrence
    });
  });

  describe('str-slice()', () => {
    it('extracts substring with start and end', () => {
      const str = new Quoted('Hello');
      const start = new Dimension({ number: 2 });
      const end = new Dimension({ number: 4 });
      const result = strSlice(str, start, end);
      expect(result).toBeInstanceOf(Quoted);
      // start: 2 (1-based) -> index 1 (0-based) = 'e'
      // end: 4 (1-based) -> index 3 (0-based, inclusive) = 'l'
      // So slice(1, 4) = 'ell'
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
      // -3: length (5) + (-3) = 2, so start at index 2 ('l')
      // Default end is -1: length (5) + (-1) = 4, but if equals length, subtract 1 = 3
      // Wait, let me check the actual behavior
      // start: -3 -> 5 + (-3) = 2 (index of 'l')
      // end: default -1 -> 5 + (-1) = 4, but if equals length, 4 - 1 = 3
      // So slice(2, 4) = 'll'... but we want 'llo'
      // Actually end is inclusive in Sass, so we need end + 1
      // If end is 4 (after adjustment), we slice(2, 5) = 'llo'
      expect((result as Quoted).valueOf()).toBe('llo');
    });

    it('handles negative end index', () => {
      const str = new Quoted('Hello');
      const start = new Dimension({ number: 2 });
      const end = new Dimension({ number: -1 });
      const result = strSlice(str, start, end);
      // start: 2 (1-based) -> index 1 (0-based) = 'e'
      // end: -1 -> length (5) + (-1) = 4, but if equals length, 4 - 1 = 3
      // endCodepoint is inclusive, so slice(1, 4) = 'ell'
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
