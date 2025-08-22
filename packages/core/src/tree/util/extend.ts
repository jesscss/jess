import { type Selector } from '../selector';
import { SimpleSelector } from '../selector-simple';
import { SelectorList } from '../selector-list';
import { ComplexSelector, type ComplexSelectorValue } from '../selector-complex';
import { CompoundSelector } from '../selector-compound';
import { PseudoSelector } from '../selector-pseudo';
import { Combinator } from '../combinator';
import { Ampersand } from '../ampersand';
import { BasicSelector } from '../selector-basic';
import { isNode } from './is-node';
import { findExtendableLocations, applyExtensionAtLocation } from './find-extendable-locations';
import {
  componentsMatch,
  isSelector,
  determineExtensionType,
  buildSelectorPath,
  areCompoundSelectorsEquivalent
} from './extend-helpers';

/**
 * Error types for extend operations
 */
export type ExtendErrorType =
  'NOT_FOUND'
  | 'ELEMENT_CONFLICT'
  | 'ID_CONFLICT'
  | 'AMPERSAND_BOUNDARY';

/**
 * Error type constants for extend operations
 */
export const ExtendErrorType = {
  NOT_FOUND: 'NOT_FOUND' as const,
  ELEMENT_CONFLICT: 'ELEMENT_CONFLICT' as const,
  ID_CONFLICT: 'ID_CONFLICT' as const,
  AMPERSAND_BOUNDARY: 'AMPERSAND_BOUNDARY' as const
} as const;

export class ExtendError extends Error {
  constructor(
    public type: ExtendErrorType,
    message: string,
    public context?: {
      target?: Selector;
      find?: Selector;
      extendWith?: Selector;
      conflictingSelectors?: Selector[];
    }
  ) {
    super(message);
    this.name = 'ExtendError';
  }
}

/**
 * Result structure for extend operations
 */
export interface ExtendResult {
  value: Selector;
  error?: ExtendError;
}

/**
 * Helper to create successful extend results
 */
function createSuccessResult(selector: Selector): ExtendResult {
  return { value: selector };
}

/**
 * Helper to create error extend results
 */
function createErrorResult(selector: Selector, error: ExtendError): ExtendResult {
  return { value: selector, error };
}

/**
 * Creates a deduplicated selector list using simple valueOf() comparison
 * @param selectors - Array of selectors to deduplicate
 * @returns Deduplicated array of selectors
 */
function deduplicateSelectors(selectors: Selector[]): Selector[] {
  const seen = new Set<string>();
  const result: Selector[] = [];

  for (const selector of selectors) {
    const stringValue = selector.valueOf();
    if (!seen.has(stringValue)) {
      seen.add(stringValue);
      result.push(selector);
    }
  }

  return result;
}

/**
 * Wrapper function that provides error information for extend operations.
 * Returns a result object with the extended selector and optional error information.
 *
 * @param target - The selector to extend
 * @param find - The target selector to find matches for
 * @param extendWith - The selector to extend with
 * @param partial - Whether to use partial matching (true) or full matching (false)
 * @param skipAmpersandCheck - Whether to skip ampersand boundary checking (used in recursive calls)
 * @returns ExtendResult with the extended selector and optional error information
 */
export function tryExtendSelector(
  target: Selector,
  find: Selector,
  extendWith: Selector,
  partial: boolean,
  skipAmpersandCheck: boolean = false
): ExtendResult {
  try {
    const result = extendSelector(target, find, extendWith, partial, skipAmpersandCheck);
    return createSuccessResult(result);
  } catch (error) {
    if (error instanceof ExtendError) {
      return createErrorResult(target, error);
    }
    // Re-throw unexpected errors
    throw error;
  }
}

/**
 * Extends a selector by finding matches for a target selector and adding the extension.
 * Throws ExtendError if the extension cannot be performed.
 *
 * @param target - The selector to extend
 * @param find - The target selector to find matches for
 * @param extendWith - The selector to extend with
 * @param partial - Whether to use partial matching (true) or full matching (false)
 * @param skipAmpersandCheck - Whether to skip ampersand boundary checking (used in recursive calls)
 * @returns The extended selector
 * @throws ExtendError if extension fails
 */
export function extendSelector(
  target: Selector,
  find: Selector,
  extendWith: Selector,
  partial: boolean,
  skipAmpersandCheck: boolean = false
): Selector {
  // Use the unified ExtendLocation API for all selector matching
  const searchResult = findExtendableLocations(target, find);

  if (!searchResult.hasMatches) {
    throw new ExtendError(
      'NOT_FOUND',
      'No match found for target selector',
      { target, find, extendWith }
    );
  }

  // Check for ampersand boundary crossing during extension (unless skipped)
  if (!skipAmpersandCheck) {
    const ampersandCrossingInfo = checkAmpersandCrossingDuringExtension(target, find);

    if (ampersandCrossingInfo.crossed) {
      // Convert ExtendLocation to MatchResult for compatibility with ampersand handling
      const location = searchResult.locations[0]!;
      const fallbackMatchResult = {
        hasMatch: true,
        hasFullMatch: !location.isPartialMatch,
        hasPartialMatch: !!location.isPartialMatch,
        matched: [find],
        remainders: location.remainders || []
      };
      const result = handleAmpersandBoundaryCrossing(
        target,
        find,
        extendWith,
        ampersandCrossingInfo.ampersandNode!,
        fallbackMatchResult
      );
      return result;
    }
  }

  // Use the first location found
  const location = searchResult.locations[0]!;

  // Handle partial vs full matching modes
  if (partial) {
    // PARTIAL MATCHING MODE: Create :is() wrappers for component-level matches

    // If it's a root-level match in partial mode, handle remainders
    if (location.path.length === 0) {
      // Check if we have remainders that need to be combined with the extension
      if (location.isPartialMatch && location.remainders && location.remainders.length > 0) {
        const remainder = location.remainders[0]!;

        // Combine remainder with extension
        let combinedExtension: Selector;

        if (isNode(remainder, 'ComplexSelector') && remainder.value.length > 0) {
          // Remainder is complex selector - append extension
          const newComponents = [...remainder.value, extendWith as any];
          combinedExtension = ComplexSelector.create(newComponents).inherit(remainder);
        } else {
          // Simple remainder - create compound or complex as needed
          if (isNode(extendWith, 'ComplexSelector')) {
            const newComponents = [remainder as any, ...extendWith.value];
            combinedExtension = ComplexSelector.create(newComponents).inherit(extendWith);
          } else {
            combinedExtension = createValidatedCompoundSelectorWithErrors([remainder as any, extendWith as any], remainder, { target, find, extendWith });
          }
        }

        return new SelectorList(deduplicateSelectors([target, combinedExtension])).inherit(target);
      }

      // Special case: Check if this is a complex selector partial match case
      // where we should extract remainder from compound selector structure
      if (location.isPartialMatch && isNode(target, 'ComplexSelector') && isNode(find, 'ComplexSelector')) {
        // Try to detect if we have a case like .a>.b.c matching .a>.b
        const selectorComponents = target.value;
        const findComponents = find.value;

        // Check if target is a prefix of selector structure
        if (findComponents.length <= selectorComponents.length) {
          let foundCompoundRemainder = false;
          let compoundRemainder: Selector | null = null;

          // Check each component for partial compound matches
          for (let i = 0; i < findComponents.length; i++) {
            const sComp = selectorComponents[i];
            const tComp = findComponents[i];

            if (sComp && tComp && !isNode(sComp, 'Combinator') && !isNode(tComp, 'Combinator')) {
              // Check if find component partially matches selector component
              if (isNode(sComp, 'CompoundSelector') && isNode(tComp, 'SimpleSelector')) {
                const matchingElement = sComp.value.find(el => el.valueOf() === tComp.valueOf());
                if (matchingElement) {
                  // Found partial match - extract remainder
                  const remainderElements = sComp.value.filter(el => el.valueOf() !== tComp.valueOf());
                  if (remainderElements.length > 0) {
                    compoundRemainder = remainderElements.length === 1
                      ? remainderElements[0]!
                      : createValidatedCompoundSelectorWithErrors(remainderElements, sComp, { target, find, extendWith }) as Selector;
                    foundCompoundRemainder = true;
                  }
                }
              }
            }
          }

          if (foundCompoundRemainder && compoundRemainder) {
            // Create combined extension with remainder
            const combinedExtension = createValidatedCompoundSelectorWithErrors([compoundRemainder as any, extendWith as any], compoundRemainder, { target, find, extendWith });
            return new SelectorList(deduplicateSelectors([target, combinedExtension])).inherit(target);
          }
        }
      }

      return new SelectorList(deduplicateSelectors([target, extendWith])).inherit(target);
    }

    // For deeper matches in partial mode, we need to analyze the context
    // If we're matching within a compound selector, create :is() wrapper
    if (location.path.length > 0) {
      return handlePartialModeExtension(target, location, extendWith);
    }

    return applyExtensionAtLocation(target, location, extendWith);
  } else {
    // FULL MATCHING MODE: Create selector lists for complete matches

    // Check if this is a root-level full match (should create selector list)
    if (location.path.length === 0 && location.extensionType === 'replace' && !location.isPartialMatch) {
      // This is a full match at the root - create selector list with both original and extension
      return new SelectorList(deduplicateSelectors([target, extendWith])).inherit(target);
    }

    // Special handling for pseudo-selector matches in full mode
    // All pseudo-selectors with selector arguments allow extending inside
    // This includes :is(), :where(), :not(), :has(), and any other pseudo-selector with selector args
    if (location.path.includes('arg') && !location.isPartialMatch) {
      // Check if this is a compound target that fully matches a compound selector
      // In this case, create a selector list instead of extending inside the pseudo-selector
      if (isNode(find, 'CompoundSelector') && isNode(target, 'CompoundSelector')) {
        // This is a full compound match - create selector list
        return new SelectorList(deduplicateSelectors([target, extendWith])).inherit(target);
      }

      // This is a full match inside a pseudo-selector argument
      // Always extend inside pseudo-selectors with selector arguments
      return applyExtensionAtLocation(target, location, extendWith);
    }

    // For full matches within compound selectors, create :is() wrapper
    if (location.path.length === 1 && isNode(target, 'CompoundSelector')) {
      // This is a component match within a compound selector
      const componentIndex = location.path[0] as number;
      const matchedComponent = target.value[componentIndex];

      if (matchedComponent && target.value.length > 1) {
        // Replace the matched component with :is(original, extension)
        const newComponents = [...target.value];
        const isWrapper = createValidatedIsWrapperWithErrors([matchedComponent, extendWith], matchedComponent, target, { target, find, extendWith });

        newComponents[componentIndex] = isWrapper as any;
        return createValidatedCompoundSelectorWithErrors(newComponents, target, { target, find, extendWith });
      }
    }

    // For full matches at deeper levels, still apply the extension
    return applyExtensionAtLocation(target, location, extendWith);
  }
}

/**
 * Handles extension in partial matching mode - creates :is() wrappers for component-level matches
 */
function handlePartialModeExtension(
  target: Selector,
  location: any,
  extendWith: Selector
): Selector {
  // In partial mode, we want to create :is() wrappers for component-level matches
  // This is the behavior expected by tests like ".a>.b" + ".b" extend ".c" → ".a>:is(.b,.c)"

  // Handle direct compound selector partial matching (.a.b + .b extend .c → .a:is(.b, .c))
  if (location.path.length === 1 && isNode(target, 'CompoundSelector')) {
    const componentIndex = location.path[0] as number;
    const matchedComponent = target.value[componentIndex];

    if (matchedComponent) {
      // Replace the matched component with :is(original, extension)
      const newComponents = [...target.value];
      const isWrapper = createValidatedIsWrapperWithErrors([matchedComponent, extendWith], matchedComponent, target);

      newComponents[componentIndex] = isWrapper as any;
      return createValidatedCompoundSelectorWithErrors(newComponents, target);
    }
  }

  // Handle compound selector match within complex selector
  if (location.path.length === 1 && isNode(target, 'ComplexSelector')) {
    // This is a direct component match in a complex selector
    const componentIndex = location.path[0] as number;
    const components = target.value;
    const matchedComponent = components[componentIndex];

    if (matchedComponent && !isNode(matchedComponent, 'Combinator')) {
      // Replace the matched component with :is(original, extension)
      const newComponents = [...components];
      newComponents[componentIndex] = createIsWrapper([matchedComponent, extendWith], matchedComponent);
      return ComplexSelector.create(newComponents).inherit(target);
    }
  }

  // For compound selector matches within complex selectors
  if (location.path.length === 2 && isNode(target, 'ComplexSelector')) {
    const [componentIndex, subIndex] = location.path;
    const components = target.value;
    const component = components[componentIndex as number];

    if (component && isNode(component, 'CompoundSelector')) {
      // We're matching a part of a compound selector within a complex selector
      const matchedElement = component.value[subIndex as number];
      if (matchedElement) {
        // Replace the matched element with :is(original, extension)
        const newSubComponents = [...component.value];
        newSubComponents[subIndex as number] = createIsWrapper([matchedElement, extendWith], matchedElement);

        const newComponent = createValidatedCompoundSelectorWithErrors(newSubComponents, component);

        const newComponents = [...components];
        newComponents[componentIndex as number] = newComponent as any;

        return ComplexSelector.create(newComponents).inherit(target);
      }
    }
  }

  // Default: apply extension directly
  return applyExtensionAtLocation(target, location, extendWith);
}

/**
 * Handles full match extension - adds the extension as a new alternative
 * @param target - The selector to extend (what we're searching within)
 * @param find - The selector that was matched (what we were searching for)
 * @param extendWith - The selector to add as an alternative
 * @param matchResult - The result from the selector matching operation
 * @returns Extended selector with the new alternative
 */
function handleFullExtend(
  target: Selector,
  find: Selector,
  extendWith: Selector,
  matchResult: any
): Selector {
  // For full matches, we add the extension as a new selector in a list

  // If target is already a selector list, add to it
  if (isNode(target, 'SelectorList')) {
    const newSelectors = deduplicateSelectors([...target.value, extendWith]);
    // Use clone to preserve comments
    const copyForInheritance = target.clone();
    return SelectorList.create(newSelectors).inherit(copyForInheritance);
  }

  // If target is a pseudo-selector with selector arguments, check if we should extend arguments or create selector list
  if (isNode(target, 'PseudoSelector')) {
    const arg = target.value.arg;
    // Only extend arguments for :is() pseudo-selectors or when the find is NOT the complete pseudo-selector
    // For other pseudo-selectors like :where(), when the entire pseudo-selector is matched, create a selector list
    if (arg && (arg as any).isSelector && target.value.name === ':is') {
      if (isNode(arg, 'SelectorList')) {
        // Add to existing selector list
        const newSelectors = deduplicateSelectors([...arg.value, extendWith]);
        const newArg = SelectorList.create(newSelectors).inherit(arg);        // If the original selector was generated, we can mutate it in place for performance
        if (target.generated) {
          target.value.arg = newArg;
          return target;
        } else {
          // For authored selectors, create a new one to preserve the original
          return new PseudoSelector({
            name: target.value.name,
            arg: newArg
          }).inherit(target);
        }
      } else {
        // Convert single selector to list and add extension
        const newSelectors = deduplicateSelectors([arg as Selector, extendWith]);
        const newArg = SelectorList.create(newSelectors).inherit(arg);

        // If the original selector was generated, we can mutate it in place for performance
        if (target.generated) {
          target.value.arg = newArg;
          return target;
        } else {
          // For authored selectors, create a new one to preserve the original
          return new PseudoSelector({
            name: target.value.name,
            arg: newArg
          }).inherit(target);
        }
      }
    }
    // For non-:is() pseudo-selectors or when find matches the entire pseudo-selector,
    // fall through to create a selector list
  }

  // For compound selectors, check if we need special handling for pseudo-classes
  if (isNode(target, 'CompoundSelector')) {
    return handleCompoundFullExtend(target, find, extendWith, matchResult);
  }

  // Default case: create a new selector list
  const copyForInheritance = target.clone();
  return SelectorList.create(deduplicateSelectors([target, extendWith])).inherit(copyForInheritance);
}

/**
 * Handles full extend for compound selectors containing :is() or pseudo-classes
 * @param target - The compound selector to extend (what we're searching within)
 * @param find - The selector that was matched (what we were searching for)
 * @param extendWith - The selector to add as an alternative
 * @param matchResult - The result from the selector matching operation
 * @returns Extended compound selector or new selector list
 */
function handleCompoundFullExtend(
  target: CompoundSelector,
  find: Selector,
  extendWith: Selector,
  matchResult: any
): Selector {
  // Single loop to handle both :is() extension and regular component matching
  for (let i = 0; i < target.value.length; i++) {
    const comp = target.value[i];
    if (!comp) continue;

    // Check if this is an existing :is() pseudo-selector that might contain the find
    // ONLY :is() allows boundary crossing - all other pseudo-selectors are atomic units
    if (isNode(comp, 'PseudoSelector') && comp.value.name === ':is') {
      const arg = comp.value.arg;
      if (arg && (arg as any).isSelector) {
        const isSearchResult = findExtendableLocations(arg as Selector, find);
        if (isSearchResult.hasMatches) {
          // Extend the :is() argument using the standard API
          const extendedArg = extendSelector(arg as Selector, find, extendWith, false, true);

          // If the original selector was generated, we can mutate the :is() component in place
          if (target.generated) {
            comp.value.arg = extendedArg;
            return target;
          } else {
            // For authored selectors, create new compound with updated :is()
            const newComponents = [...target.value];
            newComponents[i] = new PseudoSelector({
              name: ':is',
              arg: extendedArg
            }).inherit(comp);

            return createValidatedCompoundSelectorWithErrors(newComponents, target);
          }
        }
      }
    } else {
      // Check if this component matches the find
      const compSearchResult = findExtendableLocations(comp, find);
      if (compSearchResult.hasMatches && target.value.length > 1) {
        // This compound has multiple components - replace matched component with :is() wrapper
        const isWrapper = createIsWrapper([comp, extendWith], comp);

        // Replace the matched component with :is() wrapper in place
        const newComponents = [...target.value];
        newComponents[i] = isWrapper;

        return createValidatedCompoundSelectorWithErrors(newComponents, target);
      }
    }
  }

  // If no special handling needed, create a selector list
  return SelectorList.create(deduplicateSelectors([target, extendWith])).inherit(target);
}

/**
 * Handles partial match extension - modifies the selector structure to include the extension
 * @param target - The selector to extend (what we're searching within)
 * @param find - The selector that was partially matched (what we were searching for)
 * @param extendWith - The selector to add as an alternative
 * @param matchResult - The result from the partial selector matching operation
 * @returns Extended selector with remainders properly handled
 */
function handlePartialExtend(
  target: Selector,
  find: Selector,
  extendWith: Selector,
  matchResult: any
): Selector {
  if (!matchResult.hasPartialMatch) {
    // Full match in partial mode - treat like full extend
    return handleFullExtend(target, find, extendWith, matchResult);
  }

  // We have a partial match with remainders
  // Strategy: Replace the matched part with :is(matched, extendWith) and keep remainders

  if (isNode(target, 'ComplexSelector')) {
    return handleComplexPartialExtend(target as ComplexSelector, find, extendWith, matchResult);
  }

  if (isNode(target, 'CompoundSelector')) {
    return handleCompoundPartialExtend(target as CompoundSelector, find, extendWith, matchResult);
  }

  // For simple cases, wrap in :is()
  return createIsWrapper([find, extendWith], target);
}

/**
 * Handles partial extension for complex selectors
 * @param target - The complex selector to extend (what we're searching within)
 * @param find - The selector that was partially matched (what we were searching for)
 * @param extendWith - The selector to add as an alternative
 * @param matchResult - The result from the partial selector matching operation
 * @returns Extended complex selector with proper remainder handling
 */
function handleComplexPartialExtend(
  target: ComplexSelector,
  find: Selector,
  extendWith: Selector,
  matchResult: any
): Selector {  // If the top-level match result has remainders from cross-selector matching,
  // handle them by creating remainder+extension combinations
  if (matchResult.hasPartialMatch && matchResult.remainders && matchResult.remainders.length > 0
    && matchResult.matched && matchResult.matched.length > 0 && !isNode(find, 'SimpleSelector')) {
    // Only apply remainder logic for complex finds that match across selector structure
    const remainderSelector = matchResult.remainders[0]; // Take the first remainder
    let combinedExtension: Selector;

    if (isNode(remainderSelector, 'ComplexSelector') || isNode(remainderSelector, 'CompoundSelector')) {
      // For complex remainders, combine with extension
      if (isNode(extendWith, 'ComplexSelector')) {
        // Both are complex - need to combine structures
        combinedExtension = ComplexSelector.create([...remainderSelector.value, ...extendWith.value]).inherit(remainderSelector);
      } else {
        // Remainder is complex, extension is simple - append extension
        const newComponents = [...(remainderSelector.value || [remainderSelector])];
        newComponents.push(extendWith as any); // Type assertion for complex selector components
        combinedExtension = ComplexSelector.create(newComponents).inherit(remainderSelector);
      }
    } else {
      // Simple remainder - create compound with extension
      if (isNode(extendWith, 'ComplexSelector')) {
        // Extension is complex, remainder is simple - prepend remainder
        combinedExtension = ComplexSelector.create([remainderSelector as any, ...extendWith.value]).inherit(remainderSelector);
      } else {
        // Both simple - create compound
        combinedExtension = createValidatedCompoundSelectorWithErrors([remainderSelector as any, extendWith as any], remainderSelector);
      }
    }

    // Return selector list: original + combined remainder+extension
    return SelectorList.create(deduplicateSelectors([target, combinedExtension])).inherit(target);
  }

  // Original logic for component-level matching
  const components = target.value;

  // Find the component that matches the find
  for (let i = 0; i < components.length; i++) {
    const component = components[i];

    // Skip combinators
    if (isNode(component, 'Combinator')) {
      continue;
    }

    if (component) {
      const compSearchResult = findExtendableLocations(component, find);

      if (compSearchResult.hasMatches) {
        // Found matching component - replace with :is() wrapper
        const newComponents = [...components];
        const location = compSearchResult.locations[0]!;

        if (location.isPartialMatch && location.remainders && location.remainders.length > 0) {
          // Partial match within this component - need to handle remainders
          if (isNode(component, 'CompoundSelector')) {
            // Component is compound - apply the extension using the new API
            const extendedComponent = applyExtensionAtLocation(component, location, extendWith);
            newComponents[i] = extendedComponent as any; // Type assertion needed for ComplexSelectorComponent
          } else {
            // Simple component - replace with :is() wrapper
            newComponents[i] = createIsWrapper([component, extendWith], component);
          }
        } else {
          // Full match of this component within a complex selector
          // Since there are other components (remainders), we need :is() wrapper
          newComponents[i] = createIsWrapper([component, extendWith], component);
        }

        return ComplexSelector.create(newComponents).inherit(target);
      }
    }
  }

  // No component matched - fallback to creating selector list
  return SelectorList.create(deduplicateSelectors([target, extendWith])).inherit(target);
}

/**
 * Handles partial extension for compound selectors
 * @param target - The compound selector to extend (what we're searching within)
 * @param find - The selector that was partially matched (what we were searching for)
 * @param extendWith - The selector to add as an alternative
 * @param matchResult - The result from the partial selector matching operation
 * @returns Extended compound selector with :is() wrapper
 */
function handleCompoundPartialExtend(
  target: CompoundSelector,
  find: Selector,
  extendWith: Selector,
  matchResult: any
): Selector {
  // Find the component that matched and replace it with :is()
  for (let i = 0; i < target.value.length; i++) {
    const comp = target.value[i];
    if (comp) {
      const compSearchResult = findExtendableLocations(comp, find);

      if (compSearchResult.hasMatches) {
        // Replace this component with :is(original, extension)
        // IMPORTANT: Use comp instead of find to preserve comments!
        const newComponents = [...target.value];
        newComponents[i] = createIsWrapper([comp, extendWith], comp);

        return createValidatedCompoundSelectorWithErrors(newComponents, target);
      }
    }
  }

  // If no direct component match, use the whole compound approach
  return createIsWrapper([target, extendWith], target);
}

/**
 * Creates an :is() wrapper around the given selectors
 * Preserves comments on original selectors, strips them from inheritance chain
 */
function createIsWrapper(selectors: Selector[], inheritFrom: Selector): PseudoSelector {
  // Strip comments only from the inheritance chain to avoid duplication on the wrapper
  const copyForInheritance = inheritFrom.copy();

  // Create selectorList with original selectors (preserving their comments)
  const selectorList = SelectorList.create(deduplicateSelectors(selectors));

  // Create PseudoSelector using the create factory method - same signature as constructor but marks as generated
  const pseudoSelector = PseudoSelector.create({
    name: ':is',
    arg: selectorList
  }).inherit(copyForInheritance) as PseudoSelector;

  return pseudoSelector;
}

/**
 * Creates an :is() wrapper with validation to prevent invalid combinations
 * Returns the original selector if the combination would be invalid
 */
function createValidatedIsWrapper(
  selectors: Selector[],
  inheritFrom: Selector,
  fallbackSelector: Selector,
  contextSelector?: Selector
): PseudoSelector | Selector {
  // If we have a context selector (the compound this :is() will be placed in),
  // check if the :is() contents would conflict with the context
  if (contextSelector && isNode(contextSelector, 'CompoundSelector')) {
    // Count elements/IDs in the context (excluding what we're replacing)
    let contextElements = 0;
    let contextIds = 0;

    for (const child of contextSelector.value) {
      if (isNode(child, 'BasicSelector')) {
        if (child.isTag) contextElements++;
        if (child.isId) contextIds++;
      }
    }

    // Now check if any selector in the :is() would conflict with the context
    for (const selector of selectors) {
      let selectorElements = 0;
      let selectorIds = 0;

      if (isNode(selector, 'BasicSelector')) {
        if (selector.isTag) selectorElements++;
        if (selector.isId) selectorIds++;
      } else if (isNode(selector, 'CompoundSelector')) {
        for (const child of selector.value) {
          if (isNode(child, 'BasicSelector')) {
            if (child.isTag) selectorElements++;
            if (child.isId) selectorIds++;
          }
        }
      }

      // Debug: log what we're checking
      // console.log('Context validation:', {
      //   context: contextSelector.valueOf(),
      //   contextElements,
      //   contextIds,
      //   selector: selector.valueOf(),
      //   selectorElements,
      //   selectorIds,
      //   wouldConflict: (contextElements > 0 && selectorElements > 0) || (contextIds > 0 && selectorIds > 0)
      // });

      // If this selector would conflict with the context, fail validation
      if ((contextElements > 0 && selectorElements > 0) || (contextIds > 0 && selectorIds > 0)) {
        // console.log('Context validation failed - returning fallback');
        return fallbackSelector;
      }
    }
  } else {
    // Original validation for standalone :is() without context
    let elementCount = 0;
    let idCount = 0;

    for (const selector of selectors) {
      if (isNode(selector, 'BasicSelector')) {
        if (selector.isTag) elementCount++;
        if (selector.isId) idCount++;
      } else if (isNode(selector, 'CompoundSelector')) {
        for (const child of selector.value) {
          if (isNode(child, 'BasicSelector')) {
            if (child.isTag) elementCount++;
            if (child.isId) idCount++;
          }
        }
      }
    }

    // Debug: log what we're checking
    // console.log('Standalone validation check:', selectors.map(s => s.valueOf()), 'elements:', elementCount, 'ids:', idCount);

    // If we'd have duplicate elements or IDs, return the fallback
    if (elementCount > 1 || idCount > 1) {
      // console.log('Standalone validation failed - returning fallback');
      return fallbackSelector;
    }
  }

  return createIsWrapper(selectors, inheritFrom);
}

/**
 * Creates an :is() wrapper with validation that throws errors on conflicts
 * @param selectors - Array of selectors to wrap in :is()
 * @param inheritFrom - Selector to inherit properties from
 * @param contextSelector - Optional context selector to check for conflicts
 * @param context - Context information for error reporting
 * @returns Valid :is() pseudo-selector
 * @throws ExtendError if validation fails
 */
function createValidatedIsWrapperWithErrors(
  selectors: Selector[],
  inheritFrom: Selector,
  contextSelector?: Selector,
  context?: {
    target?: Selector;
    find?: Selector;
    extendWith?: Selector;
  }
): PseudoSelector {
  const validation = validateIsWrapper(selectors, contextSelector);
  if (!validation.isValid) {
    throw new ExtendError(
      validation.errorType!,
      validation.errorMessage!,
      context
    );
  }

  return createIsWrapper(selectors, inheritFrom);
}

/**
 * Enhanced validation for :is() wrappers that returns detailed error information
 */
function validateIsWrapper(
  selectors: Selector[],
  contextSelector?: Selector
): {
  isValid: boolean;
  errorType?: ExtendErrorType;
  errorMessage?: string;
  conflictingSelectors?: Selector[];
} {
  // If we have a context selector (the compound this :is() will be placed in),
  // check if the :is() contents would conflict with the context
  if (contextSelector && isNode(contextSelector, 'CompoundSelector')) {
    // Collect all elements and IDs from context
    const contextElementTypes = new Set<string>();
    const contextIdValues = new Set<string>();

    for (const child of contextSelector.value) {
      if (isNode(child, 'BasicSelector')) {
        if (child.isTag) {
          contextElementTypes.add(child.value.toLowerCase());
        }
        if (child.isId) {
          contextIdValues.add(child.value);
        }
      }
    }

    // Collect all elements and IDs from all selectors in the :is()
    const allElementTypes = new Set<string>(contextElementTypes);
    const allIdValues = new Set<string>(contextIdValues);

    for (const selector of selectors) {
      if (isNode(selector, 'BasicSelector')) {
        if (selector.isTag) {
          allElementTypes.add(selector.value.toLowerCase());
        }
        if (selector.isId) {
          allIdValues.add(selector.value);
        }
      } else if (isNode(selector, 'CompoundSelector')) {
        for (const child of selector.value) {
          if (isNode(child, 'BasicSelector')) {
            if (child.isTag) {
              allElementTypes.add(child.value.toLowerCase());
            }
            if (child.isId) {
              allIdValues.add(child.value);
            }
          }
        }
      }
    }

    // Check for conflicts: multiple different element types or multiple different IDs
    if (allElementTypes.size > 1) {
      const elementList = Array.from(allElementTypes);
      return {
        isValid: false,
        errorType: 'ELEMENT_CONFLICT',
        errorMessage: `Cannot combine different element types in compound selector: ${elementList.join(', ')}`,
        conflictingSelectors: [] // We could collect the actual selector objects if needed
      };
    }
    if (allIdValues.size > 1) {
      const idList = Array.from(allIdValues);
      return {
        isValid: false,
        errorType: 'ID_CONFLICT',
        errorMessage: `Cannot combine different ID selectors in compound selector: ${idList.join(', ')}`,
        conflictingSelectors: [] // We could collect the actual selector objects if needed
      };
    }
  } else {
    // Original validation for standalone :is() without context
    const elementTypes = new Set<string>();
    const idValues = new Set<string>();

    for (const selector of selectors) {
      if (isNode(selector, 'BasicSelector')) {
        if (selector.isTag) {
          elementTypes.add(selector.value.toLowerCase());
        }
        if (selector.isId) {
          idValues.add(selector.value);
        }
      } else if (isNode(selector, 'CompoundSelector')) {
        for (const child of selector.value) {
          if (isNode(child, 'BasicSelector')) {
            if (child.isTag) {
              elementTypes.add(child.value.toLowerCase());
            }
            if (child.isId) {
              idValues.add(child.value);
            }
          }
        }
      }
    }

    // If we'd have multiple different element types or IDs, fail validation
    if (elementTypes.size > 1) {
      const elementList = Array.from(elementTypes);
      return {
        isValid: false,
        errorType: 'ELEMENT_CONFLICT',
        errorMessage: `Cannot combine different element types in :is(): ${elementList.join(', ')}`,
        conflictingSelectors: [] // We could collect the actual selectors if needed
      };
    }
    if (idValues.size > 1) {
      const idList = Array.from(idValues);
      return {
        isValid: false,
        errorType: 'ID_CONFLICT',
        errorMessage: `Cannot combine different ID selectors in :is(): ${idList.join(', ')}`,
        conflictingSelectors: [] // We could collect the actual selectors if needed
      };
    }
  }

  return { isValid: true };
}

/**
 * Checks if extending the target would cross an ampersand boundary
 * This is simpler than the old analyzeAmpersandBoundary - we just check if:
 * 1. Selector contains ampersands with resolved values
 * 2. Target would match the resolved form of those ampersands
 * @param selector - The selector containing potential ampersands
 * @param target - The target selector being extended
 * @returns Information about ampersand boundary crossing
 */
function checkAmpersandCrossingDuringExtension(selector: Selector, target: Selector): {
  crossed: boolean;
  ampersandNode?: Ampersand;
} {
  // Find ampersands in the selector
  const ampersandNodes = findAmpersandsInSelector(selector);

  for (const { ampersand } of ampersandNodes) {
    // Skip ampersands without resolved selectors
    if (!ampersand.value.selector || isNode(ampersand.value.selector, 'Nil')) {
      continue;
    }

    // Create resolved version by replacing ampersand with its resolved selector
    const resolvedSelector = replaceAmpersandWithItsValue(selector, ampersand);

    // Check if target matches the resolved version
    const resolvedSearchResult = findExtendableLocations(resolvedSelector, target);

    // Also check if target matches the selector without this ampersand
    const selectorWithoutAmpersand = replaceAmpersandWithEmpty(selector, ampersand);
    const nonAmpersandSearchResult = findExtendableLocations(selectorWithoutAmpersand, target);

    if (resolvedSearchResult.hasMatches && !nonAmpersandSearchResult.hasMatches) {
      // Target only matches when ampersand is resolved = boundary crossing
      return {
        crossed: true,
        ampersandNode: ampersand
      };
    }
  }

  return { crossed: false };
}

/**
 * Finds all ampersand nodes in a selector
 * @param selector - The selector to search
 * @returns Array of ampersand nodes
 */
function findAmpersandsInSelector(selector: Selector): Array<{ ampersand: Ampersand }> {
  const results: Array<{ ampersand: Ampersand }> = [];

  // Use the nodes() iterator to traverse all nodes recursively
  for (const node of selector.nodes()) {
    if (isNode(node, 'Ampersand')) {
      results.push({ ampersand: node });
    }
  }

  return results;
}

/**
 * Creates a version of the selector with the specified ampersand replaced by its resolved value
 * @param selector - The selector containing the ampersand
 * @param ampersand - The ampersand node to replace
 * @returns Selector with ampersand replaced by its resolved selector
 */
function replaceAmpersandWithItsValue(selector: Selector, ampersand: Ampersand): Selector {
  if (!ampersand.value.selector) {
    return selector;
  }

  // Create a copy of the selector
  const selectorCopy = selector.copy();
  const resolvedSelector = ampersand.value.selector.copy();

  // Find and replace the ampersand node using the existing helper functions
  for (const node of selectorCopy.nodes()) {
    if (isNode(node, 'Ampersand') && node.value.selector?.valueOf() === ampersand.value.selector?.valueOf()) {
      // Replace the ampersand with its resolved selector using existing helper
      const parent = findParentOfNode(selectorCopy, node);
      if (parent) {
        replaceNodeInParent(parent, node, resolvedSelector.inherit(ampersand));
      }
      break; // Only replace the first matching ampersand
    }
  }

  return selectorCopy;
}

/**
 * Creates a version of the selector with the ampersand removed (for boundary analysis)
 * @param selector - The selector containing the ampersand
 * @param ampersand - The ampersand node to remove
 * @returns Selector with ampersand removed
 */
function replaceAmpersandWithEmpty(selector: Selector, ampersand: Ampersand): Selector {
  // Create a copy of the selector
  const selectorCopy = selector.copy();

  // Find and remove the ampersand node
  for (const node of selectorCopy.nodes()) {
    if (node === ampersand || (isNode(node, 'Ampersand')
      && node.value.selector === ampersand.value.selector)) {
      // We need to find the parent container and remove the ampersand
      const parent = findParentOfNode(selectorCopy, node);
      if (parent && isNode(parent, 'CompoundSelector')) {
        // Remove from compound selector
        parent.value = parent.value.filter((n: any) => n !== node);
      }
      break;
    }
  }

  return selectorCopy;
}

/**
 * Handles extension when it crosses an ampersand boundary
 * @param selector - The original selector
 * @param target - The target being extended
 * @param extendWith - The selector to extend with
 * @param ampersandNode - The ampersand node that was crossed
 * @param matchResult - The match result
 * @returns Extended selector with ampersand resolved and hoisted to root
 */
function handleAmpersandBoundaryCrossing(
  selector: Selector,
  target: Selector,
  extendWith: Selector,
  ampersandNode: Ampersand,
  matchResult: any
): Selector {
  if (!ampersandNode?.value.selector || isNode(ampersandNode.value.selector, 'Nil')) {
    throw new Error('Ampersand boundary crossing detected but ampersand has no resolved selector');
  }

  // Step 1: Replace the ampersand with its resolved selector
  const resolvedSelector = replaceAmpersandWithItsValue(selector, ampersandNode);

  // Step 2: Extend the resolved selector (skip ampersand check to prevent recursion)
  const extendedSelector = extendSelector(resolvedSelector, target, extendWith, false, true);

  // Step 3: Mark for hoisting to root
  return markSelectorForHoisting(extendedSelector);
}

/**
 * Finds the parent container of a specific node
 * @param root - The root selector to search in
 * @param targetNode - The node to find the parent of
 * @returns The parent container or null if not found
 */
function findParentOfNode(root: Selector, targetNode: any): any {
  for (const node of root.nodes()) {
    if (isNode(node, 'CompoundSelector') || isNode(node, 'ComplexSelector') || isNode(node, 'SelectorList')) {
      for (let i = 0; i < node.value.length; i++) {
        if (node.value[i] === targetNode) {
          return node;
        }
      }
    } else if (isNode(node, 'PseudoSelector') && node.value.arg === targetNode) {
      return node;
    }
  }
  return null;
}

/**
 * Replaces a node within its parent container
 * @param parent - The parent container
 * @param oldNode - The node to replace
 * @param newNode - The replacement node
 */
function replaceNodeInParent(parent: any, oldNode: any, newNode: any): void {
  if (isNode(parent, 'CompoundSelector') || isNode(parent, 'ComplexSelector') || isNode(parent, 'SelectorList')) {
    for (let i = 0; i < parent.value.length; i++) {
      if (parent.value[i] === oldNode) {
        parent.value[i] = newNode;
        break;
      }
    }
  } else if (isNode(parent, 'PseudoSelector') && parent.value.arg === oldNode) {
    parent.value.arg = newNode;
  }
}

/**
 * Marks a selector for hoisting to root by setting hoistToRoot option
 * @param selector - The selector to mark for hoisting
 * @returns Selector marked for hoisting
 */
function markSelectorForHoisting(selector: Selector): Selector {
  // Clone the selector and set hoistToRoot option
  const hoistedSelector = selector.copy();
  hoistedSelector.options.hoistToRoot = true;
  return hoistedSelector;
}

/**
 * Optimizes unnecessary :is() wrapper only at the top level
 * Only removes :is() when the entire result would be just a standalone :is() wrapper
 * that was generated during compilation (has generated: true on the node)
 * @param selector - The selector to check for optimization
 * @returns Optimized selector or original if no optimization needed
 */
function optimizeTopLevelUnnecessaryIsWrapper(selector: Selector): Selector {
  // Only optimize standalone :is() pseudo-selectors (not part of a compound)
  // that were generated during compilation
  if (isNode(selector, 'PseudoSelector')
    && selector.value.name === ':is'
    && selector.generated === true) { // Explicit check for true to avoid falsy values
    const arg = selector.value.arg;
    if (arg && (arg as any).isSelector) {
      // This is a standalone :is() generated by extend - unwrap it since :is() is only needed when combined with other components
      return (arg as Selector).inherit(selector);
    }
  }

  // Do NOT optimize:
  // - :is() that existed in the original selector (without generated: true)
  // - Compound selectors like &:is(.bar, .a) - the :is() is necessary there
  // - Selector lists - they have their own structure
  // - Complex selectors - they have their own structure

  return selector;
}

/**
 * Handles partial extension at root level
 */
function handlePartialExtendAtRoot(selector: Selector, target: Selector, extendWith: Selector): Selector {
  // For partial matches at root, we typically want to wrap with :is() if it's compound
  if (isNode(selector, 'CompoundSelector') && selector.value.length > 1) {
    const isArg = SelectorList.create(deduplicateSelectors([target, extendWith])).inherit(target);
    const pseudoSelector = new PseudoSelector({ name: ':is', arg: isArg });
    return new SelectorList(deduplicateSelectors([pseudoSelector, ...selector.value.slice(1)])).inherit(selector);
  }

  // Default to selector list for root-level partial matches
  return new SelectorList(deduplicateSelectors([selector, extendWith])).inherit(selector);
}

/**
 * Checks if partial match processing is needed
 */
function needsPartialMatchProcessing(result: Selector, location: any): boolean {
  // Only need processing for complex selector results
  return isNode(result, 'ComplexSelector') || isNode(result, 'CompoundSelector');
}

/**
 * Processes partial match results to handle remainders properly
 */
function processPartialMatchResult(
  result: Selector,
  selector: Selector,
  target: Selector,
  extendWith: Selector,
  location: any
): Selector {
  // For now, return the result as-is
  // This is where we would handle complex partial match scenarios
  return result;
}

/**
 * Handles extension location in partial mode - creates :is() wrappers
 */
function handleExtendLocationPartial(
  selector: Selector,
  location: any,
  extendWith: Selector
): Selector {
  // Apply extension - this will create selector lists within pseudo-selectors
  const extended = applyExtensionAtLocation(selector, location, extendWith);

  // If we're in a complex selector context and need to create :is() wrappers
  // For now, just return the extended result
  return extended;
}

/**
 * Handles extension location in full mode - creates appropriate structures based on context
 */
function handleExtendLocationFull(
  selector: Selector,
  location: any,
  extendWith: Selector
): Selector {
  // For compound selectors, we may need to create :is() wrappers
  if (location.path.length > 0) {
    // We're extending within a compound or complex selector
    const extended = applyExtensionAtLocation(selector, location, extendWith);

    // Check if we need to convert the result to use :is() wrappers
    // This happens when extending part of a compound selector
    return convertToIsWrapperIfNeeded(extended, selector, location, extendWith);
  }

  // Default case: apply extension directly
  return applyExtensionAtLocation(selector, location, extendWith);
}

/**
 * Converts extended results to use :is() wrappers when needed for compound selectors
 */
function convertToIsWrapperIfNeeded(
  extended: Selector,
  original: Selector,
  location: any,
  extendWith: Selector
): Selector {
  // If this is a compound selector extension, we might need :is() wrapper
  if (isNode(original, 'CompoundSelector') && original.value.length > 1) {
    // Check if the extension created a selector list at the component level
    // If so, we should wrap it in :is()

    // For now, just return the extended result
    // The proper logic would analyze the location path and determine
    // if we need to create :is() wrappers for compound boundary cases
  }

  return extended;
}

/**
 * Validates that a compound selector doesn't have duplicate element or ID selectors
 * @param components - Array of selectors to check
 * @returns true if valid, false if invalid
 */
function isValidCompoundSelector(components: any[]): boolean {
  let elementCount = 0;
  let idCount = 0;

  for (const component of components) {
    if (isNode(component, 'BasicSelector')) {
      if (component.isTag) elementCount++;
      if (component.isId) idCount++;

      // Invalid if we have more than one element or ID
      if (elementCount > 1 || idCount > 1) {
        return false;
      }
    } else if (isNode(component, 'CompoundSelector')) {
      // Recursively check nested compounds
      if (!isValidCompoundSelector(component.value)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Creates a compound selector with validation to prevent invalid combinations
 * @param components - Array of selectors to combine
 * @param inheritFrom - Selector to inherit properties from
 * @returns Valid compound selector or original selector if invalid
 */
function createValidatedCompoundSelector(
  components: any[],
  inheritFrom: Selector,
  fallbackSelector?: Selector
): CompoundSelector | Selector {
  if (!isValidCompoundSelector(components)) {
    return fallbackSelector || inheritFrom; // Return fallback if invalid
  }

  const compound = CompoundSelector.create(components as any);
  return compound.inherit(inheritFrom);
}

/**
 * Creates a compound selector with validation that throws errors on conflicts
 * @param components - Array of selectors to combine
 * @param inheritFrom - Selector to inherit properties from
 * @param context - Context information for error reporting
 * @returns Valid compound selector
 * @throws ExtendError if validation fails
 */
function createValidatedCompoundSelectorWithErrors(
  components: any[],
  inheritFrom: Selector,
  context?: {
    target?: Selector;
    find?: Selector;
    extendWith?: Selector;
  }
): CompoundSelector {
  const validation = validateCompoundSelector(components);
  if (!validation.isValid) {
    throw new ExtendError(
      validation.errorType!,
      validation.errorMessage!,
      context
    );
  }

  const compound = CompoundSelector.create(components as any);
  return compound.inherit(inheritFrom);
}

/**
 * Enhanced validation that returns detailed error information
 */
function validateCompoundSelector(components: any[]): {
  isValid: boolean;
  errorType?: ExtendErrorType;
  errorMessage?: string;
  conflictingSelectors?: any[];
} {
  const elementTypes = new Set<string>();
  const idValues = new Set<string>();

  for (const component of components) {
    if (isNode(component, 'BasicSelector')) {
      if (component.isTag) {
        elementTypes.add(component.value.toLowerCase());
      }
      if (component.isId) {
        idValues.add(component.value);
      }

      // Invalid if we have more than one different element type or ID
      if (elementTypes.size > 1) {
        const elementList = Array.from(elementTypes);
        return {
          isValid: false,
          errorType: 'ELEMENT_CONFLICT',
          errorMessage: `Cannot combine different element types: ${elementList.join(', ')}`,
          conflictingSelectors: [] // We could collect the actual selectors if needed
        };
      }
      if (idValues.size > 1) {
        const idList = Array.from(idValues);
        return {
          isValid: false,
          errorType: 'ID_CONFLICT',
          errorMessage: `Cannot combine different ID selectors: ${idList.join(', ')}`,
          conflictingSelectors: [] // We could collect the actual selectors if needed
        };
      }
    } else if (isNode(component, 'CompoundSelector')) {
      // Recursively check nested compounds
      const nestedValidation = validateCompoundSelector(component.value);
      if (!nestedValidation.isValid) {
        return nestedValidation;
      }
    }
  }

  return { isValid: true };
}
