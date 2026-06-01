import { type BindingCell, buildScopeFrame, type ScopeFrame } from '../scope-frame.js';
import type { Rules } from '../rules.js';
import { assignMixinOutputFallbackFrame } from './mixin-output-slot.js';

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
    rules.scopeFrame = buildScopeFrame(undefined, rules, lexicalScopeFrame, liveSlots);
    rules.scopeFrame.fallbackFrame = fallbackScopeFrame;
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

  if (leakyRules && parentFrame) {
    assignMixinOutputFallbackFrame(rules, parentFrame);
  }
}
