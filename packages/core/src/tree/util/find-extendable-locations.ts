import { type Selector } from '../selector.js';
import { SimpleSelector } from '../selector-simple.js';
import { SelectorList } from '../selector-list.js';
import { ComplexSelector } from '../selector-complex.js';
import { CompoundSelector } from '../selector-compound.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { Combinator } from '../combinator.js';
import { isNode } from './is-node.js';
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
} from './extend-helpers.js';

// Re-export findExtendableLocations and types from extend-helpers.ts to break circular dependency
export { findExtendableLocations, type ExtendLocation, type ExtendSearchResult } from './extend-helpers.js';
import { findExtendableLocations } from './extend-helpers.js';
import type { ExtendLocation } from './extend-helpers.js';

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

// Exported for extend pipeline normalization (kept as single source of truth).
export function normalizeSelectorForExtend(selector: Selector): Selector {
  return normalizeSelector(selector);
}

// ============================================================================
// Legacy API Compatibility
// ============================================================================

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
  const hasAnyPartialMatch = searchResult.locations.some((loc: ExtendLocation) => loc.isPartialMatch);
  const hasAnyFullMatch = searchResult.locations.some((loc: ExtendLocation) => !loc.isPartialMatch);

  // If in partial mode, consider it a partial match if there are remainders or if the path indicates partial matching
  const isPartialMatch = partial && (hasAnyPartialMatch || searchResult.locations.some((loc: ExtendLocation) => loc.remainders && loc.remainders.length > 0));

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
