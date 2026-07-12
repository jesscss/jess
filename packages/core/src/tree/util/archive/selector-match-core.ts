import { Selector } from '../selector.js';
import { SimpleSelector } from '../selector-simple.js';
import { SelectorList } from '../selector-list.js';
import { ComplexSelector } from '../selector-complex.js';
import { CompoundSelector } from '../selector-compound.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { Ampersand } from '../ampersand.js';
import { Combinator } from '../combinator.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
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
  // Avoid `instanceof` (module identity can diverge under Vite/Vitest).
  // All selector nodes set `isSelector = true` on the base Selector class.
  return !!value && typeof value === 'object' && (value as any).isSelector === true;
}

/**
 * Filters components to get only non-combinator selectors
 * This pattern appears in many complex selector algorithms
 */
export function getNonCombinatorComponents(selector: ComplexSelector): Selector[] {
  return selector.data.filter(c => !isNode(c, N.Combinator)) as Selector[];
}

/**
 * Filters components to get only combinators
 * Used in complex selector matching algorithms
 */
export function getCombinatorComponents(selector: ComplexSelector): Combinator[] {
  return selector.data.filter(c => isNode(c, N.Combinator)) as Combinator[];
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
  if (isNode(a, N.CompoundSelector) && isNode(b, N.CompoundSelector)) {
    return areCompoundSelectorsEquivalent(a, b);
  }

  // Handle compound vs simple: compound contains simple (improved structural matching)
  if (isNode(a, N.CompoundSelector) && isNode(b, N.SimpleSelector)) {
    return a.data.some(comp => comp.valueOf() === b.valueOf());
  }

  // Handle simple vs compound: compound contains simple (improved structural matching)
  if (isNode(a, N.SimpleSelector) && isNode(b, N.CompoundSelector)) {
    return b.data.some(comp => comp.valueOf() === a.valueOf());
  }

  // Handle pseudo-selector equivalence
  if (isNode(a, N.PseudoSelector) && isNode(b, N.PseudoSelector)) {
    return a.data.name === b.data.name
      && areSelectorArgumentsEquivalent(a.data.arg as Selector, b.data.arg as Selector);
  }

  return false;
}

/**
 * Compound component semantic equivalence — pointer-based, no object creation.
 *
 * Walks the existing AST structure to answer "can `find` occupy this position in `target`?"
 * without expanding or rewriting either selector.
 *
 * Rules (mirrors the walk-and-consume algorithm):
 *  - Direct match: find.valueOf() === target.valueOf()
 *  - find is :is(...): any ONE alternative of find matches target  (find provides alternatives)
 *  - target is :is(...): any ONE alternative of target matches find (target provides alternatives)
 *  - Both are non-:is() pseudo-selectors: delegate to arePseudoSelectorsEquivalent
 */
export function compoundComponentMatches(find: Selector, target: Selector): boolean {
  // Fast path
  if (find.valueOf() === target.valueOf()) {
    return true;
  }

  // find is :is(...) — walk its alternatives without creating new structures
  if (isNode(find, N.PseudoSelector) && find.data.name === ':is' && find.data.arg && isSelector(find.data.arg)) {
    const arg = find.data.arg as Selector;
    if (isNode(arg, N.SelectorList)) {
      return arg.data.some((alt: Selector) => compoundComponentMatches(alt, target));
    }
    return compoundComponentMatches(arg, target);
  }

  // target is :is(...) — walk its alternatives
  if (isNode(target, N.PseudoSelector) && target.data.name === ':is' && target.data.arg && isSelector(target.data.arg)) {
    const arg = target.data.arg as Selector;
    if (isNode(arg, N.SelectorList)) {
      return arg.data.some((alt: Selector) => compoundComponentMatches(find, alt));
    }
    return compoundComponentMatches(find, arg);
  }

  // Both are non-:is() pseudo-selectors
  if (isNode(find, N.PseudoSelector) && find.data.arg && isSelector(find.data.arg) && isNode(target, N.PseudoSelector)) {
    return arePseudoSelectorsEquivalent(find, target);
  }

  return false;
}

/**
 * Checks pseudo-selector equivalence including argument matching
 * Handles all pseudo-selectors with selector arguments, not just specific ones
 * Extracted from find-extendable-locations.ts with preserved original logic
 */
export function arePseudoSelectorsEquivalent(a: any, b: any): boolean {
  if (!isNode(a, N.PseudoSelector) || !isNode(b, N.PseudoSelector)) {
    return false;
  }
  if (a.data.name !== b.data.name) {
    return false;
  }

  const aArg = a.data.arg;
  const bArg = b.data.arg;

  if (!aArg && !bArg) {
    return true;
  }
  if (!aArg || !bArg) {
    return false;
  }

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
  if (isNode(a, N.SelectorList) && isNode(b, N.SelectorList)) {
    if (a.data.length !== b.data.length) {
      return false;
    }

    return a.data.every(aItem =>
      b.data.some(bItem => componentsMatch(aItem, bItem))
    );
  }

  // Handle compound selectors
  if (isNode(a, N.CompoundSelector) && isNode(b, N.CompoundSelector)) {
    return areCompoundSelectorsEquivalent(a, b);
  }

  // Default comparison
  return componentsMatch(a, b);
}

/**
 * Efficient compound selector equivalence check (order-independent)
 * Preserves exact original algorithm from find-extendable-locations.ts
 */
/**
 * True when find's components appear in target in order (subsequence). Enables .a.c.b to match .a.b.
 */
function compoundContainsCompoundSubsequence(target: CompoundSelector, find: CompoundSelector): boolean {
  if (find.data.length > target.data.length) {
    return false;
  }
  const eq = (t: Selector, f: Selector) => compoundComponentMatches(f, t);
  let tIdx = 0;
  for (const fComp of find.data) {
    let found = false;
    while (tIdx < target.data.length) {
      if (eq(target.data[tIdx]!, fComp)) {
        tIdx++;
        found = true;
        break;
      }
      tIdx++;
    }
    if (!found) {
      return false;
    }
  }
  return true;
}

export function areCompoundSelectorsEquivalent(a: CompoundSelector, b: CompoundSelector): boolean {
  if (a.data.length !== b.data.length) {
    return false;
  }

  // Order-independent component matching: two compounds are equivalent if they have the same
  // multiset of components. Components are small (typically 2-5), so O(N²) is fine.
  // Uses compoundComponentMatches for :is()-aware pointer walk — no object creation.
  return a.data.every(aComp =>
    b.data.some(bComp => compoundComponentMatches(aComp as Selector, bComp as Selector))
  );
}

/**
 * Expands compound selectors by handling :is() pseudo-selectors
 * Preserves exact original expansion algorithm - only handles :is() specially
 */
export function expandCompoundWithPseudoSelectors(compound: CompoundSelector): CompoundSelector[] {
  const expansions: CompoundSelector[] = [compound];

  // Only expand :is() pseudo-selectors (preserving original logic)
  compound.data.forEach((component, index) => {
    if (isNode(component, N.PseudoSelector) && component.data.name === ':is' && component.data.arg && isSelector(component.data.arg)) {
      const arg = component.data.arg as Selector;

      // Handle :is() with compound selector argument
      if (isNode(arg, N.CompoundSelector)) {
        // Create new expansions by replacing :is() with its contents
        const newExpansions: CompoundSelector[] = [];

        expansions.forEach((expansion: CompoundSelector) => {
          const newComponents = [...expansion.data];
          newComponents.splice(index, 1, ...arg.data); // Replace :is() with its contents
          newExpansions.push(new CompoundSelector(newComponents));
        });

        expansions.push(...newExpansions);
      } else if (isNode(arg, N.SimpleSelector)) {
        // Handle :is() with simple selector argument
        const newExpansions: CompoundSelector[] = [];

        expansions.forEach((expansion: CompoundSelector) => {
          const newComponents = [...expansion.data];
          newComponents.splice(index, 1, arg); // Replace :is() with the simple selector
          newExpansions.push(new CompoundSelector(newComponents));
        });

        expansions.push(...newExpansions);
      } else if (isNode(arg, N.SelectorList)) {
        // Handle :is() with selector list argument
        const newExpansions: CompoundSelector[] = [];

        const listArg = arg as SelectorList;
        expansions.forEach((expansion: CompoundSelector) => {
          listArg.data.forEach((listItem: Selector) => {
            const newComponents = [...expansion.data];

            if (isNode(listItem, N.CompoundSelector)) {
              newComponents.splice(index, 1, ...listItem.data);
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
  let isFromBareIsCompound = false;
  let isFromAmpersandSelector = false;

  for (let i = 0; i < complexSelector.data.length; i++) {
    const component = complexSelector.data[i];
    if (isNode(component, N.PseudoSelector) && component.data.name === ':is' && component.data.arg && isSelector(component.data.arg)) {
      hasIsSelector = true;
      isIndex = i;
      isArg = component.data.arg as Selector;
      break; // Handle first :is() found for now
    }
    // Also support the common case where `:is(...)` is wrapped in a single-item CompoundSelector
    // (e.g. `:is(.a, .b) .c`) so matching can expand alternatives.
    if (isNode(component, N.CompoundSelector) && component.data.length === 1) {
      const only = component.data[0]!;
      if (isNode(only, N.PseudoSelector) && only.data.name === ':is' && only.data.arg && isSelector(only.data.arg)) {
        hasIsSelector = true;
        isIndex = i;
        isArg = only.data.arg as Selector;
        isFromBareIsCompound = true;
        break; // Handle first :is() found for now
      }
    }
    // Also support the case where `:is(...)` is carried inside an implicit ampersand's resolved selector.
    // This shows up as a ComplexSelector beginning with Ampersand(selector=:is(...)).
    if (isNode(component, N.Ampersand)) {
      const sel = (component as Ampersand).getResolvedSelector();
      if (sel && isNode(sel, N.PseudoSelector) && sel.data.name === ':is' && sel.data.arg && isSelector(sel.data.arg)) {
        hasIsSelector = true;
        isIndex = i;
        isArg = sel.data.arg as Selector;
        isFromAmpersandSelector = true;
        break;
      }
      if (sel && isNode(sel, N.CompoundSelector) && sel.data.length === 1) {
        const only = sel.data[0]!;
        if (isNode(only, N.PseudoSelector) && only.data.name === ':is' && only.data.arg && isSelector(only.data.arg)) {
          hasIsSelector = true;
          isIndex = i;
          isArg = only.data.arg as Selector;
          isFromAmpersandSelector = true;
          break;
        }
      }
    }
  }

  if (!hasIsSelector || !isArg) {
    return [complexSelector]; // No :is() found, return original
  }

  const results: ComplexSelector[] = [];

  // Get the list of alternatives from :is()
  const alternatives = isNode(isArg, N.SelectorList) ? isArg.data : [isArg];

  // For each alternative, create a new complex selector
  alternatives.forEach((alternative) => {
    const newComponents = [...complexSelector.data];
    if (isFromAmpersandSelector) {
      // Inline the resolved alternative directly so we do not reintroduce synthetic
      // ampersand nodes while expanding match candidates.
      if (isNode(alternative, N.ComplexSelector)) {
        newComponents.splice(isIndex, 1, ...alternative.data);
      } else {
        newComponents[isIndex] = alternative as any;
      }
    } else if (isFromBareIsCompound) {
      // The original `:is(...)` lived inside a CompoundSelector position. Replace that slot with the
      // alternative selector's components where possible.
      if (isNode(alternative, N.ComplexSelector)) {
        newComponents.splice(isIndex, 1, ...alternative.data);
      } else {
        newComponents[isIndex] = alternative as any;
      }
    } else {
      newComponents[isIndex] = alternative as any; // Replace :is() with the alternative
    }
    results.push(new ComplexSelector(newComponents).inherit(complexSelector));
  });

  return results;
}

/**
 * Expands any selector that might contain :is() into equivalent forms for comparison
 */
export function expandSelectorWithIs(selector: Selector): Selector[] {
  if (isNode(selector, N.ComplexSelector)) {
    return expandComplexSelectorWithIs(selector);
  }

  // For other types, check if they need expansion
  if (isNode(selector, N.CompoundSelector)) {
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
  if (a.data.length !== b.data.length) {
    return false;
  }

  // Check each component matches
  for (let i = 0; i < a.data.length; i++) {
    const aComp = a.data[i];
    const bComp = b.data[i];

    if (!aComp || !bComp) {
      return false;
    }

    // Both must be same type
    if (isNode(aComp, N.Combinator) && isNode(bComp, N.Combinator)) {
      if (aComp.data !== bComp.data) {
        return false;
      }
    } else if (!isNode(aComp, N.Combinator) && !isNode(bComp, N.Combinator)) {
      // Both are selectors - check equivalence
      if (isNode(aComp, N.CompoundSelector) && isNode(bComp, N.CompoundSelector)) {
        if (!areCompoundSelectorsEquivalent(aComp, bComp)) {
          return false;
        }
      } else if (isNode(aComp, N.PseudoSelector) && aComp.data.name === ':is' && aComp.data.arg && isSelector(aComp.data.arg)) {
        // Allow `:is(.a, .b)` to match `.a` (or any selector in its arg list) for complex selector equivalence.
        const arg = aComp.data.arg as Selector;
        if (isNode(arg, N.SelectorList)) {
          const matchesAny = arg.data.some(sel => sel.valueOf() === bComp.valueOf());
          if (!matchesAny) {
            return false;
          }
        } else {
          if (arg.valueOf() !== bComp.valueOf()) {
            return false;
          }
        }
      } else if (isNode(bComp, N.PseudoSelector) && bComp.data.name === ':is' && bComp.data.arg && isSelector(bComp.data.arg)) {
        // Symmetric case: allow `.a` to match `:is(.a, .b)`
        const arg = bComp.data.arg as Selector;
        if (isNode(arg, N.SelectorList)) {
          const matchesAny = arg.data.some(sel => sel.valueOf() === aComp.valueOf());
          if (!matchesAny) {
            return false;
          }
        } else {
          if (arg.valueOf() !== aComp.valueOf()) {
            return false;
          }
        }
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
  if (isNode(a, N.PseudoSelector) && isNode(b, N.PseudoSelector)) {
    if (a.data.name !== b.data.name) {
      return false;
    }

    const aArg = a.data.arg;
    const bArg = b.data.arg;

    // Both have no args
    if (!aArg && !bArg) {
      return true;
    }

    // One has arg, other doesn't
    if (!aArg || !bArg) {
      return false;
    }

    // Both have args - compare them recursively
    if (isSelector(aArg) && isSelector(bArg)) {
      return isStructurallyEqual(aArg as Selector, bArg as Selector);
    }

    // Fallback to valueOf comparison for other arg types (non-selector nodes)
    return aArg.valueOf() === bArg.valueOf();
  }

  // For basic selectors (div, .foo, #bar) and other simple selectors, use valueOf comparison
  if (isNode(a, N.SimpleSelector) && isNode(b, N.SimpleSelector)) {
    return a.valueOf() === b.valueOf();
  }

  // For other selector types, use valueOf as fallback
  // This handles compound, complex, and selector list comparisons
  if (isNode(a, N.CompoundSelector) || isNode(a, N.ComplexSelector) || isNode(a, N.SelectorList)) {
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
  /**
   * When find is a contiguous subset of a compound target, [start, end) indices to wrap as one.
   * Enables :is(.a.b, .q).c for target .a.b.c and find .a.b.
   */
  contiguousCompoundRange?: [number, number];
  /**
   * When find is a (possibly non-contiguous) subset of a compound target, indices in target that match find in order.
   * Enables :is(.a.b, .q).c for target .a.c.b and find .a.b (indices [0, 2]).
   */
  compoundMatchIndices?: number[];
  /**
   * When find matches a segment of a complex target, [start, end) indices in target.data.
   * Enables div + :is(.a.c.b > .y.x, .q) for target "div + .a.c.b > .y.x" and find ".a.b > .x".
   */
  complexMatchRange?: [number, number];
  /** Semantic scope of the match */
  matchScope?: MatchScope;
}

export type MatchScope = 'root' | 'selectorList' | 'isArgument';

function inferMatchScope(path: Array<string | number>, matchedNode: Selector): MatchScope {
  if (path.includes('arg')) {
    return 'isArgument';
  }
  if (isNode(matchedNode, N.SelectorList)) {
    return 'selectorList';
  }
  return 'root';
}

function withMatchScope(location: ExtendLocation): ExtendLocation {
  if (location.matchScope) {
    return location;
  }
  location.matchScope = inferMatchScope(location.path, location.matchedNode);
  return location;
}

/**
 * Result of searching for extendable locations
 */
export interface ExtendSearchResult {
  locations: ExtendLocation[];
  hasMatches: boolean;
  /** True when the entire target selector is equivalent to find (whole match, not a segment). */
  hasWholeMatch: boolean;
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
  const targetValue = target.valueOf();
  const findValue = find.valueOf();
  if (targetValue === findValue) {
    const cached = EXACT_MATCH_CACHE.get(target);
    if (cached) {
      const result = { locations: cached, hasMatches: cached.length > 0, hasWholeMatch: true, metrics };
      targetCache.set(find, result);
      return result;
    }

    // Cache the exact match result
    const exactLocation: ExtendLocation = withMatchScope({
      path: [],
      matchedNode: target,
      extensionType: 'replace'
    });
    EXACT_MATCH_CACHE.set(target, [exactLocation]);
    const result = { locations: [exactLocation], hasMatches: true, hasWholeMatch: true, metrics };
    targetCache.set(find, result);
    return result;
  }

  // OPTIMIZATION 2: KeySet fast rejection - bail early for impossible matches
  if (target.keySet && find.keySet
    && target.keySet.isDisjointFrom(find.keySet)
    && target.canFastReject && find.canFastReject) {
    metrics.fastRejections++;
    const result = { locations: EMPTY_LOCATIONS, hasMatches: false, hasWholeMatch: false, metrics };
    targetCache.set(find, result);
    return result;
  }

  // OPTIMIZATION 3: KeySet subset rejection for partial matching
  if (find.canFastReject && target.keySet && find.keySet
    && !find.keySet.isSubsetOf(target.keySet)) {
    metrics.fastRejections++;
    const result = { locations: EMPTY_LOCATIONS, hasMatches: false, hasWholeMatch: false, metrics };
    targetCache.set(find, result);
    return result;
  }

  // OPTIMIZATION 4: Fast path for common selector patterns - runs first and skips slow path when successful
  // Special case: Handle SelectorList in find parameter regardless of canFastReject
  if (isNode(find, N.SelectorList)) {
    // Check if target matches any item in the find list
    for (let i = 0; i < find.data.length; i++) {
      const listItem = find.data[i]!;
      const result = findExtendableLocations(target, listItem);
      if (result.hasMatches) {
        targetCache.set(find, result);
        return result;
      }
    }
    const result = { locations: EMPTY_LOCATIONS, hasMatches: false, hasWholeMatch: false, metrics };
    targetCache.set(find, result);
    return result;
  }

  if (target.canFastReject && find.canFastReject) {
    const fastPathResult = tryFastPathExtendMatch(target, find, []);
    if (fastPathResult && fastPathResult.length > 0) {
      metrics.fastPathHits++;
      const hasWholeMatch = fastPathResult.some(loc => loc.path.length === 0 && loc.matchedNode === target);
      const result = { locations: fastPathResult, hasMatches: true, hasWholeMatch, metrics };
      targetCache.set(find, result);
      return result;
    }
  }

  // Full recursive search with optimizations - only when fast path fails
  metrics.fullSearches++;
  searchWithinSelector(target, find, [], locations);

  const hasWholeMatch = locations.some(loc => loc.path.length === 0 && loc.matchedNode === target);
  const result = {
    locations,
    hasMatches: locations.length > 0,
    hasWholeMatch,
    metrics
  };
  targetCache.set(find, result);
  return result;
}

/**
 * Whether a ruleset's selector matches an extend target. Encapsulates all extend matching
 * semantics (keySet subset, valueOf early exit, partial vs exact). Extend-roots should
 * only decide which rulesets are visible; they hand off to this to determine matches.
 */
export function selectorMatchesExtendTarget(
  selector: Selector,
  target: Selector,
  partial: boolean
): boolean {
  const keySet = target.keySet instanceof Set ? target.keySet : (target.keySet ? new Set(target.keySet) : undefined);
  if (keySet?.size && 'keySet' in selector && selector.keySet) {
    for (const k of keySet) {
      if (!selector.keySet.has(k as string)) {
        return false;
      }
    }
  }
  const targetValue = target.valueOf();
  if (typeof selector.valueOf === 'function' && selector.valueOf() === targetValue) {
    return true;
  }
  if (isNode(selector, N.SelectorList)) {
    return (selector as SelectorList).data.some((item: Selector) => {
      const comparison = selectorCompare(item, target);
      return partial ? comparison.locations.length > 0 : comparison.hasWholeMatch;
    });
  }
  const comparison = selectorCompare(selector, target);
  return partial ? comparison.locations.length > 0 : comparison.hasWholeMatch;
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
    return [withMatchScope({
      path: [...basePath],
      matchedNode: target,
      extensionType: determineExtensionType(target, basePath)
    })];
  }

  // Fast path 2: Simple selector to simple selector (.foo === .foo)
  if (isNode(target, N.SimpleSelector) && isNode(find, N.SimpleSelector)) {
    // Handle pseudo-selectors with selector arguments using enhanced equivalence
    if (isNode(target, N.PseudoSelector) && isNode(find, N.PseudoSelector)
      && target.data.name === find.data.name
      && target.data.arg && isSelector(target.data.arg)
      && find.data.arg && isSelector(find.data.arg)) {
      // Same pseudo-selector name with selector args - check if args are equivalent
      if (areSelectorArgumentsEquivalent(target.data.arg as Selector, find.data.arg as Selector)) {
        return [withMatchScope({
          path: [...basePath],
          matchedNode: target,
          extensionType: determineExtensionType(target, basePath)
        })];
      }
      return [];
    }

    if (target.valueOf() === find.valueOf()) {
      return [withMatchScope({
        path: [...basePath],
        matchedNode: target,
        extensionType: determineExtensionType(target, basePath)
      })];
    }
    return [];
  }

  // Fast path 3: Compound selector containing simple target (.foo.bar contains .foo)
  if (isNode(target, N.CompoundSelector) && isNode(find, N.SimpleSelector) && target.data.length <= 4) {
    // Skip pseudo-selectors with Selector arguments
    if (isNode(find, N.PseudoSelector) && find.data.arg && isSelector(find.data.arg)) {
      return null;
    }

    const findVal = find.valueOf();
    const locations: ExtendLocation[] = [];

    for (let i = 0; i < target.data.length; i++) {
      if (target.data[i]!.valueOf() === findVal) {
        // Found exact match - this enables partial replacement
        const remainderComponents = target.data.filter((_: any, idx: any) => idx !== i);
        const remainders = remainderComponents.length === 0
          ? []
          : remainderComponents.length === 1
            ? [remainderComponents[0]!]
            : [new CompoundSelector(remainderComponents).inherit(target)];

        locations.push(withMatchScope({
          path: [...basePath, i],
          matchedNode: target,
          extensionType: determineExtensionType(target, basePath),
          isPartialMatch: remainders.length > 0,
          remainders
        }));
      }
    }

    return locations;
  }

  // Fast path 4: Small compound to compound matching (.a.b === .b.a)
  if (isNode(target, N.CompoundSelector) && isNode(find, N.CompoundSelector)
    && target.data.length <= 4 && find.data.length <= 4) {
    return trySmallCompoundExtendMatch(target, find, basePath);
  }

  // Fast path 5: When find parameter is a selector list (legacy match-selector behavior)
  // Handles matchSelectors(target=".a", find=".a,.b") → should match because .a is in the list
  if (isNode(find, N.SelectorList)) {
    // Check if target matches any item in the find list
    for (let i = 0; i < find.data.length; i++) {
      const listItem = find.data[i]!;
      const result = tryFastPathExtendMatch(target, listItem, basePath);
      if (result && result.length > 0) {
        // Found a match with one of the list items
        return result;
      }
    }
    return []; // No matches found in list
  }

  // Fast path 6: Small selector list containing target
  if (isNode(target, N.SelectorList) && target.data.length <= 3) {
    const locations: ExtendLocation[] = [];
    for (let i = 0; i < target.data.length; i++) {
      const childResult = tryFastPathExtendMatch(target.data[i]!, find, [...basePath, i]);
      if (childResult) {
        locations.push(...childResult);
      }
    }
    return locations.length > 0 ? locations : [];
  }

  // Fast path 7: Complex selector patterns with partial match support
  if (isNode(target, N.ComplexSelector) && target.data.length <= 7) {
    // First check for exact complex selector matches
    if (isNode(find, N.ComplexSelector)) {
      const eq = areComplexSelectorsEquivalent(target, find);
      if (eq) {
        return [withMatchScope({
          path: [...basePath],
          matchedNode: target,
          extensionType: determineExtensionType(target, basePath)
        })];
      }
    }

    // Try partial complex matching
    if (isNode(find, N.ComplexSelector)) {
      const partialResult = tryPartialComplexMatch(target, find, basePath);
      if (partialResult && partialResult.length > 0) {
        return partialResult;
      }
    }

    // Try backtracking match for complex :is() scenarios
    if (isNode(find, N.ComplexSelector)) {
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
    for (let i = 0; i < target.data.length; i++) {
      const component = target.data[i];
      if (component && !isNode(component, N.Combinator)) {
        const childResult = tryFastPathExtendMatch(component, find, [...basePath, i]);
        if (childResult) {
          locations.push(...childResult);
        }
      }
    }

    // Post-process: when find matches one component of a multi-component complex selector,
    // that is always a partial match (full mode should reject it). Mark ALL such component
    // matches as partial, not just position 0.
    if (locations.length > 0 && target.data.length > 1) {
      for (const location of locations) {
        const lastSeg = location.path[location.path.length - 1];
        if (typeof lastSeg === 'number') {
          // Match is inside a component of this complex selector
          location.isPartialMatch = true;
          if (lastSeg === 0) {
            const remainingComponents = target.data.slice(1);
            location.remainders = remainingComponents.length === 1 && !isNode(remainingComponents[0], N.Combinator)
              ? [remainingComponents[0] as Selector]
              : [new ComplexSelector(remainingComponents).inherit(target)];
          }
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
  const targetComponents = target.data;
  const findComponents = find.data;

  if (findComponents.length > targetComponents.length) {
    return null;
  }

  // Try to match find at different positions (allow compound superset: .a.c.b contains .a.b)
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

      if (isNode(tComp, N.Combinator) && isNode(fComp, N.Combinator)) {
        if (tComp.data !== fComp.data) {
          matches = false;
          break;
        }
      } else if (!isNode(tComp, N.Combinator) && !isNode(fComp, N.Combinator)) {
        let compMatch = componentsMatch(tComp as Selector, fComp as Selector);
        // Compound superset: target compound can contain find compound as subsequence (.a.c.b contains .a.b)
        if (!compMatch && isNode(tComp, N.CompoundSelector) && isNode(fComp, N.CompoundSelector)) {
          compMatch = compoundContainsCompoundSubsequence(tComp, fComp);
        }
        // Simple in compound: .x in .y.x
        if (!compMatch && isNode(tComp, N.CompoundSelector) && isNode(fComp, N.SimpleSelector)) {
          compMatch = tComp.data.some((c: any) => c.valueOf() === fComp.valueOf());
        }

        if (compMatch && isNode(tComp, N.CompoundSelector) && isNode(fComp, N.SimpleSelector)) {
          hasCompoundPartialMatch = true;
        }
        if (compMatch && isNode(tComp, N.CompoundSelector) && isNode(fComp, N.CompoundSelector) && tComp.data.length > fComp.data.length) {
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

      const loc: ExtendLocation = {
        path: [...basePath],
        matchedNode: target,
        extensionType: 'replace',
        isPartialMatch,
        remainders: remainders.length > 0 ? remainders : undefined
      };
      // Segment range for §3a: wrap full segment when match spans combinator
      if (remainders.length > 0) {
        loc.complexMatchRange = [startPos, startPos + findComponents.length];
      }
      return [withMatchScope(loc)];
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
    return [withMatchScope({
      path: [...basePath],
      matchedNode: target,
      extensionType: determineExtensionType(target, basePath)
    })];
  }

  // Check for subset matching (find is subset of target)
  if (find.data.length <= target.data.length) {
    const isSubset = find.data.every((findComp: any) =>
      target.data.some((targetComp: any) =>
        compoundComponentMatches(findComp as Selector, targetComp as Selector)
      )
    );

    if (isSubset) {
      // Find contiguous slice [start, end) that matches find in order (for wrap :is(matched, extendWith).rest)
      const n = find.data.length;
      let contiguousStart: number | null = null;
      for (let start = 0; start <= target.data.length - n; start++) {
        let match = true;
        for (let j = 0; j < n; j++) {
          const tComp = target.data[start + j];
          const fComp = find.data[j];
          if (!tComp || !fComp) {
            match = false;
            break;
          }
          if (!compoundComponentMatches(fComp as Selector, tComp as Selector)) {
            match = false;
            break;
          }
        }
        if (match) {
          contiguousStart = start;
          break;
        }
      }

      // Calculate remainder after removing matched components
      const remainderComponents = target.data.filter((targetComp: any) =>
        !find.data.some((findComp: any) =>
          compoundComponentMatches(findComp as Selector, targetComp as Selector)
        )
      );

      const remainders = remainderComponents.length === 0
        ? []
        : remainderComponents.length === 1
          ? [remainderComponents[0]!]
          : [new CompoundSelector(remainderComponents).inherit(target)];

      const loc: ExtendLocation = {
        path: [...basePath],
        matchedNode: target,
        extensionType: determineExtensionType(target, basePath),
        isPartialMatch: remainders.length > 0,
        remainders
      };
      // When find is a contiguous slice, record range so we can wrap that slice as :is(find, extendWith)
      if (contiguousStart !== null && remainders.length > 0) {
        loc.contiguousCompoundRange = [contiguousStart, contiguousStart + n];
        loc.matchedNode = new CompoundSelector(find.data.slice()).inherit(target) as Selector;
        loc.extensionType = 'wrap';
      } else if (remainders.length > 0) {
        // Non-contiguous: find leftmost subsequence of target indices that matches find in order
        const matchIndices: number[] = [];
        let findIdx = 0;
        for (let i = 0; i < target.data.length && findIdx < find.data.length; i++) {
          const tComp = target.data[i]!;
          const fComp = find.data[findIdx]!;
          if (compoundComponentMatches(fComp as Selector, tComp as Selector)) {
            matchIndices.push(i);
            findIdx++;
          }
        }
        if (matchIndices.length === find.data.length) {
          loc.compoundMatchIndices = matchIndices;
          loc.matchedNode = new CompoundSelector(find.data.slice()).inherit(target) as Selector;
          loc.extensionType = 'wrap';
        }
      }
      return [withMatchScope(loc)];
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
    locations.push(withMatchScope({
      path: [...currentPath],
      matchedNode: current,
      extensionType: determineExtensionType(current, currentPath)
    }));
  }

  // OPTIMIZATION 2: Enhanced recursive search with specialized handlers for each selector type
  if (isNode(current, N.SelectorList)) {
    searchWithinSelectorList(current, target, currentPath, locations);
  } else if (isNode(current, N.CompoundSelector)) {
    searchWithinCompoundSelector(current, target, currentPath, locations);
  } else if (isNode(current, N.ComplexSelector)) {
    searchWithinComplexSelector(current, target, currentPath, locations);
  } else if (isNode(current, N.PseudoSelector)) {
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
  selectorList.data.forEach((selector, index) => {
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
  if (isNode(target, N.PseudoSelector) && target.data.arg && isSelector(target.data.arg)) {
    // Look for matching pseudo-selectors within the compound
    compound.data.forEach((component, index) => {
      if (isNode(component, N.PseudoSelector) && arePseudoSelectorsEquivalent(component, target)) {
        locations.push(withMatchScope({
          path: [...currentPath, index],
          matchedNode: component,
          extensionType: 'replace'
        }));
      }
    });
  }

  // Standard recursive search through each component
  compound.data.forEach((component, index) => {
    searchWithinSelector(component, target, [...currentPath, index], locations);
  });

  // OPTIMIZATION 5: Check for partial matches within compound selectors
  // This enables extending when target is a subset of the compound
  if (isNode(target, N.SimpleSelector)) {
    const targetVal = target.valueOf();

    for (let i = 0; i < compound.data.length; i++) {
      if (compound.data[i]!.valueOf() === targetVal) {
        // Found a component that matches target - create partial match
        // Use unique path with component index to distinguish duplicate components
        const remainderComponents = compound.data.filter((_, idx) => idx !== i);
        const remainders = remainderComponents.length === 0
          ? []
          : remainderComponents.length === 1
            ? [remainderComponents[0]!]
            : [new CompoundSelector(remainderComponents).inherit(compound)];

        locations.push(withMatchScope({
          path: [...currentPath, i],
          matchedNode: compound.data[i]!,
          extensionType: 'replace',
          isPartialMatch: remainders.length > 0,
          remainders
        }));
      }
    }
  }

  // OPTIMIZATION 6: Compound-to-compound partial matching
  if (isNode(target, N.CompoundSelector) && target.data.length <= compound.data.length) {
    const isSubset = target.data.every(targetComp =>
      compound.data.some(compComp =>
        isNode(targetComp, N.PseudoSelector) && targetComp.data.arg && isSelector(targetComp.data.arg)
          ? arePseudoSelectorsEquivalent(compComp, targetComp)
          : compComp.valueOf() === targetComp.valueOf()
      )
    );

    if (isSubset) {
      // Calculate remainder after removing matched components
      const remainderComponents = compound.data.filter(compComp =>
        !target.data.some(targetComp =>
          isNode(targetComp, N.PseudoSelector) && targetComp.data.arg && isSelector(targetComp.data.arg)
            ? arePseudoSelectorsEquivalent(compComp, targetComp)
            : compComp.valueOf() === targetComp.valueOf()
        )
      );

      const remainders = remainderComponents.length === 0
        ? []
        : remainderComponents.length === 1
          ? [remainderComponents[0]!]
          : [new CompoundSelector(remainderComponents).inherit(compound)];

      locations.push(withMatchScope({
        path: [...currentPath],
        matchedNode: target,
        extensionType: 'replace',
        isPartialMatch: remainders.length > 0,
        remainders
      }));
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

  // If we're searching for a ComplexSelector target, allow full structural equivalence (including `:is(...)`).
  if (isNode(target, N.ComplexSelector)) {
    const eq = areComplexSelectorsEquivalent(complex, target);
    if (eq) {
      locations.push(withMatchScope({
        path: [...currentPath],
        matchedNode: complex,
        extensionType: determineExtensionType(complex, currentPath)
      }));
    }
  }

  complex.data.forEach((component, index) => {
    // Skip combinators, only search selector components
    if (!isNode(component, N.Combinator)) {
      searchWithinSelector(component as Selector, target, [...currentPath, index], locations);
    }
  });

  // Post-process: when find matches one component of a multi-component complex selector,
  // that is always a partial match (full mode should reject it). Mark ALL such component
  // matches as partial, not just position 0.
  if (locations.length > initialLocationCount && complex.data.length > 1) {
    for (let i = initialLocationCount; i < locations.length; i++) {
      const location = locations[i]!;
      const lastPathSegment = location.path[location.path.length - 1];

      if (typeof lastPathSegment === 'number') {
        // Match is inside a component of this complex selector
        location.isPartialMatch = true;
        if (lastPathSegment === 0) {
          const remainingComponents = complex.data.slice(1);
          if (remainingComponents.length === 1 && !isNode(remainingComponents[0], N.Combinator)) {
            location.remainders = [remainingComponents[0] as Selector];
          } else if (remainingComponents.length > 0) {
            location.remainders = [new ComplexSelector(remainingComponents).inherit(complex)];
          }
        }
      }
    }
  }

  // OPTIMIZATION 8: Complex selector pattern matching
  // Handle common patterns like descendant, child, sibling selectors efficiently
  if (isNode(target, N.ComplexSelector)) {
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

  if (complex.data.length < target.data.length) {
    return; // Complex selector must be at least as long as target
  }

  const targetComponents = target.data;
  const complexComponents = complex.data;

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

      if (isNode(targetComp, N.Combinator) && isNode(complexComp, N.Combinator)) {
        // Both are combinators - must match exactly
        if (targetComp.data !== complexComp.data) {
          isMatch = false;
          break;
        }
      } else if (isNode(targetComp, N.Combinator) || isNode(complexComp, N.Combinator)) {
        // One is combinator, other is not - no match
        isMatch = false;
        break;
      } else {
        // Both are selector components
        if (isNode(complexComp, N.CompoundSelector) && !isNode(targetComp, N.CompoundSelector)) {
          // Complex component is compound, target is simple
          // Check if target component appears within the compound
          const foundInCompound = complexComp.data.some(comp =>
            comp && componentsMatch(comp, targetComp as Selector)
          );
          if (foundInCompound) {
            // Partial match - calculate remainder
            const remainderComps = complexComp.data.filter(comp =>
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
        if (remainingComponents.length === 1 && !isNode(remainingComponents[0], N.Combinator)) {
          remainders = [remainingComponents[0]];
        } else if (remainingComponents.length > 1) {
          remainders = [ComplexSelector.create(remainingComponents).inherit(complex)];
        }
      }

      locations.push(withMatchScope({
        path: [...currentPath],
        matchedNode: target,
        extensionType: determineExtensionType(complex, currentPath),
        isPartialMatch: remainders.length > 0,
        remainders: remainders.length > 0 ? remainders : undefined
      }));

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
  const targetComponents = target.data;
  const findComponents = find.data;

  if (findComponents.length === 0 || targetComponents.length < findComponents.length) {
    return null;
  }

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
      if (isNode(targetComp, N.Combinator) !== isNode(findComp, N.Combinator)) {
        matches = false;
        break;
      }

      // If both are combinators, they must match exactly
      if (isNode(targetComp, N.Combinator) && isNode(findComp, N.Combinator)) {
        if (targetComp.data !== findComp.data) {
          matches = false;
          break;
        }
      } else if (!isNode(targetComp, N.Combinator) && !isNode(findComp, N.Combinator)) {
        // If both are selectors, use existing selector matching logic
        // But also check for partial compound matching
        let componentMatches = areSelectorArgumentsEquivalent(targetComp, findComp);

        if (!componentMatches) {
          // Check for partial compound matching: .b should match within .b.c
          if (isNode(targetComp, N.CompoundSelector) && isNode(findComp, N.SimpleSelector)) {
            componentMatches = targetComp.data.some(comp => comp.valueOf() === findComp.valueOf());
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

        if (!isNode(targetComp, N.Combinator) && !isNode(findComp, N.Combinator)) {
          if (isNode(targetComp, N.CompoundSelector) && isNode(findComp, N.SimpleSelector)) {
            // Check if there's a partial match leaving compound remainders
            const matchingComponent = targetComp.data.find(comp => comp.valueOf() === findComp.valueOf());
            if (matchingComponent) {
              // Calculate remainder components within this compound
              const compoundRemainders = targetComp.data.filter(comp => comp.valueOf() !== findComp.valueOf());
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
  const targetComponents = target.data.filter(c => !isNode(c, N.Combinator));
  const findComponents = find.data.filter(c => !isNode(c, N.Combinator));

  if (findComponents.length === 0) {
    return null;
  }

  // Special case: Check if target has a compound with :is() that can expand to match find
  for (let i = 0; i < targetComponents.length; i++) {
    const comp = targetComponents[i];

    if (isNode(comp, N.CompoundSelector)) {
      // Look for :is() pseudo-selectors in the compound
      const isPseudos = comp.data.filter(v =>
        isNode(v, N.PseudoSelector) && v.data.name === ':is' && v.data.arg && isSelector(v.data.arg)
      ) as PseudoSelector[];

      for (const isPseudo of isPseudos) {
        const isArg = isPseudo.data.arg as Selector;

        // If :is() contains a complex selector
        if (isNode(isArg, N.ComplexSelector)) {
          // Get the :is() content components
          const isArgComponents = isArg.data.filter(c => !isNode(c, N.Combinator));

          // Try to match the find pattern
          if (isArgComponents.length >= 2) {
            // Get the last component from :is() (e.g., .b from .a > .b)
            const lastIsComponent = isArgComponents[isArgComponents.length - 1]!;

            // Get other components in the compound (e.g., .d)
            const otherCompoundComponents = comp.data.filter(v => v !== isPseudo);

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
                if (isNode(compoundWithIsLast, N.CompoundSelector) && isNode(findComp, N.SimpleSelector)) {
                  // In improved structural semantics: compound matches simple if simple is contained
                  const containsTarget = compoundWithIsLast.data.some(comp => comp.valueOf() === findComp.valueOf());
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
                    return [withMatchScope(location)];
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
  const arg = pseudo.data.arg;
  if (!arg || !isSelector(arg)) {
    return;
  }

  const argSelector = arg as Selector;

  // OPTIMIZATION 7: Special handling for :is() pseudo-selectors
  // Implements sophisticated right-to-left backtracking algorithm from matchSelectors
  if (pseudo.data.name === ':is') {
    if (isNode(argSelector, N.SelectorList)) {
      // Check if target matches any alternative in the :is() selector list
      argSelector.data.forEach((alternative, altIndex) => {
        const itemPath = [...currentPath, 'arg', altIndex];
        // Direct structural match: use determineExtensionType so we get 'wrap' when inside a compound (not just 'append')
        if (isStructurallyEqual(alternative, target)) {
          locations.push(withMatchScope({
            path: itemPath,
            matchedNode: alternative,
            extensionType: determineExtensionType(alternative, itemPath)
          }));
        }

        // Recursive search within each alternative
        searchWithinSelector(alternative, target, itemPath, locations);
      });

      // Additional optimization: Check if target could be added as new alternative
      // This enables extending :is(.a, .b) with .c to become :is(.a, .b, .c)
      const canExtendAsList = !argSelector.data.some(alt => isStructurallyEqual(alt, target));
      if (canExtendAsList) {
        locations.push(withMatchScope({
          path: [...currentPath, 'arg'],
          matchedNode: argSelector,
          extensionType: 'append', // Append new alternative to :is() list
          isPartialMatch: false
        }));
      }
    } else {
      // Single argument in :is() - check for direct match
      if (isStructurallyEqual(argSelector, target)) {
        locations.push(withMatchScope({
          path: [...currentPath, 'arg'],
          matchedNode: argSelector,
          extensionType: 'append', // Will convert single arg to SelectorList and append
          isPartialMatch: false
        }));
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
 * Normalizes a selector to handle :is() equivalences
 * This is the single source of truth for :is() expansion logic
 *
 * Examples:
 * - :is(.a) -> .a
 * - a :is(b, c) -> a b, a c (as SelectorList)
 * - :is(.foo, .bar) -> .foo, .bar (as SelectorList)
 */
function normalizeSelector(selector: Selector): Selector {
  if (isNode(selector, N.PseudoSelector) && selector.data.name === ':is' && selector.data.arg) {
    const arg = selector.data.arg as Selector;

    if (isNode(arg, N.SimpleSelector)) {
      return arg;
    }

    if (isNode(arg, N.SelectorList)) {
      return arg;
    }

    return arg;
  }

  if (isNode(selector, N.ComplexSelector)) {
    const expanded = expandComplexSelectorWithIs(selector);
    if (expanded.length > 1) {
      return new SelectorList(expanded);
    }
    if (expanded.length === 1) {
      return expanded[0]!;
    }
  }

  if (isNode(selector, N.SelectorList)) {
    const normalizedSelectors: Selector[] = [];

    for (const sel of selector.data) {
      const normalized = normalizeSelector(sel);
      if (isNode(normalized, N.SelectorList)) {
        normalizedSelectors.push(...normalized.data);
      } else {
        normalizedSelectors.push(normalized);
      }
    }

    if (normalizedSelectors.length === 1) {
      return normalizedSelectors[0]!;
    }

    return new SelectorList(normalizedSelectors);
  }

  return selector;
}

export function normalizeSelectorForExtend(selector: Selector): Selector {
  return normalizeSelector(selector);
}

/**
 * Legacy MatchResult interface for backward compatibility
 */
export interface MatchResult {
  hasMatch: boolean;
  hasFullMatch: boolean;
  hasPartialMatch: boolean;
  matched: Selector[];
  remainders: Selector[];
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
  const normalizedTarget = normalizeSelector(target);
  const normalizedFind = normalizeSelector(find);

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

  const hasAnyPartialMatch = searchResult.locations.some((loc: ExtendLocation) => loc.isPartialMatch);
  const hasAnyFullMatch = searchResult.locations.some((loc: ExtendLocation) => !loc.isPartialMatch);

  const isPartialMatch = partial && (hasAnyPartialMatch || searchResult.locations.some((loc: ExtendLocation) => loc.remainders && loc.remainders.length > 0));

  return {
    hasMatch: true,
    hasFullMatch: hasAnyFullMatch && !isPartialMatch,
    hasPartialMatch: isPartialMatch,
    matched: hasAnyFullMatch && !isPartialMatch ? [find] : [],
    remainders: searchResult.locations[0]?.remainders || []
  };
}

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
      return new Set([a, b]);
    }
  }
}

export interface SelectorComparisonResult {
  isEquivalent: boolean;
  hasWholeMatch: boolean;
  hasPartialMatch: boolean;
  locations: ExtendLocation[];
}

export function selectorCompare(
  a: Selector,
  b: Selector,
  forwardSearch?: ExtendSearchResult,
  backwardSearch?: ExtendSearchResult
): SelectorComparisonResult {
  const normalizedA = normalizeSelectorForExtend(a);
  const normalizedB = normalizeSelectorForExtend(b);
  if (isNode(normalizedA, N.SelectorList) && isNode(normalizedB, N.SelectorList)) {
    const aValues = normalizedA.data;
    const bValues = normalizedB.data;
    // Use a Set for O(N) order-independent comparison instead of O(N log N) sort
    const equivalent = aValues.length === bValues.length && (() => {
      const aSet = new Set(aValues.map(item => normalizeSelectorForExtend(item as Selector).valueOf()));
      return bValues.every(item => aSet.has(normalizeSelectorForExtend(item as Selector).valueOf()));
    })();
    if (equivalent) {
      return {
        isEquivalent: true,
        hasWholeMatch: true,
        hasPartialMatch: false,
        locations: []
      };
    }
  }
  const forward = forwardSearch ?? findExtendableLocations(normalizedA, normalizedB);
  const backward = backwardSearch ?? findExtendableLocations(normalizedB, normalizedA);
  return {
    isEquivalent: forward.hasWholeMatch && backward.hasWholeMatch,
    hasWholeMatch: forward.hasWholeMatch,
    hasPartialMatch: forward.hasMatches && !forward.hasWholeMatch,
    locations: forward.locations
  };
}
