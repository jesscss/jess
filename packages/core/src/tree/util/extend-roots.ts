import type { Context } from '../../context.js';
import { WARN, toDiagnostic } from '../../jess-error.js';
import type { AtRule } from '../at-rule.js';
import type { Node } from '../node.js';
import type { Rules } from '../rules.js';
import type { Ruleset } from '../ruleset.js';
import type { Selector } from '../selector.js';
import { CompoundSelector } from '../selector-compound.js';
import { ComplexSelector, type ComplexSelectorComponent } from '../selector-complex.js';
import { SelectorList } from '../selector-list.js';
import { PseudoSelector } from '../selector-pseudo.js';

import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { Nil } from '../nil.js';
import { F_EXTENDED, F_VISIBLE } from '../node.js';
import { selectorMatch } from './selector-match-core.js';
import { tryExtendSelector } from './extend-core.js';
import { getImplicitSelector, localizeSelectorAgainstParent, getParentRuleset, isBareAmpersandOwnSelector } from './selector-utils.js';

/**
 * Extend-root orchestration is intentionally record-driven:
 *
 * 1. During eval, qualifying scopes register themselves as extend roots.
 * 2. Rulesets register directly against the current extend root.
 * 3. Extend processing consumes only recorded roots/rulesets/instructions.
 *
 * This file should not discover roots or child roots by walking the node tree.
 * Extend support must stay close to zero-cost when no extends are present, so
 * all expensive work is deferred until we have both recorded rulesets and
 * recorded extend instructions to apply.
 *
 * @todo Once the extend test matrix is green, do a dedicated performance review
 * of extend-root orchestration. Re-check:
 * - zero-work behavior when no extends are present
 * - repeat-pass behavior and termination characteristics under load
 * - cache invalidation costs
 * - whether any remaining selector rewrites can be deferred to serialization
 */

function invalidateSelectorCache(selector?: Selector | Nil): void {
  if (!selector || isNode(selector, N.Nil)) {
    return;
  }
  selector.invalidateCache();
}

function invalidateRulesetSelectorCaches(ruleset: Ruleset, context?: Context): void {
  ruleset.invalidateSelectorValueCache();
  invalidateSelectorCache(ruleset.get('selector', context));
  invalidateSelectorCache(context ? ruleset.get('_extendedSelector', context) : ruleset.getExtendedSelector());
  invalidateSelectorCache(ruleset.getOwnSelector(context));
  invalidateSelectorCache(context ? ruleset.get('selectorBeforeExtend', context) : ruleset.getSelectorBeforeExtend());
  const rules = ruleset.enterRules(context);
  if (!rules || !isNode(rules, N.Rules)) {
    return;
  }
  for (const child of (rules as Rules).value) {
    if (isNode(child, N.Ruleset)) {
      invalidateRulesetSelectorCaches(child as Ruleset, context);
    }
  }
}

function refreshNestedRulesetSelectors(parentRuleset: Ruleset, context?: Context): void {
  const rules = parentRuleset.enterRules(context);
  if (!rules || !isNode(rules, N.Rules)) {
    return;
  }

  const parentSelector = parentRuleset.getEffectiveSelector(false, context);
  if (!parentSelector || isNode(parentSelector, N.Nil)) {
    return;
  }

  for (const child of (rules as Rules).value) {
    if (!isNode(child, N.Ruleset)) {
      continue;
    }

    const childRuleset = child as Ruleset;
    syncRulesetDerivedSelector(childRuleset, context);
    refreshNestedRulesetSelectors(childRuleset, context);
  }
}

function getDerivedSelectorFromParent(ruleset: Ruleset, context?: Context): Selector | Nil | undefined {
  const ownSelector = ruleset.getOwnSelector(context);
  if (!ownSelector || isNode(ownSelector, N.Nil)) {
    return undefined;
  }

  const parentRuleset = getParentRuleset(ruleset, context);
  const parentSelector = parentRuleset?.getEffectiveSelector(false, context);
  if (!parentSelector || isNode(parentSelector, N.Nil)) {
    return undefined;
  }

  const composedSelector = getImplicitSelector(ownSelector, parentSelector, false);
  const currentSelector = ruleset.get('selector', context);
  if (!isNode(currentSelector, N.Nil) && composedSelector.valueOf() === currentSelector.valueOf()) {
    return undefined;
  }

  return composedSelector;
}

function syncRulesetDerivedSelector(ruleset: Ruleset, context?: Context): void {
  const derivedSelector = getDerivedSelectorFromParent(ruleset, context);
  ruleset.setExtendedSelector(derivedSelector, context);
}

function normalizeGeneratedIsOrder(selector: Selector, insideGeneratedIs = false): Selector {
  if (isNode(selector, N.SelectorList)) {
    return SelectorList.create(
      (selector as SelectorList).get('value').map(item => normalizeGeneratedIsOrder(item as Selector, insideGeneratedIs))
    ).inherit(selector) as Selector;
  }

  if (isNode(selector, N.ComplexSelector)) {
    return ComplexSelector.create(
      (selector as ComplexSelector).get('value').map(part =>
        normalizeGeneratedIsOrder(part as Selector, insideGeneratedIs) as ComplexSelectorComponent
      )
    ).inherit(selector) as Selector;
  }

  if (isNode(selector, N.CompoundSelector)) {
    const normalizedMembers = (selector as CompoundSelector).get('value').map(child =>
      normalizeGeneratedIsOrder(child as Selector, insideGeneratedIs)
    );
    if (!insideGeneratedIs) {
      return CompoundSelector.create(normalizedMembers).inherit(selector) as Selector;
    }
    const generatedIs = normalizedMembers.filter(member =>
      isNode(member, N.PseudoSelector)
      && member.generated
      && member.get('name') === ':is'
    );
    if (generatedIs.length !== 1 || generatedIs[0] === normalizedMembers[0]) {
      return CompoundSelector.create(normalizedMembers).inherit(selector) as Selector;
    }
    const leadingGeneratedIs = generatedIs[0]!;
    const others = normalizedMembers.filter(member => member !== leadingGeneratedIs);
    return CompoundSelector.create([
      leadingGeneratedIs,
      ...others
    ]).inherit(selector) as Selector;
  }

  if (isNode(selector, N.PseudoSelector)) {
    const arg = selector.get('arg');
    if (arg && isNode(arg, N.Selector)) {
      const copy = selector.copy(true) as PseudoSelector;
      const nextArg = normalizeGeneratedIsOrder(
        arg as Selector,
        insideGeneratedIs || (selector.generated && selector.get('name') === ':is')
      );
      copy.adopt(nextArg);
      copy.arg = nextArg;
      return copy as Selector;
    }
  }

  return selector;
}

type ExtendRootRecord = {
  rules: Rules;
  parent?: Rules;
  children: Set<Rules>;
  rulesets: Set<Ruleset>;
  layerName?: string;
  isProtected: boolean;
  isCompose: boolean;
  namespace?: string;
};

export class ExtendRootRegistry {
  private rootRecords = new WeakMap<Rules, ExtendRootRecord>();
  private rootsByLayerName = new Map<string, Set<Rules>>();
  private rootsByNamespace = new Map<string, Set<Rules>>();
  private layerNames = new WeakMap<AtRule, string>();
  private allRoots = new Set<Rules>();
  private visibleRootsCache = new WeakMap<Rules, Set<Rules>>();

  root?: Rules;
  extendRootStack: Rules[] = [];

  private ensureRootRecord(rules: Rules): ExtendRootRecord {
    let record = this.rootRecords.get(rules);
    if (!record) {
      record = {
        rules,
        children: new Set(),
        rulesets: new Set(),
        isProtected: false,
        isCompose: false
      };
      this.rootRecords.set(rules, record);
      this.allRoots.add(rules);
      this.visibleRootsCache = new WeakMap();
    }
    return record;
  }

  getCurrentExtendRoot(): Rules | undefined {
    return this.extendRootStack[this.extendRootStack.length - 1];
  }

  registerRoot(
    rules: Rules,
    parent?: Rules,
    options?: { layerName?: string; isProtected?: boolean; isCompose?: boolean; namespace?: string }
  ): void {
    const record = this.ensureRootRecord(rules);
    if (!this.root) {
      this.root = rules;
    }

    if (parent) {
      const parentRecord = this.ensureRootRecord(parent);
      record.parent = parent;
      parentRecord.children.add(rules);
    }

    if (options?.layerName) {
      record.layerName = options.layerName;
      let layerRoots = this.rootsByLayerName.get(options.layerName);
      if (!layerRoots) {
        layerRoots = new Set<Rules>();
        this.rootsByLayerName.set(options.layerName, layerRoots);
      }
      layerRoots.add(rules);
    }

    if (options?.namespace) {
      record.namespace = options.namespace;
      let nsRoots = this.rootsByNamespace.get(options.namespace);
      if (!nsRoots) {
        nsRoots = new Set<Rules>();
        this.rootsByNamespace.set(options.namespace, nsRoots);
      }
      nsRoots.add(rules);
    }

    if (options?.isProtected) {
      record.isProtected = true;
    }
    if (options?.isCompose) {
      record.isCompose = true;
    }
    this.visibleRootsCache = new WeakMap();
  }

  registerRuleset(root: Rules, ruleset: Ruleset): void {
    if (!root || !ruleset) {
      return;
    }
    this.ensureRootRecord(root).rulesets.add(ruleset);
  }

  getRulesets(root: Rules): ReadonlySet<Ruleset> | undefined {
    return this.rootRecords.get(root)?.rulesets;
  }

  clearRegisteredRulesets(): void {
    for (const root of this.allRoots) {
      this.rootRecords.get(root)?.rulesets.clear();
    }
  }

  getAllRoots(): Set<Rules> {
    return new Set(this.allRoots);
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
    const cached = this.visibleRootsCache.get(root);
    if (cached) {
      return cached;
    }

    const accessible = new Set<Rules>();
    const visited = new Set<Rules>();

    const traverseChildren = (currentRoot: Rules): void => {
      if (visited.has(currentRoot)) {
        return;
      }
      visited.add(currentRoot);
      accessible.add(currentRoot);

      const currentRecord = this.rootRecords.get(currentRoot);
      if (!currentRecord) {
        return;
      }

      if (currentRecord.isProtected) {
        return;
      }

      if (currentRecord.children.size) {
        for (const child of currentRecord.children) {
          if (this.rootRecords.get(child)?.isProtected) {
            continue;
          }
          traverseChildren(child);
        }
      }

      const layer = currentRecord.layerName;
      if (layer) {
        const sameLayerRoots = this.rootsByLayerName.get(layer);
        if (sameLayerRoots) {
          for (const layerRoot of sameLayerRoots) {
            if (layerRoot !== currentRoot && !visited.has(layerRoot) && !this.rootRecords.get(layerRoot)?.isProtected) {
              accessible.add(layerRoot);
              traverseChildren(layerRoot);
            }
          }
        }
      }
    };

    traverseChildren(root);
    this.visibleRootsCache.set(root, accessible);
    return accessible;
  }

  isRootInNamespace(root: Rules, namespace: string): boolean {
    const namespaceRoots = this.rootsByNamespace.get(namespace);
    if (!namespaceRoots?.size) {
      return false;
    }
    for (const namespaceRoot of namespaceRoots) {
      if (this.getAccessibleRoots(namespaceRoot).has(root)) {
        return true;
      }
    }
    return false;
  }

  isSameOrDescendantRoot(rulesetRoot: Rules, extendRoot: Rules): boolean {
    if (rulesetRoot === extendRoot) {
      return true;
    }
    const rulesetRecord = this.rootRecords.get(rulesetRoot);
    if (!rulesetRecord) {
      return false;
    }
    if (rulesetRecord.isProtected) {
      return false;
    }
    const layerA = rulesetRecord.layerName;
    const layerB = this.rootRecords.get(extendRoot)?.layerName;
    if (layerA && layerB && layerA === layerB) {
      return true;
    }
    const extendRecord = this.rootRecords.get(extendRoot);
    if (!extendRecord || extendRecord.children.size === 0) {
      return false;
    }
    for (const child of extendRecord.children) {
      if (this.rootRecords.get(child)?.isProtected) {
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

  isProtectedRoot(rules: Rules): boolean {
    return this.rootRecords.get(rules)?.isProtected === true;
  }
}

function isInstructionVisibleForRoot(
  context: Context,
  rootRules: Rules,
  instruction: {
    extendRoot?: Rules;
    fromReferenceScope: boolean;
    namespace?: string;
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
  if (instruction.namespace) {
    if (instruction.namespace === '*') {
      return true;
    }
    return context.extendRoots.isRootInNamespace(rootRules, instruction.namespace);
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

function isRootWithinInstructionNamespace(
  context: Context,
  rootRules: Rules,
  instruction: {
    namespace?: string;
  }
): boolean {
  if (!instruction.namespace || instruction.namespace === '*') {
    return true;
  }
  return context.extendRoots.isRootInNamespace(rootRules, instruction.namespace);
}

type RecordedExtendInstruction = {
  target: Selector;
  extendWith: Selector;
  partial: boolean;
  extendRoot: Rules;
  extendNode: Node;
  fromReferenceScope: boolean;
  namespace?: string;
};

type TargetInfo = ReturnType<typeof getRulesetExtendTarget>;
type TargetInfoCache = WeakMap<Ruleset, Map<RecordedExtendInstruction, TargetInfo>>;

function getCachedTargetInfo(
  cache: TargetInfoCache | undefined,
  ruleset: Ruleset,
  instruction: RecordedExtendInstruction,
  context?: Context
): TargetInfo {
  if (cache) {
    let perRuleset = cache.get(ruleset);
    if (perRuleset?.has(instruction)) {
      return perRuleset.get(instruction);
    }
    const result = getRulesetExtendTarget(ruleset, instruction.target, instruction.partial, context);
    if (!perRuleset) {
      perRuleset = new Map();
      cache.set(ruleset, perRuleset);
    }
    perRuleset.set(instruction, result);
    return result;
  }
  return getRulesetExtendTarget(ruleset, instruction.target, instruction.partial, context);
}

function invalidateTargetInfoCacheTree(cache: TargetInfoCache, ruleset: Ruleset): void {
  cache.delete(ruleset);
  const rules = ruleset.get('rules');
  if (!rules || !isNode(rules, N.Rules)) {
    return;
  }
  for (const child of (rules as Rules).value) {
    if (isNode(child, N.Ruleset)) {
      invalidateTargetInfoCacheTree(cache, child as Ruleset);
    }
  }
}

function getRulesetInstructionSignature(
  ruleset: Ruleset,
  instruction: RecordedExtendInstruction,
  cache?: TargetInfoCache,
  context?: Context
): string | undefined {
  const targetInfo = getCachedTargetInfo(cache, ruleset, instruction, context);
  if (!targetInfo) {
    return undefined;
  }

  return [
    targetInfo.selector.valueOf(),
    targetInfo.parent?.valueOf() ?? '',
    targetInfo.usingOwnSelector ? 'own' : 'full'
  ].join('\u0000');
}

function isNodeInsideRules(node: Node, rules: Rules): boolean {
  let current: Node | undefined = node;
  while (current) {
    if (current === rules) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function getRulesetExtendTarget(
  ruleset: Ruleset,
  find: Selector,
  partial: boolean,
  context?: Context
): { selector: Selector; parent?: Selector; usingOwnSelector: boolean } | undefined {
  const selector = ruleset.getEffectiveSelector(false, context);
  if (!selector || isNode(selector, N.Nil)) {
    return undefined;
  }

  const ownSelector = ruleset.getOwnSelector(context);
  // Bare `&` rulesets are pure mirrors of their parent selector and are updated
  // by refreshNestedRulesetSelectors when the parent is extended. Skip direct
  // extend processing so selectorBeforeExtend is not incorrectly set on them.
  if (ownSelector && !isNode(ownSelector, N.Nil) && isBareAmpersandOwnSelector(ownSelector)) {
    return undefined;
  }
  const parentRs = getParentRuleset(ruleset, context);
  const parentSelectorBeforeExtend = parentRs
    ? (context ? parentRs.get('selectorBeforeExtend', context) : parentRs.getSelectorBeforeExtend())
    : undefined;
  const activeParentSelector = parentRs?.getEffectiveSelector(false, context);
  const parentSelector = (
    !partial
    && parentSelectorBeforeExtend
    && !isNode(parentSelectorBeforeExtend, N.Nil)
      ? parentSelectorBeforeExtend
      : activeParentSelector
  );
  if (
    ownSelector
    && !isNode(ownSelector, N.Nil)
    && ownSelector.valueOf() !== selector.valueOf()
    && parentSelector
    && !isNode(parentSelector, N.Nil)
  ) {
    const ownMatch = selectorMatch(find, ownSelector, parentSelector, context);
    const shouldUseOwnSelector = partial
      ? (ownMatch.fullMatch || ownMatch.partialMatch)
      : (ownMatch.fullMatch && ownMatch.crossesAmpersand);

    if (shouldUseOwnSelector) {
      return {
        selector: ownSelector,
        parent: parentSelector,
        usingOwnSelector: true
      };
    }

    if (
      !partial
      && activeParentSelector
      && !isNode(activeParentSelector, N.Nil)
      && activeParentSelector.valueOf() !== parentSelector.valueOf()
    ) {
      const activeOwnMatch = selectorMatch(find, ownSelector, activeParentSelector, context);
      if (activeOwnMatch.fullMatch && activeOwnMatch.crossesAmpersand) {
        return {
          selector: ownSelector,
          parent: activeParentSelector,
          usingOwnSelector: true
        };
      }
    }

    // Target doesn't match ownSelector (with parent context). Don't fall
    // through to the full composed selector — any match there would be in
    // the parent-prefix portion, which is handled when the parent ruleset
    // itself is extended + refreshNestedRulesetSelectors propagates changes.
    return undefined;
  }

  return {
    selector,
    usingOwnSelector: false
  };
}

function markExtendedSelector(selector: Selector, context?: Context): void {
  if (context) {
    selector._addFlag(F_EXTENDED, context);
    selector._addFlag(F_VISIBLE, context);
  } else {
    selector.addFlag(F_EXTENDED);
    selector.addFlag(F_VISIBLE);
  }
  if (isNode(selector, N.SelectorList)) {
    for (const item of (selector as SelectorList).get('value')) {
      if (context) {
        (item as Selector)._addFlag(F_EXTENDED, context);
        (item as Selector)._addFlag(F_VISIBLE, context);
      } else {
        (item as Selector).addFlag(F_EXTENDED);
        (item as Selector).addFlag(F_VISIBLE);
      }
    }
  }
}

function activateExtendedRuleset(ruleset: Ruleset, selector: Selector, context?: Context): void {
  const rulesetFlagTarget = isNode(ruleset.sourceNode, N.Ruleset)
    ? ruleset.sourceNode as Ruleset
    : ruleset;
  if (context) {
    rulesetFlagTarget._addFlag(F_EXTENDED, context);
    rulesetFlagTarget._addFlag(F_VISIBLE, context);
  } else {
    rulesetFlagTarget.addFlag(F_EXTENDED);
    rulesetFlagTarget.addFlag(F_VISIBLE);
  }
  markExtendedSelector(selector, context);
}

function clearExtendedRuleset(ruleset: Ruleset, context?: Context): void {
  const rulesetFlagTarget = isNode(ruleset.sourceNode, N.Ruleset)
    ? ruleset.sourceNode as Ruleset
    : ruleset;
  if (context) {
    rulesetFlagTarget._removeFlag(F_EXTENDED, context);
  } else {
    rulesetFlagTarget.removeFlag(F_EXTENDED);
  }
  if (getRulesetHoistToRoot(ruleset, context) !== undefined) {
    setRulesetHoistToRoot(ruleset, undefined, context);
  }
  const selector = ((context ? ruleset.get('_extendedSelector', context) : ruleset.getExtendedSelector()) ?? ruleset.get('selector', context));
  if (selector && !isNode(selector, N.Nil)) {
    if (context) {
      selector._removeFlag(F_EXTENDED, context);
    } else {
      selector.removeFlag(F_EXTENDED);
    }
  }
  syncRulesetDerivedSelector(ruleset, context);
}

function getRulesetHoistToRoot(ruleset: Ruleset, _context?: Context): boolean | undefined {
  return ruleset.hoistToRoot;
}

function setRulesetHoistToRoot(ruleset: Ruleset, value: boolean | undefined, _context?: Context): void {
  ruleset.hoistToRoot = value;
}

function applyInstructionToRuleset(
  ruleset: Ruleset,
  instruction: RecordedExtendInstruction,
  cache?: TargetInfoCache,
  context?: Context
): { matched: boolean; changed: boolean } {
  const targetInfo = getCachedTargetInfo(cache, ruleset, instruction, context);
  if (!targetInfo) {
    return { matched: false, changed: false };
  }

  const targetMatch = selectorMatch(
    instruction.target,
    targetInfo.selector,
    targetInfo.parent,
    context
  );
  if (!targetMatch.partialMatch) {
    return { matched: false, changed: false };
  }

  const currentSelector = ruleset.get('selector', context);
  if (!(context ? ruleset.get('selectorBeforeExtend', context) : ruleset.getSelectorBeforeExtend()) && currentSelector && !isNode(currentSelector, N.Nil)) {
    ruleset.setSelectorBeforeExtend(currentSelector.copy(true) as Selector, context!);
  }

  if (
    isNodeInsideRules(instruction.extendNode, ruleset.enterRules(context))
    && instruction.extendWith.valueOf() === targetInfo.selector.valueOf()
    && targetMatch.fullMatch
  ) {
    activateExtendedRuleset(ruleset, targetInfo.selector, context);
    return { matched: true, changed: false };
  }

  const extendWithVal = instruction.extendWith.valueOf();
  const extendWithAlreadyTopLevel = isNode(targetInfo.selector, N.SelectorList)
    ? ((targetInfo.selector as SelectorList).get('value') as readonly Selector[]).some(item => item.valueOf() === extendWithVal)
    : targetInfo.selector.valueOf() === extendWithVal;
  if (extendWithAlreadyTopLevel) {
    activateExtendedRuleset(ruleset, targetInfo.selector, context);
    return { matched: true, changed: false };
  }

  const before = targetInfo.selector.valueOf();
  const selectorInput = targetInfo.selector.copy(true) as Selector;
  const result = tryExtendSelector(
    selectorInput,
    instruction.target,
    instruction.extendWith,
    instruction.partial,
    targetInfo.parent,
    context
  );
  if (result.error) {
    if (instruction.extendWith.valueOf() === targetInfo.selector.valueOf()) {
      activateExtendedRuleset(ruleset, targetInfo.selector, context);
    }
    return { matched: true, changed: false };
  }

  const normalizedResult = normalizeGeneratedIsOrder(result.value);
  const after = normalizedResult.valueOf();
  activateExtendedRuleset(ruleset, normalizedResult, context);
  if (!result.isChanged || before === after) {
    return { matched: true, changed: false };
  }

  let shouldHoist = (
    normalizedResult.hoistToRoot
    || (
      targetInfo.usingOwnSelector
      && targetMatch.fullMatch
      && targetMatch.crossesAmpersand
      && normalizedResult !== targetInfo.selector
    )
  );

  let nextSelector = normalizedResult;
  if (targetInfo.usingOwnSelector) {
    const nextOwnSelector = targetInfo.parent
      ? localizeSelectorAgainstParent(normalizedResult, targetInfo.parent)
      : normalizedResult;
    ruleset.setOwnSelector(nextOwnSelector, context);

    if (!shouldHoist && targetInfo.parent) {
      nextSelector = getImplicitSelector(nextOwnSelector, targetInfo.parent, false);
    }
  }
  ruleset.setExtendedSelector(nextSelector, context);
  if (shouldHoist) {
    setRulesetHoistToRoot(ruleset, true, context);
    refreshNestedRulesetSelectors(ruleset, context);
  } else if (getRulesetHoistToRoot(ruleset, context) || ruleset.treeContext?.opts?.collapseNesting === true) {
    refreshNestedRulesetSelectors(ruleset, context);
  }
  invalidateRulesetSelectorCaches(ruleset, context);
  return { matched: true, changed: true };
}

function instructionCouldAffectRuleset(
  ruleset: Ruleset,
  instruction: RecordedExtendInstruction,
  cache?: TargetInfoCache,
  context?: Context
): boolean {
  const targetInfo = getCachedTargetInfo(cache, ruleset, instruction, context);
  if (!targetInfo) {
    return false;
  }
  const result = selectorMatch(instruction.target, targetInfo.selector, targetInfo.parent, context);
  return result.fullMatch || result.partialMatch;
}

export function processExtends(context: Context): void {
  try {
    const instructions: RecordedExtendInstruction[] = context.extends.map(([target, selectorWithExtend, partial, extendRoot, extendNode, , fromReferenceScope, namespace]) => ({
      target,
      extendWith: selectorWithExtend,
      partial,
      extendRoot,
      extendNode,
      fromReferenceScope: fromReferenceScope === true,
      namespace
    }));

    if (!instructions.length) {
      return;
    }

    const instructionMatched = new Set<RecordedExtendInstruction>();
    const seenRulesetInstructionStates = new WeakMap<Ruleset, Map<RecordedExtendInstruction, string>>();
    const appliedRulesetInstructions = new WeakMap<Ruleset, Set<RecordedExtendInstruction>>();
    const visibleRootsCache = new Map<Rules, Set<Rules>>();
    const getCachedVisibleRoots = (extendRoot: Rules): Set<Rules> => {
      let cached = visibleRootsCache.get(extendRoot);
      if (!cached) {
        cached = context.extendRoots.getVisibleRoots(extendRoot);
        visibleRootsCache.set(extendRoot, cached);
      }
      return cached;
    };

    let targetInfoCache: TargetInfoCache = new WeakMap();
    let changed = true;
    while (changed) {
      changed = false;

      for (const rootRules of context.extendRoots.getAllRoots()) {
        const rulesetSet = context.extendRoots.getRulesets(rootRules);
        if (!rulesetSet?.size) {
          continue;
        }

        const visibleInstructions = instructions.filter(instruction =>
          isInstructionVisibleForRoot(context, rootRules, instruction, getCachedVisibleRoots)
        );
        if (!visibleInstructions.length) {
          continue;
        }

        for (const ruleset of rulesetSet) {
          let rulesetMatched = false;
          for (const instruction of visibleInstructions) {
            const appliedInstructions = appliedRulesetInstructions.get(ruleset);
            if (appliedInstructions?.has(instruction)) {
              instructionMatched.add(instruction);
              rulesetMatched = true;
              continue;
            }

            const signatureBefore = getRulesetInstructionSignature(ruleset, instruction, targetInfoCache, context);
            const perInstructionStates = seenRulesetInstructionStates.get(ruleset);
            if (
              signatureBefore !== undefined
              && perInstructionStates?.get(instruction) === signatureBefore
            ) {
              instructionMatched.add(instruction);
              rulesetMatched = true;
              continue;
            }

            const outcome = applyInstructionToRuleset(ruleset, instruction, targetInfoCache, context);
            if (outcome.matched) {
              instructionMatched.add(instruction);
              rulesetMatched = true;

              let nextStates = perInstructionStates;
              if (!nextStates) {
                nextStates = new Map<RecordedExtendInstruction, string>();
                seenRulesetInstructionStates.set(ruleset, nextStates);
              }
              nextStates.set(
                instruction,
                getRulesetInstructionSignature(ruleset, instruction, targetInfoCache, context) ?? signatureBefore ?? ''
              );
            }
            if (outcome.changed) {
              invalidateTargetInfoCacheTree(targetInfoCache, ruleset);
              targetInfoCache = new WeakMap();
              let nextAppliedInstructions = appliedInstructions;
              if (!nextAppliedInstructions) {
                nextAppliedInstructions = new Set<RecordedExtendInstruction>();
                appliedRulesetInstructions.set(ruleset, nextAppliedInstructions);
              }
              nextAppliedInstructions.add(instruction);
              changed = true;
            }
          }

          if (!rulesetMatched) {
            clearExtendedRuleset(ruleset, context);
          }
        }
      }
    }

    for (const instruction of instructions) {
      if (instruction.fromReferenceScope || instructionMatched.has(instruction)) {
        continue;
      }

      const target = instruction.target.valueOf();
      const targetLocation = instruction.target.location;
      const targetLine = targetLocation.length >= 2 ? targetLocation[1] : undefined;
      const targetColumn = targetLocation.length >= 3 ? targetLocation[2] : undefined;
      const targetFile = instruction.target.treeContext?.file;
      const targetFilePath = targetFile?.fullPath;

      const blockedProtectedRootExists = Array.from(context.extendRoots.getAllRoots()).some((root) => {
        if (!isRootWithinInstructionNamespace(context, root, instruction)) {
          return false;
        }
        if (isInstructionVisibleForRoot(context, root, instruction, getCachedVisibleRoots)) {
          return false;
        }

        const rulesets = context.extendRoots.getRulesets(root);
        if (!rulesets?.size) {
          return false;
        }

        for (const ruleset of rulesets) {
          if (instructionCouldAffectRuleset(ruleset, instruction, targetInfoCache, context)) {
            return true;
          }
        }
        return false;
      });

      const diagnostic = blockedProtectedRootExists
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
          });
      context.warnings.push(toDiagnostic(diagnostic));
    }
  } finally {
    context.extendRoots.clearRegisteredRulesets();
  }
}
