import { describe, it, expect } from 'vitest';
import { rules, ruleset, sel, el, decl, spaced, paren, any, EVAL, CANONICAL } from '../index.js';

describe('Node Eval', () => {
  it('should fork a node correctly', () => {
    /** Canonical node value */
    const node = paren(any('10px'));
    node.set(null, any('20px'), EVAL);
    expect(String(node.getValue())).toBe('20px');
    expect(String(node.getValue(EVAL))).toBe('20px');
    expect(String(node.getValue(CANONICAL))).toBe('10px');
  });

  it('should allow multiple render keys', () => {
    /** Canonical node value */
    const node = paren(any('10px'));
    node.set(null, any('20px'), 1);
    node.set(null, any('30px'), 2);
    /** Sets the most recent value */
    expect(String(node.getValue())).toBe('30px');
    /** Just gives latest for an un-set key */
    expect(String(node.getValue(EVAL))).toBe('30px');
    expect(String(node.getValue(CANONICAL))).toBe('10px');
    expect(String(node.getValue(1))).toBe('20px');
    expect(String(node.getValue(2))).toBe('30px');
  });

  it('should avoid forking if the value is the same', () => {
    const node = paren(any('10px'));
    node.set(null, any('10px'));
    expect(node._childForks).toBeUndefined();
    expect(String(node.getValue(EVAL))).toBe('10px');
    expect(String(node.getValue(CANONICAL))).toBe('10px');
  });

  it('should get the parent node correctly', () => {
    const child = any('10px');
    const node = paren(child);
    expect(child.getParent()).toBe(node);
    expect(child.getParent(EVAL)).toBe(node);
    expect(child.getParent(CANONICAL)).toBe(node);
  });

  it('should get the parent node dynamically', () => {
    const child = any('10px');
    const parent1 = paren(child);
    /** I guess we can't just pass it in the constructor */
    const parent2 = paren();
    parent2.set(null, child, 1);

    expect(child.getParent()).toBe(parent2);
    expect(child.getParent(CANONICAL)).toBe(parent1);
    expect(child.getParent(1)).toBe(parent2);
  });

  it('should preserve parent forks for renderKey 0', () => {
    const child = any('10px');
    const parent1 = paren(child);
    const parent2 = paren();
    parent2.set(null, child, 0);

    expect(child.getParent()).toBe(parent2);
    expect(child.getParent(CANONICAL)).toBe(parent1);
    expect(child.getParent(0)).toBe(parent2);
  });
});
