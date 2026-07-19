import { describe, expect, it } from 'vitest';
import { makeBuiltinRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import {
  decl, detachedRuleset, dimension, forNode, funcCall, interp, keyword, list,
  root, rule, spaced, varRef, type Root
} from '../nodes.js';
import { serialize } from '../serialize.js';

const evaluator = buildEvaluator(makeBuiltinRegistry());
const render = (document: Root): string | undefined => serialize(document, { evaluator }).css;

describe('For canonical AST emission', () => {
  it('merges a typed space list into one comma declaration', () => {
    const document = root([
      rule('.foo', [
        forNode(
          spaced([dimension(1), dimension(2), dimension(3)]),
          [decl('c', varRef('value'), ',')],
          'value',
          null,
          null
        )
      ])
    ]);

    expect(render(document)).toBe('.foo {\n  c: 1, 2, 3;\n}\n');
  });

  it('iterates range() through the production function registry', () => {
    const document = root([
      rule('.col', [
        forNode(
          funcCall('range', [dimension(3)]),
          [decl(interp([{ lit: 'w-' }, { ref: varRef('value'), unquote: false }]), varRef('value'))],
          'value',
          null,
          null
        )
      ])
    ]);

    expect(render(document)).toBe('.col {\n  w-1: 1;\n  w-2: 2;\n  w-3: 3;\n}\n');
  });

  it('binds map keys and values from a detached ruleset', () => {
    const map = detachedRuleset([
      decl('one', keyword('blue')),
      decl('two', keyword('green')),
      decl('three', keyword('red'))
    ]);
    const document = root([
      rule('.set', [
        forNode(
          map,
          [decl(interp([{ ref: varRef('key'), unquote: true }]), varRef('value'))],
          'value',
          'key',
          'index'
        )
      ])
    ]);

    expect(render(document)).toBe('.set {\n  one: blue;\n  two: green;\n  three: red;\n}\n');
  });

  it('preserves nested list iteration and per-loop bindings', () => {
    const rows = list([
      spaced([dimension(10, 'px'), dimension(15, 'px')]),
      spaced([dimension(20, 'px'), dimension(25, 'px')])
    ], [', ']);
    const document = root([
      rule('.n', [
        forNode(rows, [
          forNode(
            varRef('value'),
            [
              decl(
                interp([{ lit: 'r-' }, { ref: varRef('index'), unquote: false }]),
                spaced([varRef('value'), varRef('key')])
              )
            ],
            'value',
            'key',
            'index'
          )
        ], 'value', 'key', 'index')
      ])
    ]);

    expect(render(document)).toBe(
      '.n {\n  r-1: 10px 1;\n  r-2: 15px 2;\n  r-1: 20px 1;\n  r-2: 25px 2;\n}\n'
    );
  });
});
