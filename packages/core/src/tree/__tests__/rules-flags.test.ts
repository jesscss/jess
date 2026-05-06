import { describe, expect, it } from 'vitest';
import { any, el, extend, quoted, rules, style } from '../index.js';

describe('Rules indexing flags', () => {
  it('tracks direct extend nodes', () => {
    const node = rules([
      extend({ target: el('.target') })
    ]);

    node._indexRules();

    expect(node._hasExtends).toBe(true);
  });

  it('tracks extend nodes inside nested rules', () => {
    const node = rules([
      rules([
        extend({ target: el('.target') })
      ])
    ]);

    node._indexRules();

    expect(node._hasExtends).toBe(true);
  });

  it('tracks reference imports inside nested rules', () => {
    const node = rules([
      rules([
        style({
          path: quoted(any('reference.less'))
        }, {
          type: 'import',
          importOptions: { reference: true }
        })
      ])
    ]);

    node._indexRules();

    expect(node._hasReferenceImports).toBe(true);
  });
});
