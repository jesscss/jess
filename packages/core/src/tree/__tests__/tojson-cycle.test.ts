import { describe, it, expect } from 'vitest';
import { rules, decl } from '../index.js';

/**
 * `JSON.stringify(node)` must stay cycle-safe. Nodes carry internal
 * back-references — `sourceNode`/`parent`/`_sourceRoot`/`_treeContext` on the
 * base, plus `_scopeFrame` on `Rules` — that form cycles once a tree is parsed
 * or evaluated. `toJSON()` drops them; if a new back-ref field is added without
 * being added to the drop-list, `JSON.stringify` blows the stack (as
 * `_sourceRoot` did). This locks the contract so that regression can't recur.
 */
describe('toJSON cycle-safety', () => {
  it('does not blow the stack on the internal back-reference cycles', () => {
    const r = rules([decl('color', 'red')]);

    // Simulate the back-refs that parse/eval populate (all point back at `r`):
    Object.assign(r, {
      _sourceRoot: r,
      _treeContext: { root: r, sourceTrees: new Map([['x', r]]) },
      _scopeFrame: { rulesNode: r, fallbackFrame: { rulesNode: r } },
      parent: r,
      sourceNode: r
    });

    expect(() => JSON.stringify(r)).not.toThrow();

    const json = JSON.parse(JSON.stringify(r));
    for (const dropped of ['_sourceRoot', '_treeContext', '_scopeFrame', 'parent', 'sourceNode']) {
      expect(json[dropped], `${dropped} must be dropped by toJSON`).toBeUndefined();
    }

    // Real tree data survives.
    expect(Array.isArray(json.rules)).toBe(true);
  });
});
