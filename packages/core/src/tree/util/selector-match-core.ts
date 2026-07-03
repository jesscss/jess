import { Selector } from '../selector.js';
import { SimpleSelector } from '../selector-simple.js';
import { SelectorList, SelectorListItem } from '../selector-list.js';
import { ComplexSelector, ComplexSelectorComponent } from '../selector-complex.js';
import { CompoundSelector } from '../selector-compound.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { Ampersand } from '../ampersand.js';
import { Combinator } from '../combinator.js';
import type { Context } from '../../context.js';
import { isNode } from './is-node.js';
import { isCombinator } from './combinator.js';
import { N } from '../node-type.js';
import { isSubsetOf, isDisjoint } from './bitset.js';

function shareKeySetLibrary(a: Selector, b: Selector): boolean {
  return !!a.keySetLibrary && a.keySetLibrary === b.keySetLibrary;
}

export function selectorListItemForMatch(item: SelectorList['value'][number]): Selector {
  return typeof item === 'string' ? new ComplexSelector([item]) : item;
}

function normalizedSelectorListItemValueForMatch(item: SelectorList['value'][number]): string {
  return typeof item === 'string' ? item : normalizeSelectorForExtend(item).valueOf();
}
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
  let hasArgSegment = false;
  let numericSegmentCount = 0;
  for (let i = 0; i < basePath.length; i++) {
    const segment = basePath[i]!;
    if (segment === 'arg') {
      hasArgSegment = true;
    } else if (typeof segment === 'number') {
      numericSegmentCount++;
    }
  }
  if (hasArgSegment) {
    // Check if we're matching a component within a compound selector inside the argument
    // Path format: ['arg', selectorListIndex, compoundIndex, ...]
    // If we have at least 3 segments and the last numeric segment is a compound index,
    // we should wrap to preserve compound selector structure
    if (numericSegmentCount >= 2) {
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
 * Filters value to get only non-combinator value
 * This pattern appears in many complex selector algorithms
 */
export function getNonCombinatorComponents(selector: ComplexSelector): Selector[] {
  return selector.value.filter((c): c is Selector => typeof c !== 'string' && !isCombinator(c));
}

/**
 * Filters value to get only combinators
 * Used in complex selector matching algorithms
 */
export function getCombinatorComponents(selector: ComplexSelector): Combinator[] {
  return selector.value.filter(c => isCombinator(c)) as Combinator[];
}

/**
 * Checks if two value match using component-level logic
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
    const bValue = b.valueOf();
    for (let i = 0; i < a.value.length; i++) {
      if (a.value[i]!.valueOf() === bValue) {
        return true;
      }
    }
    return false;
  }

  // Handle simple vs compound: compound contains simple (improved structural matching)
  if (isNode(a, N.SimpleSelector) && isNode(b, N.CompoundSelector)) {
    const aValue = a.valueOf();
    for (let i = 0; i < b.value.length; i++) {
      if (b.value[i]!.valueOf() === aValue) {
        return true;
      }
    }
    return false;
  }

  // Handle pseudo-selector equivalence
  if (isNode(a, N.PseudoSelector) && isNode(b, N.PseudoSelector)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return a.name === b.name && areSelectorArgumentsEquivalent(a.arg as Selector, b.arg as Selector);
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
 *  - Both are non-:is() pseudo-value: delegate to arePseudoSelectorsEquivalent
 */
export function compoundComponentMatches(find: Selector, target: Selector): boolean {
  // Fast path
  if (find.valueOf() === target.valueOf()) {
    return true;
  }

  // find is :is(...) — walk its alternatives without creating new structures
  if (isNode(find, N.PseudoSelector) && find.name === ':is' && find.arg && isSelector(find.arg)) {
    const arg = find.arg as Selector;
    if (isNode(arg, N.SelectorList)) {
      return arg.value.some((alt: SelectorListItem) => typeof alt !== 'string' && compoundComponentMatches(alt, target));
    }
    return compoundComponentMatches(arg, target);
  }

  // target is :is(...) — walk its alternatives
  if (isNode(target, N.PseudoSelector) && target.name === ':is' && target.arg && isSelector(target.arg)) {
    const arg = target.arg as Selector;
    if (isNode(arg, N.SelectorList)) {
      return arg.value.some((alt: SelectorListItem) => typeof alt !== 'string' && compoundComponentMatches(find, alt));
    }
    return compoundComponentMatches(find, arg);
  }

  // Both are non-:is() pseudo-value
  if (isNode(find, N.PseudoSelector) && find.arg && isSelector(find.arg) && isNode(target, N.PseudoSelector)) {
    return arePseudoSelectorsEquivalent(find, target);
  }

  return false;
}

/**
 * Checks pseudo-selector equivalence including argument matching
 * Handles all pseudo-value with selector arguments, not just specific ones
 * Extracted from find-extendable-locations.ts with preserved original logic
 */
export function arePseudoSelectorsEquivalent(a: any, b: any): boolean {
  if (!isNode(a, N.PseudoSelector) || !isNode(b, N.PseudoSelector)) {
    return false;
  }
  if (a.name !== b.name) {
    return false;
  }

  const aArg = a.arg;
  const bArg = b.arg;

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
 * Checks equivalence of selector arguments in pseudo-value
 * Preserves complex original logic for :is(), :where(), etc.
 */
export function areSelectorArgumentsEquivalent(a: Selector, b: Selector): boolean {
  // Handle selector lists (order-independent)
  if (isNode(a, N.SelectorList) && isNode(b, N.SelectorList)) {
    if (a.value.length !== b.value.length) {
      return false;
    }

    for (let i = 0; i < a.value.length; i++) {
      const aItem = selectorListItemForMatch(a.value[i]!);
      let found = false;
      for (let j = 0; j < b.value.length; j++) {
        if (componentsMatch(aItem, selectorListItemForMatch(b.value[j]!))) {
          found = true;
          break;
        }
      }
      if (!found) {
        return false;
      }
    }
    return true;
  }

  // Handle compound value
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
 * True when find's value appear in target in order (subsequence). Enables .a.c.b to match .a.b.
 */
function compoundContainsCompoundSubsequence(target: CompoundSelector, find: CompoundSelector): boolean {
  if (find.value.length > target.value.length) {
    return false;
  }
  const eq = (t: Selector, f: Selector) => compoundComponentMatches(f, t);
  let tIdx = 0;
  for (const fComp of find.value) {
    if (typeof fComp === 'string') {
      continue;
    }
    let found = false;
    while (tIdx < target.value.length) {
      const tComp = target.value[tIdx]!;
      if (typeof tComp !== 'string' && eq(tComp, fComp)) {
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
  if (a.value.length !== b.value.length) {
    return false;
  }

  // Order-independent component matching: two compounds are equivalent if they have the same
  // multiset of value. Components are small (typically 2-5), so O(N²) is fine.
  // Uses compoundComponentMatches for :is()-aware pointer walk — no object creation.
  const aNonString = a.value.filter((c): c is SimpleSelector => typeof c !== 'string');
  const bNonString = b.value.filter((c): c is SimpleSelector => typeof c !== 'string');
  for (const aComp of aNonString) {
    let found = false;
    for (const bComp of bNonString) {
      if (compoundComponentMatches(aComp, bComp)) {
        found = true;
        break;
      }
    }
    if (!found) {
      return false;
    }
  }
  return true;
}

/**
 * Expands compound value by handling :is() pseudo-value
 * Preserves exact original expansion algorithm - only handles :is() specially
 */
export function expandCompoundWithPseudoSelectors(compound: CompoundSelector): CompoundSelector[] {
  const expansions: CompoundSelector[] = [compound];

  // Only expand :is() pseudo-value (preserving original logic)
  compound.value.forEach((component, index) => {
    if (isNode(component, N.PseudoSelector) && component.name === ':is' && component.arg && isSelector(component.arg)) {
      const arg = component.arg as Selector;

      // Handle :is() with compound selector argument
      if (isNode(arg, N.CompoundSelector)) {
        // Create new expansions by replacing :is() with its contents
        const newExpansions: CompoundSelector[] = [];

        expansions.forEach((expansion: CompoundSelector) => {
          const newComponents = [...expansion.value];
          newComponents.splice(index, 1, ...arg.value); // Replace :is() with its contents
          newExpansions.push(new CompoundSelector(newComponents));
        });

        expansions.push(...newExpansions);
      } else if (isNode(arg, N.SimpleSelector)) {
        // Handle :is() with simple selector argument
        const newExpansions: CompoundSelector[] = [];

        expansions.forEach((expansion: CompoundSelector) => {
          const newComponents = [...expansion.value];
          newComponents.splice(index, 1, arg); // Replace :is() with the simple selector
          newExpansions.push(new CompoundSelector(newComponents));
        });

        expansions.push(...newExpansions);
      } else if (isNode(arg, N.SelectorList)) {
        // Handle :is() with selector list argument
        const newExpansions: CompoundSelector[] = [];

        const listArg = arg as SelectorList;
        expansions.forEach((expansion: CompoundSelector) => {
          listArg.value.forEach((listItem: SelectorListItem) => {
            if (typeof listItem === 'string') {
              return;
            }
            const newComponents = [...expansion.value];

            if (isNode(listItem, N.CompoundSelector)) {
              newComponents.splice(index, 1, ...listItem.value);
            } else {
              newComponents.splice(index, 1, listItem as SimpleSelector);
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
 * Expands complex value containing :is() pseudo-value into equivalent selector lists
 * This handles cases like: a :is(b, c) -> a b, a c
 */
export function expandComplexSelectorWithIs(complexSelector: ComplexSelector): Selector[] {
  // Look for :is() pseudo-value in the complex selector
  let hasIsSelector = false;
  let isIndex = -1;
  let isArg: Selector | null = null;
  let isFromBareIsCompound = false;
  let isFromAmpersandSelector = false;

  for (let i = 0; i < complexSelector.value.length; i++) {
    const component = complexSelector.value[i];
    if (isNode(component, N.PseudoSelector) && component.name === ':is' && component.arg && isSelector(component.arg)) {
      hasIsSelector = true;
      isIndex = i;
      isArg = component.arg as Selector;
      break; // Handle first :is() found for now
    }
    // Also support the common case where `:is(...)` is wrapped in a single-item CompoundSelector
    // (e.g. `:is(.a, .b) .c`) so matching can expand alternatives.
    if (isNode(component, N.CompoundSelector) && component.value.length === 1) {
      const only = component.value[0]!;
      if (isNode(only, N.PseudoSelector) && only.name === ':is' && only.arg && isSelector(only.arg)) {
        hasIsSelector = true;
        isIndex = i;
        isArg = only.arg as Selector;
        isFromBareIsCompound = true;
        break; // Handle first :is() found for now
      }
    }
    // Also support the case where `:is(...)` is carried inside an implicit ampersand's resolved selector.
    // This shows up as a ComplexSelector beginning with Ampersand(selector=:is(...)).
    if (isNode(component, N.Ampersand)) {
      const sel = (component as Ampersand).getResolvedSelector();
      if (sel && isNode(sel, N.PseudoSelector) && sel.name === ':is' && sel.arg && isSelector(sel.arg)) {
        hasIsSelector = true;
        isIndex = i;
        isArg = sel.arg as Selector;
        isFromAmpersandSelector = true;
        break;
      }
      if (sel && isNode(sel, N.CompoundSelector) && sel.value.length === 1) {
        const only = sel.value[0]!;
        if (isNode(only, N.PseudoSelector) && only.name === ':is' && only.arg && isSelector(only.arg)) {
          hasIsSelector = true;
          isIndex = i;
          isArg = only.arg as Selector;
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
  const alternatives = isNode(isArg, N.SelectorList) ? isArg.value : [isArg];

  // For each alternative, create a new complex selector
  alternatives.forEach((alternative) => {
    const newComponents = [...complexSelector.value];
    if (isFromAmpersandSelector) {
      // Inline the resolved alternative directly so we do not reintroduce synthetic
      // ampersand nodes while expanding match candidates.
      if (isNode(alternative, N.ComplexSelector)) {
        newComponents.splice(isIndex, 1, ...alternative.value);
      } else {
        newComponents[isIndex] = alternative as ComplexSelectorComponent;
      }
    } else if (isFromBareIsCompound) {
      // The original `:is(...)` lived inside a CompoundSelector position. Replace that slot with the
      // alternative selector's value where possible.
      if (isNode(alternative, N.ComplexSelector)) {
        newComponents.splice(isIndex, 1, ...alternative.value);
      } else {
        newComponents[isIndex] = alternative as ComplexSelectorComponent;
      }
    } else {
      newComponents[isIndex] = alternative as ComplexSelectorComponent; // Replace :is() with the alternative
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
 * Checks if two complex value are equivalent using the original algorithm
 * Preserves exact combinator and component matching logic from find-extendable-locations.ts
 */
export function areComplexSelectorsEquivalent(a: ComplexSelector, b: ComplexSelector): boolean {
  if (a.value.length !== b.value.length) {
    return false;
  }

  // Check each component matches
  for (let i = 0; i < a.value.length; i++) {
    const aComp = a.value[i];
    const bComp = b.value[i];

    if (!aComp || !bComp) {
      return false;
    }

    // Both must be same type
    if (isCombinator(aComp) && isCombinator(bComp)) {
      if (aComp.value !== bComp.value) {
        return false;
      }
    } else if (!isCombinator(aComp) && !isCombinator(bComp)) {
      // Both are value - check equivalence
      if (isNode(aComp, N.CompoundSelector) && isNode(bComp, N.CompoundSelector)) {
        if (!areCompoundSelectorsEquivalent(aComp, bComp)) {
          return false;
        }
      } else if (isNode(aComp, N.PseudoSelector) && aComp.name === ':is' && aComp.arg && isSelector(aComp.arg)) {
        // Allow `:is(.a, .b)` to match `.a` (or any selector in its arg list) for complex selector equivalence.
        const arg = aComp.arg as Selector;
        if (isNode(arg, N.SelectorList)) {
          const matchesAny = arg.value.some(sel => sel.valueOf() === bComp.valueOf());
          if (!matchesAny) {
            return false;
          }
        } else {
          if (arg.valueOf() !== bComp.valueOf()) {
            return false;
          }
        }
      } else if (isNode(bComp, N.PseudoSelector) && bComp.name === ':is' && bComp.arg && isSelector(bComp.arg)) {
        // Symmetric case: allow `.a` to match `:is(.a, .b)`
        const arg = bComp.arg as Selector;
        if (isNode(arg, N.SelectorList)) {
          const matchesAny = arg.value.some(sel => sel.valueOf() === aComp.valueOf());
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
 * Checks if two value are structurally equal (same type and content)
 * This is different from valueOf() comparison which might do normalization
 */
export function isStructurallyEqual(a: Selector, b: Selector): boolean {
  // For pseudo-value, compare name and arguments first (before basic selector check)
  if (isNode(a, N.PseudoSelector) && isNode(b, N.PseudoSelector)) {
    if (a.name !== b.name) {
      return false;
    }

    const aArg = a.arg;
    const bArg = b.arg;

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

  // For basic value (div, .foo, #bar) and other simple value, use valueOf comparison
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
  /** Whether this was a partial match (for compound value) */
  isPartialMatch?: boolean;
  /** Remainder value after partial match */
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
   * When find matches a segment of a complex target, [start, end) indices in target.value.
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

  // OPTIMIZATION 1: Exact match cache for identical value
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

  const canFastReject = shareKeySetLibrary(target, find);

  // OPTIMIZATION 2: BitSet fast rejection - bail early for impossible matches
  if (canFastReject && isDisjoint(target.keySet, find.keySet)) {
    metrics.fastRejections++;
    const result = { locations: EMPTY_LOCATIONS, hasMatches: false, hasWholeMatch: false, metrics };
    targetCache.set(find, result);
    return result;
  }

  // OPTIMIZATION 3: RequiredKeyBits subset rejection for partial matching
  if (canFastReject && !isSubsetOf(find.requiredKeySet, target.keySet)) {
    metrics.fastRejections++;
    const result = { locations: EMPTY_LOCATIONS, hasMatches: false, hasWholeMatch: false, metrics };
    targetCache.set(find, result);
    return result;
  }

  // OPTIMIZATION 4: Fast path for common selector patterns - runs first and skips slow path when successful
  // Special case: Handle SelectorList in find parameter regardless of canFastReject
  if (isNode(find, N.SelectorList)) {
    // Check if target matches any item in the find list
    for (let i = 0; i < find.value.length; i++) {
      const listItem = find.value[i]!;
      const result = findExtendableLocations(target, selectorListItemForMatch(listItem));
      if (result.hasMatches) {
        targetCache.set(find, result);
        return result;
      }
    }
    const result = { locations: EMPTY_LOCATIONS, hasMatches: false, hasWholeMatch: false, metrics };
    targetCache.set(find, result);
    return result;
  }

  const fastPathResult = tryFastPathExtendMatch(target, find, []);
  if (fastPathResult && fastPathResult.length > 0) {
    metrics.fastPathHits++;
    const hasWholeMatch = fastPathResult.some(loc => loc.path.length === 0 && loc.matchedNode === target);
    const result = { locations: fastPathResult, hasMatches: true, hasWholeMatch, metrics };
    targetCache.set(find, result);
    return result;
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
  if (shareKeySetLibrary(selector, target) && !isSubsetOf(target.requiredKeySet, selector.keySet)) {
    return false;
  }
  const targetValue = target.valueOf();
  if (typeof selector.valueOf === 'function' && selector.valueOf() === targetValue) {
    return true;
  }
  if (isNode(selector, N.SelectorList)) {
    return selector.value.some((item) => {
      const comparison = selectorCompare(selectorListItemForMatch(item), target);
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
    // Handle pseudo-value with selector arguments using enhanced equivalence
    if (isNode(target, N.PseudoSelector) && isNode(find, N.PseudoSelector)
      && target.name === find.name
      && target.arg && isSelector(target.arg)
      && find.arg && isSelector(find.arg)) {
      // Same pseudo-selector name with selector args - check if args are equivalent
      if (areSelectorArgumentsEquivalent(target.arg as Selector, find.arg as Selector)) {
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
  if (isNode(target, N.CompoundSelector) && isNode(find, N.SimpleSelector) && target.value.length <= 4) {
    // Skip pseudo-value with Selector arguments
    if (isNode(find, N.PseudoSelector) && find.arg && isSelector(find.arg)) {
      return null;
    }

    const findVal = find.valueOf();
    const locations: ExtendLocation[] = [];

    for (let i = 0; i < target.value.length; i++) {
      if (target.value[i]!.valueOf() === findVal) {
        // Found exact match - this enables partial replacement
        const remainderComponents = target.value.filter((_, idx) => idx !== i);
        const selectorRemainders = remainderComponents.filter((c): c is SimpleSelector => typeof c !== 'string');
        const remainders: Selector[] = selectorRemainders.length === 0
          ? []
          : selectorRemainders.length === 1
            ? [selectorRemainders[0]!]
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
    && target.value.length <= 4 && find.value.length <= 4) {
    return trySmallCompoundExtendMatch(target, find, basePath);
  }

  // Fast path 5: When find parameter is a selector list (legacy match-selector behavior)
  // Handles matchSelectors(target=".a", find=".a,.b") → should match because .a is in the list
  if (isNode(find, N.SelectorList)) {
    // Check if target matches any item in the find list
    for (let i = 0; i < find.value.length; i++) {
      const listItem = selectorListItemForMatch(find.value[i]!);
      const result = tryFastPathExtendMatch(target, listItem, basePath);
      if (result && result.length > 0) {
        // Found a match with one of the list items
        return result;
      }
    }
    return []; // No matches found in list
  }

  // Fast path 6: Small selector list containing target
  if (isNode(target, N.SelectorList) && target.value.length <= 3) {
    const locations: ExtendLocation[] = [];
    for (let i = 0; i < target.value.length; i++) {
      const childResult = tryFastPathExtendMatch(selectorListItemForMatch(target.value[i]!), find, [...basePath, i]);
      if (childResult) {
        locations.push(...childResult);
      }
    }
    return locations.length > 0 ? locations : [];
  }

  // Fast path 7: Complex selector patterns with partial match support
  if (isNode(target, N.ComplexSelector) && target.value.length <= 7) {
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
    for (let i = 0; i < target.value.length; i++) {
      const component = target.value[i];
      if (component && typeof component !== 'string' && !isCombinator(component)) {
        const childResult = tryFastPathExtendMatch(component, find, [...basePath, i]);
        if (childResult) {
          locations.push(...childResult);
        }
      }
    }

    // Post-process: when find matches one component of a multi-component complex selector,
    // that is always a partial match (full mode should reject it). Mark ALL such component
    // matches as partial, not just position 0.
    if (locations.length > 0 && target.value.length > 1) {
      for (const location of locations) {
        const lastSeg = location.path[location.path.length - 1];
        if (typeof lastSeg === 'number') {
          // Match is inside a component of this complex selector
          location.isPartialMatch = true;
          if (lastSeg === 0) {
            const remainingComponents = target.value.slice(1);
            const firstRemaining = remainingComponents[0];
            location.remainders = remainingComponents.length === 1 && firstRemaining && typeof firstRemaining !== 'string' && !isCombinator(firstRemaining)
              ? [firstRemaining]
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
 * Tries to match partial complex value
 */
function tryPartialComplexMatch(
  target: ComplexSelector,
  find: ComplexSelector,
  basePath: Array<string | number>
): ExtendLocation[] | null {
  const targetComponents = target.value;
  const findComponents = find.value;

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

      if (isCombinator(tComp) && isCombinator(fComp)) {
        if (tComp.value !== fComp.value) {
          matches = false;
          break;
        }
      } else if (!isCombinator(tComp) && !isCombinator(fComp) && typeof tComp !== 'string' && typeof fComp !== 'string') {
        let compMatch = componentsMatch(tComp, fComp);
        // Compound superset: target compound can contain find compound as subsequence (.a.c.b contains .a.b)
        if (!compMatch && isNode(tComp, N.CompoundSelector) && isNode(fComp, N.CompoundSelector)) {
          compMatch = compoundContainsCompoundSubsequence(tComp, fComp);
        }
        // Simple in compound: .x in .y.x
        if (!compMatch && isNode(tComp, N.CompoundSelector) && isNode(fComp, N.SimpleSelector)) {
          compMatch = tComp.value.some((c: any) => c.valueOf() === fComp.valueOf());
        }

        if (compMatch && isNode(tComp, N.CompoundSelector) && isNode(fComp, N.SimpleSelector)) {
          hasCompoundPartialMatch = true;
        }
        if (compMatch && isNode(tComp, N.CompoundSelector) && isNode(fComp, N.CompoundSelector) && tComp.value.length > fComp.value.length) {
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
  if (find.value.length <= target.value.length) {
    const isSubset = find.value.every(findComp =>
      typeof findComp !== 'string' && target.value.some(targetComp =>
        typeof targetComp !== 'string' && compoundComponentMatches(findComp, targetComp)
      )
    );

    if (isSubset) {
      // Find contiguous slice [start, end) that matches find in order (for wrap :is(matched, extendWith).rest)
      const n = find.value.length;
      let contiguousStart: number | null = null;
      for (let start = 0; start <= target.value.length - n; start++) {
        let match = true;
        for (let j = 0; j < n; j++) {
          const tComp = target.value[start + j];
          const fComp = find.value[j];
          if (!tComp || !fComp || typeof tComp === 'string' || typeof fComp === 'string') {
            match = false;
            break;
          }
          if (!compoundComponentMatches(fComp, tComp)) {
            match = false;
            break;
          }
        }
        if (match) {
          contiguousStart = start;
          break;
        }
      }

      // Calculate remainder after removing matched value
      const remainderComponents = target.value.filter(targetComp =>
        typeof targetComp !== 'string' && !find.value.some(findComp =>
          typeof findComp !== 'string' && compoundComponentMatches(findComp, targetComp)
        )
      );

      const selectorRemainders = remainderComponents.filter((c): c is SimpleSelector => typeof c !== 'string');
      const remainders: Selector[] = selectorRemainders.length === 0
        ? []
        : selectorRemainders.length === 1
          ? [selectorRemainders[0]!]
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
        loc.matchedNode = new CompoundSelector(find.value.slice()).inherit(target) as Selector;
        loc.extensionType = 'wrap';
      } else if (remainders.length > 0) {
        // Non-contiguous: find leftmost subsequence of target indices that matches find in order
        const matchIndices: number[] = [];
        let findIdx = 0;
        for (let i = 0; i < target.value.length && findIdx < find.value.length; i++) {
          const tComp = target.value[i]!;
          const fComp = find.value[findIdx]!;
          if (typeof tComp !== 'string' && typeof fComp !== 'string' && compoundComponentMatches(fComp, tComp)) {
            matchIndices.push(i);
            findIdx++;
          }
        }
        if (matchIndices.length === find.value.length) {
          loc.compoundMatchIndices = matchIndices;
          loc.matchedNode = new CompoundSelector(find.value.slice()).inherit(target) as Selector;
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
    // OPTIMIZATION 3: Special handling for :is() pseudo-value with backtracking
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
  for (let index = 0; index < selectorList.value.length; index++) {
    currentPath.push(index);
    searchWithinSelector(selectorListItemForMatch(selectorList.value[index]!), target, currentPath, locations);
    currentPath.pop();
  }
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
  if (isNode(target, N.PseudoSelector) && target.arg && isSelector(target.arg)) {
    // Look for matching pseudo-value within the compound
    for (let index = 0; index < compound.value.length; index++) {
      const component = compound.value[index]!;
      if (isNode(component, N.PseudoSelector) && arePseudoSelectorsEquivalent(component, target)) {
        currentPath.push(index);
        locations.push(withMatchScope({
          path: [...currentPath],
          matchedNode: component,
          extensionType: 'replace'
        }));
        currentPath.pop();
      }
    }
  }

  // Standard recursive search through each component
  for (let index = 0; index < compound.value.length; index++) {
    const compItem = compound.value[index]!;
    if (typeof compItem === 'string') {
      continue;
    }
    currentPath.push(index);
    searchWithinSelector(compItem, target, currentPath, locations);
    currentPath.pop();
  }

  // OPTIMIZATION 5: Check for partial matches within compound value
  // This enables extending when target is a subset of the compound
  if (isNode(target, N.SimpleSelector)) {
    const targetVal = target.valueOf();

    for (let i = 0; i < compound.value.length; i++) {
      const compI = compound.value[i]!;
      if (typeof compI === 'string') {
        continue;
      }
      if (compI.valueOf() === targetVal) {
        // Found a component that matches target - create partial match
        // Use unique path with component index to distinguish duplicate value
        const remainderComponents = compound.value.filter((_, idx) => idx !== i);
        const selectorRemainders = remainderComponents.filter((c): c is SimpleSelector => typeof c !== 'string');
        const remainders: Selector[] = selectorRemainders.length === 0
          ? []
          : selectorRemainders.length === 1
            ? [selectorRemainders[0]!]
            : [new CompoundSelector(remainderComponents).inherit(compound)];

        currentPath.push(i);
        locations.push(withMatchScope({
          path: [...currentPath],
          matchedNode: compI,
          extensionType: 'replace',
          isPartialMatch: remainders.length > 0,
          remainders
        }));
        currentPath.pop();
      }
    }
  }

  // OPTIMIZATION 6: Compound-to-compound partial matching
  if (isNode(target, N.CompoundSelector) && target.value.length <= compound.value.length) {
    const isSubset = target.value.every(targetComp =>
      compound.value.some(compComp =>
        isNode(targetComp, N.PseudoSelector) && targetComp.arg && isSelector(targetComp.arg)
          ? arePseudoSelectorsEquivalent(compComp, targetComp)
          : compComp.valueOf() === targetComp.valueOf()
      )
    );

    if (isSubset) {
      // Calculate remainder after removing matched value
      const remainderComponents = compound.value.filter(compComp =>
        !target.value.some(targetComp =>
          isNode(targetComp, N.PseudoSelector) && targetComp.arg && isSelector(targetComp.arg)
            ? arePseudoSelectorsEquivalent(compComp, targetComp)
            : compComp.valueOf() === targetComp.valueOf()
        )
      );

      const selectorRemainders = remainderComponents.filter((c): c is SimpleSelector => typeof c !== 'string');
      const remainders: Selector[] = selectorRemainders.length === 0
        ? []
        : selectorRemainders.length === 1
          ? [selectorRemainders[0]!]
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

  for (let index = 0; index < complex.value.length; index++) {
    const component = complex.value[index]!;
    // Skip combinators, only search selector value
    if (!isCombinator(component) && typeof component !== 'string') {
      currentPath.push(index);
      searchWithinSelector(component, target, currentPath, locations);
      currentPath.pop();
    }
  }

  // Post-process: when find matches one component of a multi-component complex selector,
  // that is always a partial match (full mode should reject it). Mark ALL such component
  // matches as partial, not just position 0.
  if (locations.length > initialLocationCount && complex.value.length > 1) {
    for (let i = initialLocationCount; i < locations.length; i++) {
      const location = locations[i]!;
      const lastPathSegment = location.path[location.path.length - 1];

      if (typeof lastPathSegment === 'number') {
        // Match is inside a component of this complex selector
        location.isPartialMatch = true;
        if (lastPathSegment === 0) {
          const remainingComponents = complex.value.slice(1);
          const firstRem = remainingComponents[0];
          if (remainingComponents.length === 1 && firstRem && typeof firstRem !== 'string' && !isCombinator(firstRem)) {
            location.remainders = [firstRem];
          } else if (remainingComponents.length > 0) {
            location.remainders = [new ComplexSelector(remainingComponents).inherit(complex)];
          }
        }
      }
    }
  }

  // OPTIMIZATION 8: Complex selector pattern matching
  // Handle common patterns like descendant, child, sibling value efficiently
  if (isNode(target, N.ComplexSelector)) {
    // Check for structural matches within complex selector patterns
    // This enables extending complex value that contain the target pattern
    tryComplexSelectorPatternMatch(complex, target, currentPath, locations);

    // Try backtracking match for :is() scenarios
    const backtrackResult = tryBacktrackingComplexMatch(complex, target, currentPath);
    if (backtrackResult) {
      locations.push(...backtrackResult);
    }
  }
}

/**
 * Attempts to find pattern matches within complex value
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

      if (isCombinator(targetComp) && isCombinator(complexComp)) {
        // Both are combinators - must match exactly
        if (targetComp.value !== complexComp.value) {
          isMatch = false;
          break;
        }
      } else if (isCombinator(targetComp) || isCombinator(complexComp)) {
        // One is combinator, other is not - no match
        isMatch = false;
        break;
      } else {
        // Both are selector value (skip string combinators)
        if (typeof targetComp === 'string' || typeof complexComp === 'string') {
          // string components act as combinators, already handled above
        } else if (isNode(complexComp, N.CompoundSelector) && !isNode(targetComp, N.CompoundSelector)) {
          // Complex component is compound, target is simple
          // Check if target component appears within the compound
          const foundInCompound = complexComp.value.some(comp =>
            comp && typeof comp !== 'string' && componentsMatch(comp, targetComp)
          );
          if (foundInCompound) {
            // Partial match - calculate remainder
            const remainderComps = complexComp.value.filter(comp =>
              comp && typeof comp !== 'string' && !componentsMatch(comp, targetComp)
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
        } else if (!componentsMatch(targetComp, complexComp)) {
          isMatch = false;
          break;
        }
      }
    }

    if (isMatch) {
      // Found a match! Add remaining value from complex selector
      const postMatchComponents = complexComponents.slice(startPos + targetComponents.length);
      remainingComponents.push(...postMatchComponents);

      // Create remainder selector if there are remaining value
      let remainders: any[] = [];
      if (remainingComponents.length > 0) {
        if (remainingComponents.length === 1 && !isCombinator(remainingComponents[0])) {
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
  const targetComponents = target.value;
  const findComponents = find.value;

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
      if (isCombinator(targetComp) !== isCombinator(findComp)) {
        matches = false;
        break;
      }

      // If both are combinators, they must match exactly
      if (isCombinator(targetComp) && isCombinator(findComp)) {
        if (targetComp.value !== findComp.value) {
          matches = false;
          break;
        }
      } else if (!isCombinator(targetComp) && !isCombinator(findComp)) {
        // If both are value, use existing selector matching logic
        // But also check for partial compound matching
        if (typeof targetComp === 'string' || typeof findComp === 'string') {
          matches = false;
          break;
        }
        let componentMatches = areSelectorArgumentsEquivalent(targetComp, findComp);

        if (!componentMatches) {
          // Check for partial compound matching: .b should match within .b.c
          if (isNode(targetComp, N.CompoundSelector) && isNode(findComp, N.SimpleSelector)) {
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

      // Check for compound-level remainders within the matched value
      for (let i = 0; i < findComponents.length; i++) {
        const targetComp = targetComponents[startIdx + i];
        const findComp = findComponents[i];

        if (!isCombinator(targetComp) && !isCombinator(findComp)) {
          if (isNode(targetComp, N.CompoundSelector) && isNode(findComp, N.SimpleSelector)) {
            // Check if there's a partial match leaving compound remainders
            const matchingComponent = targetComp.value.find(comp => comp.valueOf() === findComp.valueOf());
            if (matchingComponent) {
              // Calculate remainder value within this compound
              const compoundRemainders = targetComp.value.filter(comp => comp.valueOf() !== findComp.valueOf());
              if (compoundRemainders.length > 0) {
                const firstRemainder = compoundRemainders[0]!;
                if (compoundRemainders.length === 1 && typeof firstRemainder !== 'string') {
                  remainders.push(firstRemainder);
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
  // Extract non-combinator value
  const targetComponents = target.value.filter(c => !isCombinator(c));
  const findComponents = find.value.filter(c => !isCombinator(c));

  if (findComponents.length === 0) {
    return null;
  }

  // Special case: Check if target has a compound with :is() that can expand to match find
  for (let i = 0; i < targetComponents.length; i++) {
    const comp = targetComponents[i];

    if (isNode(comp, N.CompoundSelector)) {
      // Look for :is() pseudo-value in the compound
      const isPseudos = comp.value.filter((v): v is PseudoSelector =>
        typeof v !== 'string' && isNode(v, N.PseudoSelector) && v.name === ':is' && !!v.arg && isSelector(v.arg)
      );

      for (const isPseudo of isPseudos) {
        if (!isPseudo.arg) {
          continue;
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const isArg = isPseudo.arg as Selector;

        // If :is() contains a complex selector
        if (isNode(isArg, N.ComplexSelector)) {
          // Get the :is() content value
          const isArgComponents = isArg.value.filter((c): c is Selector => !isCombinator(c) && typeof c !== 'string');

          // Try to match the find pattern
          if (isArgComponents.length >= 2) {
            // Get the last component from :is() (e.g., .b from .a > .b)
            const lastIsComponent = isArgComponents[isArgComponents.length - 1]!;

            // Get other value in the compound (e.g., .d)
            const otherCompoundComponents = comp.value.filter(v => v !== isPseudo);

            // Check if find starts with the :is() pattern (improved structural matching)
            // Only check the prefix value, allowing structural compound matching for the last component
            let matchesIsPattern = true;
            for (let j = 0; j < isArgComponents.length - 1; j++) {
              const isComp = isArgComponents[j]!;
              const fComp = findComponents[j]!;
              if (j >= findComponents.length
                || typeof isComp === 'string' || typeof fComp === 'string'
                || !componentsMatch(isComp, fComp)) {
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
                  const containsTarget = compoundWithIsLast.value.some(comp => comp.valueOf() === findComp.valueOf());
                  if (containsTarget) {
                    compoundMatches = true;
                  }
                } else if (typeof compoundWithIsLast !== 'string' && typeof findComp !== 'string') {
                  compoundMatches = componentsMatch(compoundWithIsLast, findComp);
                }
              }

              if (compoundMatches) {
                // Check if remaining selector value match remaining target
                const targetRemaining = targetComponents.slice(i + 1);
                const findRemaining = findComponents.slice(isArgComponents.length);

                if (targetRemaining.length === findRemaining.length) {
                  let allMatch = true;
                  for (let k = 0; k < targetRemaining.length; k++) {
                    const tRem = targetRemaining[k]!;
                    const fRem = findRemaining[k]!;
                    if (typeof tRem === 'string' || typeof fRem === 'string' || !componentsMatch(tRem, fRem)) {
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
  const arg = pseudo.arg;
  if (!arg || !isSelector(arg)) {
    return;
  }

  const argSelector = arg as Selector;

  // OPTIMIZATION 7: Special handling for :is() pseudo-value
  // Implements sophisticated right-to-left backtracking algorithm from matchSelectors
  if (pseudo.name === ':is') {
    if (isNode(argSelector, N.SelectorList)) {
      // Check if target matches any alternative in the :is() selector list
      currentPath.push('arg');
      for (let altIndex = 0; altIndex < argSelector.value.length; altIndex++) {
        const alternative = selectorListItemForMatch(argSelector.value[altIndex]!);
        currentPath.push(altIndex);
        // Direct structural match: use determineExtensionType so we get 'wrap' when inside a compound (not just 'append')
        if (isStructurallyEqual(alternative, target)) {
          locations.push(withMatchScope({
            path: [...currentPath],
            matchedNode: alternative,
            extensionType: determineExtensionType(alternative, currentPath)
          }));
        }

        // Recursive search within each alternative
        searchWithinSelector(alternative, target, currentPath, locations);
        currentPath.pop();
      }
      currentPath.pop();

      // Additional optimization: Check if target could be added as new alternative
      // This enables extending :is(.a, .b) with .c to become :is(.a, .b, .c)
      const canExtendAsList = !argSelector.value.some(alt => isStructurallyEqual(selectorListItemForMatch(alt), target));
      if (canExtendAsList) {
        currentPath.push('arg');
        locations.push(withMatchScope({
          path: [...currentPath],
          matchedNode: argSelector,
          extensionType: 'append', // Append new alternative to :is() list
          isPartialMatch: false
        }));
        currentPath.pop();
      }
    } else {
      // Single argument in :is() - check for direct match
      if (isStructurallyEqual(argSelector, target)) {
        currentPath.push('arg');
        locations.push(withMatchScope({
          path: [...currentPath],
          matchedNode: argSelector,
          extensionType: 'append', // Will convert single arg to SelectorList and append
          isPartialMatch: false
        }));
        currentPath.pop();
        // Don't do recursive search since we found the direct match
        return;
      }

      // Only do recursive search if no direct match found
      currentPath.push('arg');
      searchWithinSelector(argSelector, target, currentPath, locations);
      currentPath.pop();
    }
  } else {
    // Standard recursive search for other pseudo-value
    currentPath.push('arg');
    searchWithinSelector(argSelector, target, currentPath, locations);
    currentPath.pop();
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
  if (isNode(selector, N.PseudoSelector) && selector.name === ':is' && selector.arg) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const arg = selector.arg as Selector;

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

    for (const sel of selector.value) {
      const normalized = normalizeSelector(selectorListItemForMatch(sel));
      if (isNode(normalized, N.SelectorList)) {
        for (let i = 0; i < normalized.value.length; i++) {
          normalizedSelectors.push(selectorListItemForMatch(normalized.value[i]!));
        }
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

export function selectorMatch(
  find: Selector,
  target: Selector,
  partial = false,
  context?: Context
): {
  fullMatch: boolean;
  partialMatch: boolean;
  matched: Selector[];
  remainders: Selector[];
} {
  if (context && find.compare(target, context) === 0) {
    return {
      fullMatch: true,
      partialMatch: false,
      matched: [target],
      remainders: []
    };
  }
  const comparison = selectorCompare(find, target);
  return {
    fullMatch: comparison.hasWholeMatch,
    partialMatch: partial
      ? comparison.hasWholeMatch || comparison.hasPartialMatch
      : comparison.hasPartialMatch,
    matched: comparison.hasWholeMatch ? [target] : [],
    remainders: []
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
    const aValues = normalizedA.value;
    const bValues = normalizedB.value;
    const equivalent = aValues.length === bValues.length && (() => {
      for (let bIndex = 0; bIndex < bValues.length; bIndex++) {
        const bValue = normalizedSelectorListItemValueForMatch(bValues[bIndex]!);
        let found = false;
        for (let aIndex = 0; aIndex < aValues.length; aIndex++) {
          if (normalizedSelectorListItemValueForMatch(aValues[aIndex]!) === bValue) {
            found = true;
            break;
          }
        }
        if (!found) {
          return false;
        }
      }
      return true;
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
