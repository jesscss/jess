import type { Context } from '../../context.js';
import type { Node } from '../node.js';
import type { List } from '../list.js';
import type { CallableEntry, MixinEntry, Rules } from '../rules.js';
import type { CallableParamMatch } from './callable-param-match.js';
import { prepareCallableCandidateState } from './callable-candidate-state.js';
import { executeCallableCandidate } from './callable-candidate-execution.js';
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
  copyGuardForEval: (guard: Node) => Node;
  createOwnedRules: (sourceRules: Rules) => Rules;
  createUnlockedRules: (sourceRules: Rules) => Rules;
  evaluateOwnedRules: (rules: Rules) => Promise<Rules>;
  getRootSourceRules: (rules: Rules) => Rules;
  createOuterRules: (rules: Rules, options?: Rules['options']) => Rules;
  isCallableEntry: (entry: MixinEntry) => entry is CallableEntry;
  getMixinEntryRules: (entry: MixinEntry) => Rules;
  getCallableEntryName: (entry: CallableEntry) => unknown;
  getCallableEntryParams: (entry: CallableEntry) => List<Node> | undefined;
  getCallableEntryGuard: (entry: CallableEntry) => Node | undefined;
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
  copyGuardForEval,
  createOwnedRules,
  createUnlockedRules,
  evaluateOwnedRules,
  getRootSourceRules,
  createOuterRules,
  isCallableEntry,
  getMixinEntryRules,
  getCallableEntryName,
  getCallableEntryParams,
  getCallableEntryGuard
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
      evaluateOwnedRules,
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
      copyGuardForEval,
      createOuterRules
    });
    if (debugDefaultGuard && execution.debugDefaultProbeResult) {
      console.log('[default-guard:candidate]', JSON.stringify({
        caller: debugCaller(),
        candidate: candidateName?.valueOf?.() ?? '<anon>',
        guard: candidateGuard?.valueOf?.() ?? candidateGuard?.toString?.() ?? '',
        params: candidateParams?.value?.map((param: any) => param?.valueOf?.() ?? String(param)) ?? [],
        passWhenDefaultFalse: execution.debugDefaultProbeResult.passWhenDefaultFalse,
        passWhenDefaultTrue: execution.debugDefaultProbeResult.passWhenDefaultTrue
      }));
    }
    if (execution.output) {
      pushCallableOutputRule(outputState, execution.output);
    }
  }
}
