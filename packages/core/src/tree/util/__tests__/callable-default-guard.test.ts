import { describe, expect, it } from 'vitest';
import {
  CALLABLE_DEFAULT_FALSE,
  CALLABLE_DEFAULT_NONE,
  CALLABLE_DEFAULT_TRUE,
  createCallableDefaultState,
  executeCallableDefaultCandidates,
  flushCallableDefaultOutputs,
  probeCallableDefaultGuard,
  recordCallableDefaultGuardResult,
  resolveCallableDefaultCandidateGroups,
  resolveCallableDefaultGroup
} from '../callable-default-guard.js';
import { Context } from '../../../context.js';
import { Bool } from '../../bool.js';
import { condition, rules } from '../../index.js';

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

  it('probes default guards twice against the source guard and restores context state', async () => {
    const context = new Context();
    context.isDefault = true;

    const seenDefaults: boolean[] = [];
    const dynamicGuard = new Bool(false);
    dynamicGuard.hasFlag = () => false;
    dynamicGuard.eval = async (evalContext: Context) => {
      seenDefaults.push(Boolean(evalContext.isDefault));
      return new Bool(evalContext.isDefault === true);
    };

    const result = await probeCallableDefaultGuard({
      context,
      candidateGuard: dynamicGuard
    });

    expect(result).toEqual({
      passWhenDefaultFalse: false,
      passWhenDefaultTrue: true,
      passes: true,
      group: CALLABLE_DEFAULT_TRUE
    });
    expect(seenDefaults).toEqual([false, true]);
    expect(context.isDefault).toBe(true);
  });

  it('probes condition guards as booleans without calling the public Bool-result eval wrapper', async () => {
    const context = new Context();
    const guard = condition([new Bool(true)]);
    guard.eval = () => {
      throw new Error('should not allocate a public Bool default-probe result');
    };

    const result = await probeCallableDefaultGuard({
      context,
      candidateGuard: guard
    });

    expect(result).toEqual({
      passWhenDefaultFalse: true,
      passWhenDefaultTrue: true,
      passes: true,
      group: CALLABLE_DEFAULT_NONE
    });
  });

  it('executes only the resolved default groups in original order', async () => {
    const context = new Context();
    const calls: string[] = [];

    await executeCallableDefaultCandidates({
      context,
      hasDefNoneCandidate: false,
      restrictMixinOutputLookup: true,
      candidates: [
        {
          label: 'none',
          group: CALLABLE_DEFAULT_NONE,
          rules: rules([]),
          sourceRules: rules([])
        },
        {
          label: 'true',
          group: CALLABLE_DEFAULT_TRUE,
          rules: rules([]),
          sourceRules: rules([])
        },
        {
          label: 'false',
          group: CALLABLE_DEFAULT_FALSE,
          rules: rules([]),
          sourceRules: rules([])
        }
      ],
      runCandidate: async (candidate) => {
        calls.push(candidate.label);
      }
    });

    expect(calls).toEqual(['none', 'false']);
  });

  it('throws on ambiguous default resolution before running candidates', async () => {
    const context = new Context();

    await expect(executeCallableDefaultCandidates({
      context,
      hasDefNoneCandidate: false,
      restrictMixinOutputLookup: true,
      candidates: [
        {
          label: 'true',
          group: CALLABLE_DEFAULT_TRUE,
          rules: rules([]),
          sourceRules: rules([])
        },
        {
          label: 'false',
          group: CALLABLE_DEFAULT_FALSE,
          rules: rules([]),
          sourceRules: rules([])
        }
      ],
      runCandidate: async () => {}
    })).rejects.toThrow('Ambiguous use of default() while matching mixins.');
  });

  it('records defNone contributions and pending default candidates in one state object', () => {
    const state = createCallableDefaultState();
    const ruleSurface = rules([]);
    const sourceSurface = rules([]);

    recordCallableDefaultGuardResult({
      state,
      guardResult: {
        contributesDefNone: true
      },
      rules: ruleSurface,
      sourceRules: sourceSurface
    });
    recordCallableDefaultGuardResult({
      state,
      guardResult: {
        contributesDefNone: false,
        pendingDefaultGroup: CALLABLE_DEFAULT_TRUE
      },
      rules: ruleSurface,
      sourceRules: sourceSurface
    });

    expect(state.hasDefNoneCandidate).toBe(true);
    expect(state.pendingCandidates).toHaveLength(1);
    expect(state.pendingCandidates[0]?.group).toBe(CALLABLE_DEFAULT_TRUE);
  });

  it('flushes pending default candidates through the shared execution helper', async () => {
    const context = new Context();
    const state = createCallableDefaultState();
    const calls: string[] = [];
    state.pendingCandidates.push({
      label: 'true',
      group: CALLABLE_DEFAULT_TRUE,
      rules: rules([]),
      sourceRules: rules([])
    });

    const execution = await flushCallableDefaultOutputs({
      context,
      state,
      restrictMixinOutputLookup: true,
      runCandidate: async (candidate) => {
        calls.push(candidate.label);
      }
    });

    expect(execution?.resolution.defaultResult).toBe(CALLABLE_DEFAULT_TRUE);
    expect(state.hasDefNoneCandidate).toBe(false);
    expect(calls).toEqual(['true']);
  });
});
