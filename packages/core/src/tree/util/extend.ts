/**
 * EXTEND UTILITY - REQUIREMENTS AND FEATURE SET
 * ==============================================
 *
 * This module implements the core extend functionality for Jess, allowing selectors to
 * "extend" other selectors, adding them to selector lists or wrapping them in :is() pseudo-classes.
 *
 * ## Core Concept
 *
 * Extend allows a selector to "inherit" styles from another selector by adding the extending
 * selector to the target selector's selector list, or by creating :is() wrappers when appropriate.
 *
 * Example: `.child:extend(.parent)` means "add .child to .parent's selector list"
 * Result: `.parent, .child { ... }`
 *
 * ## Two Modes: Partial vs Full
 *
 * ### Partial Mode (partial: true)
 * - Used when the `!all` flag is NOT specified
 * - Creates :is() wrappers for component-level matches
 * - Example: `.a>.b:extend(.b !all)` → `.a>:is(.b,.c)` (if .b extended with .c)
 *
 * ### Full Mode (partial: false)
 * - Used when the `!all` flag IS specified
 * - Creates selector lists for root-level matches
 * - Creates :is() wrappers for component matches in compound selectors (to preserve other components)
 * - Example: `.btn:hover:extend(.btn !all)` → `:is(.btn,.primary):hover` (if .btn extended with .primary)
 * - **CRITICAL**: Rejects ALL partial matches - if a match is only PARTIAL (e.g., `.i` matching within `.i.j`),
 *   the selector is returned unchanged, regardless of context (SelectorList, :is(), compound, complex, etc.)
 *   - The partial match is determined at the level of the matched selector itself (e.g., `.i` is partial within `.i.j`)
 *   - Outer context (SelectorList, :is(), components after) is irrelevant for determining if a match is partial
 * - **Exception**: Even if a match is a FULL match of an item within `:is()`, if there are components AFTER the `:is()`,
 *   it becomes a partial match of the entire selector and is rejected
 *   - Example: `:is(.i).j` matching `.i` (full match of item in :is()) is partial because `.j` comes after the `:is()`
 *
 * ## When to Create :is() Wrappers vs Selector Lists
 *
 * ### Create Selector List (.a, .b) when:
 * 1. Root-level full match (entire selector matches): `.a:extend(.a !all)` → `.a, .b`
 *    - This applies regardless of selector type (simple, compound, complex, etc.)
 *    - Example: `.a.b:extend(.a.b !all)` → `.a.b, .c` (not because it's compound, but because entire selector matches)
 * 2. Partial match where extendWith is a complex selector and matches a segment:
 *    - Example: `.a.b > .c.d {}` with `.g:extend(.b > .c !all)` → `.a.b > .c.d, .g {}`
 *    - Reasoning: In compounds, order doesn't matter. The matched segment is replaced entirely.
 *    - Example: `.a > .b.c > .d {}` with `.e:extend(.a > .c !all)` → `:is(.a > .b.c, .e) > .d {}`
 *
 * ### Create :is() Wrapper (:is(.a, .b)) when:
 * 1. Component match in compound selector (FULL mode): `.btn:hover:extend(.btn !all)` → `:is(.btn,.primary):hover`
 *    - REASON: Must preserve other components (like :hover) that aren't being extended
 * 2. Component match in compound selector (PARTIAL mode): `.a.b:extend(.b)` → `.a:is(.b,.c)`
 * 3. Component match in complex selector (FULL mode): `.aa .dd:extend(.aa !all)` → `:is(.aa,.cc) .dd`
 *    - REASON: Anything that's "part of" a selector gets wrapped in :is()
 * 4. Component match in complex selector (PARTIAL mode): `.a>.b:extend(.b)` → `.a>:is(.b,.c)`
 * 5. Full match of entire selector within :is() argument: `:is(.a,.b):extend(.a !all)` → `:is(.a,.b,.c)`
 *    - REASON: When matching an entire selector within a SelectorList (the :is() argument),
 *      we just add to that list, same as root-level matches. No special handling needed.
 *    - The recursive extend applies the same logic: full match = add to list, component match = wrap in :is()
 *
 * ## Critical Distinction: Component Matches in Compound Selectors
 *
 * **IMPORTANT**: Even in FULL mode, component matches within compound selectors create :is() wrappers,
 * NOT selector lists. This is because:
 * - `.btn:hover` extending with `.primary` should become `:is(.btn,.primary):hover`
 * - NOT `.btn:hover,.primary:hover` (which would be wrong - `.primary:hover` doesn't exist in original)
 *
 * The other components of the compound selector (like `:hover`) must be preserved, which requires
 * wrapping in :is() rather than creating a selector list.
 *
 * ## Special Cases
 *
 * ### Boundary Crossing
 * - When a match crosses an :is() boundary (e.g., `:is(.a, .b).c` matching `.b.c`), the selector
 *   must be flattened first: `:is(.a, .b).c` → `:is(.a.c, .b.c)`
 * - Then, if extending the flattened result, apply normal extend rules:
 *   - Example: `:is(.a, .x).c > :is(.b > .y).d {}` with `.e:extend(.a.c) {}`
 *   - Step 1: Flatten boundary crossing → `:is(.a.c, .x.c) > :is(.b > .y).d {}`
 *   - Step 2: Extend `.a.c` with `.e` (full match in SelectorList) → `:is(.a.c, .x.c, .e) > :is(.b > .y).d {}`
 *   - REASON: `.a.c` is a full match in the SelectorList, so we add `.e` to the list (same as root-level)
 *
 * ### Self-Referencing Extends
 * - `.a:extend(.a)` should be ignored (handled by shouldSkipRuleset in rules.ts)
 *
 * ### Pseudo-Selector Arguments
 * - Matches inside :is(), :where(), :not(), :has() arguments are extended recursively
 * - Only :is() allows boundary crossing
 *
 * ## Multiple Component Matches
 *
 * When multiple components in a compound selector match, each component is wrapped separately
 * in its own :is() wrapper:
 * - Example: `.a.b.c` with `.a` extended by `.x` and `.b` extended by `.y`
 * - Result: `:is(.a, .x):is(.b, .y).c`
 * - Each match is independent and gets its own :is() wrapper
 */

import { type Selector } from '../selector';
import { syncLog } from './__tests__/debug-log';
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
  | 'AMPERSAND_BOUNDARY'
  | 'PARTIAL_MATCH';

/**
 * Error type constants for extend operations
 */
export const ExtendErrorType = {
  NOT_FOUND: 'NOT_FOUND' as const,
  ELEMENT_CONFLICT: 'ELEMENT_CONFLICT' as const,
  ID_CONFLICT: 'ID_CONFLICT' as const,
  AMPERSAND_BOUNDARY: 'AMPERSAND_BOUNDARY' as const,
  PARTIAL_MATCH: 'PARTIAL_MATCH' as const
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
 * Helper function to create a SelectorList from an array of selectors,
 * with deduplication and flattening of generated :is() wrappers applied.
 * This is the standard pattern used throughout extend operations.
 *
 * @param selectors - Array of selectors to process
 * @param inheritFrom - Optional selector to inherit from
 * @returns A new SelectorList with deduplicated and flattened selectors
 */
function createExtendedSelectorList(selectors: Selector[], inheritFrom?: Selector): SelectorList {
  const flattened = flattenGeneratedIs(selectors);
  const deduplicated = deduplicateSelectors(flattened);
  const result = SelectorList.create(deduplicated);
  return inheritFrom ? result.inherit(inheritFrom) : result;
}

/**
 * Detects and handles boundary-crossing matches where a compound selector find
 * matches across an :is() boundary in a compound selector target.
 *
 * Example: :is(.a, .b).c matching .b.c should flatten to .a.c, .b.c, .d.c
 *
 * However, if the match consumes the ENTIRE target selector (e.g., :is(.a, .b).c
 * matching .a.c where .a matches inside :is() and .c matches after), we should
 * NOT flatten but instead treat it as a root-level full match (selector list).
 *
 * @param target - The compound selector to extend
 * @param find - The compound selector being matched (must have length > 1)
 * @param extendWith - The selector to extend with
 * @returns The flattened selector list if boundary-crossing detected, null otherwise
 */
function detectAndHandleBoundaryCrossing(
  target: CompoundSelector,
  find: CompoundSelector,
  extendWith: Selector
): Selector | null {
  if (find.value.length <= 1) {
    return null;
  }

  // Look for :is() components in the target
  for (let i = 0; i < target.value.length; i++) {
    const comp = target.value[i];
    if (!isNode(comp, 'PseudoSelector') || comp.value.name !== ':is') {
      continue;
    }

    const arg = comp.value.arg;
    if (!arg || !(arg as any).isSelector || !isNode(arg, 'SelectorList')) {
      continue;
    }

    // Check if the first part of find matches inside the :is() and the rest matches after
    const firstPart = find.value[0];
    const restParts = find.value.slice(1);

    if (!firstPart || restParts.length === 0 || i + 1 >= target.value.length) {
      continue;
    }

    // Check if firstPart matches inside the :is()
    const firstPartSearch = findExtendableLocations(arg, firstPart);
    if (!firstPartSearch.hasMatches) {
      continue;
    }

    // Check if the rest matches the components after the :is()
    const restCompound = restParts.length === 1
      ? restParts[0]!
      : CompoundSelector.create(restParts);
    const afterIs = target.value.slice(i + 1);
    const afterIsCompound = afterIs.length === 1
      ? afterIs[0]!
      : CompoundSelector.create(afterIs);

    let restMatches = false;
    // Handle compound selector after :is()
    if (isNode(afterIsCompound, 'CompoundSelector')) {
      const restSearch = findExtendableLocations(afterIsCompound, restCompound);
      if (restSearch.hasMatches) {
        restMatches = true;
      }
    } else if (afterIs.length === 1) {
      // Single component after :is()
      const afterIsComponent = afterIs[0]!;
      const restSearch = findExtendableLocations(afterIsComponent, restCompound);
      if (restSearch.hasMatches) {
        restMatches = true;
      }
    }

    if (restMatches) {
      // We have a boundary-crossing match. Check if we've consumed the ENTIRE target selector.
      // We've consumed the entire target if:
      // 1. No components before :is() (we start at the beginning)
      // 2. We matched one simple part inside :is() (one "or" option, not a compound)
      // 3. We matched all parts after :is() (all "and" parts)
      // 4. The total length matches (we've matched the entire structure)
      //
      // Note: Other options in :is() are "or" options and don't need to match.
      // Only "and" parts (components after :is()) need to match.
      //
      // However, if the firstPart is a compound selector (not a simple selector), we should flatten
      // because we can't preserve the :is() structure when matching compounds inside it.
      const componentsBeforeIs = i; // Number of components before :is()
      const componentsAfterIs = target.value.length - i - 1; // Number of components after :is()
      const findPartsBeforeIs = 1; // We matched firstPart inside :is()
      const findPartsAfterIs = restParts.length; // We matched restParts after :is()

      // Check if firstPart is a simple selector (not a compound)
      const firstPartIsSimple = !isNode(firstPart, 'CompoundSelector') && !isNode(firstPart, 'ComplexSelector');

      // If we've matched exactly the structure of the target (one SIMPLE part in :is(), rest after),
      // and the total length matches, we've consumed the entire target
      // This means we matched all "and" parts (one SIMPLE option from :is() + all parts after)
      if (componentsBeforeIs === 0 // No components before :is() (we start at the beginning)
        && findPartsBeforeIs === 1 // One part matched inside :is() (one "or" option)
        && firstPartIsSimple // The matched part is a simple selector (not a compound)
        && findPartsAfterIs === componentsAfterIs // Rest parts match components after :is() (all "and" parts)
        && find.value.length === target.value.length) { // Total length matches (entire structure)
        // This is a full match of the entire target with a simple selector - don't flatten, let it be handled as root-level
        // The result will be :is(.a, .b).c, .d (selector list) instead of .a.c, .b.c, .d.c (flattened)
        return null;
      }

      // Otherwise, it's a boundary-crossing match that should be flattened
      // This creates all combinations: each :is() option + parts after + extendWith + parts after
      return createFlattenedBoundaryCrossingResult(arg, afterIs, extendWith, target);
    }
  }

  return null;
}

/**
 * Creates flattened selectors for a boundary-crossing match.
 * Each alternative in the :is() is combined with components after it, plus the extension.
 *
 * @param isArg - The SelectorList argument of the :is() pseudo-selector
 * @param afterIs - The components after the :is() in the compound selector
 * @param extendWith - The selector to extend with
 * @param inheritFrom - The selector to inherit from
 * @returns A SelectorList with all flattened combinations
 */
function createFlattenedBoundaryCrossingResult(
  isArg: SelectorList,
  afterIs: SimpleSelector[],
  extendWith: Selector,
  inheritFrom: Selector
): SelectorList {
  const flattenedSelectors: Selector[] = [];

  // For each alternative in :is(), create alt + components after :is()
  for (const alt of isArg.value) {
    const altWithRest = CompoundSelector.create([alt as SimpleSelector, ...afterIs]).inherit(inheritFrom);
    flattenedSelectors.push(altWithRest);
  }

  // Also add extendWith + components after :is()
  const extendWithRest = CompoundSelector.create([extendWith as SimpleSelector, ...afterIs]).inherit(inheritFrom);
  flattenedSelectors.push(extendWithRest);

  return createExtendedSelectorList(flattenedSelectors, inheritFrom);
}

/**
 * Checks if a component is an :is() pseudo-selector with a selector argument.
 *
 * @param comp - The component to check
 * @returns The SelectorList argument if it's an :is() with selector arg, null otherwise
 */
function getIsSelectorArg(comp: SimpleSelector): SelectorList | null {
  if (!isNode(comp, 'PseudoSelector') || comp.value.name !== ':is') {
    return null;
  }
  const arg = comp.value.arg;
  if (!arg || !(arg as any).isSelector || !isNode(arg, 'SelectorList')) {
    return null;
  }
  return arg;
}

/**
 * Extends within an :is() pseudo-selector argument recursively.
 *
 * @param isArg - The SelectorList argument of the :is() pseudo-selector
 * @param find - The selector to find
 * @param extendWith - The selector to extend with
 * @param hasMoreAfterIs - Whether there are more components after the :is() in the parent compound selector
 * @returns The extended argument
 */
function extendWithinIsArg(
  isArg: SelectorList,
  find: Selector,
  extendWith: Selector,
  hasMoreAfterIs: boolean = false
): Selector {
  return extendSelector(isArg, find, extendWith, false, true, hasMoreAfterIs);
}

/**
 * Recursively flatten nested :is() wrappers that were generated during extend.
 * If a SelectorList contains items that are single :is() pseudo-selectors
 * with generated: true, unwrap them and splice their contents into the parent.
 *
 * This is applied recursively to all children, so deeply nested generated :is()
 * wrappers are flattened at every level.
 *
 * Example: :is(.foo, :is(.ext3, .ext4)) → :is(.foo, .ext3, .ext4)
 *
 * Performance: Early bailout if no flattening needed - returns original array.
 */
function flattenGeneratedIs(selectors: Selector[]): Selector[] {
  // First, recursively process each selector's children
  const processedSelectors = selectors.map(sel => flattenGeneratedIsInSelector(sel));

  // Then check if any top-level flattening is needed
  let needsFlattening = false;
  for (let i = 0; i < processedSelectors.length; i++) {
    const sel = processedSelectors[i]!;
    if (isNode(sel, 'PseudoSelector')) {
      const pseudo = sel as PseudoSelector;
      const { name, arg } = pseudo.value;
      if (name === ':is' && pseudo.generated === true && arg) {
        needsFlattening = true;
        break;
      }
    }
  }

  // Early bailout - return processed array if no top-level flattening needed
  if (!needsFlattening) {
    return processedSelectors;
  }

  // Flatten top-level generated :is() wrappers
  const result: Selector[] = [];
  for (let i = 0; i < processedSelectors.length; i++) {
    const selector = processedSelectors[i]!;
    if (isNode(selector, 'PseudoSelector')) {
      const pseudo = selector as PseudoSelector;
      const { name, arg } = pseudo.value;
      if (name === ':is' && pseudo.generated === true && arg) {
        // Unwrap - splice contents into parent
        if (isNode(arg, 'SelectorList')) {
          for (let j = 0; j < arg.value.length; j++) {
            result.push(arg.value[j]!);
          }
        } else {
          result.push(arg as Selector);
        }
        continue;
      }
    }
    result.push(selector);
  }

  return result;
}

/**
 * Recursively flatten generated :is() wrappers within a single selector.
 * Handles PseudoSelector, SelectorList, CompoundSelector, ComplexSelector.
 */
function flattenGeneratedIsInSelector(selector: Selector): Selector {
  // First optimize unnecessary standalone :is() wrappers
  const optimized = optimizeUnnecessaryIsWrapper(selector);
  if (optimized !== selector) {
    // If optimization occurred, recursively process the unwrapped selector
    return flattenGeneratedIsInSelector(optimized);
  }

  // Handle ALL pseudo-selectors with selector arguments (not just :is)
  // This includes :not(), :where(), :has(), etc.
  if (isNode(selector, 'PseudoSelector')) {
    const pseudo = selector as PseudoSelector;
    const { name, arg } = pseudo.value;

    // Process any pseudo-selector that has an argument (could be a selector)
    if (arg && isSelector(arg)) {
      // Recursively flatten the argument
      let flattenedArg: Selector;
      if (isNode(arg, 'SelectorList')) {
        const flattenedItems = flattenGeneratedIs(arg.value);
        // Only create new SelectorList if items changed
        if (flattenedItems !== arg.value) {
          flattenedArg = SelectorList.create(flattenedItems).inherit(arg);
        } else {
          flattenedArg = arg;
        }
      } else {
        flattenedArg = flattenGeneratedIsInSelector(arg as Selector);
      }

      // If arg changed, create new PseudoSelector
      if (flattenedArg !== arg) {
        // Use new (not .create()) to preserve the original's generated status
        // .create() always sets generated=true which would incorrectly mark
        // authored :is() as generated
        const newPseudo = new PseudoSelector({
          name: name,
          arg: flattenedArg
        }).inherit(pseudo);
        // Explicitly copy generated flag from original
        newPseudo.generated = pseudo.generated;
        return newPseudo;
      }
    }
    return selector;
  }

  // Handle SelectorList - recursively process each item
  if (isNode(selector, 'SelectorList')) {
    const flattenedItems = flattenGeneratedIs(selector.value);
    if (flattenedItems !== selector.value) {
      return SelectorList.create(flattenedItems).inherit(selector);
    }
    return selector;
  }

  // Handle CompoundSelector - recursively process each component
  // IMPORTANT: We do NOT unwrap :is() pseudo-selectors that are components of compound selectors.
  // Only process their arguments recursively, but preserve the :is() wrapper itself.
  // This is because :is(.i, .k).j is a valid compound selector structure that should be preserved.
  if (isNode(selector, 'CompoundSelector')) {
    let changed = false;
    const newComponents: SimpleSelector[] = [];
    for (const comp of selector.value) {
      // For :is() pseudo-selectors that are components of compound selectors,
      // we only recursively process their arguments, but we do NOT unwrap them.
      // This preserves structures like :is(.i, .k).j
      if (isNode(comp, 'PseudoSelector') && comp.value.name === ':is' && comp.generated === true) {
        // Process the argument recursively, but keep the :is() wrapper
        const arg = comp.value.arg;
        if (arg && isSelector(arg)) {
          let flattenedArg: Selector;
          if (isNode(arg, 'SelectorList')) {
            const flattenedItems = flattenGeneratedIs(arg.value);
            if (flattenedItems !== arg.value) {
              flattenedArg = SelectorList.create(flattenedItems).inherit(arg);
            } else {
              flattenedArg = arg;
            }
          } else {
            flattenedArg = flattenGeneratedIsInSelector(arg as Selector);
          }

          if (flattenedArg !== arg) {
            const newPseudo = new PseudoSelector({
              name: ':is',
              arg: flattenedArg
            }).inherit(comp);
            newPseudo.generated = comp.generated;
            newComponents.push(newPseudo);
            changed = true;
          } else {
            newComponents.push(comp);
          }
        } else {
          newComponents.push(comp);
        }
      } else {
        // For non-:is() components, process recursively
        const processed = flattenGeneratedIsInSelector(comp as Selector);
        if (processed !== comp) {
          changed = true;
        }
        newComponents.push(processed as SimpleSelector);
      }
    }
    if (changed) {
      return CompoundSelector.create(newComponents).inherit(selector);
    }
    return selector;
  }

  // Handle ComplexSelector - recursively process each component
  if (isNode(selector, 'ComplexSelector')) {
    let changed = false;
    const newComponents: ComplexSelectorValue = [];
    for (const comp of selector.value) {
      if (isNode(comp, 'Combinator')) {
        newComponents.push(comp);
      } else {
        const processed = flattenGeneratedIsInSelector(comp as Selector);
        if (processed !== comp) {
          changed = true;
        }
        newComponents.push(processed as any);
      }
    }
    if (changed) {
      return ComplexSelector.create(newComponents).inherit(selector);
    }
    return selector;
  }

  // For other selector types, return as-is
  return selector;
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
  skipAmpersandCheck: boolean = false,
  hasMoreAfterIs: boolean = false
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

  // Special handling for SelectorList targets - extend each matching selector in the list
  if (isNode(target, 'SelectorList')) {
    // DEBUG: Log SelectorList processing
    const targetStr = target.valueOf();
    const findStr = find.valueOf();
    // Log if target contains .ext8 .ext9 and find is .ext8+.ext9 or .ext8>.ext9
    if (targetStr?.includes('.ext8') && targetStr?.includes('.ext9') && 
        (findStr === '.ext8+.ext9' || findStr === '.ext8>.ext9')) {
      syncLog({ location: 'extendSelector', action: 'Processing SelectorList', target: targetStr, find: findStr, extendWith: extendWith.valueOf(), partial, selectorListItems: target.value.map(s => s.valueOf()) });
    }
    
    // For SelectorLists, we need to extend each selector that contains the find target
    // Keep original selectors in place, collect new selectors to append at the end
    const originalSelectors: Selector[] = [];
    const newSelectors: Selector[] = [];

    for (const selector of target.value) {
      const selectorSearchResult = findExtendableLocations(selector, find);
      if (selectorSearchResult.hasMatches) {
        // DEBUG: Log match found
        if (targetStr?.includes('.ext8') && targetStr?.includes('.ext9') && 
            (findStr === '.ext8+.ext9' || findStr === '.ext8>.ext9')) {
          syncLog({ location: 'extendSelector', action: 'Match found in SelectorList item', selector: selector.valueOf(), find: findStr, willExtend: true });
        }
        
        // This selector contains the find target - extend it
        // If partial: false and it's only a partial match, extendSelector will return unchanged
        const extended = extendSelector(selector, find, extendWith, partial, skipAmpersandCheck);
        
        // DEBUG: Log extend result
        if (targetStr?.includes('.ext8') && targetStr?.includes('.ext9') && 
            (findStr === '.ext8+.ext9' || findStr === '.ext8>.ext9')) {
          syncLog({ location: 'extendSelector', action: 'Extended SelectorList item', original: selector.valueOf(), extended: extended.valueOf(), sameObject: extended === selector, extendedType: extended.type });
        }
        
        // If the result is unchanged (same object reference), keep it as-is
        if (extended === selector) {
          originalSelectors.push(selector);
        } else if (isNode(extended, 'SelectorList')) {
          // First item is the original (possibly modified), rest are new
          // CRITICAL: Clone selectors to avoid object reference issues
          originalSelectors.push(extended.value[0]!.clone(true));
          newSelectors.push(...extended.value.slice(1).map(s => s.clone(true)));
        } else {
          // CRITICAL: Clone the extended selector
          originalSelectors.push(extended.clone(true));
        }
      } else {
        // This selector doesn't contain the find target - keep it as-is
        // CRITICAL: Clone to avoid object reference issues
        originalSelectors.push(selector.clone(true));
      }
    }

    // Append new selectors at the end, preserving order extends were applied
    // Flatten any nested :is() that were generated during extend
    const allSelectors = [...originalSelectors, ...newSelectors];
    const result = createExtendedSelectorList(allSelectors, target);
    
    // DEBUG: Log final result
    if (targetStr?.includes('.ext8 .ext9') && !targetStr.includes('+') && !targetStr.includes('>') && 
        (findStr === '.ext8+.ext9' || findStr === '.ext8>.ext9')) {
      syncLog({ location: 'extendSelector', action: 'SelectorList result', original: targetStr, result: result.valueOf(), resultType: result.type });
    }
    
    return result;
  }

  // For partial extends, prefer actual matches over "append to :is() list" extension points
  // The "append to list" locations have paths ending in 'arg', while actual matches have
  // more specific paths like [index, 'arg', altIndex]
  // For full extends (partial: false), prefer valid full matches
  let location = searchResult.locations[0]!;

  // Exception: When partial: false and we're inside an :is() with more components after it,
  // even if we've matched the entire find (full match of item in :is()), it's still a partial match
  // of the entire selector because there are components after the :is()
  // Example: :is(.i).j with find .i and partial: false
  // We matched .i (full match of item in :is()), but there's .j after, so this is a partial match
  if (!partial && hasMoreAfterIs) {
    // If target is a SelectorList (we're inside an :is() argument), check if we matched an entire item
    const isInsideSelectorList = isNode(target, 'SelectorList');

    if (isInsideSelectorList) {
      // The location path will be like [index] or ['arg', index] when matching an item in the list
      // Check if we matched an entire item (not a partial match within that item)
      const pathHasIndex = location.path.some((p, i) =>
        typeof p === 'number' && (i === 0 || location.path[i - 1] === 'arg')
      );
      const matchedEntireItem = pathHasIndex && !location.isPartialMatch;

      // Also check if the matched node equals the find
      const matchedNode = location.matchedNode;
      const matchedNodeEqualsFind = matchedNode && matchedNode.valueOf() === find.valueOf();

      // If we matched an entire item and there are more components after, this is a partial match
      if (matchedEntireItem || matchedNodeEqualsFind) {
        throw new ExtendError(
          ExtendErrorType.PARTIAL_MATCH,
          'Partial match found but exact match required',
          { target, find, extendWith }
        );
      }
    }
  }

  // (Partial matches are now handled by the unified check in the full matching mode section)
  if (!partial && searchResult.locations.length > 1) {
    // When partial: false, prefer valid full matches (root-level or first component of complex selector)
    // IMPORTANT: Must check !loc.isPartialMatch to avoid selecting partial matches
    const validFullMatch = searchResult.locations.find((loc) => {
      if (loc.path.length === 0 && !loc.isPartialMatch) {
        return true;
      }
      if (loc.path.length === 1 && isNode(target, 'ComplexSelector') && loc.path[0] === 0 && !loc.isPartialMatch) {
        return true;
      }
      if (loc.path.includes('arg') && !loc.isPartialMatch) {
        return true;
      }
      return false;
    });
    if (validFullMatch) {
      location = validFullMatch;
    }
  } else if (partial && searchResult.locations.length > 1) {
    // Find a location that's not just an "append to :is() list" opportunity
    // These have paths ending in 'arg' without a following index
    const actualMatch = searchResult.locations.find((loc) => {
      // If it's not an append type, it's definitely an actual match
      if (loc.extensionType !== 'append') {
        return true;
      }
      // For append types, check if this is an actual match inside :is() vs just an append opportunity
      // Actual matches have paths like [0, 'arg', 0] (ending in a number after 'arg')
      // Append opportunities have paths like [0, 'arg'] (ending in 'arg')
      const lastPathElement = loc.path[loc.path.length - 1];
      return typeof lastPathElement === 'number';
    });
    if (actualMatch) {
      location = actualMatch;
    }
  }

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

        return createExtendedSelectorList([target, combinedExtension], target);
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
            return createExtendedSelectorList([target, combinedExtension], target);
          }
        }
      }

      return createExtendedSelectorList([target, extendWith], target);
    }

    // For deeper matches in partial mode, we need to analyze the context
    // If we're matching within a compound selector, create :is() wrapper
    if (location.path.length > 0) {
      // When partial: true, we may have multiple matching locations (e.g., .bb .bb has two .bb matches)
      // Process all matching locations, not just the first one
      if (isNode(target, 'ComplexSelector') && searchResult.locations.length > 1) {
        // Filter to only component-level matches (path length 1, not combinators)
        const componentMatches = searchResult.locations.filter(loc =>
          loc.path.length === 1
          && typeof loc.path[0] === 'number'
          && !isNode(target.value[loc.path[0] as number], 'Combinator')
        );

        if (componentMatches.length > 1) {
          // Process all component matches - wrap each matching component in :is()
          const newComponents = [...target.value];
          for (const matchLoc of componentMatches) {
            const componentIndex = matchLoc.path[0] as number;
            const matchedComponent = newComponents[componentIndex];
            if (matchedComponent && !isNode(matchedComponent, 'Combinator')) {
              // Wrap this component in :is(original, extension)
              newComponents[componentIndex] = createIsWrapper([matchedComponent, extendWith], matchedComponent);
            }
          }
          return ComplexSelector.create(newComponents).inherit(target);
        }
      }

      return handlePartialModeExtension(target, location, extendWith);
    }

    return applyExtensionAtLocation(target, location, extendWith);
  } else {
    // FULL MATCHING MODE: Create selector lists for complete matches

    // When partial: false, reject ALL partial matches - unified check before any special-casing
    // This applies regardless of context (root, SelectorList, :is(), compound, complex, etc.)
    if (!partial && location.isPartialMatch) {
      return target;
    }

    // Check for boundary-crossing matches in compound selectors FIRST
    // This handles cases like :is(.a, .b).c matching .b.c where the match crosses the :is() boundary
    // This must be checked before handleFullExtend because it requires special flattening logic
    if (isNode(target, 'CompoundSelector') && isNode(find, 'CompoundSelector')) {
      const boundaryResult = detectAndHandleBoundaryCrossing(target, find, extendWith);
      if (boundaryResult) {
        return boundaryResult;
      }
    }

    // Special handling for pseudo-selector matches in full mode
    // All pseudo-selectors with selector arguments allow extending inside
    // This includes :is(), :where(), :not(), :has(), and any other pseudo-selector with selector args
    if (location.path.includes('arg')) {
      // (Partial matches are already handled by the unified check above - no need to check again)
      // But double-check: if the path indicates a match deep inside (e.g., ['arg', index, subIndex]),
      // and that match is partial, we should have already returned above. If we reach here,
      // it means either it's a full match OR the isPartialMatch flag wasn't set correctly.
      // For safety, if the path has more than just 'arg' (meaning we're matching inside a selector
      // within the :is() argument), check if it's a partial match by examining the matched node.
      // Double-check for partial matches: if path indicates component match within compound
      // (e.g., ['arg', index, subIndex] where both index and subIndex are numbers)
      if (location.path.length >= 3) {
        const pathLastNum = location.path[location.path.length - 1];
        const pathSecondLast = location.path[location.path.length - 2];
        // Path like ['arg', index, subIndex] indicates component match within compound selector
        if (typeof pathLastNum === 'number' && typeof pathSecondLast === 'number') {
          const matchedNode = location.matchedNode;
          // If matching a SimpleSelector within a compound, it's a partial match
          if (matchedNode && isNode(matchedNode, 'SimpleSelector') && isNode(find, 'SimpleSelector')) {
            if (matchedNode.valueOf() === find.valueOf()) {
              // Component match within compound - treat as partial
              return target;
            }
          }
        }
      }

      // Check if this is a compound target that fully matches a compound selector
      // In this case, create a selector list instead of extending inside the pseudo-selector
      if (isNode(find, 'CompoundSelector') && isNode(target, 'CompoundSelector')) {
        // This is a full compound match - create selector list
        return createExtendedSelectorList([target, extendWith], target);
      }

      // When partial: false and we're matching inside a pseudo-selector (path includes 'arg'),
      // check if there are ANY components outside the :is() (before or after).
      // If so, this is a partial match of the entire selector and should be rejected.
      // Examples:
      // - d :is(.b .c) matching .b .c with partial: false → rejected (d is before)
      // - :is(.i).j matching .i with partial: false → rejected (.j is after)
      // - :is(.i) matching .i with partial: false → allowed (no components outside)
      // Note: We return target unchanged (not throw) to match the behavior of other partial match rejections
      // The chaining logic should check if the selector changed before processing chained extends
      if (!partial) {
        const argIndex = location.path.indexOf('arg');
        if (argIndex > 0) {
          // We're matching inside a pseudo-selector - find the component index
          const componentIndex = location.path[argIndex - 1];

          if (typeof componentIndex === 'number') {
            // Check for components before the :is() in ComplexSelector
            if (isNode(target, 'ComplexSelector') && componentIndex > 0) {
              // There are components before the :is() - this is a partial match
              // Return unchanged - chaining logic should skip if selector didn't change
              return target;
            }

            // Check for components before or after the :is() in CompoundSelector
            if (isNode(target, 'CompoundSelector')) {
              const hasComponentsBefore = componentIndex > 0;
              const hasComponentsAfter = componentIndex < target.value.length - 1;
              if (hasComponentsBefore || hasComponentsAfter) {
                // There are components outside the :is() - this is a partial match
                // Return unchanged - chaining logic should skip if selector didn't change
                return target;
              }
            }
          }
        }
      }

      // This is a full match inside a pseudo-selector argument
      // Always extend inside pseudo-selectors with selector arguments
      return applyExtensionAtLocation(target, location, extendWith);
    }

    // Special handling for full matches at the first component of complex selectors
    // Component matches in complex selectors create :is() wrappers (not selector lists)
    // Example: .aa .dd extended with .cc (where .cc:extend(.aa !all)) should produce :is(.aa, .cc) .dd
    // (Partial matches are already handled by the unified check above)
    if (location.path.length === 1 && isNode(target, 'ComplexSelector') && location.path[0] === 0) {
      // This is a component match in a complex selector - create :is() wrapper
      // REASON: Anything that's "part of" a selector gets wrapped in :is()
      const componentIndex = location.path[0] as number;
      const matchedComponent = target.value[componentIndex];

      if (matchedComponent && !isNode(matchedComponent, 'Combinator')) {
        // Replace the matched component with :is(original, extension)
        const newComponents = [...target.value];
        const isWrapper = createValidatedIsWrapperWithErrors([matchedComponent, extendWith], matchedComponent, target, { target, find, extendWith });

        newComponents[componentIndex] = isWrapper as any;
        return ComplexSelector.create(newComponents).inherit(target);
      }
    }

    // For full matches within compound selectors, create :is() wrapper
    // (Partial matches are already handled by the unified check above)
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

    // Use handleFullExtend for root-level matches and default cases
    // This consolidates logic for SelectorList, PseudoSelector, and CompoundSelector handling
    // and includes performance optimizations for generated selectors
    return handleFullExtend(target, find, extendWith, location);
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
        const newArg = SelectorList.create(newSelectors).inherit(arg);
        // If the original selector was generated, we can mutate it in place for performance
        if (target.generated) {
          target.value.arg = newArg;
          return target;
        } else {
          // For authored selectors, create a new one to preserve the original
          return PseudoSelector.create({
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
          return PseudoSelector.create({
            name: target.value.name,
            arg: newArg
          }).inherit(target);
        }
      }
    }
    // For non-:is() pseudo-selectors or when find matches the entire pseudo-selector,
    // fall through to create a selector list
  }

  // For compound selectors in full extend mode, just create a selector list
  // (Component-level matches are handled earlier in extendSelector, not here)
  // handleCompoundFullExtend is only for special cases like extending within :is() pseudo-selectors
  if (isNode(target, 'CompoundSelector')) {
    // Default case: create a new selector list
    const copyForInheritance = target.clone();
    return SelectorList.create(deduplicateSelectors([target, extendWith])).inherit(copyForInheritance);
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
  // Check for boundary-crossing matches: when find is a compound selector that matches
  // across an :is() boundary (e.g., :is(.a, .b).c matching .b.c should flatten)
  if (isNode(find, 'CompoundSelector')) {
    const boundaryResult = detectAndHandleBoundaryCrossing(target, find, extendWith);
    if (boundaryResult) {
      return boundaryResult;
    }
  }

  // Single loop to handle both :is() extension and regular component matching
  for (let i = 0; i < target.value.length; i++) {
    const comp = target.value[i];
    if (!comp) {
      continue;
    }

    // Check if this is an existing :is() pseudo-selector that might contain the find
    // ONLY :is() allows boundary crossing - all other pseudo-selectors are atomic units
    const isArg = getIsSelectorArg(comp);
    if (isArg) {
      const isSearchResult = findExtendableLocations(isArg, find);
      if (isSearchResult.hasMatches) {
        // Check if there are more components after this :is() in the compound selector
        const hasMoreAfterIs = i + 1 < target.value.length;
        // Extend the :is() argument using the standard API (recursive call)
        const extendedArg = extendWithinIsArg(isArg, find, extendWith, hasMoreAfterIs);

        // If the original selector was generated, we can mutate the :is() component in place
        if (target.generated && isNode(comp, 'PseudoSelector')) {
          comp.value.arg = extendedArg;
          return target;
        } else {
          // For authored selectors, create new compound with updated :is()
          const newComponents = [...target.value];
          newComponents[i] = PseudoSelector.create({
            name: ':is',
            arg: extendedArg
          }).inherit(comp);

          return createValidatedCompoundSelectorWithErrors(newComponents, target);
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
  return createExtendedSelectorList([target, extendWith], target);
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
 * Creates an :is() wrapper with validation that returns fallback on conflicts.
 * High-level wrapper around createValidatedIsWrapperWithErrors that catches errors and returns fallback.
 * @param selectors - Array of selectors to wrap in :is()
 * @param inheritFrom - Selector to inherit properties from
 * @param fallbackSelector - Selector to return if validation fails
 * @param contextSelector - Optional context selector to check for conflicts
 * @returns Valid :is() pseudo-selector or fallback selector
 */
function createValidatedIsWrapper(
  selectors: Selector[],
  inheritFrom: Selector,
  fallbackSelector: Selector,
  contextSelector?: Selector
): PseudoSelector | Selector {
  try {
    return createValidatedIsWrapperWithErrors(selectors, inheritFrom, contextSelector);
  } catch (error) {
    if (error instanceof ExtendError) {
      // Validation failed - return fallback instead of throwing
      return fallbackSelector;
    }
    // Re-throw unexpected errors
    throw error;
  }
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
  hoistedSelector.hoistToRoot = true;
  return hoistedSelector;
}

/**
 * Optimizes unnecessary standalone :is() wrappers that contain a single selector.
 * Removes :is() when it wraps only one selector and was generated during compilation.
 * Example: :is(.a) → .a (when generated)
 * Does NOT optimize :is(.a, .b) (multiple selectors) or :is() in compound selectors.
 * @param selector - The selector to check for optimization
 * @returns Optimized selector or original if no optimization needed
 */
function optimizeUnnecessaryIsWrapper(selector: Selector): Selector {
  // Only optimize standalone :is() pseudo-selectors (not part of a compound)
  // that were generated during compilation and contain a single selector
  if (isNode(selector, 'PseudoSelector')
    && selector.value.name === ':is'
    && selector.generated === true) { // Explicit check for true to avoid falsy values
    const arg = selector.value.arg;
    if (arg && isSelector(arg)) {
      // Only unwrap if it's a single selector, not a SelectorList with multiple items
      // :is(.a) → .a (unnecessary wrapper)
      // :is(.a, .b) → keep as :is(.a, .b) (necessary for multiple selectors)
      if (!isNode(arg, 'SelectorList') || arg.value.length === 1) {
        // This is a standalone :is() with a single selector - unwrap it
        // since :is() is only needed when combined with other components or multiple selectors
        const unwrapped = isNode(arg, 'SelectorList') ? arg.value[0]! : (arg as Selector);
        return unwrapped.inherit(selector);
      }
    }
  }

  // Do NOT optimize:
  // - :is() that existed in the original selector (without generated: true)
  // - Compound selectors like &:is(.bar, .a) - the :is() is necessary there
  // - Selector lists - they have their own structure
  // - Complex selectors - they have their own structure
  // - :is() with multiple selectors - necessary for grouping

  return selector;
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
      if (component.isTag) {
        elementCount++;
      }
      if (component.isId) {
        idCount++;
      }

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
 * Creates a compound selector with validation that returns fallback on conflicts.
 * High-level wrapper around createValidatedCompoundSelectorWithErrors that catches errors and returns fallback.
 * @param components - Array of selectors to combine
 * @param inheritFrom - Selector to inherit properties from
 * @param fallbackSelector - Selector to return if validation fails (defaults to inheritFrom)
 * @returns Valid compound selector or fallback selector
 */
function createValidatedCompoundSelector(
  components: any[],
  inheritFrom: Selector,
  fallbackSelector?: Selector
): CompoundSelector | Selector {
  try {
    return createValidatedCompoundSelectorWithErrors(components, inheritFrom);
  } catch (error) {
    if (error instanceof ExtendError) {
      // Validation failed - return fallback instead of throwing
      return fallbackSelector || inheritFrom;
    }
    // Re-throw unexpected errors
    throw error;
  }
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

/**
 * Finds extends that should be processed next on a newly transformed selector.
 * This is part of the iterative extend process: when a selector is transformed
 * (e.g., .foo -> .foo, .ext3), we check if any selector in the result matches
 * other extend targets. If so, those extends should be processed on the new
 * selector, and we continue iterating until no more transforms occur or all
 * extends are exhausted.
 *
 * Example: .ext3 extends .foo -> .foo, .ext3. We then check if .foo (in the
 * result) matches .ext4:extend(.foo), and if so, process that extend on
 * .foo, .ext3 to get .foo, .ext3, .ext4. This continues until exhausted.
 *
 * @param extendedSelector - The selector after transformation (e.g., .foo, .ext3)
 * @param allExtends - Array of all extends: [target, selectorWithExtend, partial, extendRoot, extendNode]
 * @param currentTarget - The target of the extend that just completed
 * @param currentSelectorWithExtend - The selector that just extended
 * @returns Array of extends to process next: [target, selectorWithExtend, partial, extendRoot, extendNode]
 *         where target is the extendedSelector (the newly transformed selector to continue extending)
 */
export function findChainedExtends(
  extendedSelector: Selector,
  allExtends: Array<[Selector, Selector, boolean, any, any]>,
  currentTarget: Selector,
  currentSelectorWithExtend: Selector,
  originalSelector: Selector
): Array<[Selector, Selector, boolean, any, any]> {
  const chained: Array<[Selector, Selector, boolean, any, any]> = [];

  // Only check SelectorList results (when we get .foo, .ext3 from extending .foo with .ext3)
  if (!isNode(extendedSelector, 'SelectorList')) {
    return chained;
  }

  // Check each selector in the list against all other extends
  // Only chain extends that target selectors that were in the original ruleset selector
  const originalSelectors = isNode(originalSelector, 'SelectorList')
    ? originalSelector.value
    : [originalSelector];
  const originalSelectorValues = new Set(originalSelectors.map(s => s.valueOf()));

  for (const selectorInList of extendedSelector.value) {
    // Only check selectors that were in the original ruleset (not newly added ones)
    if (!originalSelectorValues.has(selectorInList.valueOf())) {
      continue;
    }

    for (const [otherTarget, otherSelectorWithExtend, otherPartial, otherExtendRoot, otherExtendNode] of allExtends) {
      // Skip if this is the same extend we just processed
      if (otherTarget.valueOf() === currentTarget.valueOf()
        && otherSelectorWithExtend.valueOf() === currentSelectorWithExtend.valueOf()) {
        continue;
      }

      // Check if otherTarget matches selectorInList
      const otherTargetSelectors: Selector[] = isNode(otherTarget, 'SelectorList')
        ? otherTarget.value
        : [otherTarget];

      for (const otherSingleTarget of otherTargetSelectors) {
        // Check if selectorInList equals otherSingleTarget (the target of another extend)
        // Combinators must match exactly (space vs + vs > etc.)
        if (selectorInList.valueOf() === otherSingleTarget.valueOf()) {
          chained.push([extendedSelector, otherSelectorWithExtend, otherPartial, otherExtendRoot, otherExtendNode]);
          break; // Only add once per otherTarget
        }
      }
    }
  }

  return chained;
}
