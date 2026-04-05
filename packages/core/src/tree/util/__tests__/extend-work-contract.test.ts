import { describe, expect, it } from 'vitest';
import { Context } from '../../../context.js';
import {
  ExtendFlag,
  type Ruleset,
  co,
  compound,
  el,
  extend,
  pseudo,
  rules,
  ruleset,
  sel,
  sellist
} from '../../index.js';
import { withExtendWorkCounters } from '../extend-work-counters.js';
import { isNode } from '../is-node.js';
import { N } from '../../node-type.js';

async function evalWithCounters(root: ReturnType<typeof rules>) {
  const context = new Context();
  const { result, counters } = await withExtendWorkCounters(() => root.eval(context));
  return {
    context,
    counters,
    evald: result
  };
}

function getRulesetAt(
  evald: ReturnType<typeof rules>,
  index: number,
  context: Context
): Ruleset | undefined {
  const node = evald.at(index, context);
  return isNode(node, N.Ruleset) ? node : undefined;
}

describe('extend work contract', () => {
  it('does no extend work when no extends exist', async () => {
    const root = rules([
      ruleset({
        selector: el('.outer'),
        rules: rules([
          ruleset({ selector: el('.inner-a'), rules: rules([]) }),
          ruleset({ selector: el('.inner-b'), rules: rules([]) })
        ])
      }),
      ruleset({ selector: el('.sibling'), rules: rules([]) })
    ]);

    const { counters } = await evalWithCounters(root);

    expect(counters.processExtendsCalls).toBe(1);
    expect(counters.instructionsConsidered).toBe(0);
    expect(counters.routePlansBuilt).toBe(0);
    expect(counters.groupRequirementsBuilt).toBe(0);
    expect(counters.rewritesApplied).toBe(0);
    expect(counters.positiveMatches).toBe(0);
  });

  it('fast-rejects disjoint extends without rewrites or planner churn', async () => {
    const root = rules([
      ruleset({ selector: el('.target-a'), rules: rules([]) }),
      ruleset({ selector: el('.target-b'), rules: rules([]) }),
      ruleset({
        selector: el('.ext-a'),
        rules: rules([extend({ target: el('.missing-a') })])
      }),
      ruleset({
        selector: el('.ext-b'),
        rules: rules([extend({ target: el('.missing-b') })])
      })
    ]);

    const { counters } = await evalWithCounters(root);

    expect(counters.positiveMatches).toBe(0);
    expect(counters.rewritesApplied).toBe(0);
    expect(counters.routePlansBuilt).toBeLessThanOrEqual(20);
    expect(counters.selectorCompositionCalls).toBe(0);
    expect(counters.processExtendsPasses).toBe(1);
  });

  it('keeps exact extend work localized to affected rulesets', async () => {
    const root = rules([
      ruleset({ selector: el('.foo'), rules: rules([]) }),
      ruleset({
        selector: el('.bar'),
        rules: rules([extend({ target: el('.foo') })])
      }),
      ruleset({ selector: el('.untouched'), rules: rules([]) })
    ]);

    const { counters, context, evald } = await evalWithCounters(root);
    const fooRuleset = getRulesetAt(evald, 0, context);
    const untouchedRuleset = getRulesetAt(evald, 2, context);

    expect(fooRuleset?.getEffectiveSelector(false, context).valueOf()).toBe('.foo,.bar');
    expect(untouchedRuleset?.getEffectiveSelector(false, context).valueOf()).toBe('.untouched');
    expect(counters.positiveMatches).toBeGreaterThan(0);
    expect(counters.rewritesApplied).toBe(1);
    expect(counters.rulesetsChanged).toBe(1);
    expect(counters.routePlansBuilt).toBeLessThanOrEqual(8);
    expect(counters.selectorCompositionCalls).toBe(0);
  });

  it('allows planner work for partial extend through :is only on surviving candidates', async () => {
    const root = rules([
      ruleset({
        selector: compound([
          pseudo({
            name: ':is',
            arg: sellist([el('.a'), el('.b')])
          }),
          el('.tail')
        ]),
        rules: rules([])
      }),
      ruleset({ selector: el('.untouched'), rules: rules([]) }),
      ruleset({
        selector: el('.ext'),
        rules: rules([extend({ target: el('.a'), flag: ExtendFlag.All })])
      })
    ]);

    const { counters, context, evald } = await evalWithCounters(root);
    const targetRuleset = getRulesetAt(evald, 0, context);
    const untouchedRuleset = getRulesetAt(evald, 1, context);
    const output = targetRuleset?.getEffectiveSelector(false, context).valueOf() ?? '';

    expect(output).toContain('.ext');
    expect(output).toContain('.tail');
    expect(untouchedRuleset?.getEffectiveSelector(false, context).valueOf()).toBe('.untouched');
    expect(counters.positiveMatches).toBeGreaterThan(0);
    expect(counters.rewritesApplied).toBe(1);
    expect(counters.rulesetsChanged).toBe(1);
    expect(counters.routePlansBuilt).toBeGreaterThan(0);
    expect(counters.groupRequirementsBuilt).toBeGreaterThan(0);
  });

  it('bounds chained extend passes to real new-selector work', async () => {
    const root = rules([
      ruleset({ selector: el('.foo'), rules: rules([]) }),
      ruleset({
        selector: el('.bar'),
        rules: rules([extend({ target: el('.foo') })])
      }),
      ruleset({
        selector: el('.baz'),
        rules: rules([extend({ target: el('.bar') })])
      })
    ]);

    const { counters, context, evald } = await evalWithCounters(root);
    const fooRuleset = getRulesetAt(evald, 0, context);

    expect(fooRuleset?.getEffectiveSelector(false, context).valueOf()).toBe('.foo,.bar,.baz');
    expect(counters.processExtendsPasses).toBeGreaterThan(1);
    expect(counters.processExtendsPasses).toBeLessThanOrEqual(3);
    expect(counters.rulesetsChanged).toBeGreaterThanOrEqual(2);
    expect(counters.rulesetsChanged).toBeLessThanOrEqual(3);
    expect(counters.chainedFollowupEnqueues).toBeGreaterThanOrEqual(2);
    expect(counters.chainedFollowupEnqueues).toBeLessThanOrEqual(3);
  });

  it('does not turn parent composition into blanket preprocessing for disjoint nested extends', async () => {
    const root = rules([
      ruleset({
        selector: el('.parent'),
        rules: rules([
          ruleset({ selector: el('.child'), rules: rules([]) })
        ])
      }),
      ruleset({
        selector: el('.ext-a'),
        rules: rules([extend({ target: el('.missing-a') })])
      }),
      ruleset({
        selector: el('.ext-b'),
        rules: rules([extend({ target: el('.missing-b') })])
      }),
      ruleset({
        selector: el('.ext-c'),
        rules: rules([extend({ target: el('.missing-c') })])
      })
    ]);

    const { counters } = await evalWithCounters(root);

    expect(counters.positiveMatches).toBe(0);
    expect(counters.rewritesApplied).toBe(0);
    expect(counters.selectorCompositionCalls).toBeLessThanOrEqual(4);
  });
});
