import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import {
  rules,
  ruleset,
  sel,
  el,
  sellist,
  decl,
  extend,
  any,
  co,
  compound,
  pseudo,
  Node
} from '..';
import { Context } from '../../context';

let context: Context;

describe('Rules extend', () => {
  beforeAll(() => {
    Node.prototype.fullRender = true;
  });

  beforeEach(() => {
    context = new Context();
  });

  describe('basic extend', () => {
    it('should extend a ruleset within the same file', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: 'color', value: any('red') })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.child')]), extend({
            selector: sel([el('.child')]),
            target: el('.base')
          })]),
          rules: rules([
            decl({ name: 'background', value: any('blue') })
          ])
        })
      ]);

      const evald = await node.eval(context);
      // For .child:-extend(.base), the .base ruleset should be extended with .child
      const baseRuleset = evald.at(0);
      expect(baseRuleset).toBeDefined();
      expect(`${baseRuleset}`).toContainString('.base');
      expect(`${baseRuleset}`).toContainString('.child');
    });
  });

  describe('multiple extends', () => {
    it('should handle multiple extends in the same file', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: 'color', value: any('red') })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.child1')]), extend({
            selector: sel([el('.child1')]),
            target: el('.base')
          })]),
          rules: rules([])
        }),
        ruleset({
          selector: sellist([sel([el('.child2')]), extend({
            selector: sel([el('.child2')]),
            target: el('.base')
          })]),
          rules: rules([])
        })
      ]);

      const evald = await node.eval(context);
      // For .child1:-extend(.base) and .child2:-extend(.base),
      // the .base ruleset should be extended with both .child1 and .child2
      const baseRuleset = evald.at(0);
      expect(`${baseRuleset}`).toContainString('.base');
      expect(`${baseRuleset}`).toContainString('.child1');
      expect(`${baseRuleset}`).toContainString('.child2');
    });
  });

  describe('partial extend', () => {
    it('should handle partial extend (all flag)', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([el('.parent'), co('>'), el('.base')])]),
          rules: rules([
            decl({ name: 'color', value: any('red') })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.parent'), co('>'), el('.child')]), extend({
            selector: sel([el('.parent'), co('>'), el('.child')]),
            target: el('.base'),
            flag: 1 // ExtendFlag.All for partial matching
          })]),
          rules: rules([
            decl({ name: 'background', value: any('blue') })
          ])
        })
      ]);

      const evald = await node.eval(context);
      // For .parent > .child:-extend(.base all), the .parent > .base ruleset
      // should be extended with .parent > .child
      const baseRuleset = evald.at(0);
      expect(baseRuleset).toBeDefined();
      expect(`${baseRuleset}`).toContainString('.base');
      expect(`${baseRuleset}`).toContainString('.child');
    });
  });

  describe('complex selectors', () => {
    it('should extend compound selectors', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([compound([el('.btn'), el('.primary')])])]),
          rules: rules([
            decl({ name: 'color', value: any('red') })
          ])
        }),
        ruleset({
          selector: sellist([sel([compound([el('.btn'), el('.secondary')])]), extend({
            selector: sel([compound([el('.btn'), el('.secondary')])]),
            target: compound([el('.btn'), el('.primary')])
          })]),
          rules: rules([
            decl({ name: 'background', value: any('blue') })
          ])
        })
      ]);

      const evald = await node.eval(context);
      // For .btn.secondary:-extend(.btn.primary), the .btn.primary ruleset
      // should be extended with .btn.secondary
      const primaryRuleset = evald.at(0);
      expect(primaryRuleset).toBeDefined();
      expect(`${primaryRuleset}`).toContainString('.primary');
      expect(`${primaryRuleset}`).toContainString('.secondary');
    });

    it('should extend selectors with pseudo-classes', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([compound([el('.btn'), pseudo({ name: ':hover' })])])]),
          rules: rules([
            decl({ name: 'color', value: any('red') })
          ])
        }),
        ruleset({
          selector: sellist([sel([compound([el('.btn'), pseudo({ name: ':hover' })])]), extend({
            selector: sel([compound([el('.btn'), pseudo({ name: ':hover' })])]),
            target: compound([el('.btn'), pseudo({ name: ':hover' })])
          })]),
          rules: rules([
            decl({ name: 'background', value: any('blue') })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const extendedRuleset = evald.at(1);
      expect(extendedRuleset).toBeDefined();
      // Should still contain the pseudo-class
      expect(`${extendedRuleset}`).toContainString(':hover');
    });
  });
});
