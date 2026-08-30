import type { Context } from '../../context.js';
import { WARN } from '../../jess-error.js';
import { ComplexSelector } from '../selector-complex.js';
import { BasicSelector } from '../selector-basic.js';
import type { Rules } from '../rules.js';
import { Ruleset } from '../ruleset.js';
import { Selector, type SelectorLike } from '../selector.js';
import {
  SelectorList,
  isSelectorListLike,
  selectorListItems,
  finishSelectorListSurface,
  selectorSurfaceValueOf,
  type SelectorListItem
} from '../selector-list.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { applyExtendsToSelector, type ExtendInstruction } from './extend.js';
import { findExtendableLocations } from './extend-helpers.js';
import { isDisjoint, isSubsetOf } from '../../util/bitset.js';
import { keySetOf, requiredKeySetOf, visibleKeySetOf } from './selector-analysis.js';
import { isNode } from './is-node.js';
import { isCombinator } from './combinator.js';
import { N } from '../node-type.js';
import { wouldExtendChange, canUseWalkAndConsume, classifyExtendMatch, beginExtendMatchPass, endExtendMatchPass } from './extend-walk.js';
import type { MatchResult } from './extend-walk.js';
import { Nil } from '../nil.js';
import { F_AMPERSAND, F_EXTENDED, F_VISIBLE, type Node } from '../node.js';
import { copySelectorForPlacement as copySelectorForExtend } from './selector-utils.js';

type RootExtendInstruction = ExtendInstruction & {
  extendingRuleset?: Ruleset;
  fromReferenceScope: boolean;
};

const EXTEND_PROFILE_COUNTERS_KEY = '__JESS_EXTEND_PROFILE_COUNTERS__';
type ExtendProfileGlobals = typeof globalThis & {
  [EXTEND_PROFILE_COUNTERS_KEY]?: Record<string, number>;
};
const extendProfileCounters = (globalThis as ExtendProfileGlobals)[EXTEND_PROFILE_COUNTERS_KEY];
const recordExtendProfile = extendProfileCounters
  ? (event: string, amount = 1): void => {
      extendProfileCounters[event] = (extendProfileCounters[event] ?? 0) + amount;
    }
  : undefined;
const extendProfileNow = extendProfileCounters
  ? globalThis.performance?.now.bind(globalThis.performance)
  : undefined;

function isSelectorValue(value: unknown): value is Selector {
  return isNode(value, N.Selector);
}

function isRulesValue(value: unknown): value is Rules {
  return isNode(value, N.Rules);
}

function isRulesetValue(value: unknown): value is Ruleset {
  return isNode(value, N.Ruleset);
}

function selectorOrUndefined(value: SelectorLike | Nil | undefined): SelectorLike | undefined {
  if (value === undefined || value instanceof Nil) {
    return undefined;
  }
  return value;
}

/**
 * Collapse single-item wrapper selectors to their atomic inner selector — the
 * same normalization `SelectorList.eval` performs. Under copy-on-write the
 * canonical ruleset selector is NOT eval-collapsed (it stays e.g. a single-item
 * `SelectorList`), but the extend matcher reads it via the extend node's parent
 * chain and needs the collapsed form (a bare `SelectorList[.b]` won't match a
 * `.b` target, and it dedups away the inner matchable item). Read-only: shares.
 */
function collapseWrappedSelector(sel: SelectorLike): SelectorLike {
  if (typeof sel === 'string' || Array.isArray(sel)) {
    if (Array.isArray(sel) && sel.length === 1) {
      return collapseWrappedSelector(sel[0]!);
    }
    return sel;
  }
  let current: Selector = sel;
  for (;;) {
    if (current.hasFlag(F_AMPERSAND)) {
      return current;
    }
    const value: unknown = (current as { value?: unknown }).value;
    if (
      (isNode(current, N.SelectorList) || isNode(current, N.ComplexSelector) || isNode(current, N.CompoundSelector))
      && Array.isArray(value)
      && value.length === 1
      && typeof value[0] !== 'string'
      && !isCombinator(value[0])
      && isSelectorValue(value[0])
    ) {
      current = value[0];
      continue;
    }
    return current;
  }
}

function selectorListItemForRootExtend(item: SelectorList['value'][number]): Selector {
  return typeof item === 'string' ? new ComplexSelector([item]) : item;
}

function getOwnSelectorOption(ruleset: Ruleset): Selector | undefined {
  const ownSelector: unknown = ruleset.options?.ownSelector;
  return isSelectorValue(ownSelector) ? ownSelector : undefined;
}

function setOwnSelectorOption(ruleset: Ruleset, selector: Selector): void {
  ruleset.options.ownSelector = selector;
}

function hasExplicitExtendSelector(node: Node | undefined): boolean {
  /*
   * Extend stores its authored replaceWith override on the `selector` field (its
   * base `value` is undefined per invariant 7), so read the field directly.
   */
  return !!node && 'selector' in node && !!(node as { selector?: unknown }).selector;
}

/**
 * Get the parent Ruleset's selector by walking up the tree.
 * Returns undefined if there's no parent Ruleset (root level).
 */
function getParentRuleset(ruleset: Ruleset): Ruleset | undefined {
  const parentRules = ruleset.parent;

  /*
   * Copy-on-write eval surfaces link a nested ruleset directly to its parent
   * Ruleset (the intermediate body-Rules wrapper is not interposed). Canonical
   * trees go ruleset -> body Rules -> parent Ruleset. Accept both.
   */
  if (isRulesetValue(parentRules)) {
    return parentRules;
  }
  if (!isRulesValue(parentRules)) {
    return undefined;
  }
  const parentRuleset = parentRules.parent;
  if (!isRulesetValue(parentRuleset)) {
    return undefined;
  }
  return parentRuleset;
}

/**
 * Get the parent Ruleset's selector by walking up the tree.
 * Returns undefined if there's no parent Ruleset (root level).
 */
function getParentSelector(ruleset: Ruleset): Selector | undefined {
  /*
   * Walk up through & -only parents (implicit wrappers around at-rule contents)
   * to find the nearest parent Ruleset with actual selector content.
   */
  let current: Ruleset = ruleset;
  while (true) {
    const parentRuleset = getParentRuleset(current);
    if (!parentRuleset) {
      return undefined;
    }
    const sel = getLocalSelectorPreExtend(parentRuleset);
    if (!sel) {
      return undefined;
    }

    // If the parent selector is just an Ampersand, keep walking up
    if (typeof sel !== 'string' && !Array.isArray(sel) && isNode(sel, N.Ampersand)) {
      current = parentRuleset;
      continue;
    }
    return asExtendSelectorNode(sel);
  }
}

/*
 * Snapshot of eval'd value before any extend modifications.
 *
 * Pass-scoped, not weak: it is filled at the top of the pass and dropped
 * wholesale in the pass `finally`, so no key can outlive the pass. A WeakMap
 * would buy nothing here and cost one ephemeron entry per ruleset for the
 * collector to resolve during marking.
 */
const preExtendSelectors = new Map<Ruleset, SelectorLike>();

function withSelectorBitLibrary<T extends Selector>(selector: T, ...sources: Array<Selector | undefined>): T {
  if (selector.keySetLibrary) {
    return selector;
  }
  for (const source of sources) {
    if (source?.keySetLibrary) {
      selector.keySetLibrary = source.keySetLibrary;
      break;
    }
  }
  return selector;
}

/**
 * Get the current local selector for a Ruleset.
 * Used for classification and application where we want to see prior updates
 * (supports extend chaining).
 */
function getLocalSelector(ruleset: Ruleset): SelectorLike | undefined {
  const sel = selectorOrUndefined(ruleset.selector);
  return sel ? collapseWrappedSelector(sel) : sel;
}

export function asExtendSelectorNode(value: SelectorLike): Selector {
  if (typeof value === 'string') {
    return new BasicSelector(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 1) {
      const item = value[0]!;
      return typeof item === 'string' ? new BasicSelector(item) : item;
    }
    return SelectorList.create(value.map(item => selectorListItemForRootExtend(item)));
  }

  /*
   * Materialize any string-backed components of a legacy SelectorList node.
   * Factory/parser-delivered lists may carry raw strings (e.g. `sellist(['.child'])`);
   * those strings are dropped by the node-only placement copy downstream, leaving an
   * empty appended slot. Turning them into nodes up front keeps the selector intact.
   */
  if (isNode(value, N.SelectorList) && value.value.some(item => typeof item === 'string')) {
    return SelectorList.create(value.value.map(item => selectorListItemForRootExtend(item))).inherit(value);
  }
  return value;
}

function assignLocalSelector(ruleset: Ruleset, selector: SelectorLike): void {
  if (typeof selector !== 'string' && !Array.isArray(selector)) {
    ruleset.adopt(selector);
    ruleset.selector = selector;
    ruleset.invalidateSelectorValueCache(selector);
    return;
  }
  ruleset.selector = selector;
  ruleset.invalidateSelectorValueCache(undefined);
}

/**
 * Get the PRE-EXTEND local selector for a Ruleset (from snapshot).
 * Used for parent lookups in composed forms so we don't propagate extend
 * additions through parent chains.
 */
function getLocalSelectorPreExtend(ruleset: Ruleset): SelectorLike | undefined {
  const sel = selectorOrUndefined(preExtendSelectors.get(ruleset) ?? ruleset.selector);
  return sel ? collapseWrappedSelector(sel) : sel;
}

/**
 * Get the set of Ruleset ancestors of a ruleset (excluding itself).
 */
function getRulesetAncestors(ruleset: Ruleset): Ruleset[] {
  const ancestors: Ruleset[] = [];
  let current: Ruleset | undefined = getParentRuleset(ruleset);
  while (current) {
    ancestors.push(current);
    current = getParentRuleset(current);
  }
  return ancestors;
}

/**
 * Compose an extendWith selector relative to a target ruleset's parent chain.
 *
 * The extendWith should represent the path from the TARGET's parent (exclusive)
 * to the extending ruleset. When target and extending share a parent, the
 * extendWith is just the extending ruleset's local selector. When they differ,
 * the extending ruleset's path is composed up to (but not including) the
 * target's parent level.
 *
 * Example:
 *   .bordered { ... }  (target, root-level)
 *   .page { .content { extend: .bordered all } }  (extending)
 *   → extendWith = .page .content (composed from root)
 *
 *   .parent { [data] { ... }  .child { extend: [data] all } }
 *   → extendWith = .child (both siblings of same parent)
 */
function composeExtendWithRelativeToTarget(
  extendingRuleset: Ruleset,
  targetRuleset: Ruleset | undefined
): Selector | undefined {
  const extendingLocal = getLocalSelectorPreExtend(extendingRuleset);
  if (!extendingLocal) {
    return undefined;
  }

  /*
   * Walk up from extending ruleset, collecting local value, until we
   * reach a ruleset that is also an ancestor of the target (or root).
   * Copy-on-write eval clones target and extender into separate frame surfaces,
   * so the SAME source `.attributes` is a different Ruleset instance on each
   * chain — instance identity would never match. Compare by pre-extend local
   * selector text, which is stable across those surface copies.
   */
  const targetAncestorKeys = new Set<string>();
  if (targetRuleset) {
    for (const anc of [targetRuleset, ...getRulesetAncestors(targetRuleset)]) {
      const local = getLocalSelectorPreExtend(anc);
      if (local) {
        targetAncestorKeys.add(selectorSurfaceValueOf(local));
      }
    }
  }
  const isTargetAncestor = (rs: Ruleset): boolean => {
    const local = getLocalSelectorPreExtend(rs);
    return !!local && targetAncestorKeys.has(selectorSurfaceValueOf(local));
  };
  const pathLocals: Selector[] = [asExtendSelectorNode(extendingLocal)];
  let current: Ruleset | undefined = getParentRuleset(extendingRuleset);
  while (current && !isTargetAncestor(current)) {
    const local = getLocalSelectorPreExtend(current);
    if (local) {
      pathLocals.unshift(asExtendSelectorNode(local));
    }
    current = getParentRuleset(current);
  }

  // Compose from outermost to innermost
  let result: Selector = pathLocals[0]!;
  for (let i = 1; i < pathLocals.length; i++) {
    let child: Selector = pathLocals[i]!;

    // Wrap child selector list in :is() to avoid distribution
    if (isSelectorListLike(child) && !child.hasFlag(F_AMPERSAND)) {
      const childIs = PseudoSelector.create({ name: ':is', arg: copySelectorForExtend(child) });
      childIs.generated = true;
      if (!isSelectorValue(childIs)) {
        throw new TypeError('Expected generated pseudo selector');
      }
      child = withSelectorBitLibrary(childIs, child, result);
    }
    result = withSelectorBitLibrary(
      asExtendSelectorNode(Ruleset.composeSelector(child, result)),
      child,
      result
    );
  }
  return result;
}

/**
 * Compose a selector with its full parent chain for OUTPUT purposes.
 * Used when an extend crosses the parent boundary and we need the
 * extending ruleset's fully-composed form as the extendWith.
 */
function getFullComposedForm(ruleset: Ruleset): Selector | undefined {
  const local = getLocalSelectorPreExtend(ruleset);
  if (!local) {
    return undefined;
  }
  const localNode = asExtendSelectorNode(local);
  const parent = getParentRuleset(ruleset);
  if (!parent) {
    return localNode;
  }
  const parentComposed = getFullComposedForm(parent);
  if (!parentComposed) {
    return localNode;
  }

  // Wrap child SelectorList in :is() to avoid distribution in composeSelector
  let childForCompose: Selector = localNode;
  if (isNode(localNode, N.SelectorList) && !localNode.hasFlag(F_AMPERSAND)) {
    const childIs = PseudoSelector.create({ name: ':is', arg: copySelectorForExtend(localNode) });
    childIs.generated = true;
    if (!isSelectorValue(childIs)) {
      throw new TypeError('Expected generated pseudo selector');
    }
    childForCompose = withSelectorBitLibrary(childIs, localNode, parentComposed);
  }
  return withSelectorBitLibrary(
    asExtendSelectorNode(Ruleset.composeSelector(childForCompose, parentComposed)),
    childForCompose,
    parentComposed
  );
}

/** Boolean wrapper for backward compatibility with analyzeNonPartialExtends */
function wouldInstructionChangeSel(
  selector: Selector,
  instruction: ExtendInstruction,
  parentSelector?: Selector
): boolean {
  return !!classifyInstructionMatch(selector, instruction, parentSelector);
}

/**
 * Cheap, conservative keyset pre-reject. Mirrors the guaranteed-false gate the
 * match core already trusts (`tryExtendSelector`: required keys of the extend
 * target must be a subset of the candidate's keys), but hoisted ahead of the
 * whole speculative `classifyExtendMatch` / `applyExtendsToSelector` machinery so
 * the overwhelming majority of (selector × extend) probes that can never match
 * skip that setup entirely.
 *
 * The "available" key-space is the candidate selector's own keys UNIONED with its
 * parent's keys — the only sources a match (including `&`-resolved nested matches)
 * can draw simple selectors from. A required SIMPLE-SELECTOR key absent from that
 * union means the target cannot appear in the effective selector, so no match is
 * possible.
 *
 * Combinator keys (` `, `>`, `+`, `~`, `|`) are deliberately excluded from the
 * "needed" set: nesting composition INTRODUCES a descendant/child combinator
 * between parent and child at compose-time, so a target like `.a.a .a` legitimately
 * matches a `.a` child under a `.a.a` parent even though neither selector carries
 * the ` ` combinator as one of its own keys. `requiredKeySet ∩ visibleKeySet` drops
 * exactly those combinator bits (visibleKeySet never includes combinators) while
 * keeping the mandatory simple selectors, and it also collapses to empty for
 * `:is(...)`-style OR targets (requiredKeySet is already empty there), so the gate
 * stays conservative — it can only reject when a required simple can never appear.
 * Returns `true` when a match remains possible (or when operands lack a shared
 * key-set library and no cheap decision can be made).
 */
function targetCanPossiblyMatch(
  selector: Selector,
  target: Selector,
  partial: boolean,
  parentSelector?: Selector
): boolean {
  recordExtendProfile?.('filter.admissionCalls');
  const library = target.keySetLibrary;
  if (!library || selector.keySetLibrary !== library) {
    /*
     * No shared key-set library: the gate cannot cheaply decide, so it admits
     * (conservative). No bitset allocated on this branch.
     */
    recordExtendProfile?.('filter.admittedCalls');
    return true;
  }
  const usableParent = parentSelector
    && !(parentSelector instanceof Nil)
    && parentSelector.keySetLibrary === library
    ? parentSelector
    : undefined;
  let available = keySetOf(selector);

  // Bounded per-probe key-set work; each `.or`/`.and` allocates one bitset.
  recordExtendProfile?.('filter.admissionItemsVisited');
  let allocations = 0;
  if (usableParent) {
    available = available.or(keySetOf(usableParent));
    allocations += 1;
  }
  let admitted: boolean;
  if (partial) {
    admitted = !isDisjoint(visibleKeySetOf(target), available);
  } else {
    const neededSimples = requiredKeySetOf(target).and(visibleKeySetOf(target));
    allocations += 1;
    admitted = isSubsetOf(neededSimples, available);
  }
  if (admitted) {
    recordExtendProfile?.('filter.admittedCalls');
  } else {
    /*
     * Rejected probe: it bears no feature, yet the conservative gate still paid
     * for its bitset allocations. This is the no-feature allocation the precise
     * zero-alloc model forbids and the conservative-filter contract admits.
     */
    recordExtendProfile?.('filter.noFeatureMisses');
    recordExtendProfile?.('filter.noFeatureAllocations', allocations);
  }
  return admitted;
}

function classifyInstructionMatch(
  selector: Selector,
  instruction: ExtendInstruction,
  parentSelector?: Selector
): MatchResult {
  const { target, extendWith, partial } = instruction;

  /*
   * Conservative keyset gate encloses the whole speculative classify/apply body,
   * so the expensive fallback and walk run ONLY for probes the gate admits.
   */
  if (targetCanPossiblyMatch(selector, target, partial, parentSelector)) {
    recordExtendProfile?.('filter.calls');
    if (canUseWalkAndConsume(selector, target, !!parentSelector)) {
      const classified = classifyExtendMatch(selector, target, extendWith, partial, parentSelector);
      if (classified) {
        recordExtendProfile?.('filter.featureBearingCalls');
        return classified;
      }
      if (
        parentSelector
        && !partial
        && selector.hoistToRoot !== true
        && selector.valueOf() === target.valueOf()
      ) {
        /*
         * Exact nested matches like `.dd` under `.aa` must not fall back to the
         * parentless matcher, which would incorrectly treat the local fragment
         * as the full selector.
         */
        return false;
      }
    }

    // Fallback for value that do not need parent-context matching.
    const after = applyExtendsToSelector(selector, [instruction]);
    const localMatch = after.valueOf() !== selector.valueOf();
    if (localMatch) {
      recordExtendProfile?.('filter.featureBearingCalls');
      return 'local';
    }
    return false;
  }
  return false;
}

interface NonPartialAnalysis {
  nonPartialOwnOnly: ExtendInstruction[];
  hasAncestorDrivenNonPartial: boolean;
  hasParentMatchedOwnOnlyNonPartial: boolean;
}

function analyzeNonPartialExtends(
  ownSelector: Selector,
  selector: Selector,
  nonPartialOnly: ExtendInstruction[],
  parentSelector: Selector | null
): NonPartialAnalysis {
  const perInstruction = nonPartialOnly.map((instruction) => {
    const ownChangedSingle = wouldInstructionChangeSel(ownSelector, instruction);
    const fullAfterSingle = applyExtendsToSelector(selector, [instruction]);
    const fullChangedSingle = fullAfterSingle.valueOf() !== selector.valueOf();
    const parentHasTargetMatch = Boolean(parentSelector
      && !(parentSelector instanceof Nil)
      && findExtendableLocations(parentSelector, instruction.target).hasMatches);
    return { instruction, ownChangedSingle, fullChangedSingle, parentHasTargetMatch };
  });
  const fullChangedExtendWith = new Set(perInstruction.filter(d => d.fullChangedSingle).map(d => d.instruction.extendWith.valueOf()));
  const withInclusion = perInstruction.map(d => ({
    ...d,
    includeOwnOnly: (
      d.ownChangedSingle
      && !d.fullChangedSingle
      && !d.parentHasTargetMatch
      && !fullChangedExtendWith.has(d.instruction.extendWith.valueOf())
    )
  }));
  return {
    nonPartialOwnOnly: withInclusion.filter(x => x.includeOwnOnly).map(x => x.instruction),
    hasAncestorDrivenNonPartial: withInclusion.some(d =>
      !d.ownChangedSingle && d.fullChangedSingle && d.parentHasTargetMatch),
    hasParentMatchedOwnOnlyNonPartial: withInclusion.some(d =>
      d.ownChangedSingle && !d.fullChangedSingle && d.parentHasTargetMatch)
  };
}

export class ExtendRootRegistry {
  /*
   * Not weak. `registerRoot` adds every key of these five tables to `allRoots`
   * (and, where applicable, to `rootsByLayerName` / `rootsByNamespace`) — all
   * strong `Set`/`Map`s on this same object. The registry therefore already
   * pins every key for its own lifetime, so weak keys buy no earlier collection
   * and only add ephemeron entries for the collector to resolve.
   */
  private parentRoot = new Map<Rules, Rules>();
  private childrenRoots = new Map<Rules, Set<Rules>>();
  private layerName = new Map<Rules, string>();
  private isProtected = new Map<Rules, boolean>();
  private isCompose = new Map<Rules, boolean>();

  /*
   * TODO(dev): consume a namespace as a one-boundary filter during extend
   * lookup. `library|.box` selects library, then `.box` searches its reachable
   * mutable descendants; nested aliases stay local to the nested module.
   */
  private rootsByLayerName = new Map<string, Set<Rules>>();
  private rootsByNamespace = new Map<string, Set<Rules>>();
  private allRoots = new Set<Rules>();

  root?: Rules;
  extendRootStack: Rules[] = [];

  getCurrentExtendRoot(): Rules | undefined {
    return this.extendRootStack[this.extendRootStack.length - 1];
  }

  registerRoot(
    rules: Rules,
    parent?: Rules,
    options?: { layerName?: string; isProtected?: boolean; isCompose?: boolean; namespace?: string }
  ): void {
    this.allRoots.add(rules);
    if (parent) {
      this.allRoots.add(parent);
    }
    if (!this.root) {
      this.root = rules;
    }

    if (parent) {
      this.parentRoot.set(rules, parent);
      let children = this.childrenRoots.get(parent);
      if (!children) {
        children = new Set<Rules>();
        this.childrenRoots.set(parent, children);
      }
      children.add(rules);
    }

    if (options?.layerName) {
      this.layerName.set(rules, options.layerName);
      let layerRoots = this.rootsByLayerName.get(options.layerName);
      if (!layerRoots) {
        layerRoots = new Set<Rules>();
        this.rootsByLayerName.set(options.layerName, layerRoots);
      }
      layerRoots.add(rules);
    }

    if (options?.namespace) {
      let nsRoots = this.rootsByNamespace.get(options.namespace);
      if (!nsRoots) {
        nsRoots = new Set<Rules>();
        this.rootsByNamespace.set(options.namespace, nsRoots);
      }
      nsRoots.add(rules);
    }

    if (options?.isProtected) {
      this.isProtected.set(rules, true);
    }
    if (options?.isCompose) {
      this.isCompose.set(rules, true);
    }
  }

  pushExtendRoot(rules: Rules): void {
    this.extendRootStack.push(rules);
  }

  popExtendRoot(): void {
    this.extendRootStack.pop();
  }

  getVisibleRoots(root: Rules): Set<Rules> {
    return this.getAccessibleRoots(root);
  }

  getAccessibleRoots(root: Rules): Set<Rules> {
    const accessible = new Set<Rules>();
    const visited = new Set<Rules>();

    const traverseChildren = (currentRoot: Rules): void => {
      if (visited.has(currentRoot)) {
        return;
      }
      visited.add(currentRoot);
      accessible.add(currentRoot);

      if (this.isProtected.get(currentRoot)) {
        return;
      }

      const children = this.childrenRoots.get(currentRoot);
      if (children) {
        for (const child of children) {
          if (this.isProtected.get(child)) {
            continue;
          }
          traverseChildren(child);
        }
      }

      const layer = this.layerName.get(currentRoot);
      if (layer) {
        const sameLayerRoots = this.rootsByLayerName.get(layer);
        if (sameLayerRoots) {
          for (const layerRoot of sameLayerRoots) {
            if (layerRoot !== currentRoot && !visited.has(layerRoot) && !this.isProtected.get(layerRoot)) {
              accessible.add(layerRoot);
              traverseChildren(layerRoot);
            }
          }
        }
      }
    };

    traverseChildren(root);
    return accessible;
  }

  isSameOrDescendantRoot(rulesetRoot: Rules, extendRoot: Rules): boolean {
    if (rulesetRoot === extendRoot) {
      return true;
    }
    if (this.isProtected.get(rulesetRoot)) {
      return false;
    }
    const layerA = this.layerName.get(rulesetRoot);
    const layerB = this.layerName.get(extendRoot);
    if (layerA && layerB && layerA === layerB) {
      return true;
    }
    const children = this.childrenRoots.get(extendRoot);
    if (!children) {
      return false;
    }
    for (const child of children) {
      if (this.isProtected.get(child)) {
        continue;
      }
      if (this.isSameOrDescendantRoot(rulesetRoot, child)) {
        return true;
      }
    }
    return false;
  }

  getAllRoots(): Set<Rules> {
    return new Set(this.allRoots);
  }

  isProtectedRoot(rules: Rules): boolean {
    return this.isProtected.get(rules) === true;
  }
}

const rulesetsByRoot = new Map<Rules, Set<Ruleset>>();

export function registerRulesetWithRoot(root: Rules, ruleset: Ruleset): void {
  if (!root || !ruleset) {
    return;
  }
  let set = rulesetsByRoot.get(root);
  if (!set) {
    set = new Set<Ruleset>();
    rulesetsByRoot.set(root, set);
  }
  set.add(ruleset);
}

function isInstructionVisibleForRoot(
  context: Context,
  rootRules: Rules,
  instruction: {
    extendRoot?: Rules;
    fromReferenceScope: boolean;
  },
  getCachedVisibleRoots?: (root: Rules) => Set<Rules>,
  isSameOrDescendant?: (rulesetRoot: Rules, extendRoot: Rules) => boolean
): boolean {
  if (!instruction.extendRoot) {
    return false;
  }
  if (instruction.fromReferenceScope === true) {
    return false;
  }
  if (context.extendRoots.isProtectedRoot(rootRules) && instruction.extendRoot !== rootRules) {
    return false;
  }
  if (instruction.extendRoot === rootRules) {
    return true;
  }
  const sameOrDescendant = isSameOrDescendant
    ? isSameOrDescendant(rootRules, instruction.extendRoot)
    : context.extendRoots.isSameOrDescendantRoot(rootRules, instruction.extendRoot);
  if (sameOrDescendant) {
    return true;
  }
  const visibleRoots = getCachedVisibleRoots
    ? getCachedVisibleRoots(instruction.extendRoot)
    : context.extendRoots.getVisibleRoots(instruction.extendRoot);
  return visibleRoots.has(rootRules);
}

export function processExtends(context: Context): void {
  const extendPassStart = extendProfileNow ? extendProfileNow() : 0;

  /*
   * Ruleset registration only happens during a root's registration prep, which
   * runs on its FIRST eval. A re-eval of an already-prepared root (render's
   * evalForRender path) registers nothing, so the per-root set is empty. Without
   * registered rulesets there is nothing to search or extend; bail before the
   * warning pass would fire spurious "extend target not found" diagnostics and
   * before any selector state is touched.
   */
  if (rulesetsByRoot.size === 0) {
    return;
  }
  try {
    /*
     * No extends gathered this eval → skip the whole pre-extend selector
     * snapshot walk over every registered ruleset. (The instructions list
     * below would be empty anyway; bail before paying for the walk.)
     */
    if (!context.extends.length) {
      return;
    }

    /*
     * Install the pass-scoped matcher memo. The extend set is immutable for the
     * whole pass, so the invariant (target, find, extendWith, partial, parent)
     * match relation is cacheable — collapsing the O(I²) re-matching done by
     * chained-extend discovery + classify. Torn down in the finally below.
     */
    beginExtendMatchPass();

    /*
     * Snapshot eval'd value before any extend modifications.
     * This ensures getEffectiveSelector composes with original value,
     * not ones already modified by earlier extends in this pass.
     */
    preExtendSelectors.clear();
    for (const [, rulesetSet] of rulesetsByRoot) {
      for (const rs of rulesetSet) {
        const sel = selectorOrUndefined(rs.selector);
        if (sel) {
          preExtendSelectors.set(rs, sel);
        }
      }
    }

    // Find the nearest Ruleset ancestor of an extend node.
    const findExtendingRuleset = (extendNode: Node | undefined): Ruleset | undefined => {
      let cursor: Node | undefined = extendNode?.parent;
      while (cursor) {
        if (isRulesetValue(cursor)) {
          return cursor;
        }
        cursor = cursor.parent;
      }
      return undefined;
    };

    const instructions: RootExtendInstruction[] = context.extends.flatMap(([target, selectorWithExtend, partial, extendRoot, extendNode, , fromReferenceScope]) => {
      selectorWithExtend.keySetLibrary ??= context.selectorBits;
      const base = {
        extendWith: selectorWithExtend,
        extendingRuleset: findExtendingRuleset(extendNode),
        partial,
        extendRoot,
        extendNode,
        fromReferenceScope: fromReferenceScope === true
      };
      if (!partial && isNode(target, N.SelectorList)) {
        const expanded: RootExtendInstruction[] = [];
        for (const value of target.value) {
          const item = selectorListItemForRootExtend(value);
          item.keySetLibrary ??= context.selectorBits;
          expanded.push({
            ...base,
            target: item
          });
        }
        return expanded;
      }
      target.keySetLibrary ??= context.selectorBits;
      return [{
        ...base,
        target
      }];
    });

    if (!instructions.length) {
      return;
    }

    const instructionMatched = new Set<typeof instructions[0]>();

    const visibleRootsCache = new Map<Rules, Set<Rules>>();
    const getCachedVisibleRoots = (extendRoot: Rules): Set<Rules> => {
      let cached = visibleRootsCache.get(extendRoot);
      if (!cached) {
        cached = context.extendRoots.getVisibleRoots(extendRoot);
        visibleRootsCache.set(extendRoot, cached);
      }
      return cached;
    };

    /*
     * The extend-root graph (childrenRoots/layerName/isProtected) is fully built
     * during eval and STABLE for the whole processExtends pass, so
     * isSameOrDescendantRoot(rootRules, extendRoot) is invariant here. It is the
     * O(R × I × depth) driver — a recursive descendant walk run once per
     * (root × extend-instruction) pair. Memoize it per (extendRoot, rootRules)
     * for this pass. Pass-scoped: the cache is discarded when processExtends
     * returns, so no cross-render staleness is possible.
     */
    const sameOrDescendantCache = new Map<Rules, Map<Rules, boolean>>();
    const getCachedSameOrDescendant = (rulesetRoot: Rules, extendRoot: Rules): boolean => {
      let byRuleset = sameOrDescendantCache.get(extendRoot);
      if (!byRuleset) {
        byRuleset = new Map<Rules, boolean>();
        sameOrDescendantCache.set(extendRoot, byRuleset);
      }
      let cached = byRuleset.get(rulesetRoot);
      if (cached === undefined) {
        cached = context.extendRoots.isSameOrDescendantRoot(rulesetRoot, extendRoot);
        byRuleset.set(rulesetRoot, cached);
      }
      return cached;
    };

    for (const [rootRules, rulesetSet] of rulesetsByRoot) {
      if (!rootRules) {
        continue;
      }
      const visibleExtends = instructions.filter(instruction =>
        isInstructionVisibleForRoot(context, rootRules, instruction, getCachedVisibleRoots, getCachedSameOrDescendant));
      if (!visibleExtends.length) {
        continue;
      }
      for (const ruleset of rulesetSet) {
        /*
         * For classification: use pre-extend snapshot (original form).
         * For application: use current selector (for chaining).
         */
        const selectorLike = getLocalSelector(ruleset);
        const currentSelectorLike = selectorOrUndefined(ruleset.selector);
        const parentSel = getParentSelector(ruleset);
        if (
          !selectorLike
          || (typeof selectorLike !== 'string' && !Array.isArray(selectorLike) && selectorLike instanceof Nil)
        ) {
          ruleset.removeFlag(F_EXTENDED);
          continue;
        }
        const selector = asExtendSelectorNode(selectorLike);
        const selectorText = selectorSurfaceValueOf(selectorLike);
        selector.keySetLibrary ??= context.selectorBits;
        if (currentSelectorLike && typeof currentSelectorLike !== 'string' && !Array.isArray(currentSelectorLike)) {
          currentSelectorLike.keySetLibrary ??= context.selectorBits;
        }
        if (parentSel) {
          parentSel.keySetLibrary ??= context.selectorBits;
        }
        let isActivatedByVisibleExtend = false;
        let hasWithinAmpersandMatch = false;
        let hasAnyLocalMatch = false;
        let crossingInstructions: RootExtendInstruction[] = [];

        // Instructions excluded from local application (within-ampersand / crossing):
        const excludedFromLocal = new Set<RootExtendInstruction>();

        // First pass: classify each instruction.
        const classifications = new Map<RootExtendInstruction, MatchResult>();
        for (const instruction of visibleExtends) {
          const isSelfExtend = instruction.target.valueOf() === instruction.extendWith.valueOf();
          if (isSelfExtend) {
            const selfMatches = findExtendableLocations(selector, instruction.target).hasMatches;
            classifications.set(instruction, selfMatches ? 'local' : false);
          } else {
            classifications.set(instruction, classifyInstructionMatch(selector, instruction, parentSel));
          }
        }

        /*
         * Second pass: if a local match's extending ruleset has another visible
         * extend whose target matches the PARENT selector, reclassify as
         * within-ampersand (parent's extension covers this via nesting).
         */
        if (parentSel) {
          for (const [instruction, matchType] of classifications) {
            if (matchType !== 'local') {
              continue;
            }
            const { extendingRuleset: extendingRs } = instruction;
            if (!extendingRs) {
              continue;
            }
            for (const other of visibleExtends) {
              if (other === instruction) {
                continue;
              }
              const { extendingRuleset: otherExtendingRs } = other;
              if (otherExtendingRs !== extendingRs) {
                continue;
              }

              // Does this other extend match the parent selector?
              if (canUseWalkAndConsume(parentSel, other.target)
                && wouldExtendChange(parentSel, other.target, other.extendWith, other.partial)) {
                classifications.set(instruction, 'within-ampersand');
                break;
              }
            }
          }
        }

        // Third pass: aggregate.
        for (const instruction of visibleExtends) {
          const matchType = classifications.get(instruction);
          if (!matchType) {
            continue;
          }
          const activatesReferenceVisibility = (
            !instruction.partial
            || instruction.target.valueOf() === instruction.extendWith.valueOf()
          );
          instructionMatched.add(instruction);
          if (matchType === 'within-ampersand') {
            hasWithinAmpersandMatch = true;
            excludedFromLocal.add(instruction);
          } else if (matchType === 'crossing') {
            crossingInstructions.push(instruction);
            excludedFromLocal.add(instruction);
            if (activatesReferenceVisibility) {
              isActivatedByVisibleExtend = true;
            }
          } else {
            // 'local' match
            hasAnyLocalMatch = true;
            if (activatesReferenceVisibility) {
              isActivatedByVisibleExtend = true;
            }
          }
        }

        /*
         * Build apply-time instructions: when the extend has no explicit `selector`
         * (jess-specific override), compose extendWith with the extending ruleset's
         * parent chain relative to the current target. When `selector` IS set, use
         * the user-specified extendWith as-is.
         */
        const localApplicableExtends: RootExtendInstruction[] = [];
        for (const inst of visibleExtends) {
          const matchType = classifications.get(inst);
          if (matchType !== 'local') {
            continue;
          }
          if (excludedFromLocal.has(inst)) {
            continue;
          }
          const hasExplicitSelector = hasExplicitExtendSelector(inst.extendNode);
          const { extendingRuleset: extendingRs } = inst;
          let applyExtendWith = inst.extendWith;
          if (!hasExplicitSelector && extendingRs) {
            const composed = composeExtendWithRelativeToTarget(extendingRs, ruleset);
            if (composed) {
              applyExtendWith = composed;
            }
          }
          if (applyExtendWith === inst.extendWith) {
            localApplicableExtends.push(inst);
          } else {
            localApplicableExtends.push({ ...inst, extendWith: applyExtendWith });
          }
        }
        const hasCrossingMatch = crossingInstructions.length > 0;

        /*
         * If all matches are within-ampersand (no local or crossing matches),
         * the parent carries the extend — child inherits via & at render time.
         */
        if (hasWithinAmpersandMatch && !hasAnyLocalMatch && !hasCrossingMatch) {
          continue;
        }
        if (isActivatedByVisibleExtend) {
          ruleset.addFlag(F_EXTENDED);
          ruleset.addFlag(F_VISIBLE);

          /*
           * F_VISIBLE is the blanket marker that keeps all items visible in
           * reference-mode output. F_EXTENDED is NOT a blanket marker — it's
           * only set by extend-walk / extend.ts on items that were actually
           * matched by an extend or newly added by one. Keeping the two
           * concerns separate lets the reference-mode compose filter
           * distinguish "original, untouched" from "added by extend".
           */
          if (isSelectorListLike(selectorLike)) {
            for (const item of selectorListItems(selectorLike)) {
              if (typeof item !== 'string') {
                item.addFlag(F_VISIBLE);
              }
            }
          } else if (typeof selectorLike !== 'string') {
            selectorLike.addFlag(F_VISIBLE);
          }
        } else {
          ruleset.removeFlag(F_EXTENDED);
        }

        /*
         * Crossing match: target spans parent+child boundary → hoist to root.
         * The composed (parent+child) form IS the thing being extended as a whole.
         * Build a SelectorList: [composedForm, ...crossingExtendWithsComposed].
         */
        if (hasCrossingMatch && parentSel) {
          // Wrap child selector list in :is() so composition doesn't distribute.
          let childForCompose: SelectorLike = selectorLike;
          if (isSelectorListLike(selectorLike) && !selector.hasFlag(F_AMPERSAND)) {
            const childIs = PseudoSelector.create({ name: ':is', arg: copySelectorForExtend(selector) });
            childIs.generated = true;
            if (!isSelectorValue(childIs)) {
              throw new TypeError('Expected generated pseudo selector');
            }
            childForCompose = withSelectorBitLibrary(childIs, selector, parentSel);
          }
          const composedSurface = Ruleset.composeSelector(childForCompose, parentSel);

          /*
           * composeSelector can return a bare string when the child is a
           * string-backed leaf (e.g. a nested `.ext9`). A string carries no
           * bit-library slot to seed, so only thread the library into node output.
           */
          const composed = typeof composedSurface === 'string'
            ? composedSurface
            : withSelectorBitLibrary(
                asExtendSelectorNode(composedSurface),
                asExtendSelectorNode(childForCompose),
                parentSel
              );
          const items: SelectorListItem[] = [composed];
          for (const inst of crossingInstructions) {
            /*
             * For crossing matches, the extendWith must be the fully-composed
             * form of the extending ruleset (e.g. .footer-nav under .footer → .footer .footer-nav)
             */
            let extendWithComposed: Selector | undefined;
            let cursor: Node | undefined = inst.extendNode?.parent;
            while (cursor) {
              if (isRulesetValue(cursor)) {
                extendWithComposed = getFullComposedForm(cursor);
                break;
              }
              cursor = cursor.parent;
            }
            items.push(copySelectorForExtend(extendWithComposed ?? inst.extendWith));
          }
          const inheritFrom = isSelectorListLike(selectorLike) ? selectorLike : selector;
          const newSelectorSurface = items.length === 1
            ? items[0]!
            : finishSelectorListSurface(items, inheritFrom);
          if (
            typeof newSelectorSurface !== 'string'
            && !Array.isArray(newSelectorSurface)
            && !isSelectorValue(newSelectorSurface)
          ) {
            throw new TypeError('Expected crossing selector output');
          }
          assignLocalSelector(ruleset, newSelectorSurface);
          if (typeof newSelectorSurface !== 'string' && !Array.isArray(newSelectorSurface)) {
            newSelectorSurface.hoistToRoot = true;
          }
          ruleset.hoistToRoot = true;
          continue;
        }
        const ownSelector = getOwnSelectorOption(ruleset);
        const hasResolvedNestedSelector = Boolean(ownSelector
          && ownSelector.valueOf() !== selectorText);
        const hasOnlyPartialExtends = localApplicableExtends.length > 0
          && localApplicableExtends.every(instruction => instruction.partial);
        if (ownSelector && hasResolvedNestedSelector && hasOnlyPartialExtends) {
          const ownNewSelector = applyExtendsToSelector(ownSelector, localApplicableExtends);
          const fullNewSelector = applyExtendsToSelector(selector, localApplicableExtends);
          const ownBefore = ownSelector.valueOf();
          const ownAfter = ownNewSelector.valueOf();
          const fullBefore = selector.valueOf();
          const fullAfter = fullNewSelector.valueOf();
          if (ownNewSelector !== ownSelector && ownAfter !== ownBefore) {
            assignLocalSelector(ruleset, ownNewSelector);
            setOwnSelectorOption(ruleset, ownNewSelector);
            if (ownNewSelector.hoistToRoot) {
              ruleset.hoistToRoot = true;
            }
            continue;
          }
          if (fullAfter === fullBefore) {
            continue;
          }
        }
        if (ownSelector && hasResolvedNestedSelector) {
          const partialOnly = localApplicableExtends.filter(instruction => instruction.partial);
          const nonPartialOnly = localApplicableExtends.filter(instruction => !instruction.partial);
          if (partialOnly.length > 0 && nonPartialOnly.length === 0) {
            const ownAfterPartialOnly = applyExtendsToSelector(ownSelector, partialOnly);
            const fullAfterPartialOnly = applyExtendsToSelector(selector, partialOnly);
            const ownChangedByPartialOnly = ownAfterPartialOnly.valueOf() !== ownSelector.valueOf();
            const fullChangedByPartialOnly = fullAfterPartialOnly.valueOf() !== selector.valueOf();
            const parentSelector = getParentSelector(ruleset) ?? null;
            const canDeriveOwnFromGeneratedIs = Boolean(!ownChangedByPartialOnly
              && fullChangedByPartialOnly
              && parentSelector
              && !(parentSelector instanceof Nil)
              && fullAfterPartialOnly instanceof ComplexSelector
              && !ownSelector.hasFlag(F_AMPERSAND));
            if (canDeriveOwnFromGeneratedIs) {
              const complexValue: unknown = fullAfterPartialOnly.value;
              const last: unknown = Array.isArray(complexValue) ? complexValue.at(-1) : undefined;
              if (
                last
                && last instanceof PseudoSelector
                && last.name === ':is'
                && last.arg instanceof SelectorList
              ) {
                const derivedOwn = copySelectorForExtend(last.arg);
                assignLocalSelector(ruleset, derivedOwn);
                setOwnSelectorOption(ruleset, derivedOwn);
                continue;
              }
            }
          }
          if (nonPartialOnly.length > 0) {
            const parentSelectorForOwnSplit = getParentSelector(ruleset) ?? null;
            const {
              nonPartialOwnOnly,
              hasAncestorDrivenNonPartial,
              hasParentMatchedOwnOnlyNonPartial
            } = analyzeNonPartialExtends(ownSelector, selector, nonPartialOnly, parentSelectorForOwnSplit);
            if (partialOnly.length === 0) {
              if (hasAncestorDrivenNonPartial) {
                const ownAfterOwnOnly = applyExtendsToSelector(ownSelector, nonPartialOwnOnly);
                assignLocalSelector(ruleset, ownAfterOwnOnly);
                setOwnSelectorOption(ruleset, ownAfterOwnOnly);
                continue;
              }
            } else {
              const ownAfterPartial = applyExtendsToSelector(ownSelector, partialOnly);
              const ownAfterNonPartial = applyExtendsToSelector(ownSelector, nonPartialOnly);
              const fullAfterNonPartial = applyExtendsToSelector(selector, nonPartialOnly);
              const ownChangedByNonPartial = ownAfterNonPartial.valueOf() !== ownSelector.valueOf();
              const fullChangedByNonPartial = fullAfterNonPartial.valueOf() !== selector.valueOf();
              const nonPartialBoundaryOnly = !ownChangedByNonPartial && fullChangedByNonPartial;
              const ownChangedByPartial = ownAfterPartial.valueOf() !== ownSelector.valueOf();

              if (nonPartialBoundaryOnly && (ownChangedByPartial || nonPartialOwnOnly.length > 0)) {
                const newSel = applyExtendsToSelector(selector, nonPartialOnly);
                if (newSel.valueOf() !== selector.valueOf()) {
                  newSel.hoistToRoot = true;
                  assignLocalSelector(ruleset, newSel);
                  ruleset.hoistToRoot = true;
                }
                continue;
              }
              if (ownChangedByPartial || nonPartialOwnOnly.length > 0) {
                const ownAfterBoth = applyExtendsToSelector(
                  ownSelector,
                  [...partialOnly, ...nonPartialOwnOnly]
                );
                assignLocalSelector(ruleset, ownAfterBoth);
                setOwnSelectorOption(ruleset, ownAfterBoth);
                continue;
              }
              if (hasParentMatchedOwnOnlyNonPartial) {
                assignLocalSelector(ruleset, ownAfterPartial);
                setOwnSelectorOption(ruleset, ownAfterPartial);
                continue;
              }
              const shouldDeferToParentForNonPartial = Boolean(!ownChangedByPartial
                && nonPartialOwnOnly.length === 0
                && hasAncestorDrivenNonPartial);
              if (shouldDeferToParentForNonPartial) {
                assignLocalSelector(ruleset, ownAfterPartial);
                setOwnSelectorOption(ruleset, ownAfterPartial);
                continue;
              }
            }
          }
        }
        const applyInput = asExtendSelectorNode(currentSelectorLike ?? selectorLike);
        const newSelector = applyExtendsToSelector(
          applyInput,
          localApplicableExtends,
          visibleExtends
        );
        if (newSelector.valueOf() !== applyInput.valueOf()) {
          if (hasOnlyPartialExtends && isNode(newSelector, N.SelectorList)) {
            const previousValues = new Set<string>();
            if (applyInput instanceof SelectorList) {
              for (const item of applyInput.value) {
                previousValues.add(item.valueOf());
              }
            } else {
              previousValues.add(applyInput.valueOf());
            }
            for (const item of newSelector.value) {
              if (typeof item !== 'string' && !previousValues.has(item.valueOf())) {
                item.addFlag(F_EXTENDED);
              }
            }
          }
          assignLocalSelector(ruleset, newSelector);
          if (newSelector.hoistToRoot) {
            ruleset.hoistToRoot = true;
          }
        }
      }
    }

    // Emit warnings for unmatched extend instructions
    for (const instruction of instructions) {
      if (instruction.fromReferenceScope === true) {
        continue;
      }
      if (instructionMatched.has(instruction)) {
        continue;
      }
      const target = instruction.target.valueOf();

      /*
       * Line/col are no longer stored on nodes (only offsets); the diagnostic path
       * derives them from the node/offset + source.
       */
      const targetLine: number | undefined = undefined;
      const targetColumn: number | undefined = undefined;
      const targetFile = instruction.target.sourceRoot?._treeContext?.file;
      const targetFilePath = targetFile?.fullPath;
      const blockedProtectedRootExists = Array.from(rulesetsByRoot.keys()).some((root) => {
        if (!root) {
          return false;
        }
        if (isInstructionVisibleForRoot(context, root, instruction, getCachedVisibleRoots)) {
          return false;
        }
        const rulesets = rulesetsByRoot.get(root);
        if (!rulesets) {
          return false;
        }
        return Array.from(rulesets).some((ruleset) => {
          const selLike = selectorOrUndefined(ruleset.selector);

          /*
           * Parser-delivered selectors may be string/array-backed. The extend
           * engine's placement copy calls Node methods, so materialize to a
           * Selector node first (mirrors the main classification path above).
           */
          return !!selLike && wouldInstructionChangeSel(asExtendSelectorNode(selLike), instruction);
        });
      });
      const diagnostic = (
        blockedProtectedRootExists
          ? WARN.extendNotAccessible({
              ctx: targetFile ? { file: targetFile } : undefined,
              filePath: targetFilePath,
              line: targetLine,
              column: targetColumn,
              meta: { target }
            })
          : WARN.extendNotFound({
              ctx: targetFile ? { file: targetFile } : undefined,
              filePath: targetFilePath,
              line: targetLine,
              column: targetColumn,
              meta: { target }
            })
      );
      context.warn(diagnostic);
    }
  } finally {
    endExtendMatchPass();
    rulesetsByRoot.clear();
    preExtendSelectors.clear();
    if (extendProfileNow) {
      recordExtendProfile?.('processExtends.calls');
      recordExtendProfile?.('processExtends.ms', extendProfileNow() - extendPassStart);
    }
  }
}
