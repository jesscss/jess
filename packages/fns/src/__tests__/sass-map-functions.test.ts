import { Collection, Context, Declaration, Dimension, Num, Quoted, Any, Nil, Bool } from '@jesscss/core';
import { beforeAll, describe, it, expect } from 'vitest';
import get from '../sass/map/get.js';
import set from '../sass/map/set.js';
import merge from '../sass/map/merge.js';
import remove from '../sass/map/remove.js';
import keys from '../sass/map/keys.js';
import values from '../sass/map/values.js';
import hasKey from '../sass/map/has-key.js';

let context: Context;

// Helper to create a simple map Collection
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

describe('Sass map functions', () => {
  beforeAll(() => {
    context = new Context();
  });

  describe('get()', () => {
    it('gets value by key', () => {
      const map = createMap([['a', new Num(1)], ['b', new Num(2)]]);
      const key = new Any('a', { role: 'property' });
      const result = get.call(context, map, key);
      expect(result).toBeInstanceOf(Num);
      expect((result as Num).value).toBe(1);
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
      expect((result as Num).value).toBe(2);
    });

    it('returns Nil for invalid nested path', () => {
      const map = createMap([['a', new Num(1)]]);
      const key1 = new Any('a', { role: 'property' });
      const key2 = new Any('b', { role: 'property' });
      const result = get.call(context, map, key1, key2);
      expect(result).toBeInstanceOf(Nil);
    });
  });

  describe('keys()', () => {
    it('returns list of all keys', () => {
      const map = createMap([['a', new Num(1)], ['b', new Num(2)]]);
      const result = keys.call(context, map);
      expect(result).toBeInstanceOf(require('@jesscss/core').List);
      expect(result.length).toBe(2);
    });

    it('returns empty list for empty map', () => {
      const map = createMap([]);
      const result = keys.call(context, map);
      expect(result).toBeInstanceOf(require('@jesscss/core').List);
      expect(result.length).toBe(0);
    });
  });

  describe('values()', () => {
    it('returns list of all values', () => {
      const map = createMap([['a', new Num(1)], ['b', new Num(2)]]);
      const result = values.call(context, map);
      expect(result).toBeInstanceOf(require('@jesscss/core').List);
      expect(result.length).toBe(2);
      expect((result.value[0] as Num).value).toBe(1);
      expect((result.value[1] as Num).value).toBe(2);
    });

    it('returns empty list for empty map', () => {
      const map = createMap([]);
      const result = values.call(context, map);
      expect(result).toBeInstanceOf(require('@jesscss/core').List);
      expect(result.length).toBe(0);
    });
  });

  describe('has-key()', () => {
    it('returns true when key exists', () => {
      const map = createMap([['a', new Num(1)]]);
      const key = new Any('a', { role: 'property' });
      const result = hasKey.call(context, map, key);
      expect(result).toBeInstanceOf(Bool);
      expect((result as Bool).value).toBe(true);
    });

    it('returns false when key does not exist', () => {
      const map = createMap([['a', new Num(1)]]);
      const key = new Any('b', { role: 'property' });
      const result = hasKey.call(context, map, key);
      expect(result).toBeInstanceOf(Bool);
      expect((result as Bool).value).toBe(false);
    });

    it('checks nested keys', () => {
      const nestedMap = createMap([['b', new Num(2)]]);
      const map = createMap([['a', nestedMap]]);
      const key1 = new Any('a', { role: 'property' });
      const key2 = new Any('b', { role: 'property' });
      const result = hasKey.call(context, map, key1, key2);
      expect(result).toBeInstanceOf(Bool);
      expect((result as Bool).value).toBe(true);
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
      const keyA = new Any('a', { role: 'property' });
      const keyB = new Any('b', { role: 'property' });
      expect(get.call(context, result, keyA)).toBeInstanceOf(Num);
      expect(get.call(context, result, keyB)).toBeInstanceOf(Num);
    });

    it('overwrites existing key', () => {
      const map = createMap([['a', new Num(1)]]);
      const key = new Any('a', { role: 'property' });
      const value = new Num(99);
      const result = set.call(context, map, key, value);
      const found = get.call(context, result, key);
      expect((found as Num).value).toBe(99);
    });
  });

  describe('merge()', () => {
    it('merges two maps', () => {
      const map1 = createMap([['a', new Num(1)]]);
      const map2 = createMap([['b', new Num(2)]]);
      const result = merge.call(context, map1, map2);
      expect(result).toBeInstanceOf(Collection);
      const keyA = new Any('a', { role: 'property' });
      const keyB = new Any('b', { role: 'property' });
      expect(get.call(context, result, keyA)).toBeInstanceOf(Num);
      expect(get.call(context, result, keyB)).toBeInstanceOf(Num);
    });

    it('overwrites keys from map1 with map2', () => {
      const map1 = createMap([['a', new Num(1)]]);
      const map2 = createMap([['a', new Num(99)]]);
      const result = merge.call(context, map1, map2);
      const keyA = new Any('a', { role: 'property' });
      const found = get.call(context, result, keyA);
      expect((found as Num).value).toBe(99); // map2 value wins
    });
  });

  describe('remove()', () => {
    it('removes a key from map', () => {
      const map = createMap([['a', new Num(1)], ['b', new Num(2)]]);
      const key = new Any('a', { role: 'property' });
      const result = remove.call(context, map, key);
      expect(result).toBeInstanceOf(Collection);
      // Check that 'a' is gone but 'b' remains
      const keyA = new Any('a', { role: 'property' });
      const keyB = new Any('b', { role: 'property' });
      expect(get.call(context, result, keyA)).toBeInstanceOf(Nil);
      expect(get.call(context, result, keyB)).toBeInstanceOf(Num);
    });

    it('removes multiple keys', () => {
      const map = createMap([['a', new Num(1)], ['b', new Num(2)], ['c', new Num(3)]]);
      const key1 = new Any('a', { role: 'property' });
      const key2 = new Any('b', { role: 'property' });
      const result = remove.call(context, map, key1, key2);
      const keyC = new Any('c', { role: 'property' });
      expect(get.call(context, result, key1)).toBeInstanceOf(Nil);
      expect(get.call(context, result, key2)).toBeInstanceOf(Nil);
      expect(get.call(context, result, keyC)).toBeInstanceOf(Num);
    });

    it('returns map unchanged when no keys provided', () => {
      const map = createMap([['a', new Num(1)]]);
      const result = remove.call(context, map);
      expect(result).toBeInstanceOf(Collection);
      const keyA = new Any('a', { role: 'property' });
      expect(get.call(context, result, keyA)).toBeInstanceOf(Num);
    });
  });
});
