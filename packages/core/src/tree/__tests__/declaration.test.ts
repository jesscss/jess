import { atrule, coll, decl, rules, ruleset, el, color, any, expr, num, ref, amp, sel } from '../index.js';
import { Context } from '../../context.js';
import { AssignmentType } from '../declaration.js';
import { isVisibleInContext } from '../node-base.js';

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

  it('clears stale same-render-key edges when a render-owned declaration updates a direct field', () => {
    const rule = decl({
      name: any('item-1', { role: 'property' }),
      value: expr(any('stale'))
    });
    const nextValue = num(4);
    const renderKey = 1;

    rule.adopt(nextValue, context);
    (rule as typeof rule & { renderKey: number }).renderKey = renderKey;
    (rule as typeof rule & { valueEdge: Map<number, ReturnType<typeof expr>> }).valueEdge = new Map([[renderKey, expr(any('stale-edge'))]]);
    rule.setCurrentValue(nextValue, { ...context, renderKey });

    expect(rule.get('value', { ...context, renderKey }).toTrimmedString()).toBe('4');
    expect((rule as typeof rule & { valueEdge?: Map<number, ReturnType<typeof expr>> }).valueEdge).toBeUndefined();
  });

  it('preserves merged property declarations for later property lookups in nested output', async () => {
    const node = rules([
      ruleset({
        selector: el('a'),
        rules: rules([
          decl({ name: 'background-color', value: any('red') }, { assign: AssignmentType.Add }),
          decl({ name: 'background-color', value: any('foo') }, { assign: AssignmentType.Add }),
          ruleset({
            selector: sel([amp(), el('b')]),
            rules: rules([
              decl({
                name: 'background',
                value: ref({ key: 'background-color' }, { type: 'property' })
              })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(new Context({ collapseNesting: true }));

    expect(evald.toString({ context: new Context({ collapseNesting: true }) })).toBeString(`
      a {
        background-color: red, foo;
      }
      ab {
        background: red, foo;
      }
    `);
  });

  it('preserves merge-sequence declarations inside nested @starting-style blocks', async () => {
    const node = rules([
      ruleset({
        selector: el('.x'),
        rules: rules([
          atrule({
            name: any('@starting-style', { role: 'atkeyword' }),
            rules: rules([
              decl({ name: 'padding', value: any('10px') }, { assign: AssignmentType.MergeSequence }),
              decl({ name: 'padding', value: any('8px') }, { assign: AssignmentType.MergeSequence }),
              decl({ name: 'padding', value: any('6px') }, { assign: AssignmentType.MergeSequence }),
              decl({ name: 'padding', value: any('4px') }, { assign: AssignmentType.MergeSequence })
            ])
          })
        ])
      })
    ]);

    const evalContext = new Context();
    const evald = await node.eval(evalContext);
    const outerRuleset = evald.at(0, evalContext) as ReturnType<typeof ruleset>;
    const outerRules = outerRuleset.enterRules(evalContext)!;
    const startingStyle = outerRules.at(0, evalContext) as ReturnType<typeof atrule>;
    const startingStyleRules = startingStyle.enterRules(evalContext)!;
    const startingStyleContext = {
      ...evalContext,
      renderKey: startingStyleRules.renderKey,
      rulesContext: startingStyleRules
    } as Context;
    const startingStyleChildren = startingStyleRules.getRegistryChildren(startingStyleContext);

    expect(startingStyleChildren).toHaveLength(4);
    expect(startingStyleChildren[0]!.toTrimmedString({ context: startingStyleContext })).toBe('padding: 10px 8px 6px 4px');
    expect(isVisibleInContext(startingStyleChildren[0]!, startingStyleContext)).toBe(true);
    expect(startingStyleChildren.slice(1).every(child => !isVisibleInContext(child!, startingStyleContext))).toBe(true);
    expect(startingStyleChildren.every(child => child.options?.normalizedFromAssign === AssignmentType.MergeSequence)).toBe(true);

    expect(evald.toString({ context: new Context() })).toBeString(`
      .x {
        @starting-style {
          padding: 10px 8px 6px 4px;
        }
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
