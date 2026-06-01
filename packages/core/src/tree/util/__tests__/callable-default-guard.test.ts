import { describe, expect, it } from 'vitest';
import {
  CALLABLE_DEFAULT_FALSE,
  CALLABLE_DEFAULT_NONE,
  CALLABLE_DEFAULT_TRUE,
  probeCallableDefaultGuard,
  resolveCallableDefaultCandidateGroups,
  resolveCallableDefaultGroup
} from '../callable-default-guard.js';
import { Context } from '../../../context.js';
import { Bool } from '../../bool.js';

describe('callable default guard helpers', () => {
  it('resolves Less default() grouping without rules closure state', () => {
    expect(resolveCallableDefaultGroup(false, [
      CALLABLE_DEFAULT_TRUE
    ])).toEqual({
      hasDefNoneCandidate: false,
      defaultResult: CALLABLE_DEFAULT_TRUE,
      ambiguous: false,
      defTrueCount: 1,
      defFalseCount: 0
    });
    expect(resolveCallableDefaultGroup(true, [
      CALLABLE_DEFAULT_TRUE,
      CALLABLE_DEFAULT_FALSE
    ])).toEqual({
      hasDefNoneCandidate: true,
      defaultResult: CALLABLE_DEFAULT_FALSE,
      ambiguous: false,
      defTrueCount: 1,
      defFalseCount: 1
    });
    expect(resolveCallableDefaultGroup(false, [
      CALLABLE_DEFAULT_TRUE,
      CALLABLE_DEFAULT_FALSE
    ])).toEqual({
      hasDefNoneCandidate: false,
      defaultResult: CALLABLE_DEFAULT_TRUE,
      ambiguous: true,
      defTrueCount: 1,
      defFalseCount: 1
    });
    expect(resolveCallableDefaultGroup(false, [
      CALLABLE_DEFAULT_NONE
    ])).toEqual({
      hasDefNoneCandidate: true,
      defaultResult: CALLABLE_DEFAULT_FALSE,
      ambiguous: false,
      defTrueCount: 0,
      defFalseCount: 0
    });
    expect(resolveCallableDefaultCandidateGroups(false, [
      { group: CALLABLE_DEFAULT_TRUE },
      { group: CALLABLE_DEFAULT_FALSE }
    ])).toEqual({
      hasDefNoneCandidate: false,
      defaultResult: CALLABLE_DEFAULT_TRUE,
      ambiguous: true,
      defTrueCount: 1,
      defFalseCount: 1
    });
  });

  it('probes default guards twice while caching one copied dynamic guard and restoring context state', async () => {
    const context = new Context();
    context.isDefault = true;

    const seenDefaults: boolean[] = [];
    let copyCount = 0;
    const dynamicGuard = new Bool(false);
    dynamicGuard.hasFlag = () => false;
    dynamicGuard.eval = async (evalContext: Context) => {
      seenDefaults.push(Boolean(evalContext.isDefault));
      return new Bool(evalContext.isDefault === true);
    };

    const result = await probeCallableDefaultGuard({
      context,
      candidateGuard: dynamicGuard,
      copyGuardForEval: (guard) => {
        copyCount++;
        return guard;
      }
    });

    expect(result).toEqual({
      passWhenDefaultFalse: false,
      passWhenDefaultTrue: true,
      passes: true,
      group: CALLABLE_DEFAULT_TRUE
    });
    expect(copyCount).toBe(1);
    expect(seenDefaults).toEqual([false, true]);
    expect(context.isDefault).toBe(true);
  });
});
