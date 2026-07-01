import { describe, it, expect } from 'vitest';
import { Any, Rules, any } from '../index.js';
import { TreeContext } from '../../context.js';

describe('Node mutation', () => {
  it('keeps tree context on Rules while children point at the source root', () => {
    const node = any('10px');
    expect(node._treeContext).toBeUndefined();
    expect(node._sourceRoot).toBeUndefined();

    const treeContext = new TreeContext();
    const sourced = new Any('10px', undefined, undefined, treeContext);
    expect(sourced._treeContext).toBe(treeContext);
    expect(sourced._sourceRoot).toBeUndefined();

    // Invariant 7: raw `new Rules` shares; `_sourceRoot` propagation to children
    // happens on canonical parenting (as the `rules` factory does).
    const root = new Rules([sourced], undefined, undefined, treeContext).parentChildren();
    expect(root._treeContext).toBe(treeContext);
    expect(root._sourceRoot).toBe(root);
    expect(sourced._treeContext).toBe(treeContext);
    expect(sourced._sourceRoot).toBe(root);
    expect(sourced.sourceRoot?._treeContext).toBe(treeContext);
  });
});
