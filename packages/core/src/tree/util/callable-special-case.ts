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
    // Spine mixin-fold (FOLD A, P4 terminal/sink, UNIFIED-EVAL-EMIT-DESIGN §2/§3).
    // When the emit-walk driver installed a surface sink AND this ruleset-as-mixin is
    // UNGUARDED (`rulesetGuard === undefined`; a genuine `when`-guard defers — its
    // outcome is not yet reproduced in the fold), hand the sink the bound surface so
    // its body folds INLINE at the call site instead of building an output tree. The
    // ruleset ALSO streams standalone at its own source position (the spine descent
    // leaves the authored `.foo {}` in place — the fold adds only the call-site copy).
    // `candidateIsMixin=false` tags it for `resolveSpineMixinCall.finish`. Returning
    // `true` → no output tree (`{handled:true}` with no `output`, mirroring the mixin
    // arm). `false` (non-simple body) falls through to the eval-materialize below
    // (byte-identical; the eval arm dies in P4). Off the spine (`sink === undefined`)
    // this is skipped — the eval arm is unchanged.
    // A detached ruleset called from a variable has no tree parent (neither the
    // caller nor the candidate is parented); the call-site Rules is its natural
    // placement parent — same fallback the non-Ruleset branch below uses.
    const callParent = (caller?.parent as Node | undefined) ?? candidate.parent ?? callSiteRules;
    if (!callParent) {
      throw new TypeError('Callable special-case setup requires a caller, candidate, or call-site parent');
    }
    const surfaceSink = context.spineMixinSurfaceSink;
    if (surfaceSink && rulesetGuard === undefined) {
      // Parent the bound surface BEFORE consulting the sink — the Mixin-def arm
      // (`callable-candidate-output.ts:80`) adopts unconditionally and this
      // ruleset-as-mixin arm must match: the fold's decl resolution walks the
      // surface's `.parent` chain for free-var/closure lookup, so an unparented
      // surface would resolve against the wrong (or no) enclosing scope. `adopt`
      // only re-points the parent pointer (idempotent), so the eval fall-through
      // below re-adopting is harmless.
      callParent.adopt(rules);
      if (surfaceSink(rules, sourceRules, false)) {
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
    // Spine DR-call fold (RUNG-1). A detached-ruleset call (`@alias()` / `@1()`)
    // reaches this UNLOCKED arm as a param-/guard-less `callable-rules` entry. When
    // the emit-walk driver installed a surface sink, hand it the WIRED callable
    // surface (its scope frame chains to the detached ruleset's closure/lexical
    // parent — the free-var resolution the eval `unlocked.eval` would perform) so
    // its body folds INLINE at the call site instead of building an output tree.
    // `candidateIsMixin=false` tags it for `resolveSpineMixinCall.finish`. Returning
    // `true` → no eval materialization. A NON-simple body (`false`) falls through to
    // the eval-materialize below (byte-identical). Off the spine (`sink===undefined`)
    // this is skipped — the eval arm is unchanged.
    const surfaceSink = context.spineMixinSurfaceSink;
    if (surfaceSink && surfaceSink(unlocked, sourceRules, false)) {
      return { handled: true };
    }
    const evaledUnlocked = unlocked.eval(context);
    unlocked = (isThenable(evaledUnlocked) ? await evaledUnlocked : evaledUnlocked) as Rules;
    return { handled: true, output: unlocked };
  }

  return { handled: false };
}
