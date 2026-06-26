import { describe, expect, it } from 'vitest';
import { Context } from '../../../context.js';
import { any, call, decl, el, mixin, ref, rules, ruleset, vardecl } from '../../index.js';
import type { Node } from '../../node.js';
import { callableRulesEntry } from '../callable-entry.js';
import {
  createOwnedCallableRulesSurface,
  createUnlockedCallableRulesSurface,
  getRootSourceRules
} from '../callable-surface.js';
import { getMixinOutputPlacementRecord } from '../mixin-output-slot.js';
import { evaluateCallableSpecialCaseCandidate } from '../callable-special-case.js';

describe('callable special-case helper', () => {
  it('handles ruleset candidates through ruleset-placement output', async () => {
    const context = new Context({ leakyRules: true });
    context.depth = 2;

    const callerRules = rules([]);
    const candidate = ruleset({
      selector: el('.candidate'),
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });
    const root = rules([
      candidate,
      ruleset({
        selector: el('.use'),
        rules: callerRules
      })
    ]);
    const caller = call({ name: ref({ key: '.candidate' }, { type: 'mixin' }) });
    callerRules.adopt(caller);
    context.root = root;
    context.rulesContext = callerRules;

    const result = await evaluateCallableSpecialCaseCandidate({
      candidate,
      context,
      caller,
      callSiteRules: context.rulesContext,
      restrictMixinOutputLookup: true,
      candidateName: undefined,
      candidateParams: undefined,
      candidateGuard: undefined,
      createOwnedRules: createOwnedCallableRulesSurface,
      createUnlockedRules: createUnlockedCallableRulesSurface,
      getRootSourceRules
    });

    expect(result.handled).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.output?.index).toBe(candidate.index);
    expect(result.output?.toString()).toContain('color: red;');
    expect(result.output?.options.mixinOutputSlot?.rulesetPlacement?.sourceRules).toBe(candidate);
    expect(getMixinOutputPlacementRecord(result.output!)).toEqual({
      source: candidate,
      output: result.output
    });
  });

  it('handles anonymous detached callable-rules through unlocked eval output', async () => {
    const context = new Context({ leakyRules: true });
    context.depth = 2;

    const detachedBody = rules([
      decl({ name: 'color', value: ref({ key: 'tone' }, { type: 'variable' }) })
    ]);
    const definitionRules = rules([
      vardecl({ name: 'tone', value: any('blue') })
    ]);
    definitionRules.adopt(detachedBody);

    const callerRules = rules([
      vardecl({ name: 'tone', value: any('green') })
    ]);
    const candidate = callableRulesEntry({ rules: detachedBody }, definitionRules, 7);
    const root = rules([
      definitionRules,
      ruleset({
        selector: el('.use'),
        rules: callerRules
      })
    ]);
    context.root = root;
    context.rulesContext = callerRules;

    const result = await evaluateCallableSpecialCaseCandidate({
      candidate,
      context,
      caller: undefined,
      callSiteRules: context.rulesContext,
      restrictMixinOutputLookup: true,
      candidateName: undefined,
      candidateParams: undefined,
      candidateGuard: undefined,
      createOwnedRules: createOwnedCallableRulesSurface,
      createUnlockedRules: createUnlockedCallableRulesSurface,
      getRootSourceRules
    });

    expect(result.handled).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.output?.index).toBe(7);
    expect(result.output?.toString()).toContain('color: blue;');
    expect(result.output?.options.mixinOutputSlot?.fallbackFrame).toBe(callerRules.getScopeFrame());
  });

  it('uses call-site rules for parentless anonymous callable-rules output', async () => {
    const context = new Context({ leakyRules: true });
    context.depth = 2;

    const detachedBody = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const callerRules = rules([]);
    const candidate = callableRulesEntry({ rules: detachedBody });
    context.rulesContext = callerRules;

    const result = await evaluateCallableSpecialCaseCandidate({
      candidate,
      context,
      caller: undefined,
      callSiteRules: context.rulesContext,
      restrictMixinOutputLookup: true,
      candidateName: undefined,
      candidateParams: undefined,
      candidateGuard: undefined,
      createOwnedRules: createOwnedCallableRulesSurface,
      createUnlockedRules: createUnlockedCallableRulesSurface,
      getRootSourceRules
    });

    expect(candidate.parent).toBeUndefined();
    expect(result.handled).toBe(true);
    expect(result.output?.parent).toBe(callerRules);
    expect(result.output?.toString()).toContain('color: red;');
  });

  it('leaves ordinary mixin candidates on the main eval path', async () => {
    const context = new Context({ leakyRules: true });
    const candidate = mixin({
      name: any('.button'),
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });

    const result = await evaluateCallableSpecialCaseCandidate({
      candidate,
      context,
      caller: undefined,
      callSiteRules: undefined,
      restrictMixinOutputLookup: true,
      candidateName: candidate.name,
      candidateParams: candidate.params,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      candidateGuard: candidate.guard as Node | undefined,
      createOwnedRules: createOwnedCallableRulesSurface,
      createUnlockedRules: createUnlockedCallableRulesSurface,
      getRootSourceRules
    });

    expect(result).toEqual({ handled: false });
  });
});
