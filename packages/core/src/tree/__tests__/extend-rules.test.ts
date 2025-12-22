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
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            extend({
              target: el('.base')
            }),
            decl({ name: 'background', value: any('blue') })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();
      expect(css).toBeString(`
        .base,
        .child {
          color: red;
        }
        .child {
          background: blue;
        }
      `);
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
          selector: sellist([sel([el('.child1')])]),
          rules: rules([
            extend({
              target: el('.base')
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.child2')])]),
          rules: rules([
            extend({
              target: el('.base')
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();
      expect(css).toBeString(`
        .base,
        .child1,
        .child2 {
          color: red;
        }
      `);
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
          selector: sellist([sel([el('.parent'), co('>'), el('.child')])]),
          rules: rules([
            extend({
              target: el('.base'),
              flag: 1 // ExtendFlag.All for partial matching
            }),
            decl({ name: 'background', value: any('blue') })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();
      expect(css).toBeString(`
        .parent > .base,
        .parent > .child {
          color: red;
        }
        .parent > .child {
          background: blue;
        }
      `);
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
          selector: sellist([sel([compound([el('.btn'), el('.secondary')])])]),
          rules: rules([
            extend({
              target: compound([el('.btn'), el('.primary')])
            }),
            decl({ name: 'background', value: any('blue') })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();
      expect(css).toBeString(`
        .btn.primary,
        .btn.secondary {
          color: red;
        }
        .btn.secondary {
          background: blue;
        }
      `);
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
          selector: sellist([sel([compound([el('.btn'), pseudo({ name: ':hover' })])])]),
          rules: rules([
            extend({
              target: compound([el('.btn'), pseudo({ name: ':hover' })])
            }),
            decl({ name: 'background', value: any('blue') })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();
      expect(css).toBeString(`
        .btn:hover {
          color: red;
        }
        .btn:hover {
          background: blue;
        }
      `);
    });
  });
});
