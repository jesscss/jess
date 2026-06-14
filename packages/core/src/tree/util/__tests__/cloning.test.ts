import { describe, expect, it } from 'vitest';
import { any, attr, comment, decl, quoted, rules, Any, Node } from '../../index.js';
import { cloneWithReusableLeaves, copyWithReusableLeaves } from '../cloning.js';

describe('cloning helpers', () => {
  it('checks reusable leaves without allocating empty location arrays', () => {
    const leaf = any('red');

    expect(leaf._location).toBeUndefined();
    expect(cloneWithReusableLeaves(leaf)).toBe(leaf);
    expect(leaf._location).toBeUndefined();
  });

  it('copies optionless containers without allocating source options', () => {
    const source = quoted(any('red'));

    expect(source._options).toBeUndefined();
    const copied = copyWithReusableLeaves(source);

    expect(copied).not.toBe(source);
    expect(source._options).toBeUndefined();
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

      const cloned = cloneWithReusableLeaves(root);

      expect(cloned).not.toBe(root);
      expect(cloned.toString()).toContain('/**/');
      expect(cloned.toString()).toContain('color: red;');
      expect(scalarClones).toBe(0);
    } finally {
      Any.prototype.clone = originalClone;
    }
  });

  it('clones direct object-valued node children', () => {
    const node = attr({
      name: 'data',
      op: '=',
      value: quoted('foo')
    });
    const cloned = node.clone(true);

    expect(cloned).not.toBe(node);
    expect(cloned.value.value).not.toBe(node.value.value);
    expect(cloned.toString()).toBe('[data="foo"]');
  });
});
