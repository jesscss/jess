import {
  amp, rules, sel, el, co, spaced, any, sellist, ruleset, decl, attr,
  compound, nil,
  type SimpleSelector, type Combinator, type Selector
} from '../index.js';
import { Context } from '../../context.js';
import { F_AMPERSAND, F_IMPLICIT_AMPERSAND, F_VISIBLE } from '../node.js';

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
    expect(evald.render(context)).toBeString(`
      .one.two {
        chungus: foo bar;
        & {
          inner: one two;
        }
      }
    `);
    node = wrapAmpList([sel([amp()]) as any]);
    evald = await node.eval(context);
    expect(evald.render(context)).toBeString(`
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
    const css = evald.render(context, { collapseNesting: true });
    expect(css).toBeString(`
      .one.two {
        chungus: foo bar;
        inner: one two;
      }`
    );
  });

  it('should collapse selectors when in collapsing mode #2', async () => {
    /** We need a root node to bubble rules */
    let node = wrapAmpList([sel([amp()]) as any]);
    context = new Context({ collapseNesting: true });

    let evald = await node.eval(context);

    const css = evald.render(context, { collapseNesting: true });
    expect(css).toBeString(`
      .one,
      .two {
        chungus: foo bar;
        inner: one two;
      }`
    );
  });

  it('should order selectors when collapsing', async () => {
    let node = wrapAmp([amp(), el('h2')]);
    context = new Context({ collapseNesting: true });
    let evald = await node.eval(context);
    const css = evald.render(context, { collapseNesting: true });
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
    const css = evald.render(context, { collapseNesting: true });
    expect(css).toBeString(`
      .one.two {
        chungus: foo bar;
        inner: one two;
      }`
    );
  });

  it('should collapse selectors when ampersand is set to hoist #2', async () => {
    let node = wrapAmpList([sel([amp('')]) as any]);
    context = new Context({ collapseNesting: true });
    let evald = await node.eval(context);
    const css = evald.render(context, { collapseNesting: true });
    expect(css).toBeString(`
      .one,
      .two {
        chungus: foo bar;
        inner: one two;
      }`
    );
  });

  it('does not wrap a hoisted leading implicit ampersand when the resolved parent is a single complex selector', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('#foo-foo'), co('>'), el('.bar')]),
        rules: rules([
          ruleset({
            selector: el('.baz'),
            rules: rules([
              decl({ name: 'c', value: any('c') })
            ])
          })
        ])
      })
    ]);

    context = new Context({ collapseNesting: true });
    const evald = await node.eval(context);
    const css = evald.render(context, { collapseNesting: true });

    expect(css).toBeString(`
      #foo-foo > .bar .baz {
        c: c;
      }
    `);
  });

  it('should render explicit ampersand template forms', () => {
    expect(amp().toTrimmedString()).toBe('&');
    expect(amp({ template: '' }).toTrimmedString()).toBe('&()');
    expect(amp({ template: nil() }).toTrimmedString()).toBe('&(nil)');
    expect(amp({ template: '-1' }).toTrimmedString()).toBe('&(-1)');
  });

  it('should reject invalid ampersand templates during eval', async () => {
    const node = wrapAmp([amp({ template: 'nil' }) as any, el('.three')]);
    context = new Context({ collapseNesting: true });
    await expect(async () => await node.eval(context)).rejects.toThrow('Invalid ampersand template');
  });

  it('should omit the parent entirely for &(nil)', async () => {
    const node = wrapAmp([amp({ template: nil() }) as any, el('.three')]);
    context = new Context({ collapseNesting: true });
    const evald = await node.eval(context);
    const css = evald.render(context, { collapseNesting: true });
    expect(css).toBeString(`
      .one.two {
        chungus: foo bar;
      }
      .three {
        inner: one two;
      }`
    );
  });

  it('should collapse selectors when ampersand has an appended value #1', async () => {
    let node = wrapAmp([amp('-1')]);
    context = new Context({ collapseNesting: true });
    let evald = await node.eval(context);
    const css = evald.render(context, { collapseNesting: true });
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
    let node = wrapAmpList([sel([amp('-1')]) as any]);
    context = new Context({ collapseNesting: true });
    let evald = await node.eval(context);
    const css = evald.render(context, { collapseNesting: true });
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

  it('should reject invalid ampersand merge-template joins', async () => {
    const node = wrapAmpList([sel([amp('.fruit-&')]) as any]);
    context = new Context({ collapseNesting: true });
    await expect(async () => await node.eval(context)).rejects.toThrow('Invalid ampersand merge template');
  });

  it('should distribute merge template across comma-separated items', async () => {
    // Simulates ~'apple, satsuma, banana, pear' as parent selector
    const node = rules([
      ruleset({
        selector: el('apple, satsuma, banana, pear'),
        rules: rules([
          ruleset({
            selector: sel([amp('.fruit-quoted-&')]) as any,
            rules: rules([decl({ name: 'content', value: any('"Quoted"') })])
          })
        ])
      })
    ]);
    context = new Context({ collapseNesting: true });
    const evald = await node.eval(context);
    const css = evald.render(context, { collapseNesting: true });
    expect(css).toContain('.fruit-quoted-apple');
    expect(css).toContain('.fruit-quoted-satsuma');
    expect(css).toContain('.fruit-quoted-banana');
    expect(css).toContain('.fruit-quoted-pear');
    // The distributed child selector should not contain any bare unprefixed items.
    const generatedList = css.match(/:is\(([^)]*)\)/)?.[1] ?? '';
    expect(generatedList).toContain('.fruit-quoted-apple');
    expect(generatedList).not.toMatch(/(^|,\s*)satsuma(,|$)/);
  });

  it('should validate each item individually when distributing template', async () => {
    // .one starts with '.' and '-' before '&' is ident — invalid head join per item
    const node = rules([
      ruleset({
        selector: el('.one, .two'),
        rules: rules([
          ruleset({
            selector: sel([amp('.fruit-&')]) as any,
            rules: rules([decl({ name: 'color', value: any('red') })])
          })
        ])
      })
    ]);
    context = new Context({ collapseNesting: true });
    await expect(async () => await node.eval(context)).rejects.toThrow('Invalid ampersand merge template');
  });

  it('should wrap inner lists in :is()', async () => {
    let node = wrapAmpList([sel([amp()]) as any, sel([el('.three')]) as any]);
    context = new Context({ collapseNesting: true });
    let evald = await node.eval(context);
    const css = evald.render(context, { collapseNesting: true });
    // First item is generated :is(.one,.two) and unwraps to .one,.two; second stays :is(.one,.two) .three
    expect(css).toBeString(`
      .one,
      .two {
        chungus: foo bar;
      }
      .one,
      .two,
      :is(.one, .two) .three {
        inner: one two;
      }`
    );
    node = wrapAmpList([compound([amp(), el('.three')])]);
    evald = await node.eval(context);
    const css2 = evald.render(context, { collapseNesting: true });
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

  /**
   * Real ampersand path: * b { &[e] { f: 'g' } } (css-3 nesting case).
   * Built AST matches what the Less/CSS parser produces:
   * - Outer: complexSelector → [BasicSelector(*), Combinator(' '), BasicSelector(b)] (compoundSelector returns single node for * and b).
   * - Inner: compoundSelector → [Ampersand(undefined), AttributeSelector({ name: 'e' })] for &[e].
   * Same node types and structure as parser output so eval path is identical.
   */
  it('unwraps :is(* b)[e] to * b[e] when ampersand is flattened (css-3 nesting case)', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('*'), co(' '), el('b')]) as any,
        rules: rules([
          ruleset({
            selector: compound([amp(), attr({ name: 'e' })]),
            rules: rules([decl({ name: 'f', value: any('g') })])
          })
        ])
      })
    ]);
    context = new Context({ collapseNesting: true });
    const evald = await node.eval(context);
    const css = evald.render(context, { collapseNesting: true });
    expect(css).toContain('* b[e]');
    expect(css).not.toContain(':is(* b)[e]');
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
        ]) as any,
        rules: rules([
          decl({ name: 'chungus', value: spaced([el('foo'), el('bar')]) }),
          ruleset({
            selector: sel([amp('-1')]) as any,
            rules: rules([
              decl({ name: 'inner', value: spaced([el('one'), el('two')]) })
            ])
          })
        ])
      })
    ]);
    await expect(async () => await node.eval(context)).rejects.toThrow('Cannot append "-1" to this type of selector');
  });

  it('does not mutate the canonical simple parent selector in the collapse/hoist path', () => {
    context = new Context({ collapseNesting: true });
    const parent = ruleset({
      selector: el('.alpha'),
      rules: rules([])
    });
    parent.get('selector').pre = 1;
    parent.get('selector').post = 1;

    context.rulesetFrames.push(parent);

    const result = amp().eval(context) as Selector;

    expect(result).not.toBe(parent.get('selector'));
    expect(result.valueOf()).toBe('.alpha');
    expect(parent.get('selector').pre).toBe(1);
    expect(parent.get('selector').post).toBe(1);
    expect(parent.get('selector').hoistToRoot).toBeUndefined();
  });
});
