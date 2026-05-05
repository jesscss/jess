import { rules, sellist, sel, el, decl, ruleset, spaced, any, interpolated } from '../index.js';
import { Context } from '../../context.js';
import { F_VISIBLE } from '../node.js';
import { getPrintOptions, OutputWriter } from '../util/print.js';
import { serializeRulesContainer } from '../util/serialize-helper.js';
import { INTERPOLATION_PLACEHOLDER } from '../interpolated.js';

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
        border: 1px solid black;
        color: #eee;
      }
    `);
  });

  it('keeps authored literal and interpolated sibling rulesets separate without collapse', () => {
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

    expect(`${node}`).toBeString(`
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
    expect(node.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
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

    const header = node.getHeaderString(options);

    expect(header).toContain('.foo');
    expect(selector.hasFlag(F_VISIBLE)).toBe(false);
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
