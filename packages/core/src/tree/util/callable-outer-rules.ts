import type { Node } from '../node.js';
import type { Rules } from '../rules.js';

type EnsureCallableOuterRulesSurfaceOptions = {
  currentOuterRules?: Rules;
  rules: Rules;
  parent: Node;
  candidateIndex?: number;
  createOuterRules: (rules: Rules, options?: Rules['options']) => Rules;
  options?: Rules['options'];
  syncScopeFrame?: boolean;
};

export function ensureCallableOuterRulesSurface({
  currentOuterRules,
  rules,
  parent,
  candidateIndex,
  createOuterRules,
  options,
  syncScopeFrame = true
}: EnsureCallableOuterRulesSurfaceOptions): Rules {
  const outerRules = currentOuterRules ?? createOuterRules(rules, options);
  if (syncScopeFrame && rules._scopeFrame) {
    outerRules.scopeFrame = rules._scopeFrame;
  }
  outerRules.index = candidateIndex;
  parent.adopt(outerRules);
  return outerRules;
}
