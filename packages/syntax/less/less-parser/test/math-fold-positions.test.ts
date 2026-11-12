import { describe, expect, it } from 'vitest';
import type { MathMode } from '@jesscss/core';
import { parse } from '../src/index.js';

/*
 * A math run is folded once, product before sum and left to right within each,
 * and every folded operation spans its two operands. Each case writes the
 * value, the tree it folds to (`!` marks an operation the math policy keeps as
 * written), and the source text each operation spans.
 */

type Folded = { tree: string; spans: string[] };

function folded(value: string, mathMode: MathMode = 'always'): Folded {
  const source = `.a { b: ${value}; }`;
  const rule = parse(source, { mathMode }).rules[0];
  const declaration = rule?.type === 'Ruleset' ? rule.rules[0] : undefined;
  if (declaration?.type !== 'Declaration' || Array.isArray(declaration.value)) {
    throw new TypeError('expected one declaration');
  }
  const spans: string[] = [];
  const render = (node: unknown): string => {
    if (typeof node !== 'object' || node === null || !('type' in node)) {
      return String(node);
    }
    if (node.type === 'Operation' && 'left' in node && 'right' in node && 'operator' in node && 'mathOutsideParens' in node) {
      if ('_s' in node && '_e' in node && typeof node._s === 'number' && typeof node._e === 'number') {
        spans.push(source.slice(node._s, node._e));
      }
      return `(${render(node.left)} ${String(node.operator)}${node.mathOutsideParens === true ? '' : '!'} ${render(node.right)})`;
    }
    if (node.type === 'Expression' && 'value' in node) {
      return `$${render(node.value)}`;
    }
    if (node.type === 'List' && 'value' in node && Array.isArray(node.value)) {
      return `[${node.value.map(render).join(' / ')}]`;
    }
    return 'src' in node ? String(node.src) : String(node.type);
  };
  return { tree: render(declaration.value), spans };
}

describe('Less math fold', () => {
  it.each([
    ['a sum', '1 + 2 - 3', '$((1 + 2) - 3)', ['1 + 2', '1 + 2 - 3']],
    ['a product', '2 * 3 / 4 % 5', '$(((2 * 3) / 4) % 5)', ['2 * 3', '2 * 3 / 4', '2 * 3 / 4 % 5']],
    ['a product inside a sum', '1 + 2 * 3', '$(1 + (2 * 3))', ['2 * 3', '1 + 2 * 3']],
    ['a product before a sum', '2 * 3 + 1', '$((2 * 3) + 1)', ['2 * 3', '2 * 3 + 1']],
    [
      'products between sums',
      '1 + 2 * 3 * 4 - 5 / 6 + 7',
      '$(((1 + ((2 * 3) * 4)) - (5 / 6)) + 7)',
      ['2 * 3', '2 * 3 * 4', '1 + 2 * 3 * 4', '5 / 6', '1 + 2 * 3 * 4 - 5 / 6', '1 + 2 * 3 * 4 - 5 / 6 + 7']
    ]
  ])('folds %s', (_label, value, tree, spans) => {
    const result = folded(value);
    expect(result.tree).toBe(tree);
    expect([...result.spans].sort()).toEqual([...spans].sort());
  });

  it('keeps each side of a slash the policy does not divide, as written beside other math', () => {
    expect(folded('1 + 2 / 3 * 4 - 5', 'parens-division')).toEqual({
      tree: '[(1 +! 2) / ((3 *! 4) -! 5)]',
      spans: ['1 + 2', '3 * 4 - 5', '3 * 4']
    });
  });

  it('computes a run with no slash under a policy that keeps slashes', () => {
    expect(folded('1 + 2 * 3', 'parens-division').tree).toBe('$(1 + (2 * 3))');
  });

  it('keeps every operation under a policy that computes nothing bare', () => {
    expect(folded('1 + 2 * 3', 'strict').tree).toBe('(1 +! (2 *! 3))');
  });
});
