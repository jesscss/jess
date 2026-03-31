import { rules, sellist, sel, el, decl, ruleset, spaced, any } from '../index.js';
import { Context } from '../../context.js';
import { getParentEdge } from '../util/cursor.js';

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
    const currentOptions = currentRules.getCurrentOptions(context);

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
