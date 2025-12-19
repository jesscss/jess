import {
  amp, rules, sel, el, spaced, any, sellist, ruleset, decl, attr,
  compound,
  type SimpleSelector, type Combinator, type Selector
} from '..';
import { Context } from '../../context';
import { F_AMPERSAND, F_VISIBLE } from '../node';

let context: Context;
describe('Ampersand', () => {
  beforeEach(() => {
    context = new Context();
  });

  /** We need a root node to bubble rules */
  let wrapAmp = (selectors: SimpleSelector[]) => rules([
    ruleset({
      selector: compound([
        el('.one'),
        el('.two')
      ]),
      rules: rules([
        decl({ name: 'chungus', value: spaced([el('foo'), el('bar')]) }),
        ruleset({
          selector: compound(selectors),
          rules: rules([
            decl({ name: 'inner', value: spaced([el('one'), el('two')]) })
          ])
        })
      ])
    })
  ]);

  let wrapAmpList = (selectors: Selector[]) => rules([
    ruleset({
      selector: sellist([sel([el('.one')]), sel([el('.two')])]),
      rules: rules([
        decl({ name: 'chungus', value: spaced([any('foo'), any('bar')]) }),
        ruleset({
          selector: sellist(selectors),
          rules: rules([
            decl({ name: 'inner', value: spaced([any('one'), any('two')]) })
          ])
        })
      ])
    })
  ]);

  it('should output valid CSS Nesting as-is', async () => {
  /** We need a root node to bubble rules */
    let node = wrapAmp([amp()]);
    let evald = await node.eval(context);
    expect(`${evald}`).toBeString(`
      .one.two {
        chungus: foo bar;
        & {
          inner: one two;
        }
      }
    `);
    node = wrapAmpList([sel([amp()])]);
    evald = await node.eval(context);
    expect(`${evald}`).toBeString(`
      .one,
      .two {
        chungus: foo bar;
        & {
          inner: one two;
        }
      }`
    );
  });

  it('should collapse selectors when in collapsing mode #1', async () => {
    /** We need a root node to bubble rules */
    let node = wrapAmp([amp()]);
    context = new Context({ collapseNesting: true });
    let evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });
    expect(css).toBeString(`
      .one.two {
        chungus: foo bar;
      }
      .one.two {
        inner: one two;
      }`
    );
  });

  it('should collapse selectors when in collapsing mode #2', async () => {
    /** We need a root node to bubble rules */
    let node = wrapAmpList([sel([amp()])]);
    context = new Context({ collapseNesting: true });

    let evald = await node.eval(context);

    const css = evald.toString({ collapseNesting: true });
    expect(css).toBeString(`
      .one,
      .two {
        chungus: foo bar;
      }
      .one,
      .two {
        inner: one two;
      }`
    );
  });

  it('should order selectors when collapsing', async () => {
    let node = wrapAmp([amp(), el('h2')]);
    context = new Context({ collapseNesting: true });
    let evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });
    expect(css).toBeString(`
      .one.two {
        chungus: foo bar;
      }
      h2.one.two {
        inner: one two;
      }`
    );
  });

  it('should collapse selectors when ampersand is set to hoist #1', async () => {
    let node = wrapAmp([amp('')]);
    context = new Context({ collapseNesting: true });
    let evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });
    expect(css).toBeString(`
      .one.two {
        chungus: foo bar;
      }
      .one.two {
        inner: one two;
      }`
    );
  });

  it('should collapse selectors when ampersand is set to hoist #2', async () => {
    let node = wrapAmpList([sel([amp('')])]);
    context = new Context({ collapseNesting: true });
    let evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });
    expect(css).toBeString(`
      .one,
      .two {
        chungus: foo bar;
      }
      .one,
      .two {
        inner: one two;
      }`
    );
  });

  it('should collapse selectors when ampersand has an appended value #1', async () => {
    let node = wrapAmp([amp('-1')]);
    context = new Context({ collapseNesting: true });
    let evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });
    expect(css).toBeString(`
      .one.two {
        chungus: foo bar;
      }
      .one.two-1 {
        inner: one two;
      }`
    );
  });

  it('should collapse selectors when ampersand has an appended value #2', async () => {
    let node = wrapAmpList([sel([amp('-1')])]);
    context = new Context({ collapseNesting: true });
    let evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });
    expect(css).toBeString(`
      .one,
      .two {
        chungus: foo bar;
      }
      .one-1,
      .two-1 {
        inner: one two;
      }`
    );
  });

  it('should wrap inner lists in :is()', async () => {
    let node = wrapAmpList([sel([amp()]), sel([el('.three')])]);
    context = new Context({ collapseNesting: true });
    let evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: true });
    expect(css).toBeString(`
      .one,
      .two {
        chungus: foo bar;
      }
      :is(.one, .two),
      :is(.one, .two) .three {
        inner: one two;
      }`
    );
    node = wrapAmpList([compound([amp(), el('.three')])]);
    evald = await node.eval(context);
    const css2 = evald.toString({ collapseNesting: true });
    expect(css2).toBeString(`
      .one,
      .two {
        chungus: foo bar;
      }
      :is(.one, .two).three {
        inner: one two;
      }`
    );
  });

  it('should throw if the parent selector is not basic', async () => {
    let node = rules([
      ruleset({
        selector: sel([
          attr({
            name: 'data-prop',
            op: '=',
            value: any('foo')
          })
        ]),
        rules: rules([
          decl({ name: 'chungus', value: spaced([el('foo'), el('bar')]) }),
          ruleset({
            selector: sel([amp('-1')]),
            rules: rules([
              decl({ name: 'inner', value: spaced([el('one'), el('two')]) })
            ])
          })
        ])
      })
    ]);
    await expect(async () => await node.eval(context)).rejects.toThrow('Cannot append "-1" to this type of selector');
  });
});