import { isThenable } from '@jesscss/awaitable-pipe';
import type { Context } from '../../context.js';
import type { Node } from '../node.js';
import { N } from '../node-type.js';
import { Nil } from '../nil.js';
import type { List } from '../list.js';
import type { MixinEntry, Rules } from '../rules.js';
import { isNode } from './is-node.js';
import { attachMixinOutputSlot } from './mixin-output-slot.js';

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
  createOwnedRules: (sourceRules: Rules) => Rules;
  createUnlockedRules: (sourceRules: Rules) => Rules;
  evaluateOwnedRules: (rules: Rules) => Promise<Rules>;
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
  createOwnedRules,
  createUnlockedRules,
  evaluateOwnedRules,
  getRootSourceRules
}: EvaluateCallableSpecialCaseCandidateOptions): Promise<CallableSpecialCaseResult> {
  if (isNode(candidate, N.Ruleset)) {
    const rulesetGuard = candidate.value.guard;
    if (rulesetGuard instanceof Nil) {
      return { handled: true };
    }

    const sourceRules = getRootSourceRules(candidate.value.rules);
    let rules = createOwnedRules(sourceRules);
    const callParent = (caller?.parent as Node | undefined) ?? candidate.parent!;
    callParent.adopt(rules);
    rules = await evaluateOwnedRules(rules);
    callParent.adopt(rules);
    rules.index = candidate.index;
    attachMixinOutputSlot(rules, sourceRules, restrictMixinOutputLookup, {
      rulesetPlacement: true
    });
    return { handled: true, output: rules };
  }

  if (!isNode(candidate, N.Mixin) && !candidateName && !candidateParams && !candidateGuard) {
    const sourceRules = getRootSourceRules(candidate.value.rules);
    let unlocked = createUnlockedRules(sourceRules);
    const parentFrame = isNode(callSiteRules, N.Rules)
      ? callSiteRules.getScopeFrame()
      : undefined;

    candidate.parent!.adopt(unlocked);
    attachMixinOutputSlot(unlocked, sourceRules, restrictMixinOutputLookup, {
      fallbackFrame: context.leakyRules === true ? parentFrame : undefined
    });
    Reflect.set(unlocked, 'index', candidate.index);
    const evaledUnlocked = unlocked.eval(context);
    unlocked = (isThenable(evaledUnlocked) ? await evaledUnlocked : evaledUnlocked) as Rules;
    return { handled: true, output: unlocked };
  }

  return { handled: false };
}
