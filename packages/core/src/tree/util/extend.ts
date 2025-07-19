import { type Selector } from '../selector';
import { SimpleSelector } from '../selector-simple';
import { SelectorList } from '../selector-list';
import { ComplexSelector, type ComplexSelectorValue } from '../selector-complex';
import { CompoundSelector } from '../selector-compound';
import { PseudoSelector } from '../selector-pseudo';
import { Combinator } from '../combinator';
import { isNode } from './is-node';
import { matchSelectors } from './selector';

/**
 * Extends a selector by finding matches for a target selector and adding the extension.
 *
 * @param selector - The selector to extend
 * @param target - The target selector to find matches for
 * @param extendWith - The selector to extend with
 * @param partial - Whether to use partial matching (true) or full matching (false)
 * @returns The extended selector
 * @throws Error if no match is found
 */
export function extendSelector(
  selector: Selector,
  target: Selector,
  extendWith: Selector,
  partial: boolean
): Selector {
  // Use our sophisticated matching function to find matches
  const matchResult = matchSelectors(selector, target, partial);

  if (!matchResult.hasMatch) {
    throw new Error('No match found for target selector');
  }

  if (partial) {
    return handlePartialExtend(selector, target, extendWith, matchResult);
  } else {
    return handleFullExtend(selector, target, extendWith, matchResult);
  }
}

/**
 * Handles full match extension - adds the extension as a new alternative
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
    return new SelectorList(newSelectors).inherit(selector);
  }

  // If selector is a :is() pseudo-selector, add to its argument list
  if (isNode(selector, 'PseudoSelector') && selector.value.name === ':is') {
    const arg = selector.value.arg;
    if (arg && isNode(arg, 'SelectorList')) {
      // Add to existing selector list
      const newSelectors = [...arg.value, extendWith];
      const newArg = new SelectorList(newSelectors).inherit(arg);
      return new PseudoSelector({
        name: ':is',
        arg: newArg
      }).inherit(selector);
    } else if (arg) {
      // Convert single selector to list and add extension
      const newSelectors = [arg as Selector, extendWith];
      const newArg = new SelectorList(newSelectors).inherit(selector);
      return new PseudoSelector({
        name: ':is',
        arg: newArg
      }).inherit(selector);
    }
  }

  // For compound selectors with :is(), we need to check if we can extend the :is()
  if (isNode(selector, 'CompoundSelector')) {
    return handleCompoundFullExtend(selector, target, extendWith, matchResult);
  }

  // Default case: create a new selector list
  return new SelectorList([selector, extendWith]).inherit(selector);
}

/**
 * Handles full extend for compound selectors containing :is()
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
      // Remainder is simple - need to determine if we need a combinator
      // Check if the original selector had a combinator before the target
      let needsCombinator = false;

      if (isNode(selector, 'ComplexSelector')) {
        const components = selector.value;
        // Look for combinator pattern in the original selector
        for (let i = 0; i < components.length - 1; i++) {
          if (isNode(components[i + 1], 'Combinator')) {
            needsCombinator = true;
            break;
          }
        }
      }

      if (needsCombinator) {
        const newComponents = [remainder as any, new Combinator('>').inherit(remainder as any), isWrapper as any];
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
 */
function createIsWrapper(selectors: Selector[], inheritFrom: Selector): PseudoSelector {
  const selectorList = new SelectorList(selectors).inherit(inheritFrom);
  return new PseudoSelector({
    name: ':is',
    arg: selectorList
  }).inherit(inheritFrom);
}

/**
 * Check if we need compound selector reconstruction
 * This happens when the target was matched within a compound selector
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
