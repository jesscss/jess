import { describe, expect, it } from 'vitest';
import { buildEvaluator } from '../evaluator.js';
import {
  collection, decl, dimension, funcCall, keyword, quoted,
  rule, stylesheet, variableDeclaration, variableReference, type Stylesheet
} from '../nodes.js';
import { serialize } from '../serialize.js';
import { collectionEntries, collectionKeyIndex, isCollection, makeCollection } from '../../value.js';
import { compare } from '../value-guards.js';
import { makeSassRegistry } from '@jesscss/fns';

const evaluator = buildEvaluator(makeSassRegistry());
const render = (document: Stylesheet): string | undefined => serialize(document, { evaluator }).css;

/**
 * The DATA half of the two-role Collection model: a Collection reaching a
 * value/arg position evaluates to the VALUE-DOMAIN map, not to the bytes it
 * renders to. Before this existed the map arrived at a function as one opaque
 * sniffed `Keyword`, so no map function could be written against it and any that
 * tried would have had to re-derive structure from bytes.
 */
describe('Collection as a value-domain map', () => {
  const map = (): ReturnType<typeof collection> => collection([
    decl('a', dimension(1)),
    decl('b', dimension(2))
  ]);

  /**
   * The runtime proof from the blocker report, now matching dart-sass:
   * `$m: (a: 1, b: 2)` gives `length($m)` → 2 and `nth($m, 1)` → `a 1`.
   * A map IS a list of its pairs, so the stock list functions read it with no
   * map-specific branch — this is what `groupItems` yielding `[key, value]`
   * groups buys. Previously: 1 and `{ a: 1; b: 2 }`.
   */
  it('is a list of its pairs for the sass list functions', () => {
    const document = stylesheet([
      variableDeclaration('m', map(), { mode: 'declare' }),
      rule('.x', [
        decl('p', funcCall('length', [variableReference('m', 'scoped')])),
        decl('q', funcCall('nth', [variableReference('m', 'scoped'), dimension(1)]))
      ])
    ]);

    expect(render(document)).toBe('.x {\n  p: 2;\n  q: a 1;\n}\n');
  });

  it('indexes the last pair and rejects an out-of-range index', () => {
    const document = stylesheet([
      rule('.x', [decl('q', funcCall('nth', [map(), dimension(2)]))])
    ]);

    expect(render(document)).toBe('.x {\n  q: b 2;\n}\n');
  });

  /** An entry VALUE stays typed, so a nested map does not collapse to bytes. */
  it('keeps a nested map a map', () => {
    const nested = collection([decl('a', collection([decl('c', dimension(3))]))]);
    const document = stylesheet([
      rule('.x', [decl('p', funcCall('length', [funcCall('nth', [nested, dimension(1)])]))])
    ]);

    // `nth(…, 1)` is the pair `a { c: 3 }` — two items, not the inner map's one.
    expect(render(document)).toBe('.x {\n  p: 2;\n}\n');
  });

  /**
   * The key is a VALUE, recovered even though the parser lowers a map key to an
   * entry NAME. A numeric key must be a Dimension or `map.get($m, 1)` can never
   * hit it.
   */
  it('materializes keys as values, not as name strings', () => {
    const built = makeCollection([
      { key: { type: 'Keyword', text: 'a', bytes: 'a' }, value: { type: 'Dimension', number: 1, unit: '', bytes: '1' } }
    ]);
    expect(isCollection(built)).toBe(true);
    expect(collectionEntries(built)).toHaveLength(1);

    const document = stylesheet([
      rule('.x', [decl('q', funcCall('nth', [collection([decl('1', keyword('v'))]), dimension(1)]))])
    ]);
    expect(render(document)).toBe('.x {\n  q: 1 v;\n}\n');
  });

  /** Key identity is VALUE equality — the primitive every map function builds on. */
  it('finds an entry by value-equal key, including across quoting', () => {
    const built = makeCollection([
      { key: { type: 'Keyword', text: 'a', bytes: 'a' }, value: { type: 'Dimension', number: 1, unit: '', bytes: '1' } },
      { key: { type: 'Dimension', number: 2, unit: '', bytes: '2' }, value: { type: 'Keyword', text: 'v', bytes: 'v' } }
    ]);

    expect(collectionKeyIndex(built, { type: 'Keyword', text: 'a', bytes: 'a' })).toBe(0);
    // Sass string equality ignores quoting, so `"a"` finds the `a` entry.
    expect(collectionKeyIndex(built, { type: 'Quoted', value: 'a', quote: '"', escaped: false, bytes: '"a"' })).toBe(0);
    expect(collectionKeyIndex(built, { type: 'Dimension', number: 2, unit: '', bytes: '2' })).toBe(1);
    expect(collectionKeyIndex(built, { type: 'Keyword', text: 'zz', bytes: 'zz' })).toBe(-1);
    expect(collectionKeyIndex([], { type: 'Keyword', text: 'a', bytes: 'a' })).toBe(-1);
  });

  /** Order is not part of map identity, even though entries stay ordered. */
  it('compares two maps by pairs, not by order or bytes', () => {
    const one = { type: 'Keyword' as const, text: 'a', bytes: 'a' };
    const two = { type: 'Keyword' as const, text: 'b', bytes: 'b' };
    const v1 = { type: 'Dimension' as const, number: 1, unit: '', bytes: '1' };
    const v2 = { type: 'Dimension' as const, number: 2, unit: '', bytes: '2' };
    const ab = makeCollection([{ key: one, value: v1 }, { key: two, value: v2 }]);
    const ba = makeCollection([{ key: two, value: v2 }, { key: one, value: v1 }]);

    expect(ab.bytes).not.toBe(ba.bytes);
    expect(compare('=', ab, ba, 'sass')).toBe(true);
    expect(compare('=', ab, makeCollection([{ key: one, value: v1 }]), 'sass')).toBe(false);
    expect(compare('=', ab, makeCollection([{ key: one, value: v1 }, { key: two, value: v1 }]), 'sass')).toBe(false);
  });

  /**
   * The map's own bytes stay the canonical Jess collection spelling, so nothing
   * that consumed the byte form moves. A member emits its OWN bytes — a
   * container must not re-run the number policy over a value it merely holds.
   */
  it('keeps the canonical byte form, preserving un-operated member spelling', () => {
    expect(makeCollection([]).bytes).toBe('{}');
    expect(makeCollection([
      { key: { type: 'Keyword', text: 'a', bytes: 'a' }, value: { type: 'Dimension', number: 1, unit: 'px', bytes: '1.0px' } }
    ]).bytes).toBe('{ a: 1.0px }');
    expect(makeCollection([
      { key: { type: 'Keyword', text: 'a', bytes: 'a' }, value: { type: 'Dimension', number: 1, unit: '', bytes: '1' }, variable: true },
      { key: { type: 'Keyword', text: 'b', bytes: 'b' }, value: { type: 'Dimension', number: 2, unit: '', bytes: '2' }, important: true }
    ]).bytes).toBe('{ @a: 1; b: 2 !important }');
  });

  /** A quoted entry value keeps its quotes through the map. */
  it('carries a quoted entry value verbatim', () => {
    const document = stylesheet([
      rule('.x', [decl('q', funcCall('nth', [collection([decl('a', quoted('"s"'))]), dimension(1)]))])
    ]);
    expect(render(document)).toBe('.x {\n  q: a "s";\n}\n');
  });
});
