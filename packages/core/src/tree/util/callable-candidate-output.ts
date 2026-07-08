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

  try {
    // Spine mixin-fold (cutover, UNIFIED-EVAL-EMIT-DESIGN §2/§3): when the
    // emit-walk driver installed a surface sink, hand it the guard-passed BOUND
    // surface (`rules` — shared body + wired live-cell param frame) to descend
    // INLINE instead of building an output tree. Inside the recursion-guard
    // bracket so a recursive body still trips `callMap`. The sink returns `true`
    // when it consumed the surface (return `undefined` → no output-tree
    // contribution); `false` means the shape is not spine-simple → fall through
    // to the eval terminal for this candidate (byte-identical transition; the
    // eval terminal dies in P4).
    candidateParent.adopt(rules);
    const sink = context.spineMixinSurfaceSink;
    if (sink && sink(rules, sourceRules)) {
      return undefined;
    }
    const newRules = await rules.eval(context);
    candidateParent.adopt(newRules);
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
