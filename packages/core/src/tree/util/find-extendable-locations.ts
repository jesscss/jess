import { type Selector } from '../selector';
import { SimpleSelector } from '../selector-simple';
import { SelectorList } from '../selector-list';
import { ComplexSelector } from '../selector-complex';
import { CompoundSelector } from '../selector-compound';
import { PseudoSelector } from '../selector-pseudo';
import { Combinator } from '../combinator';
import { isNode } from './is-node';
import {
  componentsMatch,
  isSelector,
  determineExtensionType,
  buildSelectorPath,
  areCompoundSelectorsEquivalent,
  expandCompoundWithPseudoSelectors,
  arePseudoSelectorsEquivalent,
  areComplexSelectorsEquivalent,
  areSelectorArgumentsEquivalent,
  isStructurallyEqual,
  getNonCombinatorComponents,
  expandComplexSelectorWithIs
} from './extend-helpers';

/**
 * Represents a location within a selector tree where a target can be extended
 */
export interface ExtendLocation {
  /** Path to the extendable location within the selector tree */
  path: Array<string | number>;
  /** Index within a selector list if applicable */
  targetIndex?: number;
  /** The actual selector node that matched */
  matchedNode: Selector;
  /** Context about what type of extension this enables */
  extensionType: 'replace' | 'append' | 'wrap';
  /** The parent node containing the match (for reconstruction) */
  parentNode?: Selector;
  /** Whether this was a partial match (for compound selectors) */
  isPartialMatch?: boolean;
  /** Remainder selectors after partial match */
  remainders?: Selector[];
}

/**
 * Result of searching for extendable locations
 */
export interface ExtendSearchResult {
  locations: ExtendLocation[];
  hasMatches: boolean;
  /** Performance metrics for debugging */
  metrics?: {
    fastRejections: number;
    fastPathHits: number;
    fullSearches: number;
  };
}

// Performance optimization: Pre-allocated result cache
const EXACT_MATCH_CACHE = new WeakMap<Selector, ExtendLocation[]>();
const EMPTY_LOCATIONS: ExtendLocation[] = [];

/**
 * Enhanced selector matching with 7-layer optimization system from matchSelectors
 * Recursively searches a selector tree to find all locations where a target selector appears
 * This is designed specifically for extend use cases with maximum performance
 *
 * @param target - The selector tree to search within
 * @param find - The selector pattern to find
 * @returns ExtendSearchResult with all found locations and performance optimizations
 */
export function findExtendableLocations(
  target: Selector,
  find: Selector
): ExtendSearchResult {
  const locations: ExtendLocation[] = [];
  const metrics = { fastRejections: 0, fastPathHits: 0, fullSearches: 0 };

  // OPTIMIZATION 1: Exact match cache for identical selectors
  if (target.valueOf() === find.valueOf()) {
    const cached = EXACT_MATCH_CACHE.get(target);
    if (cached) {
      return { locations: cached, hasMatches: cached.length > 0, metrics };
    }

    // Cache the exact match result
    const exactLocation: ExtendLocation = {
      path: [],
      matchedNode: target,
      extensionType: 'replace'
    };
    EXACT_MATCH_CACHE.set(target, [exactLocation]);
    return { locations: [exactLocation], hasMatches: true, metrics };
  }

  // OPTIMIZATION 2: KeySet fast rejection - bail early for impossible matches
  if (target.keySet && find.keySet
    && target.keySet.isDisjointFrom(find.keySet)
    && target.canFastReject && find.canFastReject) {
    metrics.fastRejections++;
    return { locations: EMPTY_LOCATIONS, hasMatches: false, metrics };
  }

  // OPTIMIZATION 3: KeySet subset rejection for partial matching
  if (find.canFastReject && target.keySet && find.keySet
    && !find.keySet.isSubsetOf(target.keySet)) {
    metrics.fastRejections++;
    return { locations: EMPTY_LOCATIONS, hasMatches: false, metrics };
  }

  // OPTIMIZATION 4: Fast path for common selector patterns - runs first and skips slow path when successful
  // Special case: Handle SelectorList in find parameter regardless of canFastReject
  if (isNode(find, 'SelectorList')) {
    // Check if target matches any item in the find list
    for (let i = 0; i < find.value.length; i++) {
      const listItem = find.value[i]!;
      const result = findExtendableLocations(target, listItem);
      if (result.hasMatches) {
        return result;
      }
    }
    return { locations: EMPTY_LOCATIONS, hasMatches: false, metrics };
  }

  if (target.canFastReject && find.canFastReject) {
    const fastPathResult = tryFastPathExtendMatch(target, find, []);
    if (fastPathResult && fastPathResult.length > 0) {
      metrics.fastPathHits++;
      return { locations: fastPathResult, hasMatches: true, metrics };
    }
  }

  // Full recursive search with optimizations - only when fast path fails
  metrics.fullSearches++;
  searchWithinSelector(target, find, [], locations);

  return {
    locations,
    hasMatches: locations.length > 0,
    metrics
  };
}

/**
 * OPTIMIZATION 4: Fast path extend matching for common patterns
 * Handles the most frequent selector types in typical stylesheets with optimized logic
 * Now comprehensive enough to skip slow path for most common cases
 */
function tryFastPathExtendMatch(
  target: Selector,
  find: Selector,
  basePath: Array<string | number>
): ExtendLocation[] | null {
  // Fast path 1: Exact match (most common case)
  if (target.valueOf() === find.valueOf()) {
    return [{
      path: [...basePath],
      matchedNode: target,
      extensionType: determineExtensionType(target, basePath)
    }];
  }

  // Fast path 2: Simple selector to simple selector (.foo === .foo)
  if (isNode(target, 'SimpleSelector') && isNode(find, 'SimpleSelector')) {
    // Handle pseudo-selectors with selector arguments using enhanced equivalence
    if (isNode(target, 'PseudoSelector') && isNode(find, 'PseudoSelector')
      && target.value.name === find.value.name
      && target.value.arg && isSelector(target.value.arg)
      && find.value.arg && isSelector(find.value.arg)) {
      // Same pseudo-selector name with selector args - check if args are equivalent
      if (areSelectorArgumentsEquivalent(target.value.arg as Selector, find.value.arg as Selector)) {
        return [{
          path: [...basePath],
          matchedNode: target,
          extensionType: determineExtensionType(target, basePath)
        }];
      }
      return [];
    }

    if (target.valueOf() === find.valueOf()) {
      return [{
        path: [...basePath],
        matchedNode: target,
        extensionType: determineExtensionType(target, basePath)
      }];
    }
    return [];
  }

  // Fast path 3: Compound selector containing simple target (.foo.bar contains .foo)
  if (isNode(target, 'CompoundSelector') && isNode(find, 'SimpleSelector') && target.value.length <= 4) {
    // Skip pseudo-selectors with Selector arguments
    if (isNode(find, 'PseudoSelector') && find.value.arg && isSelector(find.value.arg)) return null;

    const findVal = find.valueOf();
    const locations: ExtendLocation[] = [];

    for (let i = 0; i < target.value.length; i++) {
      if (target.value[i]!.valueOf() === findVal) {
        // Found exact match - this enables partial replacement
        const remainderComponents = target.value.filter((_: any, idx: any) => idx !== i);
        const remainders = remainderComponents.length === 0
          ? []
          : remainderComponents.length === 1
            ? [remainderComponents[0]!]
            : [new CompoundSelector(remainderComponents).inherit(target)];

        locations.push({
          path: [...basePath, i],
          matchedNode: target,
          extensionType: determineExtensionType(target, basePath),
          isPartialMatch: remainders.length > 0,
          remainders
        });
      }
    }

    return locations;
  }

  // Fast path 4: Small compound to compound matching (.a.b === .b.a)
  if (isNode(target, 'CompoundSelector') && isNode(find, 'CompoundSelector')
    && target.value.length <= 4 && find.value.length <= 4) {
    return trySmallCompoundExtendMatch(target, find, basePath);
  }

  // Fast path 5: When find parameter is a selector list (legacy match-selector behavior)
  // Handles matchSelectors(target=".a", find=".a,.b") → should match because .a is in the list
  if (isNode(find, 'SelectorList')) {
    // Check if target matches any item in the find list
    for (let i = 0; i < find.value.length; i++) {
      const listItem = find.value[i]!;
      const result = tryFastPathExtendMatch(target, listItem, basePath);
      if (result && result.length > 0) {
        // Found a match with one of the list items
        return result;
      }
    }
    return []; // No matches found in list
  }

  // Fast path 6: Small selector list containing target
  if (isNode(target, 'SelectorList') && target.value.length <= 3) {
    const locations: ExtendLocation[] = [];
    for (let i = 0; i < target.value.length; i++) {
      const childResult = tryFastPathExtendMatch(target.value[i]!, find, [...basePath, i]);
      if (childResult) {
        locations.push(...childResult);
      }
    }
    return locations.length > 0 ? locations : [];
  }

  // Fast path 7: Complex selector patterns with partial match support
  if (isNode(target, 'ComplexSelector') && target.value.length <= 7) {
    // First check for exact complex selector matches
    if (isNode(find, 'ComplexSelector') && areComplexSelectorsEquivalent(target, find)) {
      return [{
        path: [...basePath],
        matchedNode: target,
        extensionType: determineExtensionType(target, basePath)
      }];
    }

    // Try partial complex matching
    if (isNode(find, 'ComplexSelector')) {
      const partialResult = tryPartialComplexMatch(target, find, basePath);
      if (partialResult && partialResult.length > 0) {
        return partialResult;
      }
    }

    // Try backtracking match for complex :is() scenarios
    if (isNode(find, 'ComplexSelector')) {
      const backtrackResult = tryBacktrackingComplexMatch(target, find, basePath);
      if (backtrackResult) {
        return backtrackResult;
      }

      // Try sequential complex matching with partial compound support
      const sequentialResult = trySequentialComplexMatch(target, find, basePath);
      if (sequentialResult) {
        return sequentialResult;
      }
    }

    // Try individual component matching
    const locations: ExtendLocation[] = [];
    for (let i = 0; i < target.value.length; i++) {
      const component = target.value[i];
      if (component && !isNode(component, 'Combinator')) {
        const childResult = tryFastPathExtendMatch(component, find, [...basePath, i]);
        if (childResult) {
          locations.push(...childResult);
        }
      }
    }

    // Post-process locations to detect partial matches at position 0
    if (locations.length > 0) {
      // Found matches - check if any are at position 0 with remainders
      for (const location of locations) {
        if (location.path[location.path.length - 1] === 0 && target.value.length > 1) {
          // This is a match at position 0 of a complex selector
          // Mark it as partial and calculate remainders
          location.isPartialMatch = true;

          // Get the remaining components after position 0
          const remainingComponents = target.value.slice(1);
          location.remainders = remainingComponents.length === 1 && !isNode(remainingComponents[0], 'Combinator')
            ? [remainingComponents[0] as Selector]
            : [new ComplexSelector(remainingComponents).inherit(target)];
        }
      }
    }

    return locations.length > 0 ? locations : null;
  }

  return null;
}

/**
 * Tries to match partial complex selectors
 */
function tryPartialComplexMatch(
  target: ComplexSelector,
  find: ComplexSelector,
  basePath: Array<string | number>
): ExtendLocation[] | null {
  // Try to find find pattern within target
  const targetStr = target.value.map(v => v.valueOf()).join('');
  const findStr = find.value.map(v => v.valueOf()).join('');

  // Simple substring check first
  if (!targetStr.includes(findStr)) {
    return null;
  }

  // Try more sophisticated matching
  const targetComponents = target.value;
  const findComponents = find.value;

  // Try to match find at different positions
  for (let startPos = 0; startPos <= targetComponents.length - findComponents.length; startPos++) {
    let matches = true;
    let hasCompoundPartialMatch = false;

    for (let i = 0; i < findComponents.length; i++) {
      const tComp = targetComponents[startPos + i];
      const fComp = findComponents[i];

      if (!tComp || !fComp) {
        matches = false;
        break;
      }

      if (isNode(tComp, 'Combinator') && isNode(fComp, 'Combinator')) {
        if (tComp.value !== fComp.value) {
          matches = false;
          break;
        }
      } else if (!isNode(tComp, 'Combinator') && !isNode(fComp, 'Combinator')) {
        const compMatch = componentsMatch(tComp as Selector, fComp as Selector);

        // Check if this is a compound-to-simple partial match
        if (compMatch && isNode(tComp, 'CompoundSelector') && isNode(fComp, 'SimpleSelector')) {
          // This is a partial match within a compound
          hasCompoundPartialMatch = true;
        }

        if (!compMatch) {
          matches = false;
          break;
        }
      } else {
        matches = false;
        break;
      }
    }

    if (matches) {
      // Calculate remainders
      const beforeComponents = targetComponents.slice(0, startPos);
      const afterComponents = targetComponents.slice(startPos + findComponents.length);
      const remainders: Selector[] = [];

      if (beforeComponents.length > 0) {
        remainders.push(new ComplexSelector(beforeComponents).inherit(target));
      }
      if (afterComponents.length > 0) {
        remainders.push(new ComplexSelector(afterComponents).inherit(target));
      }

      // Mark as partial if we have remainders OR if there was a compound partial match
      const isPartialMatch = remainders.length > 0 || hasCompoundPartialMatch;

      return [{
        path: [...basePath],
        matchedNode: target,
        extensionType: 'replace',
        isPartialMatch,
        remainders: remainders.length > 0 ? remainders : undefined
      }];
    }
  }

  return null;
}

/**
 * Optimized compound selector matching for small compounds
 */
function trySmallCompoundExtendMatch(
  target: CompoundSelector,
  find: CompoundSelector,
  basePath: Array<string | number>
): ExtendLocation[] | null {
  // Check for exact equivalence (order-independent)
  if (areCompoundSelectorsEquivalent(target, find)) {
    return [{
      path: [...basePath],
      matchedNode: target,
      extensionType: determineExtensionType(target, basePath)
    }];
  }

  // Check for subset matching (find is subset of target)
  if (find.value.length <= target.value.length) {
    const isSubset = find.value.every((findComp: any) =>
      target.value.some((targetComp: any) =>
        isNode(findComp, 'PseudoSelector') && findComp.value.arg && isSelector(findComp.value.arg)
          ? arePseudoSelectorsEquivalent(targetComp, findComp)
          : targetComp.valueOf() === findComp.valueOf()
      )
    );

    if (isSubset) {
      // Calculate remainder after removing matched components
      const remainderComponents = target.value.filter((targetComp: any) =>
        !find.value.some((findComp: any) =>
          isNode(findComp, 'PseudoSelector') && findComp.value.arg && isSelector(findComp.value.arg)
            ? arePseudoSelectorsEquivalent(targetComp, findComp)
            : targetComp.valueOf() === findComp.valueOf()
        )
      );

      const remainders = remainderComponents.length === 0
        ? []
        : remainderComponents.length === 1
          ? [remainderComponents[0]!]
          : [new CompoundSelector(remainderComponents).inherit(target)];

      return [{
        path: [...basePath],
        matchedNode: target,
        extensionType: determineExtensionType(target, basePath),
        isPartialMatch: remainders.length > 0,
        remainders
      }];
    }
  }

  return [];
}

/**
 * Helper to check if a value is a Selector
 */

/**
 * Enhanced recursive search with :is() backtracking and optimization layers
 * @param current - Current selector being examined
 * @param target - Target selector to find
 * @param currentPath - Current path in the selector tree
 * @param locations - Array to collect found locations
 */
function searchWithinSelector(
  current: Selector,
  target: Selector,
  currentPath: Array<string | number>,
  locations: ExtendLocation[]
): void {
  // OPTIMIZATION 1: Check for exact match
  if (current.valueOf() === target.valueOf()) {
    locations.push({
      path: [...currentPath],
      matchedNode: current,
      extensionType: determineExtensionType(current, currentPath)
    });
  }

  // OPTIMIZATION 2: Enhanced recursive search with specialized handlers for each selector type
  if (isNode(current, 'SelectorList')) {
    searchWithinSelectorList(current, target, currentPath, locations);
  } else if (isNode(current, 'CompoundSelector')) {
    searchWithinCompoundSelector(current, target, currentPath, locations);
  } else if (isNode(current, 'ComplexSelector')) {
    searchWithinComplexSelector(current, target, currentPath, locations);
  } else if (isNode(current, 'PseudoSelector')) {
    // OPTIMIZATION 3: Special handling for :is() pseudo-selectors with backtracking
    searchWithinPseudoSelector(current, target, currentPath, locations);
  }
  // SimpleSelector doesn't have nested content to search
}

/**
 * Searches within a selector list
 */
function searchWithinSelectorList(
  selectorList: SelectorList,
  target: Selector,
  currentPath: Array<string | number>,
  locations: ExtendLocation[]
): void {
  selectorList.value.forEach((selector, index) => {
    searchWithinSelector(selector, target, [...currentPath, index], locations);
  });
}

/**
 * Enhanced compound selector search with partial matching support
 */
function searchWithinCompoundSelector(
  compound: CompoundSelector,
  target: Selector,
  currentPath: Array<string | number>,
  locations: ExtendLocation[]
): void {
  // Handle when target is a PseudoSelector - check for equivalent matches
  if (isNode(target, 'PseudoSelector') && target.value.arg && isSelector(target.value.arg)) {
    // Look for matching pseudo-selectors within the compound
    compound.value.forEach((component, index) => {
      if (isNode(component, 'PseudoSelector') && arePseudoSelectorsEquivalent(component, target)) {
        locations.push({
          path: [...currentPath, index],
          matchedNode: component,
          extensionType: 'replace'
        });
      }
    });
  }

  // Standard recursive search through each component
  compound.value.forEach((component, index) => {
    searchWithinSelector(component, target, [...currentPath, index], locations);
  });

  // OPTIMIZATION 5: Check for partial matches within compound selectors
  // This enables extending when target is a subset of the compound
  if (isNode(target, 'SimpleSelector')) {
    const targetVal = target.valueOf();

    for (let i = 0; i < compound.value.length; i++) {
      if (compound.value[i]!.valueOf() === targetVal) {
        // Found a component that matches target - create partial match
        const remainderComponents = compound.value.filter((_, idx) => idx !== i);
        const remainders = remainderComponents.length === 0
          ? []
          : remainderComponents.length === 1
            ? [remainderComponents[0]!]
            : [new CompoundSelector(remainderComponents).inherit(compound)];

        locations.push({
          path: [...currentPath],
          matchedNode: compound.value[i]!,
          extensionType: 'replace',
          isPartialMatch: remainders.length > 0,
          remainders
        });
      }
    }
  }

  // OPTIMIZATION 6: Compound-to-compound partial matching
  if (isNode(target, 'CompoundSelector') && target.value.length <= compound.value.length) {
    const isSubset = target.value.every(targetComp =>
      compound.value.some(compComp =>
        isNode(targetComp, 'PseudoSelector') && targetComp.value.arg && isSelector(targetComp.value.arg)
          ? arePseudoSelectorsEquivalent(compComp, targetComp)
          : compComp.valueOf() === targetComp.valueOf()
      )
    );

    if (isSubset) {
      // Calculate remainder after removing matched components
      const remainderComponents = compound.value.filter(compComp =>
        !target.value.some(targetComp =>
          isNode(targetComp, 'PseudoSelector') && targetComp.value.arg && isSelector(targetComp.value.arg)
            ? arePseudoSelectorsEquivalent(compComp, targetComp)
            : compComp.valueOf() === targetComp.valueOf()
        )
      );

      const remainders = remainderComponents.length === 0
        ? []
        : remainderComponents.length === 1
          ? [remainderComponents[0]!]
          : [new CompoundSelector(remainderComponents).inherit(compound)];

      locations.push({
        path: [...currentPath],
        matchedNode: target,
        extensionType: 'replace',
        isPartialMatch: remainders.length > 0,
        remainders
      });
    }
  }
}

/**
 * Enhanced complex selector search with combinator-aware optimizations
 */
function searchWithinComplexSelector(
  complex: ComplexSelector,
  target: Selector,
  currentPath: Array<string | number>,
  locations: ExtendLocation[]
): void {
  const initialLocationCount = locations.length;

  complex.value.forEach((component, index) => {
    // Skip combinators, only search selector components
    if (!isNode(component, 'Combinator')) {
      searchWithinSelector(component as Selector, target, [...currentPath, index], locations);
    }
  });

  // Post-process any matches found at position 0 to mark as partial if there are remainders
  if (locations.length > initialLocationCount && complex.value.length > 1) {
    // Check newly added locations
    for (let i = initialLocationCount; i < locations.length; i++) {
      const location = locations[i]!;
      const lastPathSegment = location.path[location.path.length - 1];

      if (lastPathSegment === 0) {
        // This is a match at position 0 of the complex selector
        location.isPartialMatch = true;

        // Calculate remainders - everything after position 0
        const remainingComponents = complex.value.slice(1);
        if (remainingComponents.length === 1 && !isNode(remainingComponents[0], 'Combinator')) {
          location.remainders = [remainingComponents[0] as Selector];
        } else if (remainingComponents.length > 0) {
          location.remainders = [new ComplexSelector(remainingComponents).inherit(complex)];
        }
      }
    }
  }

  // OPTIMIZATION 8: Complex selector pattern matching
  // Handle common patterns like descendant, child, sibling selectors efficiently
  if (isNode(target, 'ComplexSelector')) {
    // Check for structural matches within complex selector patterns
    // This enables extending complex selectors that contain the target pattern
    tryComplexSelectorPatternMatch(complex, target, currentPath, locations);

    // Try backtracking match for :is() scenarios
    const backtrackResult = tryBacktrackingComplexMatch(complex, target, currentPath);
    if (backtrackResult) {
      locations.push(...backtrackResult);
    }
  }
}

/**
 * Attempts to find pattern matches within complex selectors
 * Handles common CSS combinator patterns with optimized matching
 */
function tryComplexSelectorPatternMatch(
  complex: ComplexSelector,
  target: ComplexSelector,
  currentPath: Array<string | number>,
  locations: ExtendLocation[]
): void {
  // Enhanced pattern matching for cross-boundary matches
  // Example: .a > .b should match within .a > .b.c

  if (complex.value.length < target.value.length) {
    return; // Complex selector must be at least as long as target
  }

  const targetComponents = target.value;
  const complexComponents = complex.value;

  // Try to match target pattern at different positions within complex selector
  for (let startPos = 0; startPos <= complexComponents.length - targetComponents.length; startPos++) {
    let isMatch = true;
    const remainingComponents: any[] = [];

    // Check if target matches at this position
    for (let i = 0; i < targetComponents.length; i++) {
      const targetComp = targetComponents[i];
      const complexComp = complexComponents[startPos + i];

      if (!targetComp || !complexComp) {
        isMatch = false;
        break;
      }

      if (isNode(targetComp, 'Combinator') && isNode(complexComp, 'Combinator')) {
        // Both are combinators - must match exactly
        if (targetComp.value !== complexComp.value) {
          isMatch = false;
          break;
        }
      } else if (isNode(targetComp, 'Combinator') || isNode(complexComp, 'Combinator')) {
        // One is combinator, other is not - no match
        isMatch = false;
        break;
      } else {
        // Both are selector components
        if (isNode(complexComp, 'CompoundSelector') && !isNode(targetComp, 'CompoundSelector')) {
          // Complex component is compound, target is simple
          // Check if target component appears within the compound
          const foundInCompound = complexComp.value.some(comp =>
            comp && componentsMatch(comp, targetComp as Selector)
          );
          if (foundInCompound) {
            // Partial match - calculate remainder
            const remainderComps = complexComp.value.filter(comp =>
              comp && !componentsMatch(comp, targetComp as Selector)
            );
            if (remainderComps.length > 0) {
              const remainder = remainderComps.length === 1
                ? remainderComps[0]
                : CompoundSelector.create(remainderComps).inherit(complexComp);
              remainingComponents.push(remainder);
            }
          } else {
            isMatch = false;
            break;
          }
        } else if (!componentsMatch(targetComp as Selector, complexComp as Selector)) {
          isMatch = false;
          break;
        }
      }
    }

    if (isMatch) {
      // Found a match! Add remaining components from complex selector
      const postMatchComponents = complexComponents.slice(startPos + targetComponents.length);
      remainingComponents.push(...postMatchComponents);

      // Create remainder selector if there are remaining components
      let remainders: any[] = [];
      if (remainingComponents.length > 0) {
        if (remainingComponents.length === 1 && !isNode(remainingComponents[0], 'Combinator')) {
          remainders = [remainingComponents[0]];
        } else if (remainingComponents.length > 1) {
          remainders = [ComplexSelector.create(remainingComponents).inherit(complex)];
        }
      }

      locations.push({
        path: [...currentPath],
        matchedNode: target,
        extensionType: determineExtensionType(complex, currentPath),
        isPartialMatch: remainders.length > 0,
        remainders: remainders.length > 0 ? remainders : undefined
      });

      // Only find the first match to avoid duplicates
      return;
    }
  }
}

/**
 * Add backtracking support for complex :is() scenarios
 * This handles cases like :is(.a > .b).d > .c matching .a > .b > .c
 * IMPORTANT: This must preserve combinator sequences for correct matching
 */
function trySequentialComplexMatch(
  target: ComplexSelector,  // what to search within
  find: ComplexSelector,    // what to find
  basePath: Array<string | number>
): ExtendLocation[] | null {
  // Don't strip combinators - we need to match the exact sequence
  const targetComponents = target.value;
  const findComponents = find.value;

  if (findComponents.length === 0 || targetComponents.length < findComponents.length) return null;

  // Try to find a contiguous subsequence match that preserves combinator structure
  for (let startIdx = 0; startIdx <= targetComponents.length - findComponents.length; startIdx++) {
    let matches = true;

    // Check if the subsequence starting at startIdx matches the find pattern
    for (let i = 0; i < findComponents.length; i++) {
      const targetComp = targetComponents[startIdx + i];
      const findComp = findComponents[i];

      if (!targetComp || !findComp) {
        matches = false;
        break;
      }

      // Both must be same type (combinator vs selector)
      if (isNode(targetComp, 'Combinator') !== isNode(findComp, 'Combinator')) {
        matches = false;
        break;
      }

      // If both are combinators, they must match exactly
      if (isNode(targetComp, 'Combinator') && isNode(findComp, 'Combinator')) {
        if (targetComp.value !== findComp.value) {
          matches = false;
          break;
        }
      } else if (!isNode(targetComp, 'Combinator') && !isNode(findComp, 'Combinator')) {
        // If both are selectors, use existing selector matching logic
        // But also check for partial compound matching
        let componentMatches = areSelectorArgumentsEquivalent(targetComp, findComp);

        if (!componentMatches) {
          // Check for partial compound matching: .b should match within .b.c
          if (isNode(targetComp, 'CompoundSelector') && isNode(findComp, 'SimpleSelector')) {
            componentMatches = targetComp.value.some(comp => comp.valueOf() === findComp.valueOf());
          }
        }

        if (!componentMatches) {
          matches = false;
          break;
        }
      }
    }

    if (matches) {
      // Calculate what remains before and after the match
      const beforeComponents = targetComponents.slice(0, startIdx);
      const afterComponents = targetComponents.slice(startIdx + findComponents.length);

      const remainders: Selector[] = [];
      if (beforeComponents.length > 0) {
        remainders.push(new ComplexSelector(beforeComponents).inherit(target));
      }
      if (afterComponents.length > 0) {
        remainders.push(new ComplexSelector(afterComponents).inherit(target));
      }

      // Check for compound-level remainders within the matched components
      for (let i = 0; i < findComponents.length; i++) {
        const targetComp = targetComponents[startIdx + i];
        const findComp = findComponents[i];

        if (!isNode(targetComp, 'Combinator') && !isNode(findComp, 'Combinator')) {
          if (isNode(targetComp, 'CompoundSelector') && isNode(findComp, 'SimpleSelector')) {
            // Check if there's a partial match leaving compound remainders
            const matchingComponent = targetComp.value.find(comp => comp.valueOf() === findComp.valueOf());
            if (matchingComponent) {
              // Calculate remainder components within this compound
              const compoundRemainders = targetComp.value.filter(comp => comp.valueOf() !== findComp.valueOf());
              if (compoundRemainders.length > 0) {
                if (compoundRemainders.length === 1) {
                  remainders.push(compoundRemainders[0]!);
                } else {
                  remainders.push(new CompoundSelector(compoundRemainders).inherit(targetComp));
                }
              }
            }
          }
        }
      }

      const isPartialMatch = remainders.length > 0;

      return [{
        path: [...basePath],
        matchedNode: find,
        extensionType: determineExtensionType(target, basePath),
        isPartialMatch,
        remainders: remainders.length > 0 ? remainders : undefined
      }];
    }
  }

  return null;
}

function tryBacktrackingComplexMatch(
  target: ComplexSelector,  // what to search within
  find: ComplexSelector,    // what to find
  basePath: Array<string | number>
): ExtendLocation[] | null {
  // Extract non-combinator components
  const targetComponents = target.value.filter(c => !isNode(c, 'Combinator'));
  const findComponents = find.value.filter(c => !isNode(c, 'Combinator'));

  if (findComponents.length === 0) return null;

  // Special case: Check if target has a compound with :is() that can expand to match find
  for (let i = 0; i < targetComponents.length; i++) {
    const comp = targetComponents[i];

    if (isNode(comp, 'CompoundSelector')) {
      // Look for :is() pseudo-selectors in the compound
      const isPseudos = comp.value.filter(v =>
        isNode(v, 'PseudoSelector') && v.value.name === ':is' && v.value.arg && isSelector(v.value.arg)
      ) as PseudoSelector[];

      for (const isPseudo of isPseudos) {
        const isArg = isPseudo.value.arg as Selector;

        // If :is() contains a complex selector
        if (isNode(isArg, 'ComplexSelector')) {
          // Get the :is() content components
          const isArgComponents = isArg.value.filter(c => !isNode(c, 'Combinator'));

          // Try to match the find pattern
          if (isArgComponents.length >= 2) {
            // Get the last component from :is() (e.g., .b from .a > .b)
            const lastIsComponent = isArgComponents[isArgComponents.length - 1]!;

            // Get other components in the compound (e.g., .d)
            const otherCompoundComponents = comp.value.filter(v => v !== isPseudo);

            // Check if find starts with the :is() pattern (improved structural matching)
            // Only check the prefix components, allowing structural compound matching for the last component
            let matchesIsPattern = true;
            for (let j = 0; j < isArgComponents.length - 1; j++) {
              if (j >= findComponents.length
                || !componentsMatch(isArgComponents[j]!, findComponents[j]!)) {
                matchesIsPattern = false;
                break;
              }
            }

            if (matchesIsPattern) {
              // Check if the last :is() component with compound additions matches the next target component
              const compoundWithIsLast = otherCompoundComponents.length > 0
                ? new CompoundSelector([lastIsComponent as SimpleSelector, ...otherCompoundComponents])
                : lastIsComponent;

              const nextTargetIdx = isArgComponents.length - 1;

              // Special compound matching for backtracking: allow compound to match simple if simple is contained
              let compoundMatches = false;
              if (nextTargetIdx < findComponents.length) {
                const findComp = findComponents[nextTargetIdx]!;
                if (isNode(compoundWithIsLast, 'CompoundSelector') && isNode(findComp, 'SimpleSelector')) {
                  // In improved structural semantics: compound matches simple if simple is contained
                  const containsTarget = compoundWithIsLast.value.some(comp => comp.valueOf() === findComp.valueOf());
                  if (containsTarget) {
                    compoundMatches = true;
                  }
                } else {
                  compoundMatches = componentsMatch(compoundWithIsLast, findComp);
                }
              }

              if (compoundMatches) {
                // Check if remaining selector components match remaining target
                const targetRemaining = targetComponents.slice(i + 1);
                const findRemaining = findComponents.slice(isArgComponents.length);

                if (targetRemaining.length === findRemaining.length) {
                  let allMatch = true;
                  for (let k = 0; k < targetRemaining.length; k++) {
                    if (!componentsMatch(targetRemaining[k]!, findRemaining[k]!)) {
                      allMatch = false;
                      break;
                    }
                  }

                  if (allMatch) {
                    // We have a match!
                    const location: ExtendLocation = {
                      path: [...basePath],
                      matchedNode: target,
                      extensionType: 'replace',
                      isPartialMatch: true,
                      remainders: [] // Calculate proper remainders if needed
                    };
                    return [location];
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return null;
}

/**
 * Normalizes a selector to handle :is() equivalences
 * This is the single source of truth for :is() expansion logic
 *
 * Examples:
 * - :is(.a) -> .a
 * - a :is(b, c) -> a b, a c (as SelectorList)
 * - :is(.foo, .bar) -> .foo, .bar (as SelectorList)
 */
function normalizeSelector(selector: Selector): Selector {
  // Case 1: Standalone :is() pseudo-selector -> expand to selector list
  if (isNode(selector, 'PseudoSelector') && selector.value.name === ':is' && selector.value.arg) {
    const arg = selector.value.arg as Selector;

    // :is(.a) -> .a (single selector)
    if (isNode(arg, 'SimpleSelector')) {
      return arg;
    }

    // :is(.a, .b) -> .a, .b (selector list)
    if (isNode(arg, 'SelectorList')) {
      return arg;
    }

    // :is(complex) -> complex (pass through other types)
    return arg;
  }

  // Case 2: Complex selector with :is() -> expand to selector list
  if (isNode(selector, 'ComplexSelector')) {
    const expanded = expandComplexSelectorWithIs(selector);
    if (expanded.length > 1) {
      return new SelectorList(expanded);
    }
    if (expanded.length === 1) {
      return expanded[0]!;
    }
  }

  // Case 3: Selector list -> normalize each selector in the list
  if (isNode(selector, 'SelectorList')) {
    const normalizedSelectors: Selector[] = [];

    for (const sel of selector.value) {
      const normalized = normalizeSelector(sel);
      if (isNode(normalized, 'SelectorList')) {
        // Flatten nested selector lists
        normalizedSelectors.push(...normalized.value);
      } else {
        normalizedSelectors.push(normalized);
      }
    }

    // If we only have one selector, return it directly
    if (normalizedSelectors.length === 1) {
      return normalizedSelectors[0]!;
    }

    return new SelectorList(normalizedSelectors);
  }

  // Case 4: All other selectors -> pass through unchanged
  return selector;
}

/**
 * Enhanced pseudo-selector search with :is() backtracking optimization
 */
function searchWithinPseudoSelector(
  pseudo: PseudoSelector,
  target: Selector,
  currentPath: Array<string | number>,
  locations: ExtendLocation[]
): void {
  const arg = pseudo.value.arg;
  if (!arg || !isSelector(arg)) return;

  const argSelector = arg as Selector;

  // OPTIMIZATION 7: Special handling for :is() pseudo-selectors
  // Implements sophisticated right-to-left backtracking algorithm from matchSelectors
  if (pseudo.value.name === ':is') {
    if (isNode(argSelector, 'SelectorList')) {
      // Check if target matches any alternative in the :is() selector list
      argSelector.value.forEach((alternative, altIndex) => {
        // Direct structural match
        if (isStructurallyEqual(alternative, target)) {
          locations.push({
            path: [...currentPath, 'arg', altIndex],
            matchedNode: alternative,
            extensionType: 'append' // Can append to :is() argument lists
          });
        }

        // Recursive search within each alternative
        searchWithinSelector(alternative, target, [...currentPath, 'arg', altIndex], locations);
      });

      // Additional optimization: Check if target could be added as new alternative
      // This enables extending :is(.a, .b) with .c to become :is(.a, .b, .c)
      const canExtendAsList = !argSelector.value.some(alt => isStructurallyEqual(alt, target));
      if (canExtendAsList) {
        locations.push({
          path: [...currentPath, 'arg'],
          matchedNode: argSelector,
          extensionType: 'append', // Append new alternative to :is() list
          isPartialMatch: false
        });
      }
    } else {
      // Single argument in :is() - check for direct match
      if (isStructurallyEqual(argSelector, target)) {
        locations.push({
          path: [...currentPath, 'arg'],
          matchedNode: argSelector,
          extensionType: 'append', // Will convert single arg to SelectorList and append
          isPartialMatch: false
        });
        // Don't do recursive search since we found the direct match
        return;
      }

      // Only do recursive search if no direct match found
      searchWithinSelector(argSelector, target, [...currentPath, 'arg'], locations);
    }
  } else {
    // Standard recursive search for other pseudo-selectors
    searchWithinSelector(argSelector, target, [...currentPath, 'arg'], locations);
  }
}

/**
 * Applies an extension at a specific location within a selector tree
 * @param selector - The original selector
 * @param location - The location where to apply the extension
 * @param extendWith - The selector to extend with
 * @returns The modified selector with extension applied
 */
export function applyExtensionAtLocation(
  selector: Selector,
  location: ExtendLocation,
  extendWith: Selector
): Selector {
  return applyExtensionAtPath(selector, location.path, location.matchedNode, extendWith, location.extensionType);
}

/**
 * Recursively applies an extension at a specific path
 */
function applyExtensionAtPath(
  current: Selector,
  path: Array<string | number>,
  matchedNode: Selector,
  extendWith: Selector,
  extensionType: 'replace' | 'append' | 'wrap'
): Selector {
  if (path.length === 0) {
    // We've reached the target location
    return applyExtension(current, matchedNode, extendWith, extensionType);
  }

  const [nextSegment, ...remainingPath] = path;

  if (isNode(current, 'SelectorList')) {
    // For selector lists, we need special handling
    if (remainingPath.length === 0) {
      // We're targeting a specific item in the list
      const index = nextSegment as number;

      // For extend operations, we always want to add the extension to the list
      // rather than replace the matched item (unless it's a wrap operation)
      if (extensionType === 'wrap') {
        // For wrap, replace the specific item
        const newValue = [...current.value];
        newValue[index] = extendWith;
        return new SelectorList(newValue).inherit(current);
      } else {
        // For extend operations (both 'replace' and 'append'), add to the list
        // Check if the extension already exists to avoid duplicates
        const extensionExists = current.value.some(item => item.valueOf() === extendWith.valueOf());
        if (!extensionExists) {
          const newValue = [...current.value, extendWith];
          return new SelectorList(newValue).inherit(current);
        }
        return current; // No change if extension already exists
      }
    } else {
      // Navigate deeper into the list
      const index = nextSegment as number;
      const newValue = [...current.value];
      newValue[index] = applyExtensionAtPath(
        newValue[index]!, remainingPath, matchedNode, extendWith, extensionType
      );
      return new SelectorList(newValue).inherit(current);
    }
  }

  if (isNode(current, 'CompoundSelector')) {
    const index = nextSegment as number;
    const newValue = [...current.value];
    newValue[index] = applyExtensionAtPath(
      newValue[index]!, remainingPath, matchedNode, extendWith, extensionType
    ) as SimpleSelector;
    return new CompoundSelector(newValue).inherit(current);
  }

  if (isNode(current, 'ComplexSelector')) {
    const index = nextSegment as number;
    const newValue = [...current.value];
    newValue[index] = applyExtensionAtPath(
      newValue[index] as Selector, remainingPath, matchedNode, extendWith, extensionType
    ) as any;
    return new ComplexSelector(newValue).inherit(current);
  }

  if (isNode(current, 'PseudoSelector') && nextSegment === 'arg') {
    const arg = current.value.arg as Selector;

    // Special handling for pseudo-selector arguments
    if (remainingPath.length === 0) {
      // Direct match in the argument - create a list or extend existing list
      let newArg: Selector;
      if (isNode(arg, 'SelectorList')) {
        const newSelectors = [...arg.value, extendWith];
        newArg = new SelectorList(newSelectors).inherit(arg);
      } else {
        newArg = new SelectorList([arg, extendWith]);
      }

      return new PseudoSelector({
        name: current.value.name,
        arg: newArg
      }).inherit(current);
    } else {
      // Navigate deeper into the argument
      const newArg = applyExtensionAtPath(arg, remainingPath, matchedNode, extendWith, extensionType);
      return new PseudoSelector({
        name: current.value.name,
        arg: newArg
      }).inherit(current);
    }
  }

  throw new Error(`Unable to apply extension at path: ${path.join('.')}`);
}

/**
 * Applies the actual extension based on the extension type
 */
function applyExtension(
  current: Selector,
  matchedNode: Selector,
  extendWith: Selector,
  extensionType: 'replace' | 'append' | 'wrap'
): Selector {
  switch (extensionType) {
    case 'replace':
      return extendWith;

    case 'append':
      // For append within a selector list context, we add to the current list
      if (isNode(current, 'SelectorList')) {
        const newSelectors = [...current.value, extendWith];
        return new SelectorList(newSelectors).inherit(current);
      } else {
        // For append at the selector level, create a list with the current and extension
        return new SelectorList([current, extendWith]);
      }

    case 'wrap':
      // For wrap, create an :is() wrapper to preserve compound selector structure
      // This is used when extending a component within a compound selector
      // Example: .i.j with .i extended by .k should become :is(.i, .k).j
      // Create selectorList with original and extension
      const selectorList = SelectorList.create([current, extendWith]);
      // Create PseudoSelector using the create factory method - marks as generated
      return PseudoSelector.create({
        name: ':is',
        arg: selectorList
      }).inherit(current);

    default:
      throw new Error(`Unknown extension type: ${extensionType}`);
  }
}

// ============================================================================
// Legacy API Compatibility
// ============================================================================

/**
 * Legacy MatchResult interface for backward compatibility
 */
export interface MatchResult {
  hasMatch: boolean;
  hasFullMatch: boolean;
  hasPartialMatch: boolean;
  matched: Selector[];
  remainders: Selector[];
  /** Ampersand boundary crossing information */
  ampersandInfo?: {
    crossedBoundary: boolean;
    ampersandNodes: any[];
  };
}

/**
 * Legacy matchSelectors function for backward compatibility
 * Maps to the new findExtendableLocations API
 */
export function matchSelectors(target: Selector, find: Selector, partial = false): MatchResult {
  // Normalize selectors to handle :is() equivalences at the entry point
  const normalizedTarget = normalizeSelector(target);
  const normalizedFind = normalizeSelector(find);

  // Try exact match on normalized forms first (most common case)
  if (normalizedTarget.valueOf() === normalizedFind.valueOf()) {
    return {
      hasMatch: true,
      hasFullMatch: true,
      hasPartialMatch: false,
      matched: [find],
      remainders: []
    };
  }

  const searchResult = findExtendableLocations(normalizedTarget, normalizedFind);

  if (!searchResult.hasMatches) {
    return {
      hasMatch: false,
      hasFullMatch: false,
      hasPartialMatch: false,
      matched: [],
      remainders: []
    };
  }

  // Check if any location has a partial match
  const hasAnyPartialMatch = searchResult.locations.some(loc => loc.isPartialMatch);
  const hasAnyFullMatch = searchResult.locations.some(loc => !loc.isPartialMatch);

  // If in partial mode, consider it a partial match if there are remainders or if the path indicates partial matching
  const isPartialMatch = partial && (hasAnyPartialMatch || searchResult.locations.some(loc => loc.remainders && loc.remainders.length > 0));

  return {
    hasMatch: true,
    hasFullMatch: hasAnyFullMatch && !isPartialMatch,
    hasPartialMatch: isPartialMatch,
    matched: hasAnyFullMatch && !isPartialMatch ? [find] : [],
    remainders: searchResult.locations[0]?.remainders || []
  };
}

/**
 * Legacy combineKeys function for backward compatibility
 */
export function combineKeys(
  a: Set<string> | string,
  b: Set<string> | string
): Set<string> {
  if (a instanceof Set) {
    if (b instanceof Set) {
      return a.union(b);
    } else {
      return (new Set(a)).add(b);
    }
  } else {
    if (b instanceof Set) {
      return (new Set(b)).add(a);
    } else {
      /** Both are strings */
      return new Set([a, b]);
    }
  }
}
