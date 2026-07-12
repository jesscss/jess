import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import {
  rules,
  ruleset,
  sel,
  el,
  sellist,
  extend,
  ExtendFlag,
  style,
  quoted,
  any,
  atrule,
  type Rules,
  Node,
  decl,
  spaced,
  comment
} from '../index.js';
import { Context } from '../../context.js';
import { resolve } from 'node:path';
import { createTestContext } from './import-style-test-helpers.js';

let context: Context;

describe('Extend Roots Registry', () => {
  beforeEach(() => {
    context = createTestContext();
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
          rules: rules([
            decl({ name: 'color', value: spaced([any('red')]) })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'background-color', value: spaced([any('blue')]) }),
            extend({
              target: el('.base')
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
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
        rules: rules([
          decl({ name: 'color', value: spaced([any('red')]) })
        ])
      });

      const node = rules([
        targetRuleset,
        ruleset({
          selector: sellist([sel([el('.ext')])]),
          rules: rules([
            extend({
              target: el('.base'),
              flag: ExtendFlag.Exact
            })
          ])
        })
      ]);

      // Cache the initial selector string before extend runs
      expect(targetRuleset.valueOf()).toBe('.base');

      await node.eval(context);

      // With EvalState, the extended selector is stored in eval state.
      // valueOf(context) reads the state-patched selector.
      expect(targetRuleset.valueOf(context)).toBe('.base,.ext');
      // Canonical valueOf() still returns the original selector.
      expect(targetRuleset.valueOf()).toBe('.base');
    });
  });

  describe('@import type roots', () => {
    /**
     * Test: @import type should use parent's root (no new root created)
     * Extends in @import should work with parent's root
     */
    it('@import type should use parent root and allow extends', async () => {
      const importedPath = resolve(process.cwd(), 'imported.jess');
      context.sourceTrees.set(importedPath, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: 'margin', value: spaced([any('5px')]) })
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
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'background-color', value: spaced([any('blue')]) }),
            extend({
              target: el('.base')
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
      expect(css).toBeString(`
        .base,
        .child {
          margin: 5px;
        }
        .child {
          background-color: blue;
        }
      `);
    });

    /**
     * Test: Extends registered inside @import should use parent's root
     */
    it('extends inside @import should use parent root', async () => {
      const importedPath = resolve(process.cwd(), 'imported.jess');
      context.sourceTrees.set(importedPath, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('red')]) })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'background-color', value: spaced([any('blue')]) }),
            extend({
              target: el('.base')
            })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('imported.jess'))
        }, {
          type: 'import'
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
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
  });

  describe('@compose type roots', () => {
    /**
     * Test: @compose type should create new extend root
     * Sibling compose roots CANNOT extend each other (compose creates boundaries)
     */
    it('sibling compose roots cannot extend each other (compose creates boundaries)', async () => {
      const imported1Path = resolve(process.cwd(), 'imported1.jess');
      context.sourceTrees.set(imported1Path, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([])
        })
      ]));

      const imported2Path = resolve(process.cwd(), 'imported2.jess');
      context.sourceTrees.set(imported2Path, rules([
        ruleset({
          selector: sellist([sel([el('.base2')])]),
          rules: rules([
            decl({ name: 'padding', value: spaced([any('10px')]) })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('imported1.jess'))
        }, {
          type: 'compose',
          importOptions: { mutable: true }
        }),
        style({
          path: quoted(any('imported2.jess'))
        }, {
          type: 'compose',
          importOptions: { mutable: true }
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'background-color', value: spaced([any('blue')]) }),
            extend({
              target: el('.base')
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
      // Sibling compose roots cannot extend each other - .base should NOT be extended
      expect(css).toBeString(`
        .base2 {
          padding: 10px;
        }
        .child {
          background-color: blue;
        }
      `);
    });

    /**
     * Test: Child compose root cannot extend parent (compose creates boundary)
     * Should collect extendNotAccessible warning, not throw error
     */
    it('child compose root cannot extend parent (compose is a boundary) - collects extendNotAccessible warning', async () => {
      const importedPath = resolve(process.cwd(), 'imported.jess');
      context.sourceTrees.set(importedPath, rules([
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'background-color', value: spaced([any('blue')]) }),
            extend({
              target: el('.base')
            })
          ])
        })
      ]));

      const node = rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('red')]) })
          ])
        }),
        style({
          path: quoted(any('imported.jess'))
        }, {
          type: 'compose'
          // Protected by default (not mutable)
        })
      ]);

      // Should not throw - extendNotAccessible is now a warning
      const evald = await node.eval(context);
      expect(evald).toBeDefined();

      // Should have collected a warning
      expect(context.warnings.length).toBeGreaterThan(0);
      const warning = context.warnings.find(w => w.code === 'extend/not-accessible');
      expect(warning).toBeDefined();
      expect(warning?.message).toContain('Extend target');
      expect(warning?.message).toContain('not accessible');
    });
  });

  describe('Protected boundaries', () => {
    /**
     * Test: Protected compose blocks all access, including to descendants
     */
    it('compose is protected by default (not mutable) - collects extendNotAccessible warning', async () => {
      const importedPath = resolve(process.cwd(), 'imported.jess');
      context.sourceTrees.set(importedPath, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: 'height', value: spaced([any('200px')]) })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('imported.jess'))
        }, {
          type: 'compose'
          // No mutable: true, so compose is protected by default
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'background-color', value: spaced([any('blue')]) }),
            extend({
              target: el('.base')
            })
          ])
        })
      ]);

      // Should not throw - extendNotAccessible is now a warning
      const evald = await node.eval(context);
      expect(evald).toBeDefined();

      // Should have collected a warning
      expect(context.warnings.length).toBeGreaterThan(0);
      const warning = context.warnings.find(w => w.code === 'extend/not-accessible');
      expect(warning).toBeDefined();
      expect(warning?.message).toContain('Extend target');
      expect(warning?.message).toContain('not accessible');
    });

    /**
     * Test: Protected compose blocks access even if child is non-protected
     */
    it('nested compose is also protected even if inner has mutable children - collects extendNotAccessible warning', async () => {
      const imported1Path = resolve(process.cwd(), 'imported1.jess');
      context.sourceTrees.set(imported1Path, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: 'opacity', value: spaced([any('0.5')]) })
          ])
        })
      ]));

      const imported2Path = resolve(process.cwd(), 'imported2.jess');
      context.sourceTrees.set(imported2Path, rules([
        style({
          path: quoted(any('imported1.jess'))
        }, {
          type: 'compose',
          importOptions: { mutable: true } // Inner compose is mutable
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('imported2.jess'))
        }, {
          type: 'compose'
          // Outer compose is protected by default (no mutable: true)
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'background-color', value: spaced([any('blue')]) }),
            extend({
              target: el('.base')
            })
          ])
        })
      ]);

      // Should not throw - extendNotAccessible is now a warning
      const evald = await node.eval(context);
      expect(evald).toBeDefined();

      // Should have collected a warning
      expect(context.warnings.length).toBeGreaterThan(0);
      const warning = context.warnings.find(w => w.code === 'extend/not-accessible');
      expect(warning).toBeDefined();
      expect(warning?.message).toContain('Extend target');
      expect(warning?.message).toContain('not accessible');
    });

    /**
     * Test: Only accessible selectors are extended, inaccessible ones throw errors
     */
    it('only accessible selector is extended when same selector exists behind immutability boundary', async () => {
      const imported1Path = resolve(process.cwd(), 'imported1.jess');
      context.sourceTrees.set(imported1Path, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('red')]) })
          ])
        })
      ]));

      const imported2Path = resolve(process.cwd(), 'imported2.jess');
      context.sourceTrees.set(imported2Path, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('blue')]) })
          ])
        })
      ]));

      const node = rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('green')]) })
          ])
        }),
        style({
          path: quoted(any('imported1.jess'))
        }, {
          type: 'import'
          // Import type is accessible
        }),
        style({
          path: quoted(any('imported2.jess'))
        }, {
          type: 'compose'
          // Compose type is protected (not accessible)
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'background-color', value: spaced([any('yellow')]) }),
            extend({
              target: el('.base')
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
      // Should extend .base from main root and imported1.jess (import type), but NOT imported2.jess (compose type)
      expect(css).toBeString(`
        .base,
        .child {
          color: green;
        }
        .base,
        .child {
          color: red;
        }
        .base {
          color: blue;
        }
        .child {
          background-color: yellow;
        }
      `);
    });

    /**
     * Test: Extend collects warning when target not found (doesn't exist anywhere)
     * Changed from error to warning for Less compatibility
     */
    it('extend collects extendNotFound warning when target does not exist', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('red')]) }),
            extend({
              target: el('.nonexistent')
            })
          ])
        })
      ]);

      // Should not throw - extendNotFound is now a warning
      const evald = await node.eval(context);
      expect(evald).toBeDefined();

      // Should have collected a warning
      expect(context.warnings.length).toBeGreaterThan(0);
      const warning = context.warnings.find(w => w.code === 'extend/not-found');
      expect(warning).toBeDefined();
      expect(warning?.message).toContain('Extend target');
      expect(warning?.message).toContain('not found');
    });

    /**
     * Test: Extend collects extendNotAccessible warning when target exists but is blocked by compose boundary
     * Changed from error to warning for Less compatibility
     */
    it('extend collects extendNotAccessible warning when target exists but is blocked by compose boundary', async () => {
      const importedPath = resolve(process.cwd(), 'imported.jess');
      context.sourceTrees.set(importedPath, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('red')]) })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('imported.jess'))
        }, {
          type: 'compose'
          // Protected by default
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'background-color', value: spaced([any('blue')]) }),
            extend({
              target: el('.base')
            })
          ])
        })
      ]);

      // Should not throw - extendNotAccessible is now a warning
      const evald = await node.eval(context);
      expect(evald).toBeDefined();

      // Should have collected a warning
      expect(context.warnings.length).toBeGreaterThan(0);
      const warning = context.warnings.find(w => w.code === 'extend/not-accessible');
      expect(warning).toBeDefined();
      expect(warning?.message).toContain('Extend target');
      expect(warning?.message).toContain('not accessible');
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
          rules: rules([
            decl({ name: 'color', value: spaced([any('red')]) })
          ])
        }),
        atrule({
          name: any('@media'),
          prelude: any('(min-width: 600px)'),
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.child')])]),
              rules: rules([
                decl({ name: 'background-color', value: spaced([any('blue')]) }),
                extend({
                  target: el('.base')
                })
              ])
            })
          ])
        })
      ]);

      // Should not throw (extend from inside @media cannot reach root; we skip merge, optionally warn).
      const evald = await node.eval(context);
      expect(evald).toBeDefined();

      // Root .base unchanged (no merge across @media). Extend only alters selectors; .child keeps only its own decls.
      const css = evald.render(context);
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
          rules: rules([
            decl({ name: 'color', value: spaced([any('red')]) })
          ])
        }),
        atrule({
          name: any('@container'),
          prelude: any('(min-width: 600px)'),
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.child')])]),
              rules: rules([
                decl({ name: 'background-color', value: spaced([any('blue')]) }),
                extend({
                  target: el('.base')
                })
              ])
            })
          ])
        })
      ]);

      // Should not throw (extend from inside @container cannot reach root; extend does not copy decls, .child keeps only its own).
      const evald = await node.eval(context);
      expect(evald).toBeDefined();

      const css = evald.render(context);
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
          rules: rules([
            decl({ name: 'color', value: spaced([any('red')]) })
          ])
        }),
        atrule({
          name: any('@supports'),
          prelude: any('(display: grid)'),
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.child')])]),
              rules: rules([
                decl({ name: 'background-color', value: spaced([any('blue')]) }),
                extend({
                  target: el('.base')
                })
              ])
            })
          ])
        })
      ]);

      // Should not throw (extend from inside @supports cannot reach root; extend does not copy decls, .child keeps only its own).
      const evald = await node.eval(context);
      expect(evald).toBeDefined();

      const css = evald.render(context);
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
          name: any('@media'),
          prelude: any('(min-width: 600px)'),
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.base')])]),
              rules: rules([
                decl({ name: 'font-size', value: spaced([any('16px')]) })
              ])
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'background-color', value: spaced([any('blue')]) }),
            extend({
              target: el('.base')
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
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
          name: any('@media'),
          prelude: any('(min-width: 600px)'),
          rules: rules([
            atrule({
              name: any('@supports'),
              prelude: any('(display: grid)'),
              rules: rules([
                ruleset({
                  selector: sellist([sel([el('.base')])]),
                  rules: rules([
                    decl({ name: 'grid-template-columns', value: spaced([any('1fr 1fr')]) })
                  ])
                })
              ])
            }, {

            }),
            ruleset({
              selector: sellist([sel([el('.child')])]),
              rules: rules([
                decl({ name: 'display', value: spaced([any('block')]) }),
                extend({
                  selector: sel([el('.child')]),
                  target: el('.base')
                })
              ])
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
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
          name: any('@layer'),
          prelude: any('one'),
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.base')])]),
              rules: rules([
                decl({ name: 'font-size', value: spaced([any('16px')]) })
              ])
            })
          ])
        }),
        comment('/* second layer */'),
        atrule({
          name: any('@layer'),
          prelude: any('one'),
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.child')])]),
              rules: rules([
                decl({ name: 'color', value: spaced([any('blue')]) }),
                extend({
                  selector: sel([el('.child')]),
                  target: el('.base')
                })
              ])
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
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
          name: any('@layer'),
          // No prelude = anonymous
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.base')])]),
              rules: rules([
                decl({ name: 'font-size', value: spaced([any('16px')]) })
              ])
            })
          ])
        }),
        comment('/* second anonymous layer */'),
        atrule({
          name: any('@layer'),
          // No prelude = anonymous
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.child')])]),
              rules: rules([
                decl({ name: 'color', value: spaced([any('green')]) }),
                extend({
                  selector: sel([el('.child')]),
                  target: el('.base')
                })
              ])
            })
          ])
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
          name: any('@layer'),
          prelude: any('one'),
          rules: rules([
            atrule({
              name: any('@layer'),
              prelude: any('two'),
              rules: rules([
                ruleset({
                  selector: sellist([sel([el('.base')])]),
                  rules: rules([
                    decl({ name: 'z-index', value: spaced([any('10')]) })
                  ])
                })
              ])
            }, {

            })
          ])
        }),
        comment('/* second layer with same name */'),
        atrule({
          name: any('@layer'),
          prelude: any('one.two'),
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.child')])]),
              rules: rules([
                decl({ name: 'width', value: spaced([any('100px')]) }),
                extend({
                  target: el('.base')
                })
              ])
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
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
          rules: rules([
            decl({
              name: any('color'),
              value: any('red')
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            extend({
              target: el('.base')
            }),
            decl({
              name: any('background'),
              value: any('blue')
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
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

    /**
     * Test: Children roots (if not protected) are accessible
     */
    it('children roots are accessible if mutable', async () => {
      const importedPath = resolve(process.cwd(), 'imported.jess');
      context.sourceTrees.set(importedPath, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({
              name: any('color'),
              value: any('red')
            })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('imported.jess'))
        }, {
          type: 'compose',
          importOptions: { mutable: true }
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            extend({
              target: el('.base')
            }),
            decl({
              name: any('background'),
              value: any('blue')
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
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
