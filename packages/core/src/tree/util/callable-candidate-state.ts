import type { Node } from '../node.js';
import { N } from '../node-type.js';
import { F_STATIC } from '../node.js';
import type { ScopeFrame } from '../scope-frame.js';
import type { CallableParamMatch, CallableParamBindingRecord } from './callable-param-match.js';
import type { Rules } from '../rules.js';
import type { CallableEntry } from './callable-entry.js';
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
  const candidateRules = candidate.value.rules;
  const sourceRules = getRootSourceRules(candidateRules);
  const canUseUnlockedRules = candidateRules.hasFlag(F_STATIC) && candidateRules.value.length === 0;
  const rules = canUseUnlockedRules
    ? createUnlockedRules(candidateRules)
    : createOwnedRules(candidateRules);
  const candidateParent = candidate.parent ?? callSiteRules;
  const definitionParent = candidate.parent ?? candidateRules.parent;
  if (!candidateParent) {
    throw new TypeError('Callable candidate setup requires a parent or call-site rules');
  }

  rules.options.rulesVisibility ??= {};
  rules.options.rulesVisibility.VarDeclaration = leakyRules ? 'public' : 'private';
  candidateParent.adopt(rules);

  const parentFrame: ScopeFrame | undefined = isNode(callSiteRules, N.Rules)
    ? callSiteRules.getScopeFrame()
    : undefined;
  const definitionFrame: ScopeFrame | undefined = isNode(definitionParent, N.Rules)
    ? definitionParent.getScopeFrame()
    : undefined;
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
