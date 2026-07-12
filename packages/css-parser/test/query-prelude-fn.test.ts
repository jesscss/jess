/**
 * Functional css parser (parseCssFn) — at-rule query preludes.
 *
 * container.test.ts exercises the OLD Chevrotain parser; this covers the
 * functional parser, which previously whitespace-split preludes into List(Any).
 * Node shapes: `name <op> value` -> QueryCondition(['name','op', valueNode])
 * (plain strings + a real value node), `name: value` -> Declaration, not/and/or
 * -> Keyword, `(X)` -> Paren, prelude wrapped in a Sequence.
 */
import { describe, test, expect } from 'vitest';
import { parseCssFn } from '../src/grammar.js';
import { N, isNode, serializeTypes } from '@jesscss/core';

// Deliberately `any`: callers walk the prelude structurally (.value[0], etc.).
const prelude = (css: string): any => {
  const r = parseCssFn(css);
  expect(r.errors).toHaveLength(0);
  const first = r.tree.rules[0];
  if (!isNode(first, N.AtRule)) {
    throw new Error('Expected first rule to be an at-rule');
  }
  return first.prelude;
};
const render = (css: string) => {
  return parseCssFn(css).tree.toString();
};

describe('parseCssFn at-rule query preludes', () => {
  test('comparison feature uses plain strings + value node', () => {
    const p = prelude('@media (width > 400px) { .c { x: 1 } }');
    expect(p.type).toBe('Sequence');
    const paren = p.value[0];
    expect(paren.type).toBe('Paren');
    expect(paren.value.type).toBe('QueryCondition');
    expect(paren.value.value[0]).toBe('width');
    expect(paren.value.value[1]).toBe('>');
    expect(paren.value.value[2].type).toBe('Dimension');
  });

  test('colon feature parses as Declaration', () => {
    const paren = prelude('@media (min-width: 300px) { .c { x: 1 } }').value[0];
    expect(paren.type).toBe('Paren');
    expect(paren.value.type).toBe('Declaration');
    expect(paren.value.name).toBe('min-width');
  });

  test('not keeps a Keyword and wraps in QueryCondition', () => {
    const qc = prelude('@container not (width < 400px) { .c { x: 1 } }').value[0];
    expect(qc.type).toBe('QueryCondition');
    expect(qc.value[0].type).toBe('Keyword');
    expect(qc.value[0].value).toBe('not');
    expect(qc.value[1].type).toBe('Paren');
  });

  test('and/or combine parens with Keyword operators', () => {
    const qc = prelude('@media (a) and (b) { .c { x: 1 } }').value[0];
    expect(qc.type).toBe('QueryCondition');
    expect(qc.value[0].type).toBe('Paren');
    expect(qc.value[1].type).toBe('Keyword');
    expect(qc.value[1].value).toBe('and');
    expect(qc.value[2].type).toBe('Paren');
  });

  test('container name is kept ahead of the condition', () => {
    const seq = prelude('@container sidebar (width > 400px) { .c { x: 1 } }');
    expect(seq.value[0].type).toBe('Any');
    expect(seq.value[0].value).toBe('sidebar');
    expect(seq.value[1].type).toBe('Paren');
  });

  test('preludes round-trip back to CSS', () => {
    expect(render('@media (width > 400px) { .c { color: red } }'))
      .toContain('@media (width > 400px)');
    expect(render('@container not (width < 400px) { .c { x: 1 } }'))
      .toContain('@container not (width < 400px)');
    expect(render('@media (a) and (b) { .c { x: 1 } }'))
      .toContain('(a) and (b)');
  });
});
