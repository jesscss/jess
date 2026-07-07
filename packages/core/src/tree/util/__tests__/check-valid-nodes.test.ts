import { describe, it, expect } from 'vitest';
import { checkValidNodes } from '../check-valid-nodes.js';
import { F_ALLOW_ROOT } from '../../node.js';
import { Dimension } from '../../dimension.js';
import { Operation } from '../../operation.js';
import { Comment } from '../../comment.js';
import { Declaration } from '../../declaration.js';
import { Any, Keyword } from '../../any.js';

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

  it('accepts a bare Any (Less Anonymous is allowRoot) in statement position', () => {
    // A root-position call that evaluates to a bare value produces an Any;
    // Less emits it as the final statement (e.g. `e('/* … */')`).
    const value = new Any('/* anything to unquote */', { role: 'any' });
    expect(value.hasFlag(F_ALLOW_ROOT)).toBe(true);
    expect(() => checkValidNodes([value])).not.toThrow();
  });

  it('rejects a bare Keyword in statement position (Less Keyword is not allowRoot)', () => {
    const kw = new Keyword('auto');
    expect(kw.hasFlag(F_ALLOW_ROOT)).toBe(false);
    expect(() => checkValidNodes([kw])).toThrow();
  });

  it('is a no-op for empty or missing bodies', () => {
    expect(() => checkValidNodes([])).not.toThrow();
    expect(() => checkValidNodes(undefined)).not.toThrow();
  });

  it('throws property-in-root for a Declaration hoisted to the root via a call-output block', () => {
    // A mixin / detached-ruleset call at the top level wraps its declarations in a
    // Rules block; isRoot + inRootBlock marks a Declaration reached through one.
    const decl = new Declaration({ name: 'prop', value: '1' });
    expect(() => checkValidNodes([decl], undefined, true, true))
      .toThrow(/Properties must be inside selector blocks/i);
  });

  it('does not flag a bare root Declaration (nil-selector stream, not call output)', () => {
    const decl = new Declaration({ name: 'prop', value: '1' });
    expect(() => checkValidNodes([decl], undefined, true, false)).not.toThrow();
  });
});
