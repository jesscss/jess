import { describe, expect, it } from 'vitest';
import { Context } from '../../../context.js';
import { Bool } from '../../bool.js';
import type { Condition } from '../../condition.js';
import { any, decl, list, mixin, rules, vardecl } from '../../index.js';
import type { Node } from '../../node.js';
import {
  createCallableOuterRules,
  createCallableRulesSurface
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
      name: '.button',
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
      createCallableRules: createCallableRulesSurface,
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    dynamicGuard.eval = (async (evalContext: Context) => new Bool(evalContext.isDefault === true)) as unknown as (context: Context) => Bool;

    const candidate = mixin({
      name: '.button',
      rules: [
        decl({ name: 'color', value: any('red') })
      ],
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      guard: dynamicGuard as unknown as Condition
    });
    const definitionParent = rules([candidate]);
    const callSiteRules = rules([]);
    definitionParent.getScopeFrame();
    callSiteRules.getScopeFrame();

    const candidateState = prepareCallableCandidateState({
      candidate,
      callSiteRules,
      leakyRules: true,
      createCallableRules: createCallableRulesSurface,
      getRootSourceRules: rulesNode => rulesNode
    });
    const defaultState = createCallableDefaultState();

    const result = await executeCallableCandidate({
      context,
      hasDefault: true,
      candidate,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      candidateGuard: candidate.guard as Node | undefined,
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
