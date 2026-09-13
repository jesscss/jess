import { describe, expect, it } from 'vitest';
import { makeLessRegistry, makeSassRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import {
  anonymousMixin, decl, collection, collectionEntry, dimension, forNode, funcCall, interpolation, keyword, list,
  propertyReference, range, reference, stylesheet, rule, spaced, variableDeclaration, variableReference, type Stylesheet
} from '../nodes.js';
import { serialize } from '../serialize.js';
import { isCollection, makeKeyword } from '../../value.js';
import { createFnRegistry, defineFunction } from '../value-dispatch.js';

const evaluator = buildEvaluator(makeLessRegistry());
const sassEvaluator = buildEvaluator(makeSassRegistry());
const render = (document: Stylesheet, collapseNesting = true): string | undefined =>
  serialize(document, { evaluator, collapseNesting }).css;
const entry = (name: string, value: Parameters<typeof collectionEntry>[1]): ReturnType<typeof collectionEntry> =>
  collectionEntry(keyword(name), value);

describe('For canonical AST emission', () => {
  it('merges a typed space list into one comma declaration', () => {
    const document = stylesheet([
      rule('.foo', [
        forNode(
          spaced([dimension(1), dimension(2), dimension(3)]),
          [decl('c', variableReference('value', 'scoped'), ',')],
          { kind: 'single', name: 'value' }
        )
      ])
    ]);

    expect(render(document)).toBe('.foo {\n  c: 1, 2, 3;\n}\n');
  });

  it('carries a nested-output property merge through each callback iterations', () => {
    const document = stylesheet([
      rule('.foo', [
        forNode(spaced([dimension(1), dimension(2)]), [decl('padding', variableReference('value', 'scoped'), ' ')], { kind: 'single', name: 'value' }),
        decl('padding', dimension(3), ' ')
      ])
    ]);

    expect(serialize(document, { evaluator, collapseNesting: false }).css)
      .toBe('.foo {\n  padding: 1 2 3;\n}\n');
  });

  it('iterates range() through the production function registry', () => {
    const document = stylesheet([
      rule('.col', [
        forNode(
          funcCall('range', [dimension(3)]),
          [decl(interpolation([{ lit: 'w-' }, { ref: variableReference('value', 'scoped'), unquote: false }]), variableReference('value', 'scoped'))],
          { kind: 'single', name: 'value' }
        )
      ])
    ]);

    expect(render(document)).toBe('.col {\n  w-1: 1;\n  w-2: 2;\n  w-3: 3;\n}\n');
  });

  it('binds map keys and values from a detached ruleset', () => {
    const map = collection([
      entry('one', keyword('blue')),
      entry('two', keyword('green')),
      entry('three', keyword('red'))
    ]);
    const document = stylesheet([
      rule('.set', [
        forNode(
          map,
          [decl(interpolation([{ ref: variableReference('key', 'scoped'), unquote: true }]), variableReference('value', 'scoped'))],
          { kind: 'comma', names: ['value', 'key', 'index'] }
        )
      ])
    ]);

    expect(render(document)).toBe('.set {\n  one: blue;\n  two: green;\n  three: red;\n}\n');
  });

  it('evaluates detached-ruleset member values through the property timeline when bound to @value', () => {
    const map = anonymousMixin([
      decl('background-color', keyword('black')),
      decl('color', propertyReference('background-color'))
    ]);
    const document = stylesheet([
      variableDeclaration('vars', map, { mode: 'declare' }),
      rule(':root', [
        decl('background-color', keyword('red')),
        forNode(
          variableReference('vars', 'scoped'),
          [decl(interpolation([{ lit: '--' }, { ref: variableReference('key', 'scoped'), unquote: true }]), variableReference('value', 'scoped'))],
          { kind: 'comma', names: ['value', 'key', 'index'] }
        )
      ])
    ]);

    expect(render(document)).toBe(':root {\n'
      + '  background-color: red;\n'
      + '  --background-color: black;\n'
      + '  --color: black;\n'
      + '}\n');
  });

  it('keeps Jess bracket bindings in public key/value order', () => {
    const document = stylesheet([
      rule('.set', [
        forNode(
          collection([entry('one', keyword('blue')), entry('two', keyword('green'))]),
          [decl(interpolation([{ ref: variableReference('key', 'scoped'), unquote: true }]), variableReference('value', 'scoped'))],
          { kind: 'bracket', names: ['key', 'value'] }
        )
      ])
    ]);

    expect(render(document)).toBe('.set {\n  one: blue;\n  two: green;\n}\n');
  });

  it('preserves typed values while iterating a computed collection spread', () => {
    const nested = collection([entry('inner', keyword('blue'))]);
    const merged = funcCall('map-merge', [
      collection([entry('outer', nested)]),
      collection([])
    ]);
    const document = stylesheet([
      rule('.set', [
        forNode(
          collection([{ type: 'CollectionSpread', value: merged }]),
          [decl('value', funcCall('map-get', [variableReference('value', 'scoped'), keyword('inner')]))],
          { kind: 'single', name: 'value' }
        )
      ])
    ]);

    expect(serialize(document, { evaluator: sassEvaluator }).css)
      .toBe('.set {\n  value: blue;\n}\n');
  });

  it('indexes a typed list value carried from a collection loop', () => {
    const firstValue = reference(
      variableReference('value', 'scoped'),
      [{ type: 'LookupStep', kind: 'index', name: 1, indexBase: 1 }],
      '$value[1]'
    );
    const document = stylesheet([
      rule('.set', [
        forNode(
          collection([{ type: 'CollectionSpread', value: collection([
            collectionEntry(keyword('row'), list([keyword('first'), keyword('second')], ','))
          ]) }]),
          [decl('first', firstValue)],
          { kind: 'single', name: 'value' }
        )
      ])
    ]);

    expect(render(document)).toBe('.set {\n  first: first;\n}\n');
  });

  it('iterates a typed list value carried from an outer collection loop', () => {
    const document = stylesheet([
      rule('.set', [
        forNode(
          collection([entry('row', list([keyword('first'), keyword('second')], ','))]),
          [forNode(
            variableReference('value', 'scoped'),
            [decl('item', variableReference('value', 'scoped'))],
            { kind: 'single', name: 'value' }
          )],
          { kind: 'single', name: 'value' }
        )
      ])
    ]);

    expect(render(document)).toBe('.set {\n  item: first;\n  item: second;\n}\n');
  });

  it('evaluates every collection key and value once in source order before later-wins iteration', () => {
    const calls: string[] = [];
    let keyCount = 0;
    let valueCount = 0;
    const registry = createFnRegistry();
    registry.register(defineFunction('next-key', {
      params: [],
      body: () => {
        calls.push(`key-${++keyCount}`);
        return makeKeyword('same');
      }
    }));
    registry.register(defineFunction('next-value', {
      params: [],
      body: () => {
        calls.push(`value-${++valueCount}`);
        return makeKeyword(`v${valueCount}`);
      }
    }));
    const document = stylesheet([
      rule('.set', [
        forNode(
          collection([
            collectionEntry(funcCall('next-key', []), funcCall('next-value', [])),
            collectionEntry(funcCall('next-key', []), funcCall('next-value', []))
          ]),
          [decl('result', variableReference('value', 'scoped'))],
          { kind: 'single', name: 'value' }
        )
      ])
    ]);

    expect(serialize(document, { evaluator: buildEvaluator(registry) }).css)
      .toBe('.set {\n  result: v2;\n}\n');
    expect(calls).toEqual(['key-1', 'value-1', 'key-2', 'value-2']);
  });

  it('does not reinterpret an executable block stored in a Jess Collection as nested map data', () => {
    const registry = createFnRegistry();
    registry.register(defineFunction('value-kind', {
      params: [{ name: 'value', type: 'any' }],
      body: value => makeKeyword(isCollection(value) ? 'Collection' : value.type)
    }));
    const document = stylesheet([
      rule('.set', [
        forNode(
          collection([entry('block', anonymousMixin([decl('inside', keyword('yes'))]))]),
          [decl('kind', funcCall('value-kind', [variableReference('value', 'scoped')]))],
          { kind: 'single', name: 'value' }
        )
      ])
    ]);

    expect(serialize(document, { evaluator: buildEvaluator(registry) }).css)
      .toBe('.set {\n  kind: Keyword;\n}\n');
  });

  it('binds comma key and counter positions for both lists and maps', () => {
    const map = collection([entry('first', keyword('red')), entry('second', keyword('blue'))]);
    const document = stylesheet([
      rule('.list', [
        forNode(
          spaced([keyword('red'), keyword('blue')]),
          [decl(interpolation([{ lit: 'item-' }, { ref: variableReference('key', 'scoped'), unquote: false }, { lit: '-' }, { ref: variableReference('counter', 'scoped'), unquote: false }]), variableReference('value', 'scoped'))],
          { kind: 'comma', names: ['value', 'key', 'counter'] }
        )
      ]),
      rule('.map', [
        forNode(
          map,
          [decl(interpolation([{ ref: variableReference('key', 'scoped'), unquote: true }, { lit: '-' }, { ref: variableReference('counter', 'scoped'), unquote: false }]), variableReference('value', 'scoped'))],
          { kind: 'comma', names: ['value', 'key', 'counter'] }
        )
      ])
    ]);

    expect(render(document)).toBe('.list {\n  item-1-1: red;\n  item-2-2: blue;\n}\n.map {\n  first-1: red;\n  second-2: blue;\n}\n');
  });

  it('destructures typed tuple entries without reparsing list bytes', () => {
    const document = stylesheet([
      rule('.pairs', [
        forNode(
          list([spaced([dimension(1), dimension(2)]), spaced([dimension(3), dimension(4)])], ','),
          [decl(interpolation([{ lit: 'pair-' }, { ref: variableReference('left', 'scoped'), unquote: false }]), variableReference('right', 'scoped'))],
          { kind: 'tuple', names: ['left', 'right'] }
        )
      ])
    ]);

    expect(render(document)).toBe('.pairs {\n  pair-1: 2;\n  pair-3: 4;\n}\n');
  });

  it('expands canonical range bounds without manufacturing a value list', () => {
    const document = stylesheet([
      rule('.range', [
        forNode(
          range(dimension(1), dimension(3), null, true, false),
          [decl(interpolation([{ lit: 'n-' }, { ref: variableReference('value', 'scoped'), unquote: false }]), variableReference('value', 'scoped'))],
          { kind: 'single', name: 'value' }
        )
      ])
    ]);

    expect(render(document)).toBe('.range {\n  n-1: 1;\n  n-2: 2;\n}\n');
  });

  it('preserves nested list iteration and per-loop bindings', () => {
    const rows = list([
      spaced([dimension(10, 'px'), dimension(15, 'px')]),
      spaced([dimension(20, 'px'), dimension(25, 'px')])
    ], ',');
    const document = stylesheet([
      rule('.n', [
        forNode(rows, [
          forNode(
            variableReference('value', 'scoped'),
            [
              decl(
                interpolation([{ lit: 'r-' }, { ref: variableReference('index', 'scoped'), unquote: false }]),
                spaced([variableReference('value', 'scoped'), variableReference('key', 'scoped')])
              )
            ],
            { kind: 'comma', names: ['value', 'key', 'index'] }
          )
        ], { kind: 'comma', names: ['value', 'key', 'index'] })
      ])
    ]);

    expect(render(document)).toBe('.n {\n  r-1: 10px 1;\n  r-2: 15px 2;\n  r-1: 20px 1;\n  r-2: 25px 2;\n}\n');
  });

  it.each([true, false])(
    'keeps source-order iteration bindings visible with collapseNesting=%s',
    (collapseNesting) => {
      const document = stylesheet([
        rule('.outer', [
          forNode(
            spaced([keyword('red'), keyword('blue')]),
            [
              decl(
                interpolation([
                  { lit: 'item-' },
                  { ref: variableReference('index', 'scoped'), unquote: false }
                ]),
                variableReference('value', 'scoped')
              )
            ],
            { kind: 'comma', names: ['value', 'key', 'index'] }
          ),
          decl('after', keyword('done'))
        ])
      ]);

      expect(render(document, collapseNesting)).toBe('.outer {\n'
        + '  item-1: red;\n'
        + '  item-2: blue;\n'
        + '  after: done;\n'
        + '}\n');
    }
  );
});
