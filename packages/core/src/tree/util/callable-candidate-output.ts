import type { Context } from '../../context.js';
import type { Node } from '../node.js';
import type { Rules } from '../rules.js';
import type { CallSignature } from './recursion-helper.js';
import { attachMixinOutputSlot } from './mixin-output-slot.js';
import { makeJessError } from '../../jess-error.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';

/**
 * Spine-root parity with `checkValidNodes`' `isRoot && fromCallOutput` rule: a
 * mixin / detached-ruleset CALL that folds a bare property `Declaration` to the
 * document root is invalid ("Properties must be inside selector blocks"). The eval
 * path walks the post-eval output tree; the spine emits call output as text inline
 * (no such tree), so the same rejection is made on the single fold/eval drive when
 * the caller marked the call as a document-root emit. VarDeclaration `@x:` /
 * custom props are distinct node types and are not flagged — only `Declaration`,
 * exactly as `checkValidNodes`. Recurses through call-output `Rules` blocks so an
 * `@import`ed / nested-Rules call output is caught too.
 */
function assertNoRootPropertyDeclaration(rules: readonly Node[] | undefined, context: Context): void {
  if (!rules) {
    return;
  }
  for (let i = 0; i < rules.length; i++) {
    const node = rules[i]!;
    if (node.type === 'Declaration') {
      const propertyName = isNode(node, N.Declaration) ? node.name : undefined;
      throw makeJessError({
        code: 'eval/property-in-root',
        phase: 'eval',
        ctx: context.treeContext,
        node,
        meta: { what: String(propertyName ?? 'property') }
      });
    }
    if (node.type === 'Rules') {
      assertNoRootPropertyDeclaration(isNode(node, N.Rules) ? node.rules : undefined, context);
    }
  }
}

type EvaluateCallableCandidateOutputOptions = {
  context: Context;
  currentCall?: Context['callStack'][number];
  getParamsSignature: () => CallSignature;
  candidateParent: Node;
  candidateIndex?: number;
  rules: Rules;
  sourceRules: Rules;
  restrictMixinOutputLookup: boolean;
  allowSpineFold?: boolean;
  /** True when the resolved candidate is a Mixin DEFINITION (not a ruleset-as-mixin). */
  candidateIsMixin?: boolean;
};

export async function evaluateCallableCandidateOutput({
  context,
  currentCall,
  getParamsSignature,
  candidateParent,
  candidateIndex,
  rules,
  sourceRules,
  restrictMixinOutputLookup,
  allowSpineFold = true,
  candidateIsMixin
}: EvaluateCallableCandidateOutputOptions): Promise<Rules | undefined> {
  if (currentCall && context.callMap.add(currentCall, getParamsSignature())) {
    return undefined;
  }

  try {
    // Spine mixin-fold (cutover, UNIFIED-EVAL-EMIT-DESIGN §2/§3): when the
    // emit-walk driver installed a surface sink, hand it the guard-passed BOUND
    // surface (`rules` — shared body + wired live-cell param frame) to descend
    // INLINE instead of building an output tree. Inside the recursion-guard
    // bracket so a recursive body still trips `callMap`. The sink returns `true`
    // when it consumed the surface (return `undefined` → no output-tree
    // contribution); `false` means the shape is not spine-simple → fall through
    // to the eval terminal for this candidate (byte-identical transition; the
    // eval terminal dies in P4).
    candidateParent.adopt(rules);
    const sink = allowSpineFold ? context.spineMixinSurfaceSink : undefined;
    // The sink is consulted for EVERY guard-passed candidate so `resolveSpineMixin
    // Call` sees each one; it returns false (→ eval this candidate) for a
    // ruleset-as-mixin (`!candidateIsMixin`) or a non-simple surface, and true
    // (→ fold, skip the output tree) only for a spine-simple Mixin-definition body.
    if (sink && sink(rules, sourceRules, candidateIsMixin === true)) {
      return undefined;
    }
    // The sink REJECTED this candidate's surface (non-spine-simple) — this candidate
    // now eval-materializes as the byte-identical fall-back. SUSPEND the sink across
    // that `rules.eval`: a NESTED call fired while materializing this body (e.g. a
    // detached-ruleset call `@r()` inside the surface, whose bound value resolves to
    // another callable) must build its OWN output tree, NOT be intercepted by the
    // top-level call's sink (which would capture the inner body and drop its output,
    // corrupting this candidate's eval-fallback result — the mixin-as-value / detached-
    // ruleset-arg mis-fold). Restore after so sibling candidates are still seen.
    const suspendedSink = context.spineMixinSurfaceSink;
    context.spineMixinSurfaceSink = undefined;
    let newRules: Rules;
    try {
      newRules = await rules.eval(context);
    } finally {
      context.spineMixinSurfaceSink = suspendedSink;
    }
    if (context.spineRootCallEmit) {
      assertNoRootPropertyDeclaration(newRules.rules, context);
    }
    candidateParent.adopt(newRules);
    newRules.index = candidateIndex;
    attachMixinOutputSlot(newRules, sourceRules, restrictMixinOutputLookup);
    // LEAKY forward-propagation at the document ROOT (spine): a root-level mixin
    // call folds via the eval terminal here (the root emit path installs no surface
    // sink), so the eval two-walk's `injectLeakyMixinOutputBindings` (rules.ts
    // applyResult) never runs. Inject the evaluated output's leaked vars into the
    // ROOT frame at the call's source index so a LATER root sibling ruleset
    // (`.heightIsSet { height: @height }`) resolves the leak — byte-identical to
    // less@4. Zero-cost off leaky mode; only a root-level spine call reaches here.
    const leakTargetRoot = context.spineRootCallEmitFrame;
    if (
      context.spineRootCallEmit
      && leakTargetRoot !== undefined
      && context.options.leakyScope === true
      && candidateIndex !== undefined
      && newRules.options.mixinOutputSlot
    ) {
      leakTargetRoot.getScopeFrame();
      leakTargetRoot.injectLeakyMixinOutputBindings(newRules, candidateIndex);
    }
    return newRules;
  } catch (error) {
    if (error instanceof ReferenceError && error.message.includes('Recursive mixin call')) {
      return undefined;
    }
    throw error;
  } finally {
    if (currentCall) {
      context.callMap.delete(currentCall);
    }
  }
}
