import type { Context } from '../../context.js';
import type { Node } from '../node.js';
import type { List } from '../list.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { isConstantGuard } from './callable-guard-constant.js';
import type { Rules } from '../rules.js';
import { evaluateCallableCandidateOutput } from './callable-candidate-output.js';
import type { CallableEntry } from './callable-entry.js';
import {
  recordCallableDefaultGuardResult,
  type CallableDefaultState
} from './callable-default-guard.js';
import {
  evaluateCallableGuard,
  prepareCallableGuardState
} from './callable-guard.js';
import { createCallableLiveSlots } from './callable-live-slots.js';
import { ensureCallableOuterRulesSurface } from './callable-outer-rules.js';
import { wireCallableScopeFrames } from './callable-scope-frame.js';
import type { PreparedCallableCandidateState } from './callable-candidate-state.js';
import type { CallSignature } from './recursion-helper.js';

type ExecuteCallableCandidateOptions = {
  context: Context;
  hasDefault: boolean;
  candidate: CallableEntry;
  candidateGuard?: Node;
  candidateParams?: List<Node>;
  candidateState: PreparedCallableCandidateState;
  nodeArgs: Node[];
  defaultState: CallableDefaultState;
  restrictMixinOutputLookup: boolean;
  createOuterRules: (rules: Rules, options?: Rules['options']) => Rules;
};

type ExecuteCallableCandidateResult = {
  output?: Rules;
  debugDefaultProbeResult?: {
    passWhenDefaultFalse: boolean;
    passWhenDefaultTrue: boolean;
  };
};

export async function executeCallableCandidate({
  context,
  hasDefault,
  candidate,
  candidateGuard,
  candidateParams,
  candidateState,
  nodeArgs,
  defaultState,
  restrictMixinOutputLookup,
  createOuterRules
}: ExecuteCallableCandidateOptions): Promise<ExecuteCallableCandidateResult> {
  const {
    sourceRules,
    rules,
    candidateParent,
    paramBindings,
    signatureKey,
    parentFrame,
    lexicalScopeFrame,
    fallbackScopeFrame,
    definedInImportedSurface
  } = candidateState;

  let outerRules: Rules | undefined;
  const getParamsSignature = (): CallSignature => signatureKey;
  let usesPreboundParamGuardOuterRules = false;

  if (candidateParams || paramBindings.length > 0) {
    const needsOuterRules = Boolean(candidateGuard && !isConstantGuard(candidateGuard));
    if (needsOuterRules) {
      outerRules = ensureCallableOuterRulesSurface({
        currentOuterRules: outerRules,
        rules,
        parent: candidateParent,
        candidateIndex: candidate.index,
        createOuterRules,
        options: {
          rulesVisibility: {
            Ruleset: 'public',
            Declaration: 'public',
            VarDeclaration: 'public',
            Mixin: 'public'
          }
        },
        syncScopeFrame: false
      });
      usesPreboundParamGuardOuterRules = true;
    }
    const liveSlots = createCallableLiveSlots({
      paramBindings,
      nodeArgs,
      defineArguments: Boolean(context.treeContext?.file),
      rulesContext: rules
    });
    wireCallableScopeFrames({
      rules,
      outerRules,
      lexicalScopeFrame,
      fallbackScopeFrame,
      parentFrame,
      liveSlots,
      usesPreboundParamGuardOuterRules
    });
  } else if (context.spineMixinSurfaceSink !== undefined && lexicalScopeFrame) {
    /*
     * SPINE-FOLD ONLY (cutover MIXIN fold #6). A param-less nested mixin folded
     * through the spine descends its SHARED body under `context.rulesContext =
     * surface` (the `spineFrame` tag). Unlike the eval path — which reaches the
     * definition scope by walking the surface node's `.parent` chain at
     * `getScopeFrame` time — the fold resolves each leaf against the surface's own
     * scope frame, whose parent must therefore BE the definition (lexical) scope so
     * a closure over an INTERMEDIATE-scope local (`.util { @local: red; .paint() {
     * color: @local } }`) resolves, and a shadowed name (`.box { @c: inner; .tint()
     * }`) reads the definition binding, not the caller/root one.
     *
     * Reuse the lexical-scope re-parent that `wireCallableScopeFrames`' imported-
     * surface branch performs (`rules.getScopeFrame(lexicalScopeFrame)`): it chains
     * the surface frame to the def scope (which itself chains to root, so a root-var
     * closure still resolves) and deliberately wires NO caller fallback — a Less
     * mixin closure captures its DEFINITION scope, not the call site. GATED on the
     * sink so the EVAL path (no sink installed) is byte-untouched: it wires nothing
     * here and resolves via the node `.parent` walk exactly as before.
     */
    wireCallableScopeFrames({
      rules,
      lexicalScopeFrame,
      definedInImportedSurface: true
    });
  } else if (context.options.leakyScope === true && parentFrame) {
    wireCallableScopeFrames({
      rules,
      parentFrame,
      leakyScope: true
    });
  } else if (definedInImportedSurface) {
    /*
     * Param-less callable defined inside an imported/composed surface: no live
     * slots, but the body (and any detached-ruleset closure it defines) must
     * still reach config vars applied at the import/call site — an imported
     * `with`/`set` binding lives on the call-site chain, not the definition
     * chain. Wire the body-surface frame's fallback so those vars resolve.
     */
    wireCallableScopeFrames({
      rules,
      lexicalScopeFrame,
      fallbackScopeFrame,
      parentFrame,
      definedInImportedSurface
    });
  }

  let {
    guard,
    outerRules: preparedGuardOuterRules,
    usesPreboundCallerGuardOuterRules
  } = prepareCallableGuardState({
    hasDefault,
    candidateGuard,
    candidateParams,
    paramBindingsLength: paramBindings.length,
    outerRules,
    rules,
    parent: candidateParent,
    rulesContextParent: context.rulesContext,
    candidateIndex: candidate.index,
    parentFrame,
    createOuterRules
  });
  outerRules = preparedGuardOuterRules;

  const guardResult = await evaluateCallableGuard({
    context,
    hasDefault,
    guard,
    candidateGuard,
    usesPreboundCallerGuardOuterRules,
    usesPreboundParamGuardOuterRules,
    outerRules,
    rules,
    parent: candidateParent,
    candidateIndex: candidate.index,
    createOuterRules
  });

  if (!guardResult.passes) {
    return {
      debugDefaultProbeResult: guardResult.defaultProbeResult
    };
  }

  recordCallableDefaultGuardResult({
    state: defaultState,
    guardResult,
    rules,
    sourceRules,
    candidateParent,
    candidateIndex: candidate.index,
    params: getParamsSignature()
  });
  if (guardResult.defersCandidateOutput) {
    return {
      debugDefaultProbeResult: guardResult.defaultProbeResult
    };
  }

  const output = await evaluateCallableCandidateOutput({
    context,
    currentCall: context.callStack.at(-1),
    getParamsSignature,
    candidateParent,
    candidateIndex: candidate.index,
    rules,
    sourceRules,
    restrictMixinOutputLookup,
    allowSpineFold: !hasDefault,
    candidateIsMixin: isNode(candidate, N.Mixin)
  });

  return {
    output,
    debugDefaultProbeResult: guardResult.defaultProbeResult
  };
}
