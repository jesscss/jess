import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import {
  decl, collection, dimension, forNode, funcCall, interpolation, keyword, list,
  propertyReference, range, stylesheet, rule, spaced, variableDeclaration, variableReference, type Stylesheet
} from '../nodes.js';
import { serialize } from '../serialize.js';

const evaluator = buildEvaluator(makeLessRegistry());
const render = (document: Stylesheet): string | undefined => serialize(document, { evaluator }).css;

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
      decl('one', keyword('blue')),
      decl('two', keyword('green')),
      decl('three', keyword('red'))
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

  it('evaluates detached-map member values through the map property timeline when bound to @value', () => {
    const map = collection([
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
          collection([decl('one', keyword('blue')), decl('two', keyword('green'))]),
          [decl(interpolation([{ ref: variableReference('key', 'scoped'), unquote: true }]), variableReference('value', 'scoped'))],
          { kind: 'bracket', names: ['key', 'value'] }
        )
      ])
    ]);

    expect(render(document)).toBe('.set {\n  one: blue;\n  two: green;\n}\n');
  });

  it('binds comma key and counter positions for both lists and maps', () => {
    const map = collection([decl('first', keyword('red')), decl('second', keyword('blue'))]);
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
});
