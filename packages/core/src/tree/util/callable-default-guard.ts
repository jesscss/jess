export const CALLABLE_DEFAULT_FALSE_EITHER = -1;
export const CALLABLE_DEFAULT_NONE = 0;
export const CALLABLE_DEFAULT_TRUE = 1;
export const CALLABLE_DEFAULT_FALSE = 2;

export type CallableDefaultGroup =
  | typeof CALLABLE_DEFAULT_FALSE_EITHER
  | typeof CALLABLE_DEFAULT_NONE
  | typeof CALLABLE_DEFAULT_TRUE
  | typeof CALLABLE_DEFAULT_FALSE;

export type CallableDefaultGroupResolution = {
  hasDefNoneCandidate: boolean;
  defaultResult: typeof CALLABLE_DEFAULT_TRUE | typeof CALLABLE_DEFAULT_FALSE;
  ambiguous: boolean;
};

type CallableDefaultGroupCandidate = {
  group: CallableDefaultGroup;
};

function finalizeCallableDefaultGroupResolution(
  hasDefNoneCandidate: boolean,
  defTrueCount: number,
  defFalseCount: number
): CallableDefaultGroupResolution {
  const defaultResult = hasDefNoneCandidate
    ? CALLABLE_DEFAULT_FALSE
    : CALLABLE_DEFAULT_TRUE;
  return {
    hasDefNoneCandidate,
    defaultResult,
    ambiguous: !hasDefNoneCandidate && (defTrueCount + defFalseCount) > 1
  };
}

export function resolveCallableDefaultGroup(
  hasDefNoneCandidate: boolean,
  groups: readonly CallableDefaultGroup[]
): CallableDefaultGroupResolution {
  let nextHasDefNoneCandidate = hasDefNoneCandidate;
  let defTrueCount = 0;
  let defFalseCount = 0;
  for (const group of groups) {
    if (group === CALLABLE_DEFAULT_TRUE) {
      defTrueCount++;
    } else if (group === CALLABLE_DEFAULT_FALSE) {
      defFalseCount++;
    } else if (group === CALLABLE_DEFAULT_NONE) {
      nextHasDefNoneCandidate = true;
    }
  }
  return finalizeCallableDefaultGroupResolution(nextHasDefNoneCandidate, defTrueCount, defFalseCount);
}

export function resolveCallableDefaultCandidateGroups(
  hasDefNoneCandidate: boolean,
  candidates: readonly CallableDefaultGroupCandidate[]
): CallableDefaultGroupResolution {
  let nextHasDefNoneCandidate = hasDefNoneCandidate;
  let defTrueCount = 0;
  let defFalseCount = 0;
  for (const candidate of candidates) {
    if (candidate.group === CALLABLE_DEFAULT_TRUE) {
      defTrueCount++;
    } else if (candidate.group === CALLABLE_DEFAULT_FALSE) {
      defFalseCount++;
    } else if (candidate.group === CALLABLE_DEFAULT_NONE) {
      nextHasDefNoneCandidate = true;
    }
  }
  return finalizeCallableDefaultGroupResolution(nextHasDefNoneCandidate, defTrueCount, defFalseCount);
}
