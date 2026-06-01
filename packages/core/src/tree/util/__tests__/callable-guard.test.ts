import { describe, expect, it } from 'vitest';
import { Context } from '../../../context.js';
import { Bool } from '../../bool.js';
import { rules } from '../../index.js';
import { F_STATIC } from '../../node.js';
import { createCallableOuterRules } from '../../rules.js';
import { CALLABLE_DEFAULT_TRUE } from '../callable-default-guard.js';
import {
  evaluateCallableGuard,
  ensureCallableGuardOuterRules,
  prepareCallableGuardState
} from '../callable-guard.js';

describe('callable guard helpers', () => {
  it('copies dynamic non-default guards and leaves static/default guards alone', () => {
    const dynamicGuard = new Bool(true);
    dynamicGuard.hasFlag = () => false;
    const copiedGuard = new Bool(false);
    let copyCount = 0;

    const nonDefault = prepareCallableGuardState({
      hasDefault: false,
      candidateGuard: dynamicGuard,
      copyGuardForEval: () => {
        copyCount++;
        return copiedGuard;
      },
      paramBindingsLength: 0,
      rules: rules([]),
      parent: rules([]),
      createOuterRules: createCallableOuterRules
    });
    const defaultGuard = prepareCallableGuardState({
      hasDefault: true,
      candidateGuard: dynamicGuard,
      copyGuardForEval: () => {
        throw new Error('should not copy default guard');
      },
      paramBindingsLength: 0,
      rules: rules([]),
      parent: rules([]),
      createOuterRules: createCallableOuterRules
    });
    const staticGuard = new Bool(true);
    staticGuard.addFlag(F_STATIC);
    const staticResult = prepareCallableGuardState({
      hasDefault: false,
      candidateGuard: staticGuard,
      copyGuardForEval: () => {
        throw new Error('should not copy static guard');
      },
      paramBindingsLength: 0,
      rules: rules([]),
      parent: rules([]),
      createOuterRules: createCallableOuterRules
    });

    expect(nonDefault.guard).toBe(copiedGuard);
    expect(defaultGuard.guard).toBe(dynamicGuard);
    expect(staticResult.guard).toBe(staticGuard);
    expect(copyCount).toBe(1);
  });

  it('prebinds caller guard outer rules for dynamic no-param guards', () => {
    const dynamicGuard = new Bool(true);
    dynamicGuard.hasFlag = () => false;
    const callableRules = rules([]);
    const callerRules = rules([]);
    const parentFrame = callerRules.getScopeFrame();

    const result = prepareCallableGuardState({
      hasDefault: false,
      candidateGuard: dynamicGuard,
      copyGuardForEval: guard => guard,
      paramBindingsLength: 0,
      rules: callableRules,
      parent: rules([]),
      rulesContextParent: callerRules,
      parentFrame,
      candidateIndex: 7,
      createOuterRules: createCallableOuterRules
    });

    expect(result.usesPreboundCallerGuardOuterRules).toBe(true);
    expect(result.outerRules?.parent).toBe(callerRules);
    expect(result.outerRules?.scopeFrame).toBe(parentFrame);
    expect(result.outerRules?.index).toBe(7);
  });

  it('creates guard outer rules only for dynamic non-prebound guard paths', () => {
    const callableRules = rules([]);
    const parent = rules([]);
    const dynamicGuard = new Bool(true);
    dynamicGuard.hasFlag = () => false;
    const staticGuard = new Bool(true);
    staticGuard.addFlag(F_STATIC);

    const created = ensureCallableGuardOuterRules({
      guard: dynamicGuard,
      usesPreboundCallerGuardOuterRules: false,
      usesPreboundParamGuardOuterRules: false,
      rules: callableRules,
      parent,
      candidateIndex: 3,
      createOuterRules: createCallableOuterRules
    });
    const skipped = ensureCallableGuardOuterRules({
      guard: staticGuard,
      usesPreboundCallerGuardOuterRules: false,
      usesPreboundParamGuardOuterRules: false,
      rules: callableRules,
      parent,
      candidateIndex: 4,
      createOuterRules: createCallableOuterRules
    });

    expect(created?.parent).toBe(parent);
    expect(created?.index).toBe(3);
    expect(skipped).toBeUndefined();
  });

  it('evaluates default guards through rules-context helper flow and defers output execution', async () => {
    const context = new Context();
    const savedRulesContext = rules([]);
    context.rulesContext = savedRulesContext;
    const callableRules = rules([]);
    const parent = rules([]);
    const dynamicGuard = new Bool(true);
    dynamicGuard.hasFlag = () => false;
    dynamicGuard.eval = async (evalContext: Context) => {
      expect(evalContext.rulesContext).toBe(callableRules);
      return new Bool(evalContext.isDefault === true);
    };

    const result = await evaluateCallableGuard({
      context,
      hasDefault: true,
      guard: dynamicGuard,
      candidateGuard: dynamicGuard,
      copyGuardForEval: guard => guard,
      usesPreboundCallerGuardOuterRules: false,
      usesPreboundParamGuardOuterRules: false,
      rules: callableRules,
      parent,
      candidateIndex: 5,
      createOuterRules: createCallableOuterRules
    });

    expect(result.passes).toBe(true);
    expect(result.contributesDefNone).toBe(false);
    expect(result.defersCandidateOutput).toBe(true);
    expect(result.pendingDefaultGroup).toBe(CALLABLE_DEFAULT_TRUE);
    expect(result.defaultProbeResult).toEqual({
      passWhenDefaultFalse: false,
      passWhenDefaultTrue: true
    });
    expect(context.rulesContext).toBe(savedRulesContext);
  });

  it('evaluates non-default guards directly and marks defNone on success', async () => {
    const context = new Context();
    const callableRules = rules([]);
    const parent = rules([]);
    const dynamicGuard = new Bool(true);
    dynamicGuard.hasFlag = () => false;
    dynamicGuard.eval = async (evalContext: Context) => {
      expect(evalContext.rulesContext).toBe(callableRules);
      return new Bool(true);
    };

    const result = await evaluateCallableGuard({
      context,
      hasDefault: false,
      guard: dynamicGuard,
      candidateGuard: dynamicGuard,
      copyGuardForEval: guard => guard,
      usesPreboundCallerGuardOuterRules: false,
      usesPreboundParamGuardOuterRules: false,
      rules: callableRules,
      parent,
      candidateIndex: 6,
      createOuterRules: createCallableOuterRules
    });

    expect(result.passes).toBe(true);
    expect(result.contributesDefNone).toBe(true);
    expect(result.defersCandidateOutput).toBe(false);
    expect(result.pendingDefaultGroup).toBeUndefined();
  });
});
