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
  leakyScope: boolean;
  resolvedBindingInfo?: CallableParamMatch;
  /**
   * The BOUND surface a LEAKY nested def leaked from (spine leaky-callable fold). When
   * present, the candidate's definition frame is this surface's frame — it carries the
   * enclosing mixin's per-call param slots the def closes over (`@a=1`), which the
   * static def parent's frame does not. Undefined for every non-leaked candidate.
   */
  leakySurface?: Rules;
  createCallableRules: (sourceRules: Rules) => Rules;
  getRootSourceRules: (rules: Rules) => Rules;
};

// Find the inlined-import placement frame reachable from a call-site frame chain.
// A non-boundary `@import` / wildcard `@compose` links its evaluated member
// surface as the importer frame's `fallbackFrame`; that surface carries the
// import's `with`/`set` config live-slots. Return the deepest such placement so
// an imported body resolves config there instead of the importer's own bindings.
function findInlinedImportPlacementFrame(
  callSiteFrame: ScopeFrame | undefined
): ScopeFrame | undefined {
  let frame = callSiteFrame;
  const seen = new Set<ScopeFrame>();
  while (frame && !seen.has(frame)) {
    seen.add(frame);
    if (frame.fallbackFrame && !seen.has(frame.fallbackFrame)) {
      return frame.fallbackFrame;
    }
    frame = frame.parent;
  }
  return undefined;
}

export function prepareCallableCandidateState({
  candidate,
  callSiteRules,
  leakyScope,
  resolvedBindingInfo,
  leakySurface,
  createCallableRules,
  getRootSourceRules
}: PrepareCallableCandidateStateOptions): PreparedCallableCandidateState {
  const candidateRules = getMixinEntryRules(candidate);
  const sourceRules = getRootSourceRules(candidateRules);
  const rules = createCallableRules(candidateRules);
  const candidateParent = candidate.parent ?? callSiteRules;
  // A leaky nested def resolves its definition frame against the BOUND surface it
  // leaked from (holding the enclosing mixin's per-call params), NOT its static def
  // parent. The surface IS a Rules, so its `getScopeFrame()` supplies the live param
  // slots the closure reads (`@a`). Falls back to the static parent otherwise.
  const definitionParent = leakySurface ?? candidate.parent ?? candidateRules.parent;
  if (!candidateParent) {
    throw new TypeError('Callable candidate setup requires a parent or call-site rules');
  }

  if (isNode(candidate, N.Mixin)) {
    rules.parent = candidateRules.parent;
  }

  rules.options.rulesVisibility ??= {};
  rules.options.rulesVisibility.VarDeclaration = leakyScope ? 'public' : 'private';
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
  // A body defined inside an inlined import reads its `with`/`set` config from the
  // IMPORT PLACEMENT, not the importer's own scope. The importer links the
  // placement as its frame's fallback (linkInlineImportFallbackFrames), so a plain
  // caller fallback reaches config only AFTER the importer's own decls — a
  // same-named importer decl then wrongly shadows the config. Wire the placement
  // config directly onto the definition (lexical) chain: lexical parents are walked
  // before the caller fallback, so the config wins over an importer decl while the
  // caller fallback still resolves genuinely leaky vars.
  if (definedInImportedSurface && definitionFrame) {
    const importPlacementFrame = findInlinedImportPlacementFrame(parentFrame);
    if (importPlacementFrame && definitionFrame.fallbackFrame === undefined) {
      definitionFrame.fallbackFrame = importPlacementFrame;
    }
  }
  const fallbackScopeFrame = (
    (leakyScope || parentFrame?.hasLiveBindings === true)
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
