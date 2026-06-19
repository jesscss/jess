import { isThenable } from '@jesscss/awaitable-pipe';
import type { Context } from '../../context.js';
import { F_MAY_ASYNC, type Node } from '../node.js';
import { N } from '../node-type.js';
import { Nil } from '../nil.js';
import { Bool } from '../bool.js';
import { Condition } from '../condition.js';
import type { List } from '../list.js';
import type { Rules } from '../rules.js';
import { getMixinEntryRules, type MixinEntry } from './callable-entry.js';
import { isNode } from './is-node.js';
import { attachMixinOutputSlot } from './mixin-output-slot.js';
import { withRulesContext } from './context.js';
import { wireCallableScopeFrames } from './callable-scope-frame.js';

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
  getRootSourceRules
}: EvaluateCallableSpecialCaseCandidateOptions): Promise<CallableSpecialCaseResult> {
  if (isNode(candidate, N.Ruleset)) {
    const rulesetGuard = candidate.guard;
    if (rulesetGuard instanceof Nil) {
      return { handled: true };
    }

    const sourceRules = getRootSourceRules(candidate.rules);
    let rules = createOwnedRules(sourceRules);
    const parentFrame = isNode(callSiteRules, N.Rules)
      ? callSiteRules.getScopeFrame()
      : undefined;
    const definitionFrame = candidate.rules._scopeFrame
      ?? (
        isNode(candidate.sourceParent, N.Rules)
          ? candidate.sourceParent.getScopeFrame()
          : undefined
      );
    wireCallableScopeFrames({
      rules,
      lexicalScopeFrame: definitionFrame ?? parentFrame,
      fallbackScopeFrame: context.leakyRules === true ? parentFrame : undefined,
      parentFrame,
      leakyRules: context.leakyRules === true
    });
    if (rulesetGuard) {
      const guardPasses = await withRulesContext(context, rules, async () => {
        context.isDefault = false;
        if (rulesetGuard instanceof Condition) {
          return await rulesetGuard.evaluateBoolean(context);
        }
        const resolvedGuard = await rulesetGuard.eval(context);
        return resolvedGuard instanceof Bool && resolvedGuard.value === true;
      });
      if (!guardPasses) {
        return { handled: true };
      }
    }

    let needsCallerPlacementDuringEval = false;
    for (let i = 0; i < sourceRules.rules.length; i++) {
      if (isNode(sourceRules.rules[i], N.Ruleset | N.AtRule)) {
        needsCallerPlacementDuringEval = true;
        break;
      }
    }
    if (!needsCallerPlacementDuringEval) {
      rules.addFlag(F_MAY_ASYNC);
    }
    rules = await withRulesContext(context, rules, () => rules.eval(context));
    rules.index = candidate.index;
    attachMixinOutputSlot(rules, sourceRules, restrictMixinOutputLookup, {
      rulesetPlacement: true
    });
    return { handled: true, output: rules };
  }

  if (!isNode(candidate, N.Mixin) && !candidateName && !candidateParams && !candidateGuard) {
    const sourceRules = getRootSourceRules(getMixinEntryRules(candidate));
    let unlocked = createUnlockedRules(sourceRules);
    const parentFrame = isNode(callSiteRules, N.Rules)
      ? callSiteRules.getScopeFrame()
      : undefined;
    const candidateParent = candidate.parent ?? callSiteRules;
    if (!candidateParent) {
      throw new TypeError('Callable special-case setup requires a parent or call-site rules');
    }

    const candidateRules = getMixinEntryRules(candidate);
    const lexicalScopeFrame = candidateRules._scopeFrame
      ?? (
        isNode(candidate.parent, N.Rules)
          ? candidate.parent.getScopeFrame()
          : undefined
      );
    wireCallableScopeFrames({
      rules: unlocked,
      lexicalScopeFrame,
      fallbackScopeFrame: context.leakyRules === true ? parentFrame : undefined,
      parentFrame,
      liveSlots: new Map(),
      leakyRules: context.leakyRules === true
    });
    attachMixinOutputSlot(unlocked, sourceRules, restrictMixinOutputLookup, {
      fallbackFrame: context.leakyRules === true ? parentFrame : undefined
    });
    unlocked.index = candidate.index;
    const evalContextRules = isNode(candidateParent, N.Rules) ? candidateParent : unlocked;
    const evaledUnlocked = withRulesContext(context, evalContextRules, () => unlocked.eval(context));
    unlocked = (isThenable(evaledUnlocked) ? await evaledUnlocked : evaledUnlocked) as Rules;
    return { handled: true, output: unlocked };
  }

  return { handled: false };
}
