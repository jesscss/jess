import { sourceSpanOf } from '../provenance.js';
import { describe, expect, it } from 'vitest';
import { any, attr, comment, decl, quoted, rules, Any, Node } from '../../index.js';

describe('placement cloning', () => {
  it('checks reusable leaves without allocating empty location arrays', () => {
    const leaf = any('red');

    expect(sourceSpanOf(leaf)).toBeUndefined();
    expect(leaf.cloneForPlacement({ stripComments: false })).toBe(leaf);
    expect(sourceSpanOf(leaf)).toBeUndefined();
  });

  it('copies optionless containers without allocating source options', () => {
    const source = quoted(any('red'));

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    expect((source as unknown as { _options: unknown })._options).toBeUndefined();
    const copied = source.cloneForPlacement();

    expect(copied).not.toBe(source);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    expect((source as unknown as { _options: unknown })._options).toBeUndefined();
  });

  it('inherits source-free nodes without allocating empty location arrays', () => {
    const source = any('red');
    const target = any('blue');

    target.inherit(source);

    expect(sourceSpanOf(source)).toBeUndefined();
    expect(sourceSpanOf(target)).toBeUndefined();
  });

  it('clones containers and comments while reusing source-free scalar leaves', () => {
    const originalClone = Any.prototype.clone;
    let scalarClones = 0;

    Any.prototype.clone = function cloneForCounting(
      this: Any,
      deep?: boolean,
      cloneFn?: (n: Node) => Node
    ) {
      if (this.valueOf() === 'red') {
        scalarClones++;
      }
      return originalClone.call(this, deep, cloneFn);
    };

    try {
      const root = rules([
        comment('/**/'),
        decl({ name: 'color', value: any('red') })
      ]);

      const cloned = root.cloneForPlacement({ stripComments: false });

      expect(cloned).not.toBe(root);
      expect(cloned.toString()).toContain('/**/');
      expect(cloned.toString()).toContain('color: red;');
      expect(scalarClones).toBe(0);
    } finally {
      Any.prototype.clone = originalClone;
    }
  });

  it('shares node children under a copied object-valued field', () => {
    const node = attr({
      name: 'data',
      op: '=',
      value: quoted('foo')
    });
    const cloned = node.clone();

    // Shallow clone: a fresh surface with a copied `{name, op, value, mod}`
    // field object, but the object's node child (the Quoted) is SHARED, not
    // deep-cloned (LIVE_BINDING_ARCHITECTURE invariants 2 and 3). Only
    // cloneForPlacement({ detachChildren }) clones-to-detach node-owning kids.
    expect(cloned).not.toBe(node);
    expect(cloned.value).not.toBe(node.value);
    expect(cloned.value.value).toBe(node.value.value);
    expect(cloned.toString()).toBe('[data="foo"]');
  });
});
