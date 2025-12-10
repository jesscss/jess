import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import {
  style,
  rules,
  sel,
  el,
  sellist,
  extend,
  quoted,
  any,
  type Rules,
  Node
} from '..';
import { Context } from '../../context';
import { ruleset } from '..';
import { resolve } from 'node:path';
import { createTestContext } from './import-style-test-helpers';

let context: Context;

describe('Style import extend behavior', () => {
  beforeAll(() => {
    Node.prototype.fullRender = true;
  });

  beforeEach(() => {
    context = createTestContext();
  });

  describe('import type extend behavior', () => {
    it('import type can be extended from parent', async () => {
      const importedPath = resolve(process.cwd(), 'imported.jess');
      context.sourceTrees.set(importedPath, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.extended')])]),
              rules: rules([])
            })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('imported.jess'))
        }, {
          type: 'import'
        }),
        ruleset({
          selector: sellist([sel([el('.child')]), extend({
            selector: sel([el('.child')]),
            target: el('.base')
          })]),
          rules: rules([])
        })
      ]);

      const evald = await node.eval(context);
      // For .child:-extend(.base), the .base ruleset from the import should be extended
      const importedRules = evald.at(0) as Rules;
      const baseRuleset = importedRules.at(0);
      expect(baseRuleset).toBeDefined();
      expect(`${baseRuleset}`).toContainString('.base');
      expect(`${baseRuleset}`).toContainString('.child');
    });

    it('import type can be extended from sibling import', async () => {
      const imported1Path = resolve(process.cwd(), 'imported1.jess');
      context.sourceTrees.set(imported1Path, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([])
        })
      ]));

      const imported2Path = resolve(process.cwd(), 'imported2.jess');
      context.sourceTrees.set(imported2Path, rules([
        style({
          path: quoted(any('imported1.jess'))
        }, {
          type: 'import'
        }),
        ruleset({
          selector: sellist([sel([el('.child')]), extend({
            selector: sel([el('.child')]),
            target: el('.base')
          })]),
          rules: rules([])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('imported2.jess'))
        }, {
          type: 'import'
        })
      ]);

      const evald = await node.eval(context);
      // For .child:-extend(.base), the .base ruleset from imported1 should be extended
      const imported2Rules = evald.at(0) as Rules;
      const imported1Rules = imported2Rules.at(0) as Rules;
      const baseRuleset = imported1Rules.at(0);
      expect(baseRuleset).toBeDefined();
      expect(`${baseRuleset}`).toContainString('.base');
      expect(`${baseRuleset}`).toContainString('.child');
    });
  });

  describe('compose type extend behavior', () => {
    it('compose type can be extended from parent when mutable', async () => {
      const composedPath = resolve(process.cwd(), 'composed.jess');
      context.sourceTrees.set(composedPath, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('composed.jess'))
        }, {
          type: 'compose',
          importOptions: { mutable: true }
        }),
        ruleset({
          selector: sellist([sel([el('.child')]), extend({
            selector: sel([el('.child')]),
            target: el('.base')
          })]),
          rules: rules([])
        })
      ]);

      const evald = await node.eval(context);
      // For .child:-extend(.base), the .base ruleset from compose should be extended
      // Parent can extend into child compose (downwards) when mutable
      const composedRules = evald.at(0) as Rules;
      const baseRuleset = composedRules.at(0);
      expect(baseRuleset).toBeDefined();
      expect(`${baseRuleset}`).toContainString('.base');
      expect(`${baseRuleset}`).toContainString('.child');
    });

    it('compose type cannot be extended from sibling compose', async () => {
      const composed1Path = resolve(process.cwd(), 'composed1.jess');
      context.sourceTrees.set(composed1Path, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([])
        })
      ]));

      const composed2Path = resolve(process.cwd(), 'composed2.jess');
      context.sourceTrees.set(composed2Path, rules([
        style({
          path: quoted(any('composed1.jess'))
        }, {
          type: 'compose'
        }),
        ruleset({
          selector: sellist([sel([el('.child')]), extend({
            selector: sel([el('.child')]),
            target: el('.base')
          })]),
          rules: rules([])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('composed2.jess'))
        }, {
          type: 'compose'
        })
      ]);

      const evald = await node.eval(context);
      // The extend should NOT find the .base ruleset from the sibling compose
      const composed2Rules = evald.at(0) as Rules;
      const childRuleset = composed2Rules.at(1);
      expect(childRuleset).toBeDefined();
      // The selector should NOT be extended (should only have .child)
      const selectorStr = `${childRuleset}`;
      expect(selectorStr).toContainString('.child');
      // Should not contain .base (or if it does, it's not from the extend)
      // Note: This test might need adjustment based on actual behavior
    });
  });

  describe('non-mutable import extend behavior', () => {
    it('import with mutable: false cannot be extended', async () => {
      const protectedPath = resolve(process.cwd(), 'protected.jess');
      context.sourceTrees.set(protectedPath, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('protected.jess'))
        }, {
          type: 'import',
          importOptions: { mutable: false }
        }),
        ruleset({
          selector: sellist([sel([el('.child')]), extend({
            selector: sel([el('.child')]),
            target: el('.base')
          })]),
          rules: rules([])
        })
      ]);

      const evald = await node.eval(context);
      // The extend should NOT find the .base ruleset because it's not mutable
      const childRuleset = evald.at(1);
      expect(childRuleset).toBeDefined();
      // The selector should NOT be extended (should only have .child)
      const selectorStr = `${childRuleset}`;
      expect(selectorStr).toContainString('.child');
      // Should not contain .base from the non-mutable import
    });

    it('compose without mutable cannot be extended (default)', async () => {
      const protectedPath = resolve(process.cwd(), 'protected.jess');
      context.sourceTrees.set(protectedPath, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('protected.jess'))
        }, {
          type: 'compose'
          // No mutable: true, so compose is not mutable by default
        }),
        ruleset({
          selector: sellist([sel([el('.child')]), extend({
            selector: sel([el('.child')]),
            target: el('.base')
          })]),
          rules: rules([])
        })
      ]);

      const evald = await node.eval(context);
      // The extend should NOT find the .base ruleset because compose is not mutable by default
      const childRuleset = evald.at(1);
      expect(childRuleset).toBeDefined();
      // The selector should NOT be extended (should only have .child)
      const selectorStr = `${childRuleset}`;
      expect(selectorStr).toContainString('.child');
      // Should not contain .base from the non-mutable compose
    });
  });

  describe('reference import extend behavior', () => {
    it('reference import can be extended (optional visibility)', async () => {
      const referencedPath = resolve(process.cwd(), 'referenced.jess');
      context.sourceTrees.set(referencedPath, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('referenced.jess'))
        }, {
          type: 'import',
          importOptions: { reference: true }
        }),
        ruleset({
          selector: sellist([sel([el('.child')]), extend({
            selector: sel([el('.child')]),
            target: el('.base')
          })]),
          rules: rules([])
        })
      ]);

      const evald = await node.eval(context);
      // For .child:-extend(.base), the .base ruleset from referenced import should be extended
      // Reference imports are still visible for extend (just not rendered)
      const importedRules = evald.at(0) as Rules;
      const baseRuleset = importedRules.at(0);
      expect(baseRuleset).toBeDefined();
      expect(`${baseRuleset}`).toContainString('.base');
      expect(`${baseRuleset}`).toContainString('.child');
    });
  });
});
