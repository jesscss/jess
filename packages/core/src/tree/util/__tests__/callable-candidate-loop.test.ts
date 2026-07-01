import { describe, expect, it } from 'vitest';
import { Context } from '../../../context.js';
import { any, decl, el, list, mixin, ref, rules, ruleset, vardecl } from '../../index.js';
import {
  callableRulesEntry,
  type CallableEntry
} from '../callable-entry.js';
import type { CallableParamMatch } from '../callable-param-match.js';
import {
  createCallableOuterRules,
  createCallableRulesSurface
} from '../callable-surface.js';
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
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
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
      createCallableRules: createCallableRulesSurface,
      getRootSourceRules: rulesNode => rulesNode,
      createOuterRules: createCallableOuterRules
    });

    expect(outputState.sourceRules).toBe(candidate);
    expect(outputState.outputRules).toHaveLength(1);
    expect(getMixinOutputPlacementRecord(outputState.outputRules[0]!)).toEqual({
      source: candidate,
      output: outputState.outputRules[0]
    });
  });

  it('handles ordinary callable entries through candidate setup and execution', async () => {
    const context = new Context({ leakyRules: true });
    const candidate = mixin({
      name: any('.button'),
      params: list([vardecl({ name: 'tone', value: any('red') })]),
      rules: [
        decl({ name: 'color', value: ref({ key: 'tone' }, { type: 'variable' }) })
      ]
    });
    const definitionParent = rules([candidate]);
    const callerRules = rules([]);
    definitionParent.getScopeFrame();
    callerRules.getScopeFrame();
    context.rulesContext = callerRules;

    const bindingInfo = matchCallableParams({
      params: candidate.params!,
      args: [any('blue')],
      hasFileContext: false
    });
    expect(bindingInfo).toBeDefined();

    const resolvedParamBindings = new WeakMap<CallableEntry, CallableParamMatch>();
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
      createCallableRules: createCallableRulesSurface,
      getRootSourceRules: rulesNode => rulesNode,
      createOuterRules: createCallableOuterRules
    });

    expect(outputState.sourceRules).toBe(candidate);
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
      createCallableRules: createCallableRulesSurface,
      getRootSourceRules: rulesNode => rulesNode,
      createOuterRules: createCallableOuterRules
    });

    expect(outputState.outputRules).toHaveLength(1);
    expect(outputState.outputRules[0]?.index).toBe(7);
  });
});
