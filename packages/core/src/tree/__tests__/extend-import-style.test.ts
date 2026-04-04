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
  decl,
  spaced,
  co,
  amp,
  pseudo,
  type Rules,
  type Selector,
  Node
} from '../index.js';
import { Context } from '../../context.js';
import { ruleset } from '../index.js';
import { resolve } from 'node:path';
import { createTestContext } from './import-style-test-helpers.js';

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
            decl({ name: 'color', value: spaced([any('red')]) }),
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
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('blue')]) }),
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
          color: blue;
        }
      `);
    });

    it('import type can be extended from sibling import', async () => {
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
        style({
          path: quoted(any('imported1.jess'))
        }, {
          type: 'import'
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('blue')]) }),
            extend({
              target: el('.base')
            })
          ])
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
      const css = evald.render(context);
      expect(css).toBeString(`
        .base,
        .child {
          color: red;
        }
        .child {
          color: blue;
        }
      `);
    });
  });

  describe('compose type extend behavior', () => {
    it('compose type can be extended from parent when mutable', async () => {
      const composedPath = resolve(process.cwd(), 'composed.jess');
      context.sourceTrees.set(composedPath, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('red')]) })
          ])
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
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('blue')]) }),
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
          color: blue;
        }
      `);
    });

    it('compose type cannot be extended from sibling compose', async () => {
      const composed1Path = resolve(process.cwd(), 'composed1.jess');
      context.sourceTrees.set(composed1Path, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('red')]) })
          ])
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
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('blue')]) }),
            extend({
              target: el('.base')
            })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('composed2.jess'))
        }, {
          type: 'compose'
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

  describe('non-mutable import extend behavior', () => {
    it('import with mutable: false cannot be extended - collects extendNotAccessible warning', async () => {
      const protectedPath = resolve(process.cwd(), 'protected.jess');
      context.sourceTrees.set(protectedPath, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('red')]) })
          ])
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
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('blue')]) }),
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

    it('compose without mutable cannot be extended (default) - collects extendNotAccessible warning', async () => {
      const protectedPath = resolve(process.cwd(), 'protected.jess');
      context.sourceTrees.set(protectedPath, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('red')]) })
          ])
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
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('blue')]) }),
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

  describe('reference import extend behavior', () => {
    const createReferencedZTree = () => rules([
      ruleset({
        selector: sellist([sel([el('.z')])]),
        rules: rules([
          decl({ name: 'color', value: spaced([any('red')]) }),
          ruleset({
            selector: sellist([sel([el('.c')])]),
            rules: rules([decl({ name: 'color', value: spaced([any('green')]) })])
          })
        ])
      }),
      ruleset({
        selector: sellist([sel([el('.only-with-visible')]), sel([el('.z')])]),
        rules: rules([
          decl({ name: 'color', value: spaced([any('green')]) }),
          ruleset({
            selector: sellist([sel([amp(), pseudo({ name: ':hover' })])]),
            rules: rules([decl({ name: 'color', value: spaced([any('green')]) })])
          }),
          ruleset({
            selector: sellist([sel([amp(), co('+'), amp()])]),
            rules: rules([
              decl({ name: 'color', value: spaced([any('green')]) }),
              ruleset({
                selector: sellist([sel([el('.sub')])]),
                rules: rules([decl({ name: 'color', value: spaced([any('green')]) })])
              })
            ])
          })
        ])
      })
    ]);

    const createReferenceExtendNode = () => rules([
      style({
        path: quoted(any('referenced-import-reference-shape.jess'))
      }, {
        type: 'import',
        importOptions: { reference: true }
      }),
      ruleset({
        selector: sellist([sel([el('.visible')])]),
        rules: rules([
          extend({
            target: el('.z'),
            flag: 'all' as any
          })
        ])
      })
    ]);

    const createNonReferenceExtendNode = () => rules([
      style({
        path: quoted(any('referenced-import-reference-shape.jess'))
      }, {
        type: 'import'
      }),
      ruleset({
        selector: sellist([sel([el('.visible')])]),
        rules: rules([
          extend({
            target: el('.z'),
            flag: 'all' as any
          })
        ])
      })
    ]);

    const createSelfClassTree = () => rules([
      ruleset({
        selector: sellist([sel([el('.z')])]),
        rules: rules([
          decl({ name: 'color', value: spaced([any('red')]) }),
          ruleset({
            selector: sellist([sel([el('.c')])]),
            rules: rules([decl({ name: 'color', value: spaced([any('green')]) })])
          })
        ])
      }),
      ruleset({
        selector: sellist([sel([el('input[type="text"].class#id[attr=i32]:not(.one)')])]),
        rules: rules([
          decl({ name: 'color', value: spaced([any('inherit')]) })
        ])
      }),
      ruleset({
        selector: sellist([sel([el('div#id.class[a=one][b=two].class:not(.one)')])]),
        rules: rules([
          decl({ name: 'color', value: spaced([any('inherit')]) })
        ])
      })
    ]);

    const createReferenceSelfClassExtendNode = () => rules([
      style({
        path: quoted(any('referenced-import-reference-self-class.jess'))
      }, {
        type: 'import',
        importOptions: { reference: true }
      }),
      ruleset({
        selector: sellist([sel([el('.visible')])]),
        rules: rules([
          extend({
            target: el('.z'),
            flag: 'all' as any
          })
        ])
      }),
      ruleset({
        selector: sellist([sel([el('.class')])]),
        rules: rules([
          extend({
            target: el('.class'),
            flag: 'all' as any
          })
        ])
      })
    ]);

    const createSelfExtendDuplicateTree = () => rules([
      ruleset({
        selector: sellist([sel([
          el('input[type="text"]'),
          el('.class'),
          el('#id'),
          el('[attr=i32]'),
          pseudo({ name: ':not', arg: el('.one') as any }) as any
        ])]),
        rules: rules([
          decl({ name: 'color', value: spaced([any('inherit')]) })
        ])
      })
    ]);

    const createReferenceSelfExtendDuplicateNode = () => rules([
      style({
        path: quoted(any('referenced-import-self-extend-duplicate.jess'))
      }, {
        type: 'import',
        importOptions: { reference: true }
      }),
      ruleset({
        selector: sellist([sel([el('.class')])]),
        rules: rules([
          extend({
            target: el('.class'),
            flag: 'all' as any
          })
        ])
      })
    ]);

    const createNonReferenceSelfExtendDuplicateNode = () => rules([
      style({
        path: quoted(any('referenced-import-self-extend-duplicate.jess'))
      }, {
        type: 'import'
      }),
      ruleset({
        selector: sellist([sel([el('.class')])]),
        rules: rules([
          extend({
            target: el('.class'),
            flag: 'all' as any
          })
        ])
      })
    ]);

    const createMultiReferenceImportsNode = () => rules([
      style({
        path: quoted(any('referenced-import-self-extend-duplicate.jess'))
      }, {
        type: 'import',
        importOptions: { reference: true }
      }),
      style({
        path: quoted(any('referenced-import-reference-shape.jess'))
      }, {
        type: 'import',
        importOptions: { reference: true }
      }),
      ruleset({
        selector: sellist([sel([el('.visible')])]),
        rules: rules([
          extend({
            target: el('.z'),
            flag: 'all' as any
          })
        ])
      }),
      ruleset({
        selector: sellist([sel([el('.class')])]),
        rules: rules([
          extend({
            target: el('.class'),
            flag: 'all' as any
          })
        ])
      })
    ]);

    it('reference import can be extended (optional visibility)', async () => {
      const referencedPath = resolve(process.cwd(), 'referenced.jess');
      context.sourceTrees.set(referencedPath, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('red')]) })
          ])
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
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('blue')]) }),
            extend({
              target: el('.base')
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.render(context);
      expect(css).toBeString(`
        .child {
          color: red;
        }
        .child {
          color: blue;
        }
      `);
    });

    it('reference extend renders nested descendants of the extended ruleset', async () => {
      const referencedPath = resolve(process.cwd(), 'referenced-nested.jess');
      context.sourceTrees.set(referencedPath, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('red')]) }),
            ruleset({
              selector: sellist([sel([el('.desc')])]),
              rules: rules([
                decl({ name: 'color', value: spaced([any('green')]) })
              ])
            })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('referenced-nested.jess'))
        }, {
          type: 'import',
          importOptions: { reference: true }
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('blue')]) }),
            extend({
              target: el('.base')
            })
          ])
        })
      ]);

      const css = (await node.eval(context)).toString();
      expect(css).toContainString(`
        .child {
          color: red;
          .desc {
            color: green;
          }
        }
      `);
    });

    it('implicit reference mode (_dedupe) does not leak internal extends outward', async () => {
      const referencedPath = resolve(process.cwd(), 'referenced-implicit-ref-no-leak.jess');
      context.sourceTrees.set(referencedPath, rules([
        ruleset({
          selector: sellist([sel([el('.from-ref')])]),
          rules: rules([
            extend({
              target: el('.outside')
            })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('referenced-implicit-ref-no-leak.jess'))
        }, {
          type: 'import',
          importOptions: { _dedupe: true } as any
        }),
        ruleset({
          selector: sellist([sel([el('.outside')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('blue')]) })
          ])
        })
      ]);

      const css = (await node.eval(context)).toString();
      expect(css).toBeString(`
        .outside {
          color: blue;
        }
      `);
    });

    it('implicit reference mode (_dedupe) remains externally extendable', async () => {
      const referencedPath = resolve(process.cwd(), 'referenced-implicit-ref-extendable.jess');
      context.sourceTrees.set(referencedPath, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('red')]) })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('referenced-implicit-ref-extendable.jess'))
        }, {
          type: 'import',
          importOptions: { _dedupe: true } as any
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            decl({ name: 'color', value: spaced([any('blue')]) }),
            extend({
              target: el('.base')
            })
          ])
        })
      ]);

      const css = (await node.eval(context)).toString();
      expect(css).toBeString(`
        .child {
          color: blue;
        }
      `);
    });

    it('characterization: reference extend shape with collapseNesting false', async () => {
      const localContext = createTestContext();
      localContext.opts.collapseNesting = false;
      const referencedPath = resolve(process.cwd(), 'referenced-import-reference-shape.jess');
      localContext.sourceTrees.set(referencedPath, createReferencedZTree());

      const css = (await createReferenceExtendNode().eval(localContext)).toString({ context: localContext });
      expect(css).toBeString(`
        .visible {
          color: red;
          .c {
            color: green;
          }
        }
        .visible {
          color: green;
          &:hover {
            color: green;
          }
          & + & {
            color: green;
            .sub {
              color: green;
            }
          }
        }
      `);
    });

    it('characterization: reference extend shape with collapseNesting true', async () => {
      const localContext = createTestContext();
      localContext.opts.collapseNesting = true;
      const referencedPath = resolve(process.cwd(), 'referenced-import-reference-shape.jess');
      localContext.sourceTrees.set(referencedPath, createReferencedZTree());

      const css = (await createReferenceExtendNode().eval(localContext)).toString({ context: localContext });
      expect(css).toBeString(`
        .visible {
          color: red;
        }
        .visible .c {
          color: green;
        }
        .visible {
          color: green;
        }
        .visible:hover {
          color: green;
        }
        .visible + .visible {
          color: green;
        }
        .visible + .visible .sub {
          color: green;
        }
      `);
    });

    it('characterization: minimal reference self-extend does not activate class-only selectors', async () => {
      const localContext = createTestContext();
      localContext.opts.collapseNesting = true;
      const referencedPath = resolve(process.cwd(), 'referenced-import-reference-self-class.jess');
      localContext.sourceTrees.set(referencedPath, createSelfClassTree());

      const css = (await createReferenceSelfClassExtendNode().eval(localContext)).toString({ context: localContext });
      expect(css).toBeString(`
        .visible {
          color: red;
        }
        .visible .c {
          color: green;
        }
      `);
    });

    describe('investigation matrix: import reference vs non-reference by collapse mode', () => {
      const renderMatrixCase = async (reference: boolean, collapseNesting: boolean): Promise<string> => {
        const localContext = createTestContext();
        localContext.opts.collapseNesting = collapseNesting;
        const referencedPath = resolve(process.cwd(), 'referenced-import-reference-shape.jess');
        localContext.sourceTrees.set(referencedPath, createReferencedZTree());
        const node = reference ? createReferenceExtendNode() : createNonReferenceExtendNode();
        return (await node.eval(localContext)).toString({ context: localContext });
      };

      it('snapshot: non-reference import with collapseNesting=false', async () => {
        const css = await renderMatrixCase(false, false);
        expect(css).toMatchInlineSnapshot(`
          ".z,
          .visible {
            color: red;
            .c {
              color: green;
            }
          }
          .only-with-visible,
          .z,
          .visible {
            color: green;
            &:hover {
              color: green;
            }
            & + & {
              color: green;
              .sub {
                color: green;
              }
            }
          }
          "
        `);
      });

      it('snapshot: non-reference import with collapseNesting=true', async () => {
        const css = await renderMatrixCase(false, true);
        expect(css).toMatchInlineSnapshot(`
          ".z,
          .visible {
            color: red;
          }
          :is(.z, .visible) .c {
            color: green;
          }
          .only-with-visible,
          .z,
          .visible {
            color: green;
          }
          :is(.only-with-visible, .z, .visible):hover {
            color: green;
          }
          :is(.only-with-visible, .z, .visible) + :is(.only-with-visible, .z, .visible) {
            color: green;
          }
          :is(.only-with-visible, .z, .visible) + :is(.only-with-visible, .z, .visible) .sub {
            color: green;
          }
          "
        `);
      });

      it('snapshot: reference import with collapseNesting=false', async () => {
        const css = await renderMatrixCase(true, false);
        expect(css).toMatchInlineSnapshot(`
          ".visible {
            color: red;
            .c {
              color: green;
            }
          }
          .visible {
            color: green;
            &:hover {
              color: green;
            }
            & + & {
              color: green;
              .sub {
                color: green;
              }
            }
          }
          "
        `);
      });

      it('snapshot: reference import with collapseNesting=true', async () => {
        const css = await renderMatrixCase(true, true);
        expect(css).toMatchInlineSnapshot(`
          ".visible {
            color: red;
          }
          .visible .c {
            color: green;
          }
          .visible {
            color: green;
          }
          .visible:hover {
            color: green;
          }
          .visible + .visible {
            color: green;
          }
          .visible + .visible .sub {
            color: green;
          }
          "
        `);
      });
    });

    describe('investigation matrix: self-extend duplication reference vs non-reference', () => {
      const renderSelfExtendDuplicateCase = async (reference: boolean): Promise<string> => {
        const localContext = createTestContext();
        localContext.opts.collapseNesting = true;
        const referencedPath = resolve(process.cwd(), 'referenced-import-self-extend-duplicate.jess');
        localContext.sourceTrees.set(referencedPath, createSelfExtendDuplicateTree());
        const node = reference ? createReferenceSelfExtendDuplicateNode() : createNonReferenceSelfExtendDuplicateNode();
        return (await node.eval(localContext)).toString({ context: localContext });
      };

      it('snapshot: non-reference self-extend duplicate selector shape', async () => {
        const css = await renderSelfExtendDuplicateCase(false);
        expect(css).toMatchInlineSnapshot(`
          "input[type="text"].class#id[attr=i32]:not(.one) {
            color: inherit;
          }
          "
        `);
      });

      it('snapshot: reference self-extend duplicate selector shape', async () => {
        const css = await renderSelfExtendDuplicateCase(true);
        expect(css).toMatchInlineSnapshot(`
          ""
        `);
      });

      it('snapshot: two reference imports with class self-extend and z-all extend', async () => {
        const localContext = createTestContext();
        localContext.opts.collapseNesting = true;
        localContext.sourceTrees.set(
          resolve(process.cwd(), 'referenced-import-self-extend-duplicate.jess'),
          createSelfExtendDuplicateTree()
        );
        localContext.sourceTrees.set(
          resolve(process.cwd(), 'referenced-import-reference-shape.jess'),
          createReferencedZTree()
        );
        const css = (await createMultiReferenceImportsNode().eval(localContext)).toString({ context: localContext });
        expect(css).toMatchInlineSnapshot(`
          ".visible {
            color: red;
          }
          .visible .c {
            color: green;
          }
          .visible {
            color: green;
          }
          .visible:hover {
            color: green;
          }
          .visible + .visible {
            color: green;
          }
          .visible + .visible .sub {
            color: green;
          }
          "
        `);
      });
    });
  });
});
