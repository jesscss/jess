import { beforeEach, describe, expect, it } from 'vitest';
import {
  amp, rules, sel, el, co, spaced, any, sellist, ruleset, decl, attr,
  compound,
  extend,
  ExtendFlag,
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

class WholeBufferCountingWriter extends OutputWriter {
  wholeBufferReads = 0;
  readbacks = 0;

  override getSince(mark: number): string {
    this.readbacks++;
    if (mark === 0) {
      this.wholeBufferReads++;
    }
    return super.getSince(mark);
  }
}

describe('Ampersand', () => {
  beforeEach(() => {
    context = new Context();
  });

  /** We need a root node to bubble rules */
  let wrapAmp = (value: SimpleSelector[]) => rules([
    ruleset({
      selector: compound([
        el('.one'),
        el('.two')
      ]),
      rules: rules([
        decl({ name: 'chungus', value: spaced([el('foo'), el('bar')]) }),
        ruleset({
          selector: compound(value),
          rules: rules([
            decl({ name: 'inner', value: spaced([el('one'), el('two')]) })
          ])
        })
      ])
    })
  ]);

  let wrapAmpList = (value: Selector[]) => rules([
    ruleset({
      selector: sellist([sel([el('.one')]), sel([el('.two')])]),
      rules: rules([
        decl({ name: 'chungus', value: spaced([any('foo'), any('bar')]) }),
        ruleset({
          selector: sellist(value),
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
    parentSelector.toString = () => {
      throw new Error('Ampersand collapse should write parent selector syntax directly');
    };
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

  it('writes ampersand source syntax directly', () => {
    const writer = new OutputWriter();
    amp().writeSyntax(getPrintOptions({ writer }));
    writer.add(' ');
    amp('-bar').writeSyntax(getPrintOptions({ writer }));

    expect(writer.toString()).toBe('& &(-bar)');
  });

  it('captures ampersand source syntax without outer whole-buffer readback', () => {
    const writer = new WholeBufferCountingWriter();

    expect(amp('-bar').toTrimmedString({ writer })).toBe('&(-bar)');
    expect(writer.wholeBufferReads).toBe(0);
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

  it('resolves appended framed ampersands without dead selector string snapshots', async () => {
    const frame = ruleset({
      selector: sel([el('.foo')]),
      rules: rules([])
    });
    context.rulesetFrames.push(frame);
    frame.selector.toTrimmedString = () => {
      throw new Error('Ampersand append placement should not snapshot selector text');
    };

    const resolved = await amp('-bar').resolve(context);

    expect(resolved.valueOf()).toBe('.foo-bar');
    expect(resolved.hoistToRoot).toBe(true);
  });

  it('derives appended framed ampersand value without cloning the frame selector', async () => {
    const frame = ruleset({
      selector: sel([el('.foo')]),
      rules: rules([])
    });
    context.rulesetFrames.push(frame);
    const sourceSelector = frame.selector;
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
      expect(frame.selector).toBe(sourceSelector);
      expect(resolved.hoistToRoot).toBe(true);
    } finally {
      sourceSelector.clone = originalClone;
    }
  });

  it('derives basic selector merge templates without public string transport', async () => {
    const frame = ruleset({
      selector: sel([el('.foo')]),
      rules: rules([])
    });
    context.rulesetFrames.push(frame);
    const originalToTrimmedString = BasicSelector.prototype.toTrimmedString;
    BasicSelector.prototype.toTrimmedString = () => {
      throw new Error('Ampersand template merge should read exact basic selector text directly');
    };

    try {
      const resolved = await amp('&-theme').resolve(context);

      expect(resolved.valueOf()).toBe('.foo-theme');
      expect(resolved.hoistToRoot).toBe(true);
    } finally {
      BasicSelector.prototype.toTrimmedString = originalToTrimmedString;
    }
  });

  it('derives appended selector-list ampersands without callback array mapping', async () => {
    const parentSelector = sellist([
      '.one',
      sel([el('.two')])
    ]);
    const frame = ruleset({
      selector: parentSelector,
      rules: rules([])
    });
    context.rulesetFrames.push(frame);
    const originalMap = parentSelector.value.map;
    Object.defineProperty(parentSelector.value, 'map', {
      configurable: true,
      value: () => {
        throw new Error('Ampersand selector-list append should not map source value');
      }
    });

    try {
      const resolved = await amp('-bar').resolve(context);

      expect(resolved.toTrimmedString()).toBeString(`
        .one-bar,
        .two-bar
      `);
      expect(parentSelector.toTrimmedString()).toBeString(`
        .one,
        .two
      `);
    } finally {
      Object.defineProperty(parentSelector.value, 'map', {
        configurable: true,
        writable: true,
        value: originalMap
      });
    }
  });

  it('derives appended framed complex value without reparenting source selector children', async () => {
    const frame = ruleset({
      selector: sel([el('.foo'), co(' '), el('.bar')]),
      rules: rules([])
    });
    context.rulesetFrames.push(frame);
    const sourceSelector = frame.selector;
    expect(sourceSelector).toBeInstanceOf(Selector);
    if (!(sourceSelector instanceof Selector)) {
      throw new Error(`Expected Selector, got ${sourceSelector.type}`);
    }
    const sourceChildren = [...sourceSelector.value];

    const resolved = await amp('-baz').resolve(context);

    expect(resolved.toTrimmedString()).toBe('.foo .bar-baz');
    expect(resolved).not.toBe(sourceSelector);
    expect(frame.selector).toBe(sourceSelector);
    expect(sourceSelector.toTrimmedString()).toBe('.foo .bar');
    expect(sourceChildren.map(child => child.parent)).toEqual(sourceChildren.map(() => sourceSelector));
  });

  it('renders appended generated value without reparenting source value', async () => {
    const parentSelector = sel([el('.button')]);
    const nestedSelector = sel([amp('-primary')]);
    const sourceParentChildren = [...parentSelector.value];
    const sourceNestedChildren = [...nestedSelector.value];
    const node = rules([
      ruleset({
        selector: parentSelector,
        rules: rules([
          ruleset({
            selector: nestedSelector,
            rules: rules([
              decl({ name: 'color', value: any('red') })
            ])
          })
        ])
      })
    ]);

    const css = await renderNodeToString(node, context);

    expect(css).toBeString(`
      .button-primary {
        color: red;
      }
    `);
    expect(parentSelector.value).toEqual(sourceParentChildren);
    expect(nestedSelector.value).toEqual(sourceNestedChildren);
    expect(sourceParentChildren.map(child => child.parent)).toEqual(sourceParentChildren.map(() => parentSelector));
    expect(sourceNestedChildren.map(child => child.parent)).toEqual(sourceNestedChildren.map(() => nestedSelector));
  });

  it('extends appended generated value without reparenting source value', async () => {
    const parentSelector = sel([el('.button')]);
    const nestedSelector = sel([amp('-primary')]);
    const sourceParentChildren = [...parentSelector.value];
    const sourceNestedChildren = [...nestedSelector.value];
    const node = rules([
      ruleset({
        selector: parentSelector,
        rules: rules([
          ruleset({
            selector: nestedSelector,
            rules: rules([
              decl({ name: 'color', value: any('red') })
            ])
          })
        ])
      }),
      ruleset({
        selector: el('.theme'),
        rules: rules([
          extend({
            target: el('.button-primary'),
            flag: ExtendFlag.Exact
          })
        ])
      })
    ]);

    const css = await renderNodeToString(node, context);

    expect(css).toBeString(`
      .button-primary,
      .theme {
        color: red;
      }
    `);
    expect(parentSelector.value).toEqual(sourceParentChildren);
    expect(nestedSelector.value).toEqual(sourceNestedChildren);
    expect(sourceParentChildren.map(child => child.parent)).toEqual(sourceParentChildren.map(() => parentSelector));
    expect(sourceNestedChildren.map(child => child.parent)).toEqual(sourceNestedChildren.map(() => nestedSelector));
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

  it('should collapse value when in collapsing mode #1', async () => {
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

  it('should collapse value when in collapsing mode #2', async () => {
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

  it('should order value when collapsing', async () => {
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

  it('should collapse value when ampersand is set to hoist #1', async () => {
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

  it('should collapse value when ampersand is set to hoist #2', async () => {
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

  it('should collapse value when ampersand has an appended value #1', async () => {
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

  it('should collapse value when ampersand has an appended value #2', async () => {
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
    const node = rules([
      ruleset({
        selector: sellist([
          sel([el('apple')]),
          sel([el('satsuma')]),
          sel([el('banana')]),
          sel([el('pear')])
        ]),
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

  it('derives complex selector-list merge templates with hoist and selector metadata', async () => {
    const sourceSelector = sellist([
      sel([el('.one'), co('>'), el('.child')]),
      sel([el('.two'), co(' '), el('.child')])
    ]);
    const sourceChildren = [...sourceSelector.value];
    const frame = ruleset({
      selector: sourceSelector,
      rules: rules([])
    });
    context.rulesetFrames.push(frame);
    let publicStringCalls = 0;
    const originals = new Array<(typeof sourceSelector.value)[number]['toTrimmedString']>(sourceSelector.value.length);
    for (let index = 0; index < sourceSelector.value.length; index++) {
      const selector = sourceSelector.value[index]!;
      originals[index] = selector.toTrimmedString;
      selector.toTrimmedString = function countPublicStringTransport(
        this: typeof selector,
        ...args: Parameters<typeof selector.toTrimmedString>
      ): ReturnType<typeof selector.toTrimmedString> {
        publicStringCalls++;
        return originals[index]!.apply(this, args);
      };
    }

    const resolved = await amp('&-theme').resolve(context);
    for (let index = 0; index < sourceSelector.value.length; index++) {
      sourceSelector.value[index]!.toTrimmedString = originals[index]!;
    }

    expect(resolved).toBeInstanceOf(Selector);
    if (!(resolved instanceof Selector)) {
      throw new Error(`Expected Selector, got ${resolved.type}`);
    }
    expect(publicStringCalls).toBe(0);
    expect(resolved.toTrimmedString()).toBe('.one > .child-theme,\n.two .child-theme');
    expect(resolved.hoistToRoot).toBe(true);
    const keySet = resolved.getKeySet(context);
    expect(context.selectorBits.hasBit(keySet, '.one')).toBe(true);
    expect(context.selectorBits.hasBit(keySet, '.two')).toBe(true);
    expect(context.selectorBits.hasBit(keySet, '.child-theme')).toBe(true);
    expect(context.selectorBits.hasBit(resolved.visibleKeySet, '.one')).toBe(true);
    expect(context.selectorBits.hasBit(resolved.visibleKeySet, '.two')).toBe(true);
    expect(context.selectorBits.hasBit(resolved.visibleKeySet, '.child-theme')).toBe(true);
    expect(frame.selector).toBe(sourceSelector);
    expect(sourceSelector.toTrimmedString()).toBe('.one > .child,\n.two .child');
    expect(sourceSelector.value).toEqual(sourceChildren);
    expect(sourceChildren.map(child => child.parent)).toEqual(sourceChildren.map(() => sourceSelector));
  });

  it('should validate each item individually when distributing template', async () => {
    // .one starts with '.' and '-' before '&' is ident — invalid head join per item
    const node = rules([
      ruleset({
        selector: sellist([
          sel([el('.one')]),
          sel([el('.two')])
        ]),
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
