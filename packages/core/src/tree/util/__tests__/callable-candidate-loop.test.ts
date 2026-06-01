import { describe, expect, it } from 'vitest';
import { Context } from '../../../context.js';
import { any, decl, el, list, mixin, ref, rules, ruleset, vardecl } from '../../index.js';
import {
  callableRulesEntry,
  createCallableOuterRules,
  createOwnedCallableRulesSurface,
  createUnlockedCallableRulesSurface
} from '../../rules.js';
import { createCallableDefaultState } from '../callable-default-guard.js';
import { createCallableOutputState } from '../callable-output.js';
import { getMixinOutputPlacementRecord } from '../mixin-output-slot.js';
import { matchCallableParams } from '../callable-param-match.js';
import { executeCallableCandidateLoop } from '../callable-candidate-loop.js';

describe('callable candidate loop helper', () => {
  it('handles ruleset special-case candidates through output state', async () => {
    const context = new Context({ leakyRules: true });
    const callerRules = rules([]);
    const candidate = ruleset({
      selector: el('.candidate'),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    const root = rules([candidate, callerRules]);
    context.root = root;
    context.rulesContext = callerRules;

    const outputState = createCallableOutputState();
    await executeCallableCandidateLoop({
      context,
      evalCandidates: [candidate],
      hasDefault: false,
      nodeArgs: [],
      resolvedParamBindings: new WeakMap(),
      outputState,
      defaultState: createCallableDefaultState(),
      restrictMixinOutputLookup: true,
      debugDefaultGuard: false,
      debugCaller: () => '<test>',
      specialCaseCallSiteRules: callerRules,
      ordinaryCallSiteRules: callerRules,
      copyGuardForEval: guard => guard,
      createOwnedRules: createOwnedCallableRulesSurface,
      createUnlockedRules: createUnlockedCallableRulesSurface,
      evaluateOwnedRules: async rulesNode => rulesNode.eval(context),
      getRootSourceRules: rulesNode => rulesNode,
      createOuterRules: createCallableOuterRules,
      isCallableEntry: entry => !('type' in entry && entry.type === 'Ruleset'),
      getMixinEntryRules: entry => entry.value.rules,
      getCallableEntryName: entry => entry.value.name,
      getCallableEntryParams: entry => entry.value.params,
      getCallableEntryGuard: entry => entry.value.guard
    });

    expect(outputState.sourceRules).toBe(candidate.value.rules);
    expect(outputState.outputRules).toHaveLength(1);
    expect(getMixinOutputPlacementRecord(outputState.outputRules[0]!)).toEqual({
      source: candidate.value.rules,
      output: outputState.outputRules[0]
    });
  });

  it('handles ordinary callable entries through candidate setup and execution', async () => {
    const context = new Context({ leakyRules: true });
    const candidate = mixin({
      name: any('.button'),
      params: list([vardecl({ name: 'tone', value: any('red') })]),
      rules: rules([
        decl({ name: 'color', value: ref({ key: 'tone' }, { type: 'variable' }) })
      ])
    });
    const definitionParent = rules([candidate]);
    const callerRules = rules([]);
    definitionParent.getScopeFrame();
    callerRules.getScopeFrame();
    context.rulesContext = callerRules;

    const bindingInfo = matchCallableParams({
      params: candidate.value.params!,
      args: [any('blue')],
      hasFileContext: false
    });
    expect(bindingInfo).toBeDefined();

    const resolvedParamBindings = new WeakMap();
    resolvedParamBindings.set(candidate, bindingInfo!);
    const outputState = createCallableOutputState();
    await executeCallableCandidateLoop({
      context,
      evalCandidates: [candidate],
      hasDefault: false,
      nodeArgs: [any('blue')],
      resolvedParamBindings,
      outputState,
      defaultState: createCallableDefaultState(),
      restrictMixinOutputLookup: true,
      debugDefaultGuard: false,
      debugCaller: () => '<test>',
      specialCaseCallSiteRules: callerRules,
      ordinaryCallSiteRules: callerRules,
      copyGuardForEval: guard => guard,
      createOwnedRules: createOwnedCallableRulesSurface,
      createUnlockedRules: createUnlockedCallableRulesSurface,
      evaluateOwnedRules: async rulesNode => rulesNode.eval(context),
      getRootSourceRules: rulesNode => rulesNode,
      createOuterRules: createCallableOuterRules,
      isCallableEntry: entry => !('type' in entry && entry.type === 'Ruleset'),
      getMixinEntryRules: entry => entry.value.rules,
      getCallableEntryName: entry => entry.value.name,
      getCallableEntryParams: entry => entry.value.params,
      getCallableEntryGuard: entry => entry.value.guard
    });

    expect(outputState.sourceRules).toBe(candidate.value.rules);
    expect(outputState.outputRules).toHaveLength(1);
    expect(outputState.outputRules[0]?.toString()).toContain('color: blue;');
  });

  it('handles anonymous callable-rules through the unlocked special-case path', async () => {
    const context = new Context({ leakyRules: true });
    const detachedBody = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const definitionRules = rules([]);
    definitionRules.adopt(detachedBody);
    const callerRules = rules([]);
    context.rulesContext = callerRules;

    const candidate = callableRulesEntry({ rules: detachedBody }, definitionRules, 7);
    const outputState = createCallableOutputState();
    await executeCallableCandidateLoop({
      context,
      evalCandidates: [candidate],
      hasDefault: false,
      nodeArgs: [],
      resolvedParamBindings: new WeakMap(),
      outputState,
      defaultState: createCallableDefaultState(),
      restrictMixinOutputLookup: true,
      debugDefaultGuard: false,
      debugCaller: () => '<test>',
      specialCaseCallSiteRules: callerRules,
      ordinaryCallSiteRules: callerRules,
      copyGuardForEval: guard => guard,
      createOwnedRules: createOwnedCallableRulesSurface,
      createUnlockedRules: createUnlockedCallableRulesSurface,
      evaluateOwnedRules: async rulesNode => rulesNode.eval(context),
      getRootSourceRules: rulesNode => rulesNode,
      createOuterRules: createCallableOuterRules,
      isCallableEntry: entry => !('type' in entry && entry.type === 'Ruleset'),
      getMixinEntryRules: entry => entry.value.rules,
      getCallableEntryName: entry => entry.value.name,
      getCallableEntryParams: entry => entry.value.params,
      getCallableEntryGuard: entry => entry.value.guard
    });

    expect(outputState.outputRules).toHaveLength(1);
    expect(outputState.outputRules[0]?.index).toBe(7);
  });
});
