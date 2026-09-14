import {
  isValueGroupArray,
  makeCollection,
  makeDimension,
  makeKeyword,
  makeQuoted,
  type Bool,
  type Collection,
  type Dimension,
  type List,
  type Null,
  type ValueGroup
} from '@jesscss/core';
import { describe, it, expect } from 'vitest';
import get from '../sass/map/get.js';
import set from '../sass/map/set.js';
import merge from '../sass/map/merge.js';
import { deepMerge } from '../sass/map/index.js';
import remove from '../sass/map/remove.js';
import keys from '../sass/map/keys.js';
import values from '../sass/map/values.js';
import hasKey from '../sass/map/has-key.js';

function sync<T>(value: T | Promise<T>): T {
  if (value instanceof Promise) {
    throw new TypeError('Expected a synchronous value-domain function result.');
  }
  return value;
}

function key(value: string): ValueGroup {
  return makeKeyword(value);
}

function quoted(value: string): ValueGroup {
  return makeQuoted(value, '"', false);
}

function createMap(entries: ReadonlyArray<readonly [string, ValueGroup]>): Collection {
  return makeCollection(entries.map(([name, value]) => ({ key: key(name), value })));
}

function dimensionOf(value: ValueGroup): Dimension {
  if (isValueGroupArray(value) || value.type !== 'Dimension') {
    throw new TypeError(`Expected Dimension, got ${isValueGroupArray(value) ? 'sequence' : value.type}`);
  }
  return value;
}

function collectionOf(value: ValueGroup): Collection {
  if (isValueGroupArray(value) || value.type !== 'Collection') {
    throw new TypeError(`Expected Collection, got ${isValueGroupArray(value) ? 'sequence' : value.type}`);
  }
  return value;
}

function listOf(value: ValueGroup): List {
  if (isValueGroupArray(value) || value.type !== 'List') {
    throw new TypeError(`Expected List, got ${isValueGroupArray(value) ? 'sequence' : value.type}`);
  }
  return value;
}

function boolOf(value: ValueGroup): Bool {
  if (isValueGroupArray(value) || value.type !== 'Bool') {
    throw new TypeError(`Expected Bool, got ${isValueGroupArray(value) ? 'sequence' : value.type}`);
  }
  return value;
}

function nullOf(value: ValueGroup): Null {
  if (isValueGroupArray(value) || value.type !== 'Null') {
    throw new TypeError(`Expected Null, got ${isValueGroupArray(value) ? 'sequence' : value.type}`);
  }
  return value;
}

describe('Sass map functions', () => {
  describe('get()', () => {
    it('gets value by key', () => {
      const map = createMap([['a', makeDimension(1)], ['b', makeDimension(2)]]);
      const result = sync(get(map, key('a')));
      expect(dimensionOf(result).number).toBe(1);
    });

    it('uses Sass value equality for keys', () => {
      const map = createMap([['a', makeDimension(1)]]);
      const result = sync(get(map, quoted('a')));
      expect(dimensionOf(result).number).toBe(1);
    });

    it('returns Null when key not found', () => {
      const map = createMap([['a', makeDimension(1)]]);
      expect(nullOf(sync(get(map, key('b'))))).toMatchObject({ type: 'Null' });
    });

    it('gets nested value', () => {
      const nestedMap = createMap([['b', makeDimension(2)]]);
      const map = makeCollection([{ key: key('a'), value: nestedMap }]);
      const result = sync(get(map, key('a'), key('b')));
      expect(dimensionOf(result).number).toBe(2);
    });

    it('returns Null for non-map intermediate value', () => {
      const map = createMap([['a', makeDimension(1)]]);
      expect(nullOf(sync(get(map, key('a'), key('b'))))).toMatchObject({ type: 'Null' });
    });

    it('works with object parameters', () => {
      const map = createMap([['a', makeDimension(1)]]);
      const result = sync(get({ map, key: key('a') }));
      expect(dimensionOf(result).number).toBe(1);
    });
  });

  describe('set()', () => {
    it('sets a new key-value pair', () => {
      const map = createMap([['a', makeDimension(1)]]);
      const result = collectionOf(sync(set(map, key('b'), makeDimension(2))));

      expect(dimensionOf(sync(get(result, key('a')))).number).toBe(1);
      expect(dimensionOf(sync(get(result, key('b')))).number).toBe(2);
    });

    it('overwrites existing key', () => {
      const map = createMap([['a', makeDimension(1)]]);
      const result = collectionOf(sync(set(map, quoted('a'), makeDimension(99))));
      expect(dimensionOf(sync(get(result, key('a')))).number).toBe(99);
      expect(result.entries).toHaveLength(1);
    });

    it('preserves original map', () => {
      const map = createMap([['a', makeDimension(1)]]);
      const result = collectionOf(sync(set(map, key('b'), makeDimension(2))));

      expect(dimensionOf(sync(get(map, key('a')))).number).toBe(1);
      expect(nullOf(sync(get(map, key('b'))))).toMatchObject({ type: 'Null' });
      expect(dimensionOf(sync(get(result, key('b')))).number).toBe(2);
    });
  });

  describe('merge()', () => {
    it('merges two maps', () => {
      const map1 = createMap([['a', makeDimension(1)]]);
      const map2 = createMap([['b', makeDimension(2)]]);
      const result = collectionOf(sync(merge(map1, map2)));
      expect(dimensionOf(sync(get(result, key('a')))).number).toBe(1);
      expect(dimensionOf(sync(get(result, key('b')))).number).toBe(2);
    });

    it('overwrites keys from map2', () => {
      const map1 = createMap([['a', makeDimension(1)], ['b', makeDimension(10)]]);
      const map2 = createMap([['b', makeDimension(2)]]);
      const result = collectionOf(sync(merge(map1, map2)));
      expect(dimensionOf(sync(get(result, key('b')))).number).toBe(2);
    });
  });

  describe('deep-merge()', () => {
    it('recursively merges nested maps without mutating either input', () => {
      const colors = createMap([['primary', key('blue')], ['secondary', key('grey')]]);
      const defaults = makeCollection([{ key: key('colors'), value: colors }, { key: key('space'), value: makeDimension(4) }]);
      const overrideColors = createMap([['primary', key('teal')]]);
      const overrides = makeCollection([{ key: key('colors'), value: overrideColors }]);

      const result = collectionOf(sync(deepMerge(defaults, overrides)));
      const resultColors = collectionOf(sync(get(result, key('colors'))));

      expect(sync(get(resultColors, key('primary')))).toEqual(key('teal'));
      expect(sync(get(resultColors, key('secondary')))).toEqual(key('grey'));
      expect(dimensionOf(sync(get(result, key('space')))).number).toBe(4);
      expect(sync(get(collectionOf(sync(get(defaults, key('colors')))), key('primary')))).toEqual(key('blue'));
      expect(result.entries.map(entry => entry.key)).toEqual([key('colors'), key('space')]);
    });

    it('replaces collisions when only one side is a map', () => {
      const nested = createMap([['a', makeDimension(1)]]);
      const leftMap = makeCollection([{ key: key('value'), value: nested }]);
      const rightScalar = makeCollection([{ key: key('value'), value: makeDimension(2) }]);
      const leftScalar = makeCollection([{ key: key('value'), value: makeDimension(2) }]);
      const rightMap = makeCollection([{ key: key('value'), value: nested }]);

      expect(dimensionOf(sync(get(collectionOf(sync(deepMerge(leftMap, rightScalar))), key('value')))).number).toBe(2);
      expect(collectionOf(sync(get(collectionOf(sync(deepMerge(leftScalar, rightMap))), key('value')))).entries).toHaveLength(1);
    });
  });

  describe('remove()', () => {
    it('removes a key', () => {
      const map = createMap([['a', makeDimension(1)], ['b', makeDimension(2)]]);
      const result = collectionOf(sync(remove(map, key('a'))));
      expect(nullOf(sync(get(result, key('a'))))).toMatchObject({ type: 'Null' });
      expect(dimensionOf(sync(get(result, key('b')))).number).toBe(2);
    });

    it('removes multiple keys', () => {
      const map = createMap([['a', makeDimension(1)], ['b', makeDimension(2)], ['c', makeDimension(3)]]);
      const result = collectionOf(sync(remove(map, key('a'), quoted('b'))));
      expect(nullOf(sync(get(result, key('a'))))).toMatchObject({ type: 'Null' });
      expect(nullOf(sync(get(result, key('b'))))).toMatchObject({ type: 'Null' });
      expect(dimensionOf(sync(get(result, key('c')))).number).toBe(3);
    });

    it('returns map as-is when no keys provided', () => {
      const map = createMap([['a', makeDimension(1)]]);
      expect(sync(remove(map))).toBe(map);
    });
  });

  describe('keys()', () => {
    it('returns list of all keys', () => {
      const map = createMap([['a', makeDimension(1)], ['b', makeDimension(2)]]);
      const result = listOf(sync(keys(map)));
      expect(result.value).toEqual([key('a'), key('b')]);
    });

    it('returns empty list for empty map', () => {
      const map = createMap([]);
      expect(listOf(sync(keys(map))).value).toHaveLength(0);
    });
  });

  describe('values()', () => {
    it('returns list of all values', () => {
      const map = createMap([['a', makeDimension(1)], ['b', makeDimension(2)]]);
      const result = listOf(sync(values(map)));
      expect(result.value).toHaveLength(2);
      expect(dimensionOf(result.value[0]!).number).toBe(1);
      expect(dimensionOf(result.value[1]!).number).toBe(2);
    });

    it('returns empty list for empty map', () => {
      const map = createMap([]);
      expect(listOf(sync(values(map))).value).toHaveLength(0);
    });
  });

  describe('has-key()', () => {
    it('returns true when key exists', () => {
      const map = createMap([['a', makeDimension(1)]]);
      expect(boolOf(sync(hasKey(map, quoted('a')))).value).toBe(true);
    });

    it('returns false when key does not exist', () => {
      const map = createMap([['a', makeDimension(1)]]);
      expect(boolOf(sync(hasKey(map, key('b')))).value).toBe(false);
    });

    it('checks nested keys', () => {
      const nestedMap = createMap([['b', makeDimension(2)]]);
      const map = makeCollection([{ key: key('a'), value: nestedMap }]);
      expect(boolOf(sync(hasKey(map, key('a'), quoted('b')))).value).toBe(true);
    });

    it('returns false for non-map intermediate value', () => {
      const map = createMap([['a', makeDimension(1)]]);
      expect(boolOf(sync(hasKey(map, key('a'), key('b')))).value).toBe(false);
    });
  });
});
