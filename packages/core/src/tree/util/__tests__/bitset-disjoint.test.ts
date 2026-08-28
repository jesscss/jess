import { describe, expect, it } from 'vitest';
import { el } from '../../index.js';
import { Context } from '../../../context.js';
import { BitSetLibrary, isDisjoint } from '../../../util/bitset.js';
import { extendSelector } from '../extend.js';
import { findExtendableLocations } from '../find-extendable-locations.js';

describe('isDisjoint', () => {
  it('scans ordinary numeric words directly without mutating either input', () => {
    const keys = Array.from({ length: 97 }, (_, index) => `.key-${index}`);
    const library = new BitSetLibrary(keys);
    const a = library.getBitset(['.key-0', '.key-31', '.key-64']);
    const b = library.getBitset(['.key-1', '.key-32', '.key-65']);
    const shared = library.getBitset(['.key-31']);
    const beforeA = [...a.data];
    const beforeB = [...b.data];

    expect(isDisjoint(a, b)).toBe(true);
    expect(isDisjoint(a, shared)).toBe(false);
    expect(isDisjoint(library.getBitset(['.key-31']), library.getBitset(['.key-32']))).toBe(true);
    expect(isDisjoint(library.getBitset(['.key-32']), library.getBitset(['.key-32']))).toBe(false);
    expect(a.data).toEqual(beforeA);
    expect(b.data).toEqual(beforeB);
  });

  it('falls back to the existing allocating intersection for inverted or incompatible backing data', () => {
    const library = new BitSetLibrary(['.a', '.b']);
    const ordinary = library.getBitset(['.a']);
    const inverted = library.getBitset(['.b']).not();

    expect(isDisjoint(ordinary, inverted)).toBe(false);

    const typed = library.getBitset(['.a']);
    Object.defineProperty(typed, 'data', { value: new Int32Array(typed.data) });

    expect(isDisjoint(typed, ordinary)).toBe(true);
    expect(typed.data).toBeInstanceOf(Int32Array);
  });

  it('preserves ordinary fast-rejection behavior in both extend callers', async () => {
    const context = new Context();
    const target = el('.target');
    const find = el('.find');
    const extendWith = el('.extend-with');
    await target.eval(context);
    await find.eval(context);

    expect(findExtendableLocations(target, find).hasMatches).toBe(false);
    expect(extendSelector(target, find, extendWith, true)).toBe('NOT_FOUND');
  });
});
