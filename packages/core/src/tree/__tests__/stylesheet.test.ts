import { describe, expect, test } from 'vitest';
import {
  N,
  Stylesheet,
  any,
  decl,
  stylesheet,
  type Rules
} from '../index.js';
import { isNode } from '../util/is-node.js';
import { serializeTypes } from '../util/serialize-types.js';

describe('Stylesheet', () => {
  test('is a slim Rules root with a concrete stylesheet type', () => {
    const declaration = decl({ name: 'color', value: any('blue') });
    const node = stylesheet([declaration]);

    expect(node).toBeInstanceOf(Stylesheet);
    expect(isNode(node, N.Rules)).toBe(true);
    expect(node.type).toBe('Stylesheet');
    expect(node.rules).toBe(node.value);
    expect(node.rules).toEqual([declaration]);
    expect(declaration.parent).toBe(node);
    expect(node.sourceRoot).toBe(node as Rules);
    expect(node.toTrimmedString()).toBe('color: blue;');
  });

  test('does not allocate document-side parser facts by default', () => {
    const node = stylesheet([]);

    expect(Object.hasOwn(node, 'diagnostics')).toBe(false);
    expect(Object.hasOwn(node, 'spans')).toBe(false);
    expect(Object.hasOwn(node, 'trivia')).toBe(false);
  });

  test('serializes as a root stylesheet over rules children', () => {
    const node = stylesheet([
      decl({ name: 'color', value: any('blue') })
    ]);

    expect(serializeTypes(node)).toBe([
      '(Stylesheet',
      '  rules:',
      '    [',
      '      (Declaration',
      '        name:',
      '          (Any [role=property] \'color\')',
      '        value:',
      '          (Any \'blue\')',
      '      )',
      '    ]',
      ')'
    ].join('\n'));
  });
});
