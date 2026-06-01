import { describe, expect, it } from 'vitest';
import { any, decl, rules } from '../../index.js';
import { ensureCallableOuterRulesSurface } from '../callable-outer-rules.js';
import { createCallableOuterRules } from '../../rules.js';

describe('callable outer rules helper', () => {
  it('creates and reuses an outer rules surface while syncing frame and index', () => {
    const sourceRules = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const parent = rules([]);
    const scopeFrame = sourceRules.getScopeFrame();

    const first = ensureCallableOuterRulesSurface({
      rules: sourceRules,
      parent,
      createOuterRules: createCallableOuterRules,
      candidateIndex: 7
    });

    expect(first.parent).toBe(parent);
    expect(first.index).toBe(7);
    expect(first.scopeFrame).toBe(scopeFrame);

    const second = ensureCallableOuterRulesSurface({
      currentOuterRules: first,
      rules: sourceRules,
      parent,
      createOuterRules: createCallableOuterRules,
      candidateIndex: 9
    });

    expect(second).toBe(first);
    expect(second.index).toBe(9);
    expect(second.scopeFrame).toBe(scopeFrame);
  });

  it('preserves an existing outer scope frame when sync is disabled', () => {
    const sourceRules = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const parent = rules([]);
    const first = ensureCallableOuterRulesSurface({
      rules: sourceRules,
      parent,
      createOuterRules: createCallableOuterRules,
      candidateIndex: 1
    });
    const preservedFrame = first.getScopeFrame();

    sourceRules.scopeFrame = undefined;

    const second = ensureCallableOuterRulesSurface({
      currentOuterRules: first,
      rules: sourceRules,
      parent,
      createOuterRules: createCallableOuterRules,
      candidateIndex: 2,
      syncScopeFrame: false
    });

    expect(second.scopeFrame).toBe(preservedFrame);
    expect(second.index).toBe(2);
  });
});
