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
  Node,
  ExtendFlag
} from '../index.js';
import { Context } from '../../context.js';
import { getParent } from '../util/field-helpers.js';
import { F_EXTENDED } from '../node.js';
import { processExtends } from '../util/extend-roots.js';

let context: Context;

describe('Rules extend', () => {
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

    it('keeps canonical ruleset extended flags unset during state-only extend processing', async () => {
      const base = ruleset({
        selector: sellist([sel([el('.base')])]),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });
      const child = ruleset({
        selector: sellist([sel([el('.child')])]),
        rules: rules([
          extend({
            target: el('.base')
          })
        ])
      });
      const node = rules([base, child]);

      const evald = await node.eval(context);
      const css = evald.render(context);
      const evaluatedBase = evald.get('value').find(child => child.sourceNode === base);

      expect(css).toContain('.base,');
      expect(css).toContain('.child {');
      expect(base.hasFlag(F_EXTENDED)).toBe(false);
      expect(evaluatedBase).toBeDefined();
      expect(evaluatedBase?.hasFlag(F_EXTENDED)).toBe(true);
    });

    it('does not re-parent canonical selector or target during a shallow clone', () => {
      const target = el('.base');
      const selector = el('.child');
      const node = extend({
        selector,
        target
      });

      expect(selector.parent).toBe(node);
      expect(target.parent).toBe(node);

      const cloned = node.clone();

      expect(cloned).not.toBe(node);
      expect(selector.parent).toBe(node);
      expect(target.parent).toBe(node);
      expect(getParent(selector, context)).toBe(cloned);
      expect(getParent(target, context)).toBe(cloned);
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
      const css = evald.render(context);
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
              flag: ExtendFlag.All // ExtendFlag.All for partial matching
            }),
            decl({ name: 'background', value: any('blue') })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
      expect(css).toBeString(`
        .parent > :is(.base, .parent > .child) {
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
      const css = evald.render(context);
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
      const css = evald.render(context);
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

  describe('extend chaining', () => {
    it('should chain simple extends: .a -> .b -> .c', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: rules([
            decl({ name: 'color', value: any('black') })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.b')])]),
          rules: rules([
            extend({
              target: el('.a')
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.c')])]),
          rules: rules([
            extend({
              target: el('.b')
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
      expect(css).toBeString(`
        .a,
        .b,
        .c {
          color: black;
        }
      `);
    });

    it('should chain extends regardless of order: .d -> .e -> .f (reverse order)', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([el('.d')])]),
          rules: rules([
            extend({
              target: el('.e')
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.e')])]),
          rules: rules([
            extend({
              target: el('.f')
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.f')])]),
          rules: rules([
            decl({ name: 'color', value: any('black') })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
      expect(css).toBeString(`
        .f,
        .e,
        .d {
          color: black;
        }
      `);
    });

    it('should chain multiple levels: .l -> .m -> .n -> .o -> .p -> .q -> .r -> .s -> .t', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([el('.l')])]),
          rules: rules([
            decl({ name: 'color', value: any('black') })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.m')])]),
          rules: rules([
            extend({
              target: el('.l')
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.n')])]),
          rules: rules([
            extend({
              target: el('.m')
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.o')])]),
          rules: rules([
            extend({
              target: el('.n')
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.p')])]),
          rules: rules([
            extend({
              target: el('.o')
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.q')])]),
          rules: rules([
            extend({
              target: el('.p')
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.r')])]),
          rules: rules([
            extend({
              target: el('.q')
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.s')])]),
          rules: rules([
            extend({
              target: el('.r')
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.t')])]),
          rules: rules([
            extend({
              target: el('.s')
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
      expect(css).toBeString(`
        .l,
        .m,
        .n,
        .o,
        .p,
        .q,
        .r,
        .s,
        .t {
          color: black;
        }
      `);
    });

    it('should handle circular references: .x -> .y -> .z -> .x', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([el('.x')])]),
          rules: rules([
            extend({
              target: el('.z')
            }),
            decl({ name: 'color', value: any('x') })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.y')])]),
          rules: rules([
            extend({
              target: el('.x')
            }),
            decl({ name: 'color', value: any('y') })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.z')])]),
          rules: rules([
            extend({
              target: el('.y')
            }),
            decl({ name: 'color', value: any('z') })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
      expect(css).toBeString(`
        .x,
        .y,
        .z {
          color: x;
        }
        .y,
        .z,
        .x {
          color: y;
        }
        .z,
        .x,
        .y {
          color: z;
        }
      `);
    });

    it('should handle extend with all flag chaining: .g.h -> .i.j -> .k', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([compound([el('.g'), el('.h')])])]),
          rules: rules([
            decl({ name: 'color', value: any('black') })
          ])
        }),
        ruleset({
          selector: sellist([sel([compound([el('.i'), el('.j')])])]),
          rules: rules([
            extend({
              target: el('.g'),
              flag: ExtendFlag.All
            }),
            decl({ name: 'color', value: any('inherit') })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.k')])]),
          rules: rules([
            extend({
              target: el('.i'),
              flag: ExtendFlag.All
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
      expect(css).toBeString(`
        :is(.g, :is(.i, .k).j).h {
          color: black;
        }
        :is(.i, .k).j {
          color: inherit;
        }
      `);
    });

    it('should handle extend inside ruleset: .va -> .vb -> .vc', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([el('.va')])]),
          rules: rules([
            decl({ name: 'color', value: any('black') })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.vb')])]),
          rules: rules([
            extend({
              target: el('.va')
            }),
            decl({ name: 'color', value: any('inherit') })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.vc')])]),
          rules: rules([
            extend({
              target: el('.vb')
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
      expect(css).toBeString(`
        .va,
        .vb,
        .vc {
          color: black;
        }
        .vb,
        .vc {
          color: inherit;
        }
      `);
    });

    it('should ignore self-referencing extends: .w:extend(.w)', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([el('.w')])]),
          rules: rules([
            extend({
              target: el('.w')
            }),
            decl({ name: 'color', value: any('black') })
          ])
        }),
        ruleset({
          selector: sellist([sel([compound([el('.v'), el('.w'), el('.v')])])]),
          rules: rules([
            extend({
              target: el('.w'),
              flag: ExtendFlag.All
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
      expect(css).toBeString(`
        .w,
        .v.w.v {
          color: black;
        }
      `);
    });

    it('should handle complex chaining with multiple branches', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: 'color', value: any('red') })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.branch1')])]),
          rules: rules([
            extend({
              target: el('.base')
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.branch2')])]),
          rules: rules([
            extend({
              target: el('.base')
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.chain1')])]),
          rules: rules([
            extend({
              target: el('.branch1')
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.chain2')])]),
          rules: rules([
            extend({
              target: el('.branch2')
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
      expect(css).toBeString(`
        .base,
        .branch1,
        .branch2,
        .chain1,
        .chain2 {
          color: red;
        }
      `);
    });

    it('limits downstream extend matching to roots inside the recorded namespace', () => {
      const localBase = ruleset({
        selector: sellist([sel([el('.base')])]),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });
      const localRoot = rules([localBase]);

      const importedBase = ruleset({
        selector: sellist([sel([el('.base')])]),
        rules: rules([
          decl({ name: 'color', value: any('blue') })
        ])
      });
      const importedRoot = rules([importedBase]);

      const child = ruleset({
        selector: sellist([sel([el('.child')])]),
        rules: rules([])
      });
      const extension = extend({
        target: el('.base'),
        namespace: 'theme'
      });
      const ownerRoot = rules([child]);

      context.extendRoots.registerRoot(localRoot);
      context.extendRoots.registerRoot(importedRoot, undefined, { namespace: 'theme' });
      context.extendRoots.registerRoot(ownerRoot);
      context.extendRoots.registerRuleset(localRoot, localBase);
      context.extendRoots.registerRuleset(importedRoot, importedBase);
      context.extendRoots.registerRuleset(ownerRoot, child);

      context.extends = [[
        extension.get('target'),
        child.getEffectiveSelector(false, context),
        false,
        ownerRoot,
        extension,
        undefined,
        false,
        'theme'
      ]];

      processExtends(context);

      expect(importedBase.valueOf(context)).toContain('.child');
      expect(localBase.valueOf(context)).not.toContain('.child');
      expect(context.warnings).toHaveLength(0);
    });

    it('treats a namespace miss as not-found, not not-accessible', () => {
      const localBase = ruleset({
        selector: sellist([sel([el('.base')])]),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });
      const localRoot = rules([localBase]);

      const importedBase = ruleset({
        selector: sellist([sel([el('.base')])]),
        rules: rules([
          decl({ name: 'color', value: any('blue') })
        ])
      });
      const importedRoot = rules([importedBase]);

      const child = ruleset({
        selector: sellist([sel([el('.child')])]),
        rules: rules([])
      });
      const extension = extend({
        target: el('.base'),
        namespace: 'missing'
      });
      const ownerRoot = rules([child]);

      context.extendRoots.registerRoot(localRoot);
      context.extendRoots.registerRoot(importedRoot, undefined, { namespace: 'theme' });
      context.extendRoots.registerRoot(ownerRoot);
      context.extendRoots.registerRuleset(localRoot, localBase);
      context.extendRoots.registerRuleset(importedRoot, importedBase);
      context.extendRoots.registerRuleset(ownerRoot, child);

      context.extends = [[
        extension.get('target'),
        child.getEffectiveSelector(false, context),
        false,
        ownerRoot,
        extension,
        undefined,
        false,
        'missing'
      ]];

      processExtends(context);

      expect(context.warnings).toHaveLength(1);
      expect(context.warnings[0]?.code).toBe('extend/not-found');
    });
  });
});
