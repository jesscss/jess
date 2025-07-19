import { type Selector } from '../selector';
import { SimpleSelector } from '../selector-simple';
import { Ampersand } from '../ampersand';
import { Combinator } from '../combinator';
import { SelectorList } from '../selector-list';
import { ComplexSelector, type ComplexSelectorValue } from '../selector-complex';
import { CompoundSelector } from '../selector-compound';
import { PseudoSelector } from '../selector-pseudo';
import type { Node } from '../node';
import { isNode } from './is-node';
// import { BasicSelector } from '../selector-basic'
import { ABORT } from '../node';

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

/**
 * It would be easy to be over-simplistic here and just check if the selectors
 * are the same. But we need to be more nuanced than that because of the
 * `:is()` pseudo-class, and because compound selectors can be in any order,
 * yet represent the same match.
 */
export interface MatchResult {
  hasMatch: boolean;
  hasFullMatch: boolean;
  hasPartialMatch: boolean;
  matched: Selector[];
  remainders: Selector[];
}

// Pre-allocated result objects for common cases to reduce object creation
const EXACT_MATCH_RESULT_CACHE = new WeakMap<Selector, MatchResult>();

export function matchSelectors(target: Selector, find: Selector, partial = false): MatchResult {
  // Handle the key insight: right-to-left matching through :is() alternatives

  // Fast path: Check for exact match first (most common case)
  if (target.valueOf() === find.valueOf()) {
    // Try to use cached result to reduce object creation
    let cachedResult = EXACT_MATCH_RESULT_CACHE.get(target);
    if (!cachedResult) {
      cachedResult = {
        hasMatch: true,
        hasFullMatch: true,
        hasPartialMatch: false,
        matched: [target],
        remainders: []
      };
      EXACT_MATCH_RESULT_CACHE.set(target, cachedResult);
    }
    return cachedResult;
  }

  // OPTIMIZATION #4: KeySet fast rejection - bail early for non-matches
  // This is crucial for stylesheet performance where non-matches are the overwhelming majority
  // Use canFastReject to determine if keySet disjointness guarantees no match
  if (target.keySet && find.keySet
    && target.keySet.isDisjointFrom(find.keySet)
    && target.canFastReject && find.canFastReject) {
    // No common keys and both selectors are safe for fast rejection - impossible match, bail immediately
    return {
      hasMatch: false,
      hasFullMatch: false,
      hasPartialMatch: false,
      matched: [],
      remainders: [target]
    };
  }

  // OPTIMIZATION #5: KeySet subset rejection for partial matches
  // When doing partial matching and find selector has no alternatives (canFastReject = true),
  // we can use set relationships to fast reject cases where find requires keys target doesn't have
  if (partial && find.canFastReject && target.keySet && find.keySet
    && !find.keySet.isSubsetOf(target.keySet)) {
    // Find requires keys that target doesn't have - impossible partial match, bail immediately
    return {
      hasMatch: false,
      hasFullMatch: false,
      hasPartialMatch: false,
      matched: [],
      remainders: [target]
    };
  }

  // Handle case where find is a selector list - check if target matches any selector in the list
  if (isNode(find, 'SelectorList')) {
    return matchTargetAgainstSelectorList(target, find, partial);
  }

  // For complex selectors with :is(), use the sophisticated right-to-left backtracking algorithm
  if ((isNode(target, 'ComplexSelector') && isNode(find, 'ComplexSelector')) && partial) {
    // Only use backtrackingMatch if target has :is() pseudo-selectors that need special handling
    if (hasIsPseudoSelector(target)) {
      return backtrackingMatch(target, find);
    } else {
      return matchComplexToComplex(target, find, partial);
    }
  }

  // Key insight from user: right-to-left backtracking through :is()
  // For compound selectors containing :is(), we need to check if find matches any component
  if (isNode(target, 'CompoundSelector')) {
    return matchCompoundSelector(target, find, partial);
  }

  // Handle :is() pseudo-selectors - check if find matches any alternative
  if (isNode(target, 'PseudoSelector') && target.value.name === ':is') {
    return matchIsPseudoSelector(target, find, partial);
  }

  // Handle selector lists - find matches any selector in the list
  if (isNode(target, 'SelectorList')) {
    return matchSelectorList(target, find, partial);
  }

  // Handle complex selectors - partial matching for sequences
  if (isNode(target, 'ComplexSelector') || isNode(find, 'ComplexSelector')) {
    return matchComplexSelectors(target, find, partial);
  }

  // No match found
  return {
    hasMatch: false,
    hasFullMatch: false,
    hasPartialMatch: false,
    matched: [],
    remainders: [target]
  };
}

function matchTargetAgainstSelectorList(target: Selector, find: SelectorList, partial: boolean): MatchResult {
  // When find is a selector list, check if target matches any selector in the list
  // This handles cases like: target .a, find [.a, .b] -> should match because .a is in the list

  for (const selector of find.value) {
    const result = matchSelectors(target, selector, partial);
    if (result.hasMatch) {
      return result;
    }
  }

  return {
    hasMatch: false,
    hasFullMatch: false,
    hasPartialMatch: false,
    matched: [],
    remainders: [target]
  };
}

function matchCompoundSelector(target: CompoundSelector, find: Selector, partial: boolean): MatchResult {
  // Handle the reverse case: find is a compound selector and target contains :is()
  if (isNode(find, 'CompoundSelector')) {
    return matchCompoundToCompound(target, find, partial);
  }

  // The key insight: when target has :is(.a).b and find is .b
  // we should match .b from the compound, leaving :is(.a) as remainder
  for (let i = 0; i < target.value.length; i++) {
    const component = target.value[i]!;

    // Direct component match - use partial flag for :is() cases
    const componentResult = matchSelectors(component, find, partial);
    if (componentResult.hasMatch && (componentResult.hasFullMatch || (partial && componentResult.hasPartialMatch))) {
      // Build remainder by removing this component
      let remainderComponents = target.value.filter((_, idx) => idx !== i);

      // For compound selectors, if we have a partial match with remainders,
      // we need to handle them more carefully
      if (componentResult.hasPartialMatch && componentResult.remainders.length > 0) {
        // If there are remainders from the matched component, we need to reconstruct
        // the compound selector with both the unmatched original components and
        // the remainders from the partial match

        // Get the remaining simple selectors
        const remainingSimpleSelectors = remainderComponents;

        // The remainders from partial match might need to be added separately
        // since they might not be simple selectors (could be compound or complex)
        let allRemainders: Selector[] = [];

        if (remainingSimpleSelectors.length > 0) {
          if (remainingSimpleSelectors.length === 1) {
            allRemainders.push(remainingSimpleSelectors[0]!);
          } else {
            allRemainders.push(new CompoundSelector(remainingSimpleSelectors).inherit(target));
          }
        }

        // Add the remainders from the partial match
        allRemainders.push(...componentResult.remainders);

        return {
          hasMatch: true,
          hasFullMatch: false,
          hasPartialMatch: true,
          matched: componentResult.matched,
          remainders: allRemainders
        };
      } else {
        // Full match case - simpler handling
        let remainders: Selector[];
        if (remainderComponents.length === 0) {
          remainders = [];
        } else if (remainderComponents.length === 1) {
          remainders = [remainderComponents[0]!];
        } else {
          // Create new compound selector with remaining components
          remainders = [new CompoundSelector(remainderComponents).inherit(target)];
        }

        return {
          hasMatch: true,
          hasFullMatch: remainders.length === 0,
          hasPartialMatch: remainders.length > 0,
          matched: componentResult.matched,
          remainders: remainders
        };
      }
    }
  }

  return {
    hasMatch: false,
    hasFullMatch: false,
    hasPartialMatch: false,
    matched: [],
    remainders: [target]
  };
}

function areCompoundSelectorsEquivalent(target: CompoundSelector, find: CompoundSelector): boolean {
  // Check if two compound selectors have the same set of simple selectors
  // regardless of order. This handles cases like .d.b matching .b.d

  const targetLen = target.value.length;
  const findLen = find.value.length;

  if (targetLen !== findLen) {
    return false;
  }

  // Early exit for empty compounds
  if (targetLen === 0) {
    return true;
  }

  // For small compounds, use direct comparison (most common case)
  if (targetLen === 1) {
    return target.value[0]!.valueOf() === find.value[0]!.valueOf();
  }

  if (targetLen === 2) {
    const t0 = target.value[0]!.valueOf();
    const t1 = target.value[1]!.valueOf();
    const f0 = find.value[0]!.valueOf();
    const f1 = find.value[1]!.valueOf();
    return (t0 === f0 && t1 === f1) || (t0 === f1 && t1 === f0);
  }

  // For larger compounds, use the general algorithm but avoid intermediate arrays
  const targetValues = target.value;
  const findValues = find.value;

  // Check if every component in find has a matching component in target
  outer: for (let i = 0; i < findLen; i++) {
    const findComponent = findValues[i]!;
    const findVal = findComponent.valueOf();

    for (let j = 0; j < targetLen; j++) {
      if (targetValues[j]!.valueOf() === findVal) {
        continue outer; // Found match, check next find component
      }
    }
    return false; // No match found for this find component
  }

  return true;
}

function matchCompoundToCompound(target: CompoundSelector, find: CompoundSelector, partial: boolean): MatchResult {
  // Handle compound to compound matching: target .a:is(.b, .c), find .a.b
  // Need to match all components in find against components in target

  // First check if they're semantically equivalent (same components in any order)
  if (areCompoundSelectorsEquivalent(target, find)) {
    return {
      hasMatch: true,
      hasFullMatch: true,
      hasPartialMatch: false,
      matched: [find],
      remainders: []
    };
  }

  const matchedComponents: Selector[] = [];
  const unmatchedFindComponents: Selector[] = [];
  const unmatchedTargetComponents = [...target.value];

  // Try to match each component in find against components in target
  for (const findComponent of find.value) {
    let matched = false;

    for (let i = 0; i < unmatchedTargetComponents.length; i++) {
      const targetComponent = unmatchedTargetComponents[i]!;
      const result = matchSelectors(targetComponent, findComponent, false);

      if (result.hasMatch && result.hasFullMatch) {
        matchedComponents.push(findComponent);
        unmatchedTargetComponents.splice(i, 1);
        matched = true;
        break;
      }
    }

    if (!matched) {
      unmatchedFindComponents.push(findComponent);
    }
  }

  // Check if all find components were matched
  if (unmatchedFindComponents.length === 0) {
    // All find components matched
    let remainders: Selector[];
    if (unmatchedTargetComponents.length === 0) {
      remainders = [];
    } else if (unmatchedTargetComponents.length === 1) {
      remainders = [unmatchedTargetComponents[0]!];
    } else {
      remainders = [new CompoundSelector(unmatchedTargetComponents).inherit(target)];
    }

    const matched = matchedComponents.length === 1
      ? matchedComponents
      : [find]; // Return the original find as matched

    return {
      hasMatch: true,
      hasFullMatch: remainders.length === 0,
      hasPartialMatch: remainders.length > 0,
      matched: matched,
      remainders: remainders
    };
  }

  return {
    hasMatch: false,
    hasFullMatch: false,
    hasPartialMatch: false,
    matched: [],
    remainders: [target]
  };
}

function matchIsPseudoSelector(target: PseudoSelector, find: Selector, partial: boolean): MatchResult {
  // Handle :is() by checking each alternative
  const arg = target.value.arg;
  if (!arg || !isNode(arg, 'SelectorList')) {
    return {
      hasMatch: false,
      hasFullMatch: false,
      hasPartialMatch: false,
      matched: [],
      remainders: [target]
    };
  }

  // Try matching against each alternative in the :is()
  for (const alternative of arg.value) {
    const altResult = matchSelectors(alternative, find, partial);
    if (altResult.hasMatch) {
      return {
        hasMatch: true,
        hasFullMatch: altResult.hasFullMatch,
        hasPartialMatch: altResult.hasPartialMatch,
        matched: altResult.matched,
        remainders: altResult.remainders
      };
    }
  }

  return {
    hasMatch: false,
    hasFullMatch: false,
    hasPartialMatch: false,
    matched: [],
    remainders: [target]
  };
}

function matchSelectorList(target: SelectorList, find: Selector, partial: boolean): MatchResult {
  const matches: Selector[] = [];
  const remainders: Selector[] = [];
  let hasAnyMatch = false;
  let hasAnyFull = false;
  let hasAnyPartial = false;

  for (const selector of target.value) {
    const result = matchSelectors(selector, find, partial);
    if (result.hasMatch) {
      hasAnyMatch = true;
      if (result.hasFullMatch) hasAnyFull = true;
      if (result.hasPartialMatch) hasAnyPartial = true;
      matches.push(...result.matched);
      remainders.push(...result.remainders);
    } else {
      remainders.push(selector);
    }
  }

  return {
    hasMatch: hasAnyMatch,
    hasFullMatch: hasAnyFull,
    hasPartialMatch: hasAnyPartial,
    matched: matches,
    remainders: remainders
  };
}

function matchComplexSelectors(target: Selector, find: Selector, partial: boolean): MatchResult {
  // More sophisticated complex selector matching

  // Handle complex-to-complex matching for both full and partial matches
  if (isNode(target, 'ComplexSelector') && isNode(find, 'ComplexSelector')) {
    return matchComplexToComplex(target, find, partial);
  }

  // For partial matches with one complex selector, try matching components
  if (partial) {
    if (isNode(target, 'ComplexSelector') && !isNode(find, 'ComplexSelector')) {
      // target: .a.b > .c, find: .a.b -> should match
      return matchComplexAgainstSimple(target, find, partial);
    }

    if (isNode(find, 'ComplexSelector') && !isNode(target, 'ComplexSelector')) {
      // target: .a.b, find: .a.b > .c -> should not match in reverse
      return {
        hasMatch: false,
        hasFullMatch: false,
        hasPartialMatch: false,
        matched: [],
        remainders: [target]
      };
    }
  }

  return {
    hasMatch: false,
    hasFullMatch: false,
    hasPartialMatch: false,
    matched: [],
    remainders: [target]
  };
}

function matchComplexToComplex(target: ComplexSelector, find: ComplexSelector, partial: boolean): MatchResult {
  // This handles right-to-left backtracking for complex selector matching
  // Example: target .a > .b.c > .d.e, find .c.b > .e.d
  // Should match from right: .e.d matches .d.e, > matches >, .c.b matches .b.c
  // Result: partial match with remainder .a >

  // Fast path: exact match check (using cached result from WeakMap)
  if (target.valueOf() === find.valueOf()) {
    return {
      hasMatch: true,
      hasFullMatch: true,
      hasPartialMatch: false,
      matched: [find],
      remainders: []
    };
  }

  const targetComponents = target.value;
  const findComponents = find.value;
  const targetLen = targetComponents.length;
  const findLen = findComponents.length;

  // Fast path: length check for non-partial matching
  if (!partial && targetLen !== findLen) {
    return {
      hasMatch: false,
      hasFullMatch: false,
      hasPartialMatch: false,
      matched: [],
      remainders: [target]
    };
  }

  // Fast path: if find is longer than target and we don't allow partial, impossible
  if (findLen > targetLen && !partial) {
    return {
      hasMatch: false,
      hasFullMatch: false,
      hasPartialMatch: false,
      matched: [],
      remainders: [target]
    };
  }

  // Right-to-left matching: start from the end of both selectors
  let targetIdx = targetComponents.length - 1;
  let findIdx = findComponents.length - 1;
  const partialMatchRemainders: Selector[] = []; // Track remainders from partial matches

  // Match components from right to left
  while (targetIdx >= 0 && findIdx >= 0) {
    const targetComp = targetComponents[targetIdx]!;
    const findComp = findComponents[findIdx]!;

    // For combinator matching, must be exact
    if (isNode(targetComp, 'Combinator') || isNode(findComp, 'Combinator')) {
      if (targetComp.valueOf() !== findComp.valueOf()) {
        break; // No match
      }
    } else {
      // For selector components, use semantic matching
      // Allow partial matching within components for compound selectors
      const compResult = matchSelectors(targetComp as Selector, findComp as Selector, partial);
      if (!compResult.hasFullMatch && !(partial && compResult.hasPartialMatch)) {
        break; // No match
      }

      // If this was a partial match, collect its remainders
      if (compResult.hasPartialMatch && compResult.remainders.length > 0) {
        partialMatchRemainders.unshift(...compResult.remainders);
      }
    }

    // Move to next components (leftward)
    targetIdx--;
    findIdx--;
  }

  // Check if we matched all of find components
  if (findIdx < 0) {
    // All find components matched! Build remainder from unmatched target components
    const unmatchedTargetComponents = targetComponents.slice(0, targetIdx + 1);

    // Combine unmatched target components with partial match remainders
    let allRemainders: Selector[] = [];

    // Add unmatched target components
    if (unmatchedTargetComponents.length > 0) {
      if (unmatchedTargetComponents.length === 1 && !isNode(unmatchedTargetComponents[0], 'Combinator')) {
        allRemainders.push(unmatchedTargetComponents[0] as Selector);
      } else {
        allRemainders.push(new ComplexSelector(unmatchedTargetComponents).inherit(target));
      }
    }

    // Add partial match remainders
    allRemainders.push(...partialMatchRemainders);

    if (allRemainders.length === 0) {
      // Full match: all components matched completely
      return {
        hasMatch: true,
        hasFullMatch: true,
        hasPartialMatch: false,
        matched: [find],
        remainders: []
      };
    } else if (partial) {
      // Partial match: some components or parts remain
      return {
        hasMatch: true,
        hasFullMatch: false,
        hasPartialMatch: true,
        matched: [find],
        remainders: allRemainders
      };
    }
  }

  // No match
  return {
    hasMatch: false,
    hasFullMatch: false,
    hasPartialMatch: false,
    matched: [],
    remainders: [target]
  };
}

function matchComplexAgainstSimple(target: ComplexSelector, find: Selector, partial: boolean): MatchResult {
  // target: .a.b > .c, find: .b -> check if find matches any component
  // Supports partial matching within compound selectors, even across combinators
  // Example: .a.b > .c can match .b > .c (partial match with remainder .a)
  const components = target.value;

  for (let i = 0; i < components.length; i++) {
    const component = components[i]!;

    if (isNode(component, 'Combinator')) {
      // Skip combinators
      continue;
    }

    // Check if this component is adjacent to a combinator
    const hasPrevCombinator = i > 0 && isNode(components[i - 1], 'Combinator');
    const hasNextCombinator = i < components.length - 1 && isNode(components[i + 1], 'Combinator');

    // Allow partial matching for components adjacent to combinators too
    // This enables matching like .a.b > .c against .b > .c
    const allowPartialForThisComponent = partial;

    const result = matchSelectors(component, find, allowPartialForThisComponent);
    if (result.hasMatch) {
      // If we found a partial match within a compound, we need to handle remainders properly
      if (result.hasPartialMatch && result.remainders.length > 0) {
        // Build new complex selector with the matched component replaced by its remainders
        const newComponents = [...components];
        // Type assertion needed because remainder could be any Selector type
        newComponents[i] = result.remainders[0]! as ComplexSelectorValue[number];

        return {
          hasMatch: true,
          hasFullMatch: false,
          hasPartialMatch: true,
          matched: result.matched,
          remainders: [new ComplexSelector(newComponents as ComplexSelectorValue).inherit(target)]
        };
      } else if (result.hasFullMatch) {
        // Full match - remove this component and build remainder from remaining components
        const remainderComponents = components.filter((_, idx) => idx !== i);

        let remainders: Selector[];
        if (remainderComponents.length === 0) {
          remainders = [];
        } else if (remainderComponents.length === 1 && !isNode(remainderComponents[0], 'Combinator')) {
          remainders = [remainderComponents[0] as Selector];
        } else {
          remainders = [new ComplexSelector(remainderComponents as ComplexSelectorValue).inherit(target)];
        }

        return {
          hasMatch: true,
          hasFullMatch: remainders.length === 0,
          hasPartialMatch: remainders.length > 0,
          matched: [find],
          remainders: remainders
        };
      }
    }
  }

  return {
    hasMatch: false,
    hasFullMatch: false,
    hasPartialMatch: false,
    matched: [],
    remainders: [target]
  };
}

function hasIsPseudoSelector(selector: ComplexSelector): boolean {
  // Check if any component in the complex selector has :is() pseudo-selectors
  for (const component of selector.value) {
    if (isNode(component, 'CompoundSelector')) {
      for (const subcomp of component.value) {
        if (isNode(subcomp, 'PseudoSelector') && subcomp.value.name === ':is') {
          return true;
        }
      }
    }
  }
  return false;
}

// Sophisticated right-to-left backtracking algorithm for complex :is() matching
function backtrackingMatch(target: ComplexSelector, find: ComplexSelector): MatchResult {
  const targetComponents = target.value;
  const findComponents = find.value;

  // Step-by-step matching from right to left implementing the key insight
  // Example: target: .x + .d:is(.a > .b) > .c, find: .a > .b > .c
  // 1. .c matches .c ✓
  // 2. > matches > ✓
  // 3. .d:is(.a > .b) expands :is() and matches .b from right-to-left ✓
  // 4. Continue with .a > matching against remaining parts ✓
  // 5. Result: partial match with .x + as remainder

  let targetIdx = targetComponents.length - 1;
  let findIdx = findComponents.length - 1;
  const matchedPairs: Array<{ tIdx: number; fIdx: number }> = [];

  while (findIdx >= 0 && targetIdx >= 0) {
    const currentTarget = targetComponents[targetIdx];
    const currentFind = findComponents[findIdx];

    if (!currentTarget || !currentFind) break;

    // Direct match case
    if (currentTarget.valueOf() === currentFind.valueOf()) {
      matchedPairs.push({ tIdx: targetIdx, fIdx: findIdx });
      targetIdx--;
      findIdx--;
      continue;
    }

    // Check if target is a compound with :is()
    if (isNode(currentTarget, 'CompoundSelector')) {
      let foundMatch = false;

      for (const comp of currentTarget.value) {
        if (isNode(comp, 'PseudoSelector') && comp.value.name === ':is') {
          const arg = comp.value.arg;

          if (arg) {
            // Handle both cases: :is() can have a single selector OR a selector list
            const alternatives: Selector[] = isNode(arg, 'SelectorList') ? arg.value as Selector[] : [arg as Selector];

            // Try each alternative in :is()
            for (const alt of alternatives) {
              if (isNode(alt, 'ComplexSelector')) {
                // For complex :is() alternatives, we need to handle compound selector semantics
                // The :is() content can match parts of the find sequence, while other parts
                // of the compound can match other parts of the find sequence
                const altComponents = alt.value;

                // Try different matching strategies for compound selectors with :is()
                const matchResult = tryMatchCompoundWithIs(currentTarget, alt, findComponents, findIdx, targetIdx);
                if (matchResult) {
                  matchedPairs.push(...matchResult.matches);
                  findIdx = matchResult.newFindIdx;
                  targetIdx--;
                  foundMatch = true;
                  break;
                }
              } else {
                // Simple alternative (not a ComplexSelector)
                if (alt.valueOf() === currentFind.valueOf()) {
                  matchedPairs.push({ tIdx: targetIdx, fIdx: findIdx });
                  targetIdx--;
                  findIdx--;
                  foundMatch = true;
                  break;
                }
              }
            }
          }
        }

        if (foundMatch) break;
      }

      if (foundMatch) continue;
    }

    // No match found, try skipping target (partial match)
    targetIdx--;
  }

  // Check if we matched all find components
  if (findIdx < 0) {
    // All find components matched - build result with remainders
    const remainderComponents: any[] = [];
    const matchedTargetIndices = new Set(matchedPairs.map(p => p.tIdx));

    for (let i = 0; i < targetComponents.length; i++) {
      if (!matchedTargetIndices.has(i)) {
        remainderComponents.push(targetComponents[i]);
      }
    }

    let remainders: Selector[];
    if (remainderComponents.length === 0) {
      remainders = [];
    } else if (remainderComponents.length === 1 && !isNode(remainderComponents[0], 'Combinator')) {
      remainders = [remainderComponents[0] as Selector];
    } else {
      remainders = [new ComplexSelector(remainderComponents as ComplexSelectorValue).inherit(target)];
    }

    return {
      hasMatch: true,
      hasFullMatch: remainders.length === 0,
      hasPartialMatch: remainders.length > 0,
      matched: [find],
      remainders: remainders
    };
  }

  // Failed to match all find components
  return {
    hasMatch: false,
    hasFullMatch: false,
    hasPartialMatch: false,
    matched: [],
    remainders: [target]
  };
}

// Helper function to match compound selectors containing :is() with complex alternatives
function tryMatchCompoundWithIs(
  compoundTarget: CompoundSelector,
  isAlternative: ComplexSelector,
  findComponents: any[],
  findIdx: number,
  targetIdx: number
): { matches: Array<{ tIdx: number; fIdx: number }>; newFindIdx: number } | null {
  // Key insight: In a compound like :is(.a > .d).b, the elements .d and .b are both
  // properties of the same element. So when matching .a > .b > .c:
  // - We can match .b with .b from the compound
  // - We can match .a > with .a > from the :is(.a > .d) part
  // - The .d becomes part of the remainder

  const altComponents = isAlternative.value;
  const matches: Array<{ tIdx: number; fIdx: number }> = [];
  let currentFindIdx = findIdx;

  // Try to match from right to left in the :is() alternative
  let altIdx = altComponents.length - 1;

  // First, try to match any non-:is() parts of the compound with current find component
  for (const comp of compoundTarget.value) {
    if (isNode(comp, 'PseudoSelector') && comp.value.name === ':is') {
      continue; // Skip :is(), we handle it separately
    }

    // Check if this compound component matches current find component
    const currentFind = findComponents[currentFindIdx];
    if (comp.valueOf() === currentFind?.valueOf()) {
      matches.push({ tIdx: targetIdx, fIdx: currentFindIdx });
      currentFindIdx--;
      break; // Found a match, move to :is() processing
    }
  }

  // Now try to match the :is() alternative components from right to left
  while (altIdx >= 0 && currentFindIdx >= 0) {
    const altComp = altComponents[altIdx];
    const findComp = findComponents[currentFindIdx];

    if (altComp && findComp && altComp.valueOf() === findComp.valueOf()) {
      matches.push({ tIdx: targetIdx, fIdx: currentFindIdx });
      altIdx--;
      currentFindIdx--;
    } else {
      // If we can't match this component, we might still have a partial match
      // depending on what we've already matched
      break;
    }
  }

  // Check if we made meaningful progress
  if (currentFindIdx < findIdx) {
    return { matches, newFindIdx: currentFindIdx };
  }

  return null;
}
