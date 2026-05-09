import { describe, it, expect } from 'vitest';
import { Any, any, paren } from '../index.js';
import { TreeContext } from '../../context.js';

describe('Node mutation', () => {
  it('updates a node value canonically', () => {
    const node = paren(any('10px'));
    node.set(null, any('20px'));
    expect(String(node.getValue())).toBe('20px');
  });

  it('avoids extra state when the value is unchanged', () => {
    const node = paren(any('10px'));
    node.set(null, any('10px'));
    expect(String(node.getValue())).toBe('10px');
    expect('_childForks' in node).toBe(false);
  });

  it('updates parent pointers dynamically', () => {
    const child = any('10px');
    const parent1 = paren(child);
    const parent2 = paren();
    parent2.set(null, child);

    expect(child.getParent()).toBe(parent2);
    expect(parent1.value).toBe(child);
  });

  it('exposes only an explicitly attached tree context without creating one', () => {
    const node = any('10px');
    expect(node.treeContextIfSet).toBeUndefined();

    const treeContext = new TreeContext();
    const sourced = new Any('10px', undefined, undefined, treeContext);

    expect(sourced.treeContextIfSet).toBe(treeContext);
  });
});
