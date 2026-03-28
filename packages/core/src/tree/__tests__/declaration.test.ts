import { coll, decl, rules, ruleset, el, color, any } from '../index.js';
import { Context } from '../../context.js';
import { AssignmentType } from '../declaration.js';
import { setField } from '../util/field-helpers.js';

let context: Context;
describe('Declaration', () => {
  beforeEach(() => {
    context = new Context();
  });
  it('should serialize to CSS', () => {
    let rule = decl({ name: 'color', value: color('#eee') });
    expect(`${rule}`).toBe('color: #eee');
  });

  it('preEval normalizes assignment options without overwriting canonical options', async () => {
    const rule = decl(
      { name: 'color', value: any('red') },
      { assign: AssignmentType.Add }
    );
    const preEvald = await rule.preEval(context);

    expect(preEvald.toTrimmedString({ context })).toContain('color:');
    expect(preEvald.toTrimmedString({ context })).not.toContain('+:');
    expect(rule.toTrimmedString()).toContain('+:');
    expect(rule.options?.assign).toBe(AssignmentType.Add);
    expect(rule.options?.normalizedFromAssign).toBeUndefined();
  });

  it('omits the trailing semicolon when the canonical value is a collection', () => {
    const rule = decl({
      name: 'color',
      value: coll([
        decl({ name: 'nested', value: any('red') })
      ])
    });

    expect(rule.requiredSemi).toBe(false);
    expect(rules([rule]).toString()).not.toContain('};');
  });

  it('root rules serialization omits the trailing semicolon when eval state patches the value to a collection', () => {
    const rule = decl({ name: 'color', value: any('red') });
    const patchedValue = coll([
      decl({ name: 'nested', value: any('blue') })
    ]);

    setField(rule, 'value', patchedValue, context);

    expect(rule.toTrimmedString({ context })).toContain('{');
    expect(rule.requiredSemi).toBe(true);
    expect(rules([rule]).toString({ context })).not.toContain('};');
  });

  it('root rules serialization adds the trailing semicolon when eval state patches a collection value back to a scalar', () => {
    const rule = decl({
      name: 'color',
      value: coll([
        decl({ name: 'nested', value: any('red') })
      ])
    });

    setField(rule, 'value', any('blue'), context);

    expect(rule.toTrimmedString({ context })).toBe('color: blue');
    expect(rule.requiredSemi).toBe(false);
    expect(rules([rule]).toString({ context })).toContain('blue;');
  });

  it('serialize-helper omits the trailing semicolon for a state-patched collection value inside a ruleset', () => {
    const rule = decl({ name: 'color', value: any('red') });
    const node = rules([
      ruleset({
        selector: el('.x'),
        rules: rules([rule])
      })
    ]);
    const patchedValue = coll([
      decl({ name: 'nested', value: any('blue') })
    ]);

    setField(rule, 'value', patchedValue, context);

    expect(node.toString({ context })).toBeString(`
      .x {
        color: {
            nested: blue;
          }
      }
    `);
  });

  it('serialize-helper adds the trailing semicolon for a state-patched scalar value inside a ruleset', () => {
    const rule = decl({
      name: 'color',
      value: coll([
        decl({ name: 'nested', value: any('red') })
      ])
    });
    const node = rules([
      ruleset({
        selector: el('.x'),
        rules: rules([rule])
      })
    ]);

    setField(rule, 'value', any('blue'), context);

    expect(node.toString({ context })).toBeString(`
      .x {
        color: blue;
      }
    `);
  });

  it('serialize-helper de-dupes declarations by a state-patched property name', () => {
    const first = decl({ name: 'color', value: any('red') });
    const second = decl({ name: 'background', value: any('red') });
    const node = rules([
      ruleset({
        selector: el('.x'),
        rules: rules([first, second])
      })
    ]);

    setField(first, 'name', any('background', { role: 'property' }), context);

    expect(node.toString({ context })).toBeString(`
      .x {
        background: red;
      }
    `);
  });

  it('rules coalescing uses a state-patched property name for merged declarations', async () => {
    const base = decl({ name: 'color', value: any('red') });
    const merged = decl(
      { name: 'background', value: any('blue') },
      { assign: AssignmentType.Add }
    );
    const node = rules([
      ruleset({
        selector: el('.x'),
        rules: rules([base, merged])
      })
    ]);

    setField(merged, 'name', any('color', { role: 'property' }), context);

    const evald = await node.eval(context);
    const css = evald.render(context);

    // With EvalState, the +: Reference looks up the canonical property name
    // in the registry. Since the merged decl's canonical name is 'background'
    // (patched to 'color' only in state), the linear reference can't find a
    // prior 'color' property to merge with. The leading Nil placeholder is
    // stripped, leaving just 'blue'. Both declarations render under the
    // state-patched name 'color'.
    expect(css).toContain('color: red;');
    expect(css).toContain('color: blue;');
    expect(css).not.toContain('background:');
  });
  // it('should serialize to a module', () => {
  //   let rule = decl({ name: expr([any('color')]), value: spaced([any('#eee')]) })
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.decl({\n  name: $J.expr([$J.any("color")]),\n  value: $J.spaced([$J.any("#eee")])\n})'
  //   )
  // })
});
