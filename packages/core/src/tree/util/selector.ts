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

export function matchSelectors(target: Selector, find: Selector, partial = false): MatchResult {
  // Handle the key insight: right-to-left matching through :is() alternatives

  // First, try direct valueOf() match for simple cases
  if (target.valueOf() === find.valueOf()) {
    return {
      hasMatch: true,
      hasFullMatch: true,
      hasPartialMatch: false,
      matched: [target],
      remainders: []
    };
  }

  // Handle case where find is a selector list - check if target matches any selector in the list
  if (isNode(find, 'SelectorList')) {
    return matchTargetAgainstSelectorList(target, find, partial);
  }

  // For complex selectors, use the sophisticated right-to-left backtracking algorithm
  if ((isNode(target, 'ComplexSelector') && isNode(find, 'ComplexSelector')) && partial) {
    return backtrackingMatch(target, find);
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

    // Direct component match
    const componentResult = matchSelectors(component, find, false);
    if (componentResult.hasMatch && componentResult.hasFullMatch) {
      // Build remainder by removing this component
      const remainderComponents = target.value.filter((_, idx) => idx !== i);

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
        matched: [component],
        remainders: remainders
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

function matchCompoundToCompound(target: CompoundSelector, find: CompoundSelector, partial: boolean): MatchResult {
  // Handle compound to compound matching: target .a:is(.b, .c), find .a.b
  // Need to match all components in find against components in target

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

  // For partial matches, we need to be careful not to match across combinators improperly
  if (partial && isNode(target, 'ComplexSelector') && isNode(find, 'ComplexSelector')) {
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
  // This is the subsequence matching case: target .a > .b > .c, find .b > .c
  // Need to find find sequence within target sequence

  if (target.valueOf() === find.valueOf()) {
    return {
      hasMatch: true,
      hasFullMatch: true,
      hasPartialMatch: false,
      matched: [find],
      remainders: []
    };
  }

  if (partial) {
    // Try to find the find sequence as a subsequence within target
    const targetComponents = target.value;
    const findComponents = find.value;

    // Try each starting position in target
    for (let startIdx = 0; startIdx <= targetComponents.length - findComponents.length; startIdx++) {
      let allMatch = true;

      // Check if find sequence matches at this position
      for (let i = 0; i < findComponents.length; i++) {
        const targetComp = targetComponents[startIdx + i]!;
        const findComp = findComponents[i]!;

        // For exact subsequence matching, components must be identical
        if (targetComp.valueOf() !== findComp.valueOf()) {
          allMatch = false;
          break;
        }
      }

      if (allMatch) {
        // Found a match! Build remainders
        const beforeComponents = targetComponents.slice(0, startIdx);
        const afterComponents = targetComponents.slice(startIdx + findComponents.length);
        const remainderComponents = [...beforeComponents, ...afterComponents];

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

function matchComplexAgainstSimple(target: ComplexSelector, find: Selector, partial: boolean): MatchResult {
  // target: .a.b > .c, find: .a.b -> check if find matches any component before a combinator
  const components = target.value;

  for (let i = 0; i < components.length; i++) {
    const component = components[i]!;

    if (isNode(component, 'Combinator')) {
      // Stop at first combinator - don't match across combinators
      break;
    }

    const result = matchSelectors(component, find, false);
    if (result.hasMatch && result.hasFullMatch) {
      // Build remainder from remaining components
      const remainderComponents = components.slice(i + 1);

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

  return {
    hasMatch: false,
    hasFullMatch: false,
    hasPartialMatch: false,
    matched: [],
    remainders: [target]
  };
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
