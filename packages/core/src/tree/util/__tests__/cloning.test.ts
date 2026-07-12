import { describe, expect, it } from 'vitest';
import { any, comment, decl, rules, Any, Node } from '../../index.js';
import { cloneWithReusableLeaves } from '../cloning.js';

describe('cloning helpers', () => {
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
});
