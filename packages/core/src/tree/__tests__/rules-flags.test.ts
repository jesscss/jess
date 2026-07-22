import { describe, expect, it } from 'vitest';
import { el, extend, rules } from '../index.js';

describe('Rules indexing flags', () => {
  it('tracks direct extend nodes', () => {
    const node = rules([]);
    const item = extend({ target: el('.target') });

    node.registerNode(item);

    expect(node._hasExtends).toBe(true);
  });

  it('tracks extend nodes inside nested rules', () => {
    const node = rules([]);
    const item = rules([
      rules([
        extend({ target: el('.target') })
      ])
    ]);

    node.registerNode(item);

    expect(node._hasExtends).toBe(true);
  });
});
