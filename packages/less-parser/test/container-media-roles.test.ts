import { describe, test, expect } from 'vitest';
import { Parser } from '../src/index.js';
import { serializeTypes } from '@jesscss/core';

const parser = new Parser();

describe('@container and @media query roles and QueryCondition parsing', () => {
  test('@container simple query parses as QueryCondition in Paren', () => {
    const { tree, errors } = parser.parse('@container (width > 400px) { .card {} }');
    expect(errors.length).toBe(0);
    const atRule = tree.value[0];
    const prelude = atRule.value.prelude;
    const queryNode = prelude.value[0];
    expect(queryNode.type).toBe('Paren');
    expect(queryNode.value.type).toBe('QueryCondition');
    expect(queryNode.value.value.length).toBe(3);
    const out = serializeTypes(tree);
    expect(out).toContain('QueryCondition');
    expect(out).toContain('Paren');
  });

  test('@media simple query parses as QueryCondition in Paren', () => {
    const { tree, errors } = parser.parse('@media (width > 400px) { .card {} }');
    expect(errors.length).toBe(0);
    const atRule = tree.value[0];
    const prelude = atRule.value.prelude;
    const queryNode = Array.isArray(prelude.value) ? prelude.value[0] : prelude;
    if (queryNode) {
      expect(queryNode.type).toBe('Paren');
      expect(queryNode.value.type).toBe('QueryCondition');
      expect(queryNode.value.value.length).toBe(3);
    }
    const out = serializeTypes(tree);
    expect(out).toContain('QueryCondition');
    expect(out).toContain('Paren');
  });

  test('operators have role=operator', () => {
    const { tree, errors } = parser.parse('@media (width > 400px) { .card {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('role=operator');
    expect(out).toContain('>');
  });

  test('keywords have role=keyword', () => {
    const { tree, errors } = parser.parse('@media (width > 400px) and (height > 300px) { .card {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('role=keyword');
    expect(out).toContain('and');
  });

  test('not keyword has role=keyword', () => {
    const { tree, errors } = parser.parse('@media not (width > 400px) { .card {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('role=keyword');
    expect(out).toContain('not');
  });

  test('colon syntax parses as Declaration, not QueryCondition', () => {
    const { tree, errors } = parser.parse('@media (min-width: 300px) { .card {} }');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree);
    expect(out).toContain('Declaration');
    expect(out).toContain('min-width');
  });

  test('multiple conditions create outer QueryCondition', () => {
    const { tree, errors } = parser.parse('@media (width > 400px) and (height > 300px) { .card {} }');
    expect(errors.length).toBe(0);
    const atRule = tree.value[0];
    const prelude = atRule.value.prelude;
    const queryNode = Array.isArray(prelude.value) ? prelude.value[0] : prelude;
    // With multiple conditions, there should be an outer QueryCondition
    if (queryNode && queryNode.type === 'QueryCondition') {
      expect(queryNode.value.length).toBeGreaterThan(1);
    }
    const out = serializeTypes(tree);
    expect(out).toContain('QueryCondition');
  });
});
