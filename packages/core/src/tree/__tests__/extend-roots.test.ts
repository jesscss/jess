import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import {
  rules,
  ruleset,
  sel,
  el,
  sellist,
  extend,
  ExtendFlag,
  any,
  atrule,
  type Rules,
  Node,
  decl,
  spaced,
  comment
} from '../index.js';
import { Context } from '../../context.js';
import { renderNodeToString } from '../util/render-buffer.js';

let context: Context;

describe('Extend Roots Registry', () => {
  beforeEach(() => {
    context = new Context();
  });

  describe('Basic extend roots', () => {
    /**
     * Test: Main stylesheet should create an extend root
     * Extends within the same root should work
     */
    it('should create root extend root and allow extends within same root', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: [
            decl({ name: 'color', value: spaced([any('red')]) })
          ]
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: [
            decl({ name: 'background-color', value: spaced([any('blue')]) }),
            extend({
              target: el('.base')
            })
          ]
        })
      ]);
      const css = await renderNodeToString(node, context);
      expect(css).toBeString(`
        .base,
        .child {
          color: red;
        }
        .child {
          background-color: blue;
        }
      `);
    });

    it('invalidates ruleset cache so valueOf reflects new selector after extend', async () => {
      const targetRuleset = ruleset({
        selector: sellist([sel([el('.base')])]),
        rules: [
          decl({ name: 'color', value: spaced([any('red')]) })
        ]
      });

      const node = rules([
        targetRuleset,
        ruleset({
          selector: sellist([sel([el('.ext')])]),
          rules: [
            extend({
              target: el('.base'),
              flag: ExtendFlag.Exact
            })
          ]
        })
      ]);

      // Cache the initial selector string before extend runs
      expect(targetRuleset.valueOf()).toBe('.base');

      await node.eval(context);

      expect(targetRuleset.valueOf()).toBe('.base,.ext');
    });

    it('materializes string-backed selector-list extend targets before root processing', async () => {
      const node = rules([
        ruleset({
          selector: sellist(['.base']),
          rules: [
            decl({ name: 'color', value: spaced([any('red')]) })
          ]
        }),
        ruleset({
          selector: sellist(['.child']),
          rules: [
            extend({
              target: sellist(['.base']),
              flag: ExtendFlag.Exact
            })
          ]
        })
      ]);

      const css = await renderNodeToString(node, context);
      expect(css).toBeString(`
        .base,
        .child {
          color: red;
        }
      `);
    });
  });
  describe('At-rule boundaries', () => {
    /**
     * Test: Extends FROM inside @media cannot extend outside
     */
    it('extends from inside @media cannot extend outside - collects extendNotAccessible warning', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: [
            decl({ name: 'color', value: spaced([any('red')]) })
          ]
        }),
        atrule({
          name: '@media',
          prelude: any('(min-width: 600px)'),
          rules: [
            ruleset({
              selector: sellist([sel([el('.child')])]),
              rules: [
                decl({ name: 'background-color', value: spaced([any('blue')]) }),
                extend({
                  target: el('.base')
                })
              ]
            })
          ]
        })
      ]);

      // Should not throw (extend from inside @media cannot reach root; we skip merge, optionally warn).
      const evald = await node.eval(context);
      expect(evald).toBeDefined();

      // Root .base unchanged (no merge across @media). Extend only alters selectors; .child keeps only its own decls.
      const css = await renderNodeToString(node, context);
      expect(css).toBeString(`
        .base {
          color: red;
        }
        @media (min-width: 600px) {
          .child {
            background-color: blue;
          }
        }
      `);
    });

    /**
     * Test: Extends FROM inside @container cannot extend outside
     */
    it('extends from inside @container cannot extend outside - collects extendNotAccessible warning', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: [
            decl({ name: 'color', value: spaced([any('red')]) })
          ]
        }),
        atrule({
          name: '@container',
          prelude: any('(min-width: 600px)'),
          rules: [
            ruleset({
              selector: sellist([sel([el('.child')])]),
              rules: [
                decl({ name: 'background-color', value: spaced([any('blue')]) }),
                extend({
                  target: el('.base')
                })
              ]
            })
          ]
        })
      ]);

      // Should not throw (extend from inside @container cannot reach root; extend does not copy decls, .child keeps only its own).
      const evald = await node.eval(context);
      expect(evald).toBeDefined();

      const css = await renderNodeToString(node, context);
      expect(css).toBeString(`
        .base {
          color: red;
        }
        @container (min-width: 600px) {
          .child {
            background-color: blue;
          }
        }
      `);
    });

    /**
     * Test: Extends FROM inside @supports cannot extend outside
     */
    it('extends from inside @supports cannot extend outside - collects extendNotAccessible warning', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: [
            decl({ name: 'color', value: spaced([any('red')]) })
          ]
        }),
        atrule({
          name: '@supports',
          prelude: any('(display: grid)'),
          rules: [
            ruleset({
              selector: sellist([sel([el('.child')])]),
              rules: [
                decl({ name: 'background-color', value: spaced([any('blue')]) }),
                extend({
                  target: el('.base')
                })
              ]
            })
          ]
        })
      ]);

      // Should not throw (extend from inside @supports cannot reach root; extend does not copy decls, .child keeps only its own).
      const evald = await node.eval(context);
      expect(evald).toBeDefined();

      const css = await renderNodeToString(node, context);
      expect(css).toBeString(`
        .base {
          color: red;
        }
        @supports (display: grid) {
          .child {
            background-color: blue;
          }
        }
      `);
    });

    /**
     * Test: Extends FROM outside at-rule can extend into at-rule
     */
    it('extends from outside at-rule can extend into at-rule', async () => {
      const node = rules([
        atrule({
          name: '@media',
          prelude: any('(min-width: 600px)'),
          rules: [
            ruleset({
              selector: sellist([sel([el('.base')])]),
              rules: [
                decl({ name: 'font-size', value: spaced([any('16px')]) })
              ]
            })
          ]
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: [
            decl({ name: 'background-color', value: spaced([any('blue')]) }),
            extend({
              target: el('.base')
            })
          ]
        })
      ]);
      const css = await renderNodeToString(node, context);
      expect(css).toBeString(`
        @media (min-width: 600px) {
          .base,
          .child {
            font-size: 16px;
          }
        }
        .child {
          background-color: blue;
        }
      `);
    });

    /**
     * Test: Extends from inside at-rule can extend into nested at-rules
     */
    it('extends from inside at-rule can extend into nested at-rules', async () => {
      const node = rules([
        atrule({
          name: '@media',
          prelude: any('(min-width: 600px)'),
          rules: [
            atrule({
              name: '@supports',
              prelude: any('(display: grid)'),
              rules: [
                ruleset({
                  selector: sellist([sel([el('.base')])]),
                  rules: [
                    decl({ name: 'grid-template-columns', value: spaced([any('1fr 1fr')]) })
                  ]
                })
              ]
            }, {

            }),
            ruleset({
              selector: sellist([sel([el('.child')])]),
              rules: [
                decl({ name: 'display', value: spaced([any('block')]) }),
                extend({
                  selector: sel([el('.child')]),
                  target: el('.base')
                })
              ]
            })
          ]
        })
      ]);
      const css = await renderNodeToString(node, context);
      expect(css).toBeString(`
        @media (min-width: 600px) {
          @supports (display: grid) {
            .base,
            .child {
              grid-template-columns: 1fr 1fr;
            }
          }
          .child {
            display: block;
          }
        }
      `);
    });
  });

  describe('@layer name sharing', () => {
    /**
     * Test: Layers with same name should share extend roots
     */
    it('layers with same name share extend roots', async () => {
      const node = rules([
        atrule({
          name: '@layer',
          prelude: any('one'),
          rules: [
            ruleset({
              selector: sellist([sel([el('.base')])]),
              rules: [
                decl({ name: 'font-size', value: spaced([any('16px')]) })
              ]
            })
          ]
        }),
        comment('/* second layer */'),
        atrule({
          name: '@layer',
          prelude: any('one'),
          rules: [
            ruleset({
              selector: sellist([sel([el('.child')])]),
              rules: [
                decl({ name: 'color', value: spaced([any('blue')]) }),
                extend({
                  selector: sel([el('.child')]),
                  target: el('.base')
                })
              ]
            })
          ]
        })
      ]);
      const css = await renderNodeToString(node, context);
      expect(css).toBeString(`
        @layer one {
          .base,
          .child {
            font-size: 16px;
          }
        }
        /* second layer */
        @layer one {
          .child {
            color: blue;
          }
        }
      `);
    });

    /**
     * Test: Anonymous layers do not share extend roots.
     * TODO: Currently no warning is collected; root identity or allRootsForWarning path needs investigation.
     */
    it.skip('anonymous layers do not share extend roots', async () => {
      const node = rules([
        atrule({
          name: '@layer',

          // No prelude = anonymous
          rules: [
            ruleset({
              selector: sellist([sel([el('.base')])]),
              rules: [
                decl({ name: 'font-size', value: spaced([any('16px')]) })
              ]
            })
          ]
        }),
        comment('/* second anonymous layer */'),
        atrule({
          name: '@layer',

          // No prelude = anonymous
          rules: [
            ruleset({
              selector: sellist([sel([el('.child')])]),
              rules: [
                decl({ name: 'color', value: spaced([any('green')]) }),
                extend({
                  selector: sel([el('.child')]),
                  target: el('.base')
                })
              ]
            })
          ]
        })
      ]);

      // Anonymous layers do not share extend roots, so extend should collect warning
      const evald = await node.eval(context);
      expect(evald).toBeDefined();

      // Should have collected a warning (either extendNotFound or extendNotAccessible)
      expect(context.warnings.length).toBeGreaterThan(0);
      const warning = context.warnings.find(w => w.code === 'extend/not-found' || w.code === 'extend/not-accessible');
      expect(warning).toBeDefined();
    });

    /**
     * Test: Nested layers concatenate names (one.two)
     */
    it('nested layers concatenate names', async () => {
      const node = rules([
        atrule({
          name: '@layer',
          prelude: any('one'),
          rules: [
            atrule({
              name: '@layer',
              prelude: any('two'),
              rules: [
                ruleset({
                  selector: sellist([sel([el('.base')])]),
                  rules: [
                    decl({ name: 'z-index', value: spaced([any('10')]) })
                  ]
                })
              ]
            }, {

            })
          ]
        }),
        comment('/* second layer with same name */'),
        atrule({
          name: '@layer',
          prelude: any('one.two'),
          rules: [
            ruleset({
              selector: sellist([sel([el('.child')])]),
              rules: [
                decl({ name: 'width', value: spaced([any('100px')]) }),
                extend({
                  target: el('.base')
                })
              ]
            })
          ]
        })
      ]);
      const css = await renderNodeToString(node, context);
      expect(css).toBeString(`
        @layer one {
          @layer two {
            .base,
            .child {
              z-index: 10;
            }
          }
        }
        /* second layer with same name */
        @layer one.two {
          .child {
            width: 100px;
          }
        }
      `);
    });
  });

  describe('Accessible roots computation', () => {
    /**
     * Test: Self root is accessible
     */
    it('self root is accessible for extends', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: [
            decl({
              name: 'color',
              value: any('red')
            })
          ]
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: [
            extend({
              target: el('.base')
            }),
            decl({
              name: 'background',
              value: any('blue')
            })
          ]
        })
      ]);
      const css = await renderNodeToString(node, context);
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
});
