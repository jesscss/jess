import type { Selector } from '../selector.js';
import type { Context } from '../../context.js';
import { SelectorList } from '../selector-list.js';
import { CompoundSelector } from '../selector-compound.js';
import { ComplexSelector } from '../selector-complex.js';
import type { ComplexSelectorValue } from '../selector-complex.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { Combinator } from '../combinator.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { getImplicitSelector, getParentReplacementForAmpersand, wrapParentSelectorForNestedContext } from './selector-utils.js';
import { selectorMatch } from './selector-match-core.js';
import { Node } from '../node.js';
import { CANONICAL, EVAL, F_AMPERSAND } from '../node-base.js';
import { addParentEdge } from './cursor.js';

/**
 * @todo Once extend correctness is stabilized and the remaining suites are
 * green, do a dedicated performance review of this file. Focus on:
 * - repeated nested `selectorMatch()` calls
 * - unnecessary selector copying or wrapper allocation
 * - opportunities to thread match metadata instead of recomputing it
 */

/**
 * Extend failure categories surfaced to callers while the rewrite remains
 * intentionally incremental.
 */
export type ExtendErrorType =
  'NOT_FOUND'
  | 'ELEMENT_CONFLICT'
  | 'ID_CONFLICT'
  | 'AMPERSAND_BOUNDARY'
  | 'PARTIAL_MATCH';

export const ExtendErrorType = {
  NOT_FOUND: 'NOT_FOUND' as const,
  ELEMENT_CONFLICT: 'ELEMENT_CONFLICT' as const,
  ID_CONFLICT: 'ID_CONFLICT' as const,
  AMPERSAND_BOUNDARY: 'AMPERSAND_BOUNDARY' as const,
  PARTIAL_MATCH: 'PARTIAL_MATCH' as const
} as const;

/**
 * Structured extend failure used instead of throwing during selector rewrites.
 */
export class ExtendError extends Error {
  constructor(
    public type: ExtendErrorType,
    message: string
  ) {
    super(message);
    this.name = 'ExtendError';
  }
}

/**
 * Result of trying to extend a selector.
 *
 * `value` is always returned so callers can keep using the original selector on
 * misses without additional branching.
 */
export interface ExtendResult {
  value: Selector;
  error?: ExtendError;
  isChanged: boolean;
}

/** Creates a successful extend result around the mutated or rewritten selector. */
function createSuccessResult(value: Selector, isChanged = true): ExtendResult {
  return { value, isChanged };
}

/** Creates a failed extend result while preserving the original selector. */
function createErrorResult(value: Selector, type: ExtendErrorType, message: string): ExtendResult {
  return {
    value,
    error: new ExtendError(type, message),
    isChanged: false
  };
}

function expandGeneratedIsAlternatives(selector: Selector): Selector[] {
  if (
    isNode(selector, N.PseudoSelector)
    && selector.generated === true
    && selector.name === ':is'
    && getSelectorListArg(selector)
  ) {
    return [...getSelectorListArg(selector)!.value];
  }

  return [selector];
}

function getDerivedSelectorRenderKey(source: Selector): symbol | number {
  return source.renderKey === CANONICAL ? EVAL : source.renderKey;
}

function finalizeDerivedSelector<T extends Selector>(
  source: Selector,
  nextNode: T,
  reusedChildren: readonly unknown[]
): T {
  const priorParents = reusedChildren.flatMap(child =>
    child instanceof Node ? [[child, child.parent] as const] : []
  );
  nextNode.inherit(source);
  nextNode.renderKey = getDerivedSelectorRenderKey(source);
  for (const [child, priorParent] of priorParents) {
    addParentEdge(child, nextNode.renderKey, nextNode);
    Reflect.set(child, 'parent', priorParent);
  }
  return nextNode;
}

function createDerivedValueContainer(source: SelectorList, value: Selector[]): SelectorList;
function createDerivedValueContainer(source: ComplexSelector, value: ComplexSelectorValue): ComplexSelector;
function createDerivedValueContainer(source: CompoundSelector, value: Selector[]): CompoundSelector;
function createDerivedValueContainer(
  source: SelectorList | ComplexSelector | CompoundSelector,
  value: Selector[] | ComplexSelectorValue
): SelectorList | ComplexSelector | CompoundSelector {
  const nextNode = isNode(source, N.SelectorList)
    ? new SelectorList(value, source.options ? { ...source.options } : undefined, source.location, source.treeContext)
    : isNode(source, N.ComplexSelector)
      ? new ComplexSelector(value, source.options ? { ...source.options } : undefined, source.location, source.treeContext)
      : new CompoundSelector(value, source.options ? { ...source.options } : undefined, source.location, source.treeContext);
  return finalizeDerivedSelector(source, nextNode, value);
}

function cloneComplexSelectorComponent(component: ComplexSelectorValue[number]): ComplexSelectorValue[number] {
  const cloned: ComplexSelectorValue[number] = component instanceof Node
    ? component.copy(true)
    : component;
  return cloned;
}

function createDerivedSelectorListFromSource(
  source: Selector,
  value: Selector[]
): SelectorList {
  const nextNode = new SelectorList(
    value,
    source.options ? { ...source.options } : undefined,
    source.location,
    source.treeContext
  );
  return finalizeDerivedSelector(source, nextNode, value);
}

function createDerivedPseudoWithArg(
  source: PseudoSelector,
  arg: Selector
): PseudoSelector {
  const nextNode = PseudoSelector.create(
    { name: source.name, arg },
    source.options ? { ...source.options } : undefined,
    source.location,
    source.treeContext
  );
  nextNode.generated = source.generated;
  return finalizeDerivedSelector(source, nextNode, [arg]);
}

function getSelectorChildren(target: Selector): readonly Selector[] | undefined {
  if (isNode(target, N.SelectorList | N.CompoundSelector | N.ComplexSelector)) {
    return target.value;
  }
  return undefined;
}

function getSelectorArg(target: Selector): Selector | undefined {
  if (!isNode(target, N.PseudoSelector)) {
    return undefined;
  }
  const arg = target.arg;
  return isNode(arg, N.Selector) ? arg : undefined;
}

function getSelectorListArg(target: Selector): SelectorList | undefined {
  if (!isNode(target, N.PseudoSelector)) {
    return undefined;
  }
  const arg = target.arg;
  return isNode(arg, N.SelectorList) ? arg : undefined;
}

function getCompoundSelector(node: Selector): CompoundSelector | undefined {
  return isNode(node, N.CompoundSelector) ? node : undefined;
}

function getComplexSelector(node: Selector): ComplexSelector | undefined {
  return isNode(node, N.ComplexSelector) ? node : undefined;
}

function getSelectorList(node: Selector): SelectorList | undefined {
  return isNode(node, N.SelectorList) ? node : undefined;
}

function normalizeSelectorListAlternatives(list: readonly Selector[]): Selector[] {
  const flattened: Selector[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    const itemArgList = isNode(item, N.PseudoSelector) ? getSelectorListArg(item) : undefined;
    if (isNode(item, N.PseudoSelector) && item.name === ':is' && itemArgList) {
      for (const child of itemArgList.value) {
        const key = child.valueOf();
        if (!seen.has(key)) {
          seen.add(key);
          flattened.push(child);
        }
      }
      continue;
    }

    const compound = getCompoundSelector(item);
    if (compound && compound.value.length === 1) {
      const only = compound.value[0]!;
      const onlyArgList = isNode(only, N.PseudoSelector) ? getSelectorListArg(only) : undefined;
      if (isNode(only, N.PseudoSelector) && only.name === ':is' && onlyArgList) {
        for (const child of onlyArgList.value) {
          const key = child.valueOf();
          if (!seen.has(key)) {
            seen.add(key);
            flattened.push(child);
          }
        }
        continue;
      }
    }

    const complex = getComplexSelector(item);
    if (complex && complex.value.length === 1) {
      const only = complex.value[0]!;
      const onlyArgList = isNode(only, N.PseudoSelector) ? getSelectorListArg(only) : undefined;
      if (isNode(only, N.PseudoSelector) && only.name === ':is' && onlyArgList) {
        for (const child of onlyArgList.value) {
          const key = child.valueOf();
          if (!seen.has(key)) {
            seen.add(key);
            flattened.push(child);
          }
        }
        continue;
      }
    }

    const key = item.valueOf();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    flattened.push(item);
  }
  return flattened;
}

function canMutateSelectorContainer(target: Selector): boolean {
  return target.renderKey !== CANONICAL || target.sourceNode !== target;
}

function setPseudoArg(target: PseudoSelector, arg: Selector): PseudoSelector {
  if (!canMutateSelectorContainer(target)) {
    return createDerivedPseudoWithArg(target, arg);
  }
  target.adopt(arg);
  target.arg = arg;
  target.invalidateCache();
  return target;
}

function setSelectorContainerValue(
  target: SelectorList | ComplexSelector | CompoundSelector,
  value: Selector[]
): SelectorList | ComplexSelector | CompoundSelector {
  if (!canMutateSelectorContainer(target)) {
    return createDerivedValueContainer(target, value);
  }
  Reflect.set(target, 'value', value);
  for (const item of value) {
    target.adopt(item);
  }
  target.invalidateCache();
  return target;
}

function setSelectorContainerValueAt(
  target: SelectorList | ComplexSelector | CompoundSelector,
  index: number,
  replacement: Selector
): SelectorList | ComplexSelector | CompoundSelector {
  const nextValue = target.value.slice();
  nextValue[index] = replacement;
  return setSelectorContainerValue(target, nextValue);
}

/**
 * Appends a new alternative to an existing alternate container by returning
 * a derived container that reuses unchanged child selectors.
 *
 * This is used for exact matches on selector lists and sole `:is(...)`
 * containers, where the correct extend output is to add another alternative
 * rather than wrap the whole selector again.
 */
function appendAlternative(
  target: Selector,
  extendWith: Selector
): Selector | undefined {
  const next = expandGeneratedIsAlternatives(extendWith);

  if (isNode(target, N.SelectorList)) {
    const normalized = normalizeSelectorListAlternatives(target.value);
    const nextItems = normalizeSelectorListAlternatives([...normalized, ...next]);
    return createDerivedValueContainer(target, nextItems);
  }

  if (isNode(target, N.PseudoSelector) && target.name === ':is' && getSelectorArg(target)) {
    const arg = getSelectorArg(target)!;
    if (getSelectorList(arg)) {
      const normalized = normalizeSelectorListAlternatives(arg.value);
      const nextItems = normalizeSelectorListAlternatives([...normalized, ...next]);
      return createDerivedPseudoWithArg(target, createDerivedValueContainer(arg, nextItems));
    }

    const list = createDerivedSelectorListFromSource(arg, normalizeSelectorListAlternatives([arg, ...next]));
    return createDerivedPseudoWithArg(target, list);
  }

  return undefined;
}

/**
 * Produces the exact-extend output for one fully matched selector.
 *
 * When the matched selector already is an alternate container, the new
 * selector is appended in place. Otherwise a selector list is created around
 * the matched selector and the extension alternative.
 *
 * This is the preferred output for any selector that has an exact full match
 * route, including full-match results discovered while running in partial
 * mode. A generated
 * `:is(...)` wrapper should only be introduced when the rewrite genuinely has
 * to preserve unmatched siblings around a partial match.
 */
function createAlternativeSelector(
  target: Selector,
  extendWith: Selector
): Selector {
  if (target.valueOf() === extendWith.valueOf()) {
    return target;
  }
  const appended = appendAlternative(target, extendWith);
  if (appended) {
    return appended;
  }

  return createDerivedSelectorListFromSource(target, [target, ...expandGeneratedIsAlternatives(extendWith)]);
}

/**
 * Wraps one matched selector fragment in a generated `:is(original, extendWith)`
 * pseudo so partial extends can preserve unmatched siblings around it.
 *
 * When `selector` and `extendWith` are identical (e.g. `.class:extend(.class all)`),
 * no wrapper is needed — the fragment is marked visible in place and returned as-is.
 */
function wrapSelectorInIs(selector: Selector, extendWith: Selector): Selector {
  // Flatten: if selector is already a generated :is(SelectorList), extract its items
  // instead of nesting :is(:is(...), extension).
  const selectorItems = expandGeneratedIsAlternatives(selector);
  const extendItems = expandGeneratedIsAlternatives(extendWith);
  const allItems = normalizeSelectorListAlternatives([...selectorItems, ...extendItems]);

  if (allItems.length === 1) {
    return selector;
  }

  const arg = SelectorList.create(allItems).inherit(selector);
  arg.pre = undefined;
  arg.post = undefined;

  const wrapper = PseudoSelector.create({
    name: ':is',
    arg
  });
  wrapper.generated = true;
  const inherited = wrapper.inherit(selector);
  inherited.pre = undefined;
  inherited.post = undefined;
  return inherited;
}

/** Wraps a selector in a generated `:is(...)` without adding another alternate. */
function wrapSelectorAsGeneratedIs(selector: Selector): Selector {
  const wrapper = PseudoSelector.create({
    name: ':is',
    arg: selector
  });
  wrapper.generated = true;
  return wrapper.inherit(selector);
}

type CompoundConflictInfo = {
  elements: Set<string>;
  ids: Set<string>;
};

function createCompoundConflictInfo(): CompoundConflictInfo {
  return {
    elements: new Set<string>(),
    ids: new Set<string>()
  };
}

/**
 * Collects the element and id selectors that can participate in one merged
 * compound position.
 *
 * This mirrors extend's validity rule, not selector serialization. Complex
 * selectors only contribute their terminal position because that is the part
 * that can merge with the surrounding compound. Selector lists and `:is(...)`
 * contribute the union of their alternatives.
 */
function collectCompoundConflictInfo(
  selector: Selector,
  info: CompoundConflictInfo = createCompoundConflictInfo()
): CompoundConflictInfo {
  if (isNode(selector, N.BasicSelector)) {
    if (selector.isTag) {
      info.elements.add(selector.valueOf());
    } else if (selector.isId) {
      info.ids.add(selector.valueOf());
    }
    return info;
  }

  if (isNode(selector, N.CompoundSelector | N.SelectorList)) {
    for (const child of selector.value) {
      collectCompoundConflictInfo(child, info);
    }
    return info;
  }

  if (isNode(selector, N.ComplexSelector)) {
    const complexData = selector.value;
    for (let i = complexData.length - 1; i >= 0; i--) {
      const child = complexData[i]!;
      if (isNode(child, N.Combinator)) {
        continue;
      }
      collectCompoundConflictInfo(child, info);
      break;
    }
    return info;
  }

  if (isNode(selector, N.PseudoSelector) && getSelectorArg(selector) && selector.name === ':is') {
    collectCompoundConflictInfo(getSelectorArg(selector)!, info);
  }

  return info;
}

/**
 * Validates that inserting `extendWith` into the remaining members of one
 * compound position would not create an impossible selector such as
 * `span:is(div, .foo)` or `#first:is(#second, .foo)`.
 */
function getCompoundConflictError(
  surroundingMembers: readonly Selector[],
  extendWith: Selector
): ExtendError | undefined {
  const surrounding = createCompoundConflictInfo();
  for (const member of surroundingMembers) {
    collectCompoundConflictInfo(member, surrounding);
  }

  const extension = collectCompoundConflictInfo(extendWith);
  const surroundingElement = surrounding.elements.size > 0 ? [...surrounding.elements][0]! : undefined;
  const conflictingElement = [...extension.elements].find(element => surroundingElement && element !== surroundingElement);
  if (conflictingElement) {
    return new ExtendError(ExtendErrorType.ELEMENT_CONFLICT, 'Extend would introduce a conflicting element selector');
  }

  const surroundingId = surrounding.ids.size > 0 ? [...surrounding.ids][0]! : undefined;
  const conflictingId = [...extension.ids].find(id => surroundingId && id !== surroundingId);
  if (conflictingId) {
    return new ExtendError(ExtendErrorType.ID_CONFLICT, 'Extend would introduce a conflicting id selector');
  }

  return undefined;
}

/**
 * Removes element and id selectors from `selector` when they are already
 * supplied by the surrounding compound context outside the generated `:is(...)`
 * wrapper.
 *
 * This keeps rewrites like `div:is(.a, div.b)` normalized to `div:is(.a, .b)`
 * and `#foo:is(.class, #foo.other)` normalized to `#foo:is(.class, .other)`.
 */
function stripRedundantCompoundContext(
  selector: Selector,
  surroundingMembers: readonly Selector[]
): Selector {
  const surrounding = createCompoundConflictInfo();
  for (const member of surroundingMembers) {
    collectCompoundConflictInfo(member, surrounding);
  }

  const normalize = (node: Selector): Selector | undefined => {
    if (isNode(node, N.BasicSelector)) {
      if (node.isTag && surrounding.elements.has(node.valueOf())) {
        return undefined;
      }
      if (node.isId && surrounding.ids.has(node.valueOf())) {
        return undefined;
      }
      return node;
    }

    const compound = getCompoundSelector(node);
    if (compound) {
      const next = compound.value
        .map(child => normalize(child))
        .filter((child): child is Selector => !!child);
      if (next.length === 0) {
        return undefined;
      }
      if (next.length === 1) {
        return next[0]!;
      }
      return CompoundSelector.create(next).inherit(node);
    }

    const list = getSelectorList(node);
    if (list) {
      const next = list.value
        .map(child => normalize(child))
        .filter((child): child is Selector => !!child);
      if (next.length === 0) {
        return node;
      }
      if (next.length === 1) {
        return next[0]!;
      }
      return SelectorList.create(next).inherit(node);
    }

    if (isNode(node, N.PseudoSelector) && node.name === ':is' && getSelectorArg(node)) {
      const nextArg = normalize(getSelectorArg(node)!);
      if (!nextArg) {
        return undefined;
      }
      const copy = node.copy(true);
      return setPseudoArg(copy, nextArg);
    }

    return node;
  };

  return normalize(selector) ?? selector;
}

/**
 * Rewrites a compound-local partial match by replacing only the consumed
 * members with a generated `:is(...)` wrapper and leaving the unmatched
 * remainder in place.
 */
function wrapCompoundMatchRange(
  targetCompound: CompoundSelector,
  startIndex: number,
  endIndex: number,
  matchedIndices: number[] | undefined,
  extendWith: Selector
): Selector {
  const effectiveMatchedIndices = matchedIndices && matchedIndices.length > 0
    ? matchedIndices
    : Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => startIndex + offset);
  const outsideMembers = getCompoundMembersOutsideRange(targetCompound, startIndex, endIndex, matchedIndices);
  const matched = effectiveMatchedIndices.map(index => targetCompound.value[index]!);
  const matchedSingle = matched.length === 1 ? matched[0]! : undefined;
  const wrapped = wrapSelectorInIs(
    matchedSingle ?? CompoundSelector.create(matched).inherit(targetCompound),
    stripRedundantCompoundContext(extendWith, outsideMembers)
  );
  if (matchedSingle && wrapped === matchedSingle) {
    return targetCompound;
  }
  const nextData: Selector[] = [];
  const matchedIndexSet = new Set(effectiveMatchedIndices);

  for (let i = 0; i < targetCompound.value.length; i++) {
    const node = targetCompound.value[i]!;
    if (i === effectiveMatchedIndices[0]) {
      nextData.push(wrapped);
      continue;
    }
    if (matchedIndexSet.has(i)) {
      continue;
    }
    nextData.push(node);
  }

  if (nextData.length === 1) {
    return nextData[0]!;
  }

  return ComplexSelector.create(nextData).inherit(targetCompound);
}

function getCompoundMembersOutsideRange(
  compoundSelector: CompoundSelector,
  startIndex: number,
  endIndex: number,
  matchedIndices: number[] | undefined
): Selector[] {
  const effectiveMatchedIndices = matchedIndices && matchedIndices.length > 0
    ? matchedIndices
    : Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => startIndex + offset);
  const matchedIndexSet = new Set(effectiveMatchedIndices);

  return compoundSelector.value.filter((_, index) => !matchedIndexSet.has(index));
}

function wrapOrderedMatchRange(
  targetSelector: ComplexSelector,
  startIndex: number,
  endIndex: number,
  extendWith: Selector
): Selector {
  const matched = targetSelector.value.slice(startIndex, endIndex + 1);
  const wrapped = wrapSelectorInIs(
    matched.length === 1
      ? matched[0]!
      : ComplexSelector.create(matched).inherit(targetSelector),
    extendWith
  );
  const nextData: Selector[] = [];

  for (let i = 0; i < targetSelector.value.length; i++) {
    const node = targetSelector.value[i]!;
    if (i === startIndex) {
      nextData.push(wrapped);
      continue;
    }
    if (i > startIndex && i <= endIndex) {
      continue;
    }
    nextData.push(node);
  }

  if (nextData.length === 1) {
    return nextData[0]!;
  }

  return ComplexSelector.create(nextData).inherit(targetSelector);
}

/**
 * Replaces one direct child selector inside its parent container.
 *
 * This keeps mutation localized to the owning parent so downstream caches and
 * parent links stay consistent with the node model.
 */
function replaceDirectSelectorChild(
  parent: Selector,
  child: Selector,
  replacement: Selector
): Selector | undefined {
  const parentChildren = getSelectorChildren(parent);

  if (
    isNode(parent, N.PseudoSelector)
    && (
      parent.arg === child
      || (
        getSelectorArg(parent) !== undefined
        && getSelectorArg(parent)!.type === child.type
        && getSelectorArg(parent)!.valueOf() === child.valueOf()
      )
    )
  ) {
    return setPseudoArg(parent, replacement);
  }

  if (parentChildren) {
    const index = parentChildren.findIndex(node => node === child);
    const fallbackIndex = index !== -1
      ? index
      : parentChildren.findIndex(node => node.type === child.type && node.valueOf() === child.valueOf());
    if (fallbackIndex !== -1 && isNode(parent, N.SelectorList | N.ComplexSelector | N.CompoundSelector)) {
      return setSelectorContainerValueAt(parent, fallbackIndex, replacement);
    }
  }

  return undefined;
}

function getStructurallyMatchingDirectChildSelector(
  target: Selector,
  node: Selector
): Selector | undefined {
  const arg = getSelectorArg(target);
  if (isNode(target, N.PseudoSelector) && arg) {
    if (arg.type === node.type && arg.valueOf() === node.valueOf()) {
      return arg;
    }
    return undefined;
  }

  const children = getSelectorChildren(target);
  if (!children) {
    return undefined;
  }

  return children.find(child => child.type === node.type && child.valueOf() === node.valueOf());
}

/**
 * Resolves authored ampersands in a root complex selector against the provided
 * parent without mutating the original target selector.
 *
 * This is currently used only for full-span crossed matches on the root target
 * route.
 */
function resolveAmpersandTarget(
  target: ComplexSelector,
  parent?: Selector
): Selector | undefined {
  const nextData: ComplexSelectorValue = [];
  let replacedAny = false;

  for (let i = 0; i < target.value.length; i++) {
    const component = target.value[i]!;
    if (isNode(component, N.Ampersand)) {
      const resolvedRaw = component.getResolvedSelector() ?? parent;
      if (!resolvedRaw || isNode(resolvedRaw, N.Nil)) {
        nextData.push(cloneComplexSelectorComponent(component));
        continue;
      }
      nextData.push(...getParentReplacementForAmpersand(resolvedRaw, i === 0));
      replacedAny = true;
      continue;
    }
    nextData.push(cloneComplexSelectorComponent(component));
  }

  if (!replacedAny) {
    return undefined;
  }

  return ComplexSelector.create(nextData).inherit(target);
}

/**
 * Materializes the original matched target side when an extend crossed a parent
 * boundary.
 *
 * Explicit authored ampersands resolve through their own replacement logic.
 * Plain nested selectors with an implicit parent boundary are composed against
 * `parent` on demand so the resulting selector is self-contained once hoisted
 * or appended as an exact alternative.
 */
function materializeCrossedTarget(
  target: Selector,
  parent: Selector | undefined
): Selector | undefined {
  const resolvedAmpersands = isNode(target, N.ComplexSelector)
    ? resolveAmpersandTarget(target, parent)
    : undefined;
  if (resolvedAmpersands) {
    return resolvedAmpersands;
  }

  if (!parent) {
    return undefined;
  }

  // When both are SelectorLists, produce :is(parent) :is(inner) to avoid
  // duplicating the parent prefix across every alternative.
  if (isNode(target, N.SelectorList) && isNode(parent, N.SelectorList)) {
    const parentFragment = wrapParentSelectorForNestedContext(parent, false);
    const innerIs = PseudoSelector.create({ name: ':is', arg: target.copy(true) });
    innerIs.generated = true;
    return ComplexSelector.create([parentFragment, Combinator.create(' '), innerIs]).inherit(target);
  }

  return getImplicitSelector(target, parent, false);
}

/**
 * Materializes authored ampersands throughout a hoisted selector so the
 * returned selector no longer depends on external parent context.
 *
 * Once a rewrite hoists to root, every remaining `&` in the returned selector
 * must be replaced with its parent selector using the same wrapping rules as
 * ordinary ampersand replacement.
 */
function materializeAmpersandsForHoist(
  selector: Selector,
  parent: Selector
): Selector {
  if (isNode(selector, N.Ampersand)) {
    const resolved = selector.getResolvedSelector() ?? parent;
    const resolvedCopy = resolved.copy(true);
    return materializeAmpersandsForHoist(resolvedCopy, parent);
  }

  const selectorList = getSelectorList(selector);
  if (selectorList) {
    const next = selectorList.value.map(child =>
      materializeAmpersandsForHoist(child.copy(true), parent)
    );
    const rebuilt = SelectorList.create(next).inherit(selector);
    rebuilt.hoistToRoot = selector.hoistToRoot;
    return rebuilt;
  }

  const complex = getComplexSelector(selector);
  if (complex) {
    const nextData: Selector[] = [];

    for (let i = 0; i < complex.value.length; i++) {
      const child = complex.value[i]!;
      if (isNode(child, N.Ampersand)) {
        const resolved = child.getResolvedSelector() ?? parent;
        const replacement = materializeAmpersandsForHoist(resolved.copy(true), parent);
        nextData.push(...getParentReplacementForAmpersand(replacement, i === 0));
        continue;
      }

      nextData.push(materializeAmpersandsForHoist(child.copy(true), parent));
    }

    const rebuilt = ComplexSelector.create(nextData).inherit(selector);
    rebuilt.hoistToRoot = selector.hoistToRoot;
    return rebuilt;
  }

  const compound = getCompoundSelector(selector);
  if (compound) {
    const nextData: Selector[] = [];

    for (const selectorChild of compound.value) {
      if (isNode(selectorChild, N.Ampersand)) {
        const resolved = materializeAmpersandsForHoist((selectorChild.getResolvedSelector() ?? parent)!.copy(true), parent);
        if (isNode(resolved, N.CompoundSelector)) {
          nextData.push(...resolved.value);
        } else if (isNode(resolved, N.ComplexSelector | N.SelectorList)) {
          nextData.push(wrapSelectorAsGeneratedIs(resolved));
        } else {
          nextData.push(resolved);
        }
        continue;
      }

      nextData.push(materializeAmpersandsForHoist(selectorChild.copy(true), parent));
    }

    if (nextData.length === 1) {
      const only = nextData[0]!;
      only.hoistToRoot = selector.hoistToRoot;
      return only;
    }

    const rebuilt = CompoundSelector.create(nextData).inherit(selector);
    rebuilt.hoistToRoot = selector.hoistToRoot;
    return rebuilt;
  }

  if (isNode(selector, N.PseudoSelector) && isNode(selector.arg, N.Selector)) {
    const copy = selector.copy(true);
    const nextCopy = setPseudoArg(copy, materializeAmpersandsForHoist(getSelectorArg(selector)!, parent));
    nextCopy.hoistToRoot = selector.hoistToRoot;
    return nextCopy;
  }

  const copy = selector.copy(true);
  copy.hoistToRoot = selector.hoistToRoot;
  return copy;
}

function getCrossedAmpersandParent(location: ReturnType<typeof selectorMatch>['matches'][number]): Selector | undefined {
  const crossing = location.ampersandCrossings?.find(crossing => crossing.parentSegment && isNode(crossing.parentSegment.containingNode, N.Selector));
  return crossing?.parentSegment?.containingNode;
}

/**
 * Rewrites a root compound span that crossed an ampersand by resolving the
 * matched span against the parent seam and leaving unmatched compound members
 * outside the generated `:is(...)`.
 */
function wrapResolvedCompoundSpan(
  targetCompound: CompoundSelector,
  startIndex: number,
  endIndex: number,
  extendWith: Selector,
  resolvedParent: Selector
): Selector {
  const matchedMembers = targetCompound.value.slice(startIndex, endIndex + 1);
  const matchedSelector = matchedMembers.length === 1
    ? matchedMembers[0]!
    : CompoundSelector.create(matchedMembers).inherit(targetCompound);
  const outsideMembers = targetCompound.value.filter((_: Selector, index: number) => index < startIndex || index > endIndex);
  const wrapped = wrapSelectorInIs(
    materializeAmpersandsForHoist(matchedSelector, resolvedParent),
    stripRedundantCompoundContext(extendWith, outsideMembers)
  );
  const nextData: Selector[] = [];

  for (let i = 0; i < targetCompound.value.length; i++) {
    if (i === startIndex) {
      nextData.push(wrapped);
      continue;
    }
    if (i > startIndex && i <= endIndex) {
      continue;
    }
    nextData.push(targetCompound.value[i]!);
  }

  if (nextData.length === 1) {
    return nextData[0]!;
  }

  return ComplexSelector.create(nextData).inherit(targetCompound);
}

function getLastOrderedSelector(selector: Selector): Selector {
  const complex = getComplexSelector(selector);
  if (complex) {
    for (let i = complex.value.length - 1; i >= 0; i--) {
      const child = complex.value[i]!;
      if (!isNode(child, N.Combinator)) {
        return child;
      }
    }
  }

  return selector;
}

function buildMatchedCompoundSelector(
  targetCompound: CompoundSelector,
  startIndex: number,
  endIndex: number,
  matchedIndices?: number[]
): Selector {
  const effectiveMatchedIndices = matchedIndices && matchedIndices.length > 0
    ? matchedIndices
    : Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => startIndex + offset);
  const matched = effectiveMatchedIndices.map(index => targetCompound.value[index]!);

  if (matched.length === 1) {
    return matched[0]!;
  }

  return CompoundSelector.create(matched).inherit(targetCompound);
}

/**
 * Rewrites a crossed ordered span whose terminal position is a compound with
 * unmatched tail members that must stay outside the generated `:is(...)`.
 *
 * When the terminal compound crossed an ampersand seam, the matched portion is
 * the full crossed target segment, not just the visible `matchedIndices`.
 * Otherwise the authored `&` would leak into the remainder instead of staying
 * attached to the matched fragment it helped complete.
 */
function wrapResolvedOrderedSpanWithTailRemainder(
  targetSelector: ComplexSelector,
  startIndex: number,
  endIndex: number,
  extendWith: Selector,
  resolvedParent: Selector,
  terminalFind: Selector,
  location?: ReturnType<typeof selectorMatch>['matches'][number],
  context?: Context
): Selector | undefined {
  const tail = targetSelector.value[endIndex]!;
  if (!isNode(tail, N.CompoundSelector)) {
    return undefined;
  }

  const tailMatch = selectorMatch(terminalFind, tail, resolvedParent, context);
  const tailLocation = tailMatch.matches.find(match => match.containingNode === tail);
  if (!tailLocation || tailLocation.startIndex === undefined || tailLocation.endIndex === undefined) {
    return undefined;
  }
  const crossedTailSegment = location?.ampersandCrossings?.find(crossing =>
    crossing.targetSegment.containingNode === tail
  )?.targetSegment ?? tailLocation.ampersandCrossings?.find(crossing =>
    crossing.targetSegment.containingNode === tail
  )?.targetSegment;
  const tailStartIndex = crossedTailSegment?.startIndex ?? tailLocation.startIndex;
  const tailEndIndex = crossedTailSegment?.endIndex ?? tailLocation.endIndex;
  const tailMatchedIndices = crossedTailSegment?.matchedIndices ?? tailLocation.matchedIndices;
  const effectiveTailMatchedIndices = crossedTailSegment ? undefined : tailMatchedIndices;

  const matchedPrefix: Selector[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    matchedPrefix.push(materializeAmpersandsForHoist(targetSelector.value[i]!.copy(true), resolvedParent));
  }

  const matchedTailSelector = buildMatchedCompoundSelector(
    tail,
    tailStartIndex,
    tailEndIndex,
    effectiveTailMatchedIndices
  );
  matchedPrefix.push(crossedTailSegment
    ? materializeAmpersandsForHoist(matchedTailSelector, resolvedParent)
    : matchedTailSelector);

  const orderedMatchedSelector = matchedPrefix.length === 1
    ? matchedPrefix[0]!
    : ComplexSelector.create(matchedPrefix).inherit(targetSelector);
  const wrapped = wrapSelectorInIs(orderedMatchedSelector, extendWith);
  const tailRemainder = getCompoundMembersOutsideRange(
    tail,
    tailStartIndex,
    tailEndIndex,
    effectiveTailMatchedIndices
  );
  const inserted = tailRemainder.length > 0
    ? CompoundSelector.create([wrapped, ...tailRemainder]).inherit(tail)
    : wrapped;

  const nextData: Selector[] = [];
  for (let i = 0; i < targetSelector.value.length; i++) {
    if (i === startIndex) {
      nextData.push(inserted);
      continue;
    }
    if (i > startIndex && i <= endIndex) {
      continue;
    }
    nextData.push(targetSelector.value[i]!);
  }

  if (nextData.length === 1) {
    return nextData[0]!;
  }

  return ComplexSelector.create(nextData).inherit(targetSelector);
}

/**
 * Rewrites one direct child selector of `target` by delegating to
 * `tryExtendSelector()` on that child and then replacing it through the parent
 * container.
 *
 * This is a structural rewrite step on an already-selected subtree. When that
 * child still belongs to the same authored selector route, the same `parent`
 * context is forwarded so authored ampersands inside the child keep the same
 * resolution context the outer target matched with.
 *
 * The fallback `selectorMatch()` call is only used to recover crossed-seam
 * hoist information for exact child rewrites that do not otherwise surface it
 * on the rewritten child node itself.
 */
function tryExtendDirectChildSelector(
  target: Selector,
  child: Selector | undefined,
  find: Selector,
  extendWith: Selector,
  parent?: Selector,
  crossedAmpersandHint = false,
  context?: Context
): ExtendResult | undefined {
  if (!child) {
    return undefined;
  }

  const nested = tryExtendSelector(child, find, extendWith, true, parent, context);
  if (nested.error) {
    return undefined;
  }

  const nextTarget = replaceDirectSelectorChild(target, child, nested.value);
  if (!nextTarget) {
    return undefined;
  }

  if (nested.value.hoistToRoot || crossedAmpersandHint) {
    nextTarget.hoistToRoot = true;
  } else if (parent && child.hasFlag(F_AMPERSAND)) {
    const childMatch = selectorMatch(find, child, parent, context);
    if (childMatch.fullMatch && childMatch.crossesAmpersand) {
      nextTarget.hoistToRoot = true;
    }
  }
  return createSuccessResult(nextTarget, nested.isChanged);
}

/**
 * Finds the direct child selector of `target` that structurally owns `node`.
 *
 * This lets partial rewrites recurse into the nearest direct child selector
 * even when the selected match location lives several wrapper levels below it.
 */
function getContainingDirectChildSelector(
  target: Selector,
  node: Node
): Selector | undefined {
  if (!isNode(target, N.SelectorList | N.CompoundSelector | N.ComplexSelector)) {
    return undefined;
  }

  let current: Node | undefined = node;
  while (current && current.parent && current.parent !== target) {
    current = current.parent;
  }

  if (current && current.parent === target && isNode(current, N.Selector)) {
    return current;
  }

  return undefined;
}

/**
 * Returns the single direct child selector selected by one exact location on
 * an ordered or alternate container, when that location maps to exactly one
 * child slot of the current target.
 */
function getSingleMatchedDirectChild(
  target: Selector,
  location: ReturnType<typeof selectorMatch>['matches'][number]
): Selector | undefined {
  if (
    !isNode(target, N.SelectorList | N.CompoundSelector | N.ComplexSelector)
    || location.containingNode !== target
    || location.startIndex === undefined
    || location.startIndex !== location.endIndex
  ) {
    return undefined;
  }

  const children = getSelectorChildren(target);
  return children ? children[location.startIndex] : undefined;
}

/** Returns the direct selector-valued arg on a pseudo selector, if any. */
function getDirectPseudoArg(
  target: Selector
): Selector | undefined {
  return isNode(target, N.PseudoSelector) && getSelectorArg(target)
    ? getSelectorArg(target)
    : undefined;
}

/** Returns the direct selector-valued arg on a `:is(...)` pseudo, if any. */
function getDirectIsArg(
  target: Selector
): Selector | undefined {
  return isNode(target, N.PseudoSelector) && target.name === ':is' && getSelectorArg(target)
    ? getSelectorArg(target)
    : undefined;
}

/** Returns the directly rewriteable selector-list container on `target`, if any. */
function getDirectSelectorList(
  target: Selector
): Selector | undefined {
  return getSelectorList(target) ?? getSelectorListArg(target);
}

/**
 * Appends to the direct selector-list container that already owns the matched
 * selector, preserving surrounding wrapper shape.
 */
function tryAppendToContainingSelectorList(
  target: Selector,
  containingNode: Selector,
  extendWith: Selector
): ExtendResult | undefined {
  const list = getDirectSelectorList(target);
  if (!list) {
    return undefined;
  }
  if (containingNode.parent !== list) {
    return undefined;
  }

  const replacement = appendAlternative(list, extendWith);
  if (!replacement) {
    return undefined;
  }
  if (list === target) {
    return createSuccessResult(replacement);
  }
  const nextTarget = replaceDirectSelectorChild(target, list, replacement);
  if (!nextTarget) {
    return undefined;
  }
  return createSuccessResult(nextTarget);
}

/**
 * Appends at the end of the direct selector-list container when `find`
 * fully matches that container under the same parent context.
 */
function tryAppendToDirectSelectorListOnFullMatch(
  target: Selector,
  find: Selector,
  extendWith: Selector,
  parent?: Selector,
  context?: Context
): ExtendResult | undefined {
  const list = getDirectSelectorList(target);
  if (!list) {
    return undefined;
  }
  const innerMatch = selectorMatch(find, list, parent, context);
  if (!innerMatch.fullMatch) {
    return undefined;
  }

  const replacement = appendAlternative(list, extendWith);
  if (!replacement) {
    return undefined;
  }
  if (list === target) {
    if (innerMatch.crossesAmpersand) {
      replacement.hoistToRoot = true;
    }
    return createSuccessResult(replacement);
  }
  const nextTarget = replaceDirectSelectorChild(target, list, replacement);
  if (!nextTarget) {
    return undefined;
  }
  if (innerMatch.crossesAmpersand) {
    nextTarget.hoistToRoot = true;
  }
  return createSuccessResult(nextTarget);
}

function getLastOrderedSelectorIndex(selector: ComplexSelector): number {
  for (let i = selector.value.length - 1; i >= 0; i--) {
    if (!isNode(selector.value[i], N.Combinator)) {
      return i;
    }
  }
  return -1;
}

function mergeCompoundMembersIntoSelector(
  members: readonly Selector[],
  selector: Selector
): Selector {
  const merged: Selector[] = [...members];
  const compound = getCompoundSelector(selector);
  if (compound) {
    merged.push(...compound.value);
  } else {
    merged.push(selector);
  }
  if (merged.length === 1) {
    return merged[0]!;
  }
  return CompoundSelector.create(merged).inherit(selector);
}

/**
 * Appends `extendWith` into a nested `:is(...)` when `find` already fully
 * matches a selector that belongs to the same rewritten component.
 *
 * The important distinction here is component identity, not the mere presence
 * of `:is(...)`: when the full match stays attached to the same selector
 * component, the rewrite should append into that component's alternate
 * container instead of widening the outer selector shape. Parent-aware crossed
 * full matches hoist the owning target so the returned selector is later
 * materialized against that parent context.
 */
function tryAppendIntoNestedIsOnFullMatch(
  target: Selector,
  find: Selector,
  extendWith: Selector,
  parent?: Selector,
  context?: Context
): ExtendResult | undefined {
  if (!isNode(target, N.CompoundSelector | N.ComplexSelector)) {
    return undefined;
  }

  const targetData = getSelectorChildren(target);
  if (!targetData) {
    return undefined;
  }
  for (let i = 0; i < targetData.length; i++) {
    const child = targetData[i];
    const childArg = getSelectorArg(child);
    if (!(isNode(child, N.PseudoSelector) && child.name === ':is' && childArg)) {
      continue;
    }
    const innerMatch = selectorMatch(find, childArg, parent, context);
    if (!innerMatch.fullMatch) {
      continue;
    }
    const replacement = appendAlternative(child, extendWith);
    if (!replacement) {
      continue;
    }
    const nextTarget = replaceDirectSelectorChild(target, child, replacement);
    if (!nextTarget) {
      continue;
    }
    if (innerMatch.crossesAmpersand) {
      nextTarget.hoistToRoot = true;
    }
    return createSuccessResult(nextTarget);
  }

  return undefined;
}

/**
 * Pulls matched compound members into the terminal selector of a nested
 * complex branch when those members all refer to the same selector component.
 *
 * This is the case where outer compound members and the branch terminal are
 * interchangeable because they all describe the same element/component. In
 * that situation the rewrite should stay attached to that component rather
 * than widen across the entire outer compound span.
 */
function tryPullCompoundMatchIntoNestedIsBranch(
  target: CompoundSelector,
  location: ReturnType<typeof selectorMatch>['matches'][number],
  find: Selector,
  extendWith: Selector,
  context?: Context
): ExtendResult | undefined {
  if (!(location.startIndex !== undefined && location.endIndex !== undefined)) {
    return undefined;
  }

  const targetValues = target.value;
  const pseudoIndex = targetValues.findIndex((node, index) =>
    index >= location.startIndex!
    && index <= location.endIndex!
    && isNode(node, N.PseudoSelector)
    && node.name === ':is'
    && getSelectorArg(node)
  );
  if (pseudoIndex === -1) {
    return undefined;
  }

  const pseudoNode = targetValues[pseudoIndex];
  if (!isNode(pseudoNode, N.PseudoSelector)) {
    return undefined;
  }
  const pulledMembers = targetValues.filter((node, index) =>
    index >= location.startIndex!
    && index <= location.endIndex!
    && index !== pseudoIndex
  );
  if (pulledMembers.length === 0) {
    return undefined;
  }

  const arg = getSelectorArg(pseudoNode) ?? pseudoNode.arg;
  if (!isNode(arg, N.Selector)) {
    return undefined;
  }
  const alternatives = isNode(arg, N.SelectorList)
    ? [...arg.value]
    : [arg];

  for (let i = 0; i < alternatives.length; i++) {
    const alternative = alternatives[i]!;
    if (!isNode(alternative, N.ComplexSelector)) {
      continue;
    }
    const lastIndex = getLastOrderedSelectorIndex(alternative);
    if (lastIndex === -1) {
      continue;
    }

    const lastSelector = alternative.value[lastIndex]!;
    const merged = mergeCompoundMembersIntoSelector(pulledMembers, lastSelector);
    const mergedMatch = selectorMatch(find, merged, undefined, context);
    if (!mergedMatch.fullMatch) {
      continue;
    }

    const wrapped = wrapSelectorInIs(merged, extendWith);
    const nextAlternative = setSelectorContainerValueAt(
      alternative,
      lastIndex,
      wrapped
    );
    const nextArg = isNode(arg, N.SelectorList)
      ? setSelectorContainerValueAt(arg, i, nextAlternative)
      : nextAlternative;
    const nextPseudo = setPseudoArg(pseudoNode, nextArg);

    const nextData = targetValues
      .flatMap((node, index) => {
        if (index < location.startIndex! || index > location.endIndex! || index === pseudoIndex) {
          return [index === pseudoIndex ? nextPseudo : node];
        }
        return [];
      });
    const nextTarget = setSelectorContainerValue(target, nextData);
    return createSuccessResult(nextTarget);
  }

  return undefined;
}

/** Picks the most useful rewrite location from a selector-match result. */
function getPreferredMatchLocation(
  target: Selector,
  match: ReturnType<typeof selectorMatch>
): ReturnType<typeof selectorMatch>['matches'][number] {
  return match.matches.find(location => location.exact && location.containingNode === target)
    ?? match.matches.find(location => location.exact)
    ?? match.matches[0]!;
}

/**
 * Produces the exact-mode extend output once a full match has already been
 * established by `selectorMatch()`.
 */
function createExactExtendResult(
  target: Selector,
  extendWith: Selector,
  parent: Selector | undefined,
  crossedAmpersand: boolean,
  finalize: (result: ExtendResult) => ExtendResult
): ExtendResult {
  if (
    isNode(target, N.SelectorList)
    || (isNode(target, N.PseudoSelector) && target.name === ':is' && isNode(target.arg, N.Selector))
  ) {
    // When the match crossed a parent boundary, materialize before appending.
    if (crossedAmpersand) {
      const resolved = materializeCrossedTarget(target, parent);
      if (resolved) {
        return finalize(createSuccessResult(createAlternativeSelector(resolved, extendWith)));
      }
    }
    return finalize(createSuccessResult(createAlternativeSelector(target, extendWith)));
  }

  const resolved = crossedAmpersand
    ? materializeCrossedTarget(target, parent)
    : resolveAmpersandTarget(target, parent);
  if (resolved) {
    return finalize(createSuccessResult(createAlternativeSelector(resolved, extendWith)));
  }

  return finalize(createSuccessResult(createAlternativeSelector(target, extendWith)));
}

/**
 * Handles the fallback path where the top-level target had no partial matches,
 * but an exact nested append or direct child rewrite may still be valid.
 */
function tryHandleNoPartialMatch(
  target: Selector,
  find: Selector,
  extendWith: Selector,
  parent: Selector | undefined,
  finalize: (result: ExtendResult) => ExtendResult,
  context?: Context
): ExtendResult | undefined {
  const nestedIsAppend = tryAppendIntoNestedIsOnFullMatch(target, find, extendWith, parent, context);
  if (nestedIsAppend) {
    return finalize(nestedIsAppend);
  }

  const nestedDirectChild = getDirectPseudoArg(target)
    ? tryExtendDirectChildSelector(target, getDirectPseudoArg(target), find, extendWith, parent, false, context)
    : undefined;
  if (nestedDirectChild) {
    if (nestedDirectChild.value.hoistToRoot) {
      target.hoistToRoot = true;
    }
    return finalize(nestedDirectChild);
  }

  return undefined;
}

function tryHandleMultiDirectChildFullMatches(
  target: Selector,
  find: Selector,
  extendWith: Selector,
  parent: Selector | undefined,
  finalize: (result: ExtendResult) => ExtendResult,
  context?: Context
): ExtendResult | undefined {
  if (!isNode(target, N.SelectorList | N.CompoundSelector | N.ComplexSelector)) {
    return undefined;
  }

  const matchedChildren: Array<{ index: number; child: Selector }> = [];
  const targetData = getSelectorChildren(target);
  if (!targetData) {
    return undefined;
  }
  for (let i = 0; i < targetData.length; i++) {
    const child = targetData[i];
    if (!child || !isNode(child, N.Selector)) {
      continue;
    }
    if (isNode(child, N.Combinator)) {
      continue;
    }

    const childMatch = selectorMatch(find, child, parent, context);
    if (childMatch.crossesAmpersand) {
      continue;
    }
    if (!childMatch.fullMatch && !childMatch.partialMatch) {
      continue;
    }
    matchedChildren.push({ index: i, child });
  }

  if (matchedChildren.length < 2) {
    return undefined;
  }

  let currentTarget = target;
  let crossedAmpersand = false;
  let anyChanged = false;
  for (const { index, child } of matchedChildren) {
    const childValueBefore = child.valueOf();
    let replacement: Selector | undefined;

    if (isNode(target, N.SelectorList)) {
      const result = tryExtendSelector(child, find, extendWith, true, parent, context);
      if (!result.error) {
        replacement = result.value;
        crossedAmpersand ||= !!result.value.hoistToRoot;
      }
    } else if (isNode(target, N.CompoundSelector)) {
      const outsideMembers = getCompoundMembersOutsideRange(
        target,
        index,
        index,
        undefined
      );
      const conflict = getCompoundConflictError(outsideMembers, extendWith);
      if (conflict) {
        return { value: target, error: conflict, isChanged: false };
      }

      if (isNode(child, N.CompoundSelector | N.ComplexSelector | N.PseudoSelector | N.SelectorList)) {
        const result = tryExtendSelector(child, find, extendWith, true, parent, context);
        if (!result.error) {
          replacement = result.value;
          crossedAmpersand ||= !!result.value.hoistToRoot;
        }
      } else {
        replacement = wrapSelectorInIs(child, stripRedundantCompoundContext(extendWith, outsideMembers));
      }
    } else {
      if (isNode(child, N.CompoundSelector | N.ComplexSelector | N.PseudoSelector | N.SelectorList)) {
        const result = tryExtendSelector(child, find, extendWith, true, parent, context);
        if (!result.error) {
          replacement = result.value;
          crossedAmpersand ||= !!result.value.hoistToRoot;
        }
      } else {
        replacement = wrapSelectorInIs(child, extendWith);
      }
    }

    if (!replacement) {
      continue;
    }
    if (replacement !== child || replacement.valueOf() !== childValueBefore) {
      anyChanged = true;
    }
    currentTarget = setSelectorContainerValueAt(currentTarget, index, replacement);
  }

  if (crossedAmpersand) {
    currentTarget.hoistToRoot = true;
  }

  return finalize(createSuccessResult(currentTarget, anyChanged));
}

/**
 * Attempts to extend `target` using `find` and `extendWith`.
 *
 * Exact mode adds a new alternative only when `selectorMatch()` reports a full
 * match. Partial mode wraps only genuinely partial matches; if partial mode
 * finds an exact route, it also adds a new alternative instead of generating a
 * redundant `:is(...)` wrapper.
 *
 * The deciding question is whether the successful match stays attached to the
 * same selector component or crosses a component boundary. When the match
 * remains on the same component, the rewrite should append to that component's
 * alternate container. When it crosses a component boundary, the rewrite may
 * need a generated `:is(...)` wrapper to preserve the unmatched surrounding
 * structure.
 *
 * Put differently: before introducing a generated `:is(...)`, first ask
 * whether `selectorMatch()` found an exact full match route for the selector
 * component being rewritten. If it did, the correct shape is a selector list
 * or an append into an existing alternate container.
 *
 * When `parent` is provided, it is passed directly into `selectorMatch()` as a
 * non-mutating implicit ampersand context. This allows extend callers to search
 * authored selectors against their resolved parent context without first
 * materializing implicit ampersand wrappers into the target tree.
 *
 * Nested `tryExtendSelector()` calls in this file are still structural rewrite
 * helpers on already-selected child selectors. They may reuse the same
 * `parent` when that child is part of the same authored selector route and
 * therefore must preserve the same ampersand resolution context, but they do
 * not widen the search into unrelated outer contexts.
 *
 * This implementation is intentionally being rebuilt in tiny slices on top of
 * `selectorMatch()`. Unsupported rewrite shapes currently return `NOT_FOUND`
 * rather than falling back to legacy extend behavior.
 */
export function tryExtendSelector(
  target: Selector,
  find: Selector,
  extendWith: Selector,
  partial: boolean,
  parent?: Selector,
  context?: Context
): ExtendResult {
  const finalize = (result: ExtendResult): ExtendResult => {
    if (!result.error && parent && result.value.hoistToRoot) {
      return createSuccessResult(materializeAmpersandsForHoist(result.value, parent));
    }
    return result;
  };

  const match = selectorMatch(find, target, parent, context);
  if (!partial) {
    if (!match.fullMatch) {
      return createErrorResult(target, ExtendErrorType.NOT_FOUND, 'Selector not found');
    }

    return createExactExtendResult(target, extendWith, parent, match.crossesAmpersand, finalize);
  }

  if (!match.partialMatch || match.matches.length === 0) {
    const noPartialMatchResult = tryHandleNoPartialMatch(target, find, extendWith, parent, finalize, context);
    if (noPartialMatchResult) {
      return noPartialMatchResult;
    }

    return createErrorResult(target, ExtendErrorType.NOT_FOUND, 'Selector not found');
  }

  const earlyDirectListAppend = tryAppendToDirectSelectorListOnFullMatch(target, find, extendWith, parent, context);
  if (earlyDirectListAppend) {
    return finalize(earlyDirectListAppend);
  }

  const multiDirectChildFullMatch = tryHandleMultiDirectChildFullMatches(
    target,
    find,
    extendWith,
    parent,
    finalize,
    context
  );
  if (multiDirectChildFullMatch) {
    return multiDirectChildFullMatch;
  }

  const location = getPreferredMatchLocation(target, match);
  const crossedAmpersand = !!(location.crossesAmpersand || match.crossesAmpersand);
  const markTargetHoist = (extra = false): void => {
    if (crossedAmpersand || extra) {
      target.hoistToRoot = true;
    }
  };
  const finishNested = (
    result: ExtendResult | undefined,
    extraHoist = false
  ): ExtendResult | undefined => {
    if (!result) {
      return undefined;
    }

    markTargetHoist(extraHoist || !!result.value.hoistToRoot);
    return finalize(result);
  };
  const finishRootReplacement = (
    replacement: Selector,
    preserveRootKinds: number
  ): ExtendResult => {
    if (replacement === target) {
      return finalize(createSuccessResult(target, false));
    }
    if (isNode(replacement, preserveRootKinds)) {
      const rootTarget = getSelectorChildren(target) ? target : undefined;
      if (!rootTarget) {
        return finalize(createSuccessResult(replacement));
      }
      const nextTarget = setSelectorContainerValue(
        rootTarget,
        [...getSelectorChildren(replacement)!]
      );
      if (crossedAmpersand) {
        nextTarget.hoistToRoot = true;
      }
      return finalize(createSuccessResult(nextTarget));
    }

    if (crossedAmpersand) {
      replacement.hoistToRoot = true;
    }
    return finalize(createSuccessResult(replacement));
  };
  const finishStructuralChildRewrite = (
    child: Selector | undefined
  ): ExtendResult | undefined => {
    if (!child) {
      return undefined;
    }

    const nested = tryExtendSelector(child, find, extendWith, true, parent, context);
    const nextTarget = nested.error ? undefined : replaceDirectSelectorChild(target, child, nested.value);
    if (!nextTarget) {
      return undefined;
    }

    if (crossedAmpersand || nested.value.hoistToRoot) {
      nextTarget.hoistToRoot = true;
    }
    return finalize(createSuccessResult(nextTarget, nested.isChanged));
  };
  const tryHandleRootSingleSlotPartial = (): ExtendResult | undefined => {
    const rootIsOrdered = isNode(target, N.ComplexSelector) || isNode(target, N.CompoundSelector);
    const targetChildren = getSelectorChildren(target);
    const orderedTarget = getComplexSelector(target) ?? getCompoundSelector(target);
    if (
      !rootIsOrdered
      || location.containingNode !== target
      || location.startIndex === undefined
      || location.endIndex === undefined
      || location.startIndex !== location.endIndex
      || (
        targetChildren !== undefined
        && isNode(targetChildren[location.startIndex]!, N.CompoundSelector)
        && location.matchedIndices
        && location.matchedIndices.length > 0
      )
    ) {
      return undefined;
    }

    const compoundTarget = getCompoundSelector(target);
    const compoundOutsideMembers = compoundTarget
      ? getCompoundMembersOutsideRange(
          compoundTarget,
          location.startIndex,
          location.endIndex,
          location.matchedIndices
        )
      : undefined;

    if (compoundTarget) {
      const conflict = getCompoundConflictError(compoundOutsideMembers!, extendWith);
      if (conflict) {
        return { value: target, error: conflict, isChanged: false };
      }
    }

    const existing = targetChildren![location.startIndex]!;
    const nestedIsListAppend = tryAppendToDirectSelectorListOnFullMatch(existing, find, extendWith, parent, context);
    if (nestedIsListAppend) {
      const nextTarget = setSelectorContainerValueAt(
        orderedTarget!,
        location.startIndex,
        nestedIsListAppend.value
      );
      if (crossedAmpersand || nestedIsListAppend.value.hoistToRoot) {
        nextTarget.hoistToRoot = true;
      }
      return finalize(createSuccessResult(nextTarget));
    }

    if (
      isNode(existing, N.PseudoSelector | N.SelectorList | N.CompoundSelector | N.ComplexSelector)
      && !isNode(existing, N.CompoundSelector)
    ) {
      const nested = tryExtendSelector(existing, find, extendWith, true, parent, context);
      if (!nested.error) {
        const nextTarget = setSelectorContainerValueAt(
          orderedTarget!,
          location.startIndex,
          nested.value
        );
        if (crossedAmpersand || nested.value.hoistToRoot) {
          nextTarget.hoistToRoot = true;
        }
        return finalize(createSuccessResult(nextTarget, nested.isChanged));
      }
    }

    const wrapped = wrapSelectorInIs(existing, stripRedundantCompoundContext(extendWith, compoundOutsideMembers ?? []));
    const nextTarget = setSelectorContainerValueAt(
      orderedTarget!,
      location.startIndex,
      wrapped
    );
    if (crossedAmpersand) {
      nextTarget.hoistToRoot = true;
    }
    return finalize(createSuccessResult(nextTarget, wrapped !== existing));
  };
  const tryHandleRootMultiSlotPartial = (): ExtendResult | undefined => {
    const compoundTarget = getCompoundSelector(target);
    if (
      compoundTarget
      && location.containingNode === target
      && location.startIndex !== undefined
      && location.endIndex !== undefined
      && location.startIndex < location.endIndex
    ) {
      const crossedAmpersandParent = getCrossedAmpersandParent(location);
      if (crossedAmpersandParent) {
        const replacement = wrapResolvedCompoundSpan(
          compoundTarget,
          location.startIndex,
          location.endIndex,
          extendWith,
          crossedAmpersandParent
        );
        return finishRootReplacement(replacement, N.ComplexSelector | N.CompoundSelector);
      }

      const outsideMembers = getCompoundMembersOutsideRange(
        compoundTarget,
        location.startIndex,
        location.endIndex,
        location.matchedIndices
      );
      const conflict = getCompoundConflictError(outsideMembers, extendWith);
      if (conflict) {
        return { value: target, error: conflict, isChanged: false };
      }

      const pulledIntoNestedIs = tryPullCompoundMatchIntoNestedIsBranch(compoundTarget, location, find, extendWith, context);
      if (pulledIntoNestedIs) {
        return finalize(pulledIntoNestedIs);
      }

      const replacement = wrapCompoundMatchRange(
        compoundTarget,
        location.startIndex,
        location.endIndex,
        location.matchedIndices,
        extendWith
      );
      return finishRootReplacement(replacement, N.ComplexSelector | N.CompoundSelector);
    }

    const complexTarget = getComplexSelector(target);
    if (
      complexTarget
      && location.containingNode === target
      && location.startIndex !== undefined
      && location.endIndex !== undefined
      && location.startIndex < location.endIndex
    ) {
      const crossedAmpersandParent = getCrossedAmpersandParent(location)
        ?? (crossedAmpersand ? parent : undefined);
      if (crossedAmpersandParent) {
        const replacement = wrapResolvedOrderedSpanWithTailRemainder(
          complexTarget,
          location.startIndex,
          location.endIndex,
          extendWith,
          crossedAmpersandParent,
          getLastOrderedSelector(find),
          location,
          context
        );
        if (replacement) {
          return finishRootReplacement(replacement, N.ComplexSelector);
        }
      }

      const replacement = wrapOrderedMatchRange(complexTarget, location.startIndex, location.endIndex, extendWith);
      return finishRootReplacement(replacement, N.ComplexSelector);
    }

    return undefined;
  };
  const tryHandleDirectChildContainingNodePartial = (): ExtendResult | undefined => {
    const containingNode = location.containingNode;
    const directChild = isNode(containingNode, N.Selector)
      ? (
          getContainingDirectChildSelector(target, containingNode)
          ?? getStructurallyMatchingDirectChildSelector(target, containingNode)
        )
      : undefined;
    if (!directChild) {
      return undefined;
    }

    let replacement: Selector;
    if (
      isNode(directChild, N.CompoundSelector)
      && location.startIndex !== undefined
      && location.endIndex !== undefined
    ) {
      const crossedAmpersandParent = getCrossedAmpersandParent(location);
      if (crossedAmpersandParent) {
        replacement = wrapSelectorInIs(
          materializeAmpersandsForHoist(directChild, crossedAmpersandParent),
          extendWith
        );
      } else {
        const pulledIntoNestedIs = tryPullCompoundMatchIntoNestedIsBranch(directChild, location, find, extendWith, context);
        if (pulledIntoNestedIs) {
          replacement = pulledIntoNestedIs.value;
        } else {
          const conflict = getCompoundConflictError(
            getCompoundMembersOutsideRange(
              directChild,
              location.startIndex,
              location.endIndex,
              location.matchedIndices
            ),
            extendWith
          );
          if (conflict) {
            return { value: target, error: conflict, isChanged: false };
          }

          replacement = wrapCompoundMatchRange(
            directChild,
            location.startIndex,
            location.endIndex,
            location.matchedIndices,
            extendWith
          );
        }
      }
    } else {
      const nestedDirectChild = isNode(directChild, N.PseudoSelector | N.SelectorList | N.ComplexSelector)
        ? tryExtendSelector(directChild, find, extendWith, true, parent, context)
        : undefined;
      if (nestedDirectChild && !nestedDirectChild.error) {
        replacement = nestedDirectChild.value;
      } else {
        const compoundTarget = getCompoundSelector(target);
        if (compoundTarget) {
          const childIndex = compoundTarget.value.findIndex(node => node === containingNode);
          if (childIndex !== -1) {
            const conflict = getCompoundConflictError(
              getCompoundMembersOutsideRange(
                compoundTarget,
                childIndex,
                childIndex,
                undefined
              ),
              extendWith
            );
            if (conflict) {
              return { value: target, error: conflict, isChanged: false };
            }
          }
        }

        replacement = wrapSelectorInIs(directChild, extendWith);
      }
    }

    const childChanged = replacement !== directChild;
    const nextTarget = replaceDirectSelectorChild(target, directChild, replacement);
    if (nextTarget) {
      if (crossedAmpersand) {
        nextTarget.hoistToRoot = true;
      }
      return finalize(createSuccessResult(nextTarget, childChanged));
    }

    return undefined;
  };
  const directPseudoArg = getDirectPseudoArg(target);
  const directIsArg = getDirectIsArg(target);
  if (location.exact) {
    const directListAppend = tryAppendToDirectSelectorListOnFullMatch(target, find, extendWith, parent);
    if (directListAppend) {
      markTargetHoist(!!directListAppend.value.hoistToRoot);
      return finalize(directListAppend);
    }

    if (
      location.containingNode === target
      && isNode(target, N.ComplexSelector)
    ) {
      const resolved = resolveAmpersandTarget(target, parent);
      if (resolved) {
        const exactResult = createAlternativeSelector(resolved, extendWith);
        exactResult.hoistToRoot = true;
        markTargetHoist(true);
        return finalize(createSuccessResult(exactResult));
      }
    }

    if (location.containingNode === target) {
      const nestedIsResult = directIsArg
        ? tryExtendDirectChildSelector(target, directIsArg, find, extendWith, parent, crossedAmpersand, context)
        : undefined;
      const finishedNestedIs = finishNested(nestedIsResult);
      if (finishedNestedIs) {
        return finishedNestedIs;
      }

      const nestedPseudoResult = directPseudoArg && directPseudoArg === location.containingNode
        ? tryExtendDirectChildSelector(target, location.containingNode, find, extendWith, parent, crossedAmpersand, context)
        : undefined;
      const finishedNestedPseudo = finishNested(nestedPseudoResult);
      if (finishedNestedPseudo) {
        return finishedNestedPseudo;
      }

      const nestedListResult = isNode(target, N.SelectorList)
        ? tryExtendDirectChildSelector(target, getSingleMatchedDirectChild(target, location), find, extendWith, parent, crossedAmpersand, context)
        : undefined;
      const finishedNestedList = finishNested(nestedListResult);
      if (finishedNestedList) {
        return finishedNestedList;
      }

      const nestedOrderedChildResult = (isNode(target, N.ComplexSelector) || isNode(target, N.CompoundSelector))
        ? tryExtendDirectChildSelector(target, getSingleMatchedDirectChild(target, location), find, extendWith, parent, crossedAmpersand, context)
        : undefined;
      const finishedNestedOrderedChild = finishNested(nestedOrderedChildResult);
      if (finishedNestedOrderedChild) {
        return finishedNestedOrderedChild;
      }

      const exactTarget = crossedAmpersand
        ? materializeCrossedTarget(target, parent) ?? target
        : target;
      const exactResult = createAlternativeSelector(exactTarget, extendWith);
      if (crossedAmpersand) {
        exactResult.hoistToRoot = true;
        markTargetHoist(true);
      }
      return finalize(createSuccessResult(exactResult));
    }

    const nestedPseudoListAppend = isNode(location.containingNode, N.Selector)
      ? tryAppendToContainingSelectorList(target, location.containingNode, extendWith)
      : undefined;
    const finishedNestedPseudoListAppend = finishNested(nestedPseudoListAppend);
    if (finishedNestedPseudoListAppend) {
      return finishedNestedPseudoListAppend;
    }

    if (location.containingNode.parent === target) {
      if (isNode(target, N.SelectorList)) {
        const rewrittenListChild = isNode(location.containingNode, N.Selector)
          ? finishStructuralChildRewrite(location.containingNode)
          : undefined;
        if (rewrittenListChild) {
          return rewrittenListChild;
        }

        return finalize(createSuccessResult(createAlternativeSelector(target, extendWith)));
      }

      const rewrittenChild = isNode(location.containingNode, N.Selector)
        ? finishStructuralChildRewrite(location.containingNode)
        : undefined;
      if (rewrittenChild) {
        return rewrittenChild;
      }
    }
  }

  const nestedPseudoResult = directPseudoArg && directPseudoArg === location.containingNode
    ? tryExtendDirectChildSelector(target, location.containingNode, find, extendWith, parent, crossedAmpersand, context)
    : undefined;
  const finishedNestedPseudo = finishNested(nestedPseudoResult);
  if (finishedNestedPseudo) {
    return finishedNestedPseudo;
  }

  if (location.containingNode === target) {
    const nestedIsResult = directIsArg
      ? tryExtendDirectChildSelector(target, directIsArg, find, extendWith, parent, crossedAmpersand, context)
      : undefined;
    const finishedNestedIs = finishNested(nestedIsResult);
    if (finishedNestedIs) {
      return finishedNestedIs;
    }

    const nestedListResult = isNode(target, N.SelectorList)
      ? tryExtendDirectChildSelector(target, getSingleMatchedDirectChild(target, location), find, extendWith, parent, crossedAmpersand, context)
      : undefined;
    const finishedNestedList = finishNested(nestedListResult);
    if (finishedNestedList) {
      return finishedNestedList;
    }
  }

  const rootSingleSlotPartial = tryHandleRootSingleSlotPartial();
  if (rootSingleSlotPartial) {
    return rootSingleSlotPartial;
  }

  const rootMultiSlotPartial = tryHandleRootMultiSlotPartial();
  if (rootMultiSlotPartial) {
    return rootMultiSlotPartial;
  }

  const directChildContainingNodePartial = tryHandleDirectChildContainingNodePartial();
  if (directChildContainingNodePartial) {
    return directChildContainingNodePartial;
  }

  const containingChild = getContainingDirectChildSelector(target, location.containingNode);
  if (containingChild) {
    const nested = tryExtendDirectChildSelector(target, containingChild, find, extendWith, parent, crossedAmpersand, context);
    const finishedNested = finishNested(nested);
    if (finishedNested) {
      return finishedNested;
    }
  }

  return createErrorResult(target, ExtendErrorType.NOT_FOUND, 'Partial extend shape not implemented yet');
}
