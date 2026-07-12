import { BitSetLibrary, isSubsetOf } from '../bitset.js';
import { compound, el, sel, pseudo, co, num, type ComplexSelector } from '../../index.js';
import { Context } from '../../../context.js';

describe('BitSet', () => {
  it('can create a basic selector bitset', () => {
    let library = new BitSetLibrary(['.foo', '.bar']);
    expect(library.size).toBe(2);
    let bitset = library.getBitset();
    /** No bits are set */
    expect(bitset.isEmpty()).toBe(true);
  });

  it('won\'t expand size with existing values', () => {
    let library = new BitSetLibrary(['.foo', '.bar']);
    library.add('.foo');
    expect(library.size).toBe(2);
    library.add('.baz');
    expect(library.size).toBe(3);
  });

  it('can make bitset from iterable', () => {
    let library = new BitSetLibrary();
    let bitset = library.getBitset(['.foo', '.baz']);
    expect(bitset.cardinality()).toBe(2);
    expect(bitset.get(0)).toBe(1);
    expect(bitset.get(1)).toBe(1);
  });

  it('can get bitset from iterable', () => {
    let library = new BitSetLibrary(['.foo', '.baz']);
    let bitset = library.getBitset(['.foo', '.baz']);
    expect(bitset.cardinality()).toBe(2);
    expect(bitset.get(0)).toBe(1);
    expect(bitset.get(1)).toBe(1);
  });

  it('can calculate the union of two bitsets', () => {
    let library = new BitSetLibrary(['.foo', '.baz']);
    let bitset1 = library.getBitset(['.foo', '.baz']);
    let bitset2 = library.getBitset(['.bar', '.baz']);
    let union = bitset1.or(bitset2);
    expect(union.cardinality()).toBe(3);
    expect(union.get(0)).toBe(1);
    expect(union.get(1)).toBe(1);
    expect(union.get(2)).toBe(1);
  });

  it('will throw an error if bitsets are from different libraries', () => {
    let library1 = new BitSetLibrary(['.foo', '.baz']);
    let library2 = new BitSetLibrary(['.bar', '.baz']);
    let bitset1 = library1.getBitset(['.foo', '.baz']);
    let bitset2 = library2.getBitset(['.bar', '.baz']);
    expect(() => isSubsetOf(bitset1, bitset2)).toThrow('Bitsets must be from the same library');
  });

  it('is a subset of itself', () => {
    let library = new BitSetLibrary(['.foo', '.baz']);
    let bitset = library.getBitset(['.foo', '.baz']);
    expect(isSubsetOf(bitset, bitset)).toBe(true);
  });

  it('is a subset of a larger bitset', () => {
    let library = new BitSetLibrary(['.foo', '.baz']);
    let bitset1 = library.getBitset(['.foo', '.baz']);
    let bitset2 = library.getBitset(['.foo', '.baz', '.bar']);
    expect(isSubsetOf(bitset1, bitset2)).toBe(true);
  });
});

describe('BitSets and selectors', () => {
  let context: Context;
  beforeEach(() => {
    context = new Context();
  });

  it('can create a bitset from a selector', async () => {
    let selector = el('.foo');
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['.foo']))).toBe(true);
    expect(selector.visibleKeySet.equals(context.selectorBits.getBitset(['.foo']))).toBe(true);
  });

  it('bubbles selectors into compound keysets', async () => {
    let selector = compound([el('.foo'), el('.bar')]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['.foo', '.bar']))).toBe(true);
    expect(selector.visibleKeySet.equals(context.selectorBits.getBitset(['.foo', '.bar']))).toBe(true);
  });

  it('bubbles selectors into complex keysets #1', async () => {
    let selector = sel([el('.foo'), co(' '), el('.bar')]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['.foo', ' ', '.bar']))).toBe(true);
    expect(selector.visibleKeySet.equals(context.selectorBits.getBitset(['.foo', ' ', '.bar']))).toBe(true);
  });

  it('bubbles selectors into complex keysets #2', async () => {
    let selector = sel([compound([el('a'), el('.foo')]), co(' '), el('.bar')]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['a', '.foo', ' ', '.bar']))).toBe(true);
    expect(selector.visibleKeySet.equals(context.selectorBits.getBitset(['a', '.foo', ' ', '.bar']))).toBe(true);
  });

  it('bubbles selectors into complex keysets #3', async () => {
    let selector = sel([compound([el('a'), el('.foo')]), co('>'), el('.bar'), co('+'), el('.baz')]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['a', '.foo', '>', '.bar', '+', '.baz']))).toBe(true);
    expect(selector.visibleKeySet.equals(context.selectorBits.getBitset(['a', '.foo', '>', '.bar', '+', '.baz']))).toBe(true);
  });

  it('calculates subset keysets of complex selectors', async () => {
    let sel1 = sel([compound([el('a'), el('.foo')]), co('>'), el('.bar'), co('+'), el('.baz')]);
    let sel2 = sel([el('.foo'), co('>'), el('.bar'), co('+'), el('.baz')]);
    let evald1 = await sel1.eval(context) as ComplexSelector;
    let evald2 = await sel2.eval(context) as ComplexSelector;
    expect(isSubsetOf(evald2.keySet, evald1.keySet)).toBe(true);
    /** Larger one doesn't fit into smaller */
    expect(isSubsetOf(evald1.keySet, evald2.keySet)).toBe(false);
  });

  test(':is doesn\'t get added to keyset', async () => {
    let selector = sel([pseudo({ name: ':is', arg: el('.foo') })]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['.foo']))).toBe(true);
    expect(selector.visibleKeySet.equals(context.selectorBits.getBitset(['.foo']))).toBe(true);
  });

  test('other pseudo selectors get added to keyset', async () => {
    let selector = sel([pseudo({ name: ':not', arg: el('.foo') })]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['.foo', ':not']))).toBe(true);
    expect(selector.visibleKeySet.equals(context.selectorBits.getBitset(['.foo', ':not']))).toBe(true);
  });

  test('nth selectors', async () => {
    let sel = pseudo({ name: ':nth-child', arg: num(1) });
    await sel.eval(context);
    expect(sel.keySet.equals(context.selectorBits.getBitset([':nth-child(1)']))).toBe(true);
    expect(sel.visibleKeySet.equals(context.selectorBits.getBitset([':nth-child(1)']))).toBe(true);
  });
});
