import type { Context } from '../../context.js';
import type { Node } from '../node.js';
import type { CallableParamMatch } from './callable-param-match.js';
import { prepareCallableCandidateState } from './callable-candidate-state.js';
import { executeCallableCandidate } from './callable-candidate-execution.js';
import {
  type CallableEntry,
  type MixinEntry,
  getCallableEntryGuard,
  getCallableEntryName,
  getCallableEntryParams,
  getMixinEntryRules,
  isCallableEntry
} from './callable-entry.js';
import type { Rules } from '../rules.js';
import type { CallableDefaultState } from './callable-default-guard.js';
import {
  pushCallableOutputRule,
  recordCallableOutputSourceRules,
  type CallableOutputState
} from './callable-output.js';
import { evaluateCallableSpecialCaseCandidate } from './callable-special-case.js';

type ExecuteCallableCandidateLoopOptions = {
  context: Context;
  caller?: Node;
  evalCandidates: readonly MixinEntry[];
  hasDefault: boolean;
  nodeArgs: Node[];
  resolvedParamBindings: WeakMap<CallableEntry, CallableParamMatch>;
  outputState: CallableOutputState;
  defaultState: CallableDefaultState;
  restrictMixinOutputLookup: boolean;
  debugDefaultGuard: boolean;
  debugCaller: () => string;
  specialCaseCallSiteRules?: Node;
  ordinaryCallSiteRules: Rules;
  createOwnedRules: (sourceRules: Rules) => Rules;
  createUnlockedRules: (sourceRules: Rules) => Rules;
  getRootSourceRules: (rules: Rules) => Rules;
  createOuterRules: (rules: Rules, options?: Rules['options']) => Rules;
};

export async function executeCallableCandidateLoop({
  context,
  caller,
  evalCandidates,
  hasDefault,
  nodeArgs,
  resolvedParamBindings,
  outputState,
  defaultState,
  restrictMixinOutputLookup,
  debugDefaultGuard,
  debugCaller,
  specialCaseCallSiteRules,
  ordinaryCallSiteRules,
  createOwnedRules,
  createUnlockedRules,
  getRootSourceRules,
  createOuterRules
}: ExecuteCallableCandidateLoopOptions): Promise<void> {
  for (const candidate of evalCandidates) {
    const candidateName = isCallableEntry(candidate)
      ? getCallableEntryName(candidate)
      : undefined;
    const candidateParams = isCallableEntry(candidate)
      ? getCallableEntryParams(candidate)
      : undefined;
    const candidateGuard = isCallableEntry(candidate)
      ? getCallableEntryGuard(candidate)
      : undefined;

    const specialCaseResult = await evaluateCallableSpecialCaseCandidate({
      candidate,
      context,
      caller,
      callSiteRules: specialCaseCallSiteRules,
      restrictMixinOutputLookup,
      candidateName,
      candidateParams,
      candidateGuard,
      createOwnedRules,
      createUnlockedRules,
      getRootSourceRules
    });
    if (specialCaseResult.handled) {
      if (specialCaseResult.output) {
        const sourceRules = getRootSourceRules(getMixinEntryRules(candidate));
        recordCallableOutputSourceRules(outputState, sourceRules);
        pushCallableOutputRule(outputState, specialCaseResult.output);
      }
      continue;
    }

    if (!isCallableEntry(candidate)) {
      throw new TypeError('Callable candidate setup expects a callable entry');
    }

    const candidateState = prepareCallableCandidateState({
      candidate,
      callSiteRules: ordinaryCallSiteRules,
      leakyRules: context.leakyRules === true,
      resolvedBindingInfo: resolvedParamBindings.get(candidate),
      createOwnedRules,
      createUnlockedRules,
      getRootSourceRules
    });
    const { sourceRules } = candidateState;
    recordCallableOutputSourceRules(outputState, sourceRules);

    const execution = await executeCallableCandidate({
      context,
      hasDefault,
      candidate,
      candidateGuard,
      candidateParams,
      candidateState,
      nodeArgs,
      defaultState,
      restrictMixinOutputLookup,
      createOuterRules
    });
    if (debugDefaultGuard && execution.debugDefaultProbeResult) {
      const debugParams: unknown[] = [];
      const paramValues = candidateParams?.value;
      if (paramValues) {
        for (let i = 0; i < paramValues.length; i++) {
          const param = paramValues[i];
          debugParams.push(param?.valueOf() ?? String(param));
        }
      }
      console.log('[default-guard:candidate]', JSON.stringify({
        caller: debugCaller(),
        candidate: candidateName?.valueOf?.() ?? '<anon>',
        guard: candidateGuard?.valueOf?.() ?? candidateGuard?.toString?.() ?? '',
        params: debugParams,
        passWhenDefaultFalse: execution.debugDefaultProbeResult.passWhenDefaultFalse,
        passWhenDefaultTrue: execution.debugDefaultProbeResult.passWhenDefaultTrue
      }));
    }
    if (execution.output) {
      pushCallableOutputRule(outputState, execution.output);
    }
  }
}
