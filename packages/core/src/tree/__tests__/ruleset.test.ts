import { rules, sellist, sel, el, decl, ruleset, spaced, any, interpolated, F_MAY_ASYNC, BasicSelector } from '../index.js';
import { Context } from '../../context.js';
import { F_EXTENDED, F_EXTEND_TARGET, F_VISIBLE } from '../node.js';
import { getPrintOptions, OutputWriter } from '../util/print.js';
import { serializeRulesContainer } from '../util/serialize-helper.js';
import { INTERPOLATION_PLACEHOLDER } from '../interpolated.js';
import { createRenderBuffer, renderNodeToString } from '../util/render-buffer.js';

let context: Context;

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
}

describe('Rule', () => {
  beforeEach(() => {
    context = new Context();
  });
  it('should serialize to CSS', async () => {
    let node = ruleset({
      selector: sellist([sel([el('foo')])]),
      rules: rules([
        decl({ name: 'border', value: spaced([any('1px'), any('solid'), any('black')]) }),
        decl({ name: 'color', value: any('#eee') })
      ])
    });
    let nodes = rules([node, node]);
    expect(nodes.toTrimmedString()).toBeString(`
      foo {
        border: 1px solid black;
        color: #eee;
        border: 1px solid black;
        color: #eee;
      }
    `);
  });

  it('keeps authored literal and interpolated sibling rulesets separate without collapse', async () => {
    const node = rules([
      ruleset({
        selector: sellist([sel([el('.foo')])]),
        rules: rules([
          decl({ name: 'a', value: any('1') })
        ])
      }),
      ruleset({
        selector: sellist([
          sel([
            interpolated({
              source: INTERPOLATION_PLACEHOLDER,
              replacements: [any('.foo')]
            })
          ])
        ]),
        rules: rules([
          decl({ name: 'a', value: any('2') })
        ])
      })
    ]);

    expect(await renderNodeToString(node, context)).toBeString(`
      .foo {
        a: 1;
      }
      .foo {
        a: 2;
      }
    `);
  });

  it('renders a ruleset through render(context)', () => {
    const node = ruleset({
      selector: sellist([sel([el('foo')])]),
      rules: rules([
        decl({ name: 'border', value: spaced([any('1px'), any('solid'), any('black')]) }),
        decl({ name: 'color', value: any('#eee') })
      ])
    });

    expect(node.render(context)).toBeString(`
      foo {
        border: 1px solid black;
        color: #eee;
      }
    `);
  });

  it('writes finalized ruleset output into segmented buffers', async () => {
    const buffer = createRenderBuffer('segmented');
    const node = ruleset({
      selector: sellist([sel([el('foo')])]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    const originalResolve = node.resolve;
    let resolveCalls = 0;
    node.resolve = function countResolveCalls(
      this: typeof node,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };

    const rendered = await Promise.resolve(node.render(context, buffer));

    expect(rendered).toBeString(`
      foo {
        color: red;
      }
    `);
    expect(buffer.segments).toHaveLength(1);
    expect(buffer.segments[0]).toBeString(`
      foo {
        color: red;
      }
    `);
    expect(resolveCalls).toBe(0);
  });

  it('renders finalized ruleset output directly without public resolve', async () => {
    const node = ruleset({
      selector: sellist([sel([el('foo')])]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    node.resolve = () => {
      throw new Error('Ruleset direct render should evaluate natively');
    };

    await expect(Promise.resolve(node.render(context))).resolves.toBeString(`
      foo {
        color: red;
      }
    `);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('restores parent ruleset frame when child registration prep throws', () => {
    const savedFrame = ruleset({
      selector: el('.saved'),
      rules: rules([])
    });
    const throwingChild = ruleset({
      selector: el('.child'),
      rules: rules([])
    });
    throwingChild.prepareRegistration = () => {
      throw new Error('child registration prep failed');
    };
    const node = ruleset({
      selector: el('.parent'),
      rules: rules([throwingChild])
    });
    context.rulesetFrames = [savedFrame];

    expect(() => node.prepareRegistration(context)).toThrow('child registration prep failed');
    expect(context.rulesetFrames).toEqual([savedFrame]);
  });

  it('restores parent ruleset frame when child registration prep rejects', async () => {
    const savedFrame = ruleset({
      selector: el('.saved'),
      rules: rules([])
    });
    const throwingChild = ruleset({
      selector: el('.child'),
      rules: rules([])
    });
    throwingChild.prepareRegistration = () => Promise.reject(new Error('child registration prep failed'));
    const node = ruleset({
      selector: el('.parent'),
      rules: rules([throwingChild])
    });
    context.rulesetFrames = [savedFrame];

    await expect(node.prepareRegistration(context)).rejects.toThrow('child registration prep failed');
    expect(context.rulesetFrames).toEqual([savedFrame]);
  });

  it('keeps source selector canonical after ruleset registration prep', async () => {
    const selector = sellist([sel([el('.foo')])]);
    const body = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const node = ruleset({
      selector,
      rules: body
    });

    const prepared = await node.prepareRegistration(context);

    expect(prepared).not.toBe(node);
    expect(selector.parent).toBe(node);
    expect(prepared.value.rules).toBe(body);
  });

  it('renders comment-free ruleset headers without cloning source-free selector leaves', () => {
    const selectorLeaf = el('.foo');
    const originalClone = selectorLeaf.clone;
    let selectorLeafClones = 0;
    selectorLeaf.clone = function cloneForCounting(
      ...args: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      selectorLeafClones++;
      return originalClone.apply(this, args);
    };
    const selector = sellist([sel([selectorLeaf])]);
    const node = ruleset({
      selector,
      rules: rules([])
    });

    try {
      expect(node.getHeaderString(getPrintOptions(), true)).toBe('.foo {\n');
      expect(selectorLeafClones).toBe(0);
      expect(selectorLeaf.parent?.valueOf()).toBe('.foo');
    } finally {
      selectorLeaf.clone = originalClone;
    }
  });

  it('restores eval frames when body eval throws', () => {
    const savedRulesetFrame = ruleset({
      selector: el('.saved'),
      rules: rules([])
    });
    const savedFrame = ruleset({
      selector: el('.frame'),
      rules: rules([])
    });
    const body = rules([]);
    body.eval = () => {
      throw new Error('body eval failed');
    };
    const node = ruleset({
      selector: el('.parent'),
      rules: body
    });
    context.rulesetFrames = [savedRulesetFrame];
    context.frames = [savedFrame];

    expect(() => node.eval(context)).toThrow('body eval failed');
    expect(context.rulesetFrames).toEqual([savedRulesetFrame]);
    expect(context.frames).toEqual([savedFrame]);
  });

  it('restores eval frames when body eval rejects', async () => {
    const savedRulesetFrame = ruleset({
      selector: el('.saved'),
      rules: rules([])
    });
    const savedFrame = ruleset({
      selector: el('.frame'),
      rules: rules([])
    });
    const body = rules([]);
    body.eval = () => Promise.reject(new Error('body eval failed'));
    body.addFlag(F_MAY_ASYNC);
    const node = ruleset({
      selector: el('.parent'),
      rules: body
    });
    context.rulesetFrames = [savedRulesetFrame];
    context.frames = [savedFrame];

    await expect(node.eval(context)).rejects.toThrow('body eval failed');
    expect(context.rulesetFrames).toEqual([savedRulesetFrame]);
    expect(context.frames).toEqual([savedFrame]);
  });

  it('resolves a ruleset without touching render state', async () => {
    const node = ruleset({
      selector: sellist([sel([el('foo')])]),
      rules: rules([
        decl({ name: 'border', value: spaced([any('1px'), any('solid'), any('black')]) }),
        decl({ name: 'color', value: any('#eee') })
      ])
    });

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBeString(`
      foo {
        border: 1px solid black;
        color: #eee;
      }
    `);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('keeps source selector canonical while reusing body registration surface after resolve(context)', async () => {
    const selector = sellist([sel([el('.foo')])]);
    const body = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const node = ruleset({
      selector,
      rules: body
    });

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBeString(`
      .foo {
        color: red;
      }
    `);
    expect(selector.parent).toBe(node);
    expect(resolved.value.rules).toBe(body);
  });

  it('getHeaderString keeps reference target filtering render-local', () => {
    const node = ruleset({
      selector: sellist([sel([el('.foo')])]),
      rules: rules([])
    });
    const options = getPrintOptions({
      writer: new OutputWriter(),
      referenceMode: true,
      referenceRenderEnabled: true,
      referenceFilterTargets: false
    });

    const header = node.getHeaderString(options);

    expect(header).toContain('.foo');
    expect(options.referenceFilterTargets).toBe(false);
  });

  it('filters reference-mode extended headers without cloning source-free selector leaves', () => {
    const targetLeaf = el('.target');
    const addedLeaf = el('.added');
    const originalClone = addedLeaf.clone;
    let addedLeafClones = 0;
    addedLeaf.clone = function cloneForCounting(
      ...args: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      addedLeafClones++;
      return originalClone.apply(this, args);
    };
    const target = sel([targetLeaf]);
    target.addFlag(F_EXTEND_TARGET);
    const added = sel([addedLeaf]);
    added.addFlag(F_EXTENDED);
    const node = ruleset({
      selector: sellist([target, added]),
      rules: rules([])
    });
    const options = getPrintOptions({
      writer: new OutputWriter(),
      referenceMode: true,
      referenceRenderEnabled: true
    });

    try {
      expect(node.getHeaderString(options)).toBe('.added {\n');
      expect(addedLeafClones).toBe(0);
      expect(addedLeaf.parent?.valueOf()).toBe('.added');
    } finally {
      addedLeaf.clone = originalClone;
    }
  });

  it('streams header selectors without capture scaffolding', () => {
    const writer = new CountingWriter();
    const node = ruleset({
      selector: sellist([sel([el('.foo')])]),
      rules: rules([])
    });
    const options = getPrintOptions({ writer });

    expect(node.getHeaderString(options)).toBe('.foo {\n');
    expect(writer.toString()).toBe('');
    expect(writer.captures).toBe(0);
  });

  it('getHeaderString keeps selector visibility forcing render-local', () => {
    const selector = el('.foo');
    selector.removeFlag(F_VISIBLE);
    const node = ruleset({
      selector,
      rules: rules([])
    });
    const options = getPrintOptions({
      writer: new OutputWriter()
    });
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
      const header = node.getHeaderString(options);

      expect(header).toContain('.foo');
      expect(basicSelectorCloneCalls).toBe(0);
      expect(selector.hasFlag(F_VISIBLE)).toBe(false);
    } finally {
      BasicSelector.prototype.clone = originalClone;
    }
  });

  it('serializeRulesContainer keeps reference render flags render-local', () => {
    const node = ruleset({
      selector: sellist([sel([el('.foo')])]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    }, {
      referenceMode: true
    });
    const options = getPrintOptions({
      writer: new OutputWriter(),
      referenceMode: false,
      referenceRenderEnabled: true
    });

    const out = serializeRulesContainer(node, options);

    expect(out).toBe('');
    expect(options.referenceMode).toBe(false);
    expect(options.referenceRenderEnabled).toBe(true);
  });

  it('serializeRulesContainer keeps composed selector stack render-local', () => {
    const parentSelector = sel([el('.parent')]);
    const composedSelectorStack = [parentSelector];
    const node = ruleset({
      selector: sel([el('.child')]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    const options = getPrintOptions({
      writer: new OutputWriter(),
      collapseNesting: true,
      composedSelectorStack
    });

    const out = serializeRulesContainer(node, options);

    expect(out).toContain('.parent .child');
    expect(options.composedSelectorStack).toBe(composedSelectorStack);
    expect(options.composedSelectorStack).toEqual([parentSelector]);
  });

  it('getHeaderString does not cache uncomposed selectors onto the ruleset', () => {
    const node = ruleset({
      selector: sel([el('.foo')]),
      rules: rules([])
    });
    const options = getPrintOptions({
      writer: new OutputWriter(),
      collapseNesting: true,
      context
    });

    const header = node.getHeaderString(options);

    expect(header).toContain('.foo');
    expect(node._composedSelector).toBeUndefined();
  });

  it('getHeaderString keeps composed selector cache off the ruleset node', () => {
    const node = ruleset({
      selector: sel([el('.child')]),
      rules: rules([])
    });
    const options = getPrintOptions({
      writer: new OutputWriter(),
      context,
      collapseNesting: true,
      composedSelectorStack: [sel([el('.parent')])]
    });

    const header = node.getHeaderString(options);

    expect(header).toContain('.parent .child');
    expect(node._composedSelector).toBeUndefined();
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
