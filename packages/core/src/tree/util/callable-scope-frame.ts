import { type BindingCell, buildScopeFrame, type ScopeFrame, setScopeFrameLiveBinding } from '../scope-frame.js';
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
    // R2 SINGLE-FRAME: the per-call surface frame carries BOTH the body's
    // declaration index AND the param live-slots in ONE frame, parent =
    // lexicalScopeFrame. Previously this built a params-only frame
    // (varsByName undefined, declarationsCovered=true) and body decls lived on a
    // SEPARATE canonical/wrapper frame reached via the node .parent walk — so a
    // nested ruleset (or a detached-ruleset closure) that resolved through the
    // body frame never saw params. Building the decl index here (getScopeFrame
    // builds it from the surface's shared children) then overlaying the param
    // live-slots collapses the two frames into one chain.
    rules.scopeFrame = undefined;
    const frame = rules.getScopeFrame(lexicalScopeFrame);
    for (const [name, cell] of liveSlots) {
      setScopeFrameLiveBinding(frame, name, cell);
    }
    frame.fallbackFrame = fallbackScopeFrame;
    if (outerRules) {
      if (usesPreboundParamGuardOuterRules) {
        outerRules.scopeFrame = buildScopeFrame(
          undefined,
          outerRules,
          lexicalScopeFrame,
          new Map(liveSlots),
          undefined,
          true
        );
        if (parentFrame && parentFrame !== lexicalScopeFrame) {
          outerRules.scopeFrame.fallbackFrame = parentFrame;
        }
      } else {
        outerRules.scopeFrame = frame;
      }
    }
    return;
  }

  if (leakyRules && parentFrame) {
    assignMixinOutputFallbackFrame(rules, parentFrame);
  }
}
