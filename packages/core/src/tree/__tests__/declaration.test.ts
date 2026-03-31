import { coll, decl, rules, ruleset, el, color, any } from '../index.js';
import { Context } from '../../context.js';
import { AssignmentType } from '../declaration.js';

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

  it('root rules serialization omits the trailing semicolon when a cloned declaration replaces the value with a collection', () => {
    const rule = decl({ name: 'color', value: any('red') });
    const clonedRule = rule.clone();
    const patchedValue = coll([
      decl({ name: 'nested', value: any('blue') })
    ]);

    clonedRule.adopt(patchedValue, context);
    (clonedRule as unknown as { value: ReturnType<typeof coll> }).value = patchedValue;

    expect(clonedRule.toTrimmedString({ context })).toContain('{');
    expect(rules([clonedRule]).toString({ context })).not.toContain('};');
    expect(rule.toTrimmedString()).toBe('color: red');
  });

  it('root rules serialization adds the trailing semicolon when a cloned declaration replaces a collection value with a scalar', () => {
    const rule = decl({
      name: 'color',
      value: coll([
        decl({ name: 'nested', value: any('red') })
      ])
    });
    const clonedRule = rule.clone();
    const patchedValue = any('blue');

    clonedRule.adopt(patchedValue, context);
    (clonedRule as unknown as { value: ReturnType<typeof any> }).value = patchedValue;

    expect(clonedRule.toTrimmedString({ context })).toBe('color: blue');
    expect(rules([clonedRule]).toString({ context })).toContain('blue;');
    expect(rule.toTrimmedString()).toContain('{');
  });

  it('serialize-helper omits the trailing semicolon for a cloned collection value inside a ruleset', () => {
    const rule = decl({ name: 'color', value: any('red') });
    const node = rules([
      ruleset({
        selector: el('.x'),
        rules: rules([rule])
      })
    ]);
    const clonedNode = node.clone(true);
    const clonedRule = (clonedNode.at(0, context) as ReturnType<typeof ruleset>).get('rules').at(0, context) as ReturnType<typeof decl>;
    const patchedValue = coll([
      decl({ name: 'nested', value: any('blue') })
    ]);

    clonedRule.adopt(patchedValue, context);
    (clonedRule as unknown as { value: ReturnType<typeof coll> }).value = patchedValue;

    expect(clonedNode.toString({ context })).toBeString(`
      .x {
        color: {
            nested: blue;
          }
      }
    `);
  });

  it('serialize-helper adds the trailing semicolon for a cloned scalar value inside a ruleset', () => {
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
    const clonedNode = node.clone(true);
    const clonedRule = (clonedNode.at(0, context) as ReturnType<typeof ruleset>).get('rules').at(0, context) as ReturnType<typeof decl>;
    const patchedValue = any('blue');

    clonedRule.adopt(patchedValue, context);
    (clonedRule as unknown as { value: ReturnType<typeof any> }).value = patchedValue;

    expect(clonedNode.toString({ context })).toBeString(`
      .x {
        color: blue;
      }
    `);
  });

  it('serialize-helper de-dupes declarations by a cloned property name', () => {
    const first = decl({ name: 'color', value: any('red') });
    const second = decl({ name: 'background', value: any('red') });
    const node = rules([
      ruleset({
        selector: el('.x'),
        rules: rules([first, second])
      })
    ]);
    const clonedNode = node.clone(true);
    const clonedFirst = (clonedNode.at(0, context) as ReturnType<typeof ruleset>).get('rules').at(0, context) as ReturnType<typeof decl>;
    const patchedName = any('background', { role: 'property' });

    clonedFirst.adopt(patchedName, context);
    (clonedFirst as unknown as { name: ReturnType<typeof any> }).name = patchedName;

    expect(clonedNode.toString({ context })).toBeString(`
      .x {
        background: red;
      }
    `);
  });

  // it('should serialize to a module', () => {
  //   let rule = decl({ name: expr([any('color')]), value: spaced([any('#eee')]) })
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.decl({\n  name: $J.expr([$J.any("color")]),\n  value: $J.spaced([$J.any("#eee")])\n})'
  //   )
  // })
});
