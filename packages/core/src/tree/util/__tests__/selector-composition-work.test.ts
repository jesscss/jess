import { describe, expect, it } from 'vitest';
import { Context } from '../../../context.js';
import {
  type Ruleset,
  el,
  extend,
  rules,
  ruleset
} from '../../index.js';
import { withExtendWorkCounters } from '../extend-work-counters.js';
import { selectorMatch } from '../selector-match-core.js';
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

describe('selector composition work', () => {
  it('records fast-reject counter activity for disjoint selector facts', async () => {
    const context = new Context();
    const find = el('.alpha');
    const target = el('.beta');

    await find.eval(context);
    await target.eval(context);

    find.keySetLibrary = context.selectorBits;
    target.keySetLibrary = context.selectorBits;

    const { result, counters } = await withExtendWorkCounters(() => selectorMatch(find, target));

    expect(result.partialMatch).toBe(false);
    expect(counters.fastRejectChecks).toBeGreaterThan(0);
    expect(counters.fastRejectRejects).toBeGreaterThan(0);
  });

  it('limits parent-aware selector composition on disjoint nested extends', async () => {
    const root = rules([
      ruleset({
        selector: el('.parent'),
        rules: rules([
          ruleset({ selector: el('.child'), rules: rules([]) }),
          ruleset({ selector: el('.child-two'), rules: rules([]) })
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
      }),
      ruleset({
        selector: el('.ext-d'),
        rules: rules([extend({ target: el('.missing-d') })])
      })
    ]);

    const { counters } = await evalWithCounters(root);

    expect(counters.instructionsConsidered).toBeGreaterThan(0);
    expect(counters.selectorCompositionCalls).toBeLessThanOrEqual(10);
    expect(counters.routePlansBuilt).toBeLessThanOrEqual(88);
    expect(counters.rewritesApplied).toBe(0);
  });

  it('permits composition when a surviving nested candidate actually needs it', async () => {
    const root = rules([
      ruleset({
        selector: el('.parent'),
        rules: rules([
          ruleset({ selector: el('.child'), rules: rules([]) })
        ])
      }),
      ruleset({
        selector: el('.ext'),
        rules: rules([extend({ target: el('.child') })])
      })
    ]);

    const { counters, context, evald } = await evalWithCounters(root);
    const parentRuleset = getRulesetAt(evald, 0, context);
    const nestedCandidate = parentRuleset?.get('rules', context)?.value?.[0];
    const nestedRuleset = isNode(nestedCandidate, N.Ruleset) ? nestedCandidate : undefined;

    expect(nestedRuleset?.getEffectiveSelector(false, context).valueOf()).toContain('.ext');
    expect(counters.positiveMatches).toBeGreaterThan(0);
    expect(counters.selectorCompositionCalls).toBeGreaterThan(0);
  });
});
