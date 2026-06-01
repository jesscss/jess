import type { Context } from '../../context.js';
import { Bool } from '../bool.js';
import type { Node } from '../node.js';
import { F_STATIC } from '../node.js';

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
  defTrueCount: number;
  defFalseCount: number;
};

export type CallableDefaultGuardProbeResult = {
  passWhenDefaultFalse: boolean;
  passWhenDefaultTrue: boolean;
  passes: boolean;
  group: CallableDefaultGroup;
};

type CallableDefaultGroupCandidate = {
  group: CallableDefaultGroup;
};

type ProbeCallableDefaultGuardOptions = {
  context: Context;
  candidateGuard?: Node;
  copyGuardForEval: (guard: Node) => Node;
  beforeEval?: (guard: Node) => void;
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
    ambiguous: !hasDefNoneCandidate && (defTrueCount + defFalseCount) > 1,
    defTrueCount,
    defFalseCount
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

export async function probeCallableDefaultGuard({
  context,
  candidateGuard,
  copyGuardForEval,
  beforeEval
}: ProbeCallableDefaultGuardOptions): Promise<CallableDefaultGuardProbeResult> {
  let defaultProbeGuard: Node | undefined;
  const getDefaultProbeGuard = (): Node | undefined => {
    if (!candidateGuard) {
      return undefined;
    }
    if (candidateGuard.hasFlag(F_STATIC)) {
      return candidateGuard;
    }
    defaultProbeGuard ??= copyGuardForEval(candidateGuard);
    return defaultProbeGuard;
  };
  const evalWithDefault = async (isDefaultValue: boolean): Promise<boolean> => {
    const probeGuard = getDefaultProbeGuard();
    if (!probeGuard) {
      return false;
    }
    beforeEval?.(probeGuard);
    context.isDefault = isDefaultValue;
    const probeResult = await probeGuard.eval(context);
    return probeResult instanceof Bool && probeResult.value === true;
  };

  const originalIsDefault = context.isDefault;
  try {
    const passWhenDefaultFalse = await evalWithDefault(false);
    const passWhenDefaultTrue = await evalWithDefault(true);
    let passes = false;
    let group: CallableDefaultGroup = CALLABLE_DEFAULT_FALSE_EITHER;
    if (passWhenDefaultFalse || passWhenDefaultTrue) {
      passes = true;
      if (passWhenDefaultFalse && passWhenDefaultTrue) {
        group = CALLABLE_DEFAULT_NONE;
      } else {
        group = passWhenDefaultTrue ? CALLABLE_DEFAULT_TRUE : CALLABLE_DEFAULT_FALSE;
      }
    }
    return {
      passWhenDefaultFalse,
      passWhenDefaultTrue,
      passes,
      group
    };
  } finally {
    context.isDefault = originalIsDefault;
  }
}
