import type { Node } from '../node.js';
import { N } from '../node-type.js';
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
  definedInImportedSurface: boolean;
};

type PrepareCallableCandidateStateOptions = {
  candidate: CallableEntry;
  callSiteRules?: Node;
  leakyRules: boolean;
  resolvedBindingInfo?: CallableParamMatch;
  createCallableRules: (sourceRules: Rules) => Rules;
  getRootSourceRules: (rules: Rules) => Rules;
};

export function prepareCallableCandidateState({
  candidate,
  callSiteRules,
  leakyRules,
  resolvedBindingInfo,
  createCallableRules,
  getRootSourceRules
}: PrepareCallableCandidateStateOptions): PreparedCallableCandidateState {
  const candidateRules = getMixinEntryRules(candidate);
  const sourceRules = getRootSourceRules(candidateRules);
  const rules = createCallableRules(candidateRules);
  const candidateParent = candidate.parent ?? callSiteRules;
  const definitionParent = candidate.parent ?? candidateRules.parent;
  if (!candidateParent) {
    throw new TypeError('Callable candidate setup requires a parent or call-site rules');
  }

  if (isNode(candidate, N.Mixin)) {
    rules.parent = candidateRules.parent;
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
  // A callable defined inside an imported/composed surface (import boundary that
  // inlines its members) may read config vars applied at the import site; those
  // live on the call-site chain, not the definition chain. Signals the param-less
  // body wiring to link the call-site fallback so the config resolves.
  const definedInImportedSurface = isNode(definitionParent, N.Rules)
    && definitionParent.options.importBoundary === true
    && definitionParent.options.inlinesMembersToParent === true;
  const fallbackScopeFrame = (
    (leakyRules || parentFrame?.hasLiveBindings === true)
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
    fallbackScopeFrame,
    definedInImportedSurface
  };
}
