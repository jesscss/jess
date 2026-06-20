import type { Context } from '../../context.js';
import { WARN, toDiagnostic } from '../../jess-error.js';
import { ComplexSelector } from '../selector-complex.js';
import type { Rules } from '../rules.js';
import { Ruleset } from '../ruleset.js';
import type { Selector } from '../selector.js';
import { SelectorList } from '../selector-list.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { applyExtendsToSelector, type ExtendInstruction } from './extend.js';
import { findExtendableLocations } from './extend-helpers.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { wouldExtendChange, canUseWalkAndConsume, classifyExtendMatch } from './extend-walk.js';
import type { MatchResult } from './extend-walk.js';
import { Nil } from '../nil.js';
import { F_AMPERSAND, F_EXTENDED, F_VISIBLE, type Node } from '../node.js';
import { copySelectorForPlacement as copySelectorForExtend } from './selector-utils.js';

type RootExtendInstruction = ExtendInstruction & {
  extendingRuleset?: Ruleset;
  fromReferenceScope: boolean;
};

function isSelectorValue(value: unknown): value is Selector {
  return !!value
    && typeof value === 'object'
    && 'isSelector' in value
    && value.isSelector === true;
}

function isRulesValue(value: unknown): value is Rules {
  return isNode(value, N.Rules);
}

function isRulesetValue(value: unknown): value is Ruleset {
  return isNode(value, N.Ruleset);
}

function selectorOrUndefined(value: Selector | Nil | undefined): Selector | undefined {
  return value instanceof Nil ? undefined : value;
}

function getOwnSelectorOption(ruleset: Ruleset): Selector | undefined {
  const ownSelector: unknown = ruleset.options?.ownSelector;
  return isSelectorValue(ownSelector) ? ownSelector : undefined;
}

function setOwnSelectorOption(ruleset: Ruleset, selector: Selector): void {
  ruleset.options ??= {};
  ruleset.options.ownSelector = selector;
}

function hasExplicitExtendSelector(node: Node | undefined): boolean {
  const value: unknown = node?.value;
  return !!value
    && typeof value === 'object'
    && 'selector' in value
    && !!value.selector;
}

/**
 * Get the parent Ruleset's selector by walking up the tree.
 * Returns undefined if there's no parent Ruleset (root level).
 */
function getParentRuleset(ruleset: Ruleset): Ruleset | undefined {
  const parentRules = ruleset.parent;
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
  // Walk up through & -only parents (implicit wrappers around at-rule contents)
  // to find the nearest parent Ruleset with actual selector content.
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
    if (isNode(sel, N.Ampersand)) {
      current = parentRuleset;
      continue;
    }
    return sel;
  }
}

/** Snapshot of eval'd selectors before any extend modifications */
let preExtendSelectors = new WeakMap<Ruleset, Selector>();

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
function getLocalSelector(ruleset: Ruleset): Selector | undefined {
  return selectorOrUndefined(ruleset.selector);
}

function assignLocalSelector(ruleset: Ruleset, selector: Selector): void {
  ruleset.adopt(selector);
  ruleset.selector = selector;
  ruleset.invalidateSelectorValueCache(selector);
}

/**
 * Get the PRE-EXTEND local selector for a Ruleset (from snapshot).
 * Used for parent lookups in composed forms so we don't propagate extend
 * additions through parent chains.
 */
function getLocalSelectorPreExtend(ruleset: Ruleset): Selector | undefined {
  return selectorOrUndefined(preExtendSelectors.get(ruleset) ?? ruleset.selector);
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
  // Walk up from extending ruleset, collecting local selectors, until we
  // reach a ruleset that is also an ancestor of the target (or root).
  const targetAncestors = targetRuleset
    ? new Set<Ruleset>([targetRuleset, ...getRulesetAncestors(targetRuleset)])
    : new Set<Ruleset>();
  const pathLocals: Selector[] = [extendingLocal];
  let current: Ruleset | undefined = getParentRuleset(extendingRuleset);
  while (current && !targetAncestors.has(current)) {
    const local = getLocalSelectorPreExtend(current);
    if (local) {
      pathLocals.unshift(local);
    }
    current = getParentRuleset(current);
  }
  // Compose from outermost to innermost
  let result: Selector = pathLocals[0]!;
  for (let i = 1; i < pathLocals.length; i++) {
    let child: Selector = pathLocals[i]!;
    // Wrap child SelectorList in :is() to avoid distribution
    if (isNode(child, N.SelectorList) && !child.hasFlag(F_AMPERSAND)) {
      const childIs = PseudoSelector.create({ name: ':is', arg: copySelectorForExtend(child) });
      childIs.generated = true;
      if (!isSelectorValue(childIs)) {
        throw new TypeError('Expected generated pseudo selector');
      }
      child = withSelectorBitLibrary(childIs, child, result);
    }
    result = withSelectorBitLibrary(
      (Ruleset as typeof Ruleset).composeSelector(child, result),
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
  const parent = getParentRuleset(ruleset);
  if (!parent) {
    return local;
  }
  const parentComposed = getFullComposedForm(parent);
  if (!parentComposed) {
    return local;
  }
  // Wrap child SelectorList in :is() to avoid distribution in composeSelector
  let childForCompose: Selector = local;
  if (isNode(local, N.SelectorList) && !local.hasFlag(F_AMPERSAND)) {
    const childIs = PseudoSelector.create({ name: ':is', arg: copySelectorForExtend(local) });
    childIs.generated = true;
    if (!isSelectorValue(childIs)) {
      throw new TypeError('Expected generated pseudo selector');
    }
    childForCompose = withSelectorBitLibrary(childIs, local, parentComposed);
  }
  return withSelectorBitLibrary(
    (Ruleset as typeof Ruleset).composeSelector(childForCompose, parentComposed),
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

function classifyInstructionMatch(
  selector: Selector,
  instruction: ExtendInstruction,
  parentSelector?: Selector
): MatchResult {
  const { target, extendWith, partial } = instruction;
  if (canUseWalkAndConsume(selector, target, !!parentSelector)) {
    const classified = classifyExtendMatch(selector, target, extendWith, partial, parentSelector);
    if (classified) {
      return classified;
    }
    if (
      parentSelector
      && !partial
      && selector.hoistToRoot !== true
      && selector.valueOf() === target.valueOf()
    ) {
      // Exact nested matches like `.dd` under `.aa` must not fall back to the
      // parentless matcher, which would incorrectly treat the local fragment
      // as the full selector.
      return false;
    }
  }
  // Fallback for selectors that do not need parent-context matching.
  const after = applyExtendsToSelector(selector, [instruction]);
  return after.valueOf() !== selector.valueOf() ? 'local' : false;
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
    const parentHasTargetMatch = Boolean(
      parentSelector
      && !(parentSelector instanceof Nil)
      && findExtendableLocations(parentSelector, instruction.target).hasMatches
    );
    return { instruction, ownChangedSingle, fullChangedSingle, parentHasTargetMatch };
  });
  const fullChangedExtendWith = new Set(
    perInstruction.filter(d => d.fullChangedSingle).map(d => d.instruction.extendWith.valueOf())
  );
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
      !d.ownChangedSingle && d.fullChangedSingle && d.parentHasTargetMatch
    ),
    hasParentMatchedOwnOnlyNonPartial: withInclusion.some(d =>
      d.ownChangedSingle && !d.fullChangedSingle && d.parentHasTargetMatch
    )
  };
}

export class ExtendRootRegistry {
  private parentRoot = new WeakMap<Rules, Rules>();
  private childrenRoots = new WeakMap<Rules, Set<Rules>>();
  private layerName = new WeakMap<Rules, string>();
  private isProtected = new WeakMap<Rules, boolean>();
  private isCompose = new WeakMap<Rules, boolean>();
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
  getCachedVisibleRoots?: (root: Rules) => Set<Rules>
): boolean {
  if (!instruction.extendRoot) {
    return false;
  }
  const sameRootSurface = (
    instruction.extendRoot === rootRules
    || instruction.extendRoot.sourceNode === rootRules
    || rootRules.sourceNode === instruction.extendRoot
    || (
      instruction.extendRoot.sourceNode !== instruction.extendRoot
      && instruction.extendRoot.sourceNode === rootRules.sourceNode
    )
    || haveSameRuleChildSources(instruction.extendRoot, rootRules)
  );
  if (instruction.fromReferenceScope === true) {
    return false;
  }
  if (context.extendRoots.isProtectedRoot(rootRules) && !sameRootSurface) {
    return false;
  }
  if (sameRootSurface) {
    return true;
  }
  if (context.extendRoots.isSameOrDescendantRoot(rootRules, instruction.extendRoot)) {
    return true;
  }
  const visibleRoots = getCachedVisibleRoots
    ? getCachedVisibleRoots(instruction.extendRoot)
    : context.extendRoots.getVisibleRoots(instruction.extendRoot);
  return visibleRoots.has(rootRules);
}

function haveSameRuleChildSources(left: Rules, right: Rules): boolean {
  if (left.rules.length !== right.rules.length || left.rules.length === 0) {
    return false;
  }
  for (let i = 0; i < left.rules.length; i++) {
    const leftChild = left.rules[i]!;
    const rightChild = right.rules[i]!;
    if (
      leftChild !== rightChild
      && leftChild.sourceNode !== rightChild
      && rightChild.sourceNode !== leftChild
      && leftChild.sourceNode !== rightChild.sourceNode
    ) {
      return false;
    }
  }
  return true;
}


export function processExtends(context: Context): void {
  try {
    // Snapshot eval'd selectors before any extend modifications.
    // This ensures getEffectiveSelector composes with original selectors,
    // not ones already modified by earlier extends in this pass.
    preExtendSelectors = new WeakMap<Ruleset, Selector>();
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
        return target.value.map((item) => {
          item.keySetLibrary ??= context.selectorBits;
          return {
            ...base,
            target: item
          };
        });
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

    for (const [rootRules, rulesetSet] of rulesetsByRoot) {
      if (!rootRules) {
        continue;
      }
      const visibleExtends = instructions.filter(instruction =>
        isInstructionVisibleForRoot(context, rootRules, instruction, getCachedVisibleRoots)
      );
      if (!visibleExtends.length) {
        continue;
      }
      for (const ruleset of rulesetSet) {
        // For classification: use pre-extend snapshot (original form).
        // For application: use current selector (for chaining).
        const selector = getLocalSelector(ruleset);
        const currentSelector = selectorOrUndefined(ruleset.selector);
        const parentSel = getParentSelector(ruleset);
        if (!selector || isNode(selector, N.Nil)) {
          ruleset.removeFlag(F_EXTENDED);
          continue;
        }
        selector.keySetLibrary ??= context.selectorBits;
        if (currentSelector) {
          currentSelector.keySetLibrary ??= context.selectorBits;
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
        // Second pass: if a local match's extending ruleset has another visible
        // extend whose target matches the PARENT selector, reclassify as
        // within-ampersand (parent's extension covers this via nesting).
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
        // Build apply-time instructions: when the extend has no explicit `selector`
        // (jess-specific override), compose extendWith with the extending ruleset's
        // parent chain relative to the current target. When `selector` IS set, use
        // the user-specified extendWith as-is.
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
        // If all matches are within-ampersand (no local or crossing matches),
        // the parent carries the extend — child inherits via & at render time.
        if (hasWithinAmpersandMatch && !hasAnyLocalMatch && !hasCrossingMatch) {
          continue;
        }
        if (isActivatedByVisibleExtend) {
          ruleset.addFlag(F_EXTENDED);
          ruleset.addFlag(F_VISIBLE);
          // F_VISIBLE is the blanket marker that keeps all items visible in
          // reference-mode output. F_EXTENDED is NOT a blanket marker — it's
          // only set by extend-walk / extend.ts on items that were actually
          // matched by an extend or newly added by one. Keeping the two
          // concerns separate lets the reference-mode compose filter
          // distinguish "original, untouched" from "added by extend".
          if (selector instanceof SelectorList) {
            for (const item of selector.value) {
              item.addFlag(F_VISIBLE);
            }
          } else {
            selector.addFlag(F_VISIBLE);
          }
        } else {
          ruleset.removeFlag(F_EXTENDED);
        }
        // Crossing match: target spans parent+child boundary → hoist to root.
        // The composed (parent+child) form IS the thing being extended as a whole.
        // Build a SelectorList: [composedForm, ...crossingExtendWithsComposed].
        if (hasCrossingMatch && parentSel) {
          // Wrap child SelectorList in :is() so composition doesn't distribute.
          let childForCompose: Selector = selector;
          if (isNode(selector, N.SelectorList) && !selector.hasFlag(F_AMPERSAND)) {
            const childIs = PseudoSelector.create({ name: ':is', arg: copySelectorForExtend(selector) });
            childIs.generated = true;
            if (!isSelectorValue(childIs)) {
              throw new TypeError('Expected generated pseudo selector');
            }
            childForCompose = withSelectorBitLibrary(childIs, selector, parentSel);
          }
          const composed = withSelectorBitLibrary(
            (Ruleset as typeof Ruleset).composeSelector(childForCompose, parentSel),
            childForCompose,
            parentSel
          );
          const items: Selector[] = [composed];
          for (const inst of crossingInstructions) {
            // For crossing matches, the extendWith must be the fully-composed
            // form of the extending ruleset (e.g. .footer-nav under .footer → .footer .footer-nav)
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
          const newSelector = items.length === 1
            ? composed
            : SelectorList.create(items).inherit(selector);
          if (!isSelectorValue(newSelector)) {
            throw new TypeError('Expected crossing selector output');
          }
          assignLocalSelector(ruleset, newSelector);
          ruleset._composedSelector = newSelector;
          ruleset.hoistToRoot = true;
          newSelector.hoistToRoot = true;
          continue;
        }
        const ownSelector = getOwnSelectorOption(ruleset);
        const hasResolvedNestedSelector = Boolean(
          ownSelector
          && ownSelector.valueOf() !== selector.valueOf()
        );
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
            const canDeriveOwnFromGeneratedIs = Boolean(
              !ownChangedByPartialOnly
              && fullChangedByPartialOnly
              && parentSelector
              && !(parentSelector instanceof Nil)
              && fullAfterPartialOnly instanceof ComplexSelector
              && !ownSelector.hasFlag(F_AMPERSAND)
            );
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
              const shouldDeferToParentForNonPartial = Boolean(
                !ownChangedByPartial
                && nonPartialOwnOnly.length === 0
                && hasAncestorDrivenNonPartial
              );
              if (shouldDeferToParentForNonPartial) {
                assignLocalSelector(ruleset, ownAfterPartial);
                setOwnSelectorOption(ruleset, ownAfterPartial);
                continue;
              }
            }
          }
        }
        const applyInput = currentSelector ?? selector;
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
              if (!previousValues.has(item.valueOf())) {
                item.addFlag(F_EXTENDED);
              }
            }
          }
          assignLocalSelector(ruleset, newSelector);
          ruleset._composedSelector = newSelector;
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
      const targetLocation = instruction.target.location;
      const targetLine = targetLocation.length >= 2 ? targetLocation[1] : undefined;
      const targetColumn = targetLocation.length >= 3 ? targetLocation[2] : undefined;
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
          const sel = selectorOrUndefined(ruleset.selector);
          return !!sel && wouldInstructionChangeSel(sel, instruction);
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
      context.warnings.push(toDiagnostic(diagnostic));
    }
  } finally {
    rulesetsByRoot.clear();
  }
}
