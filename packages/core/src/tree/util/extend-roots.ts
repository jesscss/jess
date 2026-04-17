import type { Context } from '../../context.js';
import { WARN, toDiagnostic } from '../../jess-error.js';
import type { AtRule } from '../at-rule.js';
import { Combinator } from '../combinator.js';
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
import { F_AMPERSAND, F_EXTENDED, F_VISIBLE } from '../node.js';

/**
 * Get the parent Ruleset's selector by walking up the tree.
 * Returns undefined if there's no parent Ruleset (root level).
 */
function getParentRuleset(ruleset: Ruleset): Ruleset | undefined {
  const parentRules = ruleset.getParent();
  if (!parentRules || !isNode(parentRules, N.Rules)) {
    return undefined;
  }
  const parentRuleset = (parentRules as Rules).getParent();
  if (!parentRuleset || !isNode(parentRuleset, N.Ruleset)) {
    return undefined;
  }
  return parentRuleset as Ruleset;
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
 * Get the current local selector for a Ruleset (value.selector).
 * Used for classification and application where we want to see prior updates
 * (supports extend chaining).
 */
function getLocalSelector(ruleset: Ruleset): Selector | undefined {
  const sel = ruleset.value.selector as Selector | undefined;
  if (!sel || isNode(sel, N.Nil)) {
    return undefined;
  }
  return sel;
}

/**
 * Get the PRE-EXTEND local selector for a Ruleset (from snapshot).
 * Used for parent lookups in composed forms so we don't propagate extend
 * additions through parent chains.
 */
function getLocalSelectorPreExtend(ruleset: Ruleset): Selector | undefined {
  const sel = (preExtendSelectors.get(ruleset) ?? ruleset.value.selector) as Selector | undefined;
  if (!sel || isNode(sel, N.Nil)) {
    return undefined;
  }
  return sel;
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
      const childIs = PseudoSelector.create({ name: ':is', arg: child.copy(true) as Selector });
      childIs.generated = true;
      child = withSelectorBitLibrary(childIs as unknown as Selector, child, result);
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
    const childIs = PseudoSelector.create({ name: ':is', arg: local.copy(true) as Selector });
    childIs.generated = true;
    childForCompose = withSelectorBitLibrary(childIs as unknown as Selector, local, parentComposed);
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
    if (parentSelector && !partial && selector.valueOf() === target.valueOf()) {
      // Exact nested matches like `.dd` under `.aa` must not fall back to the
      // parentless legacy matcher, which would incorrectly treat the local
      // fragment as the full selector.
      return false;
    }
  }
  // Fallback: legacy path (no parent context)
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
  private layerNames = new WeakMap<AtRule, string>();
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

  setLayerName(atRule: AtRule, layerName: string): void {
    for (const key of getAtRuleLayerKeys(atRule)) {
      this.layerNames.set(key, layerName);
    }
  }

  getLayerName(atRule: AtRule): string | undefined {
    for (const key of getAtRuleLayerKeys(atRule)) {
      const layerName = this.layerNames.get(key);
      if (layerName) {
        return layerName;
      }
    }
    return undefined;
  }

  takeLayerName(atRule: AtRule): string | undefined {
    const keys = getAtRuleLayerKeys(atRule);
    let layer: string | undefined;
    for (const key of keys) {
      layer ??= this.layerNames.get(key);
    }
    if (layer) {
      for (const key of keys) {
        this.layerNames.delete(key);
      }
    }
    return layer;
  }

  getAllRoots(): Set<Rules> {
    return new Set(this.allRoots);
  }

  isProtectedRoot(rules: Rules): boolean {
    return this.isProtected.get(rules) === true;
  }
}

const rulesetsByRoot = new Map<Rules, Set<Ruleset>>();

function getAtRuleLayerKeys(atRule: AtRule): AtRule[] {
  const sourceAtRule = atRule.sourceNode as AtRule | undefined;
  if (!sourceAtRule || sourceAtRule === atRule) {
    return [atRule];
  }
  return [atRule, sourceAtRule];
}

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
  if (instruction.fromReferenceScope === true) {
    return false;
  }
  if (context.extendRoots.isProtectedRoot(rootRules) && instruction.extendRoot !== rootRules) {
    return false;
  }
  if (instruction.extendRoot === rootRules) {
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

export function processExtends(context: Context): void {
  try {
    // Snapshot eval'd selectors before any extend modifications.
    // This ensures getEffectiveSelector composes with original selectors,
    // not ones already modified by earlier extends in this pass.
    preExtendSelectors = new WeakMap<Ruleset, Selector>();
    for (const [, rulesetSet] of rulesetsByRoot) {
      for (const rs of rulesetSet) {
        const sel = rs.value?.selector;
        if (sel && !(sel instanceof Nil)) {
          preExtendSelectors.set(rs, sel as Selector);
        }
      }
    }

    // Find the nearest Ruleset ancestor of an extend node.
    const findExtendingRuleset = (extendNode: any): Ruleset | undefined => {
      let cursor: any = extendNode?.parent;
      while (cursor) {
        if (isNode(cursor, N.Ruleset)) {
          return cursor as Ruleset;
        }
        cursor = cursor.parent;
      }
      return undefined;
    };

    const instructions = context.extends.flatMap(([target, selectorWithExtend, partial, extendRoot, extendNode, , fromReferenceScope]) => {
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
        // For application: use current value.selector (for chaining).
        const selector = getLocalSelector(ruleset);
        const currentSelector = ruleset.value.selector as Selector | undefined;
        const parentSel = getParentSelector(ruleset);
        if (!selector || isNode(selector, N.Nil)) {
          ruleset.removeFlag(F_EXTENDED);
          continue;
        }
        selector.keySetLibrary ??= context.selectorBits;
        if (currentSelector && !isNode(currentSelector, N.Nil)) {
          currentSelector.keySetLibrary ??= context.selectorBits;
        }
        if (parentSel) {
          parentSel.keySetLibrary ??= context.selectorBits;
        }
        let isActivatedByVisibleExtend = false;
        let hasWithinAmpersandMatch = false;
        let hasAnyLocalMatch = false;
        let crossingInstructions: ExtendInstruction[] = [];
        // Instructions excluded from local application (within-ampersand / crossing):
        const excludedFromLocal = new Set<ExtendInstruction>();
        // First pass: classify each instruction.
        const classifications = new Map<ExtendInstruction, MatchResult>();
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
            const extendingRs = (instruction as any).extendingRuleset as Ruleset | undefined;
            if (!extendingRs) {
              continue;
            }
            for (const other of visibleExtends) {
              if (other === instruction) {
                continue;
              }
              const otherExtendingRs = (other as any).extendingRuleset as Ruleset | undefined;
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
        const localApplicableExtends: ExtendInstruction[] = [];
        for (const inst of visibleExtends) {
          const matchType = classifications.get(inst);
          if (matchType !== 'local') {
            continue;
          }
          if (excludedFromLocal.has(inst)) {
            continue;
          }
          const extendNode = (inst as any).extendNode;
          const hasExplicitSelector = extendNode && extendNode.value && extendNode.value.selector;
          const extendingRs = (inst as any).extendingRuleset as Ruleset | undefined;
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
          if (isNode(selector, N.SelectorList)) {
            for (const item of (selector as SelectorList).value) {
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
            const childIs = PseudoSelector.create({ name: ':is', arg: selector.copy(true) as Selector });
            childIs.generated = true;
            childForCompose = withSelectorBitLibrary(childIs as unknown as Selector, selector, parentSel);
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
            let cursor: any = inst.extendNode?.parent;
            while (cursor) {
              if (isNode(cursor, N.Ruleset)) {
                extendWithComposed = getFullComposedForm(cursor as Ruleset);
                break;
              }
              cursor = cursor.parent;
            }
            items.push((extendWithComposed ?? inst.extendWith).copy(true) as Selector);
          }
          const newSelector = items.length === 1
            ? composed
            : SelectorList.create(items).inherit(selector) as Selector;
          ruleset.value.selector = newSelector;
          ruleset._composedSelector = newSelector;
          ruleset.hoistToRoot = true;
          newSelector.hoistToRoot = true;
          ruleset.invalidateSelectorValueCache();
          continue;
        }
        const ownSelector = (ruleset.options as { ownSelector?: Selector })?.ownSelector;
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
            ruleset.value.selector = ownNewSelector;
            (ruleset.options as { ownSelector?: Selector }).ownSelector = ownNewSelector;
            ruleset.invalidateSelectorValueCache();
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
              && isNode(fullAfterPartialOnly, N.ComplexSelector)
              && !ownSelector.hasFlag(F_AMPERSAND)
            );
            if (canDeriveOwnFromGeneratedIs) {
              const complex = fullAfterPartialOnly as ComplexSelector;
              const last = complex.value.at(-1);
              if (
                last
                && isNode(last, N.PseudoSelector)
                && (last as PseudoSelector).value.name === ':is'
                && (last as PseudoSelector).value.arg
                && isNode((last as PseudoSelector).value.arg!, N.SelectorList)
              ) {
                const derivedOwn = ((last as PseudoSelector).value.arg as SelectorList).copy(true) as Selector;
                ruleset.value.selector = derivedOwn;
                (ruleset.options as { ownSelector?: Selector }).ownSelector = derivedOwn;
                ruleset.invalidateSelectorValueCache();
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
                ruleset.value.selector = ownAfterOwnOnly;
                (ruleset.options as { ownSelector?: Selector }).ownSelector = ownAfterOwnOnly;
                ruleset.invalidateSelectorValueCache();
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
                  ruleset.value.selector = newSel;
                  ruleset.invalidateSelectorValueCache();
                  ruleset.hoistToRoot = true;
                }
                continue;
              }
              if (ownChangedByPartial || nonPartialOwnOnly.length > 0) {
                const ownAfterBoth = applyExtendsToSelector(
                  ownSelector,
                  [...partialOnly, ...nonPartialOwnOnly]
                );
                ruleset.value.selector = ownAfterBoth;
                (ruleset.options as { ownSelector?: Selector }).ownSelector = ownAfterBoth;
                ruleset.invalidateSelectorValueCache();
                continue;
              }
              if (hasParentMatchedOwnOnlyNonPartial) {
                ruleset.value.selector = ownAfterPartial;
                (ruleset.options as { ownSelector?: Selector }).ownSelector = ownAfterPartial;
                ruleset.invalidateSelectorValueCache();
                continue;
              }
              const shouldDeferToParentForNonPartial = Boolean(
                !ownChangedByPartial
                && nonPartialOwnOnly.length === 0
                && hasAncestorDrivenNonPartial
              );
              if (shouldDeferToParentForNonPartial) {
                ruleset.value.selector = ownAfterPartial;
                (ruleset.options as { ownSelector?: Selector }).ownSelector = ownAfterPartial;
                ruleset.invalidateSelectorValueCache();
                continue;
              }
            }
          }
        }
        const applyInput = (currentSelector && !isNode(currentSelector, N.Nil) ? currentSelector : selector) as Selector;
        const newSelector = applyExtendsToSelector(
          applyInput,
          localApplicableExtends,
          visibleExtends
        );
        if (newSelector.valueOf() !== applyInput.valueOf()) {
          if (hasOnlyPartialExtends && isNode(newSelector, N.SelectorList)) {
            const previousValues = new Set<string>();
            if (isNode(applyInput, N.SelectorList)) {
              for (const item of (applyInput as SelectorList).value) {
                previousValues.add(item.valueOf());
              }
            } else {
              previousValues.add(applyInput.valueOf());
            }
            for (const item of (newSelector as SelectorList).value) {
              if (!previousValues.has(item.valueOf())) {
                item.addFlag(F_EXTENDED);
              }
            }
          }
          ruleset.value.selector = newSelector;
          ruleset._composedSelector = newSelector;
          ruleset.invalidateSelectorValueCache();
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
      const targetFile = instruction.target.treeContext?.file;
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
          const sel = ruleset.value.selector as Selector | undefined;
          return sel && !isNode(sel, N.Nil) && wouldInstructionChangeSel(sel, instruction);
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
