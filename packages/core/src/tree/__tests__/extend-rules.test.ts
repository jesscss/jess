import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import {
  rules,
  ruleset,
  sel,
  el,
  amp,
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
import { EvalSession } from '../../eval-session.js';
import { sessionGetField, sessionGetParent, sessionPatchField } from '../util/session-helpers.js';
import { F_EXTENDED, F_IMPLICIT_AMPERSAND, F_VISIBLE } from '../node.js';
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

    it('keeps canonical ruleset extended flags unset during session-only extend processing', async () => {
      context.session = new EvalSession();

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
      const css = evald.toString({ context });

      expect(css).toContain('.base,');
      expect(css).toContain('.child {');
      expect(base.hasFlag(F_EXTENDED)).toBe(false);
      expect(base._hasFlag(F_EXTENDED, context)).toBe(true);
    });

    it('keeps hoistToRoot session-local when extend hoists across an implicit ampersand boundary', async () => {
      context.session = new EvalSession();

      const implicitAmp = amp({ selectorContainer: { selector: el('.header') } });
      (implicitAmp as unknown as { generated?: boolean }).generated = true;
      implicitAmp.addFlag(F_IMPLICIT_AMPERSAND);
      implicitAmp.removeFlag(F_VISIBLE);
      const implicitSpace = co(' ');
      implicitSpace.generated = true;
      implicitSpace.removeFlag(F_VISIBLE);

      const headerNav = ruleset({
        selector: sel([implicitAmp, implicitSpace, el('.header-nav')]) as any,
        rules: rules([])
      });
      const header = ruleset({
        selector: sellist([sel([el('.header')])]),
        rules: rules([headerNav])
      });
      const footerNav = ruleset({
        selector: sellist([sel([el('.footer'), co(' '), el('.footer-nav')])]),
        rules: rules([
          extend({
            target: sel([el('.header'), co(' '), el('.header-nav')]),
            flag: ExtendFlag.All
          })
        ])
      });
      const root = rules([header, footerNav]);

      await root.eval(context);

      expect(sessionGetField(headerNav, 'hoistToRoot', context)).toBe(true);
      expect(headerNav.hoistToRoot).toBeUndefined();
    });

    it('clears a stale session-local hoistToRoot when a later extend pass no longer matches', async () => {
      context.session = new EvalSession();

      const implicitAmp = amp({ selectorContainer: { selector: el('.header') } });
      (implicitAmp as unknown as { generated?: boolean }).generated = true;
      implicitAmp.addFlag(F_IMPLICIT_AMPERSAND);
      implicitAmp.removeFlag(F_VISIBLE);
      const implicitSpace = co(' ');
      implicitSpace.generated = true;
      implicitSpace.removeFlag(F_VISIBLE);

      const headerNav = ruleset({
        selector: sel([implicitAmp, implicitSpace, el('.header-nav')]) as any,
        rules: rules([])
      });
      const header = ruleset({
        selector: sellist([sel([el('.header')])]),
        rules: rules([headerNav])
      });
      const extension = extend({
        target: sel([el('.header'), co(' '), el('.header-nav')]),
        flag: ExtendFlag.All
      });
      const footerNav = ruleset({
        selector: sellist([sel([el('.footer'), co(' '), el('.footer-nav')])]),
        rules: rules([
          extension
        ])
      });
      const miss = extend({
        target: el('.does-not-match')
      });
      const root = rules([header, footerNav]);

      await root.eval(context);

      expect(sessionGetField(headerNav, 'hoistToRoot', context)).toBe(true);

      context.extendRoots.registerRuleset(root, header);
      context.extendRoots.registerRuleset(root, headerNav);
      context.extendRoots.registerRuleset(root, footerNav);
      context.extends = [[
        miss.target,
        footerNav.getEffectiveSelector(false, context),
        false,
        root,
        miss
      ] as any];
      processExtends(context);

      expect(sessionGetField(headerNav, 'hoistToRoot', context)).toBeUndefined();
    });

    it('does not re-parent canonical selector or target during a shallow clone in a session', () => {
      context.createSession();

      const target = el('.base');
      const selector = el('.child');
      const node = extend({
        selector,
        target
      });

      expect(selector.parent).toBe(node);
      expect(target.parent).toBe(node);

      const cloned = node.clone(false, undefined, context);

      expect(cloned).not.toBe(node);
      expect(selector.parent).toBe(node);
      expect(target.parent).toBe(node);
      expect(context.session?.getRuntime(selector).parent).toBe(cloned);
      expect(context.session?.getRuntime(target).parent).toBe(cloned);
    });

    it('preserves session-patched extend fields during clone without mutating the canonical node', () => {
      context.session = new EvalSession();

      const node = extend({
        target: el('.base'),
        namespace: 'base',
        flag: ExtendFlag.Exact
      });

      sessionPatchField(node, 'target', el('.other'), context);
      sessionPatchField(node, 'namespace', 'patched', context);
      sessionPatchField(node, 'flag', ExtendFlag.All, context);

      const cloned = node.clone(false, undefined, context);

      expect(cloned.target.valueOf()).toBe('.other');
      expect(cloned.namespace).toBe('patched');
      expect(cloned.flag).toBe(ExtendFlag.All);
      expect(node.target.valueOf()).toBe('.base');
      expect(node.namespace).toBe('base');
      expect(node.flag).toBe(ExtendFlag.Exact);
    });

    it('registers a session-patched extend target without mutating the canonical extend node', async () => {
      const extension = extend({
        target: el('.base')
      });
      const rootRules = rules([]);

      context.session = new EvalSession();
      context.extendRoots.registerRoot(rootRules);
      context.extendRoots.pushExtendRoot(rootRules);
      sessionPatchField(extension, 'target', el('.other'), context);

      await extension.evalNode(context);

      expect(context.extends).toHaveLength(1);
      expect(context.extends[0]![0].valueOf()).toBe('.other');
      expect(extension.target.valueOf()).toBe('.base');
    });

    it('records a session-patched extend namespace in the instruction tuple without mutating the canonical node', async () => {
      const extension = extend({
        target: el('.base'),
        namespace: 'base'
      });
      const rootRules = rules([]);

      context.session = new EvalSession();
      context.extendRoots.registerRoot(rootRules);
      context.extendRoots.pushExtendRoot(rootRules);
      sessionPatchField(extension, 'namespace', 'patched', context);

      await extension.evalNode(context);

      expect(context.extends).toHaveLength(1);
      expect(context.extends[0]![7]).toBe('patched');
      expect(extension.namespace).toBe('base');
    });

    it('valueOf(context) reflects a session-patched target without mutating the canonical node', () => {
      const extension = extend({
        target: el('.base')
      });

      context.session = new EvalSession();
      sessionPatchField(extension, 'target', el('.other'), context);

      expect(extension.valueOf(context)).toBe('$extend .other');
      expect(extension.valueOf()).toBe('$extend .base');
      expect(extension.target.valueOf()).toBe('.base');
    });

    it('treats a session-patched selector as explicit during extend registration', async () => {
      const extension = extend({
        target: el('.base')
      });
      const rootRules = rules([]);
      const frame = ruleset({
        selector: sellist([sel([el('.child')])]),
        rules: rules([extension])
      });

      context.session = new EvalSession();
      context.extendRoots.registerRoot(rootRules);
      context.extendRoots.pushExtendRoot(rootRules);
      context.rulesetFrames.push(frame);
      sessionPatchField(extension, 'selector', el('.patched'), context);

      await extension.evalNode(context);

      expect(context.extends).toHaveLength(1);
      expect(context.extends[0]![1].valueOf()).toBe('.patched');
      expect(extension.selector).toBeUndefined();
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
              flag: ExtendFlag.All // ExtendFlag.All for partial matching
            }),
            decl({ name: 'background', value: any('blue') })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();
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
      const css = evald.toString();
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
      const css = evald.toString();
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
      const css = evald.toString();
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
      const css = evald.toString();
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
      const css = evald.toString();
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
      const css = evald.toString();
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
      const css = evald.toString();
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
      const css = evald.toString();
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

    it('extends through session-patched nested rules with the active parent context', async () => {
      context.session = new EvalSession();

      const nestedLeaf = ruleset({
        selector: sellist([sel([el('.leaf')])]),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });
      const base = ruleset({
        selector: sellist([sel([el('.base')])]),
        rules: rules([])
      });
      const patchedBaseRules = rules([nestedLeaf]);
      const mid = ruleset({
        selector: sellist([sel([el('.mid')])]),
        rules: rules([
          extend({
            target: el('.base')
          })
        ])
      });
      const end = ruleset({
        selector: sellist([sel([el('.end')])]),
        rules: rules([
          extend({
            target: sel([el('.mid'), co(' '), el('.leaf')])
          })
        ])
      });
      const node = rules([
        base,
        mid,
        end
      ]);

      sessionPatchField(base, 'rules', patchedBaseRules, context);

      const evald = await node.eval(context);
      const css = evald.toString({ context });

      expect(css).toContain(':is(.base, .mid) .leaf,');
      expect(css).toContain('.end {');
      expect(css).toContain('color: red;');
      expect(context.warnings).toHaveLength(0);
      expect(sessionGetParent(patchedBaseRules, context)).toBe(base);
      expect(sessionGetParent(nestedLeaf, context)).toBe(patchedBaseRules);
      expect(nestedLeaf.parent).toBe(patchedBaseRules);
      expect(nestedLeaf.getEffectiveSelector(false, context).valueOf()).toBe(':is(.base,.mid) :is(.leaf),.end');
      expect(nestedLeaf.valueOf(context)).toBe(':is(.base,.mid) :is(.leaf),.end');
      expect(patchedBaseRules.parent).toBeUndefined();
      expect(base.rules?.value).toHaveLength(0);
    });

    it('extends a nested ampersand selector through a session-patched parent selector', async () => {
      context.session = new EvalSession();

      const nestedLeaf = ruleset({
        selector: sellist([sel([amp(), co(' '), el('.leaf')])]),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });
      const base = ruleset({
        selector: sellist([sel([el('.alpha')])]),
        rules: rules([nestedLeaf])
      });
      const end = ruleset({
        selector: sellist([sel([el('.end')])]),
        rules: rules([
          extend({
            target: sel([el('.beta'), co(' '), el('.leaf')])
          })
        ])
      });
      const node = rules([base, end]);

      sessionPatchField(base, 'selector', sellist([sel([el('.beta')])]), context);

      const evald = await node.eval(context);
      const css = evald.toString({ context });

      expect(css).toContain('color: red;');
      expect(context.warnings).toHaveLength(0);
      expect(nestedLeaf.getEffectiveSelector(false, context).valueOf()).toContain('.end');
      expect(base.selector.valueOf()).toBe('.alpha');
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
        extension.target,
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
        extension.target,
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
