import { Selector } from '../selector';
import { SimpleSelector } from '../selector-simple';
import { SelectorList } from '../selector-list';
import { ComplexSelector } from '../selector-complex';
import { CompoundSelector } from '../selector-compound';
import { PseudoSelector } from '../selector-pseudo';
import { Combinator } from '../combinator';
import { isNode } from './is-node';

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
