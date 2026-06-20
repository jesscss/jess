import { describe, expect, it } from 'vitest';
import { Context } from '../../../context.js';
import { Bool } from '../../bool.js';
import { any, decl, list, mixin, rules, vardecl } from '../../index.js';
import {
  createCallableOuterRules,
  createOwnedCallableRulesSurface,
  createUnlockedCallableRulesSurface
} from '../callable-surface.js';
import { createCallableDefaultState } from '../callable-default-guard.js';
import { createCallableLiveSlots } from '../callable-live-slots.js';
import { matchCallableParams } from '../callable-param-match.js';
import { prepareCallableCandidateState } from '../callable-candidate-state.js';
import { executeCallableCandidate } from '../callable-candidate-execution.js';

describe('callable candidate execution helper', () => {
  it('evaluates a parameterized callable candidate and returns output', async () => {
    const context = new Context({ leakyRules: true });
    const candidate = mixin({
      name: any('.button'),
      params: list([vardecl({ name: 'tone', value: any('red') })]),
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });
    const definitionParent = rules([candidate]);
    const callSiteRules = rules([]);
    definitionParent.getScopeFrame();
    callSiteRules.getScopeFrame();

    const bindingInfo = matchCallableParams({
      params: candidate.params!,
      args: [any('blue')],
      hasFileContext: false
    });
    expect(bindingInfo).toBeDefined();

    const candidateState = prepareCallableCandidateState({
      candidate,
      callSiteRules,
      leakyRules: true,
      resolvedBindingInfo: bindingInfo,
      createOwnedRules: createOwnedCallableRulesSurface,
      createUnlockedRules: createUnlockedCallableRulesSurface,
      getRootSourceRules: rulesNode => rulesNode
    });
    const defaultState = createCallableDefaultState();

    const result = await executeCallableCandidate({
      context,
      hasDefault: false,
      candidate,
      candidateGuard: undefined,
      candidateParams: candidate.params,
      candidateState,
      nodeArgs: [any('blue')],
      defaultState,
      restrictMixinOutputLookup: true,
      createOuterRules: createCallableOuterRules
    });

    expect(result.output).toBeDefined();
    expect(result.debugDefaultProbeResult).toBeUndefined();
    expect(defaultState.pendingCandidates).toEqual([]);
  });

  it('defers passing default-guard candidates into default-state bookkeeping', async () => {
    const context = new Context({ leakyRules: true });
    const dynamicGuard = new Bool(true);
    dynamicGuard.hasFlag = () => false;
    dynamicGuard.eval = async evalContext => new Bool(evalContext.isDefault === true);

    const candidate = mixin({
      name: any('.button'),
      rules: [
        decl({ name: 'color', value: any('red') })
      ],
      guard: dynamicGuard
    });
    const definitionParent = rules([candidate]);
    const callSiteRules = rules([]);
    definitionParent.getScopeFrame();
    callSiteRules.getScopeFrame();

    const candidateState = prepareCallableCandidateState({
      candidate,
      callSiteRules,
      leakyRules: true,
      createOwnedRules: createOwnedCallableRulesSurface,
      createUnlockedRules: createUnlockedCallableRulesSurface,
      getRootSourceRules: rulesNode => rulesNode
    });
    const defaultState = createCallableDefaultState();

    const result = await executeCallableCandidate({
      context,
      hasDefault: true,
      candidate,
      candidateGuard: candidate.guard,
      candidateParams: candidate.params,
      candidateState,
      nodeArgs: [],
      defaultState,
      restrictMixinOutputLookup: true,
      createOuterRules: createCallableOuterRules
    });

    expect(result.output).toBeUndefined();
    expect(result.debugDefaultProbeResult).toEqual({
      passWhenDefaultFalse: false,
      passWhenDefaultTrue: true
    });
    expect(defaultState.pendingCandidates).toHaveLength(1);
  });
});
