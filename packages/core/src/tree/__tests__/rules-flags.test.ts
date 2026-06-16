import { describe, expect, it } from 'vitest';
import { any, el, extend, quoted, rules, style } from '../index.js';

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

  it('tracks reference imports inside nested rules', () => {
    const node = rules([]);
    const item = rules([
      rules([
        style({
          path: quoted(any('reference.less'))
        }, {
          type: 'import',
          importOptions: { reference: true }
        })
      ])
    ]);

    node.registerNode(item);

    expect(node._hasReferenceImports).toBe(true);
    expect(node.hasReferenceImportChildSurface).toBe(true);
  });

  it('carries reference import child surface facts into scope frames', () => {
    const node = rules([]);
    const item = rules([
      rules([
        style({
          path: quoted(any('reference.less'))
        }, {
          type: 'import',
          importOptions: { reference: true }
        })
      ])
    ]);

    node.registerNode(item);
    const frame = node.getScopeFrame(undefined, false);

    expect(frame.hasReferenceImports).toBe(true);
  });
});
