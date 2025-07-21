import { type Selector } from '../selector';
import { SimpleSelector } from '../selector-simple';
import { SelectorList } from '../selector-list';
import { ComplexSelector, type ComplexSelectorValue } from '../selector-complex';
import { CompoundSelector } from '../selector-compound';
import { PseudoSelector } from '../selector-pseudo';
import { Combinator } from '../combinator';
import { Ampersand } from '../ampersand';
import { isNode } from './is-node';
import { matchSelectors } from './match-selector';

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
  // Use our sophisticated matching function to find matches
  const matchResult = matchSelectors(selector, target, partial);

  if (!matchResult.hasMatch) {
    throw new Error('No match found for target selector');
  }

  // Check for ampersand boundary crossing during extension (unless skipped)
  if (!skipAmpersandCheck) {
    const ampersandCrossingInfo = checkAmpersandCrossingDuringExtension(selector, target);

    if (ampersandCrossingInfo.crossed) {
      return handleAmpersandBoundaryCrossing(
        selector,
        target,
        extendWith,
        ampersandCrossingInfo.ampersandNode!,
        matchResult
      );
    }
  }

  // Standard extension logic
  if (partial) {
    return handlePartialExtend(selector, target, extendWith, matchResult);
  } else {
    return handleFullExtend(selector, target, extendWith, matchResult);
  }
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
    return new SelectorList(newSelectors).inherit(copyForInheritance);
  }

  // If selector is a :is() pseudo-selector, add to its argument list
  if (isNode(selector, 'PseudoSelector') && selector.value.name === ':is') {
    const arg = selector.value.arg;
    if (arg && isNode(arg, 'SelectorList')) {
      // Add to existing selector list
      const newSelectors = [...arg.value, extendWith];
      const newArg = new SelectorList(newSelectors);

      // Use clone to preserve comments
      const copyForInheritance = selector.clone();
      return new PseudoSelector({
        name: ':is',
        arg: newArg
      }).inherit(copyForInheritance);
    } else if (arg) {
      // Convert single selector to list and add extension
      const newSelectors = [arg as Selector, extendWith];
      const newArg = new SelectorList(newSelectors);

      // Use clone to preserve comments
      const copyForInheritance = selector.clone();
      return new PseudoSelector({
        name: ':is',
        arg: newArg
      }).inherit(copyForInheritance);
    }
  }

  // For compound selectors with :is(), we need to check if we can extend the :is()
  if (isNode(selector, 'CompoundSelector')) {
    return handleCompoundFullExtend(selector, target, extendWith, matchResult);
  }

  // Default case: create a new selector list
  const copyForInheritance = selector.clone();
  return new SelectorList([selector, extendWith]).inherit(copyForInheritance);
}

/**
 * Handles full extend for compound selectors containing :is()
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
  // Look for :is() pseudo-selectors in the compound that might contain the target
  for (let i = 0; i < selector.value.length; i++) {
    const comp = selector.value[i];
    if (comp && isNode(comp, 'PseudoSelector') && comp.value.name === ':is') {
      const arg = comp.value.arg;
      if (arg && (arg as any).isSelector) {
        // Check if this :is() contains a match for our target
        const isMatchResult = matchSelectors(arg as Selector, target, false);
        if (isMatchResult.hasMatch) {
          // Extend the :is() argument
          const extendedArg = handleFullExtend(arg as Selector, target, extendWith, isMatchResult);

          // Create new compound with updated :is()
          const newComponents = [...selector.value];
          newComponents[i] = new PseudoSelector({
            name: ':is',
            arg: extendedArg
          }).inherit(comp);

          return new CompoundSelector(newComponents).inherit(selector);
        }
      }
    }
  }

  // If no :is() contained the target, create a selector list
  return new SelectorList([selector, extendWith]).inherit(selector);
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
): Selector {
  // Use the matchResult remainders to determine the strategy
  const remainders = matchResult.remainders || [];

  if (remainders.length === 0) {
    // No remainders - fallback to :is() wrapper
    return createIsWrapper([target, extendWith], selector);
  }

  const remainder = remainders[0];

  // Strategy depends on the type of match:
  // 1. If the remainder suggests a compound reconstruction → Create compound with :is()
  // 2. If extendWith is simple and no compound reconstruction → Create SelectorList
  // 3. If extendWith is complex → Create remainder + :is(target, extendWith)

  // Check if we need compound reconstruction by examining the remainder structure
  const needsCompoundReconstruction = checkCompoundReconstruction(selector, remainder, target);

  if (needsCompoundReconstruction) {
    // Compound reconstruction: create compound with :is() wrapper
    return reconstructCompoundSelector(selector, remainder, target, extendWith);
  } else if (isNode(extendWith, 'BasicSelector') || isNode(extendWith, 'CompoundSelector')) {
    // Simple extendWith - create SelectorList with original and new selector

    // Build new selector: remainder + extendWith
    let newSelectorComponents: ComplexSelectorValue = [];

    if (isNode(remainder, 'ComplexSelector')) {
      // Remainder is complex, add its components
      newSelectorComponents = [...remainder.value];
    } else if (remainder) {
      // Remainder is a single component
      newSelectorComponents = [remainder as any];
    }

    // Add extendWith - the remainder should already include the combinator if needed
    newSelectorComponents.push(extendWith as any);

    const newSelector = new ComplexSelector(newSelectorComponents).inherit(selector);

    // Return SelectorList with original and new selector
    return new SelectorList([selector, newSelector]).inherit(selector);
  } else {
    // Complex extendWith - use :is() wrapper strategy
    // Create: remainder + :is(target, extendWith)

    const isWrapper = createIsWrapper([target, extendWith], target);

    if (isNode(remainder, 'ComplexSelector')) {
      // Remainder is complex - append :is() to it
      const newComponents = [...remainder.value, isWrapper as any];
      return new ComplexSelector(newComponents).inherit(selector);
    } else if (remainder) {
      // Remainder is simple - need to determine if we need a combinator and which one
      // Extract the actual combinator from the original selector structure
      let originalCombinator: Combinator | null = null;

      if (isNode(selector, 'ComplexSelector')) {
        const components = selector.value;
        // Find the combinator that was used in the original selector
        for (let i = 0; i < components.length; i++) {
          if (isNode(components[i], 'Combinator')) {
            originalCombinator = components[i] as Combinator;
            break;
          }
        }
      }

      if (originalCombinator) {
        // Use the original combinator, not hardcoded '>'
        const newComponents = [remainder as any, originalCombinator, isWrapper as any];
        return new ComplexSelector(newComponents).inherit(selector);
      } else {
        const newComponents = [remainder as any, isWrapper as any];
        return new ComplexSelector(newComponents).inherit(selector);
      }
    } else {
      // No remainder - just return :is() wrapper
      return isWrapper;
    }
  }
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
      const compMatchResult = matchSelectors(comp, target, false);

      if (compMatchResult.hasMatch) {
        // Replace this component with :is(original, extension)
        // IMPORTANT: Use comp instead of target to preserve comments!
        const newComponents = [...selector.value];
        newComponents[i] = createIsWrapper([comp, extendWith], comp);

        return new CompoundSelector(newComponents).inherit(selector);
      }
    }
  }

  // If no direct component match, try the whole compound approach
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
  const selectorList = new SelectorList(selectors);

  // Create PseudoSelector and inherit from the comment-stripped copy
  const pseudoSelector = new PseudoSelector({
    name: ':is',
    arg: selectorList
  }).inherit(copyForInheritance);

  return pseudoSelector;
}

/**
 * Check if we need compound selector reconstruction
 */
function checkCompoundReconstruction(
  originalSelector: ComplexSelector,
  remainder: Selector,
  target: Selector
): boolean {
  // Look for the pattern where:
  // 1. Original selector has a compound selector
  // 2. The remainder suggests part of that compound was left behind

  if (!isNode(remainder, 'ComplexSelector')) {
    return false;
  }

  const remainderComponents = remainder.value;
  const originalComponents = originalSelector.value;

  // Find compound selectors in the original
  for (let i = 0; i < originalComponents.length; i++) {
    const originalComp = originalComponents[i];
    if (isNode(originalComp, 'CompoundSelector')) {
      // Check if this compound contains the target
      const compoundComponents = originalComp.value;
      const hasTarget = compoundComponents.some(comp =>
        isNode(comp, 'BasicSelector') && comp.valueOf() === target.valueOf()
      );

      if (hasTarget) {
        // Check if remainder has leftover parts from this compound
        const remainderLast = remainderComponents[remainderComponents.length - 1];
        if (isNode(remainderLast, 'BasicSelector')) {
          // Remainder ends with a basic selector, likely part of the compound
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Reconstruct a compound selector with :is() replacement
 */
function reconstructCompoundSelector(
  originalSelector: ComplexSelector,
  remainder: Selector,
  target: Selector,
  extendWith: Selector
): Selector {
  if (!isNode(remainder, 'ComplexSelector')) {
    // Fallback
    return createIsWrapper([target, extendWith], originalSelector);
  }

  const remainderComponents = remainder.value;

  // Get the remaining compound part (last component in remainder)
  const remainingCompoundPart = remainderComponents[remainderComponents.length - 1];

  // Create :is() wrapper
  const isWrapper = createIsWrapper([target, extendWith], target);

  // Create new compound with :is() + remaining part
  const newCompoundComponents = [isWrapper, remainingCompoundPart];
  const newCompound = new CompoundSelector(newCompoundComponents as any).inherit(originalSelector);

  // Build the final complex selector: context + new compound
  const contextComponents = remainderComponents.slice(0, -1); // Everything except the last part
  const finalComponents = [...contextComponents, newCompound];

  return new ComplexSelector(finalComponents as ComplexSelectorValue).inherit(originalSelector);
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
    const resolvedMatch = matchSelectors(resolvedSelector, target, true);

    // Also check if target matches the selector without this ampersand
    const selectorWithoutAmpersand = replaceAmpersandWithEmpty(selector, ampersand);
    const nonAmpersandMatch = matchSelectors(selectorWithoutAmpersand, target, true);

    if (resolvedMatch.hasMatch && !nonAmpersandMatch.hasMatch) {
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
