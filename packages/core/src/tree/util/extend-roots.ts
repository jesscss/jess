import type { Context } from '../../context.js';
import { WARN, toDiagnostic } from '../../jess-error.js';
import type { AtRule } from '../at-rule.js';
import { Combinator } from '../combinator.js';
import { ComplexSelector } from '../selector-complex.js';
import type { Rules } from '../rules.js';
import type { Ruleset } from '../ruleset.js';
import type { Selector } from '../selector.js';
import { SelectorList } from '../selector-list.js';
import { PseudoSelector } from '../selector-pseudo.js';

import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { Nil } from '../nil.js';
import { F_AMPERSAND, F_EXTENDED, F_VISIBLE } from '../node.js';
import { getImplicitSelector as getImplicitSelectorUtil } from './selector-utils.js';

/**
 * @todo - Rewrite entirely by hand
 */

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
    const fullAfterSingle = applyExtendsToSelector(selector.copy(true) as Selector, [instruction]);
    const fullChangedSingle = fullAfterSingle.valueOf() !== selector.valueOf();
    const parentHasTargetMatch = Boolean(
      parentSelector
      && !(parentSelector instanceof Nil)
      && findExtendableLocations(parentSelector, instruction.target).hasMatches
    );
    return { instruction, ownChangedSingle, fullChangedSingle, parentHasTargetMatch };
  });
  const fullChangedExtendWith = new Set(
    perInstruction
      .filter(d => d.fullChangedSingle && !d.ownChangedSingle)
      .map(d => d.instruction.extendWith.valueOf())
  );
  const withInclusion = perInstruction.map(d => ({
    ...d,
    includeOwnOnly: (
      d.ownChangedSingle
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

function applyExtendsToSelectorPure(
  selector: Selector,
  instructions: ExtendInstruction[]
): Selector {
  return applyExtendsToSelector(selector.copy(true) as Selector, instructions);
}

function wrapSelectorForComposition(selector: Selector): Selector {
  if (isNode(selector, N.SelectorList)) {
    const list = selector as SelectorList;
    if (list.data.length === 1) {
      return list.data[0]!.copy(true) as Selector;
    }
    const wrapped = PseudoSelector.create({
      name: ':is',
      arg: list.copy(true) as Selector
    });
    wrapped.generated = true;
    return wrapped;
  }
  return selector.copy(true) as Selector;
}

function composeParentAndOwnSelector(parentSelector: Selector, ownSelector: Selector, inheritFrom: Selector): Selector {
  return ComplexSelector.create([
    wrapSelectorForComposition(parentSelector),
    Combinator.create(' '),
    wrapSelectorForComposition(ownSelector)
  ]).inherit(inheritFrom) as Selector;
}

function invalidateRulesetSelectorCaches(ruleset: Ruleset): void {
  ruleset.invalidateSelectorValueCache();
  invalidateSelectorTreeCaches(ruleset.data.selector);
  invalidateSelectorTreeCaches((ruleset.options as { ownSelector?: Selector | Nil }).ownSelector);
  invalidateSelectorTreeCaches(ruleset.data.selectorBeforeExtend as Selector | Nil | undefined);
  const rules = ruleset.data?.rules;
  if (!rules || !isNode(rules, N.Rules)) {
    return;
  }
  for (const child of (rules as Rules).data) {
    if (isNode(child, N.Ruleset)) {
      invalidateRulesetSelectorCaches(child as Ruleset);
    }
  }
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
    const instructions = context.extends.map(([target, selectorWithExtend, partial, extendRoot, extendNode, , fromReferenceScope]) => ({
      target,
      extendWith: selectorWithExtend,
      partial,
      extendRoot,
      extendNode,
      fromReferenceScope: fromReferenceScope === true
    }));

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
        const selector = ruleset.data.selector as Selector | undefined;
        if (!selector || isNode(selector, N.Nil)) {
          ruleset.removeFlag(F_EXTENDED);
          continue;
        }
        let isActivatedByVisibleExtend = false;
        for (const instruction of visibleExtends) {
          const isSelfExtend = instruction.target.valueOf() === instruction.extendWith.valueOf();
          if (isSelfExtend) {
            if (findExtendableLocations(selector, instruction.target).hasMatches) {
              instructionMatched.add(instruction);
              isActivatedByVisibleExtend = true;
            }
          } else if (wouldInstructionChangeSel(selector, instruction)) {
            instructionMatched.add(instruction);
            if (!instruction.partial) {
              isActivatedByVisibleExtend = true;
            }
          }
        }
        if (isActivatedByVisibleExtend) {
          ruleset.addFlag(F_EXTENDED);
          ruleset.addFlag(F_VISIBLE);
          if (isNode(selector, N.SelectorList)) {
            for (const item of (selector as SelectorList).data) {
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
        const ownSelector = (ruleset.options as { ownSelector?: Selector })?.ownSelector;
        const hasResolvedNestedSelector = Boolean(
          ownSelector
          && ownSelector.valueOf() !== selector.valueOf()
        );
        const hasOnlyPartialExtends = visibleExtends.length > 0 && visibleExtends.every(instruction => instruction.partial);
        if (ownSelector && hasResolvedNestedSelector && hasOnlyPartialExtends) {
          const ownNewSelector = applyExtendsToSelectorPure(ownSelector, visibleExtends);
          const fullNewSelector = applyExtendsToSelectorPure(selector, visibleExtends);
          const ownBefore = ownSelector.valueOf();
          const ownAfter = ownNewSelector.valueOf();
          const fullBefore = selector.valueOf();
          const fullAfter = fullNewSelector.valueOf();
          if (ownNewSelector !== ownSelector && ownAfter !== ownBefore) {
            ruleset.setData('selector', ownNewSelector);
            (ruleset.options as { ownSelector?: Selector }).ownSelector = ownNewSelector;
            invalidateRulesetSelectorCaches(ruleset);
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
          if (partialOnly.length === 0 && nonPartialOnly.length > 0) {
            const parentRulesetForOwnBoundary = (
              ruleset.parent?.parent && isNode(ruleset.parent.parent, N.Ruleset)
                ? (ruleset.parent.parent as Ruleset)
                : null
            );
            const ownSelectorForBoundary = (
              parentRulesetForOwnBoundary
              && !ownSelector.hasFlag(F_AMPERSAND)
                ? getImplicitSelectorUtil(
                    ownSelector.copy(true) as Selector,
                    parentRulesetForOwnBoundary,
                    false
                  )
                : ownSelector
            );
            const ownAfterNonPartialOnly = applyExtendsToSelectorPure(ownSelectorForBoundary, nonPartialOnly);
            const fullAfterNonPartialOnly = applyExtendsToSelectorPure(selector, nonPartialOnly);
            const ownChangedByNonPartialOnly = ownAfterNonPartialOnly.valueOf() !== ownSelectorForBoundary.valueOf();
            const fullChangedByNonPartialOnly = fullAfterNonPartialOnly.valueOf() !== selector.valueOf();

            // Exact extends that only change the resolved selector via an ancestor
            // should not rewrite the nested rule's own selector. Preserve the local
            // selector shape and let the parent carry the extend expansion.
            if (!ownChangedByNonPartialOnly && fullChangedByNonPartialOnly) {
              ruleset.setData('selector', ownSelector);
              (ruleset.options as { ownSelector?: Selector }).ownSelector = ownSelector;
              invalidateRulesetSelectorCaches(ruleset);
              continue;
            }
          }
          if (partialOnly.length > 0 && nonPartialOnly.length === 0) {
            const ownAfterPartialOnly = applyExtendsToSelectorPure(ownSelector, partialOnly);
            const fullAfterPartialOnly = applyExtendsToSelectorPure(selector, partialOnly);
            const ownChangedByPartialOnly = ownAfterPartialOnly.valueOf() !== ownSelector.valueOf();
            const fullChangedByPartialOnly = fullAfterPartialOnly.valueOf() !== selector.valueOf();
            const parentSelector = (
              ruleset.parent?.parent && isNode(ruleset.parent.parent, N.Ruleset)
                ? (ruleset.parent.parent as Ruleset).data.selector
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
              const last = complex.data.at(-1);
              if (
                last
                && isNode(last, N.PseudoSelector)
                && (last as PseudoSelector).data.name === ':is'
                && (last as PseudoSelector).data.arg
                && isNode((last as PseudoSelector).data.arg!, N.SelectorList)
              ) {
                const derivedOwn = ((last as PseudoSelector).data.arg as SelectorList).copy(true) as Selector;
                ruleset.setData('selector', derivedOwn);
                (ruleset.options as { ownSelector?: Selector }).ownSelector = derivedOwn;
                invalidateRulesetSelectorCaches(ruleset);
                continue;
              }
            }
          }
          if (nonPartialOnly.length > 0) {
            const parentSelectorForOwnSplit = (
              ruleset.parent?.parent && isNode(ruleset.parent.parent, N.Ruleset)
                ? (ruleset.parent.parent as Ruleset).data.selector as Selector
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
                ruleset.setData('selector', ownAfterOwnOnly);
                (ruleset.options as { ownSelector?: Selector }).ownSelector = ownAfterOwnOnly;
                invalidateRulesetSelectorCaches(ruleset);
                continue;
              }
            } else {
              const ownAfterPartial = applyExtendsToSelectorPure(ownSelector, partialOnly);
              const ownAfterNonPartial = applyExtendsToSelectorPure(ownSelector, nonPartialOnly);
              const fullAfterNonPartial = applyExtendsToSelectorPure(selector, nonPartialOnly);
              const ownChangedByNonPartial = ownAfterNonPartial.valueOf() !== ownSelector.valueOf();
              const fullChangedByNonPartial = fullAfterNonPartial.valueOf() !== selector.valueOf();
              const nonPartialBoundaryOnly = !ownChangedByNonPartial && fullChangedByNonPartial;
              const ownChangedByPartial = ownAfterPartial.valueOf() !== ownSelector.valueOf();

              if (nonPartialBoundaryOnly && (ownChangedByPartial || nonPartialOwnOnly.length > 0)) {
                const newSel = applyExtendsToSelector(selector, nonPartialOnly);
                if (newSel.valueOf() !== selector.valueOf()) {
                  newSel.hoistToRoot = true;
                  ruleset.setData('selector', newSel);
                  invalidateRulesetSelectorCaches(ruleset);
                  ruleset.hoistToRoot = true;
                }
                continue;
              }
              if (ownChangedByPartial || nonPartialOwnOnly.length > 0) {
                const ownAfterBoth = applyExtendsToSelector(
                  ownSelector,
                  [...partialOnly, ...nonPartialOwnOnly]
                );
                ruleset.setData('selector', ownAfterBoth);
                (ruleset.options as { ownSelector?: Selector }).ownSelector = ownAfterBoth;
                invalidateRulesetSelectorCaches(ruleset);
                continue;
              }
              if (hasParentMatchedOwnOnlyNonPartial) {
                ruleset.setData('selector', ownAfterPartial);
                (ruleset.options as { ownSelector?: Selector }).ownSelector = ownAfterPartial;
                invalidateRulesetSelectorCaches(ruleset);
                continue;
              }
              const shouldDeferToParentForNonPartial = Boolean(
                !ownChangedByPartial
                && nonPartialOwnOnly.length === 0
                && hasAncestorDrivenNonPartial
              );
              if (shouldDeferToParentForNonPartial) {
                ruleset.setData('selector', ownAfterPartial);
                (ruleset.options as { ownSelector?: Selector }).ownSelector = ownAfterPartial;
                invalidateRulesetSelectorCaches(ruleset);
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
            ? applyExtendsToSelectorPure(ownSelector, ownRelevantExtends)
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
          const parentSelectorForBoundary = parentRuleset?.data.selector;
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
            const parentSelector = parentRuleset?.data.selector;
            if (parentSelector && !(parentSelector instanceof Nil) && isNode(parentSelector, N.SelectorList)) {
              const parentItems = (parentSelector as SelectorList).data;
              const complexItems = parentItems.filter(item => isNode(item, N.ComplexSelector)) as ComplexSelector[];
              if (complexItems.length === parentItems.length && complexItems.length >= 2) {
                const first = complexItems[0]!;
                const allTri = complexItems.every(c => c.data.length === 3 && isNode(c.data[1], N.Combinator));
                if (allTri) {
                  const leftKey = first.data[0]!.valueOf();
                  const combKey = first.data[1]!.valueOf();
                  const samePrefix = complexItems.every(c =>
                    c.data[0]!.valueOf() === leftKey
                    && c.data[1]!.valueOf() === combKey
                  );
                  if (samePrefix) {
                    const ownSelectorNode = ownSelector as Selector;
                    const middleIs = PseudoSelector.create({
                      name: ':is',
                      arg: SelectorList.create(
                        complexItems.map(c => c.data[2]!.copy(true) as Selector)
                      )
                    });
                    const parentFactored = ComplexSelector.create([
                      first.data[0]!.copy(true) as Selector,
                      (first.data[1] as Combinator).copy(true),
                      middleIs
                    ]);
                    const ownArg = isNode(ownSelectorNode, N.SelectorList)
                      ? SelectorList.create((ownSelectorNode as SelectorList).data.map(s => s.copy(true) as Selector))
                      : SelectorList.create([ownSelectorNode.copy(true) as Selector]);
                    const ownIs = PseudoSelector.create({ name: ':is', arg: ownArg });
                    newSelector = ComplexSelector.create([
                      ...parentFactored.data.map(c => c.copy(true)),
                      Combinator.create(' '),
                      ownIs
                    ]).inherit(newSelector) as Selector;
                    newSelector.hoistToRoot = true;
                  }
                }
              }
            }
          }
          const shouldFactorNestedExactSelector = Boolean(
            ownSelector
            && hasResolvedNestedSelector
            && !hasOnlyPartialExtends
            && !ownChangedByRelevant
            && parentRuleset
            && !parentRuleset.hoistToRoot
            && isNode(newSelector, N.SelectorList)
            && isNode(parentRuleset.data.selector as Selector, N.SelectorList)
            && isNode(ownSelector as Selector, N.SelectorList)
          );
          if (shouldFactorNestedExactSelector) {
            const parentSelector = parentRuleset!.data.selector;
            if (parentSelector && !(parentSelector instanceof Nil)) {
              const previousValues = new Set<string>();
              const parentItems = isNode(parentSelector as Selector, N.SelectorList)
                ? (parentSelector as SelectorList).data
                : [parentSelector as Selector];
              const ownItems = isNode(ownSelector as Selector, N.SelectorList)
                ? (ownSelector as SelectorList).data
                : [ownSelector as Selector];
              for (const parentItem of parentItems) {
                for (const ownItem of ownItems) {
                  previousValues.add(
                    ComplexSelector.create([
                      parentItem.copy(true) as Selector,
                      Combinator.create(' '),
                      ownItem.copy(true) as Selector
                    ]).valueOf()
                  );
                }
              }
              const addedItems = (newSelector as SelectorList).data
                .filter(item => !previousValues.has(item.valueOf()))
                .map(item => item.copy(true) as Selector);
              if (addedItems.length > 0) {
                const factoredBase = composeParentAndOwnSelector(
                  parentSelector as Selector,
                  ownSelector as Selector,
                  newSelector
                );
                newSelector = SelectorList.create([
                  factoredBase,
                  ...addedItems
                ]).inherit(newSelector) as Selector;
                newSelector.hoistToRoot = true;
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
              for (const item of (selector as SelectorList).data) {
                previousValues.add(item.valueOf());
              }
            } else {
              previousValues.add(selector.valueOf());
            }
            for (const item of (newSelector as SelectorList).data) {
              if (!previousValues.has(item.valueOf())) {
                item.addFlag(F_EXTENDED);
              }
            }
          }
          ruleset.setData('selector', newSelector);
          invalidateRulesetSelectorCaches(ruleset);
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
          const sel = ruleset.data.selector as Selector | undefined;
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
