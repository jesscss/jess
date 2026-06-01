import type { Node } from '../node.js';
import { F_STATIC } from '../node.js';
import type { Rules } from '../rules.js';
import { ensureCallableOuterRulesSurface } from './callable-outer-rules.js';

type PrepareCallableGuardStateOptions = {
  hasDefault: boolean;
  candidateGuard?: Node;
  copyGuardForEval: (guard: Node) => Node;
  candidateParams?: Node;
  paramBindingsLength: number;
  outerRules?: Rules;
  rules: Rules;
  parent: Node;
  candidateIndex?: number;
  parentFrame?: Rules['scopeFrame'];
  createOuterRules: (rules: Rules, options?: Rules['options']) => Rules;
  rulesContextParent?: Node;
};

type PrepareCallableGuardStateResult = {
  guard?: Node;
  outerRules?: Rules;
  usesPreboundCallerGuardOuterRules: boolean;
};

type EnsureCallableGuardOuterRulesOptions = {
  guard?: Node;
  usesPreboundCallerGuardOuterRules: boolean;
  usesPreboundParamGuardOuterRules: boolean;
  outerRules?: Rules;
  rules: Rules;
  parent: Node;
  candidateIndex?: number;
  createOuterRules: (rules: Rules, options?: Rules['options']) => Rules;
};

export function prepareCallableGuardState({
  hasDefault,
  candidateGuard,
  copyGuardForEval,
  candidateParams,
  paramBindingsLength,
  outerRules,
  rules,
  parent,
  candidateIndex,
  parentFrame,
  createOuterRules,
  rulesContextParent
}: PrepareCallableGuardStateOptions): PrepareCallableGuardStateResult {
  const guard: Node | undefined = hasDefault
    ? candidateGuard
    : candidateGuard
      ? (candidateGuard.hasFlag(F_STATIC) ? candidateGuard : copyGuardForEval(candidateGuard))
      : undefined;
  const usesPreboundCallerGuardOuterRules = Boolean(
    guard
    && !guard.hasFlag(F_STATIC)
    && !candidateParams
    && paramBindingsLength === 0
  );
  if (usesPreboundCallerGuardOuterRules && !outerRules) {
    outerRules = ensureCallableOuterRulesSurface({
      currentOuterRules: outerRules,
      rules,
      parent: rulesContextParent ?? parent,
      candidateIndex,
      createOuterRules,
      syncScopeFrame: false
    });
    if (parentFrame) {
      outerRules.scopeFrame = parentFrame;
    }
  }
  return {
    guard,
    outerRules,
    usesPreboundCallerGuardOuterRules
  };
}

export function ensureCallableGuardOuterRules({
  guard,
  usesPreboundCallerGuardOuterRules,
  usesPreboundParamGuardOuterRules,
  outerRules,
  rules,
  parent,
  candidateIndex,
  createOuterRules
}: EnsureCallableGuardOuterRulesOptions): Rules | undefined {
  if (
    !guard
    || guard.hasFlag(F_STATIC)
    || usesPreboundCallerGuardOuterRules
    || usesPreboundParamGuardOuterRules
  ) {
    return outerRules;
  }
  return ensureCallableOuterRulesSurface({
    currentOuterRules: outerRules,
    rules,
    parent,
    candidateIndex,
    createOuterRules
  });
}
