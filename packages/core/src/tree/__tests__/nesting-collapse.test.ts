import {
  rules, sel, el, spaced, any, sellist, ruleset, decl, atrule,
  compound, type SimpleSelector, type Selector, amp, co
} from '..';
import { Context } from '../../context';

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
});
