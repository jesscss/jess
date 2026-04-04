import { rules, sellist, sel, el, decl, ruleset, spaced, any, compound, pseudo, amp, interpolated, interpolatedSelector, ref, co } from '../index.js';
import { Context } from '../../context.js';
import { getParentEdge } from '../util/cursor.js';
import { LessParser } from '../../../../less-parser/src/index.ts';
import { getImplicitSelector as getImplicitSelectorUtil, getParentRuleset } from '../util/selector-utils.js';

let context: Context;

describe('Rule', () => {
  beforeEach(() => {
    context = new Context();
  });

  it('collapses nested rulesets by hoisting the child selector at render time', async () => {
    context = new Context({ collapseNesting: true });
    const node = rules([
      ruleset({
        selector: el('.parent'),
        rules: rules([
          ruleset({
            selector: el('.child'),
            rules: rules([
              decl({ name: 'color', value: any('red') })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);

    expect(evald.toString({ collapseNesting: true, context })).toBeString(`
      .parent .child {
        color: red;
      }
    `);
  });

  it('collapses an interpolated child selector under a relative parent selector without wrapping a single parent complex in :is()', async () => {
    const parser = new LessParser();
    const { tree, errors } = parser.parse(`
      @c1: foo;
      @c2: bar;
      @c3: baz;

      #@{c1}-foo {
        > .@{c2} {
          .@{c3} {
            c: c;
          }
        }
      }
    `);

    expect(errors).toHaveLength(0);

    context = new Context({ collapseNesting: true });
    context.root = tree;
    const evald = await tree.eval(context);

    expect(evald.toString({ collapseNesting: true, context })).toBeString(`
      #foo-foo > .bar .baz {
        c: c;
      }
    `);
  });

  it('composes a source relative interpolated parent selector without wrapping a single parent complex in :is()', () => {
    const parentSelector = sel([
      co('>'),
      interpolatedSelector(interpolated({
        source: '.%%',
        replacements: [ref('c2')]
      }))
    ]);
    const childSelector = interpolatedSelector(interpolated({
      source: '.%%',
      replacements: [ref('c3')]
    }));

    const composed = getImplicitSelectorUtil(childSelector, parentSelector, true);

    expect(composed.valueOf()).toBe('>.%% .%%');
  });

  it('parser-backed collapse keeps the parent declaration block before descendant outputs', async () => {
    const parser = new LessParser();
    const { tree, errors } = parser.parse(`
      .parent {
        .child {
          color: red;
        }
        content: "done";
        prop: red;
      }
    `);

    expect(errors).toHaveLength(0);

    context = new Context({ collapseNesting: true });
    context.root = tree;
    const evald = await tree.eval(context);

    expect(evald.toString({ collapseNesting: true, context })).toBeString(`
      .parent {
        content: "done";
        prop: red;
      }
      .parent .child {
        color: red;
      }
    `);
  });

  it('parser-backed collapse keeps parent blocks before combinator-prefixed expanded descendants', async () => {
    const parser = new LessParser();
    const { tree, errors } = parser.parse(`
      #first > .one {
        > #second .two > #deux {
          width: 50%;
        }
        font-size: 2em;
        hasOwnProperty: blue;
      }
    `);

    expect(errors).toHaveLength(0);

    context = new Context({ collapseNesting: true });
    context.root = tree;
    const evald = await tree.eval(context);

    expect(evald.toString({ collapseNesting: true, context })).toBeString(`
      #first > .one {
        font-size: 2em;
        hasOwnProperty: blue;
      }
      #first > .one > #second .two > #deux {
        width: 50%;
      }
    `);
  });

  it('parser-backed collapse hoists authored ampersand descendants out of nested parent blocks', async () => {
    const parser = new LessParser();
    const { tree, errors } = parser.parse(`
      #first > .one {
        > #second .two > #deux {
          width: 50%;
          #third {
            &:focus {
              color: black;
            }
            height: 100%;
          }
        }
      }
    `);

    expect(errors).toHaveLength(0);

    context = new Context({ collapseNesting: true });
    context.root = tree;
    const evald = await tree.eval(context);

    expect(evald.toString({ collapseNesting: true, context })).toBeString(`
      #first > .one > #second .two > #deux {
        width: 50%;
      }
      #first > .one > #second .two > #deux #third {
        height: 100%;
      }
      #first > .one > #second .two > #deux #third:focus {
        color: black;
      }
    `);
  });

  it('parser-backed deferred expanded descendants preserve enclosing at-rule frames', async () => {
    const parser = new LessParser();
    const { tree, errors } = parser.parse(`
      @media screen {
        .container {
          color: red;
          .child {
            color: blue;
          }
        }
      }
    `);

    expect(errors).toHaveLength(0);

    context = new Context({ collapseNesting: true });
    context.root = tree;
    const evald = await tree.eval(context);

    expect(evald.toString({ collapseNesting: true, context })).toBeString(`
      @media screen {
        .container {
          color: red;
        }
        .container .child {
          color: blue;
        }
      }
    `);
  });

  it('parser-backed deferred descendants close inherited at-rule frames before sibling outputs', async () => {
    const parser = new LessParser();
    const { tree, errors } = parser.parse(`
      @supports (sandwitch: bread) {
        .in1 {
          .in2 {
            property: value;
          }
        }
      }

      .top {
        .inside & {
          @supports (sandwitch: ham) {
            property: value;
          }
        }
      }
    `);

    expect(errors).toHaveLength(0);

    context = new Context({ collapseNesting: true });
    context.root = tree;
    const evald = await tree.eval(context);

    expect(evald.toString({ collapseNesting: true, context })).toBeString(`
      @supports (sandwitch: bread) {
        .in1 .in2 {
          property: value;
        }
      }
      @supports (sandwitch: ham) {
        .inside .top {
          property: value;
        }
      }
    `);
  });

  it('parser-backed collapse keeps expanded descendants in source order before later nested at-rules', async () => {
    const parser = new LessParser();
    const { tree, errors } = parser.parse(`
      .body {
        @media print {
          padding: 20px;

          header {
            background-color: red;
          }

          @media (orientation: landscape) {
            margin-left: 20px;
          }
        }
      }
    `);

    expect(errors).toHaveLength(0);

    context = new Context({ collapseNesting: true });
    context.root = tree;
    const evald = await tree.eval(context);

    expect(evald.toString({ collapseNesting: true, context })).toBeString(`
      @media print {
        .body {
          padding: 20px;
        }
        .body header {
          background-color: red;
        }
        @media (orientation: landscape) {
          .body {
            margin-left: 20px;
          }
        }
      }
    `);
  });

  it('parser-backed collapse merges adjacent sibling rulesets with the same expanded selector', async () => {
    const parser = new LessParser();
    const { tree, errors } = parser.parse(`
      .parent {
        &-2 { a: 1; }
        &-2 { b: 2; }
      }
    `);

    expect(errors).toHaveLength(0);

    context = new Context({ collapseNesting: true });
    context.root = tree;
    const evald = await tree.eval(context);

    expect(evald.toString({ collapseNesting: true, context })).toBeString(`
      .parent-2 {
        a: 1;
        b: 2;
      }
    `);
  });

  it('groups implicit nesting under a selector-list parent with :is()', () => {
    const parentSelector = sellist([
      el('#fourth'),
      el('#five'),
      el('#six')
    ]);
    const childSelector = el('#ten');

    const composed = getImplicitSelectorUtil(childSelector, parentSelector, true);

    expect(composed.valueOf()).toBe(':is(#fourth,#five,#six) #ten');
  });

  it('keeps selector-list parents grouped with :is() across child routes', () => {
    const parentSelector = sellist([
      el('#fourth'),
      el('#five'),
      el('#six')
    ]);
    const childSelector = sellist([
      el('.seven'),
      sel([el('.eight'), co('>'), el('#nine')])
    ]);

    const composed = getImplicitSelectorUtil(childSelector, parentSelector, true);

    expect(composed.valueOf()).toBe(':is(#fourth,#five,#six) .seven,:is(#fourth,#five,#six) .eight>#nine');
  });

  it('parser-backed collapse keeps grouped parent context for selector-list child routes', async () => {
    const parser = new LessParser();
    const { tree, errors } = parser.parse(`
      #first > .one {
        > #second .two > #deux {
          #fourth, #five, #six {
            .seven, .eight > #nine {
              border: 1px solid black;
            }
            #ten {
              color: red;
            }
          }
        }
      }
    `);

    expect(errors).toHaveLength(0);

    context = new Context({ collapseNesting: true });
    context.root = tree;
    const evald = await tree.eval(context);

    expect(evald.toString({ collapseNesting: true, context })).toBeString(`
      :is(#first > .one > #second .two > #deux #fourth, #first > .one > #second .two > #deux #five, #first > .one > #second .two > #deux #six) .seven,
      :is(#first > .one > #second .two > #deux #fourth, #first > .one > #second .two > #deux #five, #first > .one > #second .two > #deux #six) .eight > #nine {
        border: 1px solid black;
      }
      :is(#first > .one > #second .two > #deux #fourth, #first > .one > #second .two > #deux #five, #first > .one > #second .two > #deux #six) #ten {
        color: red;
      }
    `);
  });

  it('parser-backed selector-list child routes still recompose correctly from stored own selector', async () => {
    const parser = new LessParser();
    const { tree, errors } = parser.parse(`
      #first > .one {
        > #second .two > #deux {
          #fourth, #five, #six {
            .seven, .eight > #nine {
              border: 1px solid black;
            }
          }
        }
      }
    `);

    expect(errors).toHaveLength(0);

    context = new Context({ collapseNesting: true });
    context.root = tree;
    const evald = await tree.eval(context);

    const top = evald.value[0] as any;
    const middle = top.rules.value[0] as any;
    const parent = middle.rules.value[0] as any;
    const child = parent.rules.value[0] as any;

    const parentSelector = parent.getEffectiveSelector(true, context);
    const ownSelector = child.getOwnSelector();
    const storedSelector = child.getSelector();
    const renderKey = child.renderKey;
    const keyedSelector = child.getSelector(renderKey);
    const extendedSelector = child.getExtendedSelector(renderKey);
    const resolvedRenderKey = (child as any)._resolveRenderKey(context);
    const resolvedSelector = child.getSelector(resolvedRenderKey);
    const helperParent = getParentRuleset(child, context);
    const selectorBeforeExtend = child.getSelectorBeforeExtend(renderKey);
    const hoistToRoot = child.hoistToRoot;
    const recomposed = getImplicitSelectorUtil(ownSelector, parentSelector, true);
    const effectiveWithoutContext = child.getEffectiveSelector(true);
    const effective = child.getEffectiveSelector(true, context);

    expect(parentSelector.valueOf()).toBe('#first>.one>#second .two>#deux #fourth,#first>.one>#second .two>#deux #five,#first>.one>#second .two>#deux #six');
    expect(ownSelector.valueOf()).toBe('.seven,.eight>#nine');
    expect(renderKey).toBeDefined();
    expect(resolvedRenderKey).toBe(renderKey);
    expect(hoistToRoot).toBe(true);
    expect(selectorBeforeExtend).toBeUndefined();
    expect(storedSelector.valueOf()).toBe(':is(#first>.one>#second .two>#deux #fourth,#first>.one>#second .two>#deux #five,#first>.one>#second .two>#deux #six) .seven,:is(#first>.one>#second .two>#deux #fourth,#first>.one>#second .two>#deux #five,#first>.one>#second .two>#deux #six) .eight>#nine');
    expect(keyedSelector.valueOf()).toBe(':is(#first>.one>#second .two>#deux #fourth,#first>.one>#second .two>#deux #five,#first>.one>#second .two>#deux #six) .seven,:is(#first>.one>#second .two>#deux #fourth,#first>.one>#second .two>#deux #five,#first>.one>#second .two>#deux #six) .eight>#nine');
    expect(extendedSelector).toBeUndefined();
    expect(resolvedSelector.valueOf()).toBe(':is(#first>.one>#second .two>#deux #fourth,#first>.one>#second .two>#deux #five,#first>.one>#second .two>#deux #six) .seven,:is(#first>.one>#second .two>#deux #fourth,#first>.one>#second .two>#deux #five,#first>.one>#second .two>#deux #six) .eight>#nine');
    expect(helperParent).toBe(parent);
    expect(recomposed.valueOf()).toBe(':is(#first>.one>#second .two>#deux #fourth,#first>.one>#second .two>#deux #five,#first>.one>#second .two>#deux #six) .seven,:is(#first>.one>#second .two>#deux #fourth,#first>.one>#second .two>#deux #five,#first>.one>#second .two>#deux #six) .eight>#nine');
    expect(effectiveWithoutContext.valueOf()).toBe(recomposed.valueOf());
    expect(effective.valueOf()).toBe(recomposed.valueOf());
  });

  it('should serialize to CSS', () => {
    let node = ruleset({
      selector: sellist([sel([el('foo')])]),
      rules: rules([
        decl({ name: 'border', value: spaced([any('1px'), any('solid'), any('black')]) }),
        decl({ name: 'color', value: any('#eee') })
      ])
    });
    let nodes = rules([node, node]);
    expect(`${nodes}`).toBeString(`
      foo {
        border: 1px solid black;
        color: #eee;
      }
      foo {
        border: 1px solid black;
        color: #eee;
      }
    `);
  });

  it('keeps later declarations in the same parent block when nested rules render in between', async () => {
    const node = rules([
      ruleset({
        selector: el('.parent'),
        rules: rules([
          decl({ name: 'color', value: any('red') }),
          ruleset({
            selector: compound([amp(), pseudo({ name: ':hover' })]),
            rules: rules([
              decl({ name: 'color', value: any('green') })
            ])
          }),
          ruleset({
            selector: el('.child'),
            rules: rules([
              decl({ name: 'background', value: any('red') })
            ])
          }),
          decl({ name: 'content', value: any('"done"') }),
          decl({ name: 'prop', value: any('red') })
        ])
      })
    ]);

    const evald = await node.eval(context);

    expect(evald.toString({ collapseNesting: true, context })).toBeString(`
      .parent {
        color: red;
        content: "done";
        prop: red;
      }
      .parent:hover {
        color: green;
      }
      .parent .child {
        background: red;
      }
    `);
  });

  it('shallow clone of a derived ruleset gives the clone its own selector while keeping the rules body lookup-safe', () => {
    const canonical = ruleset({
      selector: el('.alpha'),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    const derived = canonical.clone(true);

    const cloned = derived.clone();
    const clonedDecl = cloned.rules.at(0, context);

    expect(cloned.selector).not.toBe(derived.selector);
    expect(cloned.rules).not.toBe(derived.rules);
    expect(cloned.selector.parent).toBe(cloned);
    expect(cloned.rules.parent).toBe(cloned);
    expect(clonedDecl.parent).toBe(derived.rules);
    expect(getParentEdge({ node: clonedDecl, renderKey: cloned.rules.renderKey })?.node).toBe(cloned.rules);
    expect(derived.selector.parent).toBe(derived);
    expect(derived.rules.parent).toBe(derived);
    expect(canonical.selector.parent).toBe(canonical);
    expect(canonical.rules.parent).toBe(canonical);
  });

  it('preEval keeps child rules visibility on the current rules container without mutating canonical rules options', async () => {
    const node = ruleset({
      selector: el('.alpha'),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });

    expect(node.rules.options.rulesVisibility.Mixin).toBe('public');
    expect(node.rules.options.rulesVisibility.VarDeclaration).toBe('public');

    const preEvald = await node.preEval(context);
    const currentRules = preEvald.enterRules(context);
    const currentOptions = currentRules.options;

    expect(currentOptions.rulesVisibility.Mixin).toBe('private');
    expect(currentOptions.rulesVisibility.VarDeclaration).toBe('private');
    expect(node.rules.options.rulesVisibility.Mixin).toBe('public');
    expect(node.rules.options.rulesVisibility.VarDeclaration).toBe('public');
  });

  // it('should serialize to a module', () => {
  //   let node = rule({
  //     selector: list([sel([el('foo')])]),
  //     value: [
  //       set(keyval({ name: 'brandColor', value: js('area(5)') })),
  //       decl({ name: 'color', value: js('brandColor') })
  //     ]
  //   })
  //   node.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.rule({\n  selector: $J.list([\n    $J.sel([$J.el($J.any("foo"))])\n  ]),\n  value: $J.ruleset(\n    (() => {\n      const $OUT = []\n      let brandColor = area(5)\n      $OUT.push($J.decl({\n        name: $J.any("color"),\n        value: brandColor\n      }))\n      return $OUT\n    })()\n  )},[])'
  //   )
  // })
});
