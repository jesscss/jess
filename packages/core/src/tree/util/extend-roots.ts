import type { Context } from '../../context.js';
import type { AtRule } from '../at-rule.js';
import { Combinator } from '../combinator.js';
import { ComplexSelector } from '../selector-complex.js';
import type { Rules } from '../rules.js';
import type { Ruleset } from '../ruleset.js';
import type { Selector } from '../selector.js';
import { SelectorList } from '../selector-list.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { applyExtendsToSelector } from './extend.js';
import { findExtendableLocations } from './extend-helpers.js';
import { isNode } from './is-node.js';
import { Nil } from '../nil.js';
import { F_EXTENDED } from '../node.js';
import { ensureRulesetTraceId, getOptionalRulesetTraceId } from './ruleset-trace.js';
import { getImplicitSelector as getImplicitSelectorUtil } from './selector-utils.js';

export class ExtendRootRegistry {
  private parentRoot = new WeakMap<Rules, Rules>();
  private childrenRoots = new WeakMap<Rules, Set<Rules>>();
  private layerName = new WeakMap<Rules, string>();
  private isProtected = new WeakMap<Rules, boolean>();
  private isCompose = new WeakMap<Rules, boolean>();
  private rootsByLayerName = new Map<string, Set<Rules>>();
  private rootsByNamespace = new Map<string, Set<Rules>>();
  private layerNames = new WeakMap<AtRule, string>();

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

      if (currentRoot.value?.length) {
        for (const node of currentRoot.value) {
          if (node && isNode(node, 'Ruleset') && node.value?.rules && isNode(node.value.rules, 'Rules')) {
            const innerRules = node.value.rules as Rules;
            if (!visited.has(innerRules)) {
              accessible.add(innerRules);
              traverseChildren(innerRules);
            }
          } else if (node && isNode(node, 'Rules')) {
            const innerRules = node as Rules;
            if (!visited.has(innerRules)) {
              accessible.add(innerRules);
              traverseChildren(innerRules);
            }
          }
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
}

const rulesetsByRoot = new Map<Rules, Set<Ruleset>>();

function getSourceNodeTraceId(ruleset: Ruleset): number | null {
  const sourceNode = ruleset.sourceNode as Ruleset | undefined;
  if (!sourceNode) {
    return null;
  }
  return getOptionalRulesetTraceId(sourceNode) ?? null;
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
  const sourceNode = ruleset.sourceNode;
}

export function processExtends(context: Context): void {
  const instructions = context.extends.map(([target, selectorWithExtend, partial, extendRoot]) => ({
    target,
    extendWith: selectorWithExtend,
    partial,
    extendRoot
  }));

  if (!instructions.length) {
    return;
  }

  for (const [rootRules, rulesetSet] of rulesetsByRoot) {
    if (!rootRules) {
      continue;
    }
    const visibleExtends = instructions.filter((instruction) => {
      if (!instruction.extendRoot) {
        return false;
      }
      if (instruction.extendRoot === rootRules) {
        return true;
      }
      if (context.extendRoots.isSameOrDescendantRoot(rootRules, instruction.extendRoot)) {
        return true;
      }
      const visibleRoots = context.extendRoots.getVisibleRoots(instruction.extendRoot);
      return visibleRoots.has(rootRules);
    });
    if (!visibleExtends.length) {
      continue;
    }
    const activatingExtends = visibleExtends.filter((instruction) => {
      const extendRootOptions = (instruction.extendRoot?.options as any) ?? {};
      return extendRootOptions.referenceMode !== true;
    });
    for (const ruleset of rulesetSet) {
      const selector = ruleset.value.selector as Selector | undefined;
      if (!selector || isNode(selector, 'Nil')) {
        ruleset.removeFlag(F_EXTENDED);
        continue;
      }
      const isActivatedByVisibleExtend = activatingExtends.some(instruction =>
        !instruction.partial
        && findExtendableLocations(selector, instruction.target).hasMatches
      );
      if (isActivatedByVisibleExtend) {
        ruleset.addFlag(F_EXTENDED);
        if (isNode(selector, 'SelectorList')) {
          for (const item of (selector as SelectorList).value) {
            item.addFlag(F_EXTENDED);
          }
        } else {
          selector.addFlag(F_EXTENDED);
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
            ruleset.parent?.parent && isNode(ruleset.parent.parent, 'Ruleset')
              ? (ruleset.parent.parent as Ruleset).value.selector
              : null
          );
          const canDeriveOwnFromGeneratedIs = Boolean(
            !ownChangedByPartialOnly
            && fullChangedByPartialOnly
            && parentSelector
            && !(parentSelector instanceof Nil)
            && isNode(fullAfterPartialOnly, 'ComplexSelector')
          );
          if (canDeriveOwnFromGeneratedIs) {
            const complex = fullAfterPartialOnly as ComplexSelector;
            const last = complex.value.at(-1);
            if (
              last
              && isNode(last, 'PseudoSelector')
              && (last as PseudoSelector).value.name === ':is'
              && (last as PseudoSelector).value.arg
              && isNode((last as PseudoSelector).value.arg!, 'SelectorList')
            ) {
              const derivedOwn = ((last as PseudoSelector).value.arg as SelectorList).copy(true) as Selector;
              ruleset.value.selector = derivedOwn;
              (ruleset.options as { ownSelector?: Selector }).ownSelector = derivedOwn;
              ruleset.invalidateSelectorValueCache();
              continue;
            }
          }
        }
        if (partialOnly.length === 0 && nonPartialOnly.length > 0) {
          const parentSelectorForOwnSplit = (
            ruleset.parent?.parent && isNode(ruleset.parent.parent, 'Ruleset')
              ? (ruleset.parent.parent as Ruleset).value.selector
              : null
          );
          const nonPartialDiagnostics = nonPartialOnly.map((instruction) => {
            const ownAfterSingle = applyExtendsToSelector(ownSelector, [instruction]);
            const fullAfterSingle = applyExtendsToSelector(selector, [instruction]);
            const ownChangedSingle = ownAfterSingle.valueOf() !== ownSelector.valueOf();
            const fullChangedSingle = fullAfterSingle.valueOf() !== selector.valueOf();
            const parentHasTargetMatch = Boolean(
              parentSelectorForOwnSplit
              && !(parentSelectorForOwnSplit instanceof Nil)
              && findExtendableLocations(
                parentSelectorForOwnSplit as Selector,
                instruction.target
              ).hasMatches
            );
            return {
              instruction,
              ownChangedSingle,
              fullChangedSingle,
              parentHasTargetMatch
            };
          });
          const fullChangedExtendWith = new Set(
            nonPartialDiagnostics
              .filter(d => d.fullChangedSingle)
              .map(d => d.instruction.extendWith.valueOf())
          );
          const nonPartialWithInclusion = nonPartialDiagnostics.map((d) => {
            const includeOwnOnly = (
              d.ownChangedSingle
              && !d.fullChangedSingle
              && !d.parentHasTargetMatch
              && !fullChangedExtendWith.has(d.instruction.extendWith.valueOf())
            );
            return { ...d, includeOwnOnly };
          });
          const nonPartialOwnOnly = nonPartialWithInclusion
            .filter(x => x.includeOwnOnly)
            .map(x => x.instruction);
          const ownAfterOwnOnly = applyExtendsToSelector(ownSelector, nonPartialOwnOnly);
          const hasAncestorDrivenNonPartial = nonPartialWithInclusion.some(d =>
            !d.ownChangedSingle
            && d.fullChangedSingle
            && d.parentHasTargetMatch
          );
          if (hasAncestorDrivenNonPartial) {
            // Parent already carries this non-partial effect; keep nested selector local.
            ruleset.value.selector = ownAfterOwnOnly;
            (ruleset.options as { ownSelector?: Selector }).ownSelector = ownAfterOwnOnly;
            ruleset.invalidateSelectorValueCache();
            continue;
          }
        }
        if (partialOnly.length > 0 && nonPartialOnly.length > 0) {
          const parentSelectorForOwnSplit = (
            ruleset.parent?.parent && isNode(ruleset.parent.parent, 'Ruleset')
              ? (ruleset.parent.parent as Ruleset).value.selector
              : null
          );
          const nonPartialDiagnostics = nonPartialOnly.map((instruction) => {
            const ownAfterSingle = applyExtendsToSelector(ownSelector, [instruction]);
            const fullAfterSingle = applyExtendsToSelector(selector, [instruction]);
            const ownChangedSingle = ownAfterSingle.valueOf() !== ownSelector.valueOf();
            const fullChangedSingle = fullAfterSingle.valueOf() !== selector.valueOf();
            const parentHasTargetMatch = Boolean(
              parentSelectorForOwnSplit
              && !(parentSelectorForOwnSplit instanceof Nil)
              && findExtendableLocations(
                parentSelectorForOwnSplit as Selector,
                instruction.target
              ).hasMatches
            );
            return {
              instruction,
              ownChangedSingle,
              fullChangedSingle,
              parentHasTargetMatch
            };
          });
          const fullChangedExtendWith = new Set(
            nonPartialDiagnostics
              .filter(d => d.fullChangedSingle)
              .map(d => d.instruction.extendWith.valueOf())
          );
          const nonPartialWithInclusion = nonPartialDiagnostics.map((d) => {
            const includeOwnOnly = (
              d.ownChangedSingle
              && !d.fullChangedSingle
              && !d.parentHasTargetMatch
              && !fullChangedExtendWith.has(d.instruction.extendWith.valueOf())
            );
            return { ...d, includeOwnOnly };
          });
          const nonPartialOwnOnly = nonPartialWithInclusion
            .filter(x => x.includeOwnOnly)
            .map(x => x.instruction);
          const ownAfterPartialAndOwnOnlyNonPartial = applyExtendsToSelector(
            ownSelector,
            [...partialOnly, ...nonPartialOwnOnly]
          );
          const ownAfterPartial = applyExtendsToSelector(ownSelector, partialOnly);
          const ownAfterNonPartial = applyExtendsToSelector(ownSelector, nonPartialOnly);
          const ownAfterAll = applyExtendsToSelector(ownSelector, visibleExtends);
          const fullAfterNonPartial = applyExtendsToSelector(selector, nonPartialOnly);
          const ownChangedByNonPartial = ownAfterNonPartial.valueOf() !== ownSelector.valueOf();
          const fullChangedByNonPartial = fullAfterNonPartial.valueOf() !== selector.valueOf();
          const nonPartialBoundaryOnly = !ownChangedByNonPartial && fullChangedByNonPartial;
          const ownChangedByPartial = ownAfterPartial.valueOf() !== ownSelector.valueOf();
          const hasAncestorDrivenNonPartial = nonPartialWithInclusion.some(d =>
            !d.ownChangedSingle
            && d.fullChangedSingle
            && d.parentHasTargetMatch
          );
          const shouldDeferToParentForNonPartial = Boolean(
            !ownChangedByPartial
            && nonPartialOwnOnly.length === 0
            && hasAncestorDrivenNonPartial
          );
          // When non-partial extends match only the full (cross-product) selector and not
          // the own selector, and partial extends would incorrectly alter the own selector,
          // the non-partial extend takes precedence. Applying partial extends to the own
          // selector here blocks cross-product de-distribution (`:is(parent) :is(own), .rep_ace`).
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
          // For nested rulesets, apply partial (`all`) updates to own selector, but do not
          // fold non-partial changes into own selector. Non-partial changes are handled
          // through full-selector assignment path below when needed.
          if (ownChangedByPartial || nonPartialOwnOnly.length > 0) {
            ruleset.value.selector = ownAfterPartialAndOwnOnlyNonPartial;
            (ruleset.options as { ownSelector?: Selector }).ownSelector = ownAfterPartialAndOwnOnlyNonPartial;
            ruleset.invalidateSelectorValueCache();
            continue;
          }
          if (shouldDeferToParentForNonPartial) {
            // Parent selector already carries the non-partial extend effect.
            // Keep this nested ruleset relative to its own selector to avoid
            // re-materializing parent prefixes inside nested blocks.
            ruleset.value.selector = ownAfterPartial;
            (ruleset.options as { ownSelector?: Selector }).ownSelector = ownAfterPartial;
            ruleset.invalidateSelectorValueCache();
            continue;
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
          ruleset.parent?.parent && isNode(ruleset.parent.parent, 'Ruleset')
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
                if (isNode(n, 'Combinator')) {
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
          && parentRuleset?.hoistToRoot
          && !newSelector.hoistToRoot
        );
        if (parentHoistedBoundaryCompose) {
          const parentSelector = parentRuleset?.value.selector;
          if (parentSelector && !(parentSelector instanceof Nil) && isNode(parentSelector, 'SelectorList')) {
            const parentItems = (parentSelector as SelectorList).value;
            const complexItems = parentItems.filter(item => isNode(item, 'ComplexSelector')) as ComplexSelector[];
            if (complexItems.length === parentItems.length && complexItems.length >= 2) {
              const first = complexItems[0]!;
              const allTri = complexItems.every(c => c.value.length === 3 && isNode(c.value[1], 'Combinator'));
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
                  const ownArg = isNode(ownSelectorNode, 'SelectorList')
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
            && isNode(ruleset.parent.parent, 'Ruleset')
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
        if (hasOnlyPartialExtends && isNode(newSelector, 'SelectorList')) {
          const previousValues = new Set<string>();
          if (isNode(selector, 'SelectorList')) {
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
        ruleset.invalidateSelectorValueCache();
        if (newSelector.hoistToRoot) {
          ruleset.hoistToRoot = true;
        }
      }
    }
  }
}
