import { coll, decl, rules, ruleset, el, color, any } from '../index.js';
import { Context } from '../../context.js';
import { EvalSession } from '../../eval-session.js';
import { AssignmentType } from '../declaration.js';
import { setField } from '../util/session-helpers.js';

let context: Context;
describe('Declaration', () => {
  beforeEach(() => {
    context = new Context();
  });
  it('should serialize to CSS', () => {
    let rule = decl({ name: 'color', value: color('#eee') });
    expect(`${rule}`).toBe('color: #eee');
  });

  it('preEval normalizes assignment options in a non-reset session without overwriting canonical options', async () => {
    const rule = decl(
      { name: 'color', value: any('red') },
      { assign: AssignmentType.Add }
    );
    context.session = new EvalSession();

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

  it('root rules serialization omits the trailing semicolon when a session patches the value to a collection', () => {
    const rule = decl({ name: 'color', value: any('red') });
    const patchedValue = coll([
      decl({ name: 'nested', value: any('blue') })
    ]);

    context.session = new EvalSession();
    context.session.setField(rule, 'value', patchedValue);

    expect(rule.toTrimmedString({ context })).toContain('{');
    expect(rule.requiredSemi).toBe(true);
    expect(rules([rule]).toString({ context })).not.toContain('};');
  });

  it('root rules serialization adds the trailing semicolon when a session patches a collection value back to a scalar', () => {
    const rule = decl({
      name: 'color',
      value: coll([
        decl({ name: 'nested', value: any('red') })
      ])
    });

    context.session = new EvalSession();
    context.session.setField(rule, 'value', any('blue'));

    expect(rule.toTrimmedString({ context })).toBe('color: blue');
    expect(rule.requiredSemi).toBe(false);
    expect(rules([rule]).toString({ context })).toContain('blue;');
  });

  it('serialize-helper omits the trailing semicolon for a session-patched collection value inside a ruleset', () => {
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

    context.session = new EvalSession();
    context.session.setField(rule, 'value', patchedValue);

    expect(node.toString({ context })).toBeString(`
      .x {
        color: {
            nested: blue;
          }
      }
    `);
  });

  it('serialize-helper adds the trailing semicolon for a session-patched scalar value inside a ruleset', () => {
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

    context.session = new EvalSession();
    context.session.setField(rule, 'value', any('blue'));

    expect(node.toString({ context })).toBeString(`
      .x {
        color: blue;
      }
    `);
  });

  it('serialize-helper de-dupes declarations by a session-patched property name', () => {
    const first = decl({ name: 'color', value: any('red') });
    const second = decl({ name: 'background', value: any('red') });
    const node = rules([
      ruleset({
        selector: el('.x'),
        rules: rules([first, second])
      })
    ]);

    context.session = new EvalSession();
    setField(first, 'name', any('background', { role: 'property' }), context);

    expect(node.toString({ context })).toBeString(`
      .x {
        background: red;
      }
    `);
  });

  it('rules coalescing uses a session-patched property name for merged declarations', async () => {
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

    context.session = new EvalSession();
    setField(merged, 'name', any('color', { role: 'property' }), context);

    const evald = await node.eval(context);
    const css = evald.toString({ context });

    expect(css).toContain('color: red, blue;');
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
