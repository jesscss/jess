import { describe, it, expect } from 'vitest';
import { Any, F_MAY_ASYNC, Rules, any, paren } from '../index.js';
import { Context, TreeContext } from '../../context.js';

class AsyncAny extends Any<string> {
  constructor(value: string) {
    super(value);
    this.addFlag(F_MAY_ASYNC);
  }

  override eval() {
    return Promise.resolve(any(this.value));
  }
}

describe('Node mutation', () => {
  it('updates a node value canonically', () => {
    const node = paren(any('10px'));
    node.set(null, any('20px'));
    expect(String(node.value)).toBe('20px');
  });

  it('avoids extra state when the value is unchanged', () => {
    const node = paren(any('10px'));
    node.set(null, any('10px'));
    expect(String(node.value)).toBe('10px');
    expect('_childForks' in node).toBe(false);
  });

  it('updates parent pointers dynamically', () => {
    const child = any('10px');
    const parent1 = paren(child);
    const parent2 = paren();
    parent2.set(null, child);

    expect(child.parent).toBe(parent2);
    expect(parent1.value).toBe(child);
  });

  it('keeps tree context on Rules while children point at the source root', () => {
    const node = any('10px');
    expect(node._treeContext).toBeUndefined();
    expect(node._sourceRoot).toBeUndefined();

    const treeContext = new TreeContext();
    const sourced = new Any('10px', undefined, undefined, treeContext);
    expect(sourced._treeContext).toBeUndefined();
    expect(sourced._sourceRoot).toBeUndefined();

    const root = new Rules([sourced], undefined, undefined, treeContext);
    expect(root._treeContext).toBe(treeContext);
    expect(root._sourceRoot).toBe(root);
    expect(sourced._treeContext).toBeUndefined();
    expect(sourced._sourceRoot).toBe(root);
    expect(sourced.sourceRoot?._treeContext).toBe(treeContext);
  });

  it('returns a typed sync eval result', () => {
    const node = any('10px');
    const evald = node.evalSync(new Context());

    expect(evald).toBe(node);
    expect(evald.value).toBe('10px');
  });

  it('throws when sync eval receives a thenable', () => {
    const node = new AsyncAny('10px');

    expect(() => node.evalSync(new Context())).toThrow('Expected synchronous eval result.');
  });
});
