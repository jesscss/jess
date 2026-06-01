import { describe, expect, it } from 'vitest';
import { any, decl, list, mixin, rules, vardecl } from '../../index.js';
import { F_STATIC } from '../../node.js';
import { callableRulesEntry } from '../../rules.js';
import { createOwnedCallableRulesSurface, createUnlockedCallableRulesSurface } from '../callable-surface.js';
import { matchCallableParams } from '../callable-param-match.js';
import { prepareCallableCandidateState } from '../callable-candidate-state.js';

describe('callable candidate state helper', () => {
  it('prepares dynamic mixin candidates with owned rules, visibility, and lexical/fallback frames', () => {
    const definitionParent = rules([]);
    const callSiteRules = rules([]);
    const candidate = mixin({
      name: any('.button'),
      params: list([vardecl({ name: 'tone', value: any('red') })]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    definitionParent.adopt(candidate);
    callSiteRules.getScopeFrame();
    definitionParent.getScopeFrame();

    const resolvedBindingInfo = matchCallableParams({
      params: candidate.value.params!,
      args: [any('blue')],
      hasFileContext: false
    });
    expect(resolvedBindingInfo).toBeDefined();

    const state = prepareCallableCandidateState({
      candidate,
      callSiteRules,
      leakyRules: true,
      resolvedBindingInfo,
      createOwnedRules: createOwnedCallableRulesSurface,
      createUnlockedRules: createUnlockedCallableRulesSurface,
      getRootSourceRules: rulesNode => rulesNode
    });

    expect(state.sourceRules).toBe(candidate.value.rules);
    expect(state.rules).not.toBe(candidate.value.rules);
    expect(state.rules.options.rulesVisibility?.VarDeclaration).toBe('public');
    expect(state.rules.parent).toBe(candidate.parent);
    expect(state.paramBindings).toHaveLength(1);
    expect(state.signatureKey).toBeDefined();
    expect(state.parentFrame).toBe(callSiteRules.getScopeFrame());
    expect(state.definitionFrame).toBe(definitionParent.getScopeFrame());
    expect(state.lexicalScopeFrame).toBe(definitionParent.getScopeFrame());
    expect(state.fallbackScopeFrame).toBe(callSiteRules.getScopeFrame());
  });

  it('prepares static callable-rules candidates with unlocked rules and no fallback frame in non-leaky mode', () => {
    const definitionParent = rules([]);
    const callSiteRules = rules([]);
    const sourceRules = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    sourceRules.addFlag(F_STATIC);
    definitionParent.adopt(sourceRules);
    const candidate = callableRulesEntry({ name: undefined, params: undefined, rules: sourceRules }, definitionParent, 3);

    const state = prepareCallableCandidateState({
      candidate,
      callSiteRules,
      leakyRules: false,
      createOwnedRules: createOwnedCallableRulesSurface,
      createUnlockedRules: createUnlockedCallableRulesSurface,
      getRootSourceRules: rulesNode => rulesNode
    });

    expect(state.sourceRules).toBe(sourceRules);
    expect(state.rules).not.toBe(sourceRules);
    expect(state.rules.options.rulesVisibility?.VarDeclaration).toBe('private');
    expect(state.parentFrame).toBe(callSiteRules.getScopeFrame());
    expect(state.fallbackScopeFrame).toBeUndefined();
    expect(state.paramBindings).toEqual([]);
    expect(state.signatureKey).toBeUndefined();
  });
});
