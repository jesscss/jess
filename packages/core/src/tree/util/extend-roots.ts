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
import { wouldExtendChange, canUseWalkAndConsume, classifyExtendMatch, type MatchResult } from './extend-walk.js';
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
  const parentRuleset = getParentRuleset(ruleset);
  if (!parentRuleset) {
    return undefined;
  }
  // Use the pre-extend snapshot to avoid composing with already-extended selectors.
  const sel = preExtendSelectors.get(parentRuleset) ?? parentRuleset.value?.selector;
  if (!sel || sel instanceof Nil) {
    return undefined;
  }
  return sel as Selector;
}

/** Snapshot of eval'd selectors before any extend modifications */
let preExtendSelectors = new WeakMap<Ruleset, Selector>();

/**
 * Get the local (pre-extend) selector for a Ruleset.
 * Uses the pre-extend snapshot to avoid seeing already-extended selectors.
 */
function getLocalSelector(ruleset: Ruleset): Selector | undefined {
  const sel = (preExtendSelectors.get(ruleset) ?? ruleset.value.selector) as Selector | undefined;
  if (!sel || isNode(sel, N.Nil)) {
    return undefined;
  }
  return sel;
}

/**
 * Compose a selector with its full parent chain for OUTPUT purposes.
 * Used when an extend crosses the parent boundary and we need the
 * extending ruleset's fully-composed form as the extendWith.
 */
function getFullComposedForm(ruleset: Ruleset): Selector | undefined {
  const local = getLocalSelector(ruleset);
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
    childForCompose = childIs as unknown as Selector;
  }
  return (Ruleset as typeof Ruleset).composeSelector(childForCompose, parentComposed);
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
    return classifyExtendMatch(selector, target, extendWith, partial, parentSelector);
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
    this.layerNames.set(atRule, layerName);
  }

  getLayerName(atRule: AtRule): string | undefined {
    return this.layerNames.get(atRule);
  }

  takeLayerName(atRule: AtRule): string | undefined {
    const layer = this.layerNames.get(atRule);
    if (layer) {
      this.layerNames.delete(atRule);
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

    const instructions = context.extends.map(([target, selectorWithExtend, partial, extendRoot, extendNode, , fromReferenceScope]) => {
      return {
        target,
        extendWith: selectorWithExtend,
        partial,
        extendRoot,
        extendNode,
        fromReferenceScope: fromReferenceScope === true
      };
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
        const selector = getLocalSelector(ruleset);
        const parentSel = getParentSelector(ruleset);
        if (!selector || isNode(selector, N.Nil)) {
          ruleset.removeFlag(F_EXTENDED);
          continue;
        }
        let isActivatedByVisibleExtend = false;
        let hasWithinAmpersandMatch = false;
        const crossingInstructions: ExtendInstruction[] = [];
        for (const instruction of visibleExtends) {
          const isSelfExtend = instruction.target.valueOf() === instruction.extendWith.valueOf();
          if (isSelfExtend) {
            if (findExtendableLocations(selector, instruction.target).hasMatches) {
              instructionMatched.add(instruction);
              isActivatedByVisibleExtend = true;
            }
          } else {
            const matchType = classifyInstructionMatch(selector, instruction, parentSel);
            if (matchType) {
              instructionMatched.add(instruction);
              if (matchType === 'within-ampersand') {
                // Parent carries this extend — child inherits via & at render time
                hasWithinAmpersandMatch = true;
              } else if (matchType === 'crossing') {
                crossingInstructions.push(instruction);
                if (!instruction.partial) {
                  isActivatedByVisibleExtend = true;
                }
              } else {
                // 'local' match
                if (!instruction.partial) {
                  isActivatedByVisibleExtend = true;
                }
              }
            }
          }
        }
        const hasCrossingMatch = crossingInstructions.length > 0;
        // If all matches are within-ampersand (no local or crossing matches),
        // the parent carries the extend — child inherits via & at render time.
        if (hasWithinAmpersandMatch && !isActivatedByVisibleExtend && !hasCrossingMatch) {
          continue;
        }
        if (isActivatedByVisibleExtend) {
          ruleset.addFlag(F_EXTENDED);
          ruleset.addFlag(F_VISIBLE);
          if (isNode(selector, N.SelectorList)) {
            for (const item of (selector as SelectorList).value) {
              item.addFlag(F_EXTENDED);
              item.addFlag(F_VISIBLE);
            }
          } else {
            selector.addFlag(F_EXTENDED);
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
            childForCompose = childIs as unknown as Selector;
          }
          const composed = (Ruleset as typeof Ruleset).composeSelector(childForCompose, parentSel);
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
        const hasOnlyPartialExtends = visibleExtends.length > 0 && visibleExtends.every(instruction => instruction.partial);
        if (ownSelector && hasResolvedNestedSelector && hasOnlyPartialExtends) {
          const ownNewSelector = applyExtendsToSelector(ownSelector, visibleExtends);
          const fullNewSelector = applyExtendsToSelector(selector, visibleExtends);
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
          const partialOnly = visibleExtends.filter(instruction => instruction.partial);
          const nonPartialOnly = visibleExtends.filter(instruction => !instruction.partial);
          if (partialOnly.length > 0 && nonPartialOnly.length === 0) {
            const ownAfterPartialOnly = applyExtendsToSelector(ownSelector, partialOnly);
            const fullAfterPartialOnly = applyExtendsToSelector(selector, partialOnly);
            const ownChangedByPartialOnly = ownAfterPartialOnly.valueOf() !== ownSelector.valueOf();
            const fullChangedByPartialOnly = fullAfterPartialOnly.valueOf() !== selector.valueOf();
            const parentSelector = (
              ruleset.parent?.parent && isNode(ruleset.parent.parent, N.Ruleset)
                ? (ruleset.parent.parent as Ruleset).value.selector
                : null
            );
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
            const parentSelectorForOwnSplit = (
              ruleset.parent?.parent && isNode(ruleset.parent.parent, N.Ruleset)
                ? (ruleset.parent.parent as Ruleset).value.selector as Selector
                : null
            );
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
        let newSelector = applyExtendsToSelector(selector, visibleExtends);
        if (newSelector !== selector) {
          const beforeValue = selector.valueOf();
          const ownRelevantExtends = (ownSelector && hasResolvedNestedSelector)
            ? visibleExtends.filter(instruction => instruction.partial)
            : visibleExtends;
          const ownAfterRelevant = (ownSelector && hasResolvedNestedSelector)
            ? applyExtendsToSelector(ownSelector, ownRelevantExtends)
            : null;
          const ownChangedByRelevant = Boolean(
            ownSelector
            && ownAfterRelevant
            && ownAfterRelevant.valueOf() !== ownSelector.valueOf()
          );
          const parentRuleset = (
            ruleset.parent?.parent && isNode(ruleset.parent.parent, N.Ruleset)
              ? (ruleset.parent.parent as Ruleset)
              : null
          );
          const parentSelectorForBoundary = parentRuleset?.value.selector;
          const parentHasCombinatorContext = Boolean(
            parentSelectorForBoundary
            && !(parentSelectorForBoundary instanceof Nil)
            && (() => {
              try {
                for (const n of (parentSelectorForBoundary as Selector).nodes()) {
                  if (isNode(n, N.Combinator)) {
                    return true;
                  }
                }
              } catch {}
              return false;
            })()
          );
          const parentHoistedBoundaryCompose = Boolean(
            ownSelector
            && hasResolvedNestedSelector
            && !hasOnlyPartialExtends
            && !ownChangedByRelevant
            && (rootRules.options as any)?.referenceMode !== true
            && parentRuleset?.hoistToRoot
            && !newSelector.hoistToRoot
          );
          if (parentHoistedBoundaryCompose) {
            const parentSelector = parentRuleset?.value.selector;
            if (parentSelector && !(parentSelector instanceof Nil) && isNode(parentSelector, N.SelectorList)) {
              const parentItems = (parentSelector as SelectorList).value;
              const complexItems = parentItems.filter(item => isNode(item, N.ComplexSelector)) as ComplexSelector[];
              if (complexItems.length === parentItems.length && complexItems.length >= 2) {
                const first = complexItems[0]!;
                const allTri = complexItems.every(c => c.value.length === 3 && isNode(c.value[1], N.Combinator));
                if (allTri) {
                  const leftKey = first.value[0]!.valueOf();
                  const combKey = first.value[1]!.valueOf();
                  const samePrefix = complexItems.every(c =>
                    c.value[0]!.valueOf() === leftKey
                    && c.value[1]!.valueOf() === combKey
                  );
                  if (samePrefix) {
                    const ownSelectorNode = ownSelector as Selector;
                    const middleIs = PseudoSelector.create({
                      name: ':is',
                      arg: SelectorList.create(
                        complexItems.map(c => c.value[2]!.copy(true) as Selector)
                      )
                    });
                    const parentFactored = ComplexSelector.create([
                      first.value[0]!.copy(true) as Selector,
                      (first.value[1] as Combinator).copy(true),
                      middleIs
                    ]);
                    const ownArg = isNode(ownSelectorNode, N.SelectorList)
                      ? SelectorList.create((ownSelectorNode as SelectorList).value.map(s => s.copy(true) as Selector))
                      : SelectorList.create([ownSelectorNode.copy(true) as Selector]);
                    const ownIs = PseudoSelector.create({ name: ':is', arg: ownArg });
                    newSelector = ComplexSelector.create([
                      ...parentFactored.value.map(c => c.copy(true)),
                      Combinator.create(' '),
                      ownIs
                    ]).inherit(newSelector) as Selector;
                    newSelector.hoistToRoot = true;
                  }
                }
              }
            }
          }
          const boundaryOnlyNestedExactChange = Boolean(
            ownSelector
            && hasResolvedNestedSelector
            && !hasOnlyPartialExtends
            && !ownChangedByRelevant
            && parentHasCombinatorContext
            && !(
              ruleset.parent?.parent
              && isNode(ruleset.parent.parent, N.Ruleset)
              && Boolean((ruleset.parent.parent as Ruleset).hoistToRoot)
            )
            && !newSelector.hoistToRoot
          );
          if (boundaryOnlyNestedExactChange) {
            newSelector.hoistToRoot = true;
          }
          const finalAfterValue = newSelector.valueOf();
          if (beforeValue === finalAfterValue) {
            continue;
          }
          if (hasOnlyPartialExtends && isNode(newSelector, N.SelectorList)) {
            const previousValues = new Set<string>();
            if (isNode(selector, N.SelectorList)) {
              for (const item of (selector as SelectorList).value) {
                previousValues.add(item.valueOf());
              }
            } else {
              previousValues.add(selector.valueOf());
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
