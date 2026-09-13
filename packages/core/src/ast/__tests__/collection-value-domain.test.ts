import { describe, expect, it } from 'vitest';
import { buildEvaluator } from '../evaluator.js';
import {
  collection, collectionEntry, decl, dimension, funcCall, keyword, quoted,
  rule, stylesheet, variableDeclaration, variableReference, type Stylesheet
} from '../nodes.js';
import { serialize } from '../serialize.js';
import {
  CollectionOverlay,
  HEX,
  collectionEntries,
  collectionKeyIndex,
  isCollection,
  makeCollection,
  makeAny,
  makeColorRgb,
  makeKeyword,
  makeList,
  makeQuoted,
  type Keyword,
  type ValueGroup
} from '../../value.js';
import { compare, writeSassEqualityCandidatePlan, SASS_EQUAL } from '../value-guards.js';
import { createFnRegistry, defineFunction } from '../value-dispatch.js';
import { makeSassRegistry } from '@jesscss/fns';

const evaluator = buildEvaluator(makeSassRegistry());
const render = (document: Stylesheet): string | undefined => serialize(document, { evaluator }).css;
const entry = (name: string, value: Parameters<typeof collectionEntry>[1]): ReturnType<typeof collectionEntry> =>
  collectionEntry(keyword(name), value);

/**
 * A Collection reaching value/argument position evaluates to the VALUE-DOMAIN
 * map, not to the bytes it renders to. Before this existed the map arrived at a
 * function as one opaque sniffed `Keyword`, so no map function could be written
 * against it and any that tried would have had to re-derive structure from
 * bytes.
 */
describe('Collection as a value-domain map', () => {
  const map = (): ReturnType<typeof collection> => collection([
    entry('a', dimension(1)),
    entry('b', dimension(2))
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
    const nested = collection([entry('a', collection([entry('c', dimension(3))]))]);
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
      rule('.x', [decl('q', funcCall('nth', [collection([entry('1', keyword('v'))]), dimension(1)]))])
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

  it('preserves first-match replacement for cross-kind, non-transitive keys', () => {
    type Marked = { readonly key: ValueGroup; readonly marker: string };
    const quotedRed = makeQuoted('red', '"', false);
    const keywordRed = makeKeyword('red');
    const colorRed = makeColorRgb([255, 0, 0], 1, HEX, { src: '#ff0000' });
    const quotedFirst = new CollectionOverlay<Marked>();
    quotedFirst.set(quotedRed, { key: quotedRed, marker: 'quoted' });
    quotedFirst.set(colorRed, { key: colorRed, marker: 'color' });
    quotedFirst.set(keywordRed, { key: keywordRed, marker: 'incoming' });
    expect(quotedFirst.items.map(item => item.marker)).toEqual(['incoming', 'color']);

    const colorFirst = new CollectionOverlay<Marked>();
    colorFirst.set(colorRed, { key: colorRed, marker: 'color' });
    colorFirst.set(quotedRed, { key: quotedRed, marker: 'quoted' });
    colorFirst.set(keywordRed, { key: keywordRed, marker: 'incoming' });
    expect(colorFirst.items.map(item => item.marker)).toEqual(['incoming', 'quoted']);
  });

  it('indexes identifier-only overlays instead of rescanning prior entries', () => {
    let typeReads = 0;
    const overlay = new CollectionOverlay<Keyword>();
    for (let index = 0; index < 10_000; index += 1) {
      const text = `token-${index}`;
      const key: Keyword = {
        get type(): 'Keyword' {
          typeReads += 1;
          return 'Keyword';
        },
        text,
        bytes: text
      };
      overlay.set(key, key);
    }

    expect(overlay.items).toHaveLength(10_000);
    expect(typeReads).toBeLessThanOrEqual(50_000);
  });

  it('evaluates a computed key before its value, exactly once each', () => {
    const calls: string[] = [];
    const registry = createFnRegistry();
    registry.register(defineFunction('next-key', {
      params: [],
      body: () => {
        calls.push('key');
        return makeKeyword('computed');
      }
    }));
    registry.register(defineFunction('next-value', {
      params: [],
      body: () => {
        calls.push('value');
        return makeKeyword('resolved');
      }
    }));
    const document = stylesheet([
      rule('.x', [
        decl('q', collection([
          collectionEntry(funcCall('next-key', []), funcCall('next-value', []))
        ]))
      ])
    ]);

    expect(serialize(document, { evaluator: buildEvaluator(registry) }).css)
      .toBe('.x {\n  q: { computed: resolved };\n}\n');
    expect(calls).toEqual(['key', 'value']);
  });

  it('indexes quoted overlays instead of rescanning prior entries', () => {
    let typeReads = 0;
    const overlay = new CollectionOverlay<ReturnType<typeof makeQuoted>>();
    for (let index = 0; index < 10_000; index += 1) {
      const text = `token-${index}`;
      const key: ReturnType<typeof makeQuoted> = {
        get type(): 'Quoted' {
          typeReads += 1;
          return 'Quoted';
        },
        value: text,
        quote: '"',
        escaped: false,
        bytes: `"${text}"`
      };
      overlay.set(key, key);
    }

    expect(overlay.items).toHaveLength(10_000);
    expect(typeReads).toBeLessThan(100_000);
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
    expect(compare(SASS_EQUAL, ab, ba)).toBe(true);
    expect(compare(SASS_EQUAL, ab, makeCollection([{ key: one, value: v1 }]))).toBe(false);
    expect(compare(SASS_EQUAL, ab, makeCollection([{ key: one, value: v1 }, { key: two, value: v1 }]))).toBe(false);

    const overlay = new CollectionOverlay<string>();
    overlay.set(ab, 'first');
    expect(overlay.get(ba)).toBe('first');
    overlay.set(ba, 'second');
    expect(overlay.items).toEqual(['second']);
  });

  it('keeps Sass numeric equality unit-strict recursively', () => {
    const unitless = { type: 'Dimension' as const, number: 1, unit: '', bytes: '1' };
    const dimensioned = { type: 'Dimension' as const, number: 1, unit: 'px', bytes: '1px' };
    const unitlessList = makeList([unitless], ',');
    const dimensionedList = makeList([dimensioned], ',');
    expect(compare(SASS_EQUAL, unitless, dimensioned)).toBe(false);
    expect(compare(SASS_EQUAL, unitlessList, dimensionedList)).toBe(false);
    expect(compare(SASS_EQUAL, dimensionedList, unitlessList)).toBe(false);

    const key = makeKeyword('nested');
    const unitlessMap = makeCollection([{ key, value: unitless }]);
    const dimensionedMap = makeCollection([{ key, value: dimensioned }]);
    expect(compare(SASS_EQUAL, unitlessMap, dimensionedMap)).toBe(false);
    expect(compare(SASS_EQUAL, dimensionedMap, unitlessMap)).toBe(false);

    const marker = makeKeyword('value');
    const unitlessKeyMap = makeCollection([{ key: unitlessList, value: marker }]);
    const dimensionedKeyMap = makeCollection([{ key: dimensionedList, value: marker }]);
    expect(compare(SASS_EQUAL, unitlessKeyMap, dimensionedKeyMap)).toBe(false);
    expect(compare(SASS_EQUAL, dimensionedKeyMap, unitlessKeyMap)).toBe(false);

    const unitlessFirst = new CollectionOverlay<string>();
    unitlessFirst.set(unitlessKeyMap, 'unitless');
    unitlessFirst.set(makeKeyword('filler'), 'filler');
    expect(unitlessFirst.get(dimensionedKeyMap)).toBeUndefined();
    const dimensionedFirst = new CollectionOverlay<string>();
    dimensionedFirst.set(dimensionedKeyMap, 'dimensioned');
    dimensionedFirst.set(makeKeyword('filler'), 'filler');
    expect(dimensionedFirst.get(unitlessKeyMap)).toBeUndefined();

    const oneInch = { type: 'Dimension' as const, number: 1, unit: 'in', bytes: '1in' };
    const ninetySixPixels = {
      type: 'Dimension' as const, number: 96, unit: 'px', bytes: '96px'
    };
    expect(compare(SASS_EQUAL, oneInch, ninetySixPixels)).toBe(true);
    expect(compare(SASS_EQUAL, makeList([oneInch], ','), makeList([ninetySixPixels], ','))).toBe(true);
  });

  it('keeps string-ground equality reachable for structural keys in either insertion order', () => {
    const listValue = makeList([makeKeyword('a'), makeKeyword('b')]);
    const listText = makeQuoted('a, b', '"', false);
    const mapValue = makeCollection([{ key: makeKeyword('a'), value: {
      type: 'Dimension', number: 1, unit: '', bytes: '1'
    } }]);
    const mapText = makeAny('{ a: 1 }');
    for (const [structured, text] of [[listValue, listText], [mapValue, mapText]] as const) {
      expect(compare(SASS_EQUAL, structured, text)).toBe(true);
      const structuredFirst = new CollectionOverlay<string>();
      structuredFirst.set(structured, 'structured');
      expect(structuredFirst.get(text)).toBe('structured');
      const textFirst = new CollectionOverlay<string>();
      textFirst.set(text, 'text');
      expect(textFirst.get(structured)).toBe('text');
    }
  });

  it('keeps nested structural-to-string pair equality reachable in either insertion order', () => {
    const marker = makeKeyword('value');
    const list = makeList([makeKeyword('a'), makeKeyword('b')]);
    const quotedList = makeQuoted('a, b', '"', false);
    const nestedMap = makeCollection([{
      key: makeKeyword('a'),
      value: { type: 'Dimension', number: 1, unit: '', bytes: '1' }
    }]);
    const opaqueMap = makeAny('{ a: 1 }');

    for (const [structured, text] of [[list, quotedList], [nestedMap, opaqueMap]] as const) {
      const structuredOuter = makeCollection([{ key: structured, value: marker }]);
      const textOuter = makeCollection([{ key: text, value: marker }]);
      const distractor = structured.type === 'List'
        ? makeList([makeKeyword('a'), makeKeyword('c')])
        : makeCollection([{
            key: makeKeyword('a'),
            value: { type: 'Dimension', number: 2, unit: '', bytes: '2' }
          }]);
      const distractorOuter = makeCollection([{ key: distractor, value: marker }]);
      expect(compare(SASS_EQUAL, structuredOuter, textOuter)).toBe(true);

      const structuredFirst = new CollectionOverlay<string>();
      structuredFirst.set(structuredOuter, 'structured');
      structuredFirst.set(distractorOuter, 'distractor');
      expect(structuredFirst.get(textOuter)).toBe('structured');

      const textFirst = new CollectionOverlay<string>();
      textFirst.set(textOuter, 'text');
      textFirst.set(distractorOuter, 'distractor');
      expect(textFirst.get(structuredOuter)).toBe('text');
    }
  });

  it('keeps deeply nested candidate signatures linear in nesting depth', () => {
    const signatureSize = (depth: number): number => {
      let value: ValueGroup = makeKeyword('leaf');
      for (let index = 0; index < depth; index += 1) {
        value = makeList([value]);
      }
      const signatures: string[] = [];
      const groupEnds: number[] = [];
      const fallbackSignatures: string[] = [];
      writeSassEqualityCandidatePlan(value, signatures, groupEnds, fallbackSignatures);
      let size = 0;
      for (let index = 0; index < signatures.length; index += 1) {
        size += signatures[index]!.length;
      }
      for (let index = 0; index < fallbackSignatures.length; index += 1) {
        size += fallbackSignatures[index]!.length;
      }
      return size;
    };

    const at100 = signatureSize(100);
    const at200 = signatureSize(200);
    expect(at200).toBeLessThan(at100 * 2.5);
  });

  it('matches the authoritative comparator for duplicate and non-transitive nested map keys', () => {
    const a = makeKeyword('a');
    const b = makeKeyword('b');
    const one = { type: 'Dimension' as const, number: 1, unit: '', bytes: '1' };
    const two = { type: 'Dimension' as const, number: 2, unit: '', bytes: '2' };
    const duplicate = makeCollection([{ key: a, value: one }, { key: a, value: one }]);
    const distinct = makeCollection([{ key: a, value: one }, { key: b, value: two }]);
    const overlay = new CollectionOverlay<string>();
    overlay.set(duplicate, 'duplicate');
    expect(overlay.get(distinct) !== undefined).toBe(compare(SASS_EQUAL, duplicate, distinct));
    expect(compare(SASS_EQUAL, duplicate, distinct)).toBe(false);
    expect(compare(SASS_EQUAL, distinct, duplicate)).toBe(false);

    const quotedRed = makeQuoted('red', '"', false);
    const keywordRed = makeKeyword('red');
    const colorRed = makeColorRgb([255, 0, 0], 1, HEX, { src: '#ff0000' });
    const blue = makeKeyword('blue');
    const left = makeCollection([
      { key: quotedRed, value: a },
      { key: colorRed, value: a }
    ]);
    const right = makeCollection([
      { key: keywordRed, value: a },
      { key: blue, value: b }
    ]);
    const nonTransitive = new CollectionOverlay<string>();
    nonTransitive.set(left, 'left');
    expect(nonTransitive.get(right) !== undefined).toBe(compare(SASS_EQUAL, left, right));

    const augmentLeft = makeCollection([
      { key: colorRed, value: a },
      { key: quotedRed, value: a }
    ]);
    const augmentRight = makeCollection([
      { key: keywordRed, value: a },
      { key: colorRed, value: a }
    ]);
    expect(compare(SASS_EQUAL, augmentLeft, augmentRight)).toBe(true);
    expect(compare(SASS_EQUAL, augmentRight, augmentLeft)).toBe(true);
  });

  it('indexes structurally unique list keys without rescanning every prior key', () => {
    let typeReads = 0;
    const overlay = new CollectionOverlay<Keyword>();
    for (let index = 0; index < 10_000; index += 1) {
      const text = `item-${index}`;
      const child: Keyword = {
        get type(): 'Keyword' {
          typeReads += 1;
          return 'Keyword';
        },
        text,
        bytes: text
      };
      overlay.set(makeList([child], ' '), child);
    }

    expect(overlay.items).toHaveLength(10_000);
    expect(typeReads).toBeLessThan(150_000);
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
      { key: { type: 'Keyword', text: 'a', bytes: 'a' }, value: { type: 'Dimension', number: 1, unit: '', bytes: '1' } },
      { key: { type: 'Keyword', text: 'b', bytes: 'b' }, value: { type: 'Dimension', number: 2, unit: '', bytes: '2' }, important: true }
    ]).bytes).toBe('{ a: 1; b: 2 !important }');
  });

  /** A quoted entry value keeps its quotes through the map. */
  it('carries a quoted entry value verbatim', () => {
    const document = stylesheet([
      rule('.x', [decl('q', funcCall('nth', [collection([entry('a', quoted('"s"'))]), dimension(1)]))])
    ]);
    expect(render(document)).toBe('.x {\n  q: a "s";\n}\n');
  });
});
