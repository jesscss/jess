import type { Context } from '../../context.js';
import type { Node } from '../node.js';
import type { Rules } from '../rules.js';
import { evaluateCallableArgs } from './callable-args.js';
import { resolveCallableCandidateMatches } from './callable-candidate-match.js';
import { executeCallableCandidateLoop } from './callable-candidate-loop.js';
import { createCallableDefaultState } from './callable-default-guard.js';
import { createCallableOutputState, finalizeCallableEvalOutput } from './callable-output.js';
import {
  createCallableOuterRules,
  createEmptyCallableOutputSurface,
  createMixinOutputRulesWrapper,
  createOwnedCallableRulesSurface,
  createUnlockedCallableRulesSurface,
  getRootSourceRules,
  isIndexedRuleChild,
  resolveCallableSingleOutputSourceRules
} from './callable-surface.js';
import type { MixinEntry } from './callable-entry.js';

type EvaluateCallableCollectionOptions = {
  context: Context;
  mixinEntries: readonly MixinEntry[];
  args: readonly Node[];
};

export async function evaluateCallableCollection({
  context,
  mixinEntries,
  args
}: EvaluateCallableCollectionOptions): Promise<Rules> {
  const caller = context.caller;
  const argEvalRulesContext = caller?.rulesParent ?? caller?.sourceRulesParent ?? context.rulesContext;
  const nodeArgs = await evaluateCallableArgs({
    context,
    rulesContext: argEvalRulesContext,
    args
  });
  const outputState = createCallableOutputState();
  const preparedCandidates = resolveCallableCandidateMatches({
    mixinEntries,
    nodeArgs,
    hasFileContext: Boolean(context.treeContext?.file),
    rulesEvalStack: context.rulesEvalStack,
    caller
  });
  const debugDefaultGuard = process.env.DEBUG_DEFAULT_GUARD === '1';
  const restrictMixinOutputLookup = context.leakyRules !== true;
  const defaultState = createCallableDefaultState();
  const ordinaryCallSiteRules = context.rulesContext ?? caller?.rulesParent ?? caller?.sourceRulesParent;
  if (!ordinaryCallSiteRules) {
    throw new TypeError('Callable evaluation requires a rules context');
  }

  await executeCallableCandidateLoop({
    context,
    caller,
    evalCandidates: preparedCandidates.evalCandidates,
    hasDefault: preparedCandidates.hasDefault,
    nodeArgs,
    resolvedParamBindings: preparedCandidates.resolvedParamBindings,
    outputState,
    defaultState,
    restrictMixinOutputLookup,
    debugDefaultGuard,
    debugCaller: () => {
      const callerName = caller?.value?.name;
      const raw = callerName?.valueOf?.() ?? callerName ?? caller?.type ?? '<unknown>';
      return String(raw);
    },
    specialCaseCallSiteRules: caller?.rulesParent ?? caller?.sourceRulesParent ?? context.rulesContext,
    ordinaryCallSiteRules,
    createOwnedRules: createOwnedCallableRulesSurface,
    createUnlockedRules: createUnlockedCallableRulesSurface,
    getRootSourceRules,
    createOuterRules: createCallableOuterRules
  });

  const output = await finalizeCallableEvalOutput({
    context,
    state: outputState,
    defaultState,
    restrictMixinOutputLookup,
    debugDefaultGuard,
    debugCaller: (() => {
      const callerName = caller?.value?.name;
      const raw = callerName?.valueOf?.() ?? callerName ?? caller?.type ?? '<unknown>';
      return String(raw);
    })(),
    createEmptyOutput: createEmptyCallableOutputSurface,
    createWrapperOutput: createMixinOutputRulesWrapper,
    resolveSingleOutputSourceRules: resolveCallableSingleOutputSourceRules,
    isIndexedRuleChild
  });

  output.index ??= context.ruleCounter++;
  return output;
}
