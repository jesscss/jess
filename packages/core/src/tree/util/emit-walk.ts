/**
 * emit-walk — the P1 frame-threading spine (UNIFIED-EVAL-EMIT-DESIGN §2).
 *
 * ONE downward traversal of the SOURCE tree. There is no eval() that returns a
 * materialized output tree for a separate serialize() walk: at each node we
 * resolve-against-the-current-frame and write-to-buffer together.
 *
 * Two stacks are threaded for the whole pass:
 *   - the STRUCTURAL stack (ancestry / composedSelectorStack) — already carried
 *     in PrintOptions and owned by the existing container serializer, which we
 *     reuse for header composition/collapse (design §7 "survives").
 *   - the VALUE stack — the live ScopeFrame chain, threaded through
 *     `context.rulesContext`. It is pushed on scope-enter and NOT popped until
 *     that scope's bytes are in the buffer, so a leaf resolves against the SAME
 *     frame eval would have used (the B1s fix).
 *
 * A leaf resolves `resolve(sourceLeaf, currentFrame)` → bytes at its emit
 * moment. Mixin / loop / $for / $if bodies are descended SHARED under a pushed
 * value-frame carrying per-placement bindings as live cells — never copied.
 */

import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import type { Context } from '../../context.js';
import { Node } from '../node.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';
import { Nil } from '../nil.js';
import { Rules } from '../rules.js';
import { buildScopeFrame, type BindingCell, type ScopeFrame } from '../scope-frame.js';
import { getPrintOptions, type FinalPrintOptions, type PrintOptions } from './print.js';

/**
 * The value-frame push: point `context.rulesContext` at the source Rules node
 * whose `_scopeFrame` is the live lexical frame for its subtree, run `fn` while
 * that frame is live, then restore. This is scope-enter/scope-exit with the
 * exit happening AFTER the scope's bytes are in the buffer (design §2.3), so a
 * leaf reached during `fn` resolves against exactly this frame.
 */
export function withValueFrame<T>(
  context: Context,
  frameRules: Rules,
  fn: () => T
): T {
  const savedRulesContext = context.rulesContext;
  context.rulesContext = frameRules;
  try {
    return fn();
  } finally {
    context.rulesContext = savedRulesContext;
  }
}

/**
 * Resolve one leaf against the live value-frame and write its bytes to the
 * buffer at the emit position, attributing the chunk to the SOURCE node as the
 * sourcemap origin (design §2.4 — the origin travels with the emit position, no
 * retained output node).
 *
 * "Resolve" is `node.eval(context)` with `context.rulesContext` pointing at the
 * live frame (set by `withValueFrame`); "write bytes" is `resolved.toString()`
 * through the shared print state. The resolved node is transient and local — it
 * is serialized then dropped, never staged into an output tree.
 */
export function emitLeaf(
  node: Node,
  context: Context,
  options: FinalPrintOptions
): MaybePromise<void> {
  const write = (resolved: Node | undefined): void => {
    if (!resolved || resolved instanceof Nil) {
      return;
    }
    resolved.toString(options);
  };
  const resolved = node.eval(context);
  if (isThenable(resolved)) {
    return resolved.then(write);
  }
  write(resolved);
}

/** True for a node the spine resolves as a value leaf (not a scope container). */
export function isValueLeaf(node: Node): boolean {
  return !isNode(node, N.Rules | N.Ruleset | N.AtRule | N.Mixin);
}

/**
 * Descend a SHARED body under a pushed value-frame. `bodyOwner` is the source
 * Rules whose children are emitted; `frameRules` is the Rules whose
 * `_scopeFrame` carries the per-placement bindings (params / loop counter) as
 * live cells. For a plain ruleset body these are the same node; for a reused
 * mixin/loop body the body is shared while the frame differs per placement, so
 * the same source children emit different bytes purely by the pushed frame.
 *
 * No copy: the body children are iterated in place. Per-placement difference is
 * entirely in the value-frame's live cells (design §3).
 */
export function emitSharedBody(
  bodyOwner: Rules,
  frameRules: Rules,
  context: Context,
  options?: PrintOptions
): MaybePromise<void> {
  const opts = getPrintOptions(options);
  const children = bodyOwner.rules;
  return withValueFrame(context, frameRules, () => emitChildren(children, 0, context, opts));
}

/**
 * Build a per-placement value-frame that SHARES the source body's children and
 * carries the placement's bindings as live cells (design §2.2 / §3 — the mixin /
 * loop / $for / $if body mechanism). The returned surface's children ARE the
 * source body's children (same node identities, no copy); only its pushed frame
 * differs per placement, so the same source leaves emit different bytes.
 *
 * This mirrors `createIterationEvalSurface(share=true)` + `buildScopeFrame`: a
 * thin surface over the shared body under a fresh frame whose parent is the
 * definition/call-site lexical frame and whose live slots hold the per-placement
 * bindings.
 */
export function pushBoundBodyFrame(
  sourceBody: Rules,
  bindings: Map<string, BindingCell>,
  parentFrame: ScopeFrame | undefined
): Rules {
  // Share the child array by reference — the placement difference is the frame,
  // never a copied child (the always-share invariant, §3).
  const surface = new Rules(
    [...sourceBody.rules],
    { ...sourceBody.options },
    undefined,
    sourceBody.sourceRoot?._treeContext
  );
  surface.sourceNode = sourceBody.sourceNode ?? sourceBody;
  surface.scopeFrame = buildScopeFrame(undefined, surface, parentFrame, bindings, undefined, true);
  return surface;
}

function emitChildren(
  children: readonly Node[],
  index: number,
  context: Context,
  options: FinalPrintOptions
): MaybePromise<void> {
  for (let i = index; i < children.length; i++) {
    const child = children[i]!;
    if (!isValueLeaf(child)) {
      // Container descent (nested ruleset/at-rule) is owned by the structural
      // side (composedSelectorStack); the spine leaf mechanism does not reach
      // into it. P1 proves the leaf + shared-body value path.
      continue;
    }
    const step = emitLeaf(child, context, options);
    if (isThenable(step)) {
      return step.then(() => emitChildren(children, i + 1, context, options));
    }
  }
  return undefined;
}
