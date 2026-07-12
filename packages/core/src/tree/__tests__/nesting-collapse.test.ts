import {
  rules, sel, el, spaced, any, sellist, ruleset, decl, atrule,
  compound, type SimpleSelector, type Selector, amp, co
} from '../index.js';
import { Context } from '../../context.js';

describe('CSS Nesting Collapse', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context({ collapseNesting: true });
  });

  it('should collapse basic nested rulesets', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.parent')]) as any,
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          ruleset({
            selector: sel([el('.child')]) as any,
            rules: rules([
              decl({ name: 'background', value: spaced([el('blue')]) })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });

    expect(css).toBeString(`
      .parent {
        color: red;
      }
      .parent .child {
        background: blue;
      }`
    );
  });

  it('should collapse multiple nested levels', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.parent')]) as any,
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          ruleset({
            selector: sel([el('.child')]) as any,
            rules: rules([
              decl({ name: 'background', value: spaced([el('blue')]) }),
              ruleset({
                selector: sel([el('.grandchild')]) as any,
                rules: rules([
                  decl({ name: 'border', value: spaced([el('1px solid black')]) })
                ])
              })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });

    expect(css).toBeString(`
      .parent {
        color: red;
      }
      .parent .child {
        background: blue;
      }
      .parent .child .grandchild {
        border: 1px solid black;
      }`
    );
  });

  it('should handle compound selectors correctly', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.parent'), el('.container')]) as any,
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          ruleset({
            selector: sel([el('.child'), el('.item')]) as any,
            rules: rules([
              decl({ name: 'background', value: spaced([el('blue')]) })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);

    if (evald.data[0] && evald.data[0].type === 'Ruleset') {
      const firstRuleset = evald.data[0] as any;
    }
    const css = evald.toString({ collapseNesting: true });

    expect(css).toBeString(`
      .parent.container {
        color: red;
      }
      .parent.container .child.item {
        background: blue;
      }`
    );
  });

  it('should handle selector lists correctly', async () => {
    const node = rules([
      ruleset({
        selector: sellist([
          sel([el('.parent')]),
          sel([el('.container')])
        ]),
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          ruleset({
            selector: sel([el('.child')]) as any,
            rules: rules([
              decl({ name: 'background', value: spaced([el('blue')]) })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });

    expect(css).toBeString(`
      .parent,
      .container {
        color: red;
      }
      :is(.parent, .container) .child {
        background: blue;
      }`
    );
  });

  it('should handle explicit ampersands correctly', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.parent')]) as any,
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          ruleset({
            selector: sel([amp(), co(' '), el('.child')]) as any,
            rules: rules([
              decl({ name: 'background', value: spaced([el('blue')]) })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });

    expect(css).toBeString(`
      .parent {
        color: red;
      }
      .parent .child {
        background: blue;
      }`
    );
  });

  it('should handle ampersand with space combinator', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.parent')]) as any,
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          ruleset({
            selector: sel([amp('-modifier'), co(' '), el('.child')]) as any,
            rules: rules([
              decl({ name: 'background', value: spaced([el('blue')]) })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });

    expect(css).toBeString(`
      .parent {
        color: red;
      }
      .parent-modifier .child {
        background: blue;
      }`
    );
  });

  it('should handle ampersand without space combinator', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.parent')]) as any,
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          ruleset({
            selector: compound([amp('-modifier'), el('.child')]), // &-modifier.child
            rules: rules([
              decl({ name: 'background', value: spaced([el('blue')]) })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });

    expect(css).toBeString(`
      .parent {
        color: red;
      }
      .parent-modifier.child {
        background: blue;
      }`
    );
  });

  // At-rule bubbling and collapsing tests
  it('should bubble @media rules to root level', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.parent')]) as any,
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          atrule({
            name: any('@media'),
            prelude: any('(max-width: 768px)'),
            rules: rules([
              ruleset({
                selector: sel([el('.child')]) as any,
                rules: rules([
                  decl({ name: 'background', value: spaced([el('blue')]) })
                ])
              })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });

    expect(css).toBeString(`
      .parent {
        color: red;
      }
      @media (max-width: 768px) {
        .parent .child {
          background: blue;
        }
      }`
    );
  });

  it('should bubble @supports rules to root level', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.parent')]) as any,
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          atrule({
            name: any('@supports'),
            prelude: any('(display: grid)'),
            rules: rules([
              ruleset({
                selector: sel([el('.child')]) as any,
                rules: rules([
                  decl({ name: 'display', value: spaced([el('grid')]) })
                ])
              })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });

    expect(css).toBeString(`
      .parent {
        color: red;
      }
      @supports (display: grid) {
        .parent .child {
          display: grid;
        }
      }`
    );
  });

  it('should merge multiple hoisted @media rules', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.parent')]) as any,
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          atrule({
            name: any('@media'),
            prelude: any('(max-width: 768px)'),
            rules: rules([
              decl({ name: 'font-size', value: spaced([el('14px')]) }),
              atrule({
                name: any('@media'),
                prelude: any('(max-width: 480px)'),
                rules: rules([
                  ruleset({
                    selector: sel([el('.child')]) as any,
                    rules: rules([
                      decl({ name: 'background', value: spaced([el('blue')]) })
                    ])
                  })
                ])
              })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });

    expect(css).toBeString(`
      .parent {
        color: red;
      }
      @media (max-width: 768px) {
        .parent {
          font-size: 14px;
        }
        @media (max-width: 480px) {
          .parent .child {
            background: blue;
          }
        }
      }`
    );
  });

  it('should handle rulesets nested inside at-rules', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.parent')]) as any,
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          atrule({
            name: any('@media'),
            prelude: any('(max-width: 768px)'),
            rules: rules([
              decl({ name: 'font-size', value: spaced([el('14px')]) }),
              ruleset({
                selector: sel([el('.child')]) as any,
                rules: rules([
                  decl({ name: 'background', value: spaced([el('blue')]) }),
                  ruleset({
                    selector: sel([el('.grandchild')]) as any,
                    rules: rules([
                      decl({ name: 'border', value: spaced([el('1px solid')]) })
                    ])
                  })
                ])
              })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });

    expect(css).toBeString(`
      .parent {
        color: red;
      }
      @media (max-width: 768px) {
        .parent {
          font-size: 14px;
        }
        .parent .child {
          background: blue;
        }
        .parent .child .grandchild {
          border: 1px solid;
        }
      }`
    );
  });

  it('should handle multiple at-rules with nested rulesets', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.parent')]) as any,
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          atrule({
            name: any('@media'),
            prelude: any('(max-width: 768px)'),
            rules: rules([
              ruleset({
                selector: sel([el('.mobile-child')]) as any,
                rules: rules([
                  decl({ name: 'display', value: spaced([el('block')]) })
                ])
              })
            ])
          }),
          atrule({
            name: any('@supports'),
            prelude: any('(display: flex)'),
            rules: rules([
              ruleset({
                selector: sel([el('.flex-child')]) as any,
                rules: rules([
                  decl({ name: 'display', value: spaced([el('flex')]) })
                ])
              })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });

    expect(css).toBeString(`
      .parent {
        color: red;
      }
      @media (max-width: 768px) {
        .parent .mobile-child {
          display: block;
        }
      }
      @supports (display: flex) {
        .parent .flex-child {
          display: flex;
        }
      }`
    );
  });

  it('should handle complex nested at-rule scenarios', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.container')]) as any,
        rules: rules([
          decl({ name: 'padding', value: spaced([el('20px')]) }),
          atrule({
            name: any('@media'),
            prelude: any('(max-width: 768px)'),
            rules: rules([
              decl({ name: 'padding', value: spaced([el('10px')]) }),
              atrule({
                name: any('@supports'),
                prelude: any('(display: grid)'),
                rules: rules([
                  ruleset({
                    selector: sel([el('.grid-item')]) as any,
                    rules: rules([
                      decl({ name: 'grid-column', value: spaced([el('span 2')]) })
                    ])
                  })
                ])
              }),
              ruleset({
                selector: sel([el('.mobile-item')]) as any,
                rules: rules([
                  decl({ name: 'margin', value: spaced([el('5px')]) })
                ])
              })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });

    expect(css).toBeString(`
      .container {
        padding: 20px;
      }
      @media (max-width: 768px) {
        .container {
          padding: 10px;
        }
        @supports (display: grid) {
          .container .grid-item {
            grid-column: span 2;
          }
        }
        .container .mobile-item {
          margin: 5px;
        }
      }`
    );
  });
});
