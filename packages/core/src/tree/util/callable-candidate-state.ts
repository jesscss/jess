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
  const rules = candidateRules.hasFlag(F_STATIC)
    ? createUnlockedRules(candidateRules)
    : createOwnedRules(candidateRules);

  if (isNode(candidate, N.Mixin)) {
    Reflect.set(rules, 'parent', candidateRules.parent);
  }

  rules.options.rulesVisibility ??= {};
  rules.options.rulesVisibility.VarDeclaration = leakyRules ? 'public' : 'private';
  candidate.parent!.adopt(rules);

  const parentFrame: ScopeFrame | undefined = isNode(callSiteRules, N.Rules)
    ? callSiteRules.getScopeFrame()
    : undefined;
  const definitionFrame: ScopeFrame | undefined = isNode(candidate.parent, N.Rules)
    ? candidate.parent.getScopeFrame()
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
    paramBindings: resolvedBindingInfo?.bindings ?? [],
    signatureKey: resolvedBindingInfo?.signatureKey,
    parentFrame,
    definitionFrame,
    lexicalScopeFrame,
    fallbackScopeFrame
  };
}
