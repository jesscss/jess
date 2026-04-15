import { rules, sellist, sel, el, decl, ruleset, spaced, any } from '../index.js';
import { Context } from '../../context.js';
import { F_VISIBLE } from '../node.js';
import { getPrintOptions, OutputWriter } from '../util/print.js';

let context: Context;

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
