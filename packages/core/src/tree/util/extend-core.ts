import type { Selector } from '../selector.js';
import { SelectorList } from '../selector-list.js';
import { CompoundSelector } from '../selector-compound.js';
import { ComplexSelector } from '../selector-complex.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { selectorMatch } from './selector-match-core.js';

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
}

/** Creates a successful extend result around the mutated or rewritten selector. */
function createSuccessResult(value: Selector): ExtendResult {
  return { value };
}

/** Creates a failed extend result while preserving the original selector. */
function createErrorResult(value: Selector, type: ExtendErrorType, message: string): ExtendResult {
  return {
    value,
    error: new ExtendError(type, message)
  };
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
  const next = extendWith.copy(true) as Selector;

  if (isNode(target, N.SelectorList)) {
    target.push(next);
    return target;
  }

  if (isNode(target, N.PseudoSelector) && target.data.name === ':is' && isNode(target.data.arg, N.Selector)) {
    const arg = target.data.arg as Selector;
    if (isNode(arg, N.SelectorList)) {
      arg.push(next);
      return target;
    }

    target.setData('arg', SelectorList.create([arg, next]).inherit(arg) as Selector);
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
 */
function wrapSelectorInIs(selector: Selector, extendWith: Selector): Selector {
  const wrapper = PseudoSelector.create({
    name: ':is',
    arg: SelectorList.create([
      selector,
      extendWith.copy(true) as Selector
    ]).inherit(selector) as Selector
  });
  wrapper.generated = true;
  return wrapper.inherit(selector) as Selector;
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
    for (const child of selector.data) {
      collectCompoundConflictInfo(child as Selector, info);
    }
    return info;
  }

  if (isNode(selector, N.ComplexSelector)) {
    for (let i = selector.data.length - 1; i >= 0; i--) {
      const child = selector.data[i] as Selector;
      if (isNode(child, N.Combinator)) {
        continue;
      }
      collectCompoundConflictInfo(child, info);
      break;
    }
    return info;
  }

  if (isNode(selector, N.PseudoSelector) && isNode(selector.data.arg, N.Selector)) {
    if (selector.data.name === ':is') {
      collectCompoundConflictInfo(selector.data.arg as Selector, info);
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
 * Normalizes a parent selector into the selector fragment that should replace a
 * crossed authored ampersand in a root complex selector.
 *
 * Selector-list parents always become generated `:is(...)` wrappers. Complex
 * parents splice directly only when they replace a leading ampersand; otherwise
 * they stay wrapped so the surrounding route shape remains valid.
 */
function getAmpersandReplacement(
  parent: Selector,
  atStart: boolean
): Selector[] {
  const parentCopy = parent.copy(true) as Selector;

  if (isNode(parentCopy, N.SelectorList)) {
    return [wrapSelectorAsGeneratedIs(parentCopy)];
  }

  if (isNode(parentCopy, N.ComplexSelector)) {
    if (atStart) {
      return [...parentCopy.data] as Selector[];
    }

    return [wrapSelectorAsGeneratedIs(parentCopy)];
  }

  return [parentCopy];
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
  const wrapped = wrapSelectorInIs(
    matched.length === 1
      ? matched[0]!
      : CompoundSelector.create(matched).inherit(targetCompound) as Selector,
    stripRedundantCompoundContext(extendWith, outsideMembers)
  );
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
    const index = parent.data.findIndex(node => node === child);
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
      const resolved = component.getResolvedSelector() ?? parent;
      if (!resolved) {
        nextData.push(component.copy(true) as Selector);
        continue;
      }
      nextData.push(...getAmpersandReplacement(resolved, i === 0));
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
 * Rewrites the sole selector argument of a root `:is(...)` pseudo by delegating
 * to `tryExtendSelector()` on that inner selector and then replacing the arg
 * through the pseudo parent.
 *
 * This is a structural rewrite step, not a fresh parent-aware search. The
 * top-level `selectorMatch()` call has already identified that the selected
 * subtree is the one that needs rewriting.
 */
function tryExtendPseudoArg(
  target: Selector,
  containingNode: Selector,
  find: Selector,
  extendWith: Selector
): ExtendResult | undefined {
  if (!(isNode(target, N.PseudoSelector) && isNode(target.data.arg, N.Selector) && target.data.arg === containingNode)) {
    return undefined;
  }

  const inner = containingNode;
  const nested = tryExtendSelector(inner, find, extendWith, true);
  if (nested.error) {
    return undefined;
  }

  target.setData('arg', nested.value);
  if (nested.value.hoistToRoot) {
    target.hoistToRoot = true;
  }
  return createSuccessResult(target);
}

/**
 * Rewrites the sole selector argument of a root `:is(...)` pseudo when the
 * matcher reports the hit on the outer pseudo itself rather than on the inner
 * arg selector.
 */
function tryExtendRootIsArg(
  target: Selector,
  find: Selector,
  extendWith: Selector
): ExtendResult | undefined {
  if (!(isNode(target, N.PseudoSelector) && target.data.name === ':is' && isNode(target.data.arg, N.Selector))) {
    return undefined;
  }

  const inner = target.data.arg as Selector;
  const nested = tryExtendSelector(inner, find, extendWith, true);
  if (nested.error) {
    return undefined;
  }

  target.setData('arg', nested.value);
  if (nested.value.hoistToRoot) {
    target.hoistToRoot = true;
  }
  return createSuccessResult(target);
}

/**
 * Rewrites one root selector-list item by delegating the partial extend to that
 * item and replacing it back through the list parent.
 *
 * Like `tryExtendIsArg()`, this only reuses local rewrite rules on the matched
 * child selector after the top-level match has already selected the list item.
 */
function tryExtendSelectorListItem(
  target: Selector,
  find: Selector,
  extendWith: Selector,
  startIndex: number | undefined,
  endIndex: number | undefined
): ExtendResult | undefined {
  if (!(isNode(target, N.SelectorList) && startIndex !== undefined && startIndex === endIndex)) {
    return undefined;
  }

  const child = target.data[startIndex] as Selector | undefined;
  if (!child) {
    return undefined;
  }

  const nested = tryExtendSelector(child, find, extendWith, true);
  if (nested.error) {
    return undefined;
  }

  target.setData(startIndex, nested.value);
  if (nested.value.hoistToRoot) {
    target.hoistToRoot = true;
  }
  return createSuccessResult(target);
}

/**
 * Attempts to extend `target` using `find` and `extendWith`.
 *
 * Exact mode adds a new alternative only when `selectorMatch()` reports a full
 * match. Partial mode wraps only genuinely partial matches; if partial mode
 * finds an exact route, it also adds a new alternative instead of generating a
 * redundant `:is(...)` wrapper.
 *
 * Put differently: before introducing a generated `:is(...)`, the rewrite
 * should first ask whether `selectorMatch()` found an exact full match route
 * for the selector being rewritten. If it did, the correct shape is a selector
 * list or an append into an existing alternate container.
 *
 * When `parent` is provided, it is passed directly into `selectorMatch()` as a
 * non-mutating implicit ampersand context. This allows extend callers to search
 * authored selectors against their resolved parent context without first
 * materializing implicit ampersand wrappers into the target tree.
 *
 * That parent-aware context is only used for the top-level match decision.
 * Nested `tryExtendSelector()` calls in this file are structural rewrite
 * helpers on already-selected child selectors; they do not re-run the match
 * against the outer parent context unless a later behavior slice explicitly
 * requires that.
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
  const match = selectorMatch(find, target, parent);
  if (!partial) {
    if (!match.fullMatch) {
      return createErrorResult(target, ExtendErrorType.NOT_FOUND, 'Selector not found');
    }

    const resolved = resolveAmpersandTarget(target, parent);
    if (resolved) {
      return createSuccessResult(createAlternativeSelector(resolved, extendWith));
    }

    return createSuccessResult(createAlternativeSelector(target, extendWith));
  }

  if (!match.partialMatch || match.matches.length === 0) {
    return createErrorResult(target, ExtendErrorType.NOT_FOUND, 'Selector not found');
  }

  const location = match.matches.find(location => location.exact && location.containingNode === target)
    ?? match.matches.find(location => location.exact)
    ?? match.matches[0]!;
  if (location.exact) {
    if (
      location.containingNode === target
      && isNode(target, N.ComplexSelector)
    ) {
      const resolved = resolveAmpersandTarget(target, parent);
      if (resolved) {
        const exactResult = createAlternativeSelector(resolved, extendWith);
        exactResult.hoistToRoot = true;
        target.hoistToRoot = true;
        return createSuccessResult(exactResult);
      }
    }

    if (location.containingNode === target) {
      const nestedIsResult = tryExtendRootIsArg(target, find, extendWith);
      if (nestedIsResult) {
        if (location.crossesAmpersand || match.crossesAmpersand) {
          target.hoistToRoot = true;
        }
        return nestedIsResult;
      }

      const nestedPseudoResult = tryExtendPseudoArg(target, location.containingNode as Selector, find, extendWith);
      if (nestedPseudoResult) {
        if (location.crossesAmpersand || match.crossesAmpersand) {
          target.hoistToRoot = true;
        }
        return nestedPseudoResult;
      }

      const nestedListResult = tryExtendSelectorListItem(
        target,
        find,
        extendWith,
        location.startIndex,
        location.endIndex
      );
      if (nestedListResult) {
        if (location.crossesAmpersand || match.crossesAmpersand) {
          target.hoistToRoot = true;
        }
        return nestedListResult;
      }

      const exactResult = createAlternativeSelector(target, extendWith);
      if (location.crossesAmpersand || match.crossesAmpersand) {
        exactResult.hoistToRoot = true;
        target.hoistToRoot = true;
      }
      return createSuccessResult(exactResult);
    }

    if (location.containingNode.parent === target) {
      const child = location.containingNode as Selector;
      const nested = tryExtendSelector(child, find, extendWith, true);
      if (!nested.error && replaceDirectSelectorChild(target, child, nested.value)) {
        if (location.crossesAmpersand || match.crossesAmpersand || nested.value.hoistToRoot) {
          target.hoistToRoot = true;
        }
        return createSuccessResult(target);
      }
    }
  }

  const nestedPseudoResult = tryExtendPseudoArg(target, location.containingNode as Selector, find, extendWith);
  if (nestedPseudoResult) {
    if (location.crossesAmpersand || match.crossesAmpersand) {
      target.hoistToRoot = true;
    }
    return nestedPseudoResult;
  }

  if (location.containingNode === target) {
    const nestedIsResult = tryExtendRootIsArg(target, find, extendWith);
    if (nestedIsResult) {
      if (location.crossesAmpersand || match.crossesAmpersand) {
        target.hoistToRoot = true;
      }
      return nestedIsResult;
    }

    const nestedListResult = tryExtendSelectorListItem(
      target,
      find,
      extendWith,
      location.startIndex,
      location.endIndex
    );
    if (nestedListResult) {
      if (location.crossesAmpersand || match.crossesAmpersand) {
        target.hoistToRoot = true;
      }
      return nestedListResult;
    }
  }

  const rootIsOrdered = isNode(target, N.ComplexSelector) || isNode(target, N.CompoundSelector);
  if (
    rootIsOrdered
    && location.containingNode === target
    && location.startIndex !== undefined
    && location.endIndex !== undefined
    && location.startIndex === location.endIndex
    && !(
      isNode(target.data[location.startIndex] as Selector, N.CompoundSelector)
      && location.matchedIndices
      && location.matchedIndices.length > 0
    )
  ) {
    if (isNode(target, N.CompoundSelector)) {
      const outsideMembers = getCompoundMembersOutsideRange(
        target as Selector & { data: readonly Selector[] },
        location.startIndex,
        location.endIndex,
        location.matchedIndices
      );
      const conflict = getCompoundConflictError(
        outsideMembers,
        extendWith
      );
      if (conflict) {
        return { value: target, error: conflict };
      }
    }

    const existing = target.data[location.startIndex] as Selector;
    const outsideMembers = isNode(target, N.CompoundSelector)
      ? getCompoundMembersOutsideRange(
        target as Selector & { data: readonly Selector[] },
        location.startIndex,
        location.endIndex,
        location.matchedIndices
      )
      : [];
    target.setData(location.startIndex, wrapSelectorInIs(existing, stripRedundantCompoundContext(extendWith, outsideMembers)));
    if (location.crossesAmpersand || match.crossesAmpersand) {
      target.hoistToRoot = true;
    }
    return createSuccessResult(target);
  }

  if (
    isNode(target, N.ComplexSelector)
    && location.containingNode === target
    && location.startIndex !== undefined
    && location.endIndex !== undefined
    && location.startIndex < location.endIndex
  ) {
    const replacement = wrapOrderedMatchRange(target as Selector & { data: readonly Selector[] }, location.startIndex, location.endIndex, extendWith);
    target.setData(replacement.data as any);
    if (location.crossesAmpersand || match.crossesAmpersand) {
      target.hoistToRoot = true;
    }
    return createSuccessResult(target);
  }

  if (location.containingNode.parent === target) {
    let replacement: Selector;
    if (
      isNode(location.containingNode, N.CompoundSelector)
      && location.startIndex !== undefined
      && location.endIndex !== undefined
    ) {
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
        return { value: target, error: conflict };
      }

      replacement = wrapCompoundMatchRange(
        location.containingNode as Selector & { data: readonly Selector[] },
        location.startIndex,
        location.endIndex,
        location.matchedIndices,
        extendWith
      );
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
            return { value: target, error: conflict };
          }
        }
      }

      replacement = wrapSelectorInIs(location.containingNode as Selector, extendWith);
    }

    if (replaceDirectSelectorChild(target, location.containingNode as Selector, replacement)) {
      if (location.crossesAmpersand || match.crossesAmpersand) {
        target.hoistToRoot = true;
      }
      return createSuccessResult(target);
    }
  }

  return createErrorResult(target, ExtendErrorType.NOT_FOUND, 'Partial extend shape not implemented yet');
}
