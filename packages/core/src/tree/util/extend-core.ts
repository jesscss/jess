import type { Selector } from '../selector.js';
import { SelectorList } from '../selector-list.js';
import { CompoundSelector } from '../selector-compound.js';
import { ComplexSelector } from '../selector-complex.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { Combinator } from '../combinator.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { getImplicitSelector, getParentReplacementForAmpersand, wrapParentSelectorForNestedContext } from './selector-utils.js';
import { selectorMatch } from './selector-match-core.js';
import type { Node } from '../node.js';
import { F_AMPERSAND, F_EXTENDED, F_VISIBLE } from '../node-base.js';

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
    && selector.data.name === ':is'
    && isNode(selector.data.arg, N.SelectorList)
  ) {
    return (selector.data.arg as SelectorList).data.map(item => item.copy(true) as Selector);
  }

  return [selector.copy(true) as Selector];
}

function normalizeSelectorListAlternatives(list: SelectorList): void {
  const flattened: Selector[] = [];
  const seen = new Set<string>();

  for (const item of list.data) {
    if (isNode(item, N.PseudoSelector) && item.data.name === ':is' && isNode(item.data.arg, N.SelectorList)) {
      for (const child of (item.data.arg as SelectorList).data) {
        const copy = child.copy(true) as Selector;
        const key = copy.valueOf();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        flattened.push(copy);
      }
      continue;
    }

    if (isNode(item, N.CompoundSelector) && item.data.length === 1) {
      const only = item.data[0]!;
      if (isNode(only, N.PseudoSelector) && only.data.name === ':is' && isNode(only.data.arg, N.SelectorList)) {
        for (const child of (only.data.arg as SelectorList).data) {
          const copy = child.copy(true) as Selector;
          const key = copy.valueOf();
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          flattened.push(copy);
        }
        continue;
      }
    }

    if (isNode(item, N.ComplexSelector) && item.data.length === 1) {
      const only = item.data[0]!;
      if (isNode(only, N.PseudoSelector) && only.data.name === ':is' && isNode(only.data.arg, N.SelectorList)) {
        for (const child of (only.data.arg as SelectorList).data) {
          const copy = child.copy(true) as Selector;
          const key = copy.valueOf();
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          flattened.push(copy);
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

  if (flattened.length !== list.data.length) {
    list.setData(flattened);
  }
}

/**
 * Appends a new alternative to an existing alternate container in place.
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
    normalizeSelectorListAlternatives(target);
    for (const item of next) {
      target.push(item);
    }
    normalizeSelectorListAlternatives(target);
    return target;
  }

  if (isNode(target, N.PseudoSelector) && target.data.name === ':is' && isNode(target.data.arg, N.Selector)) {
    const arg = target.data.arg as Selector;
    if (isNode(arg, N.SelectorList)) {
      normalizeSelectorListAlternatives(arg);
      for (const item of next) {
        arg.push(item);
      }
      normalizeSelectorListAlternatives(arg);
      return target;
    }

    const list = SelectorList.create([arg, ...next]).inherit(arg) as SelectorList;
    normalizeSelectorListAlternatives(list);
    target.setData('arg', list as Selector);
    return target;
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
  const appended = appendAlternative(target, extendWith);
  if (appended) {
    return appended;
  }

  return SelectorList.create([
    target,
    extendWith.copy(true) as Selector
  ]).inherit(target) as Selector;
}

/**
 * Wraps one matched selector fragment in a generated `:is(original, extendWith)`
 * pseudo so partial extends can preserve unmatched siblings around it.
 *
 * When `selector` and `extendWith` are identical (e.g. `.class:extend(.class all)`),
 * no wrapper is needed — the fragment is marked visible in place and returned as-is.
 */
function wrapSelectorInIs(selector: Selector, extendWith: Selector): Selector {
  if (selector.valueOf() === extendWith.valueOf()) {
    selector.addFlag(F_EXTENDED);
    selector.addFlag(F_VISIBLE);
    return selector;
  }

  const arg = SelectorList.create([
    selector,
    extendWith.copy(true) as Selector
  ]).inherit(selector) as SelectorList;
  arg.pre = undefined;
  arg.post = undefined;

  const wrapper = PseudoSelector.create({
    name: ':is',
    arg: arg as Selector
  });
  wrapper.generated = true;
  const inherited = wrapper.inherit(selector) as Selector;
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
  return wrapper.inherit(selector) as Selector;
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
    for (const child of (selector as CompoundSelector | SelectorList).data) {
      collectCompoundConflictInfo(child as Selector, info);
    }
    return info;
  }

  if (isNode(selector, N.ComplexSelector)) {
    const complexData = (selector as unknown as ComplexSelector).data;
    for (let i = complexData.length - 1; i >= 0; i--) {
      const child = complexData[i] as Selector;
      if (isNode(child, N.Combinator)) {
        continue;
      }
      collectCompoundConflictInfo(child, info);
      break;
    }
    return info;
  }

  if (isNode(selector, N.PseudoSelector) && isNode((selector as unknown as PseudoSelector).data.arg, N.Selector)) {
    const pseudoData = (selector as unknown as PseudoSelector).data;
    if (pseudoData.name === ':is') {
      collectCompoundConflictInfo(pseudoData.arg as Selector, info);
    }
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

  const extension = collectCompoundConflictInfo(extendWith.copy(true) as Selector);
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
      return node.copy(true) as Selector;
    }

    if (isNode(node, N.CompoundSelector)) {
      const next = node.data
        .map(child => normalize(child as Selector))
        .filter(Boolean) as Selector[];
      if (next.length === 0) {
        return undefined;
      }
      if (next.length === 1) {
        return next[0]!;
      }
      return CompoundSelector.create(next).inherit(node) as Selector;
    }

    if (isNode(node, N.SelectorList)) {
      const next = node.data
        .map(child => normalize(child as Selector))
        .filter(Boolean) as Selector[];
      if (next.length === 0) {
        return node.copy(true) as Selector;
      }
      if (next.length === 1) {
        return next[0]!;
      }
      return SelectorList.create(next).inherit(node) as Selector;
    }

    if (isNode(node, N.PseudoSelector) && node.data.name === ':is' && isNode(node.data.arg, N.Selector)) {
      const nextArg = normalize(node.data.arg as Selector);
      if (!nextArg) {
        return undefined;
      }
      const copy = node.copy(true) as PseudoSelector;
      copy.setData('arg', nextArg);
      return copy as Selector;
    }

    return node.copy(true) as Selector;
  };

  return normalize(selector) ?? selector.copy(true) as Selector;
}

/**
 * Rewrites a compound-local partial match by replacing only the consumed
 * members with a generated `:is(...)` wrapper and leaving the unmatched
 * remainder in place.
 */
function wrapCompoundMatchRange(
  targetCompound: Selector & { data: readonly Selector[] },
  startIndex: number,
  endIndex: number,
  matchedIndices: number[] | undefined,
  extendWith: Selector
): Selector {
  const effectiveMatchedIndices = matchedIndices && matchedIndices.length > 0
    ? matchedIndices
    : Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => startIndex + offset);
  const outsideMembers = getCompoundMembersOutsideRange(targetCompound, startIndex, endIndex, matchedIndices);
  const matched = effectiveMatchedIndices.map(index => targetCompound.data[index]!);
  const matchedSingle = matched.length === 1 ? matched[0]! : undefined;
  const wrapped = wrapSelectorInIs(
    matchedSingle ?? CompoundSelector.create(matched).inherit(targetCompound) as Selector,
    stripRedundantCompoundContext(extendWith, outsideMembers)
  );
  if (matchedSingle && wrapped === matchedSingle) {
    return targetCompound;
  }
  const nextData: Selector[] = [];
  const matchedIndexSet = new Set(effectiveMatchedIndices);

  for (let i = 0; i < targetCompound.data.length; i++) {
    const node = targetCompound.data[i]!;
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

  return ComplexSelector.create(nextData).inherit(targetCompound) as Selector;
}

function getCompoundMembersOutsideRange(
  compoundSelector: Selector & { data: readonly Selector[] },
  startIndex: number,
  endIndex: number,
  matchedIndices: number[] | undefined
): Selector[] {
  const effectiveMatchedIndices = matchedIndices && matchedIndices.length > 0
    ? matchedIndices
    : Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => startIndex + offset);
  const matchedIndexSet = new Set(effectiveMatchedIndices);

  return compoundSelector.data.filter((_, index) => !matchedIndexSet.has(index)) as Selector[];
}

function wrapOrderedMatchRange(
  targetSelector: Selector & { data: readonly Selector[] },
  startIndex: number,
  endIndex: number,
  extendWith: Selector
): Selector {
  const matched = targetSelector.data.slice(startIndex, endIndex + 1) as Selector[];
  const wrapped = wrapSelectorInIs(
    matched.length === 1
      ? matched[0]!
      : ComplexSelector.create(matched).inherit(targetSelector) as Selector,
    extendWith
  );
  const nextData: Selector[] = [];

  for (let i = 0; i < targetSelector.data.length; i++) {
    const node = targetSelector.data[i]!;
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

  return ComplexSelector.create(nextData).inherit(targetSelector) as Selector;
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
): boolean {
  if (isNode(parent, N.PseudoSelector) && parent.data.arg === child) {
    parent.setData('arg', replacement);
    return true;
  }

  if (isNode(parent, N.SelectorList | N.ComplexSelector | N.CompoundSelector)) {
    const parentArr = (parent as unknown as SelectorList | ComplexSelector | CompoundSelector).data as readonly unknown[];
    const index = (parentArr as unknown[]).findIndex((node: unknown) => node === child);
    if (index !== -1) {
      parent.setData(index, replacement);
      return true;
    }
  }

  return false;
}

/**
 * Resolves authored ampersands in a root complex selector against the provided
 * parent without mutating the original target selector.
 *
 * This is currently used only for full-span crossed matches on the root target
 * route.
 */
function resolveAmpersandTarget(
  target: Selector,
  parent?: Selector
): Selector | undefined {
  if (!isNode(target, N.ComplexSelector)) {
    return undefined;
  }

  const nextData: Selector[] = [];
  let replacedAny = false;

  for (let i = 0; i < target.data.length; i++) {
    const component = target.data[i]!;
    if (isNode(component, N.Ampersand)) {
      const resolvedRaw = component.getResolvedSelector() ?? parent;
      if (!resolvedRaw || isNode(resolvedRaw, N.Nil)) {
        nextData.push(component.copy(true) as Selector);
        continue;
      }
      const resolved = resolvedRaw as Selector;
      nextData.push(...getParentReplacementForAmpersand(resolved, i === 0));
      replacedAny = true;
      continue;
    }
    nextData.push(component.copy(true) as Selector);
  }

  if (!replacedAny) {
    return undefined;
  }

  return ComplexSelector.create(nextData).inherit(target) as Selector;
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
  const resolvedAmpersands = resolveAmpersandTarget(target, parent);
  if (resolvedAmpersands) {
    return resolvedAmpersands;
  }

  if (!parent) {
    return undefined;
  }

  // When both are SelectorLists, produce :is(parent) :is(inner) to avoid
  // duplicating the parent prefix across every alternative.
  if (isNode(target, N.SelectorList) && isNode(parent, N.SelectorList)) {
    const parentFragment = wrapParentSelectorForNestedContext(parent, false) as Selector;
    const innerIs = PseudoSelector.create({ name: ':is', arg: target.copy(true) as Selector }) as PseudoSelector;
    innerIs.generated = true;
    return ComplexSelector.create([parentFragment, Combinator.create(' '), innerIs as Selector]).inherit(target) as Selector;
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
    const resolvedCopy = resolved.copy(true) as Selector;
    return materializeAmpersandsForHoist(resolvedCopy, parent);
  }

  if (isNode(selector, N.SelectorList)) {
    const next = selector.data.map(child =>
      materializeAmpersandsForHoist((child as Selector).copy(true) as Selector, parent)
    ) as Selector[];
    const rebuilt = SelectorList.create(next).inherit(selector) as Selector;
    rebuilt.hoistToRoot = selector.hoistToRoot;
    return rebuilt;
  }

  if (isNode(selector, N.ComplexSelector)) {
    const nextData: Selector[] = [];

    for (let i = 0; i < selector.data.length; i++) {
      const child = selector.data[i] as Selector;
      if (isNode(child, N.Ampersand)) {
        const resolved = child.getResolvedSelector() ?? parent;
        const replacement = materializeAmpersandsForHoist(resolved.copy(true) as Selector, parent);
        nextData.push(...getParentReplacementForAmpersand(replacement, i === 0));
        continue;
      }

      nextData.push(materializeAmpersandsForHoist(child.copy(true) as Selector, parent));
    }

    const rebuilt = ComplexSelector.create(nextData).inherit(selector) as Selector;
    rebuilt.hoistToRoot = selector.hoistToRoot;
    return rebuilt;
  }

  if (isNode(selector, N.CompoundSelector)) {
    const nextData: Selector[] = [];

    for (const child of selector.data) {
      const selectorChild = child as Selector;
      if (isNode(selectorChild, N.Ampersand)) {
        const resolved = materializeAmpersandsForHoist((selectorChild.getResolvedSelector() ?? parent).copy(true) as Selector, parent);
        if (isNode(resolved, N.CompoundSelector)) {
          nextData.push(...resolved.data as Selector[]);
        } else if (isNode(resolved, N.ComplexSelector | N.SelectorList)) {
          nextData.push(wrapSelectorAsGeneratedIs(resolved));
        } else {
          nextData.push(resolved);
        }
        continue;
      }

      nextData.push(materializeAmpersandsForHoist(selectorChild.copy(true) as Selector, parent));
    }

    if (nextData.length === 1) {
      const only = nextData[0]!;
      only.hoistToRoot = selector.hoistToRoot;
      return only;
    }

    const rebuilt = CompoundSelector.create(nextData).inherit(selector) as Selector;
    rebuilt.hoistToRoot = selector.hoistToRoot;
    return rebuilt;
  }

  if (isNode(selector, N.PseudoSelector) && isNode(selector.data.arg, N.Selector)) {
    const copy = selector.copy(true) as PseudoSelector;
    copy.setData('arg', materializeAmpersandsForHoist(selector.data.arg as Selector, parent));
    copy.hoistToRoot = selector.hoistToRoot;
    return copy as Selector;
  }

  const copy = selector.copy(true) as Selector;
  copy.hoistToRoot = selector.hoistToRoot;
  return copy;
}

function getCrossedAmpersandParent(location: ReturnType<typeof selectorMatch>['matches'][number]): Selector | undefined {
  const crossing = location.ampersandCrossings?.find(crossing => crossing.parentSegment && isNode(crossing.parentSegment.containingNode, N.Selector));
  return crossing?.parentSegment?.containingNode as Selector | undefined;
}

/**
 * Rewrites a root compound span that crossed an ampersand by resolving the
 * matched span against the parent seam and leaving unmatched compound members
 * outside the generated `:is(...)`.
 */
function wrapResolvedCompoundSpan(
  targetCompound: Selector & { data: readonly Selector[] },
  startIndex: number,
  endIndex: number,
  extendWith: Selector,
  resolvedParent: Selector
): Selector {
  const matchedMembers = targetCompound.data.slice(startIndex, endIndex + 1) as Selector[];
  const matchedSelector = matchedMembers.length === 1
    ? matchedMembers[0]!
    : CompoundSelector.create(matchedMembers).inherit(targetCompound) as Selector;
  const outsideMembers = targetCompound.data.filter((_, index) => index < startIndex || index > endIndex) as Selector[];
  const wrapped = wrapSelectorInIs(
    materializeAmpersandsForHoist(matchedSelector, resolvedParent),
    stripRedundantCompoundContext(extendWith, outsideMembers)
  );
  const nextData: Selector[] = [];

  for (let i = 0; i < targetCompound.data.length; i++) {
    if (i === startIndex) {
      nextData.push(wrapped);
      continue;
    }
    if (i > startIndex && i <= endIndex) {
      continue;
    }
    nextData.push(targetCompound.data[i] as Selector);
  }

  if (nextData.length === 1) {
    return nextData[0]!;
  }

  return ComplexSelector.create(nextData).inherit(targetCompound) as Selector;
}

function getLastOrderedSelector(selector: Selector): Selector {
  if (isNode(selector, N.ComplexSelector)) {
    for (let i = selector.data.length - 1; i >= 0; i--) {
      const child = selector.data[i] as Selector;
      if (!isNode(child, N.Combinator)) {
        return child;
      }
    }
  }

  return selector;
}

function buildMatchedCompoundSelector(
  targetCompound: Selector & { data: readonly Selector[] },
  startIndex: number,
  endIndex: number,
  matchedIndices?: number[]
): Selector {
  const effectiveMatchedIndices = matchedIndices && matchedIndices.length > 0
    ? matchedIndices
    : Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => startIndex + offset);
  const matched = effectiveMatchedIndices.map(index => targetCompound.data[index] as Selector);

  if (matched.length === 1) {
    return matched[0]!;
  }

  return CompoundSelector.create(matched).inherit(targetCompound) as Selector;
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
  targetSelector: Selector & { data: readonly Selector[] },
  startIndex: number,
  endIndex: number,
  extendWith: Selector,
  resolvedParent: Selector,
  terminalFind: Selector,
  location?: ReturnType<typeof selectorMatch>['matches'][number]
): Selector | undefined {
  const tail = targetSelector.data[endIndex] as Selector;
  if (!isNode(tail, N.CompoundSelector)) {
    return undefined;
  }

  const tailMatch = selectorMatch(terminalFind, tail, resolvedParent);
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
    matchedPrefix.push(materializeAmpersandsForHoist((targetSelector.data[i] as Selector).copy(true) as Selector, resolvedParent));
  }

  const matchedTailSelector = buildMatchedCompoundSelector(
    tail as Selector & { data: readonly Selector[] },
    tailStartIndex,
    tailEndIndex,
    effectiveTailMatchedIndices
  );
  matchedPrefix.push(crossedTailSegment
    ? materializeAmpersandsForHoist(matchedTailSelector, resolvedParent)
    : matchedTailSelector);

  const orderedMatchedSelector = matchedPrefix.length === 1
    ? matchedPrefix[0]!
    : ComplexSelector.create(matchedPrefix).inherit(targetSelector) as Selector;
  const wrapped = wrapSelectorInIs(orderedMatchedSelector, extendWith);
  const tailRemainder = getCompoundMembersOutsideRange(
    tail as Selector & { data: readonly Selector[] },
    tailStartIndex,
    tailEndIndex,
    effectiveTailMatchedIndices
  );
  const inserted = tailRemainder.length > 0
    ? CompoundSelector.create([wrapped, ...tailRemainder]).inherit(tail) as Selector
    : wrapped;

  const nextData: Selector[] = [];
  for (let i = 0; i < targetSelector.data.length; i++) {
    if (i === startIndex) {
      nextData.push(inserted);
      continue;
    }
    if (i > startIndex && i <= endIndex) {
      continue;
    }
    nextData.push(targetSelector.data[i] as Selector);
  }

  if (nextData.length === 1) {
    return nextData[0]!;
  }

  return ComplexSelector.create(nextData).inherit(targetSelector) as Selector;
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
  crossedAmpersandHint = false
): ExtendResult | undefined {
  if (!child) {
    return undefined;
  }

  const nested = tryExtendSelector(child, find, extendWith, true, parent);
  if (nested.error) {
    return undefined;
  }

  if (!replaceDirectSelectorChild(target, child, nested.value)) {
    return undefined;
  }

  if (nested.value.hoistToRoot || crossedAmpersandHint) {
    target.hoistToRoot = true;
  } else if (parent && child.hasFlag(F_AMPERSAND)) {
    const childMatch = selectorMatch(find, child, parent);
    if (childMatch.fullMatch && childMatch.crossesAmpersand) {
      target.hoistToRoot = true;
    }
  }
  return createSuccessResult(target, nested.isChanged);
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
    return current as Selector;
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

  return (target as SelectorList | CompoundSelector | ComplexSelector).data[location.startIndex] as Selector | undefined;
}

/** Returns the direct selector-valued arg on a pseudo selector, if any. */
function getDirectPseudoArg(
  target: Selector
): Selector | undefined {
  return isNode(target, N.PseudoSelector) && isNode(target.data.arg, N.Selector)
    ? target.data.arg as Selector
    : undefined;
}

/** Returns the direct selector-valued arg on a `:is(...)` pseudo, if any. */
function getDirectIsArg(
  target: Selector
): Selector | undefined {
  return isNode(target, N.PseudoSelector) && target.data.name === ':is' && isNode(target.data.arg, N.Selector)
    ? target.data.arg as Selector
    : undefined;
}

/** Returns the directly rewriteable selector-list container on `target`, if any. */
function getDirectSelectorList(
  target: Selector
): Selector | undefined {
  if (isNode(target, N.SelectorList)) {
    return target;
  }

  if (isNode(target, N.PseudoSelector) && isNode(target.data.arg, N.SelectorList)) {
    return target.data.arg as Selector;
  }

  return undefined;
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

  appendAlternative(list, extendWith);
  return createSuccessResult(target);
}

/**
 * Appends at the end of the direct selector-list container when `find`
 * fully matches that container under the same parent context.
 */
function tryAppendToDirectSelectorListOnFullMatch(
  target: Selector,
  find: Selector,
  extendWith: Selector,
  parent?: Selector
): ExtendResult | undefined {
  const list = getDirectSelectorList(target);
  if (!list) {
    return undefined;
  }
  const innerMatch = selectorMatch(find, list, parent);
  if (!innerMatch.fullMatch) {
    return undefined;
  }

  appendAlternative(list, extendWith);
  if (innerMatch.crossesAmpersand) {
    target.hoistToRoot = true;
  }
  return createSuccessResult(target);
}

function getLastOrderedSelectorIndex(selector: Selector & { data: readonly Selector[] }): number {
  for (let i = selector.data.length - 1; i >= 0; i--) {
    if (!isNode(selector.data[i] as Selector, N.Combinator)) {
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
  if (isNode(selector, N.CompoundSelector)) {
    merged.push(...selector.data as Selector[]);
  } else {
    merged.push(selector);
  }
  if (merged.length === 1) {
    return merged[0]!;
  }
  return CompoundSelector.create(merged).inherit(selector) as Selector;
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
  parent?: Selector
): ExtendResult | undefined {
  if (!isNode(target, N.CompoundSelector | N.ComplexSelector)) {
    return undefined;
  }

  const targetData = (target as unknown as CompoundSelector | ComplexSelector).data as readonly Selector[];
  for (let i = 0; i < targetData.length; i++) {
    const child = targetData[i] as Selector;
    if (!(isNode(child, N.PseudoSelector) && child.data.name === ':is' && isNode(child.data.arg, N.Selector))) {
      continue;
    }
    const innerMatch = selectorMatch(find, child.data.arg as Selector, parent);
    if (!innerMatch.fullMatch) {
      continue;
    }
    appendAlternative(child as Selector, extendWith);
    if (innerMatch.crossesAmpersand) {
      target.hoistToRoot = true;
    }
    return createSuccessResult(target);
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
  target: Selector,
  location: ReturnType<typeof selectorMatch>['matches'][number],
  find: Selector,
  extendWith: Selector
): ExtendResult | undefined {
  if (!(isNode(target, N.CompoundSelector) && location.startIndex !== undefined && location.endIndex !== undefined)) {
    return undefined;
  }

  const pseudoIndex = target.data.findIndex((node, index) =>
    index >= location.startIndex!
    && index <= location.endIndex!
    && isNode(node as Selector, N.PseudoSelector)
    && (node as PseudoSelector).data.name === ':is'
    && isNode((node as PseudoSelector).data.arg, N.Selector)
  );
  if (pseudoIndex === -1) {
    return undefined;
  }

  const pseudoNode = target.data[pseudoIndex] as PseudoSelector;
  const pulledMembers = target.data.filter((node, index) =>
    index >= location.startIndex!
    && index <= location.endIndex!
    && index !== pseudoIndex
  ) as Selector[];
  if (pulledMembers.length === 0) {
    return undefined;
  }

  const arg = pseudoNode.data.arg as Selector;
  const alternatives = isNode(arg, N.SelectorList)
    ? [...arg.data] as Selector[]
    : [arg];

  for (let i = 0; i < alternatives.length; i++) {
    const alternative = alternatives[i]!;
    if (!isNode(alternative, N.ComplexSelector)) {
      continue;
    }
    const lastIndex = getLastOrderedSelectorIndex(alternative as Selector & { data: readonly Selector[] });
    if (lastIndex === -1) {
      continue;
    }

    const lastSelector = alternative.data[lastIndex] as Selector;
    const merged = mergeCompoundMembersIntoSelector(pulledMembers, lastSelector);
    const mergedMatch = selectorMatch(find, merged);
    if (!mergedMatch.fullMatch) {
      continue;
    }

    const wrapped = wrapSelectorInIs(merged, extendWith);
    alternative.setData(lastIndex, wrapped);

    const nextData = target.data.filter((_, index) => !(index >= location.startIndex! && index <= location.endIndex! && index !== pseudoIndex));
    target.setData(nextData as any);
    return createSuccessResult(target);
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
    || (isNode(target, N.PseudoSelector) && target.data.name === ':is' && isNode(target.data.arg, N.Selector))
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
  finalize: (result: ExtendResult) => ExtendResult
): ExtendResult | undefined {
  const nestedIsAppend = tryAppendIntoNestedIsOnFullMatch(target, find, extendWith, parent);
  if (nestedIsAppend) {
    return finalize(nestedIsAppend);
  }

  const nestedDirectChild = getDirectPseudoArg(target)
    ? tryExtendDirectChildSelector(target, getDirectPseudoArg(target), find, extendWith, parent)
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
  finalize: (result: ExtendResult) => ExtendResult
): ExtendResult | undefined {
  if (!isNode(target, N.SelectorList | N.CompoundSelector | N.ComplexSelector)) {
    return undefined;
  }

  const matchedChildren: Array<{ index: number; child: Selector }> = [];
  const targetData = target.data as readonly Selector[];
  for (let i = 0; i < targetData.length; i++) {
    const child = targetData[i];
    if (!child || !isNode(child, N.Selector)) {
      continue;
    }
    if (isNode(child, N.Combinator)) {
      continue;
    }

    const childMatch = selectorMatch(find, child as Selector, parent);
    if (childMatch.crossesAmpersand) {
      continue;
    }
    if (!childMatch.fullMatch && !childMatch.partialMatch) {
      continue;
    }
    matchedChildren.push({ index: i, child: child as Selector });
  }

  if (matchedChildren.length < 2) {
    return undefined;
  }

  let crossedAmpersand = false;
  let anyChanged = false;
  for (const { index, child } of matchedChildren) {
    const childValueBefore = child.valueOf();
    let replacement: Selector | undefined;

    if (isNode(target, N.SelectorList)) {
      const result = tryExtendSelector(child, find, extendWith, true, parent);
      if (!result.error) {
        replacement = result.value;
        crossedAmpersand ||= !!result.value.hoistToRoot;
      }
    } else if (isNode(target, N.CompoundSelector)) {
      const outsideMembers = getCompoundMembersOutsideRange(
        target as Selector & { data: readonly Selector[] },
        index,
        index,
        undefined
      );
      const conflict = getCompoundConflictError(outsideMembers, extendWith);
      if (conflict) {
        return { value: target, error: conflict, isChanged: false };
      }

      if (isNode(child, N.CompoundSelector | N.ComplexSelector | N.PseudoSelector | N.SelectorList)) {
        const result = tryExtendSelector(child, find, extendWith, true, parent);
        if (!result.error) {
          replacement = result.value;
          crossedAmpersand ||= !!result.value.hoistToRoot;
        }
      } else {
        replacement = wrapSelectorInIs(child, stripRedundantCompoundContext(extendWith, outsideMembers));
      }
    } else {
      if (isNode(child, N.CompoundSelector | N.ComplexSelector | N.PseudoSelector | N.SelectorList)) {
        const result = tryExtendSelector(child, find, extendWith, true, parent);
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
    // A replacement that is the same object reference as child may still
    // represent a real change if it was mutated in-place (e.g. appendAlternative
    // pushes new items onto a SelectorList child and returns the same ref).
    if (replacement !== child || replacement.valueOf() !== childValueBefore) {
      anyChanged = true;
    }
    target.setData(index, replacement);
  }

  if (crossedAmpersand) {
    target.hoistToRoot = true;
  }

  return finalize(createSuccessResult(target, anyChanged));
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
  parent?: Selector
): ExtendResult {
  const finalize = (result: ExtendResult): ExtendResult => {
    if (!result.error && parent && result.value.hoistToRoot) {
      return createSuccessResult(materializeAmpersandsForHoist(result.value, parent));
    }
    return result;
  };

  const match = selectorMatch(find, target, parent);
  if (!partial) {
    if (!match.fullMatch) {
      return createErrorResult(target, ExtendErrorType.NOT_FOUND, 'Selector not found');
    }

    return createExactExtendResult(target, extendWith, parent, match.crossesAmpersand, finalize);
  }

  if (!match.partialMatch || match.matches.length === 0) {
    const noPartialMatchResult = tryHandleNoPartialMatch(target, find, extendWith, parent, finalize);
    if (noPartialMatchResult) {
      return noPartialMatchResult;
    }

    return createErrorResult(target, ExtendErrorType.NOT_FOUND, 'Selector not found');
  }

  const earlyDirectListAppend = tryAppendToDirectSelectorListOnFullMatch(target, find, extendWith, parent);
  if (earlyDirectListAppend) {
    return finalize(earlyDirectListAppend);
  }

  const multiDirectChildFullMatch = tryHandleMultiDirectChildFullMatches(
    target,
    find,
    extendWith,
    parent,
    finalize
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
      target.setData([...(replacement as SelectorList | ComplexSelector | CompoundSelector).data] as any);
      markTargetHoist();
      return finalize(createSuccessResult(target));
    }

    if (crossedAmpersand) {
      (replacement as Selector).hoistToRoot = true;
    }
    return finalize(createSuccessResult(replacement));
  };
  const finishStructuralChildRewrite = (
    child: Selector | undefined
  ): ExtendResult | undefined => {
    if (!child) {
      return undefined;
    }

    const nested = tryExtendSelector(child, find, extendWith, true, parent);
    if (nested.error || !replaceDirectSelectorChild(target, child, nested.value)) {
      return undefined;
    }

    markTargetHoist(!!nested.value.hoistToRoot);
    return finalize(createSuccessResult(target, nested.isChanged));
  };
  const tryHandleRootSingleSlotPartial = (): ExtendResult | undefined => {
    const rootIsOrdered = isNode(target, N.ComplexSelector) || isNode(target, N.CompoundSelector);
    if (
      !rootIsOrdered
      || location.containingNode !== target
      || location.startIndex === undefined
      || location.endIndex === undefined
      || location.startIndex !== location.endIndex
      || (
        isNode(target.data[location.startIndex] as Selector, N.CompoundSelector)
        && location.matchedIndices
        && location.matchedIndices.length > 0
      )
    ) {
      return undefined;
    }

    const compoundOutsideMembers = isNode(target, N.CompoundSelector)
      ? getCompoundMembersOutsideRange(
          target as Selector & { data: readonly Selector[] },
          location.startIndex,
          location.endIndex,
          location.matchedIndices
        )
      : undefined;

    if (isNode(target, N.CompoundSelector)) {
      const conflict = getCompoundConflictError(compoundOutsideMembers!, extendWith);
      if (conflict) {
        return { value: target, error: conflict, isChanged: false };
      }
    }

    const existing = target.data[location.startIndex] as Selector;
    const nestedIsListAppend = tryAppendToDirectSelectorListOnFullMatch(existing, find, extendWith, parent);
    if (nestedIsListAppend) {
      target.setData(location.startIndex, nestedIsListAppend.value);
      markTargetHoist(!!nestedIsListAppend.value.hoistToRoot);
      return finalize(createSuccessResult(target));
    }

    if (
      isNode(existing, N.PseudoSelector | N.SelectorList | N.CompoundSelector | N.ComplexSelector)
      && !isNode(existing, N.CompoundSelector)
    ) {
      const nested = tryExtendSelector(existing, find, extendWith, true);
      if (!nested.error) {
        target.setData(location.startIndex, nested.value);
        markTargetHoist(!!nested.value.hoistToRoot);
        return finalize(createSuccessResult(target, nested.isChanged));
      }
    }

    const wrapped = wrapSelectorInIs(existing, stripRedundantCompoundContext(extendWith, compoundOutsideMembers ?? []));
    target.setData(location.startIndex, wrapped);
    markTargetHoist();
    return finalize(createSuccessResult(target, wrapped !== existing));
  };
  const tryHandleRootMultiSlotPartial = (): ExtendResult | undefined => {
    if (
      isNode(target, N.CompoundSelector)
      && location.containingNode === target
      && location.startIndex !== undefined
      && location.endIndex !== undefined
      && location.startIndex < location.endIndex
    ) {
      const crossedAmpersandParent = getCrossedAmpersandParent(location);
      if (crossedAmpersandParent) {
        const replacement = wrapResolvedCompoundSpan(
          target as Selector & { data: readonly Selector[] },
          location.startIndex,
          location.endIndex,
          extendWith,
          crossedAmpersandParent
        );
        return finishRootReplacement(replacement, N.ComplexSelector | N.CompoundSelector);
      }

      const outsideMembers = getCompoundMembersOutsideRange(
        target as Selector & { data: readonly Selector[] },
        location.startIndex,
        location.endIndex,
        location.matchedIndices
      );
      const conflict = getCompoundConflictError(outsideMembers, extendWith);
      if (conflict) {
        return { value: target, error: conflict, isChanged: false };
      }

      const pulledIntoNestedIs = tryPullCompoundMatchIntoNestedIsBranch(target, location, find, extendWith);
      if (pulledIntoNestedIs) {
        return finalize(pulledIntoNestedIs);
      }

      const replacement = wrapCompoundMatchRange(
        target as Selector & { data: readonly Selector[] },
        location.startIndex,
        location.endIndex,
        location.matchedIndices,
        extendWith
      );
      return finishRootReplacement(replacement, N.ComplexSelector | N.CompoundSelector);
    }

    if (
      isNode(target, N.ComplexSelector)
      && location.containingNode === target
      && location.startIndex !== undefined
      && location.endIndex !== undefined
      && location.startIndex < location.endIndex
    ) {
      const crossedAmpersandParent = getCrossedAmpersandParent(location)
        ?? (crossedAmpersand ? parent : undefined);
      if (crossedAmpersandParent) {
        const replacement = wrapResolvedOrderedSpanWithTailRemainder(
          target as Selector & { data: readonly Selector[] },
          location.startIndex,
          location.endIndex,
          extendWith,
          crossedAmpersandParent,
          getLastOrderedSelector(find),
          location
        );
        if (replacement) {
          return finishRootReplacement(replacement, N.ComplexSelector);
        }
      }

      const replacement = wrapOrderedMatchRange(target as Selector & { data: readonly Selector[] }, location.startIndex, location.endIndex, extendWith);
      return finishRootReplacement(replacement, N.ComplexSelector);
    }

    return undefined;
  };
  const tryHandleDirectChildContainingNodePartial = (): ExtendResult | undefined => {
    if (location.containingNode.parent !== target) {
      return undefined;
    }

    let replacement: Selector;
    if (
      isNode(location.containingNode, N.CompoundSelector)
      && location.startIndex !== undefined
      && location.endIndex !== undefined
    ) {
      const crossedAmpersandParent = getCrossedAmpersandParent(location);
      if (crossedAmpersandParent) {
        replacement = wrapSelectorInIs(
          materializeAmpersandsForHoist(location.containingNode as Selector, crossedAmpersandParent),
          extendWith
        );
      } else {
        const pulledIntoNestedIs = tryPullCompoundMatchIntoNestedIsBranch(location.containingNode as Selector, location, find, extendWith);
        if (pulledIntoNestedIs) {
          replacement = pulledIntoNestedIs.value;
        } else {
          const conflict = getCompoundConflictError(
            getCompoundMembersOutsideRange(
              location.containingNode as Selector & { data: readonly Selector[] },
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
            location.containingNode as Selector & { data: readonly Selector[] },
            location.startIndex,
            location.endIndex,
            location.matchedIndices,
            extendWith
          );
        }
      }
    } else {
      if (isNode(target, N.CompoundSelector)) {
        const childIndex = target.data.findIndex(node => node === location.containingNode);
        if (childIndex !== -1) {
          const conflict = getCompoundConflictError(
            getCompoundMembersOutsideRange(
              target as Selector & { data: readonly Selector[] },
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

      replacement = wrapSelectorInIs(location.containingNode as Selector, extendWith);
    }

    const childChanged = replacement !== (location.containingNode as Selector);
    if (replaceDirectSelectorChild(target, location.containingNode as Selector, replacement)) {
      markTargetHoist();
      return finalize(createSuccessResult(target, childChanged));
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
        ? tryExtendDirectChildSelector(target, directIsArg, find, extendWith, parent, crossedAmpersand)
        : undefined;
      const finishedNestedIs = finishNested(nestedIsResult);
      if (finishedNestedIs) {
        return finishedNestedIs;
      }

      const nestedPseudoResult = directPseudoArg && directPseudoArg === location.containingNode
        ? tryExtendDirectChildSelector(target, location.containingNode as Selector, find, extendWith, parent, crossedAmpersand)
        : undefined;
      const finishedNestedPseudo = finishNested(nestedPseudoResult);
      if (finishedNestedPseudo) {
        return finishedNestedPseudo;
      }

      const nestedListResult = isNode(target, N.SelectorList)
        ? tryExtendDirectChildSelector(target, getSingleMatchedDirectChild(target, location), find, extendWith, parent, crossedAmpersand)
        : undefined;
      const finishedNestedList = finishNested(nestedListResult);
      if (finishedNestedList) {
        return finishedNestedList;
      }

      const nestedOrderedChildResult = (isNode(target, N.ComplexSelector) || isNode(target, N.CompoundSelector))
        ? tryExtendDirectChildSelector(target, getSingleMatchedDirectChild(target, location), find, extendWith, parent, crossedAmpersand)
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

    const nestedPseudoListAppend = tryAppendToContainingSelectorList(target, location.containingNode as Selector, extendWith);
    const finishedNestedPseudoListAppend = finishNested(nestedPseudoListAppend);
    if (finishedNestedPseudoListAppend) {
      return finishedNestedPseudoListAppend;
    }

    if (location.containingNode.parent === target) {
      if (isNode(target, N.SelectorList)) {
        const rewrittenListChild = finishStructuralChildRewrite(location.containingNode as Selector);
        if (rewrittenListChild) {
          return rewrittenListChild;
        }

        return finalize(createSuccessResult(createAlternativeSelector(target, extendWith)));
      }

      const rewrittenChild = finishStructuralChildRewrite(location.containingNode as Selector);
      if (rewrittenChild) {
        return rewrittenChild;
      }
    }
  }

  const nestedPseudoResult = directPseudoArg && directPseudoArg === location.containingNode
    ? tryExtendDirectChildSelector(target, location.containingNode as Selector, find, extendWith, parent, crossedAmpersand)
    : undefined;
  const finishedNestedPseudo = finishNested(nestedPseudoResult);
  if (finishedNestedPseudo) {
    return finishedNestedPseudo;
  }

  if (location.containingNode === target) {
    const nestedIsResult = directIsArg
      ? tryExtendDirectChildSelector(target, directIsArg, find, extendWith, parent, crossedAmpersand)
      : undefined;
    const finishedNestedIs = finishNested(nestedIsResult);
    if (finishedNestedIs) {
      return finishedNestedIs;
    }

    const nestedListResult = isNode(target, N.SelectorList)
      ? tryExtendDirectChildSelector(target, getSingleMatchedDirectChild(target, location), find, extendWith, parent, crossedAmpersand)
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
    const nested = tryExtendDirectChildSelector(target, containingChild, find, extendWith, parent, crossedAmpersand);
    const finishedNested = finishNested(nested);
    if (finishedNested) {
      return finishedNested;
    }
  }

  return createErrorResult(target, ExtendErrorType.NOT_FOUND, 'Partial extend shape not implemented yet');
}
