import { Collection, Context, Declaration, Dimension, Num, Quoted, List, Bool, Nil, Any } from '@jesscss/core';
import { beforeAll, describe, it, expect } from 'vitest';
import get from '../sass/map/get.js';
import set from '../sass/map/set.js';
import merge from '../sass/map/merge.js';
import remove from '../sass/map/remove.js';
import keys from '../sass/map/keys.js';
import values from '../sass/map/values.js';
import hasKey from '../sass/map/has-key.js';

let context: Context;

describe('Sass map functions', () => {
  beforeAll(() => {
    context = new Context();
  });

  // Helper to create a simple map
  function createMap(entries: Array<[string, any]>): Collection {
    const declarations = entries.map(([key, value]) => {
      const keyNode = new Any(key, { role: 'property' });
      return new Declaration({
        name: keyNode,
        value: value
      });
    });
    return new Collection(declarations);
  }

  describe('get()', () => {
    it('gets value by key', () => {
      const map = createMap([['a', new Num(1)], ['b', new Num(2)]]);
      const key = new Any('a', { role: 'property' });
      const result = get.call(context, map, key);
      expect(result).toBeInstanceOf(Num);
      expect((result as Num).data.number).toBe(1);
    });

    it('returns Nil when key not found', () => {
      const map = createMap([['a', new Num(1)]]);
      const key = new Any('b', { role: 'property' });
      const result = get.call(context, map, key);
      expect(result).toBeInstanceOf(Nil);
    });

    it('gets nested value', () => {
      const nestedMap = createMap([['b', new Num(2)]]);
      const map = createMap([['a', nestedMap]]);
      const key1 = new Any('a', { role: 'property' });
      const key2 = new Any('b', { role: 'property' });
      const result = get.call(context, map, key1, key2);
      expect(result).toBeInstanceOf(Num);
      expect((result as Num).data.number).toBe(2);
    });

    it('returns Nil for non-map intermediate value', () => {
      const map = createMap([['a', new Num(1)]]);
      const key1 = new Any('a', { role: 'property' });
      const key2 = new Any('b', { role: 'property' });
      const result = get.call(context, map, key1, key2);
      expect(result).toBeInstanceOf(Nil);
    });

    it('works with object parameters', () => {
      const map = createMap([['a', new Num(1)]]);
      const key = new Any('a', { role: 'property' });
      const result = get.call(context, { map, key });
      expect((result as Num).data.number).toBe(1);
    });
  });

  describe('set()', () => {
    it('sets a new key-value pair', () => {
      const map = createMap([['a', new Num(1)]]);
      const key = new Any('b', { role: 'property' });
      const value = new Num(2);
      const result = set.call(context, map, key, value);
      expect(result).toBeInstanceOf(Collection);
      // Check that both keys exist
      const getA = get.call(context, result, new Any('a', { role: 'property' }));
      const getB = get.call(context, result, new Any('b', { role: 'property' }));
      expect((getA as Num).data.number).toBe(1);
      expect((getB as Num).data.number).toBe(2);
    });

    it('overwrites existing key', () => {
      const map = createMap([['a', new Num(1)]]);
      const key = new Any('a', { role: 'property' });
      const value = new Num(99);
      const result = set.call(context, map, key, value);
      const getA = get.call(context, result, new Any('a', { role: 'property' }));
      expect((getA as Num).data.number).toBe(99);
    });

    it('preserves original map', () => {
      const map = createMap([['a', new Num(1)]]);
      const key = new Any('b', { role: 'property' });
      const value = new Num(2);
      const result = set.call(context, map, key, value);
      // Original should still have only 'a'
      const originalA = get.call(context, map, new Any('a', { role: 'property' }));
      expect((originalA as Num).data.number).toBe(1);
      const originalB = get.call(context, map, new Any('b', { role: 'property' }));
      expect(originalB).toBeInstanceOf(Nil);
    });
  });

  describe('merge()', () => {
    it('merges two maps', () => {
      const map1 = createMap([['a', new Num(1)]]);
      const map2 = createMap([['b', new Num(2)]]);
      const result = merge.call(context, map1, map2);
      expect(result).toBeInstanceOf(Collection);
      const getA = get.call(context, result, new Any('a', { role: 'property' }));
      const getB = get.call(context, result, new Any('b', { role: 'property' }));
      expect((getA as Num).data.number).toBe(1);
      expect((getB as Num).data.number).toBe(2);
    });

    it('overwrites keys from map2', () => {
      const map1 = createMap([['a', new Num(1)], ['b', new Num(10)]]);
      const map2 = createMap([['b', new Num(2)]]);
      const result = merge.call(context, map1, map2);
      const getB = get.call(context, result, new Any('b', { role: 'property' }));
      expect((getB as Num).data.number).toBe(2); // map2's value wins
    });
  });

  describe('remove()', () => {
    it('removes a key', () => {
      const map = createMap([['a', new Num(1)], ['b', new Num(2)]]);
      const key = new Any('a', { role: 'property' });
      const result = remove.call(context, map, key);
      expect(result).toBeInstanceOf(Collection);
      const getA = get.call(context, result, new Any('a', { role: 'property' }));
      const getB = get.call(context, result, new Any('b', { role: 'property' }));
      expect(getA).toBeInstanceOf(Nil);
      expect((getB as Num).data.number).toBe(2);
    });

    it('removes multiple keys', () => {
      const map = createMap([['a', new Num(1)], ['b', new Num(2)], ['c', new Num(3)]]);
      const key1 = new Any('a', { role: 'property' });
      const key2 = new Any('b', { role: 'property' });
      const result = remove.call(context, map, key1, key2);
      const getA = get.call(context, result, new Any('a', { role: 'property' }));
      const getB = get.call(context, result, new Any('b', { role: 'property' }));
      const getC = get.call(context, result, new Any('c', { role: 'property' }));
      expect(getA).toBeInstanceOf(Nil);
      expect(getB).toBeInstanceOf(Nil);
      expect((getC as Num).data.number).toBe(3);
    });

    it('returns map as-is when no keys provided', () => {
      const map = createMap([['a', new Num(1)]]);
      const result = remove.call(context, map);
      expect(result).toBeInstanceOf(Collection);
      const getA = get.call(context, result, new Any('a', { role: 'property' }));
      expect((getA as Num).data.number).toBe(1);
    });
  });

  describe('keys()', () => {
    it('returns list of all keys', () => {
      const map = createMap([['a', new Num(1)], ['b', new Num(2)]]);
      const result = keys.call(context, map);
      expect(result).toBeInstanceOf(List);
      expect(result.length).toBe(2);
    });

    it('returns empty list for empty map', () => {
      const map = createMap([]);
      const result = keys.call(context, map);
      expect(result).toBeInstanceOf(List);
      expect(result.length).toBe(0);
    });
  });

  describe('values()', () => {
    it('returns list of all values', () => {
      const map = createMap([['a', new Num(1)], ['b', new Num(2)]]);
      const result = values.call(context, map);
      expect(result).toBeInstanceOf(List);
      expect(result.length).toBe(2);
      expect((result.data[0] as Num).data.number).toBe(1);
      expect((result.data[1] as Num).data.number).toBe(2);
    });

    it('returns empty list for empty map', () => {
      const map = createMap([]);
      const result = values.call(context, map);
      expect(result).toBeInstanceOf(List);
      expect(result.length).toBe(0);
    });
  });

  describe('has-key()', () => {
    it('returns true when key exists', () => {
      const map = createMap([['a', new Num(1)]]);
      const key = new Any('a', { role: 'property' });
      const result = hasKey.call(context, map, key);
      expect(result).toBeInstanceOf(Bool);
      expect((result as Bool).data).toBe(true);
    });

    it('returns false when key does not exist', () => {
      const map = createMap([['a', new Num(1)]]);
      const key = new Any('b', { role: 'property' });
      const result = hasKey.call(context, map, key);
      expect(result).toBeInstanceOf(Bool);
      expect((result as Bool).data).toBe(false);
    });

    it('checks nested keys', () => {
      const nestedMap = createMap([['b', new Num(2)]]);
      const map = createMap([['a', nestedMap]]);
      const key1 = new Any('a', { role: 'property' });
      const key2 = new Any('b', { role: 'property' });
      const result = hasKey.call(context, map, key1, key2);
      expect(result).toBeInstanceOf(Bool);
      expect((result as Bool).data).toBe(true);
    });

    it('returns false for non-map intermediate value', () => {
      const map = createMap([['a', new Num(1)]]);
      const key1 = new Any('a', { role: 'property' });
      const key2 = new Any('b', { role: 'property' });
      const result = hasKey.call(context, map, key1, key2);
      expect(result).toBeInstanceOf(Bool);
      expect((result as Bool).data).toBe(false);
    });
  });
});
