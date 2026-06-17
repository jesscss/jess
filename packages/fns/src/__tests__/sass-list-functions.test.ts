import { Any, List, Dimension, Context, Num, Quoted, Bool, Paren } from '@jesscss/core';
import { beforeAll, describe, it, expect } from 'vitest';
import length from '../sass/list/length.js';
import nth from '../sass/list/nth.js';
import index from '../sass/list/list-index.js';
import separator from '../sass/list/separator.js';
import isBracketed from '../sass/list/is-bracketed.js';

let context: Context;

describe('Sass list functions', () => {
  beforeAll(() => {
    context = new Context();
  });

  describe('length()', () => {
    it('returns the length of a list', () => {
      const list = new List([new Num(1), new Num(2), new Num(3)]);
      const result = length(list);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).number).toBe(3);
      expect((result as Dimension).unit).toBeUndefined();
    });

    it('returns 0 for empty list', () => {
      const list = new List([]);
      const result = length(list);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).number).toBe(0);
    });

    it('works with direct list arguments', () => {
      const list = new List([new Num(1), new Num(2)]);
      const result = length(list);
      expect((result as Dimension).number).toBe(2);
    });

    it('treats a scalar as a list of one item', () => {
      const result = length(new Any('solo'));
      expect((result as Dimension).number).toBe(1);
    });
  });

  describe('nth()', () => {
    it('returns the nth element (1-based)', () => {
      const list = new List([new Num(10), new Num(20), new Num(30)]);
      const n = new Dimension({ number: 2 });
      const result = nth(list, n);
      expect(result).toBeInstanceOf(Num);
      expect((result as Num).valueOf()).toBe(20);
    });

    it('returns first element when n is 1', () => {
      const list = new List([new Num(10), new Num(20)]);
      const n = new Dimension({ number: 1 });
      const result = nth(list, n);
      expect(result).toBeInstanceOf(Num);
      expect((result as Num).valueOf()).toBe(10);
    });

    it('returns last element', () => {
      const list = new List([new Num(10), new Num(20), new Num(30)]);
      const n = new Dimension({ number: 3 });
      const result = nth(list, n);
      expect(result).toBeInstanceOf(Num);
      expect((result as Num).valueOf()).toBe(30);
    });

    it('throws error for out of bounds index', () => {
      const list = new List([new Num(10), new Num(20)]);
      const n = new Dimension({ number: 5 });
      expect(() => nth(list, n)).toThrow('List index 5 is out of bounds');
    });

    it('throws error for index 0', () => {
      const list = new List([new Num(10)]);
      const n = new Dimension({ number: 0 });
      expect(() => nth(list, n)).toThrow();
    });

    it('works with object parameters', () => {
      const list = new List([new Num(10), new Num(20)]);
      const n = new Dimension({ number: 1 });
      const result = nth({ list, n });
      expect((result as Num).valueOf()).toBe(10);
    });

    it('accepts a bracketed paren-wrapped list', () => {
      const result = nth(new Paren(new List([new Num(10), new Num(20)]), { delimiter: 'square' }), new Dimension({ number: 2 }));
      expect((result as Num).valueOf()).toBe(20);
    });
  });

  describe('index()', () => {
    it('returns 1-based index when value is found', () => {
      const list = new List([new Num(10), new Num(20), new Num(30)]);
      const value = new Num(20);
      const result = index(list, value);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).number).toBe(2);
    });

    it('returns 1 for first element', () => {
      const list = new List([new Num(10), new Num(20)]);
      const value = new Num(10);
      const result = index(list, value);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).number).toBe(1);
    });

    it('returns null when value is not found', () => {
      const list = new List([new Num(10), new Num(20)]);
      const value = new Num(99);
      const result = index(list, value);
      expect(result).toBeNull();
    });

    it('works with string values', () => {
      const list = new List([new Quoted('a'), new Quoted('b'), new Quoted('c')]);
      const value = new Quoted('b');
      const result = index(list, value);
      expect(result).toBeInstanceOf(Dimension);
      expect((result as Dimension).number).toBe(2);
    });

    it('works with object parameters', () => {
      const list = new List([new Num(10), new Num(20)]);
      const value = new Num(20);
      const result = index({ list, value });
      expect((result as Dimension).number).toBe(2);
    });

    it('treats a scalar as a list of one item', () => {
      const value = new Any('solo');
      const result = index(value, new Any('solo'));
      expect((result as Dimension).number).toBe(1);
    });
  });

  describe('separator()', () => {
    it('returns "comma" for comma-separated list', () => {
      const list = new List([new Num(1), new Num(2)], { sep: ',' });
      const result = separator(list);
      expect(result).toBeInstanceOf(Quoted);
      expect((result as Quoted).valueOf()).toBe('comma');
    });

    it('returns "slash" for slash-separated list', () => {
      const list = new List([new Num(1), new Num(2)], { sep: '/' });
      const result = separator(list);
      expect(result).toBeInstanceOf(Quoted);
      expect((result as Quoted).valueOf()).toBe('slash');
    });

    it('returns "space" for space-separated list (default)', () => {
      const list = new List([new Num(1), new Num(2)]); // No sep means space
      const result = separator(list);
      expect(result).toBeInstanceOf(Quoted);
      expect((result as Quoted).valueOf()).toBe('space');
    });

    it('returns "space" for semicolon-separated list', () => {
      const list = new List([new Num(1), new Num(2)], { sep: ';' });
      const result = separator(list);
      expect(result).toBeInstanceOf(Quoted);
      expect((result as Quoted).valueOf()).toBe('space');
    });

    it('works with object parameters', () => {
      const list = new List([new Num(1), new Num(2)], { sep: ',' });
      const result = separator({ list });
      expect((result as Quoted).valueOf()).toBe('comma');
    });

    it('returns "space" for scalar inputs', () => {
      const result = separator(new Any('solo'));
      expect((result as Quoted).valueOf()).toBe('space');
    });
  });

  describe('is-bracketed()', () => {
    it('returns true for a list wrapped in square delimiters', () => {
      const list = new List([new Num(1), new Num(2)]);
      new Paren(list, { delimiter: 'square' });
      const result = isBracketed(list);
      expect(result).toBeInstanceOf(Bool);
      expect((result as Bool).value).toBe(true);
    });

    it('returns false for a list wrapped in ordinary parens', () => {
      const list = new List([new Num(1), new Num(2)]);
      new Paren(list, { delimiter: 'paren' });
      const result = isBracketed(list);
      expect(result).toBeInstanceOf(Bool);
      expect((result as Bool).value).toBe(false);
    });

    it('returns false for an unwrapped list', () => {
      const list = new List([new Num(1), new Num(2)]);
      const result = isBracketed(list);
      expect(result).toBeInstanceOf(Bool);
      expect((result as Bool).value).toBe(false);
    });

    it('works with object parameters', () => {
      const list = new List([new Num(1)]);
      new Paren(list, { delimiter: 'square' });
      const result = isBracketed({ list });
      expect(result).toBeInstanceOf(Bool);
      expect((result as Bool).value).toBe(true);
    });

    it('returns true when called with the bracketed paren directly', () => {
      const result = isBracketed(new Paren(new List([new Num(1)]), { delimiter: 'square' }));
      expect((result as Bool).value).toBe(true);
    });
  });
});
