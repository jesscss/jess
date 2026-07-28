import { describe, it, expect } from 'vitest';
import { Any, Rules, any } from '../index.js';
import { TreeContext } from '../../context.js';

describe('Node mutation', () => {
  it('keeps tree context on Rules while children resolve it via the source root', () => {
    const node = any('10px');
    expect(node._sourceRoot).toBeUndefined();

    /*
     * `_treeContext` is a Rules-only field; a leaf node resolves context via its
     * sourceRoot, which a bare (unparented) node does not yet have.
     */
    expect(node.sourceRoot?._treeContext).toBeUndefined();

    const treeContext = new TreeContext();
    const sourced = new Any('10px');
    expect(sourced._sourceRoot).toBeUndefined();

    /*
     * Invariant 7: raw `new Rules` shares; `_sourceRoot` propagation to children
     * happens on canonical parenting (as the `rules` factory does).
     */
    const root = new Rules([sourced], undefined, undefined, treeContext).parentChildren();
    expect(root._treeContext).toBe(treeContext);
    expect(root._sourceRoot).toBe(root);
    expect(sourced._sourceRoot).toBe(root);

    // The child now resolves the tree context through its source root.
    expect(sourced.sourceRoot?._treeContext).toBe(treeContext);
  });
});
