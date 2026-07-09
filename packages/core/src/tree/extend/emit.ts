/**
 * emit.ts — the EMIT phase of the unified extend flow (PLAN / SOLVE / EMIT).
 * =========================================================================
 *
 * PLAN (`plan.ts`) precomputes reachability + the target index. SOLVE (`solve.ts`) drives the
 * document fixpoint at the LOCAL-APPLY layer, producing each subject's final Or-branch set from
 * the RAW per-instruction `(target, extendWith, partial)`. EMIT is the LAYER ABOVE local-apply —
 * the projection UNIFIED-EVAL-EMIT-DESIGN.md §4.3 / §5 and EXTEND-GLOBAL-FLOW-DESIGN.md §4.3
 * assign to emit-time, and which SOLVE's report explicitly documents it does NOT do:
 *
 *   1. COMPOSE-RELATIVE-TO-TARGET. A NESTED extender contributes its COMPOSED selector, not its
 *      bare own fragment. `.type1 { .sidebar3:extend(.sidebar all) }` contributes `.type1 .sidebar3`
 *      to `.sidebar`, NOT `.sidebar3`. The placement is derived from the extender's BUCKET PATH
 *      (its ancestor selector chain) relative to the target's — OQ-5's resolution (B): NO stored
 *      own-selector field, NO `ownSelector`/`analyzeNonPartialExtends` cascade. This reproduces the
 *      semantics of `composeExtendWithRelativeToTarget` (`extend-roots.ts:257`) but from an explicit
 *      path instead of re-walking `.parent`.
 *
 *   2. `&`-CROSSING HOIST-TO-ROOT re-bucketing. When the extender's composed form crosses the
 *      target's parent boundary (the extender's path does not descend from the target's parent), the
 *      contribution and its subject branch emit at ROOT placement — `.footer .footer-nav` joins
 *      `.header .header-nav` at the root selector list rather than nested under `.header`.
 *      Crossing is `placement=root`, not a pre-apply side-channel (ruling 3).
 *
 *   3. COLLAPSE / `:is()`-GROUPING as emit-time policy. Under `collapseNesting:true` a nested block
 *      is folded into its parent's composed Or-set, wrapping a multi-branch parent in `:is(...)`
 *      (`:is(.sidebar, .sidebar2, .type1 .sidebar3, .type2.sidebar4) .box`). Under `false` the nested
 *      block is preserved and the parent's Or-set is emitted expanded as the block header. Both modes
 *      run the SAME `Ruleset.composeSelector` primitive; the difference is purely whether the child
 *      is folded up (collapse) or left as a nested header (expanded).
 *
 * EMIT operates PURELY on the selector graph (structural). It never consults a value frame — the
 * §4.2 decoupling: extend is a selector-graph fixpoint, value resolution is a per-leaf frame lookup.
 *
 * OWN CONSTRUCTION. EMIT does not delegate to `processExtends`/`extend-roots.ts`; it derives the
 * composed/hoisted/collapsed shape itself from the bucket paths, using only the `Ruleset.composeSelector`
 * / `PseudoSelector` primitives. An unbuildable shape returns UNSUPPORTED (fail-loud).
 *
 * NOT wired into production, NOT the render-pipeline cutover — a validated building block. Not
 * exported from any index → bundle-excluded.
 */
import { Ruleset } from '../ruleset.js';
import { Selector, type SelectorLike } from '../selector.js';
import { SelectorList, type SelectorListItem, isSelectorListLike, selectorListItems } from '../selector-list.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { ComplexSelector } from '../selector-complex.js';
import { F_AMPERSAND } from '../node.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';
import { UNSUPPORTED, type UnsupportedResult } from './extend-index.js';

export { UNSUPPORTED, type UnsupportedResult };

/**
 * The BUCKET PATH of a placed selector: its ancestor selector chain from the outermost enclosing
 * ruleset down to (and including) the node's OWN local selector. This is the structural artifact the
 * design's OQ-5 (B) derives placement from — the same chain `composeExtendWithRelativeToTarget`
 * re-walks via `.parent`, here made explicit so EMIT never touches the node graph.
 *
 * `[.type1, .sidebar3]` is the path of `.sidebar3` nested under `.type1`; `[.sidebar]` is a
 * root-level selector; `[.header, .header-nav]` is `.header-nav` nested under `.header`.
 */
export type BucketPath = readonly Selector[];

/** One extend contribution to a subject: the extender's bucket path (source of the composed form). */
export interface EmitContribution {
  /** the extender's ancestor selector chain (outermost → own local). Never empty. */
  path: BucketPath;
  /** document order for the confluence sort (EMIT sorts Or-branches by order). */
  order: number;
}

/**
 * A subject to project: its own bucket path (the target's ancestor chain) plus the contributions the
 * SOLVE fixpoint routed to it. EMIT composes each contribution relative to `path` and orders the set.
 */
export interface EmitSubject {
  /** the target's ancestor selector chain (outermost → own local). Never empty. */
  path: BucketPath;
  /** document order of the subject's authored selector. */
  order: number;
  /** contributions the fixpoint routed to this subject (each is an extender bucket path). */
  contributions: readonly EmitContribution[];
}

/** The projected Or-branch set for one subject, ordered, ready to emit as a selector list. */
export interface EmitProjection {
  /** the ordered Or-branch selectors: authored own form first (by order), then composed contributions. */
  branches: Selector[];
  /**
   * true when ANY branch crosses the target's parent boundary (`&`-hoist): the whole subject header
   * must emit at ROOT placement, not nested. Mirrors `ruleset.hoistToRoot`.
   */
  hoistToRoot: boolean;
}

function selectorKey(sel: Selector): string {
  return String(sel.valueOf());
}

/** The target's ancestor keys (every path level EXCEPT the target's own local). */
function targetAncestorKeys(targetPath: BucketPath): Set<string> {
  const keys = new Set<string>();
  for (let i = 0; i < targetPath.length - 1; i++) {
    keys.add(selectorKey(targetPath[i]!));
  }
  return keys;
}

/**
 * Wrap a multi-branch child selector list in `:is(...)` before composing, so `composeSelector` does
 * not DISTRIBUTE the parent across the group. This is the exact guard
 * `composeExtendWithRelativeToTarget`/`getFullComposedForm` apply (`extend-roots.ts:298`, `:335`)
 * and the collapse policy relies on to produce `:is(.a, .b) .c` rather than `.a .c, .b .c`.
 */
function wrapIsIfMultiList(child: Selector): Selector {
  if (isSelectorListLike(child) && !child.hasFlag(F_AMPERSAND)) {
    const items = selectorListItems(child);
    if (items.length > 1) {
      const childIs = PseudoSelector.create({ name: ':is', arg: child });
      childIs.generated = true;
      if (!isNode(childIs, N.Selector)) {
        throw new TypeError('Expected generated pseudo selector');
      }
      return childIs;
    }
  }
  return child;
}

function asSelector(value: SelectorLike): Selector {
  if (typeof value === 'string') {
    return new ComplexSelector([value]);
  }
  if (Array.isArray(value)) {
    return new SelectorList(value);
  }
  return value;
}

/**
 * Compose an extender's contribution relative to a target, from bucket paths — the own-construction
 * of `composeExtendWithRelativeToTarget` semantics. Walk the extender path from its own local
 * OUTWARD, collecting levels until reaching a level that is ALSO a target ancestor (shared parent),
 * then compose outermost → innermost.
 *
 *   target `[.sidebar]`,   extender `[.type1, .sidebar3]`  → `.type1 .sidebar3` (no shared ancestor)
 *   target `[.sidebar]`,   extender `[.sidebar2]`          → `.sidebar2`        (sibling at root)
 *   target `[.parent, .a]`, extender `[.parent, .child]`   → `.child`           (shared `.parent`)
 *
 * A `&`-crossing (the extender's outermost level is NOT the target's outermost, and they share no
 * ancestor) composes the extender's FULL path — that is the hoisted contribution.
 */
export function composeContribution(
  contribution: EmitContribution,
  targetPath: BucketPath
): { selector: Selector; crossesParentBoundary: boolean } {
  const path = contribution.path;
  if (path.length === 0) {
    throw new TypeError('EMIT contribution path is empty');
  }
  const ancestorKeys = targetAncestorKeys(targetPath);
  // Collect the extender path levels from its own local outward, stopping at the first level that is
  // a target ancestor (that level and everything above it is shared and elided).
  const levels: Selector[] = [];
  let sharedAncestorFound = false;
  for (let i = path.length - 1; i >= 0; i--) {
    const level = path[i]!;
    if (ancestorKeys.has(selectorKey(level))) {
      sharedAncestorFound = true;
      break;
    }
    levels.unshift(level);
  }
  if (levels.length === 0) {
    throw new TypeError('EMIT contribution collapsed to empty (extender IS a target ancestor)');
  }
  // Compose outermost → innermost.
  let result: Selector = levels[0]!;
  for (let i = 1; i < levels.length; i++) {
    const child = wrapIsIfMultiList(levels[i]!);
    result = asSelector(Ruleset.composeSelector(child, result));
  }
  // Crossing: the extender did not share the target's parent AND it has an ancestor level of its own
  // (a nested extender that reaches OUT of the target's parent). A root-level or same-parent
  // contribution does not cross.
  const targetHasParent = targetPath.length > 1;
  const crossesParentBoundary = targetHasParent && !sharedAncestorFound && levels.length >= 1
    ? selectorKey(levels[0]!) !== selectorKey(targetPath[0]!)
    : false;
  return { selector: result, crossesParentBoundary };
}

/**
 * The target's OWN authored composed form (its full bucket path composed). Exported for the
 * end-to-end pipeline driver, which composes a subject's authored selector from its bucket path
 * (the SOLVE seed) before projecting its contributions.
 */
export function composeTargetOwn(targetPath: BucketPath): Selector {
  let result: Selector = targetPath[0]!;
  for (let i = 1; i < targetPath.length; i++) {
    const child = wrapIsIfMultiList(targetPath[i]!);
    result = asSelector(Ruleset.composeSelector(child, result));
  }
  return result;
}

/**
 * PROJECT a subject to its Or-branch set. Extend is LIST-APPEND: the subject's authored own form
 * always LEADS (branch 0), and each contribution is composed relative to the target and APPENDED
 * in feed (document) order. There is NO sort — the target's own selector heads its own rule
 * unconditionally, extenders follow. (An earlier version sorted the own form AMONG the
 * contributions by document position, which floated a before-authored extender ahead of the
 * target — `.b, .a` instead of `.a, .b`. That was a bug, not an ordering choice: append semantics
 * have nothing to sort. The bug hid because every ratified fixture authors the target BEFORE its
 * extenders, where append and sort coincide.)
 *
 * @see UNIFIED-EVAL-EMIT-DESIGN.md §4.3 (extend is list-append; target leads; no sort).
 */
export function projectSubject(subject: EmitSubject): EmitProjection {
  const entries: Selector[] = [
    composeTargetOwn(subject.path),
    ...subject.contributions.map(c => composeContribution(c, subject.path).selector)
  ];
  let hoistToRoot = false;
  for (const c of subject.contributions) {
    if (composeContribution(c, subject.path).crossesParentBoundary) {
      hoistToRoot = true;
    }
  }
  // Dedup by selector text, preserving append order (target-own first).
  const seen = new Set<string>();
  const branches: Selector[] = [];
  for (const selector of entries) {
    const key = selectorKey(selector);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    branches.push(selector);
  }
  return { branches, hoistToRoot };
}

/**
 * Emit a subject's HEADER selector text from its projection under the given collapse mode.
 *
 *   collapse OR expanded: a single-branch subject emits its lone branch verbatim; a multi-branch
 *   subject emits the comma-joined Or-set. (The block-header form is identical in both modes; the
 *   modes DIFFER only for a nested CHILD block — see `emitNestedChildHeader`.)
 */
export function emitSubjectHeader(projection: EmitProjection): string {
  return projection.branches.map(selectorKey).join(',');
}

/**
 * Emit a nested CHILD block's header, folding the parent's Or-set into the child under the collapse
 * policy. This is the `.box` / `.bar` reshape:
 *
 *   collapseNesting:true  → `:is(.sidebar, .sidebar2, .type1 .sidebar3, .type2.sidebar4) .box`
 *                           (parent Or-set folded into child, multi-branch parent wrapped in `:is`)
 *   collapseNesting:false → the child block stays nested; the header is just the child's own local
 *                           (`.box`), emitted under the already-expanded parent header.
 *
 * The fold runs `Ruleset.composeSelector(childLocal, parentOrSet)` — the SAME primitive as authored
 * nesting — so an extend-contributed parent branch is grouped identically to an authored one (§5:
 * collapse does not know which branches came from extend).
 */
export function emitNestedChildHeader(
  parent: EmitProjection,
  childLocal: Selector,
  collapseNesting: boolean
): string {
  if (!collapseNesting) {
    return selectorKey(childLocal);
  }
  const parentBranches = parent.branches;
  const parentLike: SelectorLike =
    parentBranches.length === 1
      ? parentBranches[0]!
      : new SelectorList(parentBranches as SelectorListItem[]);
  const composed = Ruleset.composeSelector(childLocal, parentLike);
  return selectorKey(asSelector(composed));
}
