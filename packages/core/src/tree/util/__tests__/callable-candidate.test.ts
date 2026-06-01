import { describe, expect, it } from 'vitest';
import { call, condition, defaultguard, el, ref, rules, ruleset } from '../../index.js';
import { callableRulesEntry } from '../../rules.js';
import { prepareCallableEvalCandidates } from '../callable-candidate.js';

describe('callable candidate helpers', () => {
  it('dedupes shared-source candidates and sorts default guards last without rules closure state', () => {
    const sharedRules = rules([]);
    const plainRuleset = ruleset({
      selector: el('.plain'),
      rules: sharedRules
    });
    const sharedCallable = callableRulesEntry({ rules: sharedRules });
    const defaultCallable = callableRulesEntry({
      guard: condition([defaultguard()]),
      rules: rules([])
    });

    const prepared = prepareCallableEvalCandidates({
      mixinCandidates: [defaultCallable, plainRuleset, sharedCallable],
      rulesEvalStack: []
    });

    expect(prepared.hasDefault).toBe(true);
    expect(prepared.evalCandidates).toHaveLength(2);
    expect(prepared.evalCandidates[0]).toBe(plainRuleset);
    expect(prepared.evalCandidates[1]).toBe(defaultCallable);
  });

  it('skips ruleset candidates that recurse to the caller key', () => {
    const recursiveRuleset = ruleset({
      selector: el('.loop'),
      rules: rules([
        call({ name: ref({ key: '.loop' }, { type: 'mixin' }) })
      ])
    });
    const caller = call({ name: ref({ key: '.loop' }, { type: 'mixin' }) });

    const prepared = prepareCallableEvalCandidates({
      mixinCandidates: [recursiveRuleset],
      rulesEvalStack: [],
      caller
    });

    expect(prepared.evalCandidates).toEqual([]);
    expect(prepared.hasDefault).toBe(false);
  });
});
