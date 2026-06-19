import type { Context } from '../../context.js';
import type { Node } from '../node.js';
import type { Rules } from '../rules.js';
import type { CallSignature } from './recursion-helper.js';
import { attachMixinOutputSlot } from './mixin-output-slot.js';

type EvaluateCallableCandidateOutputOptions = {
  context: Context;
  currentCall?: Context['callStack'][number];
  getParamsSignature: () => CallSignature;
  candidateParent: Node;
  candidateIndex?: number;
  rules: Rules;
  sourceRules: Rules;
  restrictMixinOutputLookup: boolean;
};

export async function evaluateCallableCandidateOutput({
  context,
  currentCall,
  getParamsSignature,
  candidateParent,
  candidateIndex,
  rules,
  sourceRules,
  restrictMixinOutputLookup
}: EvaluateCallableCandidateOutputOptions): Promise<Rules | undefined> {
  if (currentCall && context.callMap.add(currentCall, getParamsSignature())) {
    return undefined;
  }

  const callableFrame = rules._scopeFrame;
  try {
    const newRules = await rules.eval(context);
    if (
      callableFrame?.hasLiveBindings
      && (
        !newRules._scopeFrame
        || !newRules._scopeFrame.hasLiveBindings
      )
    ) {
      newRules.scopeFrame = callableFrame;
    }
    newRules.index = candidateIndex;
    attachMixinOutputSlot(newRules, sourceRules, restrictMixinOutputLookup);
    return newRules;
  } catch (error) {
    if (error instanceof ReferenceError && error.message.includes('Recursive mixin call')) {
      return undefined;
    }
    throw error;
  } finally {
    if (currentCall) {
      context.callMap.delete(currentCall);
    }
  }
}
