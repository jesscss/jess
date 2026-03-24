import { rules, sellist, sel, el, decl, ruleset, spaced, any, amp } from '../index.js';
import { Context } from '../../context.js';
import { EvalSession } from '../../eval-session.js';
import { getPrintOptions } from '../util/print.js';
import { sessionGetParent, sessionPatchField } from '../util/session-helpers.js';
import { F_VISIBLE } from '../node.js';

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

  it('shallow clone of a derived ruleset gives the clone its own selector while keeping the rules body materialized in a session', () => {
    const canonical = ruleset({
      selector: el('.alpha'),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    const derived = canonical.clone(true);

    context.session = new EvalSession();

    const cloned = derived.clone(false, undefined, context);
    const clonedDecl = cloned.rules.at(0);

    expect(cloned.selector).not.toBe(derived.selector);
    expect(cloned.rules).not.toBe(derived.rules);
    expect(cloned.selector.parent).toBe(cloned);
    expect(cloned.rules.parent).toBe(cloned);
    expect(clonedDecl.parent).toBe(cloned.rules);
    expect(derived.selector.parent).toBe(derived);
    expect(derived.rules.parent).toBe(derived);
    expect(canonical.selector.parent).toBe(canonical);
    expect(canonical.rules.parent).toBe(canonical);
  });

  it('gives a source ruleset shallow clone its own selector while keeping the rules body shared on the source ruleset', () => {
    const source = ruleset({
      selector: el('.alpha'),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });

    context.session = new EvalSession();

    const cloned = source.clone(false, undefined, context);

    expect(cloned).not.toBe(source);
    expect(cloned.selector).not.toBe(source.selector);
    expect(cloned.rules).toBe(source.rules);
    expect(source.selector.parent).toBe(source);
    expect(source.rules.parent).toBe(source);
    expect(cloned.selector.parent).toBe(cloned);
    expect(cloned.rules.parent).toBe(source);
    expect(sessionGetParent(cloned.rules, context)).toBe(cloned);
  });

  it('keeps a source ruleset shallow clone as a live session view over shared nested children', () => {
    const source = ruleset({
      selector: el('.alpha'),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    const sourceDecl = source.rules.at(0)!;

    context.session = new EvalSession();

    const cloned = source.clone(false, undefined, context);
    sessionPatchField(sourceDecl, 'value', any('blue'), context);

    expect(cloned.rules.at(0)).toBe(sourceDecl);
    expect(cloned.rules.toTrimmedString({ context })).toBe('color: blue;');
    expect(source.rules.toTrimmedString()).toBe('color: red;');
  });

  it('preEval keeps child rules visibility in the session without mutating canonical rules options', async () => {
    const node = ruleset({
      selector: el('.alpha'),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });

    context.session = new EvalSession();

    expect(node.rules.options.rulesVisibility.Mixin).toBe('public');
    expect(node.rules.options.rulesVisibility.VarDeclaration).toBe('public');

    const preEvald = await node.preEval(context);
    const currentRules = preEvald.getCurrentRules(context);
    const currentOptions = currentRules.getCurrentOptions(context);

    expect(currentOptions.rulesVisibility.Mixin).toBe('private');
    expect(currentOptions.rulesVisibility.VarDeclaration).toBe('private');
    expect(node.rules.options.rulesVisibility.Mixin).toBe('public');
    expect(node.rules.options.rulesVisibility.VarDeclaration).toBe('public');
  });

  it('preEval composes and registers a session-patched nested ruleset under the active extend root', async () => {
    const nested = ruleset({
      selector: el('.leaf'),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    const patchedRules = rules([nested]);
    const base = ruleset({
      selector: el('.base'),
      rules: rules([])
    });
    const root = rules([base]);

    context.session = new EvalSession();
    context.session.patchField(base, 'rules', patchedRules);
    context.extendRoots.registerRoot(root);
    context.extendRoots.pushExtendRoot(root);

    const preEvaldBase = await base.preEval(context);
    const currentRules = preEvaldBase.getCurrentRules(context);
    const preEvaldNested = currentRules.at(0, context) as typeof nested;
    const registeredRulesets = context.extendRoots.getRulesets(root);

    expect(currentRules).toBe(patchedRules);
    expect(sessionGetParent(currentRules, context)).toBe(preEvaldBase);
    expect(sessionGetParent(preEvaldNested, context)).toBe(currentRules);
    expect(preEvaldNested.getEffectiveSelector(false, context).valueOf()).toBe('.base .leaf');
    expect(preEvaldNested.valueOf(context)).toBe('.base .leaf');
    expect(
      [...(registeredRulesets ?? [])].some(rulesetNode => rulesetNode.valueOf(context) === '.base .leaf')
    ).toBe(true);
    expect(base.rules.value).toHaveLength(0);
  });

  it('evalNode removes ruleset visibility when the rules container is emptied only in the session', async () => {
    const node = ruleset({
      selector: el('.alpha'),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    const emptyRules = rules([]);

    context.session = new EvalSession();
    context.session.patchField(node, 'rules', emptyRules);

    const evald = await node.eval(context);

    expect(evald._hasFlag(F_VISIBLE, context)).toBe(false);
    expect(evald.hasFlag(F_VISIBLE)).toBe(true);
    expect(evald.getCurrentRules(context)).toBe(emptyRules);
    expect(node.rules.value).toHaveLength(1);
  });

  it('setOwnSelector preserves other session-patched option fields', () => {
    const node = ruleset({
      selector: el('.alpha'),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });

    context.session = new EvalSession();
    context.session.patchField(node, 'options', {
      ...node.options,
      resolvedHoistWrapper: true
    });

    node.setOwnSelector(el('.beta'), context);

    expect(node.getOwnSelector(context)?.valueOf()).toBe('.beta');
    expect(node.options.ownSelector).toBeUndefined();
    expect(context.session.getField(node, 'options')?.resolvedHoistWrapper).toBe(true);
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
