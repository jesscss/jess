import { Selector } from '../selector.js';
import { SimpleSelector } from '../selector-simple.js';
import { SelectorList } from '../selector-list.js';
import { ComplexSelector } from '../selector-complex.js';
import { CompoundSelector } from '../selector-compound.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { Combinator } from '../combinator.js';
import { isNode } from './is-node.js';

/**
 * Helper functions for extend operations that eliminate genuine code duplication
 * These preserve all original logic while extracting commonly repeated patterns
 */

/**
 * Determines the extension type based on selector type and location context
 * Extracted from multiple places in extend.ts with preserved original logic
 */
export function determineExtensionType(
  selector: Selector,
  basePath: Array<string | number>
): 'replace' | 'append' | 'wrap' {
  // If we're inside a pseudo-selector argument (like :where() or :is())
  if (basePath.some(segment => segment === 'arg')) {
    // Check if we're matching a component within a compound selector inside the argument
    // Path format: ['arg', selectorListIndex, compoundIndex, ...]
    // If we have at least 3 segments and the last numeric segment is a compound index,
    // we should wrap to preserve compound selector structure
    const numericSegments = basePath.filter((s): s is number => typeof s === 'number');
    if (numericSegments.length >= 2) {
      // We're inside a compound selector - use 'wrap' to create :is() wrapper
      return 'wrap';
    }
    return 'append'; // Can append to pseudo-selector argument lists
  }

  // Check if we're matching a component within a compound selector
  // Path format: [compoundIndex, ...] where compoundIndex is a number
  // If the path starts with a number and we're in a compound selector context, use 'wrap'
  if (basePath.length > 0 && typeof basePath[0] === 'number') {
    // This could be a compound selector component match - check if selector is CompoundSelector
    // Actually, we can't check the selector type here, so we'll rely on the caller to set 'wrap'
    // For now, default to 'replace' for numeric paths
  }

  // If we're in a SelectorList context (not just any numeric path)
  // We need to check the context more carefully
  // Numeric paths can mean: SelectorList index, CompoundSelector index, or ComplexSelector index
  // Only SelectorList contexts should use 'append' - others should use 'replace'

  // For now, default to replace for all direct matches
  // The 'append' behavior should be handled by specialized logic in pseudo-selector handling
  return 'replace';
}

/**
 * Checks if a value can be treated as a selector
 * Extracted from multiple pseudo-selector checks
 */
export function isSelector(value: any): value is Selector {
  return value instanceof Selector;
}

/**
 * Filters components to get only non-combinator selectors
 * This pattern appears in many complex selector algorithms
 */
export function getNonCombinatorComponents(selector: ComplexSelector): Selector[] {
  return selector.value.filter(c => !isNode(c, 'Combinator')) as Selector[];
}

/**
 * Filters components to get only combinators
 * Used in complex selector matching algorithms
 */
export function getCombinatorComponents(selector: ComplexSelector): Combinator[] {
  return selector.value.filter(c => isNode(c, 'Combinator')) as Combinator[];
}

/**
 * Checks if two selectors match using component-level logic
 * Preserves the exact original matching semantics from multiple locations
 */
export function componentsMatch(a: Selector, b: Selector): boolean {
  // Exact string match first (fast path)
  if (a.valueOf() === b.valueOf()) {
    return true;
  }

  // Handle compound selector equivalence (order-independent)
  if (isNode(a, 'CompoundSelector') && isNode(b, 'CompoundSelector')) {
    return areCompoundSelectorsEquivalent(a, b);
  }

  // Handle compound vs simple: compound contains simple (improved structural matching)
  if (isNode(a, 'CompoundSelector') && isNode(b, 'SimpleSelector')) {
    return a.value.some(comp => comp.valueOf() === b.valueOf());
  }

  // Handle simple vs compound: compound contains simple (improved structural matching)
  if (isNode(a, 'SimpleSelector') && isNode(b, 'CompoundSelector')) {
    return b.value.some(comp => comp.valueOf() === a.valueOf());
  }

  // Handle pseudo-selector equivalence
  if (isNode(a, 'PseudoSelector') && isNode(b, 'PseudoSelector')) {
    return a.value.name === b.value.name
      && areSelectorArgumentsEquivalent(a.value.arg as Selector, b.value.arg as Selector);
  }

  return false;
}

/**
 * Checks pseudo-selector equivalence including argument matching
 * Handles all pseudo-selectors with selector arguments, not just specific ones
 * Extracted from find-extendable-locations.ts with preserved original logic
 */
export function arePseudoSelectorsEquivalent(a: any, b: any): boolean {
  if (!isNode(a, 'PseudoSelector') || !isNode(b, 'PseudoSelector')) return false;
  if (a.value.name !== b.value.name) return false;

  const aArg = a.value.arg;
  const bArg = b.value.arg;

  if (!aArg && !bArg) return true;
  if (!aArg || !bArg) return false;

  // If both have selector arguments, check equivalence
  if (isSelector(aArg) && isSelector(bArg)) {
    return areSelectorArgumentsEquivalent(aArg as Selector, bArg as Selector);
  }

  // For non-selector arguments, use string comparison
  return String(aArg) === String(bArg);
}

/**
 * Checks equivalence of selector arguments in pseudo-selectors
 * Preserves complex original logic for :is(), :where(), etc.
 */
export function areSelectorArgumentsEquivalent(a: Selector, b: Selector): boolean {
  // Handle selector lists (order-independent)
  if (isNode(a, 'SelectorList') && isNode(b, 'SelectorList')) {
    if (a.value.length !== b.value.length) return false;

    return a.value.every(aItem =>
      b.value.some(bItem => componentsMatch(aItem, bItem))
    );
  }

  // Handle compound selectors
  if (isNode(a, 'CompoundSelector') && isNode(b, 'CompoundSelector')) {
    return areCompoundSelectorsEquivalent(a, b);
  }

  // Default comparison
  return componentsMatch(a, b);
}

/**
 * Efficient compound selector equivalence check (order-independent)
 * Preserves exact original algorithm from find-extendable-locations.ts
 */
export function areCompoundSelectorsEquivalent(a: CompoundSelector, b: CompoundSelector): boolean {
  if (a.value.length !== b.value.length) return false;

  // Expand both compounds to handle :is() pseudo-selectors (preserving original expansion logic)
  const aExpanded = expandCompoundWithPseudoSelectors(a);
  const bExpanded = expandCompoundWithPseudoSelectors(b);

  // Check if any expanded form of a matches any expanded form of b
  return aExpanded.some(aComp =>
    bExpanded.some(bComp =>
      // All components must match
      aComp.value.length === bComp.value.length
      && aComp.value.every(aCompItem =>
        bComp.value.some(bCompItem =>
          isNode(aCompItem, 'PseudoSelector') && aCompItem.value.arg && isSelector(aCompItem.value.arg) && isNode(bCompItem, 'PseudoSelector')
            ? arePseudoSelectorsEquivalent(aCompItem, bCompItem)
            : aCompItem.valueOf() === bCompItem.valueOf()
        )
      )
    )
  );
}

/**
 * Expands compound selectors by handling :is() pseudo-selectors
 * Preserves exact original expansion algorithm - only handles :is() specially
 */
export function expandCompoundWithPseudoSelectors(compound: CompoundSelector): CompoundSelector[] {
  const expansions: CompoundSelector[] = [compound];

  // Only expand :is() pseudo-selectors (preserving original logic)
  compound.value.forEach((component, index) => {
    if (isNode(component, 'PseudoSelector') && component.value.name === ':is' && component.value.arg && isSelector(component.value.arg)) {
      const arg = component.value.arg as Selector;

      // Handle :is() with compound selector argument
      if (isNode(arg, 'CompoundSelector')) {
        // Create new expansions by replacing :is() with its contents
        const newExpansions: CompoundSelector[] = [];

        expansions.forEach((expansion: CompoundSelector) => {
          const newComponents = [...expansion.value];
          newComponents.splice(index, 1, ...arg.value); // Replace :is() with its contents
          newExpansions.push(new CompoundSelector(newComponents));
        });

        expansions.push(...newExpansions);
      } else if (isNode(arg, 'SimpleSelector')) {
        // Handle :is() with simple selector argument
        const newExpansions: CompoundSelector[] = [];

        expansions.forEach((expansion: CompoundSelector) => {
          const newComponents = [...expansion.value];
          newComponents.splice(index, 1, arg); // Replace :is() with the simple selector
          newExpansions.push(new CompoundSelector(newComponents));
        });

        expansions.push(...newExpansions);
      } else if (isNode(arg, 'SelectorList')) {
        // Handle :is() with selector list argument
        const newExpansions: CompoundSelector[] = [];

        const listArg = arg as SelectorList;
        expansions.forEach((expansion: CompoundSelector) => {
          listArg.value.forEach((listItem: Selector) => {
            const newComponents = [...expansion.value];

            if (isNode(listItem, 'CompoundSelector')) {
              newComponents.splice(index, 1, ...listItem.value);
            } else {
              newComponents.splice(index, 1, listItem as any);
            }

            newExpansions.push(new CompoundSelector(newComponents));
          });
        });

        expansions.push(...newExpansions);
      }
    }
  });

  return expansions;
}

/**
 * Expands complex selectors containing :is() pseudo-selectors into equivalent selector lists
 * This handles cases like: a :is(b, c) -> a b, a c
 */
export function expandComplexSelectorWithIs(complexSelector: ComplexSelector): Selector[] {
  // Look for :is() pseudo-selectors in the complex selector
  let hasIsSelector = false;
  let isIndex = -1;
  let isArg: Selector | null = null;

  for (let i = 0; i < complexSelector.value.length; i++) {
    const component = complexSelector.value[i];
    if (isNode(component, 'PseudoSelector') && component.value.name === ':is' && component.value.arg && isSelector(component.value.arg)) {
      hasIsSelector = true;
      isIndex = i;
      isArg = component.value.arg as Selector;
      break; // Handle first :is() found for now
    }
  }

  if (!hasIsSelector || !isArg) {
    return [complexSelector]; // No :is() found, return original
  }

  const results: ComplexSelector[] = [];

  // Get the list of alternatives from :is()
  const alternatives = isNode(isArg, 'SelectorList') ? isArg.value : [isArg];

  // For each alternative, create a new complex selector
  alternatives.forEach((alternative) => {
    const newComponents = [...complexSelector.value];
    newComponents[isIndex] = alternative as any; // Replace :is() with the alternative
    results.push(new ComplexSelector(newComponents).inherit(complexSelector));
  });

  return results;
}

/**
 * Expands any selector that might contain :is() into equivalent forms for comparison
 */
export function expandSelectorWithIs(selector: Selector): Selector[] {
  if (isNode(selector, 'ComplexSelector')) {
    return expandComplexSelectorWithIs(selector);
  }

  // For other types, check if they need expansion
  if (isNode(selector, 'CompoundSelector')) {
    const expansions = expandCompoundWithPseudoSelectors(selector);
    return expansions.length > 1 ? expansions : [selector];
  }

  return [selector]; // No expansion needed
}

/**
 * Creates a standardized path representation for selector tree navigation
 * Eliminates duplicate path building logic
 */
export function buildSelectorPath(
  basePath: Array<string | number>,
  ...segments: Array<string | number>
): Array<string | number> {
  return [...basePath, ...segments];
}

/**
 * Checks if two complex selectors are equivalent using the original algorithm
 * Preserves exact combinator and component matching logic from find-extendable-locations.ts
 */
export function areComplexSelectorsEquivalent(a: ComplexSelector, b: ComplexSelector): boolean {
  if (a.value.length !== b.value.length) return false;

  // Check each component matches
  for (let i = 0; i < a.value.length; i++) {
    const aComp = a.value[i];
    const bComp = b.value[i];

    if (!aComp || !bComp) return false;

    // Both must be same type
    if (isNode(aComp, 'Combinator') && isNode(bComp, 'Combinator')) {
      if (aComp.value !== bComp.value) return false;
    } else if (!isNode(aComp, 'Combinator') && !isNode(bComp, 'Combinator')) {
      // Both are selectors - check equivalence
      if (isNode(aComp, 'CompoundSelector') && isNode(bComp, 'CompoundSelector')) {
        if (!areCompoundSelectorsEquivalent(aComp, bComp)) return false;
      } else if (aComp.valueOf() !== bComp.valueOf()) {
        return false;
      }
    } else {
      // One is combinator, other is not
      return false;
    }
  }

  return true;
}

/**
 * Checks if two selectors are structurally equal (same type and content)
 * This is different from valueOf() comparison which might do normalization
 */
export function isStructurallyEqual(a: Selector, b: Selector): boolean {
  // For pseudo-selectors, compare name and arguments first (before basic selector check)
  if (isNode(a, 'PseudoSelector') && isNode(b, 'PseudoSelector')) {
    if (a.value.name !== b.value.name) return false;

    const aArg = a.value.arg;
    const bArg = b.value.arg;

    // Both have no args
    if (!aArg && !bArg) return true;

    // One has arg, other doesn't
    if (!aArg || !bArg) return false;

    // Both have args - compare them recursively
    if (isSelector(aArg) && isSelector(bArg)) {
      return isStructurallyEqual(aArg as Selector, bArg as Selector);
    }

    // Fallback to valueOf comparison for other arg types (non-selector nodes)
    return aArg.valueOf() === bArg.valueOf();
  }

  // For basic selectors (div, .foo, #bar) and other simple selectors, use valueOf comparison
  if (isNode(a, 'SimpleSelector') && isNode(b, 'SimpleSelector')) {
    return a.valueOf() === b.valueOf();
  }

  // For other selector types, use valueOf as fallback
  // This handles compound, complex, and selector list comparisons
  if (isNode(a, 'CompoundSelector') || isNode(a, 'ComplexSelector') || isNode(a, 'SelectorList')) {
    return a.valueOf() === b.valueOf();
  }

  // Default fallback
  return false;
}

// ============================================================================
// findExtendableLocations and dependencies (moved from find-extendable-locations.ts to break circular dependency)
// ============================================================================

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
// General search result cache: WeakMap<target, Map<find, ExtendSearchResult>>
const SEARCH_RESULT_CACHE = new WeakMap<Selector, Map<Selector, ExtendSearchResult>>();
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
  // Check general search result cache first
  let targetCache = SEARCH_RESULT_CACHE.get(target);
  if (targetCache) {
    const cached = targetCache.get(find);
    if (cached) {
      return cached;
    }
  } else {
    targetCache = new Map<Selector, ExtendSearchResult>();
    SEARCH_RESULT_CACHE.set(target, targetCache);
  }

  const locations: ExtendLocation[] = [];
  const metrics = { fastRejections: 0, fastPathHits: 0, fullSearches: 0 };

  // OPTIMIZATION 1: Exact match cache for identical selectors
  if (target.valueOf() === find.valueOf()) {
    const cached = EXACT_MATCH_CACHE.get(target);
    if (cached) {
      const result = { locations: cached, hasMatches: cached.length > 0, metrics };
      targetCache.set(find, result);
      return result;
    }

    // Cache the exact match result
    const exactLocation: ExtendLocation = {
      path: [],
      matchedNode: target,
      extensionType: 'replace'
    };
    EXACT_MATCH_CACHE.set(target, [exactLocation]);
    const result = { locations: [exactLocation], hasMatches: true, metrics };
    targetCache.set(find, result);
    return result;
  }

  // OPTIMIZATION 2: KeySet fast rejection - bail early for impossible matches
  if (target.keySet && find.keySet
    && target.keySet.isDisjointFrom(find.keySet)
    && target.canFastReject && find.canFastReject) {
    metrics.fastRejections++;
    const result = { locations: EMPTY_LOCATIONS, hasMatches: false, metrics };
    targetCache.set(find, result);
    return result;
  }

  // OPTIMIZATION 3: KeySet subset rejection for partial matching
  if (find.canFastReject && target.keySet && find.keySet
    && !find.keySet.isSubsetOf(target.keySet)) {
    metrics.fastRejections++;
    const result = { locations: EMPTY_LOCATIONS, hasMatches: false, metrics };
    targetCache.set(find, result);
    return result;
  }

  // OPTIMIZATION 4: Fast path for common selector patterns - runs first and skips slow path when successful
  // Special case: Handle SelectorList in find parameter regardless of canFastReject
  if (isNode(find, 'SelectorList')) {
    // Check if target matches any item in the find list
    for (let i = 0; i < find.value.length; i++) {
      const listItem = find.value[i]!;
      const result = findExtendableLocations(target, listItem);
      if (result.hasMatches) {
        targetCache.set(find, result);
        return result;
      }
    }
    const result = { locations: EMPTY_LOCATIONS, hasMatches: false, metrics };
    targetCache.set(find, result);
    return result;
  }

  if (target.canFastReject && find.canFastReject) {
    const fastPathResult = tryFastPathExtendMatch(target, find, []);
    if (fastPathResult && fastPathResult.length > 0) {
      metrics.fastPathHits++;
      const result = { locations: fastPathResult, hasMatches: true, metrics };
      targetCache.set(find, result);
      return result;
    }
  }

  // Full recursive search with optimizations - only when fast path fails
  metrics.fullSearches++;
  searchWithinSelector(target, find, [], locations);

  const result = {
    locations,
    hasMatches: locations.length > 0,
    metrics
  };
  targetCache.set(find, result);
  return result;
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
        // Use unique path with component index to distinguish duplicate components
        const remainderComponents = compound.value.filter((_, idx) => idx !== i);
        const remainders = remainderComponents.length === 0
          ? []
          : remainderComponents.length === 1
            ? [remainderComponents[0]!]
            : [new CompoundSelector(remainderComponents).inherit(compound)];

        locations.push({
          path: [...currentPath, i],
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
