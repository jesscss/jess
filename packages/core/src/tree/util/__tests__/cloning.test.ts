import { sourceSpanOf } from '../provenance.js';
import { describe, expect, it } from 'vitest';
import { any, comment, decl, quoted, rules, Any, Node } from '../../index.js';

describe('placement cloning', () => {
  it('checks reusable leaves without allocating empty location arrays', () => {
    const leaf = any('red');

    expect(sourceSpanOf(leaf)).toBeUndefined();
    expect(leaf.cloneForPlacement({ stripComments: false })).toBe(leaf);
    expect(sourceSpanOf(leaf)).toBeUndefined();
  });

  it('copies optionless containers without allocating source options', () => {
    const source = quoted(any('red'));

    expect((source as unknown as { _options: unknown })._options).toBeUndefined();
    const copied = source.cloneForPlacement();

    expect(copied).not.toBe(source);
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
});
