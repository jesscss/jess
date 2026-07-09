import { isThenable } from '@jesscss/awaitable-pipe';
import type { Context } from '../../context.js';
import { type Node } from '../node.js';
import { N } from '../node-type.js';
import { Nil } from '../nil.js';
import type { List } from '../list.js';
import { Rules } from '../rules.js';
import { getMixinEntryRules, type MixinEntry } from './callable-entry.js';
import { isNode } from './is-node.js';
import { attachMixinOutputSlot } from './mixin-output-slot.js';
import { withRulesContext } from './context.js';

export type CallableSpecialCaseResult = {
  handled: boolean;
  output?: Rules;
};

type EvaluateCallableSpecialCaseCandidateOptions = {
  candidate: MixinEntry;
  context: Context;
  caller?: Node;
  callSiteRules?: Node;
  restrictMixinOutputLookup: boolean;
  candidateName?: unknown;
  candidateParams?: List<Node>;
  candidateGuard?: Node | Nil;
  createCallableRules: (sourceRules: Rules) => Rules;
  getRootSourceRules: (rules: Rules) => Rules;
};

export async function evaluateCallableSpecialCaseCandidate({
  candidate,
  context,
  caller,
  callSiteRules,
  restrictMixinOutputLookup,
  candidateName,
  candidateParams,
  candidateGuard,
  createCallableRules,
  getRootSourceRules
}: EvaluateCallableSpecialCaseCandidateOptions): Promise<CallableSpecialCaseResult> {
  if (isNode(candidate, N.Ruleset)) {
    const rulesetGuard = candidate.guard;
    if (rulesetGuard instanceof Nil) {
      return { handled: true };
    }

    // The Ruleset IS its own canonical body now (the `_passedRulesWrapper`
    // duplicate frame was eliminated); its children parent to the Ruleset, so
    // the candidate itself is the source rules for the callable surface.
    const sourceRules = getRootSourceRules(candidate);
    let rules = createCallableRules(sourceRules);
    // A detached ruleset called from a variable has no tree parent (neither the
    // caller nor the candidate is parented); the call-site Rules is its natural
    // placement parent — same fallback the non-Ruleset branch below uses.
    const callParent = (caller?.parent as Node | undefined) ?? candidate.parent ?? callSiteRules;
    if (!callParent) {
      throw new TypeError('Callable special-case setup requires a caller, candidate, or call-site parent');
    }
    let needsCallerPlacementDuringEval = false;
    for (let i = 0; i < sourceRules.rules.length; i++) {
      if (isNode(sourceRules.rules[i], N.Ruleset | N.AtRule)) {
        needsCallerPlacementDuringEval = true;
        break;
      }
    }
    if (needsCallerPlacementDuringEval) {
      callParent.adopt(rules);
    }
    rules = await withRulesContext(context, rules, () => rules.eval(context));
    callParent.adopt(rules);
    rules.index = candidate.index;
    attachMixinOutputSlot(rules, sourceRules, restrictMixinOutputLookup, {
      rulesetPlacement: true
    });
    return { handled: true, output: rules };
  }

  if (!isNode(candidate, N.Mixin) && !candidateName && !candidateParams && !candidateGuard) {
    const sourceRules = getRootSourceRules(getMixinEntryRules(candidate));
    let unlocked = createCallableRules(sourceRules);
    const parentFrame = isNode(callSiteRules, N.Rules)
      ? callSiteRules.getScopeFrame()
      : undefined;
    const candidateParent = candidate.parent ?? callSiteRules;
    if (!candidateParent) {
      throw new TypeError('Callable special-case setup requires a parent or call-site rules');
    }

    candidateParent.adopt(unlocked);
    attachMixinOutputSlot(unlocked, sourceRules, restrictMixinOutputLookup, {
      fallbackFrame: context.options.leakyScope === true ? parentFrame : undefined
    });
    unlocked.index = candidate.index;
    const evaledUnlocked = unlocked.eval(context);
    unlocked = (isThenable(evaledUnlocked) ? await evaledUnlocked : evaledUnlocked) as Rules;
    return { handled: true, output: unlocked };
  }

  return { handled: false };
}
