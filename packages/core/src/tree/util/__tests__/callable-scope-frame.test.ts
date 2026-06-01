import { describe, expect, it } from 'vitest';
import { any, decl, rules } from '../../index.js';
import type { BindingCell } from '../../scope-frame.js';
import { wireCallableScopeFrames } from '../callable-scope-frame.js';

describe('callable scope frame helper', () => {
  it('shares the main callable scope frame with outer rules when no prebound guard wrapper is needed', () => {
    const callableRules = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const outerRules = rules([]);
    const lexicalScopeFrame = rules([]).getScopeFrame();
    const fallbackScopeFrame = rules([]).getScopeFrame();
    const liveSlots = new Map<string, BindingCell>([
      ['value', { value: any('blue') }]
    ]);

    wireCallableScopeFrames({
      rules: callableRules,
      outerRules,
      lexicalScopeFrame,
      fallbackScopeFrame,
      liveSlots
    });

    expect(callableRules.scopeFrame?.parent).toBe(lexicalScopeFrame);
    expect(callableRules.scopeFrame?.fallbackFrame).toBe(fallbackScopeFrame);
    expect(outerRules.scopeFrame).toBe(callableRules.scopeFrame);
  });

  it('creates a dedicated outer scope frame for prebound param guards', () => {
    const callableRules = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const outerRules = rules([]);
    const lexicalScopeFrame = rules([]).getScopeFrame();
    const parentFrame = rules([]).getScopeFrame();
    const liveSlots = new Map<string, BindingCell>([
      ['value', { value: any('blue') }]
    ]);

    wireCallableScopeFrames({
      rules: callableRules,
      outerRules,
      lexicalScopeFrame,
      parentFrame,
      liveSlots,
      usesPreboundParamGuardOuterRules: true
    });

    expect(outerRules.scopeFrame).not.toBe(callableRules.scopeFrame);
    expect(outerRules.scopeFrame?.parent).toBe(lexicalScopeFrame);
    expect(outerRules.scopeFrame?.fallbackFrame).toBe(parentFrame);
    expect(outerRules.scopeFrame?.liveSlotsByName).not.toBe(callableRules.scopeFrame?.liveSlotsByName);
    expect(outerRules.scopeFrame?.liveSlotsByName.get('value')).toBe(callableRules.scopeFrame?.liveSlotsByName.get('value'));
  });

  it('assigns the caller fallback frame directly for leaky no-param mixins', () => {
    const callableRules = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const parentFrame = rules([]).getScopeFrame();

    wireCallableScopeFrames({
      rules: callableRules,
      parentFrame,
      leakyRules: true
    });

    expect(callableRules.getScopeFrame().fallbackFrame).toBe(parentFrame);
  });
});
