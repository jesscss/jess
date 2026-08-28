import { describe, expect, it } from 'vitest';
import { makeCollection, makeDimension, makeKeyword, makeList, serializeValue, type ValueGroup } from '@jesscss/core';
import * as sassGlobals from '../index.js';
import { sassFns } from '../registry.js';
import * as listModule from '../list/index.js';
import * as mapModule from '../map/index.js';

/**
 * The deprecated Sass GLOBALS whose name differs from the module member name.
 *
 * A registry keys on `fn.name`, so a global spelling needs its own callable —
 * exporting the module member from the global index registers the MODULE name
 * and leaves the global unreachable. These assertions pin both halves: the
 * global name is registered, the module member name is NOT registered as a
 * global, and the delegator produces exactly what the module body produces.
 *
 * Global name list: `spec/core_functions/{map,list}` in sass-spec, mirrored in
 * `sass/FUNCTION_CATALOG.md`. `map.set` and the `map.deep-*` members are absent
 * on purpose — dart-sass never gave them a global spelling.
 */

const globalNames = sassFns.map(fn => fn.name);

const nested = makeCollection([{ key: makeKeyword('c'), value: makeDimension(3) }]);
const map = makeCollection([
  { key: makeKeyword('a'), value: makeDimension(1) },
  { key: makeKeyword('b'), value: nested }
]);
const commaList = makeList([makeDimension(1), makeDimension(2)], ',');

function sync(value: unknown): ValueGroup {
  if (value instanceof Promise) {
    throw new TypeError('Expected a synchronous Sass result.');
  }
  return value as ValueGroup;
}

const bytes = (value: unknown): string => serializeValue(sync(value));

describe('sass globals — renamed map members', () => {
  it('registers the `map-` prefixed global names', () => {
    for (const name of ['map-get', 'map-has-key', 'map-keys', 'map-values', 'map-merge', 'map-remove']) {
      expect(globalNames).toContain(name);
    }
  });

  it('does not register a module member name as a bare global', () => {
    for (const name of ['get', 'has-key', 'keys', 'values', 'merge', 'remove', 'set']) {
      expect(globalNames).not.toContain(name);
    }
  });

  it('delegates to the module body, including the rest parameter', () => {
    expect(bytes(sassGlobals.mapGet(map, makeKeyword('a')))).toBe(bytes(mapModule.get(map, makeKeyword('a'))));
    expect(bytes(sassGlobals.mapGet(map, makeKeyword('b'), makeKeyword('c')))).toBe('3');
    expect(bytes(sassGlobals.mapHasKey(map, makeKeyword('b'), makeKeyword('c')))).toBe('true');
    expect(bytes(sassGlobals.mapKeys(map))).toBe(bytes(mapModule.keys(map)));
    expect(bytes(sassGlobals.mapValues(map))).toBe(bytes(mapModule.values(map)));
    expect(bytes(sassGlobals.mapRemove(map, makeKeyword('a'), makeKeyword('b')))).toBe(bytes(mapModule.remove(map, makeKeyword('a'), makeKeyword('b'))));
    expect(bytes(sassGlobals.mapMerge(map, nested))).toBe(bytes(mapModule.merge(map, nested)));
  });
});

describe('sass globals — renamed list member', () => {
  it('registers `list-separator`, not the bare module name `separator`', () => {
    expect(globalNames).toContain('list-separator');
    expect(globalNames).not.toContain('separator');
  });

  it('keeps the eight list members whose global name is unchanged', () => {
    for (const name of ['length', 'nth', 'index', 'is-bracketed', 'set-nth', 'join', 'append', 'zip']) {
      expect(globalNames).toContain(name);
    }
  });

  it('delegates to the module body', () => {
    expect(bytes(sassGlobals.listSeparator(commaList))).toBe(bytes(listModule.separator(commaList)));
    expect(bytes(sassGlobals.listSeparator(commaList))).toBe('comma');
  });
});
