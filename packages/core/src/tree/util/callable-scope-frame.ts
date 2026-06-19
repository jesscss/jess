import { type BindingCell, buildScopeFrame, type ScopeFrame } from '../scope-frame.js';
import type { Rules } from '../rules.js';
import { assignMixinOutputFallbackFrame } from './mixin-output-slot.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';

type WireCallableScopeFramesOptions = {
  rules: Rules;
  outerRules?: Rules;
  lexicalScopeFrame?: ScopeFrame;
  fallbackScopeFrame?: ScopeFrame;
  parentFrame?: ScopeFrame;
  liveSlots?: Map<string, BindingCell>;
  usesPreboundParamGuardOuterRules?: boolean;
  leakyRules?: boolean;
};

function wireSourceBackedChildFrames(rules: Rules, parentFrame: ScopeFrame): void {
  if (rules.options.sourceBackedCallableSurface !== true) {
    return;
  }
  for (let i = 0; i < rules.rules.length; i++) {
    const child = rules.rules[i]!;
    const childRules = isNode(child, N.Rules)
      ? child
      : isNode(child, N.Ruleset | N.AtRule)
        ? child.rules
        : undefined;
    if (!childRules) {
      continue;
    }
    childRules.scopeFrame = buildScopeFrame(
      undefined,
      childRules,
      parentFrame,
      undefined,
      undefined,
      true
    );
    wireSourceBackedChildFrames(childRules, childRules.scopeFrame);
  }
}

function hasCallableVariableBindingSurface(rules: Rules): boolean {
  if (rules.options.sourceBackedCallableSurface !== true) {
    return false;
  }
  for (let i = 0; i < rules.rules.length; i++) {
    const child = rules.rules[i]!;
    if (isNode(child, N.VarDeclaration)) {
      return true;
    }
  }
  return false;
}

function prepareCallableDeclarationBindings(rules: Rules): ReturnType<Rules['prepareScopeFrameDeclarationBindings']> {
  if (rules.options.sourceBackedCallableSurface !== true) {
    return undefined;
  }
  return rules.prepareScopeFrameDeclarationBindings();
}

export function wireCallableScopeFrames({
  rules,
  outerRules,
  lexicalScopeFrame,
  fallbackScopeFrame,
  parentFrame,
  liveSlots,
  usesPreboundParamGuardOuterRules = false,
  leakyRules = false
}: WireCallableScopeFramesOptions): void {
  if (liveSlots) {
    const declarationBindings = prepareCallableDeclarationBindings(rules);
    rules.scopeFrame = buildScopeFrame(
      declarationBindings?.varsByName,
      rules,
      lexicalScopeFrame,
      liveSlots,
      declarationBindings?.pendingDeclarationNames,
      declarationBindings !== undefined
    );
    rules.scopeFrame.fallbackFrame = fallbackScopeFrame;
    wireSourceBackedChildFrames(rules, rules.scopeFrame);
    if (outerRules) {
      if (usesPreboundParamGuardOuterRules) {
        outerRules.scopeFrame = buildScopeFrame(
          undefined,
          outerRules,
          lexicalScopeFrame,
          new Map(liveSlots)
        );
        if (parentFrame && parentFrame !== lexicalScopeFrame) {
          outerRules.scopeFrame.fallbackFrame = parentFrame;
        }
      } else {
        outerRules.scopeFrame = rules.scopeFrame;
      }
    }
    return;
  }

  if (hasCallableVariableBindingSurface(rules)) {
    rules.scopeFrame = rules.getScopeFrame(lexicalScopeFrame ?? parentFrame);
    rules.scopeFrame.fallbackFrame = fallbackScopeFrame;
    wireSourceBackedChildFrames(rules, rules.scopeFrame);
    return;
  }

  if (rules.options.sourceBackedCallableSurface === true && lexicalScopeFrame) {
    rules.scopeFrame = rules.getScopeFrame(lexicalScopeFrame, false);
    rules.scopeFrame.fallbackFrame = fallbackScopeFrame;
    wireSourceBackedChildFrames(rules, rules.scopeFrame);
    return;
  }

  if (leakyRules && parentFrame) {
    assignMixinOutputFallbackFrame(rules, parentFrame);
  }
}
