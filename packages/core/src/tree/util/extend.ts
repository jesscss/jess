import { type Selector } from '../selector';
import { SimpleSelector } from '../selector-simple';
import { SelectorList } from '../selector-list';
import { ComplexSelector, type ComplexSelectorValue } from '../selector-complex';
import { CompoundSelector } from '../selector-compound';
import { PseudoSelector } from '../selector-pseudo';
import { Combinator } from '../combinator';
import { Ampersand } from '../ampersand';
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
 * Extends a selector by finding matches for a target selector and adding the extension.
 *
 * @param selector - The selector to extend
 * @param target - The target selector to find matches for
 * @param extendWith - The selector to extend with
 * @param partial - Whether to use partial matching (true) or full matching (false)
 * @param skipAmpersandCheck - Whether to skip ampersand boundary checking (used in recursive calls)
 * @returns The extended selector
 * @throws Error if no match is found
 */
export function extendSelector(
  selector: Selector,
  target: Selector,
  extendWith: Selector,
  partial: boolean,
  skipAmpersandCheck: boolean = false
): Selector {
  // Use the unified ExtendLocation API for all selector matching
  const searchResult = findExtendableLocations(selector, target);

  if (!searchResult.hasMatches) {
    throw new Error('No match found for target selector');
  }

  // Check for ampersand boundary crossing during extension (unless skipped)
  if (!skipAmpersandCheck) {
    const ampersandCrossingInfo = checkAmpersandCrossingDuringExtension(selector, target);

    if (ampersandCrossingInfo.crossed) {
      // Convert ExtendLocation to MatchResult for compatibility with ampersand handling
      const location = searchResult.locations[0]!;
      const fallbackMatchResult = {
        hasMatch: true,
        hasFullMatch: !location.isPartialMatch,
        hasPartialMatch: !!location.isPartialMatch,
        matched: [target],
        remainders: location.remainders || []
      };
      const result = handleAmpersandBoundaryCrossing(
        selector,
        target,
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
            combinedExtension = CompoundSelector.create([remainder as any, extendWith as any]).inherit(remainder);
          }
        }

        return new SelectorList([selector, combinedExtension]).inherit(selector);
      }

      // Special case: Check if this is a complex selector partial match case
      // where we should extract remainder from compound selector structure
      if (location.isPartialMatch && isNode(selector, 'ComplexSelector') && isNode(target, 'ComplexSelector')) {
        // Try to detect if we have a case like .a>.b.c matching .a>.b
        const selectorComponents = selector.value;
        const targetComponents = target.value;

        // Check if target is a prefix of selector structure
        if (targetComponents.length <= selectorComponents.length) {
          let foundCompoundRemainder = false;
          let compoundRemainder: Selector | null = null;

          // Check each component for partial compound matches
          for (let i = 0; i < targetComponents.length; i++) {
            const sComp = selectorComponents[i];
            const tComp = targetComponents[i];

            if (sComp && tComp && !isNode(sComp, 'Combinator') && !isNode(tComp, 'Combinator')) {
              // Check if target component partially matches selector component
              if (isNode(sComp, 'CompoundSelector') && isNode(tComp, 'SimpleSelector')) {
                const matchingElement = sComp.value.find(el => el.valueOf() === tComp.valueOf());
                if (matchingElement) {
                  // Found partial match - extract remainder
                  const remainderElements = sComp.value.filter(el => el.valueOf() !== tComp.valueOf());
                  if (remainderElements.length > 0) {
                    compoundRemainder = remainderElements.length === 1
                      ? remainderElements[0]!
                      : CompoundSelector.create(remainderElements).inherit(sComp);
                    foundCompoundRemainder = true;
                  }
                }
              }
            }
          }

          if (foundCompoundRemainder && compoundRemainder) {
            // Create combined extension with remainder
            const combinedExtension = CompoundSelector.create([compoundRemainder as any, extendWith as any]).inherit(compoundRemainder);
            return new SelectorList([selector, combinedExtension]).inherit(selector);
          }
        }
      }

      return new SelectorList([selector, extendWith]).inherit(selector);
    }

    // For deeper matches in partial mode, we need to analyze the context
    // If we're matching within a compound selector, create :is() wrapper
    if (location.path.length > 0) {
      return handlePartialModeExtension(selector, location, extendWith);
    }

    return applyExtensionAtLocation(selector, location, extendWith);
  } else {
    // FULL MATCHING MODE: Create selector lists for complete matches

    // Check if this is a root-level full match (should create selector list)
    if (location.path.length === 0 && location.extensionType === 'replace' && !location.isPartialMatch) {
      // This is a full match at the root - create selector list with both original and extension
      return new SelectorList([selector, extendWith]).inherit(selector);
    }

    // Special handling for pseudo-selector matches in full mode
    // All pseudo-selectors with selector arguments allow extending inside
    // This includes :is(), :where(), :not(), :has(), and any other pseudo-selector with selector args
    if (location.path.includes('arg') && !location.isPartialMatch) {
      // Check if this is a compound target that fully matches a compound selector
      // In this case, create a selector list instead of extending inside the pseudo-selector
      if (isNode(target, 'CompoundSelector') && isNode(selector, 'CompoundSelector')) {
        // This is a full compound match - create selector list
        return new SelectorList([selector, extendWith]).inherit(selector);
      }

      // This is a full match inside a pseudo-selector argument
      // Always extend inside pseudo-selectors with selector arguments
      return applyExtensionAtLocation(selector, location, extendWith);
    }

    // For full matches within compound selectors, create :is() wrapper
    if (location.path.length === 1 && isNode(selector, 'CompoundSelector')) {
      // This is a component match within a compound selector
      const componentIndex = location.path[0] as number;
      const matchedComponent = selector.value[componentIndex];

      if (matchedComponent && selector.value.length > 1) {
        // Replace the matched component with :is(original, extension)
        const newComponents = [...selector.value];
        newComponents[componentIndex] = createIsWrapper([matchedComponent, extendWith], matchedComponent);
        return CompoundSelector.create(newComponents).inherit(selector);
      }
    }

    // For full matches at deeper levels, still apply the extension
    return applyExtensionAtLocation(selector, location, extendWith);
  }
}

/**
 * Handles extension in partial matching mode - creates :is() wrappers for component-level matches
 */
function handlePartialModeExtension(
  selector: Selector,
  location: any,
  extendWith: Selector
): Selector {
  // In partial mode, we want to create :is() wrappers for component-level matches
  // This is the behavior expected by tests like ".a>.b" + ".b" extend ".c" → ".a>:is(.b,.c)"

  // Handle direct compound selector partial matching (.a.b + .b extend .c → .a:is(.b, .c))
  if (location.path.length === 1 && isNode(selector, 'CompoundSelector')) {
    const componentIndex = location.path[0] as number;
    const matchedComponent = selector.value[componentIndex];

    if (matchedComponent) {
      // Replace the matched component with :is(original, extension)
      const newComponents = [...selector.value];
      newComponents[componentIndex] = createIsWrapper([matchedComponent, extendWith], matchedComponent);
      return CompoundSelector.create(newComponents).inherit(selector);
    }
  }

  // Handle compound selector match within complex selector
  if (location.path.length === 1 && isNode(selector, 'ComplexSelector')) {
    // This is a direct component match in a complex selector
    const componentIndex = location.path[0] as number;
    const components = selector.value;
    const matchedComponent = components[componentIndex];

    if (matchedComponent && !isNode(matchedComponent, 'Combinator')) {
      // Replace the matched component with :is(original, extension)
      const newComponents = [...components];
      newComponents[componentIndex] = createIsWrapper([matchedComponent, extendWith], matchedComponent);
      return ComplexSelector.create(newComponents).inherit(selector);
    }
  }

  // For compound selector matches within complex selectors
  if (location.path.length === 2 && isNode(selector, 'ComplexSelector')) {
    const [componentIndex, subIndex] = location.path;
    const components = selector.value;
    const component = components[componentIndex as number];

    if (component && isNode(component, 'CompoundSelector')) {
      // We're matching a part of a compound selector within a complex selector
      const matchedElement = component.value[subIndex as number];
      if (matchedElement) {
        // Replace the matched element with :is(original, extension)
        const newSubComponents = [...component.value];
        newSubComponents[subIndex as number] = createIsWrapper([matchedElement, extendWith], matchedElement);

        const newComponent = CompoundSelector.create(newSubComponents).inherit(component);
        const newComponents = [...components];
        newComponents[componentIndex as number] = newComponent;

        return ComplexSelector.create(newComponents).inherit(selector);
      }
    }
  }

  // Default: apply extension directly
  return applyExtensionAtLocation(selector, location, extendWith);
}

/**
 * Handles full match extension - adds the extension as a new alternative
 * @param selector - The selector to extend
 * @param target - The target selector that was matched
 * @param extendWith - The selector to add as an alternative
 * @param matchResult - The result from the selector matching operation
 * @returns Extended selector with the new alternative
 */
function handleFullExtend(
  selector: Selector,
  target: Selector,
  extendWith: Selector,
  matchResult: any
): Selector {
  // For full matches, we add the extension as a new selector in a list

  // If selector is already a selector list, add to it
  if (isNode(selector, 'SelectorList')) {
    const newSelectors = [...selector.value, extendWith];
    // Use clone to preserve comments
    const copyForInheritance = selector.clone();
    return SelectorList.create(newSelectors).inherit(copyForInheritance);
  }

  // If selector is a pseudo-selector with selector arguments, check if we should extend arguments or create selector list
  if (isNode(selector, 'PseudoSelector')) {
    const arg = selector.value.arg;
    // Only extend arguments for :is() pseudo-selectors or when the target is NOT the complete pseudo-selector
    // For other pseudo-selectors like :where(), when the entire pseudo-selector is matched, create a selector list
    if (arg && (arg as any).isSelector && selector.value.name === ':is') {
      if (isNode(arg, 'SelectorList')) {
        // Add to existing selector list
        const newSelectors = [...arg.value, extendWith];
        const newArg = SelectorList.create(newSelectors).inherit(arg);

        // If the original selector was generated, we can mutate it in place for performance
        if (selector.generated) {
          selector.value.arg = newArg;
          return selector;
        } else {
          // For authored selectors, create a new one to preserve the original
          return new PseudoSelector({
            name: selector.value.name,
            arg: newArg
          }).inherit(selector);
        }
      } else {
        // Convert single selector to list and add extension
        const newSelectors = [arg as Selector, extendWith];
        const newArg = SelectorList.create(newSelectors).inherit(arg);

        // If the original selector was generated, we can mutate it in place for performance
        if (selector.generated) {
          selector.value.arg = newArg;
          return selector;
        } else {
          // For authored selectors, create a new one to preserve the original
          return new PseudoSelector({
            name: selector.value.name,
            arg: newArg
          }).inherit(selector);
        }
      }
    }
    // For non-:is() pseudo-selectors or when target matches the entire pseudo-selector,
    // fall through to create a selector list
  }

  // For compound selectors, check if we need special handling for pseudo-classes
  if (isNode(selector, 'CompoundSelector')) {
    return handleCompoundFullExtend(selector, target, extendWith, matchResult);
  }

  // Default case: create a new selector list
  const copyForInheritance = selector.clone();
  return SelectorList.create([selector, extendWith]).inherit(copyForInheritance);
}

/**
 * Handles full extend for compound selectors containing :is() or pseudo-classes
 * @param selector - The compound selector to extend
 * @param target - The target selector that was matched
 * @param extendWith - The selector to add as an alternative
 * @param matchResult - The result from the selector matching operation
 * @returns Extended compound selector or new selector list
 */
function handleCompoundFullExtend(
  selector: CompoundSelector,
  target: Selector,
  extendWith: Selector,
  matchResult: any
): Selector {
  // Single loop to handle both :is() extension and regular component matching
  for (let i = 0; i < selector.value.length; i++) {
    const comp = selector.value[i];
    if (!comp) continue;

    // Check if this is an existing :is() pseudo-selector that might contain the target
    // ONLY :is() allows boundary crossing - all other pseudo-selectors are atomic units
    if (isNode(comp, 'PseudoSelector') && comp.value.name === ':is') {
      const arg = comp.value.arg;
      if (arg && (arg as any).isSelector) {
        const isSearchResult = findExtendableLocations(arg as Selector, target);
        if (isSearchResult.hasMatches) {
          // Extend the :is() argument using the new API
          const extendedArg = extendSelector(arg as Selector, target, extendWith, false, true);

          // If the original selector was generated, we can mutate the :is() component in place
          if (selector.generated) {
            comp.value.arg = extendedArg;
            return selector;
          } else {
            // For authored selectors, create new compound with updated :is()
            const newComponents = [...selector.value];
            newComponents[i] = new PseudoSelector({
              name: ':is',
              arg: extendedArg
            }).inherit(comp);

            return new CompoundSelector(newComponents).inherit(selector);
          }
        }
      }
    } else {
      // Check if this component matches the target
      const compSearchResult = findExtendableLocations(comp, target);
      if (compSearchResult.hasMatches && selector.value.length > 1) {
        // This compound has multiple components - replace matched component with :is() wrapper
        const isWrapper = createIsWrapper([comp, extendWith], comp);

        // Replace the matched component with :is() wrapper in place
        const newComponents = [...selector.value];
        newComponents[i] = isWrapper;

        return CompoundSelector.create(newComponents).inherit(selector);
      }
    }
  }

  // If no special handling needed, create a selector list
  return SelectorList.create([selector, extendWith]).inherit(selector);
}

/**
 * Handles partial match extension - modifies the selector structure to include the extension
 * @param selector - The selector to extend
 * @param target - The target selector that was partially matched
 * @param extendWith - The selector to add as an alternative
 * @param matchResult - The result from the partial selector matching operation
 * @returns Extended selector with remainders properly handled
 */
function handlePartialExtend(
  selector: Selector,
  target: Selector,
  extendWith: Selector,
  matchResult: any
): Selector {
  if (!matchResult.hasPartialMatch) {
    // Full match in partial mode - treat like full extend
    return handleFullExtend(selector, target, extendWith, matchResult);
  }

  // We have a partial match with remainders
  // Strategy: Replace the matched part with :is(matched, extendWith) and keep remainders

  if (isNode(selector, 'ComplexSelector')) {
    return handleComplexPartialExtend(selector as ComplexSelector, target, extendWith, matchResult);
  }

  if (isNode(selector, 'CompoundSelector')) {
    return handleCompoundPartialExtend(selector as CompoundSelector, target, extendWith, matchResult);
  }

  // For simple cases, wrap in :is()
  return createIsWrapper([target, extendWith], selector);
}

/**
 * Handles partial extension for complex selectors
 * @param selector - The complex selector to extend
 * @param target - The target selector that was partially matched
 * @param extendWith - The selector to add as an alternative
 * @param matchResult - The result from the partial selector matching operation
 * @returns Extended complex selector with proper remainder handling
 */
function handleComplexPartialExtend(
  selector: ComplexSelector,
  target: Selector,
  extendWith: Selector,
  matchResult: any
): Selector {  // If the top-level match result has remainders from cross-selector matching,
  // handle them by creating remainder+extension combinations
  if (matchResult.hasPartialMatch && matchResult.remainders && matchResult.remainders.length > 0
    && matchResult.matched && matchResult.matched.length > 0 && !isNode(target, 'SimpleSelector')) {
    // Only apply remainder logic for complex targets that match across selector structure
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
        combinedExtension = CompoundSelector.create([remainderSelector as any, extendWith as any]).inherit(remainderSelector);
      }
    }

    // Return selector list: original + combined remainder+extension
    return SelectorList.create([selector, combinedExtension]).inherit(selector);
  }

  // Original logic for component-level matching
  const components = selector.value;

  // Find the component that matches the target
  for (let i = 0; i < components.length; i++) {
    const component = components[i];

    // Skip combinators
    if (isNode(component, 'Combinator')) {
      continue;
    }

    if (component) {
      const compSearchResult = findExtendableLocations(component, target);

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

        return ComplexSelector.create(newComponents).inherit(selector);
      }
    }
  }

  // No component matched - fallback to creating selector list
  return SelectorList.create([selector, extendWith]).inherit(selector);
}

/**
 * Handles partial extension for compound selectors
 * @param selector - The compound selector to extend
 * @param target - The target selector that was partially matched
 * @param extendWith - The selector to add as an alternative
 * @param matchResult - The result from the partial selector matching operation
 * @returns Extended compound selector with :is() wrapper
 */
function handleCompoundPartialExtend(
  selector: CompoundSelector,
  target: Selector,
  extendWith: Selector,
  matchResult: any
): Selector {
  // Find the component that matched and replace it with :is()
  for (let i = 0; i < selector.value.length; i++) {
    const comp = selector.value[i];
    if (comp) {
      const compSearchResult = findExtendableLocations(comp, target);

      if (compSearchResult.hasMatches) {
        // Replace this component with :is(original, extension)
        // IMPORTANT: Use comp instead of target to preserve comments!
        const newComponents = [...selector.value];
        newComponents[i] = createIsWrapper([comp, extendWith], comp);

        return CompoundSelector.create(newComponents).inherit(selector);
      }
    }
  }

  // If no direct component match, use the whole compound approach
  return createIsWrapper([selector, extendWith], selector);
}

/**
 * Creates an :is() wrapper around the given selectors
 * Preserves comments on original selectors, strips them from inheritance chain
 */
function createIsWrapper(selectors: Selector[], inheritFrom: Selector): PseudoSelector {
  // Strip comments only from the inheritance chain to avoid duplication on the wrapper
  const copyForInheritance = inheritFrom.copy();

  // Create selectorList with original selectors (preserving their comments)
  const selectorList = SelectorList.create(selectors);

  // Create PseudoSelector using the create factory method - same signature as constructor but marks as generated
  const pseudoSelector = PseudoSelector.create({
    name: ':is',
    arg: selectorList
  }).inherit(copyForInheritance) as PseudoSelector;

  return pseudoSelector;
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
    return new SelectorList([new PseudoSelector({ name: ':is', arg: new SelectorList([target, extendWith]).inherit(target) }), ...selector.value.slice(1)]).inherit(selector);
  }

  // Default to selector list for root-level partial matches
  return new SelectorList([selector, extendWith]).inherit(selector);
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
