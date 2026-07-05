import { describe, it, expect } from 'vitest';
import { checkValidNodes } from '../check-valid-nodes.js';
import { F_ALLOW_ROOT } from '../../node.js';
import { Dimension } from '../../dimension.js';
import { Operation } from '../../operation.js';
import { Comment } from '../../comment.js';
import { Declaration } from '../../declaration.js';

describe('checkValidNodes', () => {
  it('throws when a value node (no F_ALLOW_ROOT) sits in a statement position', () => {
    const dim = new Dimension({ number: 1, unit: 'px' });
    expect(dim.hasFlag(F_ALLOW_ROOT)).toBe(false);
    expect(() => checkValidNodes([dim])).toThrow(/Dimension|statement|not valid/i);
  });

  it('throws for an Operation in a statement position', () => {
    const op = new Operation([
      new Dimension({ number: 1 }),
      '+',
      new Dimension({ number: 2 })
    ]);
    expect(op.hasFlag(F_ALLOW_ROOT)).toBe(false);
    expect(() => checkValidNodes([op])).toThrow();
  });

  it('does not throw for statement-legal nodes (F_ALLOW_ROOT set in constructor)', () => {
    const comment = new Comment('/* ok */');
    const decl = new Declaration({ name: 'color', value: 'red' });
    expect(comment.hasFlag(F_ALLOW_ROOT)).toBe(true);
    expect(decl.hasFlag(F_ALLOW_ROOT)).toBe(true);
    expect(() => checkValidNodes([comment, decl])).not.toThrow();
  });

  it('is a no-op for empty or missing bodies', () => {
    expect(() => checkValidNodes([])).not.toThrow();
    expect(() => checkValidNodes(undefined)).not.toThrow();
  });
});
