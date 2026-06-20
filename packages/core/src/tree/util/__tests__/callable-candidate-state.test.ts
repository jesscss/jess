import { describe, expect, it } from 'vitest';
import { any, atrule, decl, Declaration, list, mixin, rules, vardecl } from '../../index.js';
import { serializeTypes } from '../serialize-types.js';
import { F_STATIC } from '../../node.js';
import { callableRulesEntry } from '../callable-entry.js';
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
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });
    definitionParent.adopt(candidate);
    callSiteRules.getScopeFrame();
    definitionParent.getScopeFrame();

    const resolvedBindingInfo = matchCallableParams({
      params: candidate.params!,
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

    expect(state.sourceRules).toBe(candidate);
    expect(state.rules).not.toBe(candidate);
    expect(state.rules.options.rulesVisibility?.VarDeclaration).toBe('public');
    expect(state.rules.parent).toBe(candidate.parent);
    expect(state.paramBindings).toHaveLength(1);
    expect(state.signatureKey).toBeDefined();
    expect(state.parentFrame).toBe(callSiteRules.getScopeFrame());
    expect(state.definitionFrame).toBe(definitionParent.getScopeFrame());
    expect(state.lexicalScopeFrame).toBe(definitionParent.getScopeFrame());
    expect(state.fallbackScopeFrame).toBe(callSiteRules.getScopeFrame());
  });

  it('prepares static callable-rules candidates with source children and no fallback frame in non-leaky mode', () => {
    const definitionParent = rules([]);
    const callSiteRules = rules([]);
    const sourceDecl = decl({ name: 'color', value: any('red') });
    const sourceRules = rules([sourceDecl]);
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
    expect(state.rules.rules[0]).toBe(sourceDecl);
    expect(sourceDecl.parent).toBe(sourceRules);
    expect(state.rules.options.rulesVisibility?.VarDeclaration).toBe('private');
    expect(state.parentFrame).toBe(callSiteRules.getScopeFrame());
    expect(state.fallbackScopeFrame).toBeUndefined();
    expect(state.paramBindings).toEqual([]);
    expect(state.signatureKey).toBeUndefined();
  });

  it('uses call-site rules as placement parent for parentless callable-rules candidates', () => {
    const callSiteRules = rules([]);
    const sourceDecl = decl({ name: 'color', value: any('red') });
    const sourceRules = rules([sourceDecl]);
    const candidate = callableRulesEntry({ name: undefined, params: undefined, rules: sourceRules });

    const state = prepareCallableCandidateState({
      candidate,
      callSiteRules,
      leakyRules: false,
      createOwnedRules: createOwnedCallableRulesSurface,
      createUnlockedRules: createUnlockedCallableRulesSurface,
      getRootSourceRules: rulesNode => rulesNode
    });

    expect(candidate.parent).toBeUndefined();
    expect(state.candidateParent).toBe(callSiteRules);
    expect(state.rules.parent).toBe(callSiteRules);
    expect(state.parentFrame).toBe(callSiteRules.getScopeFrame());
    expect(state.definitionFrame).toBeUndefined();
  });

  it('copies raw-field at-rules inside owned callable-rules surfaces', () => {
    const callSiteRules = rules([]);
    const sourceRules = rules([
      atrule({
        name: '@media',
        prelude: 'screen',
        rules: [
          new Declaration({
            name: 'color',
            value: ['blue']
          })
        ]
      })
    ]);
    const candidate = callableRulesEntry({ name: undefined, params: undefined, rules: sourceRules });

    const state = prepareCallableCandidateState({
      candidate,
      callSiteRules,
      leakyRules: false,
      createOwnedRules: createOwnedCallableRulesSurface,
      createUnlockedRules: createUnlockedCallableRulesSurface,
      getRootSourceRules: rulesNode => rulesNode
    });

    expect(state.rules).not.toBe(sourceRules);
    expect(state.rules.toString()).toContain('@media screen');
    expect(state.rules.toString()).toContain('color: blue;');
    const types = serializeTypes(state.rules);
    expect(types).toContain('rawName: \'@media\'');
    expect(types).toContain('rawPrelude: \'screen\'');
    expect(types).toContain('rawName: \'color\'');
    expect(types).toContain('rawValueSegments:');
    expect(types).not.toContain('name: (Any [role=atkeyword] \'@media\')');
    expect(types).not.toContain('valueNode: (Any \'blue\')');
  });

  it('keeps childless static callable-rules candidates on the unlocked rules path', () => {
    const definitionParent = rules([]);
    const sourceRules = rules([]);
    sourceRules.addFlag(F_STATIC);
    definitionParent.adopt(sourceRules);
    const candidate = callableRulesEntry({ name: undefined, params: undefined, rules: sourceRules }, definitionParent, 3);

    const state = prepareCallableCandidateState({
      candidate,
      callSiteRules: undefined,
      leakyRules: false,
      createOwnedRules: () => {
        throw new Error('childless static candidates should not need owned rules');
      },
      createUnlockedRules: createUnlockedCallableRulesSurface,
      getRootSourceRules: rulesNode => rulesNode
    });

    expect(state.sourceRules).toBe(sourceRules);
    expect(state.rules).not.toBe(sourceRules);
    expect(state.rules.rules).toEqual([]);
    expect(state.parentFrame).toBeUndefined();
    expect(state.fallbackScopeFrame).toBeUndefined();
  });
});
