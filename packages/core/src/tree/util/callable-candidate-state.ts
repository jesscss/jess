import type { Node } from '../node.js';
import { N } from '../node-type.js';
import { F_STATIC } from '../node.js';
import type { ScopeFrame } from '../scope-frame.js';
import type { CallableParamMatch, CallableParamBindingRecord } from './callable-param-match.js';
import type { Rules } from '../rules.js';
import { getMixinEntryRules, type CallableEntry } from './callable-entry.js';
import { isNode } from './is-node.js';

export type PreparedCallableCandidateState = {
  sourceRules: Rules;
  rules: Rules;
  candidateParent: Node;
  paramBindings: CallableParamBindingRecord[];
  signatureKey: string | undefined;
  parentFrame?: ScopeFrame;
  definitionFrame?: ScopeFrame;
  lexicalScopeFrame?: ScopeFrame;
  fallbackScopeFrame?: ScopeFrame;
};

type PrepareCallableCandidateStateOptions = {
  candidate: CallableEntry;
  callSiteRules?: Node;
  leakyRules: boolean;
  resolvedBindingInfo?: CallableParamMatch;
  createOwnedRules: (sourceRules: Rules) => Rules;
  createUnlockedRules: (sourceRules: Rules) => Rules;
  getRootSourceRules: (rules: Rules) => Rules;
};

export function prepareCallableCandidateState({
  candidate,
  callSiteRules,
  leakyRules,
  resolvedBindingInfo,
  createOwnedRules,
  createUnlockedRules,
  getRootSourceRules
}: PrepareCallableCandidateStateOptions): PreparedCallableCandidateState {
  const candidateRules = getMixinEntryRules(candidate);
  const sourceRules = getRootSourceRules(candidateRules);
  const canUseUnlockedRules = candidateRules.hasFlag(F_STATIC) && candidateRules.rules.length === 0;
  const rules = canUseUnlockedRules
    ? createUnlockedRules(candidateRules)
    : createOwnedRules(candidateRules);
  const candidateSourceParent = isNode(candidate)
    ? candidate.sourceParent
    : candidate.parent;
  const candidateParent = candidateSourceParent ?? callSiteRules;
  const callSiteSourceRules = isNode(callSiteRules, N.Rules)
    ? getRootSourceRules(callSiteRules)
    : undefined;
  const definitionParent = (
    isNode(callSiteRules, N.Rules)
    && candidateSourceParent === callSiteSourceRules
  )
    ? callSiteRules
    : candidateSourceParent ?? candidateRules.sourceParent;
  if (!candidateParent) {
    throw new TypeError('Callable candidate setup requires a parent or call-site rules');
  }

  rules.options.rulesVisibility ??= {};
  rules.options.rulesVisibility.VarDeclaration = leakyRules ? 'public' : 'private';
  const parentFrame: ScopeFrame | undefined = isNode(callSiteRules, N.Rules)
    ? callSiteRules.getScopeFrame()
    : undefined;
  const definitionFrame: ScopeFrame | undefined = candidateRules._scopeFrame
    ?? (
      isNode(definitionParent, N.Rules)
        ? definitionParent._scopeFrame ?? (
          definitionParent === candidateSourceParent && parentFrame
            ? undefined
            : definitionParent.getScopeFrame()
        )
        : undefined
    );
  const lexicalScopeFrame = definitionFrame ?? parentFrame;
  const fallbackScopeFrame = (
    leakyRules
    && parentFrame
    && parentFrame !== lexicalScopeFrame
  )
    ? parentFrame
    : undefined;

  return {
    sourceRules,
    rules,
    candidateParent,
    paramBindings: resolvedBindingInfo?.bindings ?? [],
    signatureKey: resolvedBindingInfo?.signatureKey,
    parentFrame,
    definitionFrame,
    lexicalScopeFrame,
    fallbackScopeFrame
  };
}
