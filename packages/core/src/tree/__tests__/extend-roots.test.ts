import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import {
  rules,
  ruleset,
  sel,
  el,
  sellist,
  extend,
  style,
  quoted,
  any,
  atrule,
  type Rules,
  Node
} from '..';
import { Context } from '../../context';
import { resolve } from 'node:path';
import { createTestContext } from './import-style-test-helpers';

let context: Context;

describe('Extend Roots Registry', () => {
  beforeAll(() => {
    Node.prototype.fullRender = true;
  });

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
          rules: rules([])
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
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
        .child {
        }
        .child {
        }
      `);
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
          rules: rules([])
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
        .child {
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
          rules: rules([])
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: rules([
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
      const css = evald.toString();
      expect(css).toBeString(`
        .base,
        .child {
        }
        .child {
        }
      `);
    });
  });

  describe('@compose type roots', () => {
    /**
     * Test: @compose type should create new extend root
     * Sibling compose roots should be able to extend each other
     */
    it('sibling compose roots can extend each other (when mutable)', async () => {
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
          rules: rules([])
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
        .child {
        }
        .base2 {
        }
        .child {
        }
      `);
    });

    /**
     * Test: Child compose root can extend parent
     */
    it('child compose root cannot extend parent (compose is a boundary)', async () => {
      const importedPath = resolve(process.cwd(), 'imported.jess');
      context.sourceTrees.set(importedPath, rules([
        ruleset({
          selector: sellist([sel([el('.child')])]),
          rules: rules([
            extend({
              target: el('.base')
            })
          ])
        })
      ]));

      const node = rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([])
        }),
        style({
          path: quoted(any('imported.jess'))
        }, {
          type: 'compose'
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();
      expect(css).toBeString(`
        .base {
        }
        .child {
        }
      `);
    });
  });

  describe('Protected boundaries', () => {
    /**
     * Test: Protected compose blocks all access, including to descendants
     */
    it('compose is protected by default (not mutable)', async () => {
      const importedPath = resolve(process.cwd(), 'imported.jess');
      context.sourceTrees.set(importedPath, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([])
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
            extend({
              target: el('.base')
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();
      expect(css).toBeString(`
        .base {
        }
        .child {
        }
      `);
    });

    /**
     * Test: Protected compose blocks access even if child is non-protected
     */
    it('nested compose is also protected even if inner has mutable children', async () => {
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
            extend({
              target: el('.base')
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();
      expect(css).toBeString(`
        .base {
        }
        .child {
        }
      `);
    });
  });

  describe('At-rule boundaries', () => {
    /**
     * Test: Extends FROM inside at-rule can only extend within that at-rule and descendants
     */
    it('extends from inside at-rule cannot extend outside', async () => {
      const node = rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([])
        }),
        atrule({
          name: any('@media'),
          prelude: any('(min-width: 600px)'),
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.child')])]),
              rules: rules([
                extend({
                  target: el('.base')
                })
              ])
            })
          ])
        }, {
          nestable: true
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();
      expect(css).toBeString(`
        .base {
        }
        @media (min-width: 600px) {
          .child {
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
              rules: rules([])
            })
          ])
        }, {
          nestable: true
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
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
        @media (min-width: 600px) {
          .base,
          .child {
          }
        }
        .child {
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
                  rules: rules([])
                })
              ])
            }, {
              nestable: true
            }),
            ruleset({
              selector: sellist([sel([el('.child')])]),
              rules: rules([
                extend({
                  selector: sel([el('.child')]),
                  target: el('.base')
                })
              ])
            })
          ])
        }, {
          nestable: true
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();
      expect(css).toBeString(`
        @media (min-width: 600px) {
          @supports (display: grid) {
            .base,
            .child {
            }
          }
          .child {
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
              rules: rules([])
            })
          ])
        }, {
          nestable: true
        }),
        atrule({
          name: any('@layer'),
          prelude: any('one'),
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.child')])]),
              rules: rules([
                extend({
                  selector: sel([el('.child')]),
                  target: el('.base')
                })
              ])
            })
          ])
        }, {
          nestable: true
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();
      expect(css).toBeString(`
        @layer one {
          .base,
          .child {
          }
        }
        @layer one {
          .child {
          }
        }
      `);
    });

    /**
     * Test: Anonymous layers do not share extend roots
     */
    it('anonymous layers do not share extend roots', async () => {
      const node = rules([
        atrule({
          name: any('@layer'),
          // No prelude = anonymous
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.base')])]),
              rules: rules([])
            })
          ])
        }, {
          nestable: true
        }),
        atrule({
          name: any('@layer'),
          // No prelude = anonymous
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.child')])]),
              rules: rules([
                extend({
                  selector: sel([el('.child')]),
                  target: el('.base')
                })
              ])
            })
          ])
        }, {
          nestable: true
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();
      expect(css).toBeString(`
        @layer {
          .base {
          }
        }
        @layer {
          .child {
          }
        }
      `);
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
                  rules: rules([])
                })
              ])
            }, {
              nestable: true
            })
          ])
        }, {
          nestable: true
        }),
        atrule({
          name: any('@layer'),
          prelude: any('one.two'),
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.child')])]),
              rules: rules([
                extend({
                  selector: sel([el('.child')]),
                  target: el('.base')
                })
              ])
            })
          ])
        }, {
          nestable: true
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();
      expect(css).toBeString(`
        @layer one {
          @layer two {
            .base,
            .child {
            }
          }
        }
        @layer one.two {
          .child {
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
          rules: rules([])
        }),
        ruleset({
          selector: sellist([sel([el('.child')])]),
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
        .child {
        }
        .child {
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
          rules: rules([])
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
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();
      expect(css).toBeString(`
        .base,
        .child {
        }
        .child {
        }
      `);
    });
  });
});
