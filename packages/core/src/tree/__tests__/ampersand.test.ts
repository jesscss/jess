import { beforeEach, describe, expect, it } from 'vitest';
import {
  amp, rules, sel, el, co, spaced, any, sellist, ruleset, decl, attr,
  compound,
  Ampersand,
  BasicSelector,
  type SimpleSelector, type Combinator
} from '../index.js';
import { Selector } from '../selector.js';
import { Context } from '../../context.js';
import { F_AMPERSAND, F_IMPLICIT_AMPERSAND, F_VISIBLE } from '../node.js';
import { getPrintOptions, OutputWriter } from '../util/print.js';
import { renderNodeToString } from '../util/render-buffer.js';

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
    expect(await renderNodeToString(evald, context)).toBeString(`
      .one.two {
        chungus: foo bar;
        & {
          inner: one two;
        }
      }
    `);
    node = wrapAmpList([sel([amp()])]);
    evald = await node.eval(context);
    expect(await renderNodeToString(evald, context)).toBeString(`
      .one,
      .two {
        chungus: foo bar;
        & {
          inner: one two;
        }
      }`
    );
  });

  it('keeps composed selector stack render-local when serializing bare ampersands', () => {
    const parentSelector = sel([el('.foo')]);
    const composedSelectorStack = [parentSelector];
    const options = getPrintOptions({
      writer: new OutputWriter(),
      collapseNesting: true,
      composedSelectorStack
    });

    const out = amp().toTrimmedString(options);

    expect(out).toBe('.foo');
    expect(options.composedSelectorStack).toBe(composedSelectorStack);
    expect(options.composedSelectorStack).toEqual([parentSelector]);
  });

  it('resolves framed ampersands without touching render state', async () => {
    const frame = ruleset({
      selector: sel([el('.foo')]),
      rules: rules([])
    });
    context.rulesetFrames.push(frame);
    const node = amp('-bar');

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBe('.foo-bar');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('derives appended framed ampersand selectors without cloning the frame selector', async () => {
    const frame = ruleset({
      selector: sel([el('.foo')]),
      rules: rules([])
    });
    context.rulesetFrames.push(frame);
    const sourceSelector = frame.value.selector;
    expect(sourceSelector).toBeInstanceOf(Selector);
    if (!(sourceSelector instanceof Selector)) {
      throw new Error(`Expected Selector, got ${sourceSelector.type}`);
    }
    const originalClone = sourceSelector.clone;
    let clonedSourceSelectors = 0;
    sourceSelector.clone = function cloneForCounting(
      ...args: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      clonedSourceSelectors++;
      return originalClone.apply(this, args);
    };

    try {
      const node = amp('-bar');

      const resolved = await node.resolve(context);

      expect(clonedSourceSelectors).toBe(0);
      expect(resolved.toTrimmedString()).toBe('.foo-bar');
      expect(resolved).not.toBe(sourceSelector);
      expect(sourceSelector.toTrimmedString()).toBe('.foo');
      expect(frame.value.selector).toBe(sourceSelector);
      expect(resolved.hoistToRoot).toBe(true);
    } finally {
      sourceSelector.clone = originalClone;
    }
  });

  it('derives framed ampersand wrappers without shallow-cloning the source ampersand', async () => {
    const originalClone = Ampersand.prototype.clone;
    let clonedAmpersands = 0;
    Ampersand.prototype.clone = function cloneForCounting(
      this: Ampersand,
      ...args: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      clonedAmpersands++;
      return originalClone.apply(this, args);
    };

    try {
      const frame = ruleset({
        selector: sel([el('.foo')]),
        rules: rules([])
      });
      context.rulesetFrames.push(frame);
      const node = amp();

      const resolved = await node.resolve(context);

      expect(resolved).toBeInstanceOf(Ampersand);
      if (!(resolved instanceof Ampersand)) {
        throw new Error(`Expected Ampersand, got ${resolved.type}`);
      }
      expect(resolved.getResolvedSelector()?.toTrimmedString()).toBe('.foo');
      expect(clonedAmpersands).toBe(0);
      expect(node.evaluated).toBe(false);
    } finally {
      Ampersand.prototype.clone = originalClone;
    }
  });

  it('wraps implicit selector-list ampersands without cloning reusable selector leaves', () => {
    const one = el('.one');
    const two = el('.two');
    const selectorList = sellist([sel([one]), sel([two])]);
    const sourceOneParent = one.parent;
    const sourceTwoParent = two.parent;
    const node = amp({ selectorContainer: { selector: selectorList } });
    node.addFlag(F_IMPLICIT_AMPERSAND);
    const originalClone = BasicSelector.prototype.clone;
    let basicSelectorCloneCalls = 0;
    BasicSelector.prototype.clone = function cloneForCounting(
      this: BasicSelector,
      ...args: Parameters<BasicSelector['clone']>
    ): ReturnType<BasicSelector['clone']> {
      basicSelectorCloneCalls++;
      return originalClone.apply(this, args);
    };

    try {
      const resolved = node.getResolvedSelector();

      expect(resolved?.toTrimmedString()).toBe(':is(.one, .two)');
      expect(basicSelectorCloneCalls).toBe(0);
      expect(one.parent).toBe(sourceOneParent);
      expect(two.parent).toBe(sourceTwoParent);
    } finally {
      BasicSelector.prototype.clone = originalClone;
    }
  });

  it('should collapse selectors when in collapsing mode #1', async () => {
    /** We need a root node to bubble rules */
    let node = wrapAmp([amp()]);
    context = new Context({ collapseNesting: true });
    const css = await renderNodeToString(node, context, { collapseNesting: true });
    // Generated :is(.one.two) is unwrapped to .one.two; same selector as outer so one block
    expect(css).toBeString(`
      .one.two {
        chungus: foo bar;
        inner: one two;
      }`
    );
  });

  it('should collapse selectors when in collapsing mode #2', async () => {
    /** We need a root node to bubble rules */
    let node = wrapAmpList([sel([amp()])]);
    context = new Context({ collapseNesting: true });

    const css = await renderNodeToString(node, context, { collapseNesting: true });
    // Generated :is(.one,.two) is unwrapped to .one,.two; same selector as outer so one block
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
    const css = await renderNodeToString(node, context, { collapseNesting: true });
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
    const css = await renderNodeToString(node, context, { collapseNesting: true });
    // Generated :is(.one.two) unwraps to .one.two; same selector so one block
    expect(css).toBeString(`
      .one.two {
        chungus: foo bar;
        inner: one two;
      }`
    );
  });

  it('should collapse selectors when ampersand is set to hoist #2', async () => {
    let node = wrapAmpList([sel([amp('')])]);
    context = new Context({ collapseNesting: true });
    const css = await renderNodeToString(node, context, { collapseNesting: true });
    // Generated :is(.one,.two) unwraps to .one,.two; same selector so one block
    expect(css).toBeString(`
      .one,
      .two {
        chungus: foo bar;
        inner: one two;
      }`
    );
  });

  it('should collapse selectors when ampersand has an appended value #1', async () => {
    let node = wrapAmp([amp('-1')]);
    context = new Context({ collapseNesting: true });
    const css = await renderNodeToString(node, context, { collapseNesting: true });
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
    const css = await renderNodeToString(node, context, { collapseNesting: true });
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
    const node = wrapAmpList([sel([amp('.fruit-&')])]);
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
            selector: sel([amp('.fruit-quoted-&')]),
            rules: rules([decl({ name: 'content', value: any('"Quoted"') })])
          })
        ])
      })
    ]);
    context = new Context({ collapseNesting: true });
    const css = await renderNodeToString(node, context, { collapseNesting: true });
    expect(css).toContain('.fruit-quoted-apple');
    expect(css).toContain('.fruit-quoted-satsuma');
    expect(css).toContain('.fruit-quoted-banana');
    expect(css).toContain('.fruit-quoted-pear');
    // Each item should get the prefix — verify no bare (unprefixed) items
    expect(css).not.toMatch(/[,\n]\s*satsuma[,\s{]/m);
  });

  it('should validate each item individually when distributing template', async () => {
    // .one starts with '.' and '-' before '&' is ident — invalid head join per item
    const node = rules([
      ruleset({
        selector: el('.one, .two'),
        rules: rules([
          ruleset({
            selector: sel([amp('.fruit-&')]),
            rules: rules([decl({ name: 'color', value: any('red') })])
          })
        ])
      })
    ]);
    context = new Context({ collapseNesting: true });
    await expect(async () => await node.eval(context)).rejects.toThrow('Invalid ampersand merge template');
  });

  it('should wrap inner lists in :is()', async () => {
    let node = wrapAmpList([sel([amp()]), sel([el('.three')])]);
    context = new Context({ collapseNesting: true });
    const css = await renderNodeToString(node, context, { collapseNesting: true });
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
    const css2 = await renderNodeToString(node, context, { collapseNesting: true });
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
        selector: sel([el('*'), co(' '), el('b')]),
        rules: rules([
          ruleset({
            selector: compound([amp(), attr({ name: 'e' })]),
            rules: rules([decl({ name: 'f', value: any('g') })])
          })
        ])
      })
    ]);
    context = new Context({ collapseNesting: true });
    const css = await renderNodeToString(node, context, { context, collapseNesting: true });
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
