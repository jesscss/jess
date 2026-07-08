/**
 * emit-walk — the P1 frame-threading spine of the ONE eval-and-emit pass.
 *
 * ONE downward traversal of the SOURCE tree. There is no `eval()` that returns a
 * materialized output tree for a separate `serialize()` walk: at each node we
 * resolve-against-the-current-frame and write-to-buffer together. This module
 * owns the pass entry (`renderRootViaSpine`), the value-frame threading
 * (`withValueFrame`), the leaf/shared-body mechanism, and the static eligibility
 * predicate that scopes which SOURCE shapes the spine fully covers today.
 *
 * Two stacks are threaded for the whole pass:
 *   - the STRUCTURAL stack (ancestry / `composedSelectorStack`) — carried in
 *     `PrintOptions` and owned by the KEPT container serializer
 *     (`serializeRulesContainer`), which the spine reuses for header
 *     composition/collapse/hoist rather than re-implementing (design §7
 *     "survives"). In spine mode that serializer pushes the container's
 *     value-frame at enter and resolves its leaves live (see `PrintOptions.spineMode`).
 *   - the VALUE stack — the live `ScopeFrame` chain, threaded through
 *     `context.rulesContext`. Pushed on scope-enter and NOT popped until that
 *     scope's bytes are in the buffer, so a leaf resolves against the SAME frame
 *     eval would have used (the B1s fix).
 *
 * A leaf resolves `resolve(sourceLeaf, currentFrame)` → bytes at its emit
 * moment. Mixin / loop / $for / $if bodies are descended SHARED under a pushed
 * value-frame carrying per-placement bindings as live cells — never copied.
 *
 * @see docs/future/core-architecture/UNIFIED-EVAL-EMIT-DESIGN.md §2 (frame
 *   threading), §4/§4.4 (extend flush — P3), §7 (survives vs replaced).
 */

import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import type { Context } from '../../context.js';
import { Node } from '../node.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';
import { Nil } from '../nil.js';
import { Rules } from '../rules.js';
import { Ruleset } from '../ruleset.js';
import { buildScopeFrame, type BindingCell, type ScopeFrame } from '../scope-frame.js';
import { getPrintOptions, type FinalPrintOptions, type PrintOptions } from './print.js';

/**
 * Assign source-order indices to a scope's body children — the PER-POSITION
 * bookkeeping the value-frame threading needs (P1 §2, the eval-fold's core).
 *
 * A variable read resolves against the binding visible AT THE READER'S SOURCE
 * POSITION: a re-declared `@x` or a `snapshot` ref must see the value bound
 * BEFORE it, not the last-wins binding. The position-gated scope-frame lookup
 * (`lookupScopeFrameVariable`) enforces this by comparing each reader's `start`
 * (its `node.index`) against each declaration's `sourceNode.index` — but those
 * indices are assigned during EVAL/registration, which the spine skips. So the
 * spine assigns them here at scope-enter, replicating the registration counter
 * (one increment per non-`Comment` child). This is output-INVISIBLE bookkeeping
 * on the canonical node (§ruling 1) — it changes neither re-serialization nor
 * reuse; it only makes the source positions the lookup already keys on available.
 *
 * Idempotent: skips a body whose first indexable child already has an index (the
 * eval path, or a prior spine visit, already numbered it).
 */
export function assignSpineChildIndices(body: Rules): void {
  const children = body.rules;
  let indexed = 0;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (isNode(child, N.Comment)) {
      continue;
    }
    if (indexed === 0 && child.index !== undefined) {
      // Already numbered (eval path or prior spine visit) — leave it.
      return;
    }
    child.index = indexed;
    indexed++;
  }
}

/**
 * The value-frame push (scope-enter/scope-exit for the value stack).
 *
 * Contract: point `context.rulesContext` at `frameRules` (whose `_scopeFrame` is
 * the live lexical frame for its subtree), run `fn`, then restore the prior
 * `rulesContext` — always, even on throw.
 *
 * Load-bearing invariant: the pop (restore) happens AFTER the scope's bytes are
 * in the buffer, so every leaf reached during `fn` resolves against EXACTLY this
 * frame — the same one eval would have used (the B1s fix, design §2.3). A leaf
 * resolution must never run after its frame is popped.
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
 * Resolve one leaf against the live value-frame and write its bytes.
 *
 * Contract: eval `node` against `context` (whose `rulesContext` is the live
 * frame set by `withValueFrame`), then serialize the resolved node into
 * `options.writer` at the current emit position. Returns a promise iff eval is
 * async. No return value beyond the write side effect.
 *
 * Load-bearing invariant: the resolved node is TRANSIENT and LOCAL — serialized
 * then dropped, never staged into a persistent output tree (design §2.4). The
 * SOURCE node is the sourcemap origin; the frame must be live at call time (see
 * `withValueFrame`).
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
 * True if `selector` contains an ampersand with an APPEND value (`&-modifier`,
 * `&-primary`) — the anonymous-append form whose suffix is materialized (and
 * hoisted) ONLY by `Ampersand.evalNode`'s `appendValue` path, which depends on
 * eval-pass frame state the spine does not fully reproduce at ruleset-enter.
 * Plain `&` composition (`&.foo`, `& + &`, `&:hover`, bare `&`) IS spine-folded;
 * append is the excluded sub-shape. Walks the selector node tree (Ampersand
 * nodes carry `appendValue`).
 */
function selectorHasAmpersandAppend(selector: unknown): boolean {
  if (!selector || typeof selector === 'string') {
    return false;
  }
  if (Array.isArray(selector)) {
    return selector.some(item => selectorHasAmpersandAppend(item));
  }
  if (!(selector instanceof Node)) {
    return false;
  }
  const isAppendAmp = (n: Node): boolean => isNode(n, N.Ampersand) && n.appendValue !== undefined;
  if (isAppendAmp(selector)) {
    return true;
  }
  for (const descendant of selector.walk(true)) {
    if (isAppendAmp(descendant)) {
      return true;
    }
  }
  return false;
}

/**
 * A nested CONTAINER child THIS phase can descend through the spine: a plain
 * `Ruleset` with a non-Nil selector, no guard, a spine-eligible body, and a
 * selector whose composition the spine folds. Admitted: plain `&` composition
 * (`&.foo`, `& + &`, `&:hover`, bare `&`) + interpolation. Excluded (still eval
 * path, precise reasons): AMPERSAND-APPEND (`&-modifier` — the anonymous-append
 * materialize+hoist is eval-pass machinery, `selectorHasAmpersandAppend`),
 * extend-bearing/reference/guarded rulesets, at-rules routed to
 * `isSpineEligibleAtRule`, mixins.
 */
function isSpineEligibleContainer(node: Node): boolean {
  if (isNode(node, N.AtRule)) {
    return isSpineEligibleAtRule(node);
  }
  if (!isNode(node, N.Ruleset)) {
    return false;
  }
  const ruleset = node;
  if (ruleset.selector instanceof Nil || ruleset.selector == null) {
    return false;
  }
  if (ruleset.guard) {
    return false;
  }
  const options = ruleset.options as { referenceMode?: boolean; ownSelector?: unknown } | undefined;
  if (options?.referenceMode === true) {
    return false;
  }
  // Extend-bearing selectors stay on the eval path (extend is P3, not yet wired).
  if (Ruleset.hasExtendedTopLevelSelector(ruleset.selector)) {
    return false;
  }
  // Ampersand-APPEND (`&-modifier`) is not folded — its anonymous-append suffix
  // materializes + hoists only via `Ampersand.evalNode`'s appendValue path (eval
  // frame state the spine does not reproduce). Plain `&` composition + interp ARE
  // folded: `serializeSpineFrameContainer` resolves the selector against the live
  // stacks at ruleset-enter (`&` reads `context.rulesetFrames` via
  // `Ampersand.eval`; interpolation via `selector.eval`). The resolved form is
  // the header AND what extend sees (OQ-A).
  if (selectorHasAmpersandAppend(ruleset.selector)) {
    return false;
  }
  return isSpineEligibleBody(ruleset.rules);
}

/**
 * The conditional-group at-rules THIS phase folds through the spine: pure
 * "wrap + (maybe) hoist" containers with no extra eval-pass side effects on
 * their name or body binding.
 */
const SPINE_ELIGIBLE_AT_RULES = new Set(['@media', '@supports', '@container']);

/**
 * A nested AT-RULE child THIS phase can descend through the spine: a
 * conditional-group block at-rule (`@media`/`@supports`/`@container`) with a
 * string name (not interpolated — an interpolated at-rule NAME is not folded
 * yet) and a spine-eligible body. The prelude is resolved-at-enter by
 * `serializeSpineFrameAtRule`; `@media`→root hoisting and the root-only
 * composed-stack reset are the KEPT walk machinery (§7).
 *
 * EXCLUDED (still eval path, precise reasons): `@layer` — nested layer-NAME
 * registration (`@layer a.b`) is an eval-pass side effect the spine does not
 * replicate; `@scope` — special `(start)`/`(end)` prelude + scoped-body binding;
 * root-only at-rules (`@font-face`/`@keyframes`/…) and non-nestable forms.
 */
function isSpineEligibleAtRule(node: Node): boolean {
  if (!isNode(node, N.AtRule) || !isNode(node, N.Rules)) {
    return false;
  }
  const atRule = node;
  if (typeof atRule.name !== 'string') {
    return false;
  }
  const options = atRule.options as { referenceMode?: boolean } | undefined;
  if (options?.referenceMode === true) {
    return false;
  }
  if (!SPINE_ELIGIBLE_AT_RULES.has(atRule.name)) {
    return false;
  }
  return isSpineEligibleBody(atRule.rules);
}

/**
 * A body (ordered child list) is spine-eligible when every child is. Re-declared
 * variables ARE now admitted — `assignSpineChildIndices` numbers the children at
 * scope-enter so a re-declared / `snapshot` read resolves against the binding at
 * its own source position (the position-gated `lookupScopeFrameVariable`), not
 * last-wins. A non-static (interpolated) var NAME is still excluded (its bucket
 * key isn't statically known, so the position gate can't be pre-seeded).
 */
function isSpineEligibleBody(children: readonly Node[]): boolean {
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (isSimpleSpineLeaf(child)) {
      if (isNode(child, N.VarDeclaration) && typeof child.name !== 'string') {
        return false;
      }
      continue;
    }
    if (!isSpineEligibleContainer(child)) {
      return false;
    }
  }
  return true;
}

/**
 * A leaf THIS phase's spine can fully render in the single pass. Stricter than
 * `isValueLeaf`: excludes leaves whose correct output depends on the eval pass's
 * cross-statement handling that the spine does not yet perform —
 *   - `+:` / conditional / merge-flagged declarations (Less property-merge is a
 *     cross-declaration value combination built during eval registration),
 *   - `setDefined` / `nearestOuter` var-declarations (scope-mutating assigns),
 *   - any non-declaration leaf (Call/Apply/etc.) that can expand to statements.
 * Comments and plain declarations/var-declarations with default `:` assign are
 * safe: their bytes are a pure function of the live-frame value resolution.
 *
 * NOTE: `calc()`/`Operation`-valued declarations ARE admitted — their value is
 * resolved SYNC by default and only bails to async if a child genuinely produces
 * a thenable (see `resolveSpineLeafText` / the `isThenable` reactive-bail in the
 * container serializer). No async cost is paid for the common (sync) case.
 */
function isSimpleSpineLeaf(node: Node): boolean {
  if (isNode(node, N.Comment)) {
    return true;
  }
  if (isNode(node, N.Declaration)) {
    const options = node.options as { assign?: string; setDefined?: boolean; nearestOuter?: boolean } | undefined;
    const assign = options?.assign ?? ':';
    // Folded: `:` (plain) and the property-MERGE assigns (`+:`/`+_:`/`&,:`/`&_:`,
    // coalesced by `planBodyMerges`). Still excluded (a scoped frontier): the
    // conditional/scope-mutating assigns `?:` / `setDefined` (Sass `!global`) /
    // `nearestOuter` (Jess `:=`) — all three depend on eval/registration-time
    // binding-write semantics (conditional-bind-if-undefined; write a binding
    // cell in an OUTER scope) that the spine does not yet replicate in-descent.
    if (assign !== ':' && !MERGE_ASSIGNS.has(assign)) {
      return false;
    }
    if (options?.setDefined || options?.nearestOuter) {
      return false;
    }
    return true;
  }
  return false;
}

/** Property-merge assign operators the spine coalesces (see `planBodyMerges`). */
const MERGE_ASSIGNS = new Set(['+:', '+_:', '&,:', '&_:']);

/** True if any DIRECT child of `body` is a merge-flagged declaration. */
function bodyHasDirectMergeDecl(children: readonly Node[]): boolean {
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (isNode(child, N.Declaration) && !isNode(child, N.VarDeclaration)) {
      const assign = (child.options as { assign?: string } | undefined)?.assign;
      if (assign && MERGE_ASSIGNS.has(assign)) {
        return true;
      }
    }
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
 * Static eligibility: may this root render through the single pass?
 *
 * Contract: pure/side-effect-free predicate on the SOURCE tree (never evals).
 * True ⇒ `renderRootViaSpine` fully covers the tree (no eval pass, no output
 * tree); false ⇒ it routes to the eval path.
 *
 * Exact boundary — eligible when the whole body is spine-coverable
 * (`isSpineEligibleBody`): value leaves (comments + `:`- and merge-assign
 * declarations), nested `Ruleset`s (non-Nil, unguarded, no ampersand-append, no
 * extend/reference) with `&`/interpolated selectors resolved-at-enter, and
 * conditional-group at-rules; re-declared vars + `snapshot` reads resolve
 * per-position. Excluded (still eval path — a scoped frontier, NOT a safety
 * fallback): charset/import document framing, reference mode, conditional (`?:`)/
 * `setDefined` declarations, ampersand-append, `@layer`/`@scope`, guarded/extend/
 * mixin/reference containers, interpolated var/at-rule NAMES.
 *
 * ROOT-LEVEL merge guard: a `+:`/`+_:` declaration DIRECTLY in the root body (not
 * inside a ruleset) is excluded — property-merge coalescing is applied on the
 * CONTAINER descent path (`withSpineMergePlan`), which the flat root-body path
 * (`toRenderString`) does not run. Root-level property merges are unusual
 * (properties belong in rulesets); a real one routes to the eval path.
 */
export function isSpineEligibleRoot(root: Rules, context: Context): boolean {
  if (context.currentCharset || context.topImports?.length) {
    return false;
  }
  if (root.options?.referenceMode === true) {
    return false;
  }
  if (bodyHasDirectMergeDecl(root.rules)) {
    return false;
  }
  return isSpineEligibleBody(root.rules);
}

/**
 * Render a spine-eligible root through the SINGLE downward pass — the pass entry.
 *
 * Contract: caller has confirmed `isSpineEligibleRoot`. Sets `options.spineMode`,
 * pushes the root's value-frame, descends the source tree once (leaves + nested
 * rulesets), and returns the document body string (root owns its trailing
 * newline, matching `_toDocumentString`). Restores `context.root`/`treeRoot` on
 * exit.
 *
 * Load-bearing invariant: REPLACES `evalForRender`→`this.eval()`→
 * `serialize(output)` — there is NO `eval` call and NO materialized output tree
 * on this path (ratchet-locked: `spineRenderCounter` moves, `Rules.eval`/
 * `Rules.derive` not called). Nested containers reuse the KEPT structural
 * serializer (`serializeRulesContainer`) in `spineMode`, which pushes each
 * container's frame and resolves its leaves live.
 */
export function renderRootViaSpine(
  root: Rules,
  context: Context,
  options: FinalPrintOptions
): MaybePromise<string> {
  spineRenderCounter.rootRenders++;
  // Mark the whole descent spine mode: nested containers render via the
  // structural serializer against a live frame (no eval, no output tree) and
  // leaves resolve live — see serialize-helper `spineMode` + Ruleset.render.
  options.spineMode = true;
  // Per-position bookkeeping: number the body children BEFORE building the scope
  // frame, so the frame's declaration buckets carry source indices and a
  // re-declared / `snapshot` read resolves against the binding at its position.
  assignSpineChildIndices(root);
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
