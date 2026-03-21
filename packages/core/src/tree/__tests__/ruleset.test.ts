import { rules, sellist, sel, el, decl, ruleset, spaced, any, amp } from '..';
import { Context } from '../../context.js';
import { EvalSession } from '../../eval-session.js';
import { getPrintOptions } from '../util/print.js';

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

  it('valueOf(context) reads a session-patched selector without mutating the canonical cached value', () => {
    const node = ruleset({
      selector: el('.alpha'),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });

    context.session = new EvalSession();
    context.session.patchField(node, 'selector', el('.beta'));

    expect(node.valueOf(context)).toBe('.beta');
    expect(node.valueOf()).toBe('.alpha');
    expect(node.selector.valueOf()).toBe('.alpha');
  });

  it('getHeaderString hoist fallback respects session-patched selector state', () => {
    const node = ruleset({
      selector: el('.alpha'),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });

    context.session = new EvalSession();
    context.session.patchField(node, 'selector', amp());
    context.session.patchField(node, 'hoistToRoot', true);
    context.session.patchField(node, 'options', {
      ...node.options,
      ownSelector: amp()
    });

    const header = node.getHeaderString(getPrintOptions({ context }));

    expect(header).toBe('& {\n');
    expect(node.selector.valueOf()).toBe('.alpha');
    expect(node.options.ownSelector).toBeUndefined();
  });

  it('preEval uses a session-patched ownSelector instead of the canonical selector', async () => {
    const node = ruleset({
      selector: el('.alpha'),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });

    context.session = new EvalSession();
    context.session.patchField(node, 'options', {
      ...node.options,
      ownSelector: el('.beta')
    });

    const preEvald = await node.preEval(context);

    expect(preEvald.getOwnSelector(context)?.valueOf()).toBe('.beta');
    expect(preEvald.getCurrentSelector(context).valueOf()).toBe('.beta');
    expect(node.getOwnSelector()).toBeUndefined();
    expect(node.selector.valueOf()).toBe('.alpha');
  });

  it('preEval stores composed selector sourceNode in session runtime without mutating canonical selector state', async () => {
    const child = ruleset({
      selector: el('.child'),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    const parent = ruleset({
      selector: el('.parent'),
      rules: rules([child])
    });

    context.session = new EvalSession();
    context.rulesetFrames.push(parent);
    context.frames.push(parent);

    const preEvald = await child.preEval(context);
    const currentSelector = preEvald.getCurrentSelector(context);
    const runtimeSourceNode = context.session.getRuntime(currentSelector).sourceNode;

    expect(currentSelector.valueOf()).toBe('.parent .child');
    expect(runtimeSourceNode?.valueOf?.()).toBe('.parent .child');
    expect(child.selector.valueOf()).toBe('.child');
    expect(child.selector.sourceNode).toBe(child.selector);
  });

  it('copy materializes from ownSelector instead of the current selector sourceNode view', async () => {
    const child = ruleset({
      selector: el('.child'),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    const parent = ruleset({
      selector: el('.parent'),
      rules: rules([child])
    });

    context.rulesetFrames.push(parent);
    context.frames.push(parent);

    const preEvald = await child.preEval(context);
    preEvald.selector.sourceNode = el('.poison');

    const copied = preEvald.copy();

    expect(copied.selector.valueOf()).toBe('.child');
    expect(copied.selector.sourceNode).toBe(preEvald.getOwnSelector());
    expect(preEvald.selector.valueOf()).toBe('.parent .child');
    expect(preEvald.selector.sourceNode.valueOf()).toBe('.poison');
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
