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
import { Node, F_STATIC } from '../node.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';
import { comparePosition } from './compare.js';
import { Nil } from '../nil.js';
import { Rules } from '../rules.js';
import { Ruleset } from '../ruleset.js';
import type { AtRule } from '../at-rule.js';
import type { AtRuleStatement } from '../at-rule-statement.js';
import type { VarDeclaration } from '../declaration-var.js';
import { buildScopeFrame, linkImportFallbackFrame, type BindingCell, type ScopeFrame } from '../scope-frame.js';
import { getPrintOptions, OutputWriter, type FinalPrintOptions, type PrintOptions } from './print.js';
import { engageExtendLayer, isSpineExtendTopology, wireSpineExtends, flatLocalSelector, treeHasExtendTargetableAppend } from '../extend/spine-extend.js';
import type { StyleImport, SpineImportResolution } from '../import-style.js';

/**
 * `.type`-discriminant guards — narrow a base `Node` to a leaf class WITHOUT a
 * runtime (value) import of that class. A value import of `import-style.ts` /
 * `at-rule-statement.ts` here would pull those modules into this file's eager
 * init graph and reintroduce the `Rules`-not-yet-defined load cycle. Mirrors
 * `rules.ts`'s `isStyleImportRegistrationNode`.
 */
function isStyleImportNode(node: Node): node is StyleImport {
  return node.type === 'StyleImport';
}

/**
 * True if `error` is a StyleImport PATH-RESOLUTION failure (`_isPathResolutionError`, set by
 * `StyleImport._preparePathIdentity` when an interpolated import path's var is not yet bound). Import-
 * spec routing uses this to distinguish a FORWARD-dependent interpolated path (case B — abort to the
 * eval retry lane) from a genuine failure (missing file / parse error — propagate). Mirrors the eval
 * loop's `isStyleImportPathResolutionError`.
 */
function isSpinePathResolutionError(error: unknown): boolean {
  return error instanceof Error
    && '_isPathResolutionError' in error
    && (error as Error & Record<'_isPathResolutionError', unknown>)._isPathResolutionError === true;
}

/**
 * Marker property on an error the wire pass throws when a DEFERRED (forward-dependent, case-B)
 * interpolated-path import resolves to a body it cannot fold byte-identically — specifically a body
 * carrying an `(inline)` sub-import. Eval's deferred-import RETRY lane (`drainPendingImports`) emits an
 * extra blank line AFTER a re-evaluated inline block; the clean spine fold does not reproduce that
 * reorder-specific spacing artifact. Routing this shape to eval keeps it byte-identical. `onWireError`
 * aborts to eval on this marker exactly as it does for a still-unresolvable path.
 */
const SPINE_DEFERRED_UNSUPPORTED = '_isSpineDeferredUnsupported';
function markDeferredUnsupported(): Error {
  const error = new Error('spine: deferred interpolated-path import body is not foldable byte-identically (inline sub-import)');
  (error as Error & Record<string, unknown>)[SPINE_DEFERRED_UNSUPPORTED] = true;
  return error;
}
function isSpineDeferredUnsupportedError(error: unknown): boolean {
  return error instanceof Error
    && SPINE_DEFERRED_UNSUPPORTED in error
    && (error as Error & Record<string, unknown>)[SPINE_DEFERRED_UNSUPPORTED] === true;
}

/**
 * True if `body`'s DIRECT children include an `(inline)` `@import` — the shape a deferred (case-B)
 * interpolated-path import cannot fold byte-identically (eval's retry lane adds a post-inline blank
 * line the spine fold does not). Direct-child scan only: a nested container's inline import is emitted
 * under that container's own serialization (not the reorder-affected root inline path).
 */
function deferredBodyHasInlineImport(body: Rules): boolean {
  for (const child of body.rules) {
    if (isStyleImportNode(child)) {
      const io = 'importOptions' in child.options ? child.options.importOptions : undefined;
      if (io?.inline === true) {
        return true;
      }
    }
  }
  return false;
}

function isAtRuleStatementNode(node: Node): node is AtRuleStatement {
  return node.type === 'AtRuleStatement';
}

/**
 * IMPORT-WORK GATE (design §4.0, IMPORTS increment 1). True iff the tree carries
 * ANY `StyleImport` — the eval-free signal that the pass must engage import
 * machinery. When false the spine never touches `queueTopImport`, `getTree`, or
 * placement wiring: a no-import render pays ZERO import cost (the ratchet floor).
 * Mirrors `engageExtendLayer`: a single static tree scan, no side effects.
 */
export function engageImportLayer(root: Node): boolean {
  for (const node of root.walk(true)) {
    if (node.type === 'StyleImport' || isSpineFoldableCssImportStatement(node)) {
      return true;
    }
  }
  return false;
}

/**
 * A leaf CSS `@import` at-rule statement the spine emits inline (CSS-passthrough,
 * IMPORTS increment 1). A statically-`.css`/remote `@import` parses DIRECTLY as an
 * `AtRuleStatement` (not a `StyleImport`) — no scope effect, no eval side effect;
 * it serializes its own bytes at its document position (already the top, since it
 * is authored first). Admitting it as a spine leaf unblocks a MIXED file (CSS
 * import + rulesets) whose imports would otherwise force the whole root to eval.
 * A NON-static (interpolated) prelude is deferred — its `@{…}` needs prelude eval
 * (the interpolated-import lane, a REQUIRED P4 item).
 */
export function isSpineFoldableCssImportStatement(node: Node): boolean {
  if (!isAtRuleStatementNode(node)) {
    return false;
  }
  const name = typeof node.name === 'string' ? node.name : node.name.valueOf();
  if (name !== '@import') {
    return false;
  }
  // The prelude must be static (a plain quoted/url specifier, maybe with a static
  // media/supports postlude) — no interpolation to resolve against a frame.
  const prelude = node.prelude;
  if (prelude === undefined) {
    return true;
  }
  return prelude instanceof Node && prelude.hasFlag(F_STATIC);
}

/**
 * A bodyless STATEMENT at-rule the spine emits INLINE at its authored position —
 * the `@layer name, name;` / `@layer name;` (bodyless layer-order declaration) and
 * `@namespace`-style passthrough shapes. Parsed as an `AtRuleStatement` (no `Rules`
 * body); its bytes serialize verbatim at their source position (no hoist, unlike
 * `@import`, which reorders to the top-of-doc emitter). No scope effect, no eval
 * side effect — a pure token statement, admitted only when its NAME is a static
 * string and its prelude is absent or a static Node (an interpolated prelude needs
 * frame eval and is deferred). `@import` is EXCLUDED here (it hoists via
 * `isSpineFoldableCssImportStatement` + `queueTopImport`); `@charset` never reaches
 * this shape (it parses to a role-`charset` `Any`, gated by `isSpineEligibleRoot`).
 */
export function isSpineFoldableStatementAtRule(node: Node): boolean {
  if (!isAtRuleStatementNode(node)) {
    return false;
  }
  if (typeof node.name !== 'string') {
    return false;
  }
  if (node.name === '@import' || node.name === '@-import' || node.name === '@-export') {
    return false;
  }
  const prelude = node.prelude;
  if (prelude === undefined) {
    return true;
  }
  return prelude instanceof Node && prelude.hasFlag(F_STATIC);
}

/**
 * STATIC spine-fold admissibility for a `StyleImport` child (IMPORTS increment 1).
 * Delegates the whole shape decision to `StyleImport.isSpineFoldableStyleImport`
 * (owned by `import-style.ts`, where the import options live) — CSS-passthrough OR
 * a plain static-path Less `@import`. A non-foldable import (reference / inline /
 * interpolated-path / multiple / optional / postlude / with / compose — each a
 * REQUIRED P4 item) keeps its enclosing body OFF the spine.
 */
export function isSpineFoldableImport(node: Node): boolean {
  return isStyleImportNode(node) && node.isSpineFoldableStyleImport();
}

/**
 * RUNTIME body-simplicity gate for a resolved Less-import body (IMPORTS increment
 * 1). Reuses the same eligibility the whole spine turns on (`isSpineEligibleBody`
 * with `allowImport`, so a nested foldable import in the imported file also folds).
 * A `false` routes that import to the byte-identical eval fall-back
 * (`resolveSpineStyleImport` → `evalNode`) — the imported body carries a shape the
 * spine does not yet descend (e.g. a mixin call, guarded ruleset, reference-mode).
 */
export function isSpineFoldableImportBody(body: Rules, allowExtend = false): boolean {
  // EXTEND-THROUGH-IMPORT (plain, non-`(reference)` imports). When the document-wide spine
  // extend gather is engaged (`allowExtend`), an imported body carrying `:extend` still folds
  // INLINE: the extends were gathered by `wireSpineExtends` (which descends the same body node
  // instances) and their subject headers installed on `options.spineExtendHeaders`. Folding the
  // body inline (rather than the `evalNode` fall-back, which produces FRESH nodes the override
  // map cannot key on) is what lets the imported subject ruleset pick up its composed header via
  // `effectiveHeaderSelector`. The whole tree is gated to eval by the extend re-gate
  // (`isSpineExtendTopology` with `importedRootSubjects`) unless the imported extend shape folds,
  // so reaching here with `allowExtend` means the gather already accounted for every imported
  // extend. The imported `Extend`/`ExtendList` body children are invisible-output effect nodes.
  return isSpineEligibleBody(body.rules, allowExtend, true);
}

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
 * The inner `Call` of a detached-ruleset call (`@alias()` / `@1()`), which the
 * Less parser shapes as an `Expression` wrapping a single `Call` whose name is a
 * `variable`-type `Reference`. Returns the wrapped `Call` for that shape, else
 * `undefined`. A plain (non-wrapped) `Call` is NOT unwrapped here — the caller
 * handles it directly.
 */
export function unwrapDetachedRulesetCall(node: Node): Node | undefined {
  if (!isNode(node, N.Expression)) {
    return undefined;
  }
  const inner = node.value;
  if (!isNode(inner, N.Call)) {
    return undefined;
  }
  const name = inner.name;
  if (!isNode(name, N.Reference) || name.options?.type !== 'variable') {
    return undefined;
  }
  return inner;
}

/**
 * True for a plain no-arg mixin CALL the spine may attempt to fold (cutover
 * P3-precursor, UNIFIED-EVAL-EMIT-DESIGN §2/§3). STATIC admissibility only — the
 * candidate's body shape is checked at RUNTIME by `isSpineSimpleMixinSurface`
 * against the resolved bound surface (the definition is not statically bound at
 * the call site). Admitted: a `Call` whose name is a mixin `Reference`, with NO
 * args, NO content block, and none of the legacy `markImportant`/`silentFail`
 * options. This is INCREMENT 1's shape — parametric/guarded/named/rest calls
 * widen this gate in later increments. A detached-ruleset call (`@alias()`) is an
 * `Expression`-wrapped `variable`-Reference `Call` (RUNG-1) — unwrapped and gated
 * via `unwrapDetachedRulesetCall`.
 */
export function isSpineEligibleMixinCall(node: Node): boolean {
  // RUNG-1: a detached-ruleset call `@alias()` parses as an `Expression` wrapping a
  // single `variable`-Reference `Call`. Unwrap it and gate the inner `Call` — its
  // resolution (`resolveSpineMixinCall` drives `expr.eval` → the wrapped `Call.eval`)
  // routes the resolved detached-ruleset / bound-call surface through the SAME
  // callable-candidate sink as an authored mixin call.
  const unwrapped = unwrapDetachedRulesetCall(node);
  if (unwrapped !== undefined) {
    return isSpineEligibleMixinCall(unwrapped);
  }
  if (!isNode(node, N.Call)) {
    return false;
  }
  // INCREMENT 3/5: POSITIONAL (`.m(red, 10px)`) and NAMED (`.m(@c: red)`) args
  // admitted. `matchCallableParams` binds both — positional by index, named by
  // matching a `VarDeclaration` arg to a same-named param — into the surface's
  // param live-cells, which the frame-threaded descent (increment 2) resolves.
  // DEFERRED: a detached-ruleset / content-block arg (needs the block bound as a
  // callable-body value — a later rung).
  if (node.args) {
    for (let i = 0; i < node.args.value.length; i++) {
      const arg = node.args.value[i]!;
      if (isNode(arg, N.Rules | N.Ruleset | N.AtRule | N.Mixin)) {
        return false; // detached-ruleset / block arg — deferred
      }
    }
  }
  if (node.contentNode) {
    return false;
  }
  // INCREMENT 8 (fold #4): a `!important` mixin call (`markImportant`) is admitted —
  // `resolveSpineMixinCall` applies the KEPT `Call.makeImportant` to each captured
  // surface (deriving every folded declaration with the `!important` flag), byte-
  // identical to the eval path. `silentFail` (`.m() ?`, suppress "no matching mixins")
  // is still DEFERRED — its no-match suppression is an eval-terminal behavior the
  // fold does not yet reproduce.
  const options = node.options as { markImportant?: boolean; silentFail?: boolean } | undefined;
  if (options?.silentFail) {
    return false;
  }
  const name = node.name;
  // INCREMENT 2: a mixin-name reference with a STRING key — both `type: 'mixin'`
  // (Jess `$.mixin()`) and `type: 'mixin-ruleset'` (the Less `.mixin()` dot-call,
  // which matches a mixin OR a same-named ruleset-as-mixin). The frame-threaded
  // descent (`entry.spineFrame`) resolves each bound surface against its DEFINITION
  // scope, so closure-capturing bodies fold correctly; the runtime gate
  // (`isSpineSimpleMixinSurface`) + eval fall-back handle whichever the string key
  // resolves to and defer non-simple shapes. EXCLUDED: a non-string (SelectorCapture)
  // key (`*[.foo]()`) — the capture lookup path, deferred.
  if (!isNode(name, N.Reference)) {
    return false;
  }
  const type = name.options?.type;
  // RUNG-1 (detached-ruleset call): a `Call` whose name is a `variable`-type
  // Reference (`@alias()` / `@1()` / `@conditional()`) is a detached-ruleset call —
  // the variable resolves to a detached ruleset (`@r: { … }`), a detached collection,
  // or a bound mixin-call expression (`@alias: .something(foo)`). It is ADMITTED here
  // and driven through the SAME `resolveSpineMixinCall` sink: `call.eval` resolves the
  // reference then routes the resolved surface through the callable-candidate sink
  // (`callable-special-case.ts` — the "detached ruleset called from a variable" arm)
  // or, for a bound-call value, re-evals the inner `.something(foo)` (itself a
  // mixin-ruleset call that hits the sink). A non-simple resolved body falls back to
  // the byte-identical eval terminal (`kind:'eval'`). The mixin-as-value fold
  // (`528d465fc`) left this call itself eval-routed; this closes that residual.
  if (type !== 'mixin' && type !== 'mixin-ruleset' && type !== 'variable') {
    return false;
  }
  // A `mixin`/`mixin-ruleset` name carries a STRING key; a `variable`-Reference
  // DR-call key is a `Keyword` node (an `Any` subclass whose `valueOf()` is the var
  // name). Both static forms are fine — resolution is by `call.eval`, not the key
  // text — but a NON-string, non-Keyword key (a SelectorCapture `*[.foo]()`) stays
  // deferred.
  const keyIsKeyword = name.key instanceof Node && name.key.type === 'Keyword';
  if (typeof name.key !== 'string' && !(type === 'variable' && keyIsKeyword)) {
    return false;
  }
  // NAMESPACE-PATH / cross-scope call (`.scope > .mixin()`, `#ns.m()`, `#a > #b >
  // .m()`) is ADMITTED. `name.target` names an enclosing namespace; the KEPT
  // resolution machinery (`prepareCallableCandidateState`) derives the matched
  // callable's DEFINITION-scope frame from the candidate node's own `.parent`
  // chain (`definitionFrame = definitionParent.getScopeFrame()`) — a lazily-built,
  // eval-free static index — so the closure body resolves against its definition
  // scope regardless of descent order. The `.parent` chain is wired at pass entry
  // (`wireSpineDefinitionScopeParents`) so it exists even for a scope the spine does
  // not descend. Verified byte-identical for namespace-path, multi-level namespace,
  // root/param closures, AND (fold #6) a nested mixin closing over an INTERMEDIATE
  // (non-root) scope's local var/param — no shape is gated here.
  return true;
}

/**
 * A BARE STATEMENT-POSITION built-in FUNCTION call (`if((false), {g: 7});`) — a
 * `Call` whose name is a `function`-type `Reference` (NOT a mixin / mixin-ruleset /
 * `variable` DR-call, which `isSpineEligibleMixinCall` already folds), with no
 * content block. Such a call is EVALUATED at its statement position and its result
 * serialized inline (the `functions` fixture's `if((false), {g: 7})` — condition
 * false with no else branch — resolves to a VOID `Anonymous` that serializes to the
 * empty string, emitting nothing, exactly as the eval path's call-lane +
 * `applyResult(undefined)` does). A value-returning statement call (`lighten(...)`)
 * likewise reproduces the eval path (its value text is emitted as its own line) —
 * both are driven by the same `node.eval` + serialize at emit (`resolveSpineStatement
 * CallText`), so the fold is byte-identical to eval by construction.
 *
 * Zero-cost off the shape: the `Call` type check bails immediately for a declaration
 * / comment / container leaf (the common case), and the reference-type check bails
 * for the far more common mixin / DR call (handled by `isSpineEligibleMixinCall`).
 */
export function isSpineFoldableStatementCall(node: Node): boolean {
  if (!isNode(node, N.Call)) {
    return false;
  }
  if (node.contentNode) {
    return false;
  }
  const name = node.name;
  if (!isNode(name, N.Reference)) {
    return false;
  }
  return name.options?.type === 'function';
}

/**
 * RUNTIME simplicity gate: a resolved bound surface the spine can descend inline.
 * A `false` makes the callable terminal fall back to the eval path for that
 * candidate (byte-identical). A `false` from ANY candidate routes the whole call
 * to eval-fallback (`resolveSpineMixinCall`).
 *
 * INCREMENT 2 (frame-threaded descent): a body reference resolves against the
 * mixin's DEFINITION scope — increment 2 descends each surface with
 * `context.rulesContext` pushed to the surface (its wired lexical/closure/param
 * frame). Leaf children (`:`/merge declarations + comments — `isSimpleSpineLeaf`)
 * and a further mixin CALL (FOLD C) are admitted.
 *
 * NESTED-CONTAINER MIXIN BODY (this fold): a nested Ruleset/AtRule child is ADMITTED
 * when it is `isSpineEligibleContainer` — the SAME predicate authored containers use.
 * The captured surface's children are spliced with `spineFrame = surface`
 * (`runSpineMixinExpansion`), so a container child descends via
 * `serializeSpineFrameContainer` with its `enclosingFrame` = the surface frame; its
 * body then resolves the mixin's params (`@a` at arbitrary container depth) and runs
 * its OWN `runSpineMixinExpansion`, so a mixin call INSIDE the nested container
 * (`.inner { .mi((@a*2)) }`) expands in-pass against the surface frame — no re-descent,
 * no frame loss. A hoisting at-rule child (`@media`/`@supports`/… with a direct decl
 * or a bare-`&`/`&:hover` child) ALSO folds: it is spliced at the call site, so
 * `getHoistedParent` recovers the CALL-SITE ruleset from `context.rulesetFrames` and
 * re-wraps it on hoist (the mixin-surface analogue of the authored at-rule-&-through-
 * hoist fold); `serializeSpineFrameAtRule` per-call re-points its memoized scope frame
 * so a param-dependent at-rule body/prelude re-resolves per call (no cross-call leak).
 * DEFERRED (fall back, byte-identical): a nested container that is not spine-eligible
 * (guarded / extend-bearing / append sub-shape), parametric/guarded defs (gated
 * earlier). A nested Mixin DEFINITION stays gated at the tree level
 * (`treeHasUnfoldableContainerBodyMixin`); recursion — including the STRIPE
 * nested-container cycle — folds (distinct-per-level surfaces, `distinctFoldChild`).
 */
function isSpineSimpleMixinSurface(surface: Rules): boolean {
  const children = surface.rules;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    // A further mixin CALL inside the body IS admitted (FOLD C): the re-entrant
    // splice (`runSpineMixinExpansion` re-scans spliced children) expands it in turn,
    // and `callMap` terminates genuine recursion. A call is not an `isSimpleSpineLeaf`,
    // so admit it explicitly before the leaf check rejects it.
    if (isSpineEligibleMixinCall(child)) {
      continue;
    }
    // A nested CONTAINER the spine can descend (same predicate authored containers
    // use). The spliced surface-child container descends via
    // `serializeSpineFrameContainer` carrying the surface frame, so its body resolves
    // params + expands its own nested calls in-pass (see the doc block above).
    if (isNode(child, N.Ruleset | N.AtRule | N.Rules) && isSpineEligibleContainer(child)) {
      continue;
    }
    if (!isSimpleSpineLeaf(child)) {
      return false;
    }
    // A `setDefined` (Sass !global) inside a MIXIN body always writes an OUTER
    // (caller / global) binding — a cross-scope write the spine setDefined fold
    // does NOT cover (`spine-setdefined.ts` folds only a SAME-frame target). The
    // per-body coverage check (`bodyHasPriorSameNameDecl`) lives in
    // `isSpineEligibleBody`, not this surface gate, so exclude a mixin-surface
    // `setDefined` explicitly — route the call to the byte-identical eval fallback.
    if (isNode(child, N.VarDeclaration) && child.options?.setDefined) {
      return false;
    }
    // A Declaration with an INTERPOLATED (non-string) NAME (`prop-@{name}: …`) does
    // not resolve its name against the surface frame during the fold descent — the
    // interpolation emits raw (`prop-$name`). Route such a body to the eval fall-back
    // (byte-identical) until per-placement interpolated-decl-name resolution folds
    // into the surface descent. A VarDeclaration with an interpolated name is already
    // excluded at the body gate; this covers a plain Declaration in a mixin body.
    if (isNode(child, N.Declaration) && !isNode(child, N.VarDeclaration) && typeof child.name !== 'string') {
      return false;
    }
  }
  return true;
}

/**
 * The result of driving a spine-eligible mixin CALL's resolution:
 *   - `{ kind: 'fold', surfaces }` — EVERY guard-passed candidate was spine-simple;
 *     descend the bound surfaces inline (no output tree).
 *   - `{ kind: 'eval', output }` — at least one candidate was NOT spine-simple, so
 *     the KEPT terminal eval-materialized the call to an output `Rules`; the caller
 *     splices that (flattened) output like the eval path (byte-identical fallback).
 *     The eval terminal dies in P4; until then it's the eligibility-gated frontier.
 */
export type SpineMixinCallResolution =
  | { kind: 'fold'; surfaces: Rules[] }
  | { kind: 'eval'; output: Node };

/**
 * Drive a spine-eligible mixin CALL's resolution ONCE, folding to bound surfaces
 * when spine-simple and falling back to the eval terminal otherwise (cutover,
 * UNIFIED-EVAL-EMIT-DESIGN §2/§3).
 *
 * Contract: `call` has passed `isSpineEligibleMixinCall`. Installs
 * `context.spineMixinSurfaceSink` (scoped save/restore), then drives the call's
 * own `eval` so ALL the KEPT machinery runs exactly once — candidate match, arg
 * binding (none for increment 1), guard eval, recursion guard (`callMap`), caller
 * frame. Per guard-passed candidate the terminal consults the sink:
 *   - spine-simple surface → sink CAPTURES it and returns `true` (terminal skips
 *     the `rules.eval()` output-tree build for that candidate);
 *   - non-simple surface → sink returns `false`, `anyRejected` is set, and the
 *     terminal eval-materializes that candidate the normal way.
 * If ANY candidate was rejected the whole call is treated as eval-fallback and the
 * `call.eval()` return (the output `Rules`) is used; otherwise the captured
 * surfaces are folded. Exactly ONE drive either way — no double execution.
 */
export function resolveSpineMixinCall(
  entry: Node,
  context: Context
): MaybePromise<SpineMixinCallResolution> {
  // RUNG-1: a detached-ruleset call arrives as an `Expression` wrapping the real
  // `Call` — drive the wrapped `Call` so the `!important`/eval logic below sees the
  // Call directly. `Expression.eval` delegates to its value's eval, so driving the
  // inner `Call` is identical output with the important flag on the right node.
  const call = unwrapDetachedRulesetCall(entry) ?? entry;
  const captured: Array<{ surface: Rules; source: Rules; isMixin: boolean }> = [];
  let anyRejected = false;
  const savedSink = context.spineMixinSurfaceSink;
  context.spineMixinSurfaceSink = (
    boundSurface: Rules,
    sourceRules: Rules,
    candidateIsMixin: boolean
  ): boolean => {
    // Fold a spine-simple candidate — BOTH a Mixin-DEFINITION body (emits ONLY at
    // the call site) AND a ruleset-as-mixin (`!candidateIsMixin` — the `.foo()`
    // dot-call matching a same-named `.foo {}` ruleset; its body folds at the call
    // site AND the ruleset ALSO streams standalone at its own source position, left
    // in place by the descent). A NON-simple body DEFERS: reject → the terminal
    // eval-materializes that candidate and `anyRejected` routes the whole call to the
    // eval fallback. FOLD A (P4 terminal/sink): the ruleset arm now routes through the
    // sink too (`callable-special-case.ts`), so `!candidateIsMixin` is captured (with
    // the `isMixin` tag for `finish`), NOT rejected — this fixes mixin #3/#5.
    if (!isSpineSimpleMixinSurface(boundSurface)) {
      anyRejected = true;
      return false;
    }
    // Number the surface's body children so a position-gated read inside the
    // mixin body (a re-declared var / `snapshot`) resolves against the binding at
    // its own position, not last-wins (the per-position discipline, §2 — same as
    // `serializeSpineFrameContainer` does for a ruleset body).
    assignSpineChildIndices(boundSurface);
    // Capture the source (the definition body/Mixin) for DOCUMENT-ORDER sorting
    // below — when a call matches MULTIPLE candidates (a guarded + unguarded
    // overload of the same name), their contributions must emit in source order,
    // NOT candidate-loop order (which `hasDefault`/guard sorting may reorder).
    captured.push({ surface: boundSurface, source: sourceRules, isMixin: candidateIsMixin });
    return true;
  };
  const restore = <T>(value: T): T => {
    context.spineMixinSurfaceSink = savedSink;
    return value;
  };
  // FOLD only when EVERY matched candidate was captured by the sink (none rejected)
  // AND at least one surface was captured. Since FOLD A both the Mixin-definition and
  // the (unguarded) ruleset-as-mixin arms route through the sink, a captured set may
  // mix both kinds — the document-order sort below assembles their call-site
  // contributions exactly as the eval path's `compareCallableOutputPosition`. If
  // `captured` is empty the call resolved entirely via paths the sink never saw (e.g.
  // a GUARDED ruleset-as-mixin still handled by the special-case eval arm) — use the
  // eval output; `anyRejected` (a non-simple body) likewise routes to eval.
  const finish = (output: Node): SpineMixinCallResolution => {
    if (anyRejected || captured.length === 0) {
      return { kind: 'eval', output };
    }
    // Sort captured surfaces by their source DOCUMENT ORDER (mirrors the eval
    // path's `compareCallableOutputPosition`): same parent → by `index`, else
    // `comparePosition`. So a call matching several overloads (guarded + unguarded)
    // emits their bodies in source order, matching the eval path byte-for-byte.
    const ordered = captured.slice().sort((a, b) => {
      if (a.source.parent === b.source.parent
        && a.source.index !== undefined
        && b.source.index !== undefined) {
        return a.source.index - b.source.index;
      }
      return comparePosition(a.source, b.source);
    });
    const surfaces = ordered.map(entry => entry.surface);
    // `!important` on the call (fold #4): apply the KEPT `Call.makeImportant` to each
    // folded surface — it derives every declaration (recursing into nested Rules)
    // with the `!important` flag, exactly as the eval path's post-resolution transform
    // (`call.ts` `makeImportant(evald)`). Byte-identical; only runs when the call is
    // marked important (the common case pays nothing).
    if (isNode(call, N.Call) && call.options?.markImportant) {
      for (let i = 0; i < surfaces.length; i++) {
        call.makeImportant(surfaces[i]!);
      }
    }
    return { kind: 'fold', surfaces };
  };
  try {
    // Drive the call's own resolution: the caller frame + candidate match + arg
    // binding + guard + recursion guard all run through the KEPT `evalNode`
    // pipeline; the installed sink diverts a spine-simple candidate to capture
    // instead of building an output tree.
    const result = call.eval(context);
    return isThenable(result)
      ? result.then(
          (output: Node) => restore(finish(output)),
          (error: unknown) => {
            restore(undefined);
            throw error;
          }
        )
      : restore(finish(result));
  } catch (error) {
    restore(undefined);
    throw error;
  }
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
 * True if any direct child of `children` is a `Ruleset` whose selector carries an
 * ampersand-APPEND (`&-modifier`). Used to defer the SELECTOR-LIST-parent + append
 * shape (`.a, .b { &-x {…} }`), which the eval pass renders unusually (see
 * `isSpineEligibleContainer`).
 */
function bodyHasAppendChild(children: readonly Node[]): boolean {
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (isNode(child, N.Ruleset) && selectorHasAmpersandAppend((child as Ruleset).selector)) {
      return true;
    }
  }
  return false;
}

/**
 * A nested CONTAINER child THIS phase can descend through the spine: a plain
 * `Ruleset` with a non-Nil selector, a spine-eligible body, and a selector whose
 * composition the spine folds. Admitted: plain `&` composition (`&.foo`, `& + &`,
 * `&:hover`, bare `&`) + interpolation, and (guard-fold) a `when`-GUARDED ruleset
 * whose guard is a `Condition`/Node — its guard is evaluated at descent
 * (`serializeSpineFrameContainer`) against the live enclosing frame exactly as the
 * eval path's `Ruleset.evalNode` does (`evaluateBoolean` / `resultPasses`); a
 * failing guard emits nothing, a passing one descends the body. Excluded (still
 * eval path, precise reasons): AMPERSAND-APPEND (`&-modifier` — the anonymous-append
 * materialize+hoist is eval-pass machinery, `selectorHasAmpersandAppend`),
 * extend-bearing/reference rulesets, a not-yet-materialized STRING guard, at-rules
 * routed to `isSpineEligibleAtRule`, mixins.
 */
function isSpineEligibleContainer(node: Node, allowExtend = false, allowImport = false): boolean {
  if (isNode(node, N.AtRule)) {
    return isSpineEligibleAtRule(node, allowImport, allowExtend);
  }
  if (!isNode(node, N.Ruleset)) {
    return false;
  }
  const ruleset = node;
  if (ruleset.selector instanceof Nil || ruleset.selector == null) {
    return false;
  }
  // GUARD-FOLD: a `when`-guarded ruleset is admitted when its guard is a `Condition`
  // (or another evaluatable Node) — `serializeSpineFrameContainer` evaluates it at
  // descent, byte-identical to `Ruleset.evalNode`'s definition-time guard eval. A
  // STRING guard (pre-materialization form) is not statically evaluatable here, so it
  // stays on the eval path (that path materializes it first). Zero-cost when
  // `ruleset.guard` is unset (the common case bails on the first `&&`).
  if (ruleset.guard && typeof ruleset.guard === 'string') {
    return false;
  }
  const options = ruleset.options as { referenceMode?: boolean; ownSelector?: unknown } | undefined;
  if (options?.referenceMode === true) {
    return false;
  }
  // Extend-bearing selectors stay on the eval path UNLESS the FLAT extend topology is
  // engaged (P3 increment 1): a root-direct-child extender's `:extend` is gathered by the
  // pre-scan and its subject header composed as an override. `allowExtend` is threaded ONLY
  // for the flat root case (`isSpineExtendTopology` guarantees no NESTED extend), so a nested
  // extend still falls to the eval path.
  if (!allowExtend && Ruleset.hasExtendedTopLevelSelector(ruleset.selector)) {
    return false;
  }
  // Ampersand-APPEND (`&-modifier` → `.a-modifier`) FOLDS through the spine: its
  // suffix is materialized by `Ampersand.evalNode`'s append path (which the spine
  // already invokes via `serializeSpineFrameContainer`'s selector eval against the
  // live `rulesetFrames`), the resolved hoist-marked selector drives block placement
  // through `Ruleset.isHoisted` (reading `options.spineSelector.hoistToRoot`), and a
  // nested append composes against the RESOLVED parent via
  // `context.spineResolvedFrameSelector`. Two append SUB-shapes stay on the eval path
  // (precise deferrals, byte-identical, ratchet-locked — REQUIRED P4 items, not a
  // safety fallback):
  //   (1) an append ruleset with a NESTED-CONTAINER child (`&-x { .inner {…} }`): the
  //       hoisted append frame is split from its nested child's frame in expanded mode
  //       (the child re-wraps under the raw `&-x` instead of the resolved `.a-x`).
  //   (2) an append child under a SELECTOR-LIST parent (`.a, .b { &-x {…} }`): the eval
  //       pass itself renders this unusually (`.a, .b { color }` collapse / a raw
  //       `&(-x)` expanded — append against a list is under-specified upstream), so the
  //       spine defers to it rather than reproduce a not-canonical shape.
  // SPEC (fold plan §3 step B follow-up): (1) thread the resolved append selector into
  //   the expanded-mode nested-child frame compose (make the pushed composed frame carry
  //   the resolved `.a-x` for BOTH the direct-decl block and the nested container child);
  //   (2) resolve list-parent append per-branch (append the suffix to each list item)
  //   once the upstream list-append shape is pinned with the owner.
  if (selectorHasAmpersandAppend(ruleset.selector)) {
    // (1) append ruleset with a nested NON-APPEND container child (`&-x { .inner {…} }`
    //     or `&-x { @media {…} }`). A nested APPEND child (`&-b { &-c {…} }` → `.a-b-c`)
    //     DOES fold (each level appends against the resolved-frame side-channel), so it
    //     is NOT a deferral — only a plain-selector / at-rule child under an append parent
    //     hits the expanded-mode frame-split gap.
    for (let i = 0; i < ruleset.rules.length; i++) {
      const child = ruleset.rules[i]!;
      if (isNode(child, N.AtRule)) {
        return false;
      }
      if (isNode(child, N.Ruleset) && !selectorHasAmpersandAppend((child as Ruleset).selector)) {
        return false;
      }
    }
  }
  // (2) a SELECTOR-LIST-selector container whose body has an append child.
  if (
    (isNode(ruleset.selector, N.SelectorList) || Array.isArray(ruleset.selector))
    && bodyHasAppendChild(ruleset.rules)
  ) {
    return false;
  }
  // ANCESTOR RE-WRAP on at-rule HOIST (folded — was a scoped frontier). A
  // conditional-group at-rule nested inside THIS ruleset hoists to root under
  // collapse; content that is NOT a plain-selector child ruleset — a DIRECT
  // declaration (`html { @supports { d: v } }` → `@supports { html { d: v } }`) or
  // a bare-`&` / `&`-collapsing child ruleset (`.c { @media { & { … } } }` →
  // `@media { .c { … } }`) — is RE-WRAPPED in this ruleset's composed selector by
  // the spine hoist: `getHoistedParent` recovers the enclosing ruleset frame from
  // `context.rulesetFrames` (no `.parent` back-pointer needed) and the composed
  // parent selector from `composedSelectorStack`, then emits it as the hoisted
  // wrapper header. So no ruleset-level exclusion is needed here.
  return isSpineEligibleBody(ruleset.rules, allowExtend, allowImport);
}

/**
 * The conditional-group at-rules THIS phase folds through the spine: pure
 * "wrap + (maybe) hoist" containers with no extra eval-pass side effects on
 * their name or body binding. These BUBBLE to root when nested in a ruleset
 * (`@media`→root hoist + composed-selector re-wrap of their body).
 *
 * `@starting-style` is included here (not in the root-only set) because it
 * bubbles + wraps exactly like `@media`: nested it hoists to root carrying its
 * ancestor selector, and its body is composed rulesets/declarations. It rides
 * the same hoist machinery and the same `&`-rewrap frontier guard.
 *
 * `@scope` is likewise a nestable conditional-group: its `(start) to (end)`
 * prelude carries NO extra eval-pass side effect (no scope/extend-roots
 * registration — verified against the eval pass); the prelude — bare, or
 * `(.card) to (.content)`, or var-bearing — rides the SAME prelude-eval-at-enter
 * path `serializeSpineFrameAtRule` uses for `@media (@w)`, and its body is
 * composed rulesets/declarations.
 */
const SPINE_ELIGIBLE_AT_RULES = new Set(['@media', '@supports', '@container', '@starting-style', '@scope', '@layer']);

/**
 * The ROOT-ONLY "wrap + emit" at-rules THIS phase folds through the spine. Unlike
 * the conditional-group family they do NOT hoist/compose selectors: they emit at
 * their document position with a prelude + a self-contained body —
 *   - DECLARATION-bodied: `@font-face`, `@page` (+ margin-box at-rules), `@viewport`,
 *     `@counter-style`, `@property` — body is `:`-declarations / comments. `@property`
 *     carries NO eval-pass side effect (it does not register anything into a scope
 *     or the extend-roots graph — verified against the eval pass); it is a plain
 *     declaration-bodied root-only at-rule, structurally identical to `@font-face`.
 *   - KEYFRAME-bodied: `@keyframes` / `@-webkit-keyframes` — body is keyframe-
 *     selector rulesets (`0%`, `from`, `to`, `from,to`) that DO NOT `&`-compose;
 *     the root-only composed-stack reset (`isRootOnly()` in the kept serializer)
 *     keeps each keyframe selector standalone.
 *   - RULESET-bodied conditional-ish: `@document`/`@-x-document`/`@-moz-document`,
 *     `@host` — body is plain-selector rulesets emitted inside the block.
 *
 * EXCLUDED (still eval path, precise reasons): `@charset`/`@import`/`@namespace` —
 * document-framing / non-block (already gated out by `isSpineEligibleRoot`'s
 * charset/topImports check and having no `Rules` body). A genuinely interpolated
 * at-rule KEYWORD (`name` is an `Interpolated` node, not a string) is gated out by
 * the string-name check in `isSpineEligibleAtRule`; a bare var-ref in the NAME/
 * prelude position (`@keyframes @name`) IS folded via the prelude-eval-at-enter path.
 */
const SPINE_ELIGIBLE_ROOT_ONLY_AT_RULES = new Set([
  '@font-face',
  '@page',
  '@viewport',
  '@counter-style',
  '@keyframes',
  '@-webkit-keyframes',
  '@document',
  '@-x-document',
  '@-moz-document',
  '@host',
  '@property'
]);

/**
 * The 16 PAGE MARGIN-BOX at-rules (CSS Paged Media Module Level 3, §5 —
 * https://www.w3.org/TR/css-page-3/#margin-boxes). Each is only grammatically
 * valid as a direct child of `@page`; its body is `:`-declarations (`content`,
 * `margin`, …). They are NOT in `NESTABLE_AT_RULES` nor `ROOT_ONLY_AT_RULES`
 * (`at-rule.ts`), so `isNestable()`/`isRootOnly()` are both false and they emit
 * IN PLACE within the enclosing `@page` block with no hoist and no selector
 * composition — structurally the declaration-bodied wrap+emit shape, one level
 * down. The spine emit dispatch (`serializeSpineFrameAtRule`) already renders any
 * `AtRule`-with-`Rules` child this way; the ONLY gap was this eligibility gate,
 * which rejected the unknown name. Admitted here as a `@page`-body-only child (the
 * body gate below descends into `@page` and reaches these via
 * `isSpineEligibleAtRule`); their own body reuses the declaration-body check.
 */
const SPINE_PAGE_MARGIN_BOX_AT_RULES = new Set([
  '@top-left-corner',
  '@top-left',
  '@top-center',
  '@top-right',
  '@top-right-corner',
  '@bottom-left-corner',
  '@bottom-left',
  '@bottom-center',
  '@bottom-right',
  '@bottom-right-corner',
  '@left-top',
  '@left-middle',
  '@left-bottom',
  '@right-top',
  '@right-middle',
  '@right-bottom'
]);

/** True for the keyframes family, whose children are keyframe-selector rulesets. */
const SPINE_KEYFRAMES_AT_RULES = new Set(['@keyframes', '@-webkit-keyframes']);

/**
 * A nested AT-RULE child THIS phase can descend through the spine: a
 * block at-rule from one of two families, with a string name (not interpolated —
 * an interpolated at-rule NAME is not folded yet) and a spine-eligible body:
 *   - CONDITIONAL-GROUP (`@media`/`@supports`/`@container`/`@starting-style`/
 *     `@scope`/`@layer`) — bubbles to root + composes its body's selectors (the
 *     `@media`→root hoist + composed-stack machinery, §7); subject to the
 *     `&`-through-hoist re-wrap frontier guard (`atRuleBodyHasAmpersandRuleset`).
 *   - ROOT-ONLY WRAP+EMIT (`@font-face`/`@page`/`@keyframes`/`@-webkit-keyframes`/
 *     `@viewport`/`@counter-style`/`@document`/`@host`, `SPINE_ELIGIBLE_ROOT_ONLY_
 *     AT_RULES`) — no hoist, no composition; body is declarations / keyframe-
 *     selector rulesets / plain-selector rulesets. The root-only composed-stack
 *     reset keeps keyframe selectors standalone. Body gated by
 *     `isSpineEligibleRootOnlyAtRuleBody`.
 * The prelude is resolved-at-enter by `serializeSpineFrameAtRule`.
 *
 * `@layer` folds as a conditional-group. Its ONLY eval-pass side effect is
 * layer-NAME registration into the extend-roots graph (`@layer a.b` →
 * `registerRoot(body, parent, { layerName })`), which exists SOLELY to scope
 * extend-reach per layer. And any at-rule body BEARING an extend is kept off the
 * spine entirely by `isSpineExtendTopology` (it sets `ok = false` for an
 * extend-bearing at-rule) — so an extend-under-`@layer` runs on the eval path
 * where the layer-name registration happens. On the spine (a no-extend `@layer`)
 * the registration has no consumer, so skipping it is output-invisible.
 *
 * EXCLUDED (still eval path, precise reasons): a genuinely interpolated at-rule
 * KEYWORD (`name` is an `Interpolated` node — the string-name check below gates
 * it; a bare var-ref NAME like `@keyframes @name` DOES fold via prelude-eval);
 * non-nestable / document-framing forms (`@charset`/`@import`/`@namespace`).
 */
function isSpineEligibleAtRule(node: Node, allowImport = false, allowExtend = false): boolean {
  if (!isNode(node, N.AtRule) || !isNode(node, N.Rules)) {
    return false;
  }
  const atRule = node;
  // A non-string at-rule NAME (an `Interpolated` node) is UNREACHABLE, not a coverage
  // gap: an interpolated at-rule name (`@@{n} screen {}`) is NOT a Less feature —
  // less.js parse-errors on it (`tests-error/parse/bad-variable-declaration1.less`)
  // and the jess parser likewise rejects it (`@@{n} …` never yields an `AtRule` with a
  // non-string name; `@{n} …` parses as an InterpolatedSelector ruleset — the M8 lane).
  // This branch is effectively dead; kept as a cheap type-narrowing guard. Do NOT
  // "restore" it as a future feature — the shape is a verified non-feature.
  if (typeof atRule.name !== 'string') {
    return false;
  }
  const options = atRule.options as { referenceMode?: boolean } | undefined;
  if (options?.referenceMode === true) {
    return false;
  }
  // ROOT-ONLY "wrap + emit" family (`@font-face`/`@page`/`@keyframes`/…): no
  // hoist, no selector composition. Body is declarations/comments, or (keyframes)
  // keyframe-selector rulesets, or (`@document`/`@host`) plain-selector rulesets.
  if (SPINE_ELIGIBLE_ROOT_ONLY_AT_RULES.has(atRule.name)) {
    return isSpineEligibleRootOnlyAtRuleBody(atRule);
  }
  // PAGE MARGIN-BOX (`@top-left`/`@top-center`/…): a declaration-bodied, in-place
  // (non-hoisting) at-rule child of `@page`. Body gate is identical to the
  // declaration-bodied root-only family — no `&`-bearing child, normal leaf body.
  // The enclosing `@page` is what admits it as a body child; a stray margin-box
  // outside `@page` is a CSS grammar error that the spine simply emits verbatim
  // (byte-identical to eval, which also emits it as an unknown block at-rule).
  if (SPINE_PAGE_MARGIN_BOX_AT_RULES.has(atRule.name)) {
    return isSpineEligibleRootOnlyAtRuleBody(atRule);
  }
  if (!SPINE_ELIGIBLE_AT_RULES.has(atRule.name)) {
    return false;
  }
  // Nested conditional-group at-rules HOIST to root (under collapse); when their
  // body contains a ruleset whose selector carries an `&`, the hoist RE-
  // MATERIALIZES the ancestor selector around the (possibly `&`-collapsed) child —
  // e.g. `.c { @media { & { … } } }` → `@media { .c { … } }`, and `.top { .inside &
  // { @supports { … } } }` → `@supports { .inside .top { … } }`. FOLDED: the spine
  // hoist reproduces the ancestor re-wrap via `getHoistedParent` (which recovers
  // the enclosing ruleset frame from `context.rulesetFrames` and the composed
  // parent selector from `composedSelectorStack`), so a bare-`&` / `&`-collapsing
  // inner ruleset AND a direct declaration both wrap in the composed parent header.
  // Plain-selector inner rulesets (`.card { @media { .inner { … } } }` →
  // `.card .inner`) compose the same way. No `&`-body exclusion needed here.
  //
  // CONDITIONAL-AT-RULE EXTEND (media-scope fold). A `@media`/`@supports`/`@container` body may
  // itself bear `:extend` — the wire gather descends the scope chain and the pipeline's
  // scope-reachability filter scopes the contribution to the same or a nested conditional body
  // (eval oracle §A5/A2). So thread `allowExtend` into the body check for those at-rules only,
  // matching `spine-extend.ts`'s `isMediaScopeAtRule`. `@scope`/`@layer` (also in this set) keep
  // `allowExtend=false`: their extend reachability is not a plain nesting-prefix relation, so an
  // extend under them stays on eval (`isSpineExtendTopology` rejects it).
  const atRuleAllowsExtend = allowExtend
    && (atRule.name === '@media' || atRule.name === '@supports' || atRule.name === '@container');
  return isSpineEligibleBody(atRule.rules, atRuleAllowsExtend, allowImport);
}

/**
 * Body eligibility for a ROOT-ONLY "wrap + emit" at-rule. Keyframes bodies hold
 * keyframe-selector rulesets (`0%`, `from`, `to`) — admitted as-is: they carry no
 * `&` and don't compose (the root-only stack reset keeps them standalone), and
 * their own body must be spine-eligible declarations. Declaration/ruleset bodies
 * (`@font-face`, `@page`, `@document`, `@host`, …) reuse the normal body check,
 * which admits `:`/merge declarations, comments, and spine-eligible nested
 * containers. A `&`-bearing child stays on the eval path (no ancestor to compose
 * against here, but the composed serializer would still mis-handle a stray `&`).
 */
function isSpineEligibleRootOnlyAtRuleBody(atRule: Pick<AtRule, 'name' | 'rules'>): boolean {
  const children = atRule.rules;
  if (typeof atRule.name === 'string' && SPINE_KEYFRAMES_AT_RULES.has(atRule.name)) {
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      if (isNode(child, N.Comment)) {
        continue;
      }
      // Each keyframe stop is a Ruleset (`0% { … }`) whose selector is a keyframe
      // keyword/percentage (no `&`) and whose body is spine-eligible declarations.
      if (!isNode(child, N.Ruleset)) {
        return false;
      }
      const ruleset = child;
      if (ruleset.guard || ruleset.options?.referenceMode === true) {
        return false;
      }
      if (selectorHasAmpersand(ruleset.selector)) {
        return false;
      }
      if (!isSpineEligibleBody(ruleset.rules)) {
        return false;
      }
    }
    return true;
  }
  // Declaration/ruleset-bodied root-only at-rules: an `&`-bearing child ruleset
  // stays on the eval path (the composed serializer would mis-handle a stray `&`
  // with no meaningful parent here); everything else follows the normal body gate.
  if (atRuleBodyHasAmpersandRuleset(children)) {
    return false;
  }
  return isSpineEligibleBody(children);
}

/** True if `selector` contains any Ampersand node (bare `&`, `&.x`, `.x &`, …). */
function selectorHasAmpersand(selector: unknown): boolean {
  if (!selector || typeof selector === 'string') {
    return false;
  }
  if (Array.isArray(selector)) {
    return selector.some(item => selectorHasAmpersand(item));
  }
  if (!(selector instanceof Node)) {
    return false;
  }
  if (isNode(selector, N.Ampersand)) {
    return true;
  }
  for (const descendant of selector.walk(true)) {
    if (isNode(descendant, N.Ampersand)) {
      return true;
    }
  }
  return false;
}

/**
 * True if any child of a (hoisting) at-rule body is a Ruleset whose selector
 * carries an `&` — the shape whose ancestor-selector re-wrap the spine hoist does
 * not yet reproduce (see `isSpineEligibleAtRule`). Direct children only: a deeper
 * nested at-rule is itself gated by `isSpineEligibleAtRule` when descended.
 */
function atRuleBodyHasAmpersandRuleset(children: readonly Node[]): boolean {
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (isNode(child, N.Ruleset) && selectorHasAmpersand((child as Ruleset).selector)) {
      return true;
    }
  }
  return false;
}

/**
 * A body (ordered child list) is spine-eligible when every child is. Re-declared
 * variables ARE now admitted — `assignSpineChildIndices` numbers the children at
 * scope-enter so a re-declared / `snapshot` read resolves against the binding at
 * its own source position (the position-gated `lookupScopeFrameVariable`), not
 * last-wins. A non-static (interpolated) var NAME is still excluded (its bucket
 * key isn't statically known, so the position gate can't be pre-seeded).
 */
function isSpineEligibleBody(children: readonly Node[], allowExtend = false, allowImport = false): boolean {
  // INCREMENT 1 cross-check: a mixin call is folded by splicing its emitted decls
  // into the body's statement loop AFTER `planBodyMerges` has run — so a spliced
  // decl cannot participate in a `+:`/`+_:` merge chain in the SAME body. If the
  // body has BOTH a mixin call and a merge decl, keep the whole body on the eval
  // path (the merge would otherwise leak `prop+:`). DEFERRED: merge-across-mixin-
  // output (needs the merge plan to see the expansion).
  if (bodyHasMixinCall(children) && bodyHasDirectMergeDecl(children)) {
    return false;
  }
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (isSimpleSpineLeaf(child, allowExtend, allowImport)) {
      // A non-string VarDeclaration NAME is UNREACHABLE, not a coverage gap: an
      // interpolated var-name write (`@@{x}: v`) is NOT a Less feature — less.js
      // parse-errors on it (`tests-error/parse/bad-variable-declaration1.less`) and
      // the jess parser likewise rejects it (never yields a `VarDeclaration` with a
      // non-string name). This branch is effectively dead; kept as a cheap
      // type-narrowing guard. Do NOT "restore" it as a future feature — verified
      // non-feature.
      if (isNode(child, N.VarDeclaration) && typeof child.name !== 'string') {
        return false;
      }
      // `setDefined` (Sass !global) folds byte-identical ONLY when its target
      // binding is in the SAME scope (a prior same-body declaration of the name):
      // the in-descent cell write then matches eval's same-scope update. A
      // CROSS-SCOPE target (no same-body prior — the write resolves to an OUTER
      // frame) diverges from eval's two-pass (which does not leak an outer write
      // to a later same-scope read) and is SEQUENCED to eval. Detected statically
      // here so the runtime never reaches the `uncovered` bail on this root.
      if (isNode(child, N.VarDeclaration) && child.options?.setDefined
        && !bodyHasPriorSameNameDecl(children, i, child)) {
        return false;
      }
      continue;
    }
    // A mixin DEFINITION emits nothing (invisible output) and registers into the
    // scope frame at `getScopeFrame`, which the spine already calls at scope-enter
    // — so a callable resolves without an eval pass. Increment 1 admits an
    // unparameterized, unguarded definition (the only shape its calls fold); a
    // parametric/guarded/interpolated-name definition is DEFERRED (its body still
    // registers, but its calls fall back at runtime).
    if (isNode(child, N.Mixin)) {
      if (isSpineEligibleMixinDefinition(child)) {
        continue;
      }
      return false;
    }
    // A PURE `Rules` container (type `Rules`, not a `Ruleset`/`AtRule`) is a TRANSPARENT GROUP the
    // parser emits for an empty-body selector-list block carrying a per-branch `:extend` — the
    // `.should-not-exist, .ext7:extend(.ext5 all) {}` shape parses as `Rules` holding a standalone
    // `Extend` (its extender own is the `Extend`'s branch selector, gathered by `wireSpineExtends`)
    // plus the empty-body `Ruleset`. It emits nothing but its mere presence must not force the whole
    // root to eval (where the nested-extender bug re-appears). Admit it under `allowExtend` when
    // every child is itself eligible (the invisible-effect Extend + a simple/empty Ruleset). Not a
    // `Ruleset` (has no own selector to compose) → recurse its body directly.
    if (allowExtend && child.type === 'Rules' && isNode(child, N.Rules)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const rulesChild = child as unknown as Rules;
      if (isSpineEligibleBody(rulesChild.rules, allowExtend, allowImport)) {
        continue;
      }
      return false;
    }
    // LOOP FOLD (cutover LOOP increment 1): a `$for` / `each(...)` loop (both parse
    // to a `For` node) folds when its body is spine-coverable. The runtime expansion
    // (`serialize-helper` `runSpineForExpansion`) produces one bound-body surface per
    // iteration (`For.spineIterationSurfaces`) and splices their children in order —
    // the loop-variable-bound analogue of a mixin-surface splice. A body shape the
    // spine cannot cover keeps the loop (and its enclosing body) on eval.
    if (isSpineEligibleFor(child)) {
      continue;
    }
    if (!isSpineEligibleContainer(child, allowExtend, allowImport)) {
      return false;
    }
  }
  return true;
}

/**
 * A mixin DEFINITION whose calls the spine may fold — a static string name, no
 * `when` guard, and (INCREMENT 3/4) a NAMED-parameter list. Its body need NOT be
 * statically simple here (a call's runtime gate `isSpineSimpleMixinSurface`
 * decides fold-vs-fallback), but a definition that can't be admitted at all forces
 * the enclosing body off the spine.
 *
 * Admitted: each param is a plain named `VarDeclaration` — NO default (a `Nil`
 * value, a required positional — increment 3) OR a DEFAULT value (`@c: red` —
 * increment 4) — OR a REST param (`...` / `@rest...` — increment 6).
 * `matchCallableParams` binds the call's positional/named args into the params'
 * live cells, fills a missing param from its default, and collects the tail into
 * the rest param; the frame-threaded descent resolves them all. DEFERRED (still off
 * the spine): PATTERN-MATCH literal params (`.m(dark, @c)` — a non-VarDeclaration,
 * non-Rest value guard); a `when` guard; an interpolated name.
 */
function isSpineEligibleMixinDefinition(node: Node): boolean {
  if (!isNode(node, N.Mixin)) {
    return false;
  }
  if (typeof node.name !== 'string') {
    return false;
  }
  // INCREMENT 7: a `when` GUARD is admitted. The callable terminal evaluates the
  // guard BEFORE the sink is consulted (`executeCallableCandidate`: `if
  // (!guardResult.passes) return` — no output, sink never called), so a guard-
  // FAILING candidate never folds and a guard-SELECTED candidate folds only when it
  // passes — the guard outcome is faithfully reproduced by the KEPT eval. Verified
  // byte-identical for pass / fail / select-among-several / `default()`.
  // INCREMENT 8 (fold #2): PATTERN-MATCH literal params are admitted. A param that
  // is neither a named `VarDeclaration` (required/default) nor a `Rest` is a value
  // guard (`.m(dark)`, `.m(light)`) — the KEPT `matchCallableParams` compares the
  // call's positional arg against the literal and only selects the matching overload
  // BEFORE the sink is consulted, exactly like the eval path. A non-matching overload
  // never folds; the matching one folds against its (spine-simple) body. Verified
  // byte-identical for literal-select among several overloads. So the whole
  // param-shape restriction is lifted — any param list a definition can carry
  // (named, default, rest, pattern-match literal) is admitted here; the runtime
  // surface gate + guard eval still decide fold-vs-fallback per candidate.
  return true;
}

/**
 * A `$for` / `each(...)` LOOP whose iterations the spine may fold (cutover LOOP
 * increment 1). Both syntaxes parse to a `For` node (the less-parser rewrites
 * `each(list, {…})` into a `For`). Admitted when the loop body is itself
 * spine-coverable (`isSpineEligibleBody`) — the iteration surfaces share these body
 * children, so a shape the descent cannot cover in one iteration cannot cover any.
 * The iterable is a VALUE (eval'd per-render by `spineIterationSurfaces`), so it is
 * not gated here. A non-eligible body keeps the loop (and its enclosing body) on the
 * eval path, byte-identical. Zero-cost when no loop: the cheap `type` check bails.
 */
function isSpineEligibleFor(node: Node): boolean {
  if (node.type !== 'For') {
    return false;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- type-string narrows to the For subtype; its body is the shared `rules` Node[].
  const forNode = node as unknown as { rules: readonly Node[] };
  return isSpineEligibleBody(forNode.rules);
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
function isSimpleSpineLeaf(node: Node, allowExtend = false, allowImport = false): boolean {
  if (isNode(node, N.Comment)) {
    return true;
  }
  // A spine-foldable `@import` (IMPORTS increment 1): CSS-passthrough (queued to
  // the top-of-doc emitter) or a plain static-path Less import (its parsed body
  // descended inline). Runtime body-simplicity is gated at fold time
  // (`resolveSpineStyleImport` → `isSpineEligibleBody` on the resolved Less body),
  // with a byte-identical eval fall-back for a non-simple imported body. Admitted
  // only under `allowImport` (the import-work gate — `engageImportLayer`).
  if (allowImport && (isSpineFoldableImport(node) || isSpineFoldableCssImportStatement(node))) {
    return true;
  }
  // A bodyless STATEMENT at-rule (`@layer name;`, `@namespace …;`) emits its bytes
  // inline at its source position — no scope, no eval, no import machinery, so it
  // is admitted independent of `allowImport`.
  if (isSpineFoldableStatementAtRule(node)) {
    return true;
  }
  // Extend / ExtendList are invisible effect nodes (they emit nothing; their gather
  // runs in the pre-scan). Admitted only under the FLAT extend topology (P3 increment 1),
  // where the root-level pre-scan gathers them ahead of emit.
  if (allowExtend && (node.type === 'Extend' || node.type === 'ExtendList')) {
    return true;
  }
  // Plain no-arg mixin CALL (cutover increment 1): STATIC admissibility only —
  // the resolved candidate body shape is gated at RUNTIME (`resolveSpineMixinCall
  // Surfaces` / `isSpineSimpleMixinSurface`), with a byte-identical fall-back to
  // the eval path when the resolved shape is not spine-simple.
  if (isSpineEligibleMixinCall(node)) {
    return true;
  }
  // Bare statement-position built-in FUNCTION call (`if((false), {g: 7});`):
  // evaluated + serialized inline at emit (`resolveSpineStatementCallText`), void
  // (Nil/empty `Anonymous`) result emits nothing — byte-identical to eval's
  // call-lane. See `isSpineFoldableStatementCall`.
  if (isSpineFoldableStatementCall(node)) {
    return true;
  }
  if (isNode(node, N.Declaration)) {
    const options = node.options as { assign?: string; setDefined?: boolean; nearestOuter?: boolean } | undefined;
    const assign = options?.assign ?? ':';
    // Folded: `:` (plain), the property-MERGE assigns (`+:`/`+_:`/`&,:`/`&_:`,
    // coalesced by `planBodyMerges`), and the CONDITIONAL assign `?:` on a
    // VARIABLE (`@x ?: v` — assign-if-undefined, resolved by `planBodyConditionals`:
    // the eval-path self-reference read, position-gated against the live frame +
    // a single write-forward onto the node's own cell). Still excluded (the
    // frontier): a `?:` on a plain PROPERTY (`color ?: v` — eval keeps BOTH the
    // prior property decl AND the fallback as a NEW decl; a non-binding shape the
    // body plan does not model — SEQUENCED, see `spine-cond.ts`), and the
    // scope-mutating assigns `setDefined` (Sass `!global` — an OUTER-scope binding
    // write) / `nearestOuter` (Jess `:=` — no eval implementation, no oracle).
    if (CONDITIONAL_ASSIGNS.has(assign)) {
      return isNode(node, N.VarDeclaration);
    }
    // `setDefined` (Sass !global) on a VARIABLE is an incremental binding-WRITE
    // (`spine-setdefined.ts`, mechanism B): resolve the existing binding via the
    // eval frame-path + write its cell during descent. Admitted here; an `uncovered`
    // frame surface (optional / dynamic assignment targets) is SEQUENCED to eval by
    // a runtime bail (`applyBodySetDefined` → root re-render). `nearestOuter`
    // (Jess :=) stays excluded — no eval implementation, no correctness oracle.
    if (options?.nearestOuter) {
      return false;
    }
    if (options?.setDefined) {
      return isNode(node, N.VarDeclaration);
    }
    if (assign !== ':' && !MERGE_ASSIGNS.has(assign)) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * Property-merge assign operators the spine coalesces (see `planBodyMerges`).
 * Both raw parser forms (`+,:` comma, `+_:` space) and their normalized twins
 * (`&,:` / `&_:`); `+:` is the legacy `Add` alias. The raw COMMA form `+,:` must
 * be present so comma merges fold on the spine like space merges — without it a
 * comma-merge body is not spine-simple and silently routes to eval.
 */
const MERGE_ASSIGNS = new Set(['+:', '+,:', '+_:', '&,:', '&_:']);

/** Conditional assign-if-undefined operator the spine folds (see `planBodyConditionals`). */
const CONDITIONAL_ASSIGNS = new Set(['?:']);

/**
 * True if a DIRECT child BEFORE `index` is a non-`setDefined` VarDeclaration of the
 * same name as `decl` — proving a `setDefined` write's target binding is SAME-scope
 * (foldable; see `spine-setdefined.ts`). A `setDefined` with no same-body prior
 * resolves to an OUTER frame (cross-scope) and is kept on eval.
 */
function bodyHasPriorSameNameDecl(children: readonly Node[], index: number, decl: VarDeclaration): boolean {
  if (typeof decl.name !== 'string') {
    return false;
  }
  const name = decl.name;
  for (let i = 0; i < index; i++) {
    const prior = children[i]!;
    if (isNode(prior, N.VarDeclaration)
      && !prior.options?.setDefined
      && typeof prior.name === 'string'
      && prior.name === name) {
      return true;
    }
  }
  return false;
}

/** True if any DIRECT child of `body` is a spine-eligible mixin call. */
function bodyHasMixinCall(children: readonly Node[]): boolean {
  for (let i = 0; i < children.length; i++) {
    if (isSpineEligibleMixinCall(children[i]!)) {
      return true;
    }
  }
  return false;
}

/** True if any DIRECT child of `body` is a merge-flagged declaration. */
function bodyHasDirectMergeDecl(children: readonly Node[]): boolean {
  for (let i = 0; i < children.length; i++) {
    if (isMergeDecl(children[i]!)) {
      return true;
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
 * extend/reference) with `&`/interpolated selectors resolved-at-enter,
 * conditional-group at-rules (`@media`/`@supports`/`@container`/`@starting-style`),
 * and ROOT-ONLY wrap+emit at-rules (`@font-face`/`@page`/`@keyframes`/`@-webkit-
 * keyframes`/`@viewport`/`@counter-style`/`@document`/`@host`); re-declared vars +
 * `snapshot` reads resolve per-position. An `@x ?: v` conditional-assign and a
 * same-scope `!global` `setDefined` DIRECTLY in the root body ALSO fold (cutover
 * root-fold gates 4/5): the root body descends through the same `withSpineMergePlan`
 * machinery the container path uses. Excluded (still eval path — a scoped frontier,
 * NOT a safety fallback): charset/import document framing, reference mode, a
 * root-direct `+:`/`+_:` property-MERGE (gate 3 — `planBodyMerges` edge-shape gaps,
 * see body comment), a `?:` on a plain PROPERTY, a CROSS-SCOPE `setDefined`,
 * `nearestOuter` (`:=`), ampersand-append, `@layer`/`@scope`/`@property`, the
 * at-rule `&`-through-hoist re-wrap frontier, guarded/extend/mixin/reference
 * containers, interpolated var/at-rule NAMES.
 */
export function isSpineEligibleRoot(root: Rules, context: Context, collapseNesting?: boolean): boolean {
  if (context.currentCharset) {
    return false;
  }
  // IMPORT-WORK GATE (design §4.0, IMPORTS increment 1). When the tree carries no
  // `StyleImport`, the spine pays zero import cost; a pre-populated `context.topImports`
  // (from an unrelated prior render on this context) still routes to the eval path.
  // When the tree HAS foldable imports the spine OWNS the top-of-doc `@import` emit
  // (CSS-passthrough → `queueTopImport`, prepended in `renderRootViaSpine`), so a
  // (freshly-cleared) `topImports` no longer forces the eval path.
  const allowImport = engageImportLayer(root);
  if (!allowImport && context.topImports?.length) {
    return false;
  }
  if (root.options?.referenceMode === true) {
    return false;
  }
  // ROOT-BODY `?:` + same-scope `setDefined` (cutover root-fold, gates 4/5 FOLDED).
  // An `@x ?: v` conditional-assign or a same-scope `!global` `setDefined` DIRECTLY
  // in the root body now folds on the spine — the root body is just another entry
  // sequence. `renderRootViaSpine` reaches the root body through `Rules._emitRulesBody`,
  // which installs the SAME `withSpineMergePlan` machinery the CONTAINER descent uses
  // (`?:` plan + `setDefined` binding-write), and the root leaf path consumes the `?:`
  // plan via `resolveSpineLeafText`. The per-leaf gate below (`isSpineEligibleBody` →
  // `isSimpleSpineLeaf`) keeps the UNFOLDABLE variants on eval byte-identical: a `?:`
  // on a plain PROPERTY, a CROSS-SCOPE `setDefined` (no prior same-body binding —
  // `bodyHasPriorSameNameDecl`), and `nearestOuter` (Jess `:=`, no eval oracle — the
  // deferred mechanism-B, NOT pulled forward here).
  //
  // ROOT-LEVEL property-MERGE (gate 3) STAYS on eval (oracle-verified residual,
  // ratchet-spec'd). Root-direct `+:`/`+_:` merges are unusual (a bare property at
  // document root is not valid CSS; properties belong in rulesets) AND the spine's
  // `planBodyMerges` diverges from eval on three edge sub-shapes a root merge can hit:
  // (a) an Add-`+:` merge pulling in a PRIOR PLAIN same-named decl (eval seeds the
  // chain from it — `red;` then `red, blue` — `planBodyMerges` resets on the plain
  // decl and drops it); (b) a DECLARATION-reference read of the coalesced property
  // (`background: $background-color` resolves the raw last binding, not the merge);
  // (c) source-value node-parent preservation (`combineMergeValue`'s `spaced`/`List`
  // adopts the authored value node). These are latent `planBodyMerges` gaps the
  // CONTAINER fold already ships (untested there); folding root merge would newly
  // expose them. Keeping gate 3 on eval is byte-identical; SPEC: lift once
  // `planBodyMerges` models the Add-pull-prior + decl-ref-to-merged shapes.
  if (bodyHasDirectMergeDecl(root.rules)) {
    return false;
  }
  // LOOP fold (cutover LOOP increment 1) — CONTAINER-nested only. A `$for`/`each`
  // loop folds when nested inside a ruleset/at-rule (its body flows through
  // `serializeRulesContainerInternal` → `runSpineForExpansion`). A ROOT-DIRECT loop
  // renders through `Rules._emitRulesBody`, a distinct root emitter that treats a
  // `For` (a `Rules`-masked node) as a transparent child-Rules and emits its
  // unexpanded body — so a root-direct loop stays on eval (byte-identical) until the
  // root emitter grows the same expansion. Rare in practice (a bare loop at document
  // root); the measured target fixtures nest their loops in containers. SPEC: lift
  // once `_emitRulesBody` routes a `For` child through the loop-fold expansion.
  for (let i = 0; i < root.rules.length; i++) {
    if (root.rules[i]!.type === 'For') {
      return false;
    }
  }
  // BARE STATEMENT-POSITION FUNCTION call (`e('…');`, `if((false), {g: 7});`) now FOLDS
  // at document root too (cutover — css-escapes trailing `e('…')`). It folds nested in a
  // container via `serializeRulesContainerInternal`'s leaf tail; the ROOT emitter
  // (`Rules._emitRulesBody`) grew the SAME resolve-and-drop-`;` branch
  // (`resolveSpineStatementCallNode` + `checkValidNodes` `F_ALLOW_ROOT`, void →
  // suppressed), so a root-direct statement call no longer forces the eval path.
  // M8 (FOLDED): a mixin CALL whose target is an INTERPOLATED-SELECTOR ruleset
  // (`.@{name} {}` used as `.foo()`). The interpolated name used to be registered
  // into the callable cache ONLY by the eval pass (`Ruleset.prepareRegistration` →
  // `selector.eval` resolves `.@{name}` → `.foo` and writes `ownSelector`, which
  // `collectCallablesFor` keys), which the spine skipped — so the call missed and
  // threw "No matching mixins". `renderRootViaSpine` now replicates exactly that
  // eval-pass side effect at root-enter (`wireSpineInterpolatedSelectorCallables`,
  // gated on `treeHasInterpolatedSelectorRuleset` so a shape-free tree pays nothing):
  // it resolves each interpolated-selector ruleset's identity in place and re-keys
  // the callable cache, so the call resolves byte-identical to eval.
  // FOLD B (P4 terminal/sink): a `mixin-ruleset` dot-call whose key names BOTH a
  // Mixin definition AND a same-named Ruleset (`.foo() {}` mixin + `.foo {}` ruleset)
  // matches BOTH — the call emits the mixin body AND the ruleset-as-mixin body. Since
  // FOLD A routes the Ruleset candidate through the sink too, BOTH candidates are now
  // captured and `resolveSpineMixinCall.finish` assembles their call-site
  // contributions in source DOCUMENT ORDER (the existing sort). Folds through the
  // spine; the `treeHasMixinRulesetMixedMatch` gate is DELETED (dead after FOLD B).
  // NESTED-scope mixin closure — GATE LIFTED (fold #6). A nested mixin closing over
  // an INTERMEDIATE (non-root) enclosing scope's local var/param used to be kept on
  // eval (`treeHasNestedMixinClosingOverVarScope`) because the definition scope's
  // frame was never established when the spine did not descend it. `renderRootViaSpine`
  // now eagerly wires the definition-scope `.parent` chain
  // (`wireSpineDefinitionScopeParents`, gated on that same predicate so a tree without
  // the shape pays nothing), and `executeCallableCandidate` re-parents the folded
  // surface frame to its `lexicalScopeFrame` under the spine sink — so the closure
  // (and shadowing) resolves against the definition scope, byte-identical to eval.
  // Namespace-path, multi-level namespace, root/param closure, and now intermediate-
  // scope closure all fold.
  // NESTED-CONTAINER MIXIN BODY (FOLDED): a mixin DEFINITION whose body contains
  // NESTED CONTAINERS (`.mix() { .inner { … } }`) — including a deeply-nested call
  // reading the mixin's params (`.inner { .mi((@a*2)) }`) — now FOLDS. The captured
  // surface's container child descends via `serializeSpineFrameContainer` carrying the
  // surface frame (its `enclosingFrame` = the surface), so its body resolves the
  // mixin's params at arbitrary depth AND runs its own `runSpineMixinExpansion` — a
  // nested call inside the container expands in-pass against the surface frame, no
  // re-descent, no frame loss (the gap the OLD eval-fallback re-descent had).
  // `isSpineSimpleMixinSurface` admits a nested container via the same
  // `isSpineEligibleContainer` predicate authored containers use. A hoisting at-rule
  // child (`@media`/`@supports`/… with a direct decl or a bare-`&`/`&:hover` child)
  // ALSO folds now (the mixin-surface analogue of the authored at-rule-&-through-hoist
  // fold): the surface's at-rule child is spliced at the call site, so
  // `getHoistedParent` recovers the CALL-SITE ruleset from `context.rulesetFrames` and
  // `serializeSpineFrameAtRule` per-call re-points its memoized scope frame — a
  // param-dependent at-rule body/prelude re-resolves per call (no cross-call leak).
  // Only the UNFOLDABLE sub-shapes stay on eval (`treeHasUnfoldableContainerBodyMixin`,
  // byte-identical): a nested Mixin DEFINITION (a dynamically-created callable the fold
  // doesn't register), and a non-spine-eligible nested container. Recursion is gated
  // below.
  if (treeHasMixinCall(root) && treeHasUnfoldableContainerBodyMixin(root)) {
    return false;
  }
  // FOLD C (P4 terminal/sink): recursion / nested-call-in-body. A mixin DEFINITION
  // whose body itself contains a DIRECT-child mixin CALL (`.wrapper() { .base(@c); }`,
  // a nested chain `.a(){ .b() }`, incl. frame-dependent args `.b((@x - 1))`) folds
  // via the RE-ENTRANT splice (`runSpineMixinExpansion` re-scans a folded surface's
  // spliced children from `i`, pushing each entry's `spineFrame` around the resolve).
  // RECURSION (a self / mutual name-cycle) with a FRAME-DEPENDENT arg (`.loop((@n-1))`)
  // now folds too (the frame-threaded arg-binding rung, §7): each level's freshly-bound
  // param frame is threaded through the recursive call's arg-binding eval AND the
  // spliced body decls' dedup-key + emit resolution (`computeDeclKey` / `processNode`
  // push the entry's `spineFrame`), so `@n - 1` resolves against level N's `@n`
  // producing level N-1's surface, byte-identical to eval / less@4. `callMap` bounds it.
  // STRIPE (a recursive cycle whose body has a NESTED CONTAINER shared across levels,
  // `.stripe(@n){ a{…} .stripe(@n-1) }`) now FOLDS too: the re-entrant splice used to
  // re-use the SAME canonical container child per level, collapsing two levels' blocks
  // into one (the header-merge is keyed on node identity). `runSpineMixinExpansion`'s
  // `distinctFoldChild` now splices a DISTINCT per-level copy (reusing scalar leaves)
  // on a container child's 2nd+ occurrence — mirroring the loop fold's per-iteration
  // `copyWithReusableLeaves` — so each level emits its own `.wrap a{…}` block,
  // byte-identical to eval / less@4. The recursion gate is therefore lifted entirely;
  // an unfoldable recursive sub-shape (a non-spine-simple body) still falls back to the
  // eval terminal per-call (`isSpineSimpleMixinSurface` → `anyRejected` → kind:'eval').
  // MERGE-ACROSS-MIXIN (FOLDED — P4 item landed). A property-MERGE (`transform+:` /
  // `+_:`) whose contributions arrive via MIXIN EXPANSION — `.r { .a(); .b(); }` where
  // `.a()`/`.b()` each carry a `transform+:` decl (the `merge.less` corpus shape) —
  // now coalesces on the spine: the container descent RE-PLANS the merge coalesce
  // over the POST-EXPANSION `rulesToRender` sequence (`replanMergesIfExpanded` in
  // `serialize-helper.ts`), so a spliced merge decl participates in the chain, carrying
  // each entry's mixin-output OWNER to reproduce eval's cross-scope boundary (same
  // mixin body coalesces; distinct mixin bodies are last-wins). Byte-identical to eval
  // by construction (values resolved via the same `decl.eval`).
  //
  // ASYNC-valued merge-across-mixin now FOLDS too (`transform+: rotate(90deg)` —
  // a merge value containing a `Call`/`Operation`/`Reference`). It resolves via the
  // EVAL-FALLBACK expansion, whose async value re-resolution used to clobber the live
  // spine writer/frames: an unknown-`Call` eval renders its call syntax through
  // `prepareRenderPrintState`, which RESETS the shared `context.printState` in place,
  // swapping the writer mid-render and dropping the enclosing block header. That is
  // now contained — every spine VALUE eval is wrapped in `evalIsolatingSpinePrintState`
  // (`serialize-helper.ts`), so the scratch serialization leaves the live print state
  // byte-identical. The former gate (`treeHasAsyncMergeContributingMixinCall`) is gone.
  //
  // RESIDUAL (still kept on eval, byte-identical):
  //  - A merge decl authored DIRECTLY in the caller body ALONGSIDE a mixin call
  //    (`.r { .a(); transform+: s; }`) — caught by `bodyHasMixinCall &&
  //    bodyHasDirectMergeDecl`: eval composes the direct decl's `+:` via a positional
  //    prior-value Reference read the static plan does not model.
  // LEAKY-MODE MIXIN-BODY VAR LEAK (FOLDED). In leaky Less mode a mixin body's plain
  // `@x: …` VarDeclaration LEAKS into the CALLER scope, so a consumer in the same
  // scope (`.a { .m(); width: @x }`, an EARLIER `width: @x` sibling — Less resolves a
  // scope's vars lazily last-wins, not source-order gated — a call arg `@x`, or a
  // nested-container child) reads it. The spine fold now propagates this: at the
  // splice, `injectSpineLeakyMixinSurfaceBindings` registers each folded surface's
  // plain leaked var into the CALLER frame's current bindings (the enclosing
  // container, or the surface for a nested call), resolving each value against the
  // surface frame so a param-dependent leak (`@x: @a`) reads the bound param. The
  // injection is scoped to the caller frame (a later out-of-scope sibling sees the
  // outer binding, byte-identical to less@4). Zero-cost off leaky mode or when a
  // folded surface has no plain var. The former eval-routing gate (and its
  // `treeHasLeakyConsumedMixinBodyVar` detector) is DELETED.
  // FLAT extend topology (P3 increment 1): a root whose ONLY extends are root-direct-child
  // subjects/extenders (no nested extend) is spine-eligible — the pre-scan gathers and the
  // subject header is composed as an override. `allowExtend` admits the extend-bearing root
  // children + their ExtendList effect nodes. A NON-flat extend shape stays on the eval path.
  // NESTED-scope imports are now REGISTERED during the descent (IMPORTS increment 3):
  // `wireSpineContainerImports` links a body `@import`'s scope into the ENCLOSING
  // container's frame at container-enter, so a consumer inside a `@media`/ruleset
  // resolves the imported symbol. Root imports are wired by `wireSpineImports`. So a
  // nested StyleImport no longer forces the eval path — the container's own
  // eligibility (`isSpineEligibleContainer` with `allowImport`) admits it.
  // NAMESPACE-PATH over an imported namespace: FOLDS (gate 12, LANDED). A
  // namespace-path lookup (`#library.add-one()` / `#library.sizes[@width]`) resolves
  // via the shared `Rules.findMixinPath` / `findRulesetNamespacePathFast` seam, which
  // walked ONLY the primary parent chain — so a member defined only on an imported
  // `fallbackFrame` (installed by `wireSpineImports` → `linkImportFallbackFrame`) was
  // invisible once the primary walk exhausted. This is NOT a same-named-merge problem:
  // `namespacing-2` has a LOCAL `#library { .sizes() }` (overriding, → 800px, resolves
  // locally) and consumes `#library.add-one` — a member ONLY the imported `#library`
  // defines. The local head HITS first, its remainder MISSES `.add-one`, and the walk
  // never re-tried the fallback frame. FIX: `findMixinPath` now drains the fallback-
  // frame chain AFTER the primary walk misses (mirrors the plain-var / string-key
  // `findMixin` fallback drain) — a local hit always wins, so the fold stays byte-
  // identical to eval. So this tree now folds; the former eval-routing gate is DELETED.
  // DEDUP / `once` is now MODELED by the fold (IMPORTS increment 4): the wire pass
  // records each resolved import path in document order (`spineEmittedImportPaths`),
  // the FIRST occurrence emits + owns the output, and a later import of the SAME path
  // is marked `dedupe` (scope-only, no output) — `multiple` opts back into re-emit.
  // So a duplicate specifier no longer forces the eval path.
  //
  // (The former hoist-frame gate here is REMOVED: the spine's rendered-frame stack is
  // now correctly reset after a hoisting conditional-group at-rule — `finishBody` pops
  // `frameHeaders` in lockstep with `lastRenderedFrames`, so a following root sibling
  // (another `@media`, a plain ruleset) renders at root, not under the at-rule. See
  // `serializeRulesContainerInternal`'s close loop.)
  // Resolve collapse from the SAME source the render pass derives it from
  // (`prepareRenderPrintState` reads `context.opts.output.collapseNesting`) so the eligibility gate
  // and `renderRootViaSpine`'s topology re-check agree. `context.output` (a distinct optional field)
  // is consulted only as a fallback. The two MUST agree: `isSpineExtendTopology` is now
  // collapse-mode-dependent (#4a admits an expanded-mode nested compound target the collapse gate
  // rejects), so a divergent collapse value here would admit-then-fail-loud in `renderRootViaSpine`.
  const collapse = collapseNesting
    ?? (context.opts?.output?.collapseNesting ?? context.output?.collapseNesting) === true;
  // APPEND × EXTEND (a PRECISE deferral). An `:extend` TARGET may be an append-GENERATED
  // selector (`.component { &-inner {…} }` extended by `:extend(.component-inner)`). The
  // spine's extend layer gathers subjects/targets from the STATIC source tree, where the
  // append target (`.component-inner`) exists only after resolution — so the static gather
  // misses it and the extend contribution is dropped. `treeHasExtendTargetableAppend` returns
  // true ONLY for that genuine collision (an extend target atom that could equal an
  // append-generated atom `parent + suffix`), NOT the former whole-tree "any append + any
  // extend → eval" over-rejection — which needlessly pinned every stylesheet that merely
  // appends AND extends unrelated selectors (`benchmark.less`, whose `.component-*` appends are
  // never extend targets). Reject ⇒ eval, byte-identical; the residual is strictly narrower.
  // SPEC (fold plan follow-up): resolve append selectors into the extend target index
  // before SOLVE (mirrors OQ-A interpolated-target resolution at capture) so even a genuine
  // append-target extend folds.
  if (engageExtendLayer(root) && treeHasExtendTargetableAppend(root)) {
    return false;
  }
  // SPECULATIVE-ADMIT (import-spec routing). When imports are present, run the extend-topology check in
  // SPECULATIVE mode: a plain simple extend target that maps to no VISIBLE subject may resolve to an
  // IMPORTED root subject the sync gather can't see, so it is provisionally admitted here. The
  // authoritative decision is the post-wire RE-GATE in `renderRootViaSpine` (which re-runs the STRICT
  // check over the resolved imported subjects and ABORTS to eval, byte-identical, if still unmapped).
  // A no-import tree passes `speculativeImport: false`, so the gate is byte-and-alloc identical to today
  // for the common case (the extra Set is never allocated).
  const allowExtend = engageExtendLayer(root)
    && isSpineExtendTopology(root, collapse === true, allowImport ? { speculativeImport: true } : undefined);
  return isSpineEligibleBody(root.rules, allowExtend, allowImport);
}

/**
 * The Less `once` DEDUP verdict for one resolved import (IMPORTS increment 4). A
 * `multiple`/`once:false` import ALWAYS emits (returns false, never recorded). Else
 * the FIRST import of a `resolvedPath` becomes the once-owner (records it, returns
 * false = emit); a later import of the SAME path returns true = `dedupe` (scope-only,
 * no output). The ledger is `options.spineEmittedImportPaths`, shared for the whole
 * render — so a transitive re-import nested INSIDE another imported file dedups
 * against a root-position import of the same file too (mirrors the eval path's
 * document-global `context.evaldTrees`). Consulted at EVERY resolve point: the wire
 * pass AND the emit fold's fresh-resolve fallback.
 */
export function spineImportDedupeVerdict(
  resolvedPath: string | undefined,
  multiple: boolean,
  options: FinalPrintOptions
): boolean {
  // Inside a MULTIPLE-scoped body (a nested import within a `@import (multiple)`
  // body), every import re-emits — mirrors `context.inMultipleImportScope`.
  if (multiple || resolvedPath === undefined || (options.spineMultipleImportDepth ?? 0) > 0) {
    return false;
  }
  const emittedPaths = (options.spineEmittedImportPaths ??= new Set());
  if (emittedPaths.has(resolvedPath)) {
    return true;
  }
  emittedPaths.add(resolvedPath);
  return false;
}

/**
 * Run `fn` with the MULTIPLE-import scope depth bumped (IMPORTS increment 4) — used
 * while descending a `@import (multiple)` body so its NESTED imports also re-emit
 * (no `once` dedup), then restore on the outbound edge (chaining on the async path,
 * never a sync `finally` that would restore before an async leaf resolves).
 */
export function withSpineMultipleScope<T>(
  options: FinalPrintOptions,
  multiple: boolean,
  fn: () => MaybePromise<T>
): MaybePromise<T> {
  if (!multiple) {
    return fn();
  }
  options.spineMultipleImportDepth = (options.spineMultipleImportDepth ?? 0) + 1;
  const restore = <R>(value: R): R => {
    options.spineMultipleImportDepth = (options.spineMultipleImportDepth ?? 1) - 1;
    return value;
  };
  try {
    const result = fn();
    return isThenable(result)
      ? result.then(restore, (error: unknown) => {
          restore(undefined);
          throw error;
        })
      : restore(result);
  } catch (error) {
    restore(undefined);
    throw error;
  }
}

/**
 * True if the tree has a Mixin definition whose body contains a nested container the
 * spine CANNOT fold — the only sub-shapes that still force the whole tree to eval.
 *
 * A FOLDABLE nested-container mixin body (`.mix(){ .inner{ … } }`, incl. a deeply-
 * nested call reading the mixin's params — `.inner{ .mi((@a*2)) }`) NOW folds through
 * the spine: the captured surface's container child descends via
 * `serializeSpineFrameContainer` carrying the surface frame, resolving params +
 * expanding its own nested calls in-pass (see `isSpineSimpleMixinSurface`). So this
 * gate no longer flags every container-body mixin — only the UNFOLDABLE ones:
 *   - a nested Mixin DEFINITION ANYWHERE inside a mixin body, at any depth (the fold's
 *     surface descent doesn't register a DYNAMICALLY-created nested callable — e.g.
 *     `.Person(@n){ .@{n}{ .sayGender(){…} } }` then `.person.sayGender()` — so a later
 *     call to it can't resolve; a nested def called only WITHIN the same body would fold
 *     but the whole-tree escape analysis to prove that isn't worth it — documented
 *     residual / IOU: register a dynamically-created nested callable through the fold);
 *   - a nested Ruleset/AtRule that is not `isSpineEligibleContainer` (guarded /
 *     extend-bearing / append sub-shape — inherits those existing deferrals).
 * A hoisting at-rule child now FOLDS (the mixin-surface analogue of the authored
 * at-rule-&-through-hoist fold — `getHoistedParent` recovers the call-site ruleset from
 * `context.rulesetFrames`), so it is NO LONGER flagged here.
 * A tree whose container-body mixins are ALL spine-eligible returns false → folds.
 * Recursion (incl. the STRIPE nested-container cycle) folds via the re-entrant splice
 * + `distinctFoldChild` per-level surfaces; it is no longer gated here.
 */
function treeHasUnfoldableContainerBodyMixin(root: Node): boolean {
  for (const node of root.walk(true)) {
    if (!isNode(node, N.Mixin)) {
      continue;
    }
    const body = node.rules;
    // A Mixin DEFINITION nested ANYWHERE inside this mixin body (deep) is a callable the
    // spine surface descent does not register — UNLESS every path that could reach it is a
    // STATIC authored-namespace path (`#library.core.colors()`), which `findMixinPath`
    // resolves by walking authored containers, no dynamic registration required (keystone
    // 6b). A nested def reached by a BARE re-registered name (`.inner-locked-mixin()` after
    // a leaky `.lock-mixin(1)`), a `default()`/pattern overload set called by bare name, or
    // an INTERPOLATED-selector-created namespace (`.@{n}{ .sayGender(){} }` then
    // `.person.sayGender()`) DOES need dynamic registration the fold doesn't perform —
    // that whole tree stays on eval (byte-identical, ratchet-locked residual). Checked deep
    // because the nested def may sit inside a container.
    for (const inner of node.walk(true)) {
      if (inner !== node && isNode(inner, N.Mixin)) {
        if (nestedDefNeedsDynamicRegistration(root)) {
          return true;
        }
        break;
      }
    }
    for (let i = 0; i < body.length; i++) {
      const child = body[i]!;
      // A nested CONTAINER the spine can't descend (extend-bearing, guarded, append
      // sub-shapes) — defer. A foldable container does NOT force eval.
      if (isNode(child, N.Ruleset | N.AtRule) && !isSpineEligibleContainer(child)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True when a nested Mixin DEFINITION in the tree would need DYNAMIC per-scope
 * registration the spine surface descent does not perform (keystone 6b boundary).
 *
 * The ONE nested-def shape the fold covers WITHOUT extra wiring: a def whose only
 * reachable calls are STATIC authored-namespace paths (`#library.core.colors()` /
 * `#ns.mixin(1)`). `Rules.findMixinPath` resolves those by walking authored container
 * scopes (the gate-12 fallback drain), so the call resolves during the fold with no
 * runtime registration — byte-identical to eval.
 *
 * Everything else needs dynamic registration and stays on eval (residual):
 *   - a nested def wrapped in an INTERPOLATED-selector container (`.@{n}{ .sayGender(){} }`)
 *     — the container name is only known after the outer mixin evals, so no static path
 *     reaches it (`.person.sayGender()` misses on the spine);
 *   - a nested def called by a BARE (single-segment) name (`.inner-locked-mixin()`,
 *     `.m(1)`) — a leaky per-scope registration the eval pass performs when the OUTER
 *     mixin body evals into the caller scope;
 *   - a nested def reached by a path whose HEAD segment is NOT a statically-authored
 *     top-level container.
 *
 * Conservative over-approximation: any nested-def name reached by a call that is not a
 * clean authored-namespace path defers the WHOLE tree. Zero-cost when no nested def is
 * present (the caller only invokes this once a nested def is found). Paid once per root.
 */
function nestedDefNeedsDynamicRegistration(root: Node): boolean {
  // Names of all nested Mixin defs (last selector segment), plus whether ANY nested def
  // is wrapped in an interpolated-selector ancestor (never statically path-reachable).
  const nestedDefNames = new Set<string>();
  let hasInterpolatedNestedDef = false;
  for (const node of root.walk(true)) {
    if (!isNode(node, N.Mixin)) {
      continue;
    }
    for (const inner of node.walk(true)) {
      if (inner === node || !isNode(inner, N.Mixin)) {
        continue;
      }
      if (inner.name === undefined) {
        // A nameless Mixin is a DETACHED RULESET (`@map: { … }`), a map-lookup value —
        // not a callable needing registration. Ignore it.
        continue;
      }
      if (typeof inner.name !== 'string') {
        // An INTERPOLATED callable name (`.@{n}`) — dynamic, never statically reachable.
        hasInterpolatedNestedDef = true;
        continue;
      }
      nestedDefNames.add(lastPathSegment(inner.name));
      // An interpolated-selector container BETWEEN `node` and `inner` means the def's
      // enclosing scope name is dynamic — no static path reaches it.
      let cur: Node | undefined = inner.parent;
      while (cur && cur !== node) {
        if (isNode(cur, N.Ruleset) && rulesetHasInterpolatedSelector(cur)) {
          hasInterpolatedNestedDef = true;
          break;
        }
        cur = cur.parent;
      }
    }
  }
  if (nestedDefNames.size === 0 && !hasInterpolatedNestedDef) {
    return false;
  }
  if (hasInterpolatedNestedDef) {
    return true;
  }
  // Authored top-level container names (root-direct `#ns` / `.foo` Ruleset or Mixin) —
  // the valid HEAD of a static namespace path. A path whose head is one of these + whose
  // tail names a nested def is `findMixinPath`-resolvable; anything else needs dynamic reg.
  const authoredHeads = new Set<string>();
  const rootRules = isNode(root, N.Rules) ? root.rules : undefined;
  if (rootRules) {
    for (const child of rootRules) {
      if (isNode(child, N.Ruleset)) {
        const local = flatLocalSelector(child);
        if (local !== undefined) {
          authoredHeads.add(lastPathSegment(String(local.valueOf())));
        }
      } else if (isNode(child, N.Mixin) && typeof child.name === 'string') {
        authoredHeads.add(lastPathSegment(child.name));
      }
    }
  }
  // Any CALL whose tail names a nested def but is NOT a clean authored-namespace path
  // defers the whole tree.
  for (const n of root.walk(true)) {
    if (!isNode(n, N.Call) || !isNode(n.name, N.Reference)) {
      continue;
    }
    const key = n.name.key;
    if (typeof key !== 'string') {
      continue;
    }
    const segments = splitCallPath(key);
    if (segments.length === 0) {
      continue;
    }
    const tail = segments[segments.length - 1]!;
    if (!nestedDefNames.has(tail)) {
      continue;
    }
    // The tail names a nested def. Foldable ONLY as a multi-segment path whose head is an
    // authored top-level container. A bare (single-segment) call, or a path with a
    // non-authored head, needs dynamic registration.
    if (segments.length < 2 || !authoredHeads.has(segments[0]!)) {
      return true;
    }
  }
  return false;
}

/** Last `.`/`>`/whitespace-delimited segment of a mixin path key (`#library.core.colors` → `.colors`). */
function lastPathSegment(name: string): string {
  const segs = splitCallPath(name);
  return segs.length ? segs[segs.length - 1]! : name;
}

/**
 * Split a mixin call/selector path key into its member segments, preserving the leading
 * `.`/`#` sigil of each (`#library.core.colors` → [`#library`, `.core`, `.colors`];
 * `#foo-foo>.bar` → [`#foo-foo`, `.bar`]). Combinators/whitespace between segments are
 * separators; a purely-static string is assumed (interpolated names never reach here —
 * they are non-string and handled separately).
 */
function splitCallPath(key: string): string[] {
  const segments: string[] = [];
  const re = /[.#][^.#>\s]+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(key)) !== null) {
    segments.push(match[0]);
  }
  return segments;
}

/** True if a Ruleset's own selector carries interpolation (`.@{name}` / `@{sel}`) — a dynamic name. */
function rulesetHasInterpolatedSelector(node: Node): boolean {
  const local = flatLocalSelector(node);
  if (local === undefined) {
    return true; // no flat static selector → treat as dynamic
  }
  return String(local.valueOf()).includes('@{') || String(local.valueOf()).includes('${');
}

/**
 * True for a property-MERGE declaration (`prop+:` / `prop+_:` / `&,:` / `&_:`),
 * not a var decl. Matches the RAW parser assign vocabulary (`+,:` is the parser's
 * form of a comma `+:` merge — normalized to `+:` only at eval time in
 * `declaration.ts`), so a static pre-eval scan sees it. Consulted by the
 * direct-body merge gate (`bodyHasDirectMergeDecl`).
 */
function isMergeDecl(node: Node): boolean {
  if (!isNode(node, N.Declaration) || isNode(node, N.VarDeclaration)) {
    return false;
  }
  const options = node.options as { assign?: string; normalizedFromAssign?: string } | undefined;
  const assign = options?.normalizedFromAssign ?? options?.assign;
  return assign !== undefined && RAW_MERGE_ASSIGNS.has(assign);
}

/**
 * The RAW parser-emitted merge assign operators (pre-eval). `+,:` is the parser's
 * comma-`+:` form (`declaration.ts` maps it to the normalized `+:` at eval); `&,:`
 * / `&_:` are the ampersand-merge forms. A static scan (the gates) must key on
 * these, distinct from `MERGE_ASSIGNS` (the NORMALIZED forms `isSimpleSpineLeaf`
 * admits after eval-time normalization).
 */
const RAW_MERGE_ASSIGNS = new Set(['+:', '+,:', '+_:', '&,:', '&_:']);

/**
 * True if the tree has a Mixin definition nested INSIDE a container whose
 * ENCLOSING chain (strictly between the mixin and the document root) BINDS a name
 * — a variable declaration OR an enclosing mixin's params.
 *
 * This USED to gate such a tree onto the eval path (its closure over an
 * intermediate-scope binding did not resolve on the spine). Fold #6 lifted that
 * eligibility gate: the closure now folds byte-identical (definition-scope `.parent`
 * wiring at pass entry + surface-frame re-parent under the sink). The predicate is
 * RETAINED as the cheap trigger for `wireSpineDefinitionScopeParents` — the eager
 * parent-wiring pass runs ONLY when a tree actually carries a nested mixin closing
 * over an intermediate binding, so the common corpus shape (root-level defs,
 * var-free namespaces) pays nothing. It is a superset (conservatively sound) of the
 * shapes that strictly need the wiring; over-triggering only costs an extra
 * output-invisible parent-wiring walk, never a correctness or fold-coverage change.
 *
 * A ROOT-direct-child Mixin has an empty strictly-intermediate chain, so it never
 * triggers the wiring (the common corpus shape).
 */
function treeHasNestedMixinClosingOverVarScope(root: Rules): boolean {
  // TOP-DOWN descent over scope bodies, carrying whether any STRICTLY-intermediate
  // enclosing scope (below root, above the mixin) declares a variable. A raw parse
  // tree does NOT wire `.parent` on nested nodes, so ancestry must be tracked on the
  // way DOWN, not walked up. Root's own body children are visited with
  // `intermediateHasVar = false` (root is not an intermediate scope — its frame is
  // live for the whole pass).
  const visit = (children: readonly Node[], intermediateHasVar: boolean): boolean => {
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      if (isNode(child, N.Mixin)) {
        // This mixin is nested (visited below root). If any intermediate scope
        // between root and here binds a name (a var-decl OR an enclosing mixin's
        // PARAMS), its closure lives on a live frame the spine does not establish
        // mid-descent — defer.
        if (intermediateHasVar) {
          return true;
        }
        // Descend the mixin body: this mixin is an intermediate scope for any
        // DEEPER mixin, and it binds names iff it declares direct var-decls OR takes
        // params (a nested mixin reading an enclosing mixin's param — a live-frame
        // closure the spine defers, same as an intermediate var).
        const params = child.params;
        const bindsNames = scopeDeclaresAnyVariable(child) || (params !== undefined && params.value.length > 0);
        if (visit(child.rules, intermediateHasVar || bindsNames)) {
          return true;
        }
        continue;
      }
      if (isNode(child, N.Rules)) {
        // A nested Rules scope (ruleset / at-rule body / pure group). Its own body's
        // mixins see this scope as intermediate; propagate whether it declares a var.
        if (visit(child.rules, intermediateHasVar || scopeDeclaresAnyVariable(child))) {
          return true;
        }
      }
    }
    return false;
  };
  return visit(root.rules, false);
}

/**
 * True if a Rules-derived scope (Rules / Ruleset / AtRule / Mixin) declares any
 * variable as a DIRECT child (`@x: …`). Used by the narrow nested-mixin-closure
 * gate — a strictly-intermediate enclosing scope with a variable is a potential
 * closure the spine defers. Direct children only: a variable in a deeper nested
 * scope belongs to THAT scope, not this one.
 */
function scopeDeclaresAnyVariable(scope: { rules: readonly Node[] }): boolean {
  const children = scope.rules;
  for (let i = 0; i < children.length; i++) {
    if (isNode(children[i]!, N.VarDeclaration)) {
      return true;
    }
  }
  return false;
}

/**
 * Establish the `.parent` chain of every nested SCOPE in the source tree (cutover
 * MIXIN fold #6) — the definition-scope wiring a folded nested-mixin call needs.
 *
 * A raw parse tree leaves `.parent` UNSET on nested nodes; the eval pass wires it
 * via `adopt` while descending each scope. A folded call to a nested mixin resolves
 * the mixin's definition-scope frame from `candidate.parent.getScopeFrame()`, so
 * that link must exist even when the spine never descends the definition's scope
 * (it emits only the caller). Recursively `adopt` each scope body's children so a
 * nested Mixin/Ruleset's `.parent` points at its enclosing scope — the SAME links
 * eval eventually sets (verified: eval wires `.paint.parent = .util`), reached
 * eagerly here. Output-INVISIBLE: `.parent` affects scope resolution, not bytes.
 *
 * `adopt` is idempotent for an already-correctly-parented / frozen child (it skips
 * the reparent), and its flag propagation re-folds the same structural flags the
 * parse already bubbled — so re-running it is a no-op for flags. Only descends
 * Rules-derived scopes (Rules/Ruleset/AtRule/Mixin); leaf children are wired but not
 * recursed into.
 */
function wireSpineDefinitionScopeParents(scope: Rules): void {
  const children = scope.rules;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (child.parent === undefined) {
      scope.adopt(child);
    }
    // A Rules-derived node (Rules/Ruleset/AtRule/Mixin) is itself a scope with a
    // `.rules` body — recurse. The `N.*` union guard does not narrow to the `Rules`
    // base in TS, so a checked assertion is needed (same pattern as elsewhere in
    // this module); all four types extend `Rules`, so the shape is sound.
    if (isNode(child, N.Rules | N.Ruleset | N.AtRule | N.Mixin)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      wireSpineDefinitionScopeParents(child as unknown as Rules);
    }
  }
}

/** Deep: any Call in the tree that is a spine-eligible mixin call. */
function treeHasMixinCall(root: Node): boolean {
  for (const node of root.walk(true)) {
    if (isSpineEligibleMixinCall(node)) {
      return true;
    }
  }
  return false;
}

/** Deep: any Ruleset in the tree whose selector is an InterpolatedSelector. */
function treeHasInterpolatedSelectorRuleset(root: Node): boolean {
  for (const node of root.walk(true)) {
    if (!isNode(node, N.Ruleset)) {
      continue;
    }
    const selector = (node as Ruleset).selector;
    if (selectorHasInterpolatedSelector(selector)) {
      return true;
    }
  }
  return false;
}

/** True if `selector` is (or contains) an `InterpolatedSelector` node. */
function selectorHasInterpolatedSelector(selector: unknown): boolean {
  if (!selector || typeof selector === 'string') {
    return false;
  }
  if (Array.isArray(selector)) {
    return selector.some(item => selectorHasInterpolatedSelector(item));
  }
  if (!(selector instanceof Node)) {
    return false;
  }
  if (selector.type === 'InterpolatedSelector') {
    return true;
  }
  for (const descendant of selector.walk(true)) {
    if (descendant.type === 'InterpolatedSelector') {
      return true;
    }
  }
  return false;
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
/**
 * Render the queued top-of-doc `@import` at-rules to a string (IMPORTS increment 1).
 * Mirrors the depth-0 `@import` emit in `_toDocumentString`: each queued rule is
 * `writeSyntax`-serialized into a fresh writer, one per line. CSS-passthrough
 * imports the spine folded were queued here; static preludes carry no
 * interpolation, so no prelude re-eval is needed (unlike the eval path's `$`
 * check, which serves interpolated CSS-import preludes — deferred with the
 * interpolated-path lane). Returns '' when nothing is queued.
 */
function renderQueuedTopImports(context: Context, options: FinalPrintOptions): string {
  const topImports = context.topImports;
  if (!topImports?.length) {
    return '';
  }
  let out = '';
  for (let i = 0; i < topImports.length; i++) {
    const importRule = topImports[i]!;
    const writer = new OutputWriter();
    importRule.writeSyntax(getPrintOptions({ ...options, writer, depth: 0 }));
    out += `${writer.toString()}\n`;
  }
  return out;
}

/**
 * Sentinel returned by `renderRootViaSpine` when the post-wire RE-GATE (import-spec routing) determines
 * the speculatively-admitted tree is not foldable — the caller (`Rules.render`) re-renders via the eval
 * path. Distinct object identity so it is never confused with rendered text.
 */
export const SPINE_ABORT_TO_EVAL = Symbol('spine-abort-to-eval');

export function renderRootViaSpine(
  root: Rules,
  context: Context,
  options: FinalPrintOptions
): MaybePromise<string | typeof SPINE_ABORT_TO_EVAL> {
  spineRenderCounter.rootRenders++;
  // EXTEND-WORK GATE (design §4.0). Decide ONCE, here, whether this render must
  // engage the extend layer or stays a pure streaming spine. When the tree carries
  // no `:extend`, `engageExtendLayer` returns false and the pass streams headers
  // inline with ZERO extend cost — the common case. When true, the FLAT (root-direct-
  // child) topology is wired below (P3 increment 1): a pre-scan gathers instructions,
  // composes each subject's final Or-branch header, and installs it as a render-local
  // override. A NON-flat extend shape is kept OFF the spine by `isSpineEligibleRoot`
  // (`isSpineExtendTopology`), so reaching this with a non-flat shape is a fail-loud
  // invariant breach — the streaming descent cannot apply nested extends.
  //
  // IMPORT-SPEC: when imports are present the sync gate admits SPECULATIVELY (an imported subject is
  // invisible to the sync topology check), so this invariant check would fire a false breach. Skip it
  // for the import case — the post-wire RE-GATE (`wireExtends`) is the authority and aborts to eval
  // cleanly if the resolved shape is not foldable.
  const extendEngaged = engageExtendLayer(root);
  const initialWriterMark = options.writer ? options.writer.mark() : 0;
  // Computed ONCE and reused by the extend re-gate below (the invariant check + `wireImports`), so the
  // import-work scan runs at most once per root render.
  const importLayer = engageImportLayer(root);
  if (extendEngaged && !importLayer
    && !isSpineExtendTopology(root, options.collapseNesting === true)) {
    throw new Error(
      'spine extend: unsupported topology reached renderRootViaSpine (gate admits only the proven shapes)'
    );
  }
  // Mark the whole descent spine mode: nested containers render via the
  // structural serializer against a live frame (no eval, no output tree) and
  // leaves resolve live — see serialize-helper `spineMode` + Ruleset.render.
  // ABORT-TO-EVAL: capture the prior `spineMode` so an abort restores it — eval's serialize gates its
  // import-fold on `spineMode` (rules.ts), so a leaked `true` would make eval BOTH fold the import via
  // the spine path AND emit it itself → double output. The abort must hand eval a clean state.
  const savedSpineMode = options.spineMode;
  const savedSpineImportPlacements = options.spineImportPlacements;
  options.spineMode = true;
  // Per-position bookkeeping: number the body children BEFORE building the scope
  // frame, so the frame's declaration buckets carry source indices and a
  // re-declared / `snapshot` read resolves against the binding at its position.
  assignSpineChildIndices(root);
  // NESTED-MIXIN DEFINITION-SCOPE WIRING (cutover MIXIN fold #6). A folded call to a
  // NESTED mixin resolves the mixin's definition-scope frame from the candidate
  // node's `.parent` chain (`prepareCallableCandidateState` →
  // `definitionParent.getScopeFrame()`). On a raw PARSE tree that chain is UNSET —
  // eval wires it via `adopt` while DESCENDING the definition's scope, but the spine
  // never descends a scope it does not emit into (e.g. `.util` when only `.consumer`
  // calls `.util.paint()`). So a closure over an intermediate-scope local
  // (`.util { @local: red; .paint() { color: @local } }`) or a shadowed name would
  // resolve against the wrong (root/caller) frame. Eagerly establish the SAME
  // parent links eval eventually sets — an output-INVISIBLE source-tree wiring
  // (like `assignSpineChildIndices`), matching eval's end state exactly. Gated on
  // the nested-mixin-closure shape so a tree without one pays nothing.
  if (treeHasNestedMixinClosingOverVarScope(root)) {
    wireSpineDefinitionScopeParents(root);
  }
  // Value-frame push: make the root's scope frame live for the whole descent,
  // and point the document root/tree-root at the SOURCE root (what the eval pass
  // used to establish). No eval() is called — the descent below resolves each
  // leaf against this live frame in place.
  root.getScopeFrame();
  const savedRoot = context.root;
  const savedTreeRoot = context.treeRoot;
  const savedTreeContext = context.treeContext;
  const savedSpineOwnsRoot = context.spineOwnsRoot;
  context.root ??= root;
  // The spine now owns `context.root` — a detached-ruleset/mixin body evaluated
  // inside the fold must NOT reclaim outermost-root status and clobber it (which
  // would drop the built-in function registry). See `Context.spineOwnsRoot`.
  context.spineOwnsRoot = true;
  // Establish the per-file TREE CONTEXT the eval path sets via
  // `_setupContextForRules`: `treeContext.file.path` is the current file, which
  // relative-asset resolution (`data-uri('image.svg')` → `readAsset` →
  // `resolveAssetPath`) and math/leaky-rules mode read. The spine skips eval, so
  // without this a relative `data-uri` resolves against `process.cwd()` and falls
  // back to a bare `url(...)`. Mirror the eval path: point treeContext/treeRoot at
  // the SOURCE root's own tree context (only when it carries one).
  if (root._treeContext) {
    context.treeRoot = root;
    if (context.treeContext !== root._treeContext) {
      context.allRoots.push(root);
      context.treeContext = root._treeContext;
    }
  }
  // Value-frame push for the WHOLE root descent. This must be popped only AFTER
  // the body's bytes are in the buffer — NOT via `withValueFrame`'s synchronous
  // `finally`, which pops the instant `toRenderString` RETURNS. When any leaf
  // resolves ASYNC (e.g. `alpha(@var)` — an async less-compat function whose arg
  // reads a variable), that leaf's value resolution runs in a later microtask; a
  // synchronous root pop would clobber `context.rulesContext` (setting it back to
  // the pre-root value, undefined) BEFORE the pending arg lookup runs, so the arg
  // ref resolves against no frame and throws "not defined". This is the root-level
  // form of the B1s invariant (design §2.3): the value frame stays live until the
  // async descent settles, mirroring `serializeSpineFrameContainer`'s chained
  // restore. Nested containers already chain their own restore on the body promise.
  const savedRulesContext = context.rulesContext;
  const finish = (body: string): string => {
    context.rulesContext = savedRulesContext;
    context.root = savedRoot;
    context.treeRoot = savedTreeRoot;
    context.treeContext = savedTreeContext;
    context.spineOwnsRoot = savedSpineOwnsRoot;
    const trimmed = body.trimEnd();
    const bodyText = trimmed ? `${trimmed}\n` : '';
    // Top-of-doc `@import` lane (IMPORTS increment 1): CSS-passthrough imports
    // folded during the descent were queued to `context.topImports` (the KEPT
    // emitter). The spine's body carries none of them inline, so PREPEND them here
    // — the same document framing `_toDocumentString` applies at depth 0 (`@import`
    // after `@charset`, before other rules). Charset is already gated OUT of the
    // spine (`isSpineEligibleRoot`), so only imports need prepending.
    const importPrelude = renderQueuedTopImports(context, options);
    return importPrelude ? `${importPrelude}${bodyText}` : bodyText;
  };
  const fail = (error: unknown): never => {
    context.rulesContext = savedRulesContext;
    context.root = savedRoot;
    context.treeRoot = savedTreeRoot;
    context.treeContext = savedTreeContext;
    context.spineOwnsRoot = savedSpineOwnsRoot;
    throw error;
  };
  // Descend the SOURCE root's body ONCE in render mode: the statement-framing
  // machinery (separators, `;`, trivia, indentation) is the kept structural
  // serializer (design §7 "survives"); the value resolution happens against the
  // live frame threaded here. `toRenderString` runs `_emitRulesBody('render')`,
  // which for each leaf resolves via `node.render(context)` at its emit moment.
  context.rulesContext = root;
  const descend = (): MaybePromise<string> => {
    let step: MaybePromise<string>;
    try {
      step = root.toRenderString(options);
    } catch (error) {
      return fail(error);
    }
    return isThenable(step) ? step.then(finish, fail) : finish(step);
  };
  // ABORT-TO-EVAL (import-spec routing, speculative-admit-then-abort). The sync gate speculatively
  // admits an extend-bearing import tree; the RE-GATE below re-checks the extend topology against the
  // RESOLVED imported subjects. If the resolved shape is NOT provably foldable, abort to eval — a CLEAN
  // pre-first-byte fall-back: reset the context (`fail`'s restore, but return instead of throw), roll
  // back the CSS-passthrough `topImports` the wire queued (so eval does not double-count), and signal
  // the caller (`Rules.render`) to re-render via the eval path. No byte was written (asserted below), so
  // the abort output equals eval's exactly. Only reachable for an import+extend tree whose re-gate fails.
  const topImportsBaseline = context.topImports?.length ?? 0;
  const abortToEval = (): typeof SPINE_ABORT_TO_EVAL => {
    // No byte may have been emitted before an abort (the re-gate runs before `descend`). Fail loud if
    // the invariant is violated — a post-emit abort could not equal eval's output.
    if (options.writer && options.writer.mark() !== initialWriterMark) {
      throw new Error('spine abort-to-eval: bytes were emitted before the re-gate (invariant breach)');
    }
    // Roll back CSS-passthrough imports the wire pass queued so the eval re-render owns them once.
    if (context.topImports && context.topImports.length > topImportsBaseline) {
      context.topImports.length = topImportsBaseline;
    }
    // Restore spine-only render state so eval's serialize does not see a leaked `spineMode` (which
    // would make it BOTH fold the import via the spine path AND emit it → double output) or a stale
    // placement cache. Eval re-resolves imports itself.
    options.spineMode = savedSpineMode;
    options.spineImportPlacements = savedSpineImportPlacements;
    context.rulesContext = savedRulesContext;
    context.root = savedRoot;
    context.treeRoot = savedTreeRoot;
    context.treeContext = savedTreeContext;
    return SPINE_ABORT_TO_EVAL;
  };
  // EXTEND (P3, document-wide gather). Gather every `:extend` instruction with its extender
  // BUCKET PATH + compose the per-subject header overrides BEFORE the body descent, so
  // `Reaching(S)` is fully known at every subject's emit position (§4.0 → header final inline,
  // no deferral, even for nested extenders). The override map is installed on
  // `options.spineExtendHeaders`, which `Ruleset.effectiveHeaderSelector` consults so a subject
  // emits its composed Or-branch header. Pure structural (selector-graph) — synchronous.
  //
  // RE-GATE (import-spec routing). Runs AFTER `wireSpineImports` has resolved the placements, so the
  // imported ROOT-LEVEL subjects are now known. When the tree has imports, re-run the STRICT extend
  // topology over the union of local + imported subjects; a failure aborts to eval. Then gather over
  // BOTH the root body and the resolved imported bodies so an imported subject receives its header.
  const wireExtends = (): MaybePromise<string | typeof SPINE_ABORT_TO_EVAL> => {
    if (extendEngaged) {
      let importedBodies: Rules[] | undefined;
      let referenceBodies: Set<Rules> | undefined;
      if (importLayer) {
        const collected = collectImportedRootSubjects(options);
        if (!isSpineExtendTopology(root, options.collapseNesting === true, { importedRootSubjects: collected.subjects })) {
          return abortToEval();
        }
        // REFERENCE-EXTEND NARROW FOLD. The reference-body subject fold (own-form dropped) is
        // proven byte-identical only for the SIMPLE shape: a reference body of PLAIN root-level
        // rulesets, extended by a plain root-level extender in the importing file. Richer reference
        // shapes — a reference body carrying its OWN `:extend`/`&`-selectors, nested containers,
        // at-rules/namespaces, or `(reference, multiple)` — compose under different rules and stay
        // EVAL-owned (byte-identical); abort the whole tree to eval when any is present. (RESIDUAL,
        // ratchet-locked — `import-reference-issues` corpus.)
        if (collected.referenceBodies.size > 0
          && ![...collected.referenceBodies].every(isSimpleReferenceFoldBody)) {
          return abortToEval();
        }
        importedBodies = collected.bodies;
        referenceBodies = collected.referenceBodies;
      }
      try {
        const { headers, hoisted } = wireSpineExtends(root, context, options.collapseNesting === true, importedBodies, referenceBodies);
        options.spineExtendHeaders = headers;
        // §4.3 hoist: subjects whose override is a full root-composed projection (`&`-crossing) —
        // their header emits VERBATIM (skip parent compose). Strictly the crossing subset.
        options.spineExtendHoisted = hoisted;
      } catch (error) {
        return fail(error);
      }
    }
    return descend();
  };
  // IMPORTS (increment 2, document-wide scope registration). Resolve every foldable
  // StyleImport at the ROOT body ONCE, REGISTER the imported placement's scope into its
  // frame (`prepareRegistration`), and LINK that frame as a fallback of the root's live
  // frame — so an importer that CONSUMES an imported symbol (`#library.sizes[@width]`,
  // an imported `@var`/mixin) resolves against the linked scope during the descent,
  // WITHOUT the eval fallback. The resolved placement is cached on
  // `options.spineImportPlacements` so the emit fold descends the SAME registered body
  // (resolve + register exactly once). Async (`getTree`) — rides the isThenable bail.
  // The extend RE-GATE (`wireExtends`) chains AFTER this so it sees the resolved placements.
  // INTERPOLATED-PATH resolution failure (import-spec routing). An interpolated `@import` path
  // (`@import "theme-@{t}.less"`) is admitted speculatively; the wire pass resolves it against the
  // live frame. Case (A) (downward-resolvable) folds; case (B) (forward-dependent — the var bound by
  // a LATER import) is DEFERRED + retried inside `wireSpineImportsInBody` (mirroring eval's
  // `pendingImports` reorder) and folds too. `_isPathResolutionError` surfaces HERE only when the
  // deferred drain STILL can't resolve the path (the var never binds / a cyclic path dependency) —
  // a CLEAN pre-first-byte abort point: route to eval (which owns the same reorder + reports the
  // genuine error identically), byte-identical. A genuine error (missing file, parse failure) is NOT
  // a path-resolution error and propagates via `fail`.
  const onWireError = (error: unknown): string | typeof SPINE_ABORT_TO_EVAL | never =>
    isSpinePathResolutionError(error) || isSpineDeferredUnsupportedError(error)
      ? abortToEval()
      : (fail(error) as never);
  const wireImports = (): MaybePromise<string | typeof SPINE_ABORT_TO_EVAL> => {
    if (!importLayer) {
      return wireExtends();
    }
    let wired: MaybePromise<void>;
    try {
      wired = wireSpineImports(root, context, options);
    } catch (error) {
      return onWireError(error);
    }
    return isThenable(wired) ? wired.then(wireExtends, onWireError) : wireExtends();
  };
  // M8 (interpolated-selector callable). When an interpolated-selector ruleset
  // (`.@{name} {}`) is present it may be a mixin CALL target — its callable identity
  // is an eval-pass side effect (`selector.eval` → `ownSelector`) the spine otherwise
  // skips. Replicate it at root-enter so a subsequent `.foo()` resolves. Gated on the
  // shape (`treeHasInterpolatedSelectorRuleset`), so a shape-free tree pays nothing.
  // May be async (the selector's interpolation can read an async value) — rides the
  // isThenable bail into the chain, exactly like `wireSpineImports`.
  if (treeHasInterpolatedSelectorRuleset(root)) {
    let wired: MaybePromise<void>;
    try {
      wired = wireSpineInterpolatedSelectorCallables(root, context);
    } catch (error) {
      return fail(error);
    }
    return isThenable(wired) ? wired.then(wireImports, fail) : wireImports();
  }
  return wireImports();
}

/**
 * M8: register an interpolated-selector ruleset's callable identity at spine
 * root-enter — the eval-pass side effect the spine skips.
 *
 * Eval's `Rules.prepareRegistration` resolves each non-static-name node's identity
 * (`Ruleset.prepareRegistration` → `selector.eval` turns `.@{name}` into `.foo`,
 * writes the resolved `ownSelector`, marks `registrationPrepared`) and swaps the
 * prepared node into its parent slot — after which `collectCallablesFor` keys the
 * callable bucket on the resolved name, so `.foo()` finds it. The spine descent
 * never runs registration prep on the root body, so those identities stay
 * unresolved and the call misses ("No matching mixins").
 *
 * This runs the SAME machinery eval runs (`root.prepareRegistration`) — idempotent
 * (guarded by `_registrationPrepared`), output-invisible (name registration only, no
 * eval of bodies), producing the exact end-state eval reaches: resolved `ownSelector`
 * on the interpolated rulesets and a callable cache keyed on the concrete name. It
 * registers all root names, not only the interpolated ones, but that is a byte-neutral
 * superset — the spine descent already resolves each leaf against the same frame
 * (`getScopeFrame`), so pre-registering the static names changes no output; only the
 * interpolated-selector identities were otherwise missing. Gated by the caller on the
 * shape, so it is paid only when an interpolated-selector ruleset is present.
 */
function wireSpineInterpolatedSelectorCallables(root: Rules, context: Context): MaybePromise<void> {
  const prepared = root.prepareRegistration(context);
  if (isThenable(prepared)) {
    return prepared.then(() => undefined);
  }
}

/**
 * Register + link every foldable ROOT-level import's scope BEFORE the descent
 * (IMPORTS increment 2 — the registration-during-fold mechanism).
 *
 * For each spine-foldable `StyleImport` (or CSS-passthrough `@import` statement) in
 * the root body, in document order:
 *   - CSS-passthrough → cached `{ kind: 'css' }` (queued to `context.topImports` by
 *     `resolveForSpine`; no scope to register). A CSS `@import` STATEMENT provides no
 *     scope and needs no wiring — skipped.
 *   - Less import → `resolveForSpine` yields the parsed placement body; run its
 *     `prepareRegistration` (seeds the placement frame with the imported body's vars /
 *     mixins / namespaces), then `linkImportFallbackFrame(rootFrame, placementFrame)`
 *     so an importer consumer resolves the imported symbol on the fallback chain
 *     (consulted AFTER the primary scope, so a local binding always wins — the same
 *     discipline `linkInlineImportFallbackFrames` uses on the eval path). Cache the
 *     registered placement so the emit fold descends the SAME body.
 *
 * REGISTRATION-DURING-DESCENT INVARIANT: registration seeds NAMES only (no body
 * eval, no output tree) — `Rules.derive` stays 0. The placement's OUTPUT is emitted
 * later by the descent against this now-linked frame; its SCOPE is available the
 * instant the descent begins. Async (`getTree` / `prepareRegistration`).
 */
function wireSpineImports(
  root: Rules,
  context: Context,
  options: FinalPrintOptions
): MaybePromise<void> {
  return wireSpineImportsInBody(root.rules, root.getScopeFrame(), context, options);
}

/**
 * Collect the RESOLVED imported ROOT-LEVEL subjects for the extend RE-GATE (import-spec routing).
 *
 * After `wireSpineImports` has cached each foldable import's resolved placement body, an imported file's
 * root-level ruleset (`.a` in `lib.less`) is an addressable extend SUBJECT: its Ruleset node emits during
 * the descent (`_emitSpineImportFold` → `emitNode`), so a header override keyed on it lands. Return each
 * such subject's flat local selector TEXT (for the re-gate's target correspondence) AND its placement
 * `Rules` body (for `wireSpineExtends` to descend). Skips `css` (no scope), `dedupe` (no output), and
 * `reference` (reference-mode bodies emit under different rules — gated off the spine anyway) entries.
 *
 * The bodies are the SAME node instances the emit fold descends, so the override attaches to the emitted
 * ruleset. Only root-DIRECT-child rulesets are collected — a nested imported subject is not addressed by
 * a root-level header (the same restriction the local gather's root-subject clause uses).
 *
 * REFERENCE-MODE subjects are collected too (they are addressable extend targets — `@import (reference)`
 * suppresses their OWN output but an extend still reaches into them). They are returned as a SEPARATE
 * `referenceBodies` set so `wireSpineExtends` marks their gathered subjects `reference: true`: the header
 * override then DROPS the subject's own branch (the reference-suppressed original), leaving only the
 * extender branches — reproducing the eval-path `F_EXTEND_TARGET` reference-filter byte-identically.
 */
function collectImportedRootSubjects(options: FinalPrintOptions): {
  subjects: Set<string>;
  bodies: Rules[];
  referenceBodies: Set<Rules>;
} {
  const subjects = new Set<string>();
  const bodies: Rules[] = [];
  const referenceBodies = new Set<Rules>();
  const cache = options.spineImportPlacements;
  if (!cache) {
    return { subjects, bodies, referenceBodies };
  }
  for (const entry of cache.values()) {
    if (entry.kind !== 'fold' || entry.dedupe) {
      continue;
    }
    bodies.push(entry.body);
    if (entry.reference) {
      referenceBodies.add(entry.body);
    }
    for (const child of entry.body.rules) {
      if (isNode(child, N.Ruleset)) {
        const local = flatLocalSelector(child);
        if (local !== undefined) {
          subjects.add(String(local.valueOf()));
        }
      }
    }
  }
  return { subjects, bodies, referenceBodies };
}

/**
 * A `@import (reference)` body whose extend-fold is the proven-simple shape: EVERY root-level
 * child is a PLAIN `Ruleset` — a non-`&`, non-`:extend`-bearing selector with a body of value
 * leaves only (no nested container child). Such a body's subjects fold via the header-drop
 * (own-form suppressed, extender-only header). A body with an at-rule, a nested container, a
 * namespace, a `&`/interpolated selector, or its OWN `:extend` composes under different rules and
 * stays eval-owned — reported false so the caller aborts to eval.
 */
function isSimpleReferenceFoldBody(body: Rules): boolean {
  for (const child of body.rules) {
    if (isNode(child, N.Comment)) {
      continue;
    }
    if (!isNode(child, N.Ruleset)) {
      return false; // at-rule / nested-import wrapper / non-ruleset — not the simple shape
    }
    const local = flatLocalSelector(child);
    if (local === undefined || String(local.valueOf()).includes('&')) {
      return false; // `&`/interpolated/selector-list surface the header-drop does not model
    }
    if (Ruleset.hasExtendedTopLevelSelector(child.selector) || rulesetBodyHasExtend(child.rules)) {
      return false; // the reference body carries its OWN extend — composes under different rules
    }
    for (const grandchild of child.rules) {
      if (isNode(grandchild, N.Ruleset | N.AtRule | N.Rules)) {
        return false; // a nested container inside the reference ruleset — not the simple shape
      }
    }
  }
  return true;
}

/** True if any DIRECT child of `children` is an `Extend`/`ExtendList` (a body-level `:extend`). */
function rulesetBodyHasExtend(children: readonly Node[]): boolean {
  for (const child of children) {
    if (child.type === 'Extend' || child.type === 'ExtendList') {
      return true;
    }
  }
  return false;
}

/**
 * Register + link every foldable import that is a DIRECT child of `children` into
 * `targetFrame` (IMPORTS increment 3 — generalized nested-scope wiring). The root
 * pass (`wireSpineImports`) passes the root body + root frame; a NESTED container
 * (a ruleset / at-rule with a body import) passes its own body + own frame from
 * `serializeSpineFrameContainer` at container-enter — so an `@import` inside a
 * `@media`/ruleset links its imported scope to the ENCLOSING container's frame, and
 * a consumer in that container body resolves the imported symbol on the fallback
 * chain (consulted AFTER the container's primary scope, so a local binding wins).
 *
 * Per DIRECT-child foldable import, in document order, each isolated from the next:
 *   - CSS-passthrough → cached `{ kind: 'css' }` (queued top-of-doc; no scope).
 *   - Less import → `resolveForSpine` yields the parsed placement (parented to the
 *     current `context.rulesContext` — the container at wire time), `prepareRegistration`
 *     seeds its frame with the imported vars/mixins/namespaces, then
 *     `linkImportFallbackFrame(targetFrame, placementFrame)`. Cached so the emit fold
 *     descends the SAME registered body.
 *
 * REGISTRATION-DURING-DESCENT INVARIANT: registration seeds NAMES only — no body
 * eval, no output tree (`Rules.derive` = 0). The placement's OUTPUT is emitted later
 * by the descent against the now-linked frame; its SCOPE is available the instant
 * the container body descent begins. Async (`getTree` / `prepareRegistration`).
 */
function wireSpineImportsInBody(
  children: readonly Node[],
  targetFrame: ScopeFrame,
  context: Context,
  options: FinalPrintOptions
): MaybePromise<void> {
  const cache = (options.spineImportPlacements ??= new Map());
  // FORWARD-DEPENDENT interpolated-path DEFER lane (case B, IMPORTS increment 6 Tier-B).
  // An interpolated `@import` path (`@import "theme-@{t}.less"`) whose var binds in a
  // LATER sibling import is not resolvable at its own document position — `resolveForSpine`
  // throws `_isPathResolutionError`. Instead of aborting the whole tree to eval, mirror the
  // eval loop's `pendingImports`/`drainPendingImports` reorder: DEFER the failing import,
  // continue wiring the rest (which bind the var into `targetFrame` via the fallback link),
  // then RETRY the deferred imports. A retry that still throws is a GENUINE failure (var
  // never bound / cyclic) and propagates — the outer `onWireError` then aborts to eval,
  // byte-identical. One retry-allowed drain + a final non-retry drain matches eval exactly
  // (a single reorder suffices for the acyclic forward dependency; a cycle re-throws).
  const pending: number[] = [];
  const wireOne = (i: number, allowDefer: boolean, deferred: boolean): MaybePromise<void> => {
    const child = children[i]!;
    const importNode = child as StyleImport;
    // ISOLATE per-import context (design §2 async discipline). Each import's
    // resolve + registration transiently mutates `context.treeContext`/`depth`
    // (relative-path resolution + registration setup). Sequentially wiring
    // several imports must not leak one import's treeContext into the NEXT
    // sibling's relative resolution (a deeply-nested import would otherwise
    // resolve its sibling against the wrong directory → dropped output). Snapshot
    // + restore around EACH import's whole wire, on every exit path.
    const savedTreeContext = context.treeContext;
    const savedDepth = context.depth;
    const restoreImportContext = <T>(value: T): T => {
      context.treeContext = savedTreeContext;
      context.depth = savedDepth;
      return value;
    };
    // A FORWARD-dependent interpolated path throws here (sync) or rejects (async). While the
    // defer lane is open, capture it as pending and move on; otherwise it propagates.
    const onResolveError = (error: unknown): never | undefined => {
      if (allowDefer && isSpinePathResolutionError(error)) {
        pending.push(i);
        return undefined;
      }
      throw error;
    };
    const registerAndLink = (resolved: SpineImportResolution): MaybePromise<void> => {
      if (resolved.kind === 'css') {
        cache.set(child, { kind: 'css' });
        return undefined;
      }
      const body = resolved.body;
      // RESIDUAL (ratchet-locked, IOU): a DEFERRED (case-B) import whose body carries an `(inline)`
      // sub-import is NOT foldable byte-identically — eval's retry lane adds a post-inline blank line
      // the clean spine fold does not reproduce. Abort the whole tree to eval for this shape only; the
      // pure case-B shape (plain rulesets / non-inline sub-imports) folds. `import-interpolation`
      // corpus fixture. Case A (downward, non-deferred) is unaffected — its inline body agrees with eval.
      if (deferred && deferredBodyHasInlineImport(body)) {
        throw markDeferredUnsupported();
      }
      const dedupe = spineImportDedupeVerdict(resolved.resolvedPath, resolved.multiple, options);
      const registered = body.prepareRegistration(context);
      const finishRegister = (): MaybePromise<void> => {
        const placementFrame = body.getScopeFrame();
        // TRANSITIVE wiring: a Less import whose OWN body carries a top-level
        // `@import` (an imported file that itself imports another) must link that
        // nested import's scope into THIS placement's frame BEFORE we link the
        // placement upward — otherwise a sibling in the intermediate file
        // (`lib.less`'s `@pad: @z`, where `@z` lives in the transitively-imported
        // `inner.less`) resolves against a frame with no fallback to the nested
        // scope and throws `'z' is not defined`. The nested imports are wired into
        // the placement's own frame (their scope is a fallback consulted after the
        // placement's primary scope), recursively — so an N-deep import chain links
        // each level into its importer. Registration seeds NAMES only (no output
        // tree; `Rules.derive` stays 0). Same document-order/isolation discipline as
        // the outer pass since it reuses `wireSpineImportsInBody`.
        const link = (): void => {
          linkImportFallbackFrame(targetFrame, placementFrame);
          cache.set(child, { kind: 'fold', body, dedupe, multiple: resolved.multiple, reference: resolved.reference });
        };
        const wiredNested = wireSpineImportsInBody(body.rules, placementFrame, context, options);
        return isThenable(wiredNested) ? wiredNested.then(link) : link();
      };
      return isThenable(registered) ? registered.then(finishRegister) : finishRegister();
    };
    let resolution: MaybePromise<SpineImportResolution>;
    try {
      resolution = importNode.resolveForSpine(context);
    } catch (error) {
      restoreImportContext(undefined);
      return onResolveError(error);
    }
    let step: MaybePromise<void>;
    try {
      step = isThenable(resolution)
        ? resolution.then(registerAndLink)
        : registerAndLink(resolution);
    } catch (error) {
      restoreImportContext(undefined);
      return onResolveError(error);
    }
    if (isThenable(step)) {
      return step.then(
        (value) => restoreImportContext(value),
        (error: unknown) => {
          restoreImportContext(undefined);
          return onResolveError(error);
        }
      );
    }
    restoreImportContext(step);
    return undefined;
  };
  const wireFrom = (start: number): MaybePromise<void> => {
    for (let i = start; i < children.length; i++) {
      const child = children[i]!;
      if (!isStyleImportNode(child) || !isSpineFoldableImport(child) || cache.has(child)) {
        continue;
      }
      const wired = wireOne(i, true, false);
      if (isThenable(wired)) {
        return wired.then(() => wireFrom(i + 1));
      }
    }
    return undefined;
  };
  // Drain the deferred (forward-dependent) imports after the main document-order pass has
  // bound their vars. `allowRetry` on the first drain (a deferred import may itself depend
  // on another deferred one, resolved once the first drains); the final drain re-throws a
  // still-unresolvable path so it aborts to eval. Mirrors eval's `drainPendingImports`.
  const drainPending = (allowRetry: boolean): MaybePromise<void> => {
    if (pending.length === 0) {
      return undefined;
    }
    const batch = pending.splice(0);
    const drainRest = (start: number): MaybePromise<void> => {
      for (let k = start; k < batch.length; k++) {
        const wired = wireOne(batch[k]!, allowRetry, true);
        if (isThenable(wired)) {
          return wired.then(() => drainRest(k + 1));
        }
      }
      return undefined;
    };
    const drained = drainRest(0);
    if (isThenable(drained)) {
      return allowRetry ? drained.then(() => drainPending(false)) : drained;
    }
    return allowRetry ? drainPending(false) : drained;
  };
  const mainPass = wireFrom(0);
  return isThenable(mainPass)
    ? mainPass.then(() => drainPending(true))
    : drainPending(true);
}

/**
 * Wire a NESTED container's direct foldable imports at container-enter (IMPORTS
 * increment 3). Called by `serializeSpineFrameContainer` AFTER the container's scope
 * frame is built and BEFORE its body descends, so a consumer inside the container
 * resolves an imported symbol against the container frame's fallback chain. A no-op
 * (returns undefined synchronously) when the body has no foldable import — the
 * common case pays nothing. `targetFrame` is the container's own scope frame.
 */
export function wireSpineContainerImports(
  children: readonly Node[],
  targetFrame: ScopeFrame,
  context: Context,
  options: FinalPrintOptions
): MaybePromise<void> {
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (child.type === 'StyleImport' && isSpineFoldableImport(child)) {
      return wireSpineImportsInBody(children, targetFrame, context, options);
    }
  }
  return undefined;
}
