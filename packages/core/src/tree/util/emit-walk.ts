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
 * A leaf THIS phase's root wire-in can fully render in the single pass. Stricter
 * than `isValueLeaf`: excludes leaves whose correct output depends on the eval
 * pass's cross-statement handling that the spine does not yet perform —
 *   - `+:` / conditional / merge-flagged declarations (Less property-merge is a
 *     cross-declaration value combination built during eval registration),
 *   - `setDefined` / `nearestOuter` var-declarations (scope-mutating assigns),
 *   - any non-declaration leaf (Call/Apply/etc.) that can expand to statements.
 * Comments and plain declarations/var-declarations with default `:` assign are
 * safe: their bytes are a pure function of the live-frame value resolution.
 */
function isSimpleSpineLeaf(node: Node): boolean {
  if (isNode(node, N.Comment)) {
    return true;
  }
  if (isNode(node, N.Declaration)) {
    const options = node.options as { assign?: string; setDefined?: boolean; nearestOuter?: boolean } | undefined;
    const assign = options?.assign ?? ':';
    if (assign !== ':') {
      return false;
    }
    if (options?.setDefined || options?.nearestOuter) {
      return false;
    }
    return true;
  }
  return false;
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

/**
 * Diagnostic counter for the RATCHET (metric axis (b): pass count 3→1). It
 * increments once each time a root is rendered through the single-pass spine
 * instead of the eval→output-tree→serialize two-walk. A standing test asserts
 * this moves for a spine-eligible root AND that the root's `eval` was NOT
 * invoked on that render, locking the two-walk removal so a later change that
 * re-introduces the eval pass on that path trips a red test.
 */
export const spineRenderCounter = { rootRenders: 0 };

/**
 * Eligibility for the single-pass root path THIS phase covers: a root Rules
 * whose body is purely VALUE LEAVES (declarations / comments / var-decls) — no
 * nested containers, no charset/import document framing. For this shape the
 * spine fully replaces the two-walk: descend the source body once, resolving
 * each leaf against the live frame at its emit moment, with NO eval pass and NO
 * output tree. Nested-container descent is the next push (it needs the
 * structural container serializer fused with live-frame leaf resolution).
 */
export function isSpineEligibleRoot(root: Rules, context: Context): boolean {
  if (context.currentCharset || context.topImports?.length) {
    return false;
  }
  if (root.options?.referenceMode === true) {
    return false;
  }
  const children = root.rules;
  // A variable RE-DECLARED in the same scope makes a value read source-order
  // sensitive (an earlier reader / a `snapshot` ref must see the earlier value,
  // not the last binding). The single upfront frame the spine pushes carries the
  // last-wins binding, so re-declaration is not yet spine-safe — exclude it.
  // (Source-order-threaded per-position binding is a later push.)
  let seenVarNames: Set<string> | undefined;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (!isSimpleSpineLeaf(child)) {
      return false;
    }
    if (isNode(child, N.VarDeclaration)) {
      const name = child.name;
      if (typeof name === 'string') {
        seenVarNames ??= new Set<string>();
        if (seenVarNames.has(name)) {
          return false;
        }
        seenVarNames.add(name);
      } else {
        // A non-static (interpolated) var name can collide unseen — exclude.
        return false;
      }
    }
  }
  return true;
}

/**
 * Render a spine-eligible root through the SINGLE downward pass. This REPLACES
 * `evalForRender`→`this.eval()`→`serialize(output)` for this shape: there is no
 * `eval` call and no materialized output tree. The root's own value-frame is
 * pushed (its `_scopeFrame` made live via `context.rulesContext`) and each leaf
 * is resolved+emitted in place. The returned string is the document body (the
 * root owns its trailing newline, matching `_toDocumentString`).
 */
export function renderRootViaSpine(
  root: Rules,
  context: Context,
  options: FinalPrintOptions
): MaybePromise<string> {
  spineRenderCounter.rootRenders++;
  // Value-frame push: make the root's scope frame live for the whole descent,
  // and point the document root/tree-root at the SOURCE root (what the eval pass
  // used to establish). No eval() is called — the descent below resolves each
  // leaf against this live frame in place.
  root.getScopeFrame();
  const savedRoot = context.root;
  const savedTreeRoot = context.treeRoot;
  context.root ??= root;
  if (root._treeContext) {
    context.treeRoot = root;
  }
  const finish = (body: string): string => {
    context.root = savedRoot;
    context.treeRoot = savedTreeRoot;
    const trimmed = body.trimEnd();
    return trimmed ? `${trimmed}\n` : '';
  };
  // Descend the SOURCE root's body ONCE in render mode: the statement-framing
  // machinery (separators, `;`, trivia, indentation) is the kept structural
  // serializer (design §7 "survives"); the value resolution happens against the
  // live frame threaded here. `toRenderString` runs `_emitRulesBody('render')`,
  // which for each leaf resolves via `node.render(context)` at its emit moment.
  const step = withValueFrame(context, root, () => root.toRenderString(options));
  return isThenable(step) ? step.then(finish) : finish(step);
}
