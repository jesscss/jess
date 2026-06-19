import type { Context } from '../../context.js';
import type { Node } from '../node.js';
import { F_STATIC } from '../node.js';
import type { List } from '../list.js';
import type { Rules } from '../rules.js';
import { Bool } from '../bool.js';
import { Condition } from '../condition.js';
import { evaluateCallableCandidateOutput } from './callable-candidate-output.js';
import { getCallableEntryNamespaceGuards, type CallableEntry } from './callable-entry.js';
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
import { withRulesContext } from './context.js';

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
  createOuterRules: (rules: Rules, options?: Rules['options']) => Rules;
};

type ExecuteCallableCandidateResult = {
  output?: Rules;
  debugDefaultProbeResult?: {
    passWhenDefaultFalse: boolean;
    passWhenDefaultTrue: boolean;
  };
};

async function evaluateNamespaceGuards(context: Context, candidate: CallableEntry): Promise<boolean> {
  const namespaceGuards = getCallableEntryNamespaceGuards(candidate);
  if (!namespaceGuards?.length) {
    return true;
  }
  for (let i = 0; i < namespaceGuards.length; i++) {
    const { guard, rules } = namespaceGuards[i]!;
    rules.getScopeFrame();
    const passes = await withRulesContext(context, rules, async () => {
      context.isDefault = false;
      if (guard instanceof Condition) {
        return await guard.evaluateBoolean(context);
      }
      const resolvedGuard = await guard.eval(context);
      return resolvedGuard instanceof Bool && resolvedGuard.value === true;
    });
    if (!passes) {
      return false;
    }
  }
  return true;
}

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
  createOuterRules
}: ExecuteCallableCandidateOptions): Promise<ExecuteCallableCandidateResult> {
  const {
    sourceRules,
    rules,
    candidateParent,
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
        parent: candidateParent,
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
      defineArguments: Boolean(context.treeContext?.file),
      rulesContext: rules
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
  } else if (lexicalScopeFrame) {
    wireCallableScopeFrames({
      rules,
      lexicalScopeFrame,
      fallbackScopeFrame
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
    candidateParams,
    paramBindingsLength: paramBindings.length,
    outerRules,
    rules,
    parent: candidateParent,
    rulesContextParent: context.rulesContext,
    candidateIndex: candidate.index,
    parentFrame,
    createOuterRules
  });
  outerRules = preparedGuardOuterRules;

  if (!await evaluateNamespaceGuards(context, candidate)) {
    return {};
  }

  const guardResult = await evaluateCallableGuard({
    context,
    hasDefault,
    guard,
    candidateGuard,
    usesPreboundCallerGuardOuterRules,
    usesPreboundParamGuardOuterRules,
    outerRules,
    rules,
    parent: candidateParent,
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
    candidateParent,
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
    candidateParent,
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
