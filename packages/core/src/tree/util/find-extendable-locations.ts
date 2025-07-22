import { type Selector } from '../selector';
import { SimpleSelector } from '../selector-simple';
import { SelectorList } from '../selector-list';
import { ComplexSelector } from '../selector-complex';
import { CompoundSelector } from '../selector-compound';
import { PseudoSelector } from '../selector-pseudo';
import { Combinator } from '../combinator';
import { isNode } from './is-node';

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
 * @param selector - The selector tree to search within
 * @param target - The target selector to find
 * @returns ExtendSearchResult with all found locations and performance optimizations
 */
export function findExtendableLocations(
  selector: Selector,
  target: Selector
): ExtendSearchResult {
  const locations: ExtendLocation[] = [];
  const metrics = { fastRejections: 0, fastPathHits: 0, fullSearches: 0 };

  // OPTIMIZATION 1: Exact match cache for identical selectors
  if (selector.valueOf() === target.valueOf()) {
    const cached = EXACT_MATCH_CACHE.get(selector);
    if (cached) {
      return { locations: cached, hasMatches: cached.length > 0, metrics };
    }

    // Cache the exact match result
    const exactLocation: ExtendLocation = {
      path: [],
      matchedNode: selector,
      extensionType: 'replace'
    };
    EXACT_MATCH_CACHE.set(selector, [exactLocation]);
    return { locations: [exactLocation], hasMatches: true, metrics };
  }

  // OPTIMIZATION 2: KeySet fast rejection - bail early for impossible matches
  if (selector.keySet && target.keySet
    && selector.keySet.isDisjointFrom(target.keySet)
    && selector.canFastReject && target.canFastReject) {
    metrics.fastRejections++;
    return { locations: EMPTY_LOCATIONS, hasMatches: false, metrics };
  }

  // OPTIMIZATION 3: KeySet subset rejection for partial matching
  if (target.canFastReject && selector.keySet && target.keySet
    && !target.keySet.isSubsetOf(selector.keySet)) {
    metrics.fastRejections++;
    return { locations: EMPTY_LOCATIONS, hasMatches: false, metrics };
  }

  // OPTIMIZATION 4: Fast path for common selector patterns - runs first and skips slow path when successful
  if (selector.canFastReject && target.canFastReject) {
    const fastPathResult = tryFastPathExtendMatch(selector, target, []);
    if (fastPathResult && fastPathResult.length > 0) {
      metrics.fastPathHits++;
      return { locations: fastPathResult, hasMatches: true, metrics };
    }
  }

  // Full recursive search with optimizations - only when fast path fails
  metrics.fullSearches++;
  searchWithinSelector(selector, target, [], locations);

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
  selector: Selector,
  target: Selector,
  basePath: Array<string | number>
): ExtendLocation[] | null {
  // Fast path 1: Exact structural match (most common case)
  if (isStructurallyEqual(selector, target)) {
    return [{
      path: [...basePath],
      matchedNode: selector,
      extensionType: determineExtensionType(selector, basePath)
    }];
  }

  // Fast path 2: Simple selector to simple selector (.foo === .foo)
  if (isNode(selector, 'SimpleSelector') && isNode(target, 'SimpleSelector')) {
    // Skip pseudo-selectors with Selector arguments - they need special handling
    if (isNode(selector, 'PseudoSelector') && selector.value.arg && isSelector(selector.value.arg)) return null;
    if (isNode(target, 'PseudoSelector') && target.value.arg && isSelector(target.value.arg)) return null;

    if (selector.valueOf() === target.valueOf()) {
      return [{
        path: [...basePath],
        matchedNode: selector,
        extensionType: determineExtensionType(selector, basePath)
      }];
    }
    return [];
  }

  // Fast path 3: Compound selector containing simple target (.foo.bar contains .foo)
  if (isNode(selector, 'CompoundSelector') && isNode(target, 'SimpleSelector') && selector.value.length <= 4) {
    // Skip pseudo-selectors with Selector arguments
    if (isNode(target, 'PseudoSelector') && target.value.arg && isSelector(target.value.arg)) return null;

    const targetVal = target.valueOf();
    const locations: ExtendLocation[] = [];

    for (let i = 0; i < selector.value.length; i++) {
      if (selector.value[i]!.valueOf() === targetVal) {
        // Found exact match - this enables partial replacement
        const remainderComponents = selector.value.filter((_, idx) => idx !== i);
        const remainders = remainderComponents.length === 0
          ? []
          : remainderComponents.length === 1
            ? [remainderComponents[0]!]
            : [new CompoundSelector(remainderComponents).inherit(selector)];

        locations.push({
          path: [...basePath, i],
          matchedNode: target,
          extensionType: determineExtensionType(selector, basePath),
          isPartialMatch: remainders.length > 0,
          remainders
        });
      }
    }

    return locations;
  }

  // Fast path 4: Small compound to compound matching (.a.b === .b.a)
  if (isNode(selector, 'CompoundSelector') && isNode(target, 'CompoundSelector')
    && selector.value.length <= 4 && target.value.length <= 4) {
    return trySmallCompoundExtendMatch(selector, target, basePath);
  }

  // Fast path 5: Small selector list containing target
  if (isNode(selector, 'SelectorList') && selector.value.length <= 3) {
    const locations: ExtendLocation[] = [];
    for (let i = 0; i < selector.value.length; i++) {
      const childResult = tryFastPathExtendMatch(selector.value[i]!, target, [...basePath, i]);
      if (childResult) {
        locations.push(...childResult);
      }
    }
    return locations.length > 0 ? locations : [];
  }

  // Fast path 6: Simple complex selector patterns (.a > .b)
  if (isNode(selector, 'ComplexSelector') && selector.value.length <= 3) {
    const locations: ExtendLocation[] = [];
    for (let i = 0; i < selector.value.length; i++) {
      const component = selector.value[i];
      if (component && !isNode(component, 'Combinator')) {
        const childResult = tryFastPathExtendMatch(component, target, [...basePath, i]);
        if (childResult) {
          locations.push(...childResult);
        }
      }
    }
    return locations.length > 0 ? locations : [];
  }

  return null;
}

/**
 * Optimized compound selector matching for small compounds
 */
function trySmallCompoundExtendMatch(
  selector: CompoundSelector,
  target: CompoundSelector,
  basePath: Array<string | number>
): ExtendLocation[] | null {
  // Check for exact equivalence (order-independent)
  if (areCompoundSelectorsEquivalent(selector, target)) {
    return [{
      path: [...basePath],
      matchedNode: selector,
      extensionType: determineExtensionType(selector, basePath)
    }];
  }

  // Check for subset matching (target is subset of selector)
  if (target.value.length <= selector.value.length) {
    const isSubset = target.value.every(targetComp =>
      selector.value.some(selectorComp =>
        // Handle pseudo-selectors with Selector arguments properly
        isNode(targetComp, 'PseudoSelector') && targetComp.value.arg && isSelector(targetComp.value.arg)
          ? isStructurallyEqual(selectorComp, targetComp)
          : selectorComp.valueOf() === targetComp.valueOf()
      )
    );

    if (isSubset) {
      // Calculate remainder after removing matched components
      const remainderComponents = selector.value.filter(selectorComp =>
        !target.value.some(targetComp =>
          isNode(targetComp, 'PseudoSelector') && targetComp.value.arg && isSelector(targetComp.value.arg)
            ? isStructurallyEqual(selectorComp, targetComp)
            : selectorComp.valueOf() === targetComp.valueOf()
        )
      );

      const remainders = remainderComponents.length === 0
        ? []
        : remainderComponents.length === 1
          ? [remainderComponents[0]!]
          : [new CompoundSelector(remainderComponents).inherit(selector)];

      return [{
        path: [...basePath],
        matchedNode: target,
        extensionType: determineExtensionType(selector, basePath),
        isPartialMatch: remainders.length > 0,
        remainders
      }];
    }
  }

  return [];
}

/**
 * Efficient compound selector equivalence check (order-independent)
 */
function areCompoundSelectorsEquivalent(a: CompoundSelector, b: CompoundSelector): boolean {
  if (a.value.length !== b.value.length) return false;

  // For small compounds, use optimized O(n²) check
  return a.value.every(aComp =>
    b.value.some(bComp =>
      // Handle pseudo-selectors with Selector arguments
      isNode(aComp, 'PseudoSelector') && aComp.value.arg && isSelector(aComp.value.arg)
        ? isStructurallyEqual(aComp, bComp)
        : aComp.valueOf() === bComp.valueOf()
    )
  );
}

/**
 * Helper to check if a value is a Selector
 */
function isSelector(value: any): boolean {
  return value && typeof value === 'object' && 'valueOf' in value && 'isSelector' in value;
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
  // OPTIMIZATION 1: Check for exact structural match
  if (isStructurallyEqual(current, target)) {
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
          ? isStructurallyEqual(compComp, targetComp)
          : compComp.valueOf() === targetComp.valueOf()
      )
    );

    if (isSubset) {
      // Calculate remainder after removing matched components
      const remainderComponents = compound.value.filter(compComp =>
        !target.value.some(targetComp =>
          isNode(targetComp, 'PseudoSelector') && targetComp.value.arg && isSelector(targetComp.value.arg)
            ? isStructurallyEqual(compComp, targetComp)
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
  complex.value.forEach((component, index) => {
    // Skip combinators, only search selector components
    if (!isNode(component, 'Combinator')) {
      searchWithinSelector(component as Selector, target, [...currentPath, index], locations);
    }
  });

  // OPTIMIZATION 8: Complex selector pattern matching
  // Handle common patterns like descendant, child, sibling selectors efficiently
  if (isNode(target, 'ComplexSelector')) {
    // Check for structural matches within complex selector patterns
    // This enables extending complex selectors that contain the target pattern
    tryComplexSelectorPatternMatch(complex, target, currentPath, locations);
  }
}

/**
 * Attempts to find pattern matches within complex selectors
 * Handles common CSS combinator patterns with optimized matching
 */
/**
 * Enhanced complex selector pattern matching with cross-boundary support
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
            comp && isStructurallyEqual(comp, targetComp)
          );
          if (foundInCompound) {
            // Partial match - calculate remainder
            const remainderComps = complexComp.value.filter(comp =>
              comp && !isStructurallyEqual(comp, targetComp)
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
        } else if (!isStructurallyEqual(targetComp as Selector, complexComp as Selector)) {
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
  if (pseudo.value.name === ':is' && isNode(argSelector, 'SelectorList')) {
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
    // Standard recursive search for other pseudo-selectors
    searchWithinSelector(argSelector, target, [...currentPath, 'arg'], locations);
  }
}

/**
 * Checks if two selectors are structurally equal (same type and content)
 * This is different from valueOf() comparison which might do normalization
 */
function isStructurallyEqual(a: Selector, b: Selector): boolean {
  // Quick check: if they're the exact same object reference
  if (a === b) return true;

  // Check if they're the same node type
  if (a.type !== b.type) return false;

  // For simple selectors, use valueOf comparison
  if (isNode(a, 'SimpleSelector') && isNode(b, 'SimpleSelector')) {
    return a.valueOf() === b.valueOf();
  }

  // For pseudo-selectors, compare name and arguments
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

    // Fallback to string comparison for other arg types
    return String(aArg) === String(bArg);
  }

  // For other selector types, use valueOf as fallback
  // This handles compound, complex, and selector list comparisons
  if (isNode(a, 'CompoundSelector') || isNode(a, 'ComplexSelector') || isNode(a, 'SelectorList')) {
    return a.valueOf() === b.valueOf();
  }

  // Default fallback
  return false;
}

/**
 * Determines the appropriate extension type based on the match location
 */
function determineExtensionType(
  matchedNode: Selector,
  path: Array<string | number>
): 'replace' | 'append' | 'wrap' {
  // If we're inside a pseudo-selector argument (like :where() or :is())
  if (path.some(segment => segment === 'arg')) {
    return 'append'; // Can append to pseudo-selector argument lists
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
 * Applies an extension at a specific location within a selector tree
 *
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
      // For now, treat wrap the same as append
      // This could be enhanced for specific wrapping scenarios
      return new SelectorList([current, extendWith]);

    default:
      throw new Error(`Unknown extension type: ${extensionType}`);
  }
}
