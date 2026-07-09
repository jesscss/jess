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
import { comparePosition } from './compare.js';
import { Nil } from '../nil.js';
import { Rules } from '../rules.js';
import { Ruleset } from '../ruleset.js';
import type { AtRule } from '../at-rule.js';
import { buildScopeFrame, type BindingCell, type ScopeFrame } from '../scope-frame.js';
import { getPrintOptions, type FinalPrintOptions, type PrintOptions } from './print.js';
import { engageExtendLayer, isSpineExtendTopology, wireSpineExtends } from '../extend/spine-extend.js';
import type { Selector } from '../selector.js';

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
 * True for a plain no-arg mixin CALL the spine may attempt to fold (cutover
 * P3-precursor, UNIFIED-EVAL-EMIT-DESIGN §2/§3). STATIC admissibility only — the
 * candidate's body shape is checked at RUNTIME by `isSpineSimpleMixinSurface`
 * against the resolved bound surface (the definition is not statically bound at
 * the call site). Admitted: a `Call` whose name is a mixin `Reference`, with NO
 * args, NO content block, and none of the legacy `markImportant`/`silentFail`
 * options. This is INCREMENT 1's shape — parametric/guarded/named/rest calls
 * widen this gate in later increments.
 */
export function isSpineEligibleMixinCall(node: Node): boolean {
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
  const options = node.options as { markImportant?: boolean; silentFail?: boolean } | undefined;
  if (options?.markImportant || options?.silentFail) {
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
  if ((type !== 'mixin' && type !== 'mixin-ruleset') || typeof name.key !== 'string') {
    return false;
  }
  // EXCLUDED: a NAMESPACE-PATH / cross-scope call (`.scope > .mixin()`, `#ns.m()`)
  // — `name.target` names an enclosing namespace whose scope frame must be
  // established (with its captured `@var`s) for the closure to resolve. The spine
  // does not fully establish a not-yet-descended sibling namespace's frame, so the
  // closure body would fail to resolve its definition-scope vars. DEFERRED: the
  // namespace/closure-capture path (a later increment).
  if (name.target !== undefined) {
    return false;
  }
  return true;
}

/**
 * RUNTIME simplicity gate: a resolved bound surface the spine can descend inline.
 * A `false` makes the callable terminal fall back to the eval path for that
 * candidate (byte-identical). A `false` from ANY candidate routes the whole call
 * to eval-fallback (`resolveSpineMixinCall`).
 *
 * INCREMENT 2 (frame-threaded descent): the body must be LEAF-ONLY spine-simple
 * children (`:`/merge declarations + comments — `isSimpleSpineLeaf`) with NO
 * nested container and NO further mixin call. VAR-READING decls are NOW ADMITTED —
 * increment 2 descends each surface with `context.rulesContext` pushed to the
 * surface, so a body reference resolves against the mixin's DEFINITION scope (its
 * wired lexical/closure/param frame). The literal-only restriction (increment 1)
 * is lifted. DEFERRED (still fall back): nested containers in a mixin body, a
 * mixin body that itself calls a mixin, parametric/guarded defs (gated earlier).
 */
function isSpineSimpleMixinSurface(surface: Rules): boolean {
  const children = surface.rules;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (!isSimpleSpineLeaf(child)) {
      return false;
    }
    // A further mixin call inside the body needs its own frame-threaded descent
    // nested under this surface's frame — deferred (a later increment).
    if (isSpineEligibleMixinCall(child)) {
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
  call: Node,
  context: Context
): MaybePromise<SpineMixinCallResolution> {
  const captured: Array<{ surface: Rules; source: Rules }> = [];
  let anyRejected = false;
  const savedSink = context.spineMixinSurfaceSink;
  context.spineMixinSurfaceSink = (
    boundSurface: Rules,
    sourceRules: Rules,
    candidateIsMixin: boolean
  ): boolean => {
    // Fold ONLY a spine-simple Mixin-DEFINITION body. A ruleset-as-mixin
    // (`!candidateIsMixin` — the `mixin-ruleset` dot-call matching a same-named
    // ruleset) needs different placement (the ruleset ALSO emits standalone) and a
    // non-simple body both DEFER: reject → the terminal eval-materializes that
    // candidate, and `anyRejected` routes the whole call to the eval fallback.
    if (!candidateIsMixin || !isSpineSimpleMixinSurface(boundSurface)) {
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
    captured.push({ surface: boundSurface, source: sourceRules });
    return true;
  };
  const restore = <T>(value: T): T => {
    context.spineMixinSurfaceSink = savedSink;
    return value;
  };
  // FOLD only when EVERY guard-passed candidate was captured by the sink (none
  // rejected) AND at least one surface was captured. If `captured` is empty the
  // call resolved entirely via paths the sink never saw (e.g. a ruleset-as-mixin
  // handled by the special-case terminal) — use the eval output. `anyRejected`
  // likewise routes to eval. Either way the `call.eval()` return carries the
  // correct eval-path output for the fallback.
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
    return { kind: 'fold', surfaces: ordered.map(entry => entry.surface) };
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
 * A nested CONTAINER child THIS phase can descend through the spine: a plain
 * `Ruleset` with a non-Nil selector, no guard, a spine-eligible body, and a
 * selector whose composition the spine folds. Admitted: plain `&` composition
 * (`&.foo`, `& + &`, `&:hover`, bare `&`) + interpolation. Excluded (still eval
 * path, precise reasons): AMPERSAND-APPEND (`&-modifier` — the anonymous-append
 * materialize+hoist is eval-pass machinery, `selectorHasAmpersandAppend`),
 * extend-bearing/reference/guarded rulesets, at-rules routed to
 * `isSpineEligibleAtRule`, mixins.
 */
function isSpineEligibleContainer(node: Node, allowExtend = false): boolean {
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
  // Extend-bearing selectors stay on the eval path UNLESS the FLAT extend topology is
  // engaged (P3 increment 1): a root-direct-child extender's `:extend` is gathered by the
  // pre-scan and its subject header composed as an override. `allowExtend` is threaded ONLY
  // for the flat root case (`isSpineExtendTopology` guarantees no NESTED extend), so a nested
  // extend still falls to the eval path.
  if (!allowExtend && Ruleset.hasExtendedTopLevelSelector(ruleset.selector)) {
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
  // ANCESTOR RE-WRAP on at-rule HOIST (a scoped frontier). A conditional-group
  // at-rule nested inside THIS ruleset hoists to root; its content that is NOT a
  // plain-selector child ruleset must be RE-WRAPPED in this ruleset's (composed)
  // selector — a DIRECT declaration (`html { @supports { d: v } }` → `@supports {
  // html { d: v } }`) or a bare-`&` / `&`-collapsing child ruleset (`.c { @media {
  // & { … } } }` → `@media { .c { … } }`). The spine hoist does not yet reproduce
  // that ancestor re-wrap; it drops the wrapper and emits the content bare. Plain-
  // selector child rulesets (`.card { @media { .inner { … } } }` → `.card .inner`)
  // DO compose correctly. So exclude this ruleset when it holds a hoisting at-rule
  // whose body needs re-wrapping (`atRuleBodyNeedsAncestorRewrap`).
  if (bodyHasAtRuleNeedingAncestorRewrap(ruleset.rules)) {
    return false;
  }
  return isSpineEligibleBody(ruleset.rules, allowExtend);
}

/**
 * True if any direct child of `body` is a hoisting conditional-group at-rule whose
 * own body would need the enclosing ruleset's selector re-wrapped around it on
 * hoist — i.e. it has a DIRECT declaration/comment leaf or an `&`-bearing child
 * ruleset. An at-rule whose children are ALL plain-selector rulesets composes
 * correctly through the spine hoist and does NOT force exclusion.
 */
function bodyHasAtRuleNeedingAncestorRewrap(children: readonly Node[]): boolean {
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (
      isNode(child, N.AtRule)
      && typeof (child as { name?: unknown }).name === 'string'
      && SPINE_ELIGIBLE_AT_RULES.has((child as { name: string }).name)
      && isNode(child, N.Rules)
      && atRuleBodyNeedsAncestorRewrap((child as unknown as Rules).rules)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * True if a (hoisting) at-rule body contains anything the enclosing ruleset's
 * selector must be re-wrapped around: a direct declaration/non-ruleset leaf, or a
 * child ruleset whose selector carries `&`. A body of only plain-selector rulesets
 * returns false (composes correctly through the hoist).
 */
function atRuleBodyNeedsAncestorRewrap(children: readonly Node[]): boolean {
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (isNode(child, N.Ruleset)) {
      if (selectorHasAmpersand((child as Ruleset).selector)) {
        return true;
      }
      continue;
    }
    // A nested at-rule child is itself gated by `isSpineEligibleAtRule` on descent.
    if (isNode(child, N.AtRule)) {
      continue;
    }
    // A direct declaration/comment/other leaf needs the ancestor wrapper on hoist.
    return true;
  }
  return false;
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
 */
const SPINE_ELIGIBLE_AT_RULES = new Set(['@media', '@supports', '@container', '@starting-style']);

/**
 * The ROOT-ONLY "wrap + emit" at-rules THIS phase folds through the spine. Unlike
 * the conditional-group family they do NOT hoist/compose selectors: they emit at
 * their document position with a prelude + a self-contained body —
 *   - DECLARATION-bodied: `@font-face`, `@page` (+ margin-box at-rules), `@viewport`,
 *     `@counter-style` — body is `:`-declarations / comments.
 *   - KEYFRAME-bodied: `@keyframes` / `@-webkit-keyframes` — body is keyframe-
 *     selector rulesets (`0%`, `from`, `to`, `from,to`) that DO NOT `&`-compose;
 *     the root-only composed-stack reset (`isRootOnly()` in the kept serializer)
 *     keeps each keyframe selector standalone.
 *   - RULESET-bodied conditional-ish: `@document`/`@-x-document`/`@-moz-document`,
 *     `@host` — body is plain-selector rulesets emitted inside the block.
 *
 * EXCLUDED (still eval path, precise reasons): `@property` — registers a custom
 * property (an eval-pass registration side effect the spine does not replicate);
 * `@charset`/`@import`/`@namespace` — document-framing / non-block (already gated
 * out by `isSpineEligibleRoot`'s charset/topImports check and having no `Rules`
 * body). Interpolated NAMES are handled where the prelude resolves at-enter; an
 * interpolated at-rule keyword itself is not folded (name is a Node, gated below).
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
  '@host'
]);

/** True for the keyframes family, whose children are keyframe-selector rulesets. */
const SPINE_KEYFRAMES_AT_RULES = new Set(['@keyframes', '@-webkit-keyframes']);

/**
 * A nested AT-RULE child THIS phase can descend through the spine: a
 * block at-rule from one of two families, with a string name (not interpolated —
 * an interpolated at-rule NAME is not folded yet) and a spine-eligible body:
 *   - CONDITIONAL-GROUP (`@media`/`@supports`/`@container`/`@starting-style`) —
 *     bubbles to root + composes its body's selectors (the `@media`→root hoist +
 *     composed-stack machinery, §7); subject to the `&`-through-hoist re-wrap
 *     frontier guard (`atRuleBodyHasAmpersandRuleset`).
 *   - ROOT-ONLY WRAP+EMIT (`@font-face`/`@page`/`@keyframes`/`@-webkit-keyframes`/
 *     `@viewport`/`@counter-style`/`@document`/`@host`, `SPINE_ELIGIBLE_ROOT_ONLY_
 *     AT_RULES`) — no hoist, no composition; body is declarations / keyframe-
 *     selector rulesets / plain-selector rulesets. The root-only composed-stack
 *     reset keeps keyframe selectors standalone. Body gated by
 *     `isSpineEligibleRootOnlyAtRuleBody`.
 * The prelude is resolved-at-enter by `serializeSpineFrameAtRule`.
 *
 * EXCLUDED (still eval path, precise reasons): `@layer` — nested layer-NAME
 * registration (`@layer a.b`) is an eval-pass side effect the spine does not
 * replicate; `@scope` — special `(start)`/`(end)` prelude + scoped-body binding;
 * `@property` — registers a custom property (eval-pass registration side effect);
 * interpolated at-rule NAMES; non-nestable / document-framing forms.
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
  // ROOT-ONLY "wrap + emit" family (`@font-face`/`@page`/`@keyframes`/…): no
  // hoist, no selector composition. Body is declarations/comments, or (keyframes)
  // keyframe-selector rulesets, or (`@document`/`@host`) plain-selector rulesets.
  if (SPINE_ELIGIBLE_ROOT_ONLY_AT_RULES.has(atRule.name)) {
    return isSpineEligibleRootOnlyAtRuleBody(atRule);
  }
  if (!SPINE_ELIGIBLE_AT_RULES.has(atRule.name)) {
    return false;
  }
  // Nested conditional-group at-rules HOIST to root; when their body contains a
  // ruleset whose selector carries an `&`, the hoist must RE-MATERIALIZE the
  // ancestor selector around the (possibly `&`-collapsed) child — e.g.
  // `.c { @media { & { … } } }` → `@media { .c { … } }`, and `.top { .inside & {
  // @supports { … } } }` → `@supports { .inside .top { … } }`. The spine's hoist
  // does not yet reproduce that ancestor re-wrap for `&`-bearing inner selectors
  // (it drops the wrapper, emitting the leaf bare). Plain-selector inner rulesets
  // (`.card { @media { .inner { … } } }` → `.card .inner`) ARE correct and stay
  // eligible. So exclude an at-rule whose body has an `&`-bearing child ruleset —
  // a scoped frontier (the `&`-through-hoist re-wrap), NOT a safety fallback.
  if (atRuleBodyHasAmpersandRuleset(atRule.rules)) {
    return false;
  }
  return isSpineEligibleBody(atRule.rules);
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
  if (SPINE_KEYFRAMES_AT_RULES.has(atRule.name as string)) {
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
      if (ruleset.guard || (ruleset.options as { referenceMode?: boolean } | undefined)?.referenceMode === true) {
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
function isSpineEligibleBody(children: readonly Node[], allowExtend = false): boolean {
  // INCREMENT 1 cross-check: a mixin call is folded by splicing its emitted decls
  // into the body's statement loop AFTER `planBodyMerges` has run — so a spliced
  // decl cannot participate in a `+:`/`+_:` merge chain in the SAME body. If the
  // body has BOTH a mixin call and a merge decl, keep the whole body on the eval
  // path (the merge would otherwise leak `prop+:`). DEFERRED: merge-across-mixin-
  // output (needs the merge plan to see the expansion).
  if (bodyHasMixinCall(children) && bodyHasDirectMergeDecl(children)) {
    return false;
  }
  // INCREMENT 1 cross-check: a mixin used other than as a BARE foldable call —
  // a var-decl bound to a mixin call (`@p: .mk-map()`), a map-lookup on such a
  // value (`@p[text]`), a detached-ruleset call — is NOT folded. Admitting a
  // Mixin DEFINITION below would otherwise pull the whole enclosing body onto the
  // spine even though the mixin is consumed by machinery the spine does not yet
  // cover. Keep such a body on the eval path. DEFERRED: mixin-as-value / map-lookup.
  if (bodyHasMixinDefinition(children) && bodyHasCallInVarValue(children)) {
    return false;
  }
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (isSimpleSpineLeaf(child, allowExtend)) {
      if (isNode(child, N.VarDeclaration) && typeof child.name !== 'string') {
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
    if (!isSpineEligibleContainer(child, allowExtend)) {
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
  const params = node.params;
  if (!params) {
    return true;
  }
  for (let i = 0; i < params.value.length; i++) {
    const param = params.value[i]!;
    // A named param (required OR default) or a Rest param. A pattern-match literal
    // (a value guard — neither a VarDeclaration nor a Rest) defers.
    if (!isNode(param, N.VarDeclaration) && param.type !== 'Rest') {
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
function isSimpleSpineLeaf(node: Node, allowExtend = false): boolean {
  if (isNode(node, N.Comment)) {
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

/** True if any DIRECT child of `body` is a spine-eligible mixin call. */
function bodyHasMixinCall(children: readonly Node[]): boolean {
  for (let i = 0; i < children.length; i++) {
    if (isSpineEligibleMixinCall(children[i]!)) {
      return true;
    }
  }
  return false;
}

/** True if any DIRECT child of `body` is a mixin DEFINITION. */
function bodyHasMixinDefinition(children: readonly Node[]): boolean {
  for (let i = 0; i < children.length; i++) {
    if (isNode(children[i]!, N.Mixin)) {
      return true;
    }
  }
  return false;
}

/**
 * True if any DIRECT child is a VarDeclaration whose VALUE contains a `Call`
 * (`@p: .mk-map()` — a mixin bound to a variable, later map-looked-up `@p[text]`).
 * This is the mixin-as-value shape increment 1 does not fold.
 */
function bodyHasCallInVarValue(children: readonly Node[]): boolean {
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (!isNode(child, N.VarDeclaration)) {
      continue;
    }
    for (const descendant of child.walk(true)) {
      if (isNode(descendant, N.Call)) {
        return true;
      }
    }
  }
  return false;
}

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
 * extend/reference) with `&`/interpolated selectors resolved-at-enter,
 * conditional-group at-rules (`@media`/`@supports`/`@container`/`@starting-style`),
 * and ROOT-ONLY wrap+emit at-rules (`@font-face`/`@page`/`@keyframes`/`@-webkit-
 * keyframes`/`@viewport`/`@counter-style`/`@document`/`@host`); re-declared vars +
 * `snapshot` reads resolve per-position. Excluded (still eval path — a scoped
 * frontier, NOT a safety fallback): charset/import document framing, reference
 * mode, conditional (`?:`)/`setDefined` declarations, ampersand-append,
 * `@layer`/`@scope`/`@property`, the at-rule `&`-through-hoist re-wrap frontier,
 * guarded/extend/mixin/reference containers, interpolated var/at-rule NAMES.
 *
 * ROOT-LEVEL merge guard: a `+:`/`+_:` declaration DIRECTLY in the root body (not
 * inside a ruleset) is excluded — property-merge coalescing is applied on the
 * CONTAINER descent path (`withSpineMergePlan`), which the flat root-body path
 * (`toRenderString`) does not run. Root-level property merges are unusual
 * (properties belong in rulesets); a real one routes to the eval path.
 */
export function isSpineEligibleRoot(root: Rules, context: Context, collapseNesting?: boolean): boolean {
  if (context.currentCharset || context.topImports?.length) {
    return false;
  }
  if (root.options?.referenceMode === true) {
    return false;
  }
  if (bodyHasDirectMergeDecl(root.rules)) {
    return false;
  }
  // INCREMENT 2 cross-check: a mixin CALL whose target might be an INTERPOLATED-
  // SELECTOR ruleset (`.@{x} {}` used as `.foo()`) can't fold — the interpolated
  // name is registered into the callable cache by the EVAL pass, which the spine
  // skips, so the call's resolution would throw "No matching mixins". If the tree
  // has BOTH a mixin call and an interpolated-selector ruleset, keep it on the eval
  // path. DEFERRED: interpolated-name callable registration (an eval-pass side effect).
  if (treeHasMixinCall(root) && treeHasInterpolatedSelectorRuleset(root)) {
    return false;
  }
  // INCREMENT 2 cross-check: a `mixin-ruleset` dot-call whose key names BOTH a
  // Mixin definition AND a same-named Ruleset (`.foo() {}` mixin + `.foo {}`
  // ruleset) matches BOTH — the call must emit the mixin body AND the ruleset-as-
  // mixin body. The spine folds only the Mixin candidate; suppressing it while the
  // ruleset candidate falls back to eval would drop the mixin's contribution from
  // the assembled output. Keep such a MIXED-match tree on the eval path. DEFERRED:
  // multi-candidate (mixin + ruleset) matches.
  if (treeHasMixinRulesetMixedMatch(root)) {
    return false;
  }
  // INCREMENT 2 cross-check: a NESTED-scope mixin DEFINITION (defined inside a
  // ruleset/at-rule, not a direct document-root child) is a closure-capture /
  // namespace shape whose definition-scope frame the spine does not fully
  // establish for a call in a DIFFERENT scope — resolution can throw
  // "'x' is not defined" or bind the wrong scope. A mid-spine throw is
  // unrecoverable (no fallback once committed to the pass), so keep any tree that
  // has BOTH a mixin call and a nested mixin definition on the eval path. Root-
  // level mixin defs (the common corpus shape) still fold. DEFERRED: the
  // nested-scope closure/namespace path (needs spine definition-scope frame
  // establishment — a later increment).
  if (treeHasMixinCall(root) && treeHasNestedMixinDefinition(root)) {
    return false;
  }
  // INCREMENT 4 cross-check: a mixin DEFINITION whose body contains NESTED
  // CONTAINERS (a Ruleset/AtRule — `.mix() { .inner { … } }`) can't fold: the
  // runtime surface gate rejects a non-leaf body, so the call eval-falls-back, but
  // the eval fallback's output is a resolved TREE that the spine then re-descends —
  // losing the eval-time frame for any DEEPLY-NESTED mixin call (`.mix-inner((@a*2))`
  // reads `@a` from the surface frame the re-descent doesn't carry), dropping its
  // output. Keep such a tree on the eval path entirely. DEFERRED: nested-container
  // mixin bodies (needs the eval-fallback output rendered as-is, not re-spine-
  // descended — a later mechanism). Flat (leaf-only) mixin bodies still fold.
  if (treeHasMixinCall(root) && treeHasContainerBodyMixinDefinition(root)) {
    return false;
  }
  // FLAT extend topology (P3 increment 1): a root whose ONLY extends are root-direct-child
  // subjects/extenders (no nested extend) is spine-eligible — the pre-scan gathers and the
  // subject header is composed as an override. `allowExtend` admits the extend-bearing root
  // children + their ExtendList effect nodes. A NON-flat extend shape stays on the eval path.
  const collapse = collapseNesting ?? context.output?.collapseNesting === true;
  const allowExtend = engageExtendLayer(root) && isSpineExtendTopology(root, collapse === true);
  return isSpineEligibleBody(root.rules, allowExtend);
}

/**
 * True if the tree has a Mixin definition whose body (deep) contains a nested
 * container (Ruleset/AtRule) — the non-leaf mixin body whose eval-fallback the
 * spine cannot faithfully re-descend (see `isSpineEligibleRoot`). Direct body
 * children only need checking, but a container anywhere in the body qualifies.
 */
function treeHasContainerBodyMixinDefinition(root: Node): boolean {
  for (const node of root.walk(true)) {
    if (!isNode(node, N.Mixin)) {
      continue;
    }
    const body = node.rules;
    for (let i = 0; i < body.length; i++) {
      if (isNode(body[i]!, N.Ruleset | N.AtRule)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True if the tree has a Mixin definition nested INSIDE a container (a
 * ruleset/at-rule body), i.e. NOT a direct child of the document root. A nested
 * mixin captures its enclosing scope; folding a call to it from another scope
 * needs the definition-scope frame the spine does not yet establish (deferred).
 */
function treeHasNestedMixinDefinition(root: Rules): boolean {
  const rootChildren = new Set<Node>(root.rules);
  for (const node of root.walk(true)) {
    if (isNode(node, N.Mixin) && !rootChildren.has(node)) {
      return true;
    }
  }
  return false;
}

/**
 * True if the tree has a `mixin-ruleset` CALL whose key names BOTH a Mixin
 * definition and a same-named Ruleset — the multi-candidate mixed match the fold
 * defers (see `isSpineEligibleRoot`). Conservative: keys compared by string value.
 */
function treeHasMixinRulesetMixedMatch(root: Node): boolean {
  const mixinNames = new Set<string>();
  const rulesetSelectorKeys = new Set<string>();
  const dotCallKeys = new Set<string>();
  for (const node of root.walk(true)) {
    if (isNode(node, N.Mixin) && typeof node.name === 'string') {
      mixinNames.add(node.name);
    } else if (isNode(node, N.Ruleset)) {
      const key = simpleSelectorKey((node as Ruleset).selector);
      if (key !== undefined) {
        rulesetSelectorKeys.add(key);
      }
    } else if (
      isNode(node, N.Call)
      && isNode(node.name, N.Reference)
      && node.name.options?.type === 'mixin-ruleset'
      && typeof node.name.key === 'string'
    ) {
      dotCallKeys.add(node.name.key);
    }
  }
  for (const key of dotCallKeys) {
    if (mixinNames.has(key) && rulesetSelectorKeys.has(key)) {
      return true;
    }
  }
  return false;
}

/** The single class/id selector string of a plain ruleset selector, else undefined. */
function simpleSelectorKey(selector: unknown): string | undefined {
  const raw = typeof selector === 'string'
    ? selector
    : selector instanceof Node
      ? selector.valueOf()
      : undefined;
  return typeof raw === 'string' ? raw.trim() : undefined;
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
export function renderRootViaSpine(
  root: Rules,
  context: Context,
  options: FinalPrintOptions
): MaybePromise<string> {
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
  const extendEngaged = engageExtendLayer(root);
  if (extendEngaged && !isSpineExtendTopology(root, options.collapseNesting === true)) {
    throw new Error(
      'spine extend: unsupported topology reached renderRootViaSpine (gate admits only the proven shapes)'
    );
  }
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
  const savedTreeContext = context.treeContext;
  context.root ??= root;
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
    const trimmed = body.trimEnd();
    return trimmed ? `${trimmed}\n` : '';
  };
  const fail = (error: unknown): never => {
    context.rulesContext = savedRulesContext;
    context.root = savedRoot;
    context.treeRoot = savedTreeRoot;
    context.treeContext = savedTreeContext;
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
  // EXTEND (P3, document-wide gather). Gather every `:extend` instruction with its extender
  // BUCKET PATH + compose the per-subject header overrides BEFORE the body descent, so
  // `Reaching(S)` is fully known at every subject's emit position (§4.0 → header final inline,
  // no deferral, even for nested extenders). The override map is installed on
  // `options.spineExtendHeaders`, which `Ruleset.effectiveHeaderSelector` consults so a subject
  // emits its composed Or-branch header. Pure structural (selector-graph) — synchronous.
  if (extendEngaged) {
    try {
      const { headers, hoisted } = wireSpineExtends(root, context);
      options.spineExtendHeaders = headers;
      // §4.3 hoist: subjects whose override is a full root-composed projection (`&`-crossing) —
      // their header emits VERBATIM (skip parent compose). Strictly the crossing subset.
      options.spineExtendHoisted = hoisted;
    } catch (error) {
      return fail(error);
    }
  }
  return descend();
}
