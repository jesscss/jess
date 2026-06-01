import type { Context } from '../../context.js';
import type { Node } from '../node.js';
import { F_STATIC } from '../node.js';
import type { List } from '../list.js';
import type { Rules } from '../rules.js';
import { evaluateCallableCandidateOutput } from './callable-candidate-output.js';
import type { CallableEntry } from './callable-entry.js';
import {
  recordCallableDefaultGuardResult,
  type CallableDefaultState
} from './callable-default-guard.js';
import {
  evaluateCallableGuard,
  prepareCallableGuardState
} from './callable-guard.js';
import { createCallableLiveSlots } from './callable-live-slots.js';
import { ensureCallableOuterRulesSurface } from './callable-outer-rules.js';
import { wireCallableScopeFrames } from './callable-scope-frame.js';
import type { PreparedCallableCandidateState } from './callable-candidate-state.js';
import type { CallSignature } from './recursion-helper.js';

type ExecuteCallableCandidateOptions = {
  context: Context;
  hasDefault: boolean;
  candidate: CallableEntry;
  candidateGuard?: Node;
  candidateParams?: List<Node>;
  candidateState: PreparedCallableCandidateState;
  nodeArgs: Node[];
  defaultState: CallableDefaultState;
  restrictMixinOutputLookup: boolean;
  copyGuardForEval: (guard: Node) => Node;
  createOuterRules: (rules: Rules, options?: Rules['options']) => Rules;
};

type ExecuteCallableCandidateResult = {
  output?: Rules;
  debugDefaultProbeResult?: {
    passWhenDefaultFalse: boolean;
    passWhenDefaultTrue: boolean;
  };
};

export async function executeCallableCandidate({
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
}: ExecuteCallableCandidateOptions): Promise<ExecuteCallableCandidateResult> {
  const {
    sourceRules,
    rules,
    paramBindings,
    signatureKey,
    parentFrame,
    lexicalScopeFrame,
    fallbackScopeFrame
  } = candidateState;

  let outerRules: Rules | undefined;
  const getParamsSignature = (): CallSignature => signatureKey;
  let usesPreboundParamGuardOuterRules = false;

  if (candidateParams || paramBindings.length > 0) {
    const needsOuterRules = Boolean(candidateGuard && !candidateGuard.hasFlag(F_STATIC));
    if (needsOuterRules) {
      outerRules = ensureCallableOuterRulesSurface({
        currentOuterRules: outerRules,
        rules,
        parent: candidate.parent!,
        candidateIndex: candidate.index,
        createOuterRules,
        options: {
          rulesVisibility: {
            Ruleset: 'public',
            Declaration: 'public',
            VarDeclaration: 'public',
            Mixin: 'public'
          }
        },
        syncScopeFrame: false
      });
      usesPreboundParamGuardOuterRules = true;
    }
    const liveSlots = createCallableLiveSlots({
      paramBindings,
      nodeArgs,
      defineArguments: Boolean(context.treeContext?.file)
    });
    wireCallableScopeFrames({
      rules,
      outerRules,
      lexicalScopeFrame,
      fallbackScopeFrame,
      parentFrame,
      liveSlots,
      usesPreboundParamGuardOuterRules
    });
  } else if (context.leakyRules === true && parentFrame) {
    wireCallableScopeFrames({
      rules,
      parentFrame,
      leakyRules: true
    });
  }

  let {
    guard,
    outerRules: preparedGuardOuterRules,
    usesPreboundCallerGuardOuterRules
  } = prepareCallableGuardState({
    hasDefault,
    candidateGuard,
    copyGuardForEval,
    candidateParams,
    paramBindingsLength: paramBindings.length,
    outerRules,
    rules,
    parent: candidate.parent!,
    rulesContextParent: context.rulesContext,
    candidateIndex: candidate.index,
    parentFrame,
    createOuterRules
  });
  outerRules = preparedGuardOuterRules;

  const guardResult = await evaluateCallableGuard({
    context,
    hasDefault,
    guard,
    candidateGuard,
    copyGuardForEval,
    usesPreboundCallerGuardOuterRules,
    usesPreboundParamGuardOuterRules,
    outerRules,
    rules,
    parent: candidate.parent!,
    candidateIndex: candidate.index,
    createOuterRules
  });

  if (!guardResult.passes) {
    return {
      debugDefaultProbeResult: guardResult.defaultProbeResult
    };
  }

  recordCallableDefaultGuardResult({
    state: defaultState,
    guardResult,
    rules,
    sourceRules,
    candidateParent: candidate.parent,
    candidateIndex: candidate.index,
    params: getParamsSignature()
  });
  if (guardResult.defersCandidateOutput) {
    return {
      debugDefaultProbeResult: guardResult.defaultProbeResult
    };
  }

  const output = await evaluateCallableCandidateOutput({
    context,
    currentCall: context.callStack.at(-1),
    getParamsSignature,
    candidateParent: candidate.parent!,
    candidateIndex: candidate.index,
    rules,
    sourceRules,
    restrictMixinOutputLookup
  });

  return {
    output,
    debugDefaultProbeResult: guardResult.defaultProbeResult
  };
}
