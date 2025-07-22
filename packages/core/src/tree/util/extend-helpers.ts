import { type Selector } from '../selector';
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
export function isSelector(value: any): boolean {
  return value
    && typeof value === 'object'
    && 'valueOf' in value
    && 'isSelector' in value;
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
 * Extracted from multiple locations with identical logic
 */
export function arePseudoSelectorsEquivalent(a: PseudoSelector, b: PseudoSelector): boolean {
  if (a.value.name !== b.value.name) return false;

  const aArg = a.value.arg;
  const bArg = b.value.arg;

  if (!aArg && !bArg) return true;
  if (!aArg || !bArg) return false;

  if (!isSelector(aArg) || !isSelector(bArg)) {
    return aArg === bArg;
  }

  return areSelectorArgumentsEquivalent(aArg as Selector, bArg as Selector);
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

        expansions.forEach((expansion) => {
          const newComponents = [...expansion.value];
          newComponents.splice(index, 1, ...arg.value); // Replace :is() with its contents
          newExpansions.push(new CompoundSelector(newComponents));
        });

        expansions.push(...newExpansions);
      } else if (isNode(arg, 'SimpleSelector')) {
        // Handle :is() with simple selector argument
        const newExpansions: CompoundSelector[] = [];

        expansions.forEach((expansion) => {
          const newComponents = [...expansion.value];
          newComponents.splice(index, 1, arg); // Replace :is() with the simple selector
          newExpansions.push(new CompoundSelector(newComponents));
        });

        expansions.push(...newExpansions);
      } else if (isNode(arg, 'SelectorList')) {
        // Handle :is() with selector list argument
        const newExpansions: CompoundSelector[] = [];

        expansions.forEach((expansion) => {
          arg.value.forEach((listItem) => {
            const newComponents = [...expansion.value];

            if (isNode(listItem, 'CompoundSelector')) {
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
 * Preserves exact combinator and component matching logic
 */
export function areComplexSelectorsEquivalent(a: ComplexSelector, b: ComplexSelector): boolean {
  if (a.value.length !== b.value.length) return false;

  for (let i = 0; i < a.value.length; i++) {
    const aComp = a.value[i];
    const bComp = b.value[i];

    if (!aComp || !bComp) return false;

    if (isNode(aComp, 'Combinator') && isNode(bComp, 'Combinator')) {
      if (aComp.value !== bComp.value) return false;
    } else if (!isNode(aComp, 'Combinator') && !isNode(bComp, 'Combinator')) {
      if (!componentsMatch(aComp as Selector, bComp as Selector)) return false;
    } else {
      return false;
    }
  }

  return true;
}
