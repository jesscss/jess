import {
  rules, sel, el, spaced, any, sellist, ruleset, decl, atrule,
  compound, type SimpleSelector, type Selector, amp, co
} from '../index.js';
import { Context } from '../../context.js';
import type { IToken } from 'chevrotain';
import { createTriviaMap } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';

const token = (image: string, tokenTypeName = 'WS'): IToken => ({
  image,
  startOffset: 0,
  endOffset: image.length - 1,
  startLine: 1,
  endLine: 1,
  startColumn: 1,
  endColumn: image.length,
  tokenType: { name: tokenTypeName } as IToken['tokenType']
});

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
}

describe('CSS Nesting Collapse', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context({ collapseNesting: true });
  });

  it('should collapse basic nested rulesets', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.parent')]),
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          ruleset({
            selector: sel([el('.child')]),
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

  it('preserves source order when declarations follow nested rules', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.parent')]),
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          ruleset({
            selector: sel([el('.child')]),
            rules: rules([
              decl({ name: 'background', value: spaced([el('blue')]) })
            ])
          }),
          decl({ name: 'border', value: spaced([el('1px'), el('solid'), el('black')]) })
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
      .parent {
        border: 1px solid black;
      }`
    );
  });

  it('keeps independent adjacent identical headers separate during serialization', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.same')]),
        rules: rules([
          decl({ name: 'case', value: spaced([el('2')]) })
        ])
      }),
      ruleset({
        selector: sel([el('.same')]),
        rules: rules([
          decl({ name: 'case', value: spaced([el('3')]) })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });

    expect(css).toBeString(`
      .same {
        case: 2;
      }
      .same {
        case: 3;
      }`
    );
  });

  it('does not coalesce adjacent identical headers across printable trivia', async () => {
    const boundaryTrivia = [token('\n'), token('/* keep */', 'BlockComment'), token('\n')];
    const first = ruleset({
      selector: sel([el('.same')]),
      rules: rules([
        decl({ name: 'case', value: spaced([el('2')]) })
      ])
    }, undefined, [0, 1, 1, 20, 1, 21]);
    const second = ruleset({
      selector: sel([el('.same')]),
      rules: rules([
        decl({ name: 'case', value: spaced([el('3')]) })
      ])
    }, undefined, [34, 2, 1, 54, 2, 21]);
    const trivia = createTriviaMap({
      before: new Map([[second.location[0], boundaryTrivia]]),
      after: new Map([[first.location[3], boundaryTrivia]])
    });
    const node = rules([first, second]);

    const evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true, trivia });

    expect(css).toBeString(`
      .same {
        case: 2;
      }
      /* keep */
      .same {
        case: 3;
      }`
    );
  });

  it('should collapse multiple nested levels', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.parent')]),
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          ruleset({
            selector: sel([el('.child')]),
            rules: rules([
              decl({ name: 'background', value: spaced([el('blue')]) }),
              ruleset({
                selector: sel([el('.grandchild')]),
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
        selector: sel([el('.parent'), el('.container')]),
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          ruleset({
            selector: sel([el('.child'), el('.item')]),
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
            selector: sel([el('.child')]),
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
        selector: sel([el('.parent')]),
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          ruleset({
            selector: sel([amp(), co(' '), el('.child')]), // & .child
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
        selector: sel([el('.parent')]),
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          ruleset({
            selector: sel([amp('-modifier'), co(' '), el('.child')]), // &-modifier .child
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
        selector: sel([el('.parent')]),
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

  it('does not insert an extra descendant combinator before relative child selectors', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('#foo-foo')]),
        rules: rules([
          ruleset({
            selector: sel([co('>'), el('.bar')]),
            rules: rules([
              ruleset({
                selector: sel([el('.baz')]),
                rules: rules([
                  decl({ name: 'c', value: spaced([el('c')]) })
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
      #foo-foo > .bar .baz {
        c: c;
      }`
    );
  });

  it('keeps sibling nested ampersand frames distinct when they only emit nested descendants', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('mi-test-c')]),
        rules: rules([
          ruleset({
            selector: sel([amp('-1')]),
            rules: rules([
              ruleset({
                selector: sel([co('>'), el('.bar')]),
                rules: rules([
                  ruleset({
                    selector: sel([el('.baz')]),
                    rules: rules([
                      decl({ name: 'c', value: spaced([el('c')]) })
                    ])
                  })
                ])
              })
            ])
          }),
          ruleset({
            selector: sel([amp('-2')]),
            rules: rules([
              ruleset({
                selector: sel([el('.baz')]),
                rules: rules([
                  decl({ name: 'c', value: spaced([el('c')]) })
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
      mi-test-c-1 > .bar .baz {
        c: c;
      }
      mi-test-c-2 .baz {
        c: c;
      }`
    );
  });

  // At-rule bubbling and collapsing tests
  it('should bubble @media rules to root level', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.parent')]),
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          atrule({
            name: any('@media'),
            prelude: any('(max-width: 768px)'),
            rules: rules([
              ruleset({
                selector: sel([el('.child')]),
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

  it('streams hoisted parent selector headers without capture scaffolding', async () => {
    const writer = new CountingWriter();
    const node = rules([
      ruleset({
        selector: sel([el('.parent')]),
        rules: rules([
          atrule({
            name: any('@media'),
            prelude: any('(max-width: 768px)'),
            rules: rules([
              decl({ name: 'color', value: spaced([el('red')]) })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.toString({ context, writer, collapseNesting: true });

    expect(css).toBeString(`
      @media (max-width: 768px) {
        .parent {
          color: red;
        }
      }`
    );
    expect(writer.captures).toBe(0);
  });

  it('streams leaf at-rules in collapsed containers without capture scaffolding', async () => {
    const writer = new CountingWriter();
    const node = rules([
      ruleset({
        selector: sel([el('.parent')]),
        rules: rules([
          atrule({
            name: any('@property'),
            prelude: any('--brand-color')
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.toString({ context, writer, collapseNesting: true });

    expect(css).toBeString(`
      .parent {
        @property --brand-color;
      }`
    );
    expect(writer.captures).toBe(0);
  });

  it('streams reference rule wrappers in collapsed containers without capture scaffolding', async () => {
    const writer = new CountingWriter();
    const node = rules([
      ruleset({
        selector: sel([el('.parent')]),
        rules: rules([
          rules([
            decl({ name: 'color', value: spaced([el('red')]) })
          ], {
            referenceMode: true
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.toString({ context, writer, collapseNesting: true });

    expect(css).toBe('');
    expect(writer.captures).toBe(0);
  });

  it('should bubble @supports rules to root level', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.parent')]),
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          atrule({
            name: any('@supports'),
            prelude: any('(display: grid)'),
            rules: rules([
              ruleset({
                selector: sel([el('.child')]),
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
        selector: sel([el('.parent')]),
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
                    selector: sel([el('.child')]),
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
        selector: sel([el('.parent')]),
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          atrule({
            name: any('@media'),
            prelude: any('(max-width: 768px)'),
            rules: rules([
              decl({ name: 'font-size', value: spaced([el('14px')]) }),
              ruleset({
                selector: sel([el('.child')]),
                rules: rules([
                  decl({ name: 'background', value: spaced([el('blue')]) }),
                  ruleset({
                    selector: sel([el('.grandchild')]),
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
        selector: sel([el('.parent')]),
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) }),
          atrule({
            name: any('@media'),
            prelude: any('(max-width: 768px)'),
            rules: rules([
              ruleset({
                selector: sel([el('.mobile-child')]),
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
                selector: sel([el('.flex-child')]),
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
        selector: sel([el('.container')]),
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
                    selector: sel([el('.grid-item')]),
                    rules: rules([
                      decl({ name: 'grid-column', value: spaced([el('span 2')]) })
                    ])
                  })
                ])
              }),
              ruleset({
                selector: sel([el('.mobile-item')]),
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
