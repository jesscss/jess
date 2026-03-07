import { List, Dimension, Context, Num, Quoted } from '@jesscss/core';
import { beforeAll, describe, it, expect } from 'vitest';
import setNth from '../list/set-nth.js';
import append from '../list/append.js';
import join from '../list/join.js';
import zip from '../list/zip.js';

let context: Context;

describe('Sass advanced list functions', () => {
  beforeAll(() => {
    context = new Context();
  });

  describe('set-nth()', () => {
    it('sets the nth element (1-based)', () => {
      const list = new List([new Num(10), new Num(20), new Num(30)]);
      const n = new Dimension({ number: 2 });
      const value = new Num(99);
      const result = setNth(list, n, value);
      expect(result).toBeInstanceOf(List);
      expect(result.length).toBe(3);
      expect((result.value[0] as Num).valueOf()).toBe(10);
      expect((result.value[1] as Num).valueOf()).toBe(99);
      expect((result.value[2] as Num).valueOf()).toBe(30);
    });

    it('sets first element', () => {
      const list = new List([new Num(10), new Num(20)]);
      const n = new Dimension({ number: 1 });
      const value = new Num(99);
      const result = setNth(list, n, value);
      expect((result.value[0] as Num).valueOf()).toBe(99);
    });

    it('sets last element', () => {
      const list = new List([new Num(10), new Num(20), new Num(30)]);
      const n = new Dimension({ number: 3 });
      const value = new Num(99);
      const result = setNth(list, n, value);
      expect((result.value[2] as Num).valueOf()).toBe(99);
    });

    it('preserves original list', () => {
      const list = new List([new Num(10), new Num(20)]);
      const n = new Dimension({ number: 1 });
      const value = new Num(99);
      const result = setNth(list, n, value);
      expect((list.value[0] as Num).valueOf()).toBe(10);
      expect((result.value[0] as Num).valueOf()).toBe(99);
    });

    it('throws error for out of bounds index', () => {
      const list = new List([new Num(10), new Num(20)]);
      const n = new Dimension({ number: 5 });
      const value = new Num(99);
      expect(() => setNth(list, n, value)).toThrow('List index 5 is out of bounds');
    });
  });

  describe('append()', () => {
    it('appends value to list', () => {
      const list = new List([new Num(1), new Num(2)]);
      const value = new Num(3);
      const result = append(list, value);
      expect(result).toBeInstanceOf(List);
      expect(result.length).toBe(3);
      expect((result.value[2] as Num).valueOf()).toBe(3);
    });

    it('preserves separator when appending', () => {
      const list = new List([new Num(1), new Num(2)], { sep: ',' });
      const value = new Num(3);
      const result = append(list, value);
      expect(result.options?.sep).toBe(',');
    });

    it('changes separator when specified', () => {
      const list = new List([new Num(1), new Num(2)]);
      const value = new Num(3);
      const separator = new Quoted('comma', { quote: undefined });
      const result = append(list, value, separator);
      expect(result.options?.sep).toBe(',');
    });

    it('uses auto separator (preserves existing)', () => {
      const list = new List([new Num(1), new Num(2)], { sep: '/' });
      const value = new Num(3);
      const separator = new Quoted('auto', { quote: undefined });
      const result = append(list, value, separator);
      expect(result.options?.sep).toBe('/');
    });
  });

  describe('join()', () => {
    it('joins two lists', () => {
      const list1 = new List([new Num(1), new Num(2)]);
      const list2 = new List([new Num(3), new Num(4)]);
      const result = join(list1, list2);
      expect(result).toBeInstanceOf(List);
      expect(result.length).toBe(4);
      expect((result.value[0] as Num).valueOf()).toBe(1);
      expect((result.value[3] as Num).valueOf()).toBe(4);
    });

    it('uses first list separator by default', () => {
      const list1 = new List([new Num(1), new Num(2)], { sep: ',' });
      const list2 = new List([new Num(3), new Num(4)]);
      const result = join(list1, list2);
      expect(result.options?.sep).toBe(',');
    });

    it('uses specified separator', () => {
      const list1 = new List([new Num(1), new Num(2)]);
      const list2 = new List([new Num(3), new Num(4)]);
      const separator = new Quoted('slash', { quote: undefined });
      const result = join(list1, list2, separator);
      expect(result.options?.sep).toBe('/');
    });

    it('handles auto separator', () => {
      const list1 = new List([new Num(1), new Num(2)], { sep: ',' });
      const list2 = new List([new Num(3), new Num(4)], { sep: '/' });
      const separator = new Quoted('auto', { quote: undefined });
      const result = join(list1, list2, separator);
      expect(result.options?.sep).toBe(',');
    });
  });

  describe('zip()', () => {
    it('zips two lists of equal length', () => {
      const list1 = new List([new Num(1), new Num(2)]);
      const list2 = new List([new Num(10), new Num(20)]);
      const result = zip(list1, list2);
      expect(result).toBeInstanceOf(List);
      expect(result.length).toBe(2);
      expect(result.options?.sep).toBe(',');

      const first = result.value[0] as List;
      expect(first).toBeInstanceOf(List);
      expect(first.length).toBe(2);
      expect((first.value[0] as Num).valueOf()).toBe(1);
      expect((first.value[1] as Num).valueOf()).toBe(10);

      const second = result.value[1] as List;
      expect(second.length).toBe(2);
      expect((second.value[0] as Num).valueOf()).toBe(2);
      expect((second.value[1] as Num).valueOf()).toBe(20);
    });

    it('zips three lists', () => {
      const list1 = new List([new Num(1), new Num(2)]);
      const list2 = new List([new Num(10), new Num(20)]);
      const list3 = new List([new Num(100), new Num(200)]);
      const result = zip(list1, list2, list3);
      expect(result.length).toBe(2);

      const first = result.value[0] as List;
      expect(first.length).toBe(3);
      expect((first.value[0] as Num).valueOf()).toBe(1);
      expect((first.value[1] as Num).valueOf()).toBe(10);
      expect((first.value[2] as Num).valueOf()).toBe(100);
    });

    it('stops when shortest list ends', () => {
      const list1 = new List([new Num(1), new Num(2), new Num(3)]);
      const list2 = new List([new Num(10), new Num(20)]);
      const result = zip(list1, list2);
      expect(result.length).toBe(2);
    });

    it('returns empty list for no arguments', () => {
      const result = zip();
      expect(result).toBeInstanceOf(List);
      expect(result.length).toBe(0);
    });
  });
});
