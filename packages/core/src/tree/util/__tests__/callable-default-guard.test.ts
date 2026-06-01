import { describe, expect, it } from 'vitest';
import {
  CALLABLE_DEFAULT_FALSE,
  CALLABLE_DEFAULT_NONE,
  CALLABLE_DEFAULT_TRUE,
  resolveCallableDefaultCandidateGroups,
  resolveCallableDefaultGroup
} from '../callable-default-guard.js';

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
});
