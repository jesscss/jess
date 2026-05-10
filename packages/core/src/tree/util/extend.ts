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
 *
 * ## Partial match: what gets wrapped
 *
 * - **Match within one compound**: Wrap only the matched part. E.g. `.a.b` in `.a.c.b` + extend .q → `:is(.a.b, .q).c`
 * - **Match spans a combinator**: Wrap the FULL segment from first to last matched compound. E.g. `.a.b > .x` in
 *   `div + .a.c.b > .y.x` + extend .q → `div + :is(.a.c.b > .y.x, .q)`. See EXTEND_RULES.md §3a.
 *   Do NOT decide by target type or path length (target can be :is(complex), SelectorList, etc.). Use what the
 *   match PRODUCES (e.g. includes combinators?) and keySet/equivalency.
 *
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
 * - `.a:extend(.a)` should be ignored (handled by shouldSkipRuleset in extend-roots.ts)
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
 *
 * For a concise "rules of extend" checklist, see `EXTEND_RULES.md`.
 * For "where are the tests / where to add coverage", see `__tests__/EXTEND_TEST_INDEX.md`.
 *
 * CORE PRINCIPLE: All extend matching (finding + full-match decision) is by selector equivalency
 * only — never by exact AST or exact serialization. See EXTEND_RULES.md §0.
 */

import type { Rules } from '../rules.js';
import type { Selector } from '../selector.js';
import { SimpleSelector } from '../selector-simple.js';
import { SelectorList } from '../selector-list.js';
import { ComplexSelector, type ComplexSelectorComponent } from '../selector-complex.js';
import { CompoundSelector } from '../selector-compound.js';
import { PseudoSelector, is as isSelectorPseudo } from '../selector-pseudo.js';
import { Ampersand } from '../ampersand.js';
import { Combinator } from '../combinator.js';
import { isNode } from './is-node.js';
import type { Node } from '../node.js';
import { N } from '../node-type.js';
import { findExtendableLocations, type ExtendLocation } from './extend-helpers.js';
import { normalizeSelectorForExtend, type ExtendSearchResult } from './find-extendable-locations.js';
import { F_EXTENDED, F_EXTEND_TARGET, F_IMPLICIT_AMPERSAND, F_VISIBLE } from '../node.js';
import { isDisjoint, isSubsetOf } from './bitset.js';
import {
  selectorCompare,
  type SelectorComparisonResult,
  type MatchScope
} from './selector-compare.js';
import {
  canUseWalkAndConsume,
  walkAndExtend,
  extendWithNeedsConflictValidation,
  wouldExtendChange
} from './extend-walk.js';
import { copyOwnedWithReusableLeaves } from './cloning.js';

const { isArray } = Array;
let extendOrderMap: WeakMap<Selector, number> | null = null;
/** Fallback for clones: selectors inside :is() may be clones, so WeakMap lookup fails. Key by valueOf() string. */
let extendOrderByValueOf: Map<string, number> | null = null;

export function setExtendOrderMap(map: WeakMap<Selector, number> | null, orderByValueOf?: Map<string, number> | null): void {
  extendOrderMap = map;
  extendOrderByValueOf = orderByValueOf ?? null;
}

function isSelectorNode(value: unknown): value is Selector {
  return !!value && typeof value === 'object' && Reflect.get(value, 'isSelector') === true;
}

function expectSelector(value: unknown): Selector {
  if (isSelectorNode(value)) {
    return value;
  }
  throw new TypeError('Expected selector');
}

function expectSelectorArray(value: Selector | Selector[] | ExtendErrorType): Selector[] {
  if (typeof value === 'string') {
    throw new TypeError('Expected selector array, got extend error');
  }
  return isArray(value) ? value : [value];
}

function isComplexComponent(value: unknown): value is ComplexSelectorComponent {
  return isNode(value, N.SimpleSelector)
    || isNode(value, N.CompoundSelector)
    || isNode(value, N.ComplexSelector)
    || isNode(value, N.Combinator);
}

function expectComplexComponents(value: Selector | Selector[] | ExtendErrorType): ComplexSelectorComponent[] {
  if (typeof value === 'string') {
    throw new TypeError('Expected complex selector components, got extend error');
  }
  const items = isArray(value) ? value : [value];
  for (const item of items) {
    if (!isComplexComponent(item)) {
      throw new TypeError('Expected complex selector component');
    }
  }
  return items;
}

/**
 * Walk-and-consume eligibility check for extendSelector dispatch.
 * Returns true only when the walk path is known to produce correct results.
 *
 * Currently very conservative: only handles the simplest cases where
 * walk-and-consume is verified to produce identical output to the legacy path.
 */
function canUseWalkAndConsumeForExtend(target: Selector, find: Selector): boolean {
  // Walk-and-consume doesn't handle extendOrderMap (dead code, but guard anyway)
  if (extendOrderMap) {
    return false;
  }
  // ComplexSelector find is supported by the walk for diagnostics (wouldExtendChange)
  // but not yet for the actual extend application — the downstream createProcessedSelector
  // chain produces subtly different output. Restrict to Simple/Compound find for now.
  if (!isNode(find, N.SimpleSelector) && !isNode(find, N.CompoundSelector)) {
    return false;
  }
  if (!canUseWalkAndConsume(target, find)) {
    return false;
  }
  return true;
}

/**
 * Bridge: attempt walk-and-consume, return null to fall through to legacy path.
 * Returns the extended selector, or null if walk couldn't handle it.
 */
function walkAndExtendForExtendSelector(
  target: Selector,
  find: Selector,
  extendWith: Selector,
  partial: boolean
): Selector | null {
  const result = walkAndExtend(target, find, extendWith, partial);
  // walkAndExtend returns the original target when no match is found.
  // The legacy path throws ExtendError('NOT_FOUND') in that case.
  // Return null to let the legacy path handle it (including the throw).
  if (result === target) {
    return null;
  }
  return result;
}

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

export interface ExtendInstruction {
  target: Selector;
  extendWith: Selector;
  partial: boolean;
  extendRoot?: Rules;
  extendNode?: Node;
}

export function applyExtendsToSelector(
  initialSelector: Selector,
  extendsList: ExtendInstruction[],
  allExtends: ExtendInstruction[] = extendsList
): Selector {
  if (extendsList.length === 0) {
    return initialSelector;
  }
  const expandExactSelectorListTargets = (instructions: ExtendInstruction[]): ExtendInstruction[] => {
    const expanded: ExtendInstruction[] = [];
    for (const instruction of instructions) {
      if (!instruction.partial && isNode(instruction.target, N.SelectorList)) {
        for (const target of instruction.target.value) {
          expanded.push({
            ...instruction,
            target
          });
        }
      } else {
        expanded.push(instruction);
      }
    }
    return expanded;
  };
  let selector = initialSelector;
  const originalSelector = initialSelector;
  const expandedAllExtends = expandExactSelectorListTargets(allExtends);
  const instructions = expandExactSelectorListTargets(extendsList);
  const allExtendTuples = expandedAllExtends.map(inst => [
    inst.target,
    inst.extendWith,
    inst.partial,
    inst.extendRoot,
    inst.extendNode
  ] as [Selector, Selector, boolean, Rules | undefined, Node | undefined]);
  const queuedKeys = new Set(
    instructions.map(inst => `${inst.partial ? 1 : 0}|${inst.target.valueOf()}|${inst.extendWith.valueOf()}`)
  );

  let changed = true;

  while (changed && instructions.length > 0) {
    changed = false;
    for (let i = 0; i < instructions.length; i += 1) {
      const instruction = instructions[i];
      if (!instruction) {
        continue;
      }
      const { target, extendWith, partial } = instruction;

      // Batch all same-target non-partial instructions to avoid O(N²) growing-list
      // scans. Common in Bootstrap-style code where many selectors extend the same base.
      if (!partial && i + 1 < instructions.length) {
        const targetVal = target.valueOf();
        const batchExtendWiths: Selector[] = [extendWith];
        const batchIndices: number[] = [i];
        for (let j = i + 1; j < instructions.length; j++) {
          const next = instructions[j]!;
          if (!next.partial && next.target.valueOf() === targetVal) {
            batchExtendWiths.push(next.extendWith);
            batchIndices.push(j);
          }
        }
        if (batchExtendWiths.length > 1) {
          const batched = applyBatchedExtend(selector, target, batchExtendWiths);
          if (batched !== null && batched.valueOf() !== selector.valueOf()) {
            selector = batched;
            for (let k = batchIndices.length - 1; k >= 0; k--) {
              instructions.splice(batchIndices[k]!, 1);
            }
            const skipKeys = new Set(
              batchExtendWiths.map(batchExtendWith => `${target.valueOf()}|${batchExtendWith.valueOf()}`)
            );
            const chained = findChainedExtendsWithSkips(
              selector,
              allExtendTuples,
              skipKeys,
              originalSelector
            );
            for (const [chainedTarget, chainedExtendWith, chainedPartial] of chained) {
              const chainedKey = `${chainedPartial ? 1 : 0}|${chainedTarget.valueOf()}|${chainedExtendWith.valueOf()}`;
              if (queuedKeys.has(chainedKey)) {
                continue;
              }
              const matchingInstruction = expandedAllExtends.find(inst =>
                inst.partial === chainedPartial
                && inst.target.valueOf() === chainedTarget.valueOf()
                && inst.extendWith.valueOf() === chainedExtendWith.valueOf()
              );
              if (!matchingInstruction) {
                continue;
              }
              instructions.push(matchingInstruction);
              queuedKeys.add(chainedKey);
            }
            changed = true;
            break;
          }
          // No match — fall through to individual tryExtendSelector
          // (do NOT jump over interleaved instructions with different targets)
        }
      }

      const result = tryExtendSelector(selector, target, extendWith, partial);
      if (result && !result.error) {
        const beforeValue = selector.valueOf();
        const afterValue = result.value.valueOf();
        if (afterValue !== beforeValue) {
          selector = result.value;
          instructions.splice(i, 1);
          const chained = findChainedExtends(
            selector,
            allExtendTuples,
            target,
            extendWith,
            originalSelector
          );
          for (const [chainedTarget, chainedExtendWith, chainedPartial] of chained) {
            const chainedKey = `${chainedPartial ? 1 : 0}|${chainedTarget.valueOf()}|${chainedExtendWith.valueOf()}`;
            if (queuedKeys.has(chainedKey)) {
              continue;
            }
            const matchingInstruction = expandedAllExtends.find(inst =>
              inst.partial === chainedPartial
              && inst.target.valueOf() === chainedTarget.valueOf()
              && inst.extendWith.valueOf() === chainedExtendWith.valueOf()
            );
            if (!matchingInstruction) {
              continue;
            }
            instructions.push(matchingInstruction);
            queuedKeys.add(chainedKey);
          }
          changed = true;
          break;
        }
      }
    }
  }

  return selector;
}

/**
 * Fast-path for applying multiple non-partial extensions of the SAME target in one pass.
 *
 * For a SelectorList target with a SimpleSelector find, this avoids the O(N²) pattern
 * where each sequential tryExtendSelector call scans a growing SelectorList.
 *
 * Returns null if the target is not found (no change), or the new selector if extensions
 * were applied.
 *
 * Falls back to sequential application for complex cases (ComplexSelector find, partial
 * extends, non-SelectorList targets).
 */
function applyBatchedExtend(
  selector: Selector,
  find: Selector,
  extendWithList: Selector[]
): Selector | null {
  // Fast path: non-partial SelectorList with a SimpleSelector find.
  // One scan to find all matching items, then append all extendWiths at once.
  if (isNode(selector, N.SelectorList) && isNode(find, N.SimpleSelector)) {
    const searchResult = findExtendableLocations(selector, find);
    if (!searchResult.hasMatches) {
      return null;
    }

    const originalItems: Selector[] = [];
    const newItems: Selector[] = [];
    let anyWholeMatch = false;

    for (const item of (selector as SelectorList).value) {
      const sItem = item as Selector;
      const itemCompare = selectorCompare(sItem, find);
      if (!itemCompare.hasWholeMatch) {
        originalItems.push(sItem);
        continue;
      }
      anyWholeMatch = true;
      const c = copySelectorForExtend(sItem);
      c.addFlag(F_EXTENDED);
      // Parity with `createMatchedIs` in the non-batched extend path:
      // the original matched item is both `F_EXTENDED` (it stays visible
      // in extended output) AND `F_EXTEND_TARGET` (it *is* the target,
      // distinguishing it from items added by this extend). The filter in
      // `Ruleset.filterExtendedForReferenceCompose` uses this to drop
      // extend-added items from compose parents in reference mode.
      const itemVal = sItem.valueOf();
      const hasNonSelfExtend = extendWithList.some(ew => ew.valueOf() !== itemVal);
      if (hasNonSelfExtend) {
        c.addFlag(F_EXTEND_TARGET);
      }
      originalItems.push(c);
      for (const extendWith of extendWithList) {
        if (extendWith.valueOf() !== itemVal) {
          const ext = copySelectorForExtend(extendWith);
          ext.addFlag(F_EXTENDED);
          newItems.push(ext);
        }
      }
    }

    if (!anyWholeMatch || newItems.length === 0) {
      return null;
    }

    const processed = createProcessedSelector([...originalItems, ...newItems], true);
    if (typeof processed === 'string') {
      return null;
    }
    const processedArray = isArray(processed) ? processed : [processed];
    return SelectorList.create(processedArray).inherit(selector) as Selector;
  }

  // Generic fallback: apply each extendWith sequentially.
  // This still avoids the per-restart-from-zero overhead by not using the while-loop restart.
  let result = selector;
  let anyChanged = false;
  for (const extendWith of extendWithList) {
    const single = tryExtendSelector(result, find, extendWith, false);
    if (!single.error && single.value.valueOf() !== result.valueOf()) {
      result = single.value;
      anyChanged = true;
    }
  }
  return anyChanged ? result : null;
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

function createExtendError(type: ExtendErrorType): ExtendError {
  return new ExtendError(type, type);
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

function copySelectorForExtend(selector: Selector): Selector {
  const copied = copyOwnedWithReusableLeaves(selector);
  if (!isSelectorNode(copied)) {
    throw new TypeError('Expected selector copy');
  }
  return copied;
}

/**
 * Wrap a matched selector/component in an :is() including extendWith.
 * Centralizes:
 * - extracting selectors from extendWith when it's already :is()
 * - validation and error context plumbing
 */
function wrapMatchInIs(
  matched: Selector,
  inheritFrom: Selector,
  extendWith: Selector,
  contextSelector?: Selector,
  context?: { target?: Selector; find?: Selector; extendWith?: Selector },
  extendWithSelectors?: Selector[]
): Selector | ExtendErrorType {
  const computed = extendWithSelectors ?? extractSelectorsFromIs(extendWith);
  // Self-extends on the exact same matched component are visibility-only;
  // avoid generating :is(.x,.x) wrappers and preserve the original shape.
  if (computed.length === 1 && computed[0]!.valueOf() === matched.valueOf()) {
    return copySelectorForExtend(matched);
  }
  const matchedForList = copySelectorForExtend(matched);
  if (context?.find && context.find.valueOf() !== context.extendWith?.valueOf()) {
    matchedForList.addFlag(F_EXTEND_TARGET);
  }
  const extendWithForList = computed.map((item) => {
    const out = copySelectorForExtend(item);
    out.addFlag(F_EXTENDED);
    return out;
  });
  const deduped = deduplicateSelectors([matchedForList, ...extendWithForList]);
  return createValidatedIsWrapperWithErrors(
    deduped,
    inheritFrom,
    contextSelector,
    context
  );
}

/**
 * Processes selectors in a single pass by:
 * 1. Flattening generated :is() wrappers
 * 2. Deduplicating selectors
 * 3. Discarding or flattening ampersands.
 */
export function createProcessedSelector(selectors: Selector | Selector[], root?: boolean): Selector | Selector[] | ExtendErrorType {
  let out: Selector[] = [];
  // Only deduplicate at root level (SelectorList context), not for compound selector components
  // Compound selectors can have duplicate components (e.g., .v.w.v), so we must preserve all
  let selectorValues: Set<string> | null = root ? new Set<string>() : null;
  const push = (selector: Selector) => {
    if (selectorValues) {
      // Root level (SelectorList) - deduplicate
      let value = selector.valueOf();
      if (!selectorValues.has(value)) {
        selectorValues.add(value);
        out.push(selector);
      }
    } else {
      // Non-root (compound components, etc.) - preserve all, no deduplication
      out.push(selector);
    }
  };
  if (!isArray(selectors)) {
    selectors = [selectors];
  } else {
    selectors = [...selectors];
  }
  for (let el of selectors) {
    // Copy-on-write: only copy if we might modify the selector
    // Simple selectors that won't be modified don't need copying
    let needsCopy = isNode(el, N.PseudoSelector) || isNode(el, N.SelectorList)
      || isNode(el, N.CompoundSelector) || isNode(el, N.ComplexSelector) || isNode(el, N.Ampersand);
    if (needsCopy) {
      el = copySelectorForExtend(el);
    }
    if (isNode(el, N.PseudoSelector)) {
      if (el.value.name === ':is') {
        const arg = el.value.arg;
        if (arg && isNode(arg, N.SelectorList)) {
          const deduped = deduplicateSelectors(arg.value);
          if (deduped.length === 1) {
            push(deduped[0]!);
            continue;
          }
        }
      }
      if (root && el.value.name === ':is' && el.generated) {
        let result = createProcessedSelector(expectSelector(el.value.arg));
        if (typeof result === 'string') {
          return result;
        }
        result = expectSelector(result);
        /**
         * Result will be a single selector, which we want to bubble
         * into the parent selector array if we're at the root.
         */
        if (isNode(result, N.SelectorList)) {
          for (let el of result.value) {
            push(el);
          }
        } else {
          push(result);
        }
      } else {
        if (el.value.arg) {
          let result = createProcessedSelector(expectSelector(el.value.arg), root);
          if (typeof result === 'string') {
            return result;
          }
          // If result is a SelectorList, check if it contains generated :is() wrappers to flatten
          if (isArray(result)) {
            // Flatten any generated :is() wrappers in the result
            const flattened: Selector[] = [];
            for (const sel of result) {
              if (isNode(sel, N.PseudoSelector) && sel.value.name === ':is' && sel.generated) {
                // Unwrap generated :is() - extract its argument selectors
                const arg = sel.value.arg;
                if (arg && isNode(arg, N.SelectorList)) {
                  flattened.push(...arg.value);
                } else if (arg) {
                  flattened.push(expectSelector(arg));
                }
              } else {
                flattened.push(sel);
              }
            }
            el.value.arg = SelectorList.create(flattened);
          } else {
            // Single selector result - check if it's a generated :is() to unwrap
            if (isNode(result, N.PseudoSelector) && result.value.name === ':is' && result.generated) {
              // Unwrap - use the argument directly
              el.value.arg = expectSelector(result.value.arg);
            } else {
              el.value.arg = result;
            }
          }
        }
        push(el);
      }
    } else if (isNode(el, N.SelectorList)) {
      let processedResult = createProcessedSelector(el.value, true);
      if (typeof processedResult === 'string') {
        return processedResult;
      }
      let processed = expectSelectorArray(processedResult);
      // Flatten any generated :is() wrappers in the SelectorList
      const flattened: Selector[] = [];
      for (const sel of processed) {
        if (isNode(sel, N.PseudoSelector) && sel.value.name === ':is' && sel.generated) {
          // Unwrap generated :is() - extract its argument selectors
          const arg = sel.value.arg;
          if (arg && isNode(arg, N.SelectorList)) {
            flattened.push(...arg.value);
          } else if (arg) {
            flattened.push(expectSelector(arg));
          }
        } else {
          flattened.push(sel);
        }
      }
      // Preserve document order when merging multiple :is() from different extends (e.g. :is(.clearfix,.foo):after + :is(.clearfix,.bar):after → :is(.clearfix,.foo,.bar):after). Only sort when at least two items have document order so we don't reorder single :is() unwraps (e.g. .replace, .c).
      if (extendOrderMap && flattened.length >= 2 && extendOrderByValueOf) {
        const orderMap = extendOrderMap;
        const orderByValue = extendOrderByValueOf;
        const NO_ORDER = 999999;
        const orderFor = (s: Selector): number => {
          const fromMap = orderMap.get(s);
          if (fromMap !== undefined) {
            return fromMap;
          }
          const key = String(typeof s.valueOf === 'function' ? s.valueOf() : '').trim();
          let order = orderByValue.get(key);
          if (order === undefined && key) {
            const lastPart = key.split(/\s+/).pop();
            if (lastPart) {
              order = orderByValue.get(lastPart);
            }
          }
          return order ?? NO_ORDER;
        };
        // Pre-compute order keys once — calling orderFor inside the comparator causes
        // repeated valueOf()/split() on every comparison step (O(N log N) × valueOf cost).
        const withKeys = flattened.map(s => ({ s, o: orderFor(s) }));
        const hasOrder = withKeys.filter(x => x.o !== NO_ORDER);
        if (hasOrder.length >= 2) {
          withKeys.sort((a, b) => {
            if (a.o === NO_ORDER && b.o === NO_ORDER) {
              return 0;
            }
            if (a.o === NO_ORDER) {
              return -1;
            }
            if (b.o === NO_ORDER) {
              return 1;
            }
            return a.o - b.o;
          });
          flattened.length = 0;
          for (const x of withKeys) {
            flattened.push(x.s);
          }
        }
      }
      // @ts-expect-error direct mutation: in-place selector reshape in the
      // non-eval `createProcessedSelector` helper (extend pipeline). No
      // No legacy fork state to preserve here anymore.
      el.value = flattened;
      push(el);
    } else if (isNode(el, N.CompoundSelector)) {
      // CRITICAL: Compound selectors can have duplicate components (e.g., .v.w.v)
      // Process components with root=false to prevent deduplication
      const compoundProcessed = createProcessedSelector(el.value, false);
      if (typeof compoundProcessed === 'string') {
        return compoundProcessed;
      }
      // @ts-expect-error direct mutation: see extend short-term exception above
      el.value = expectSelectorArray(compoundProcessed);
      push(el);
    } else if (isNode(el, N.ComplexSelector)) {
      let components = el.value;
      let complexProcessed = createProcessedSelector(components);
      if (typeof complexProcessed === 'string') {
        return complexProcessed;
      }
      let result = expectComplexComponents(complexProcessed);
      // @ts-expect-error direct mutation: see extend short-term exception above
      el.value = result;
      let [first, second] = components;
      /** Remove invisibility on combinator if it's a generated */
      if (first?.type === 'Ampersand') {
        /** Implicit ampersand was kept for nested output (don't resolve to parent selector here). */
        if (first.hasFlag(F_IMPLICIT_AMPERSAND) && result[0] === first) {
          // @ts-expect-error direct mutation: see extend short-term exception above
          el.value = result;
          // Fall through; no throw, no slice
        } else if (isNode(result[0], N.Selector)) {
          if (first.generated) {
            result[1]!.removeFlag(F_VISIBLE);
          }
        } else if (first.generated) {
          /** Silent removal if generated and no selector was resolved */
          if (second?.type === 'Combinator' && second.generated) {
            // @ts-expect-error direct mutation: see extend short-term exception above
            el.value = result.slice(2);
          } else {
            // @ts-expect-error direct mutation: see extend short-term exception above
            el.value = result.slice(1);
          }
        } else {
          return ExtendErrorType.AMPERSAND_BOUNDARY;
        }
      }

      // If a generated :is() ends up as the sole selector after a combinator in a complex selector,
      // distribute it into a selector list. This avoids emitting `:is(...)` where a plain selector
      // list is equivalent (and matches Less output expectations).
      //
      // Example:
      //   .attributes :is([data="test"], .attributes .attribute-test)
      // becomes:
      //   .attributes [data="test"], .attributes .attribute-test
      if (result.length >= 3) {
        const maybeCombinator = result[result.length - 2];
        const maybeIs = result[result.length - 1];
        if (isNode(maybeCombinator, N.Combinator)
          && isNode(maybeIs, N.PseudoSelector)
          && maybeIs.value.name === ':is'
          && maybeIs.value.arg
        ) {
          // Only safe to flatten here when the combinator is the implicit (invisible) space
          // from implicit `& ` nesting. In that case:
          //   & :is(.a, .b)  ===  & .a, & .b
          // and if `&` is also implicit/invisible, it further collapses naturally.
          const prefix = result.slice(0, -2);
          const first = prefix[0];
          const originalFirst = components[0];
          const originalSecond = components[1];
          const canFlattenViaImplicitNesting =
            // Either the processed prefix still begins with an ampersand...
            (!!first
              && isNode(first, N.Ampersand)
              && (first.hasFlag(F_IMPLICIT_AMPERSAND) || first.generated)
              && !first.hasFlag(F_VISIBLE)
              && !maybeCombinator.hasFlag(F_VISIBLE))
            // ...or the prefix is a generated `:is(...)` wrapper that came from implicit nesting
            // materialization (e.g. when the parent selector is itself a selector list).
            || (!!first
              && isNode(first, N.PseudoSelector)
              && first.value.name === ':is'
              && first.generated === true
              && !maybeCombinator.hasFlag(F_VISIBLE))
            // ...or we already resolved the invisible ampersand to a concrete selector in `result`,
            // but the original components indicate this came from implicit `& ` nesting.
            || (!!originalFirst
              && isNode(originalFirst, N.Ampersand)
              && (originalFirst.hasFlag(F_IMPLICIT_AMPERSAND) || originalFirst.generated)
              && !originalFirst.hasFlag(F_VISIBLE)
              && !!originalSecond
              && isNode(originalSecond, N.Combinator)
              && !originalSecond.hasFlag(F_VISIBLE));

          // Only flatten when we know this is the implicit `& ` nesting case.
          // Do NOT flatten other combinators (e.g. `.ext6 > :is(...)`) — Less expects
          // those to remain as :is() wrappers.
          if (!canFlattenViaImplicitNesting) {
            push(el);
            continue;
          }

          const argSel = maybeIs.value.arg;
          const argList: Selector[] = isNode(argSel, N.SelectorList) ? argSel.value : [expectSelector(argSel)];
          // If this came from implicit `& ` nesting (both ampersand and the space are invisible),
          // then the prefix is already represented by the parent ruleset context and must not be
          // duplicated in nested output. In that case we drop the prefix entirely.
          const dropImplicitPrefix =
            !!originalFirst
            && isNode(originalFirst, N.Ampersand)
            && (originalFirst.hasFlag(F_IMPLICIT_AMPERSAND) || originalFirst.generated)
            && !originalFirst.hasFlag(F_VISIBLE)
            && !!originalSecond
            && isNode(originalSecond, N.Combinator)
            && !originalSecond.hasFlag(F_VISIBLE);
          const dropImplicitPrefixViaGeneratedIs =
            !!first
            && isNode(first, N.PseudoSelector)
            && first.value.name === ':is'
            && first.generated === true
            && !maybeCombinator.hasFlag(F_VISIBLE);
          const outputPrefix = (dropImplicitPrefix || dropImplicitPrefixViaGeneratedIs) ? [] : prefix;

          // Visible vs invisible ampersand (with partial extends producing :is()):
          // - Visible authored `&`: keep one ampersand in front of the whole list.
          // - Invisible (implicit) `&`: copy invisible ampersand + combinator onto each selector list
          //   item so valueOf() is correct for extend matching (e.g. ".bb .bb", ".aa .dd").
          const retainInvisibleAmpersandAndCombinator = dropImplicitPrefix && outputPrefix.length === 0 && !maybeCombinator.hasFlag(F_VISIBLE);
          const isIndexInResult = result.length - 1;
          const suffixAfterIs = retainInvisibleAmpersandAndCombinator
            ? copyComplexComponentsForPlacement(components.slice(isIndexInResult + 1))
            : [];

          for (const inner of argList) {
            let innerSel = inner;
            // If the inner selector redundantly starts with the same prefix selector we already have,
            // strip that duplicated prefix so we don't emit `.attributes .attributes ...`.
            if (prefix.length >= 1 && isNode(innerSel, N.ComplexSelector)) {
              const innerParts = innerSel.value;
              const innerFirst = innerParts[0];
              // Compare against the *resolved* prefix selector (result[0]) when present.
              const resolvedPrefixFirst = result[0];
              const prefixFirstValue = resolvedPrefixFirst?.valueOf?.();
              if (innerFirst && prefixFirstValue && innerFirst.valueOf() === prefixFirstValue) {
                // Drop the matching first selector and an optional following combinator.
                const dropCount = innerParts[1]?.type === 'Combinator' ? 2 : 1;
                innerSel = ComplexSelector.create(innerParts.slice(dropCount)).inherit(innerSel);
              }
            }
            const omitCombinator = outputPrefix.length === 0 && !maybeCombinator.hasFlag(F_VISIBLE);
            if (retainInvisibleAmpersandAndCombinator) {
              // Copy invisible ampersand + combinator onto each item so selector list items have
              // correct valueOf() for extend (e.g. .bb .bb, .aa .dd). Preserve selectorContainer when present so & stays live.
              if (!isNode(originalFirst, N.Ampersand)) {
                throw new TypeError('Expected implicit ampersand source');
              }
              const origAmp = originalFirst;
              const resolved = origAmp.getResolvedSelector();
              const parentSel = resolved ?? undefined;
              let amp = origAmp.derive();
              if (!origAmp.getStoredSelector() && isSelectorNode(parentSel)) {
                amp = Ampersand.create({ selectorContainer: { selector: copySelectorForExtend(parentSel) } });
              }
              amp.addFlag(F_IMPLICIT_AMPERSAND);
              amp.removeFlag(F_VISIBLE);
              const combCopy = copyComplexComponentForPlacement(maybeCombinator);
              combCopy.removeFlag(F_VISIBLE);
              const parts: ComplexSelectorComponent[] = [amp, combCopy, copySelectorForExtend(innerSel), ...suffixAfterIs];
              const next = ComplexSelector.create(parts).inherit(el);
              push(next);
            } else if (outputPrefix.length === 0 && omitCombinator) {
              // Prefix/combinator dropped but not implicit (e.g. first was :is()): emit inner as-is.
              push(copySelectorForExtend(innerSel).inherit(el));
            } else {
              const parts: ComplexSelectorComponent[] = [
                ...outputPrefix,
                copyComplexComponentForPlacement(maybeCombinator),
                copySelectorForExtend(innerSel)
              ];
              const next = ComplexSelector.create(parts).inherit(el);
              push(next);
            }
          }
          continue;
        }
      }

      push(el);
    } else if (isNode(el, N.Ampersand)) {
      // Keep implicit ampersands as-is so nested output can omit the prefix (.dd not .aa .dd).
      // Resolving & to the parent selector here would make the prefix visible; that should only
      // happen when we hoist (e.g. in maybeHoistMixedNestingSelectorList).
      if (el.hasFlag(F_IMPLICIT_AMPERSAND)) {
        push(el);
      } else if (el.generated) {
        const sel = el.getResolvedSelector();
        if (sel && !isNode(sel, N.Nil)) {
          const ampProcessed = createProcessedSelector(expectSelector(sel));
          if (typeof ampProcessed === 'string') {
            return ampProcessed;
          }
          push(expectSelector(ampProcessed));
        } else {
          push(el);
        }
      } else {
        push(el);
      }
    } else {
      push(el);
    }
  }
  const result = out.length === 1 ? out[0]! : out;
  return result;
}
/**
 * Extracts selectors from a :is() pseudo-selector, returning the argument selectors.
 * If the selector is not a :is() selector, returns it as a single-item array.
 *
 * @param selector - The selector to extract from (may be :is() or any other selector)
 * @returns Array of selectors extracted from :is() argument, or [selector] if not :is()
 */
function extractSelectorsFromIs(selector: Selector): Selector[] {
  if (isNode(selector, N.PseudoSelector) && selector.value.name === ':is') {
    const arg = selector.value.arg;
    if (arg && isNode(arg, N.SelectorList)) {
      // Extract all selectors from the :is() argument
      return arg.value;
    } else if (arg) {
      // Single selector argument
      return [expectSelector(arg)];
    }
  }
  // Not a :is() selector, return as-is
  return [selector];
}

function copySelectorsForPlacement(selectors: Selector[]): Selector[] {
  return selectors.map(selector => copySelectorForExtend(selector));
}

function copySimpleSelectorsForPlacement(nodes: SimpleSelector[]): SimpleSelector[] {
  return nodes.map((node) => {
    const copied = copyOwnedWithReusableLeaves(node);
    if (!isNode(copied, N.SimpleSelector)) {
      throw new TypeError('Expected simple selector copy');
    }
    return copied;
  });
}

function copyComplexComponentForPlacement(node: ComplexSelectorComponent): ComplexSelectorComponent {
  const copied = copyOwnedWithReusableLeaves(node);
  if (!isComplexComponent(copied)) {
    throw new TypeError('Expected complex selector component copy');
  }
  return copied;
}

function copyComplexComponentsForPlacement(nodes: ComplexSelectorComponent[]): ComplexSelectorComponent[] {
  return nodes.map(copyComplexComponentForPlacement);
}

/**
 * Helper function to create a SelectorList from an array of selectors,
 * with deduplication and flattening of generated :is() wrappers applied.
 * This is the standard pattern used throughout extend operations.
 *
 * If any selector in the array is a :is() selector, its argument selectors are extracted
 * instead of nesting the :is() wrapper.
 *
 * @param selectors - Array of selectors to process
 * @param inheritFrom - Optional selector to inherit from
 * @returns A new SelectorList with deduplicated and flattened selectors
 */
function createExtendedSelectorList(selectors: Selector[], inheritFrom?: Selector): SelectorList | ExtendErrorType {
  // Extract selectors from any :is() wrappers in the array
  const extractedSelectors: Selector[] = [];
  for (const selector of selectors) {
    extractedSelectors.push(...extractSelectorsFromIs(selector));
  }

  if (extendOrderMap && extractedSelectors.length > 1) {
    const orderMap = extendOrderMap;
    const orderByValue = extendOrderByValueOf;
    // Preserve ruleset-owner-first: when inheritFrom is the ruleset's selector (single-selector full match),
    // keep it first so we get [.e, .d], [.z, .x, .y] etc. Otherwise extendOrderMap would sort all selectors
    // by extend index and put .d before .e (wrong), because .e is also an extend source elsewhere.
    const inheritVal = inheritFrom && typeof inheritFrom.valueOf === 'function' ? inheritFrom.valueOf() : undefined;
    const ownerFirst =
      inheritVal !== undefined
      && extractedSelectors.some(s => (s.valueOf?.() ?? '') === inheritVal);
    if (ownerFirst && inheritVal !== undefined) {
      const first = extractedSelectors.find(s => (s.valueOf?.() ?? '') === inheritVal)!;
      const rest = extractedSelectors.filter(s => (s.valueOf?.() ?? '') !== inheritVal);
      // Wrap/append case: only preserve input order when we're truly appending one selector.
      // When rest has 2+ items we must sort by document order (e.g. [.clearfix, .bar, .foo] → [.clearfix, .foo, .bar]).
      const isAppendOne =
        rest.length === 1
        && selectors.length >= 2
        && (() => {
          const lastInput = selectors[selectors.length - 1];
          const fromLast = extractSelectorsFromIs(lastInput!);
          return fromLast.length === 1 && fromLast[0] === rest[rest.length - 1];
        })();
      let restSorted: Selector[];
      if (isAppendOne) {
        restSorted = rest;
      } else {
        const orderFor = (s: Selector): number => {
          const fromMap = orderMap.get(s);
          if (fromMap !== undefined) {
            return fromMap;
          }
          const key = String(typeof s.valueOf === 'function' ? s.valueOf() : '').trim();
          let order = orderByValue?.get(key);
          if (order === undefined && key && orderByValue) {
            const lastPart = key.split(/\s+/).pop();
            if (lastPart) {
              order = orderByValue.get(lastPart);
            }
          }
          return order ?? 999999;
        };
        const NO_ORDER = 999999;
        const mapped = rest.map((s, i) => ({ selector: s, order: orderFor(s), origIndex: i }));
        restSorted = mapped
          .sort((a, b) => {
            if (a.order === NO_ORDER && b.order === NO_ORDER) {
              return a.origIndex - b.origIndex;
            }
            if (a.order === NO_ORDER) {
              return -1;
            }
            if (b.order === NO_ORDER) {
              return 1;
            }
            return a.order - b.order || a.origIndex - b.origIndex;
          })
          .map(x => x.selector);
      }
      extractedSelectors.length = 0;
      extractedSelectors.push(first, ...restSorted);
    } else {
      // Only preserve input order when we're truly appending one selector (original + one new).
      // When we have 3+ items we must sort by document order (e.g. [.clearfix, .bar, .foo] → [.clearfix, .foo, .bar]).
      const isAppendOneElse =
        extractedSelectors.length === 2
        && selectors.length >= 2
        && (() => {
          const lastInput = selectors[selectors.length - 1];
          const fromLast = extractSelectorsFromIs(lastInput!);
          return fromLast.length === 1 && fromLast[0] === extractedSelectors[extractedSelectors.length - 1];
        })();
      if (isAppendOneElse) {
        // Preserve input order (already doc order from wrap path)
      } else {
        const withOrder: Array<{ selector: Selector; order: number }> = [];
        const withoutOrder: Selector[] = [];
        const orderForElse = (selector: Selector): number | undefined => {
          const fromWeak = orderMap.get(selector);
          if (fromWeak !== undefined) {
            return fromWeak;
          }
          const key = String(typeof selector.valueOf === 'function' ? selector.valueOf() : '').trim();
          let order = orderByValue?.get(key);
          if (order === undefined && key && orderByValue) {
            const lastPart = key.split(/\s+/).pop();
            if (lastPart) {
              order = orderByValue.get(lastPart);
            }
          }
          return order;
        };
        for (const selector of extractedSelectors) {
          const order = orderForElse(selector);
          if (order !== undefined) {
            withOrder.push({ selector, order });
          } else {
            withoutOrder.push(selector);
          }
        }
        withOrder.sort((a, b) => a.order - b.order);
        extractedSelectors.length = 0;
        extractedSelectors.push(...withoutOrder, ...withOrder.map(item => item.selector));
      }
    }
  }
  // createProcessedSelector may return a single selector if only one item, so ensure it's an array
  const processed = createProcessedSelector(extractedSelectors, true);
  if (typeof processed === 'string') {
    return processed;
  }
  const processedArray = isArray(processed) ? processed : [processed];
  // Always place owned selector copies in the new list. If `inheritFrom` is
  // also one of the input selectors, adopting the source object would reparent
  // it before `.inherit(inheritFrom)` reads the parent chain.
  const placedArray = copySelectorsForPlacement(processedArray);

  const result = SelectorList.create(placedArray);
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
): Selector | ExtendErrorType | null {
  if (find.value.length <= 1) {
    return null;
  }

  // Look for :is() components in the target
  for (let i = 0; i < target.value.length; i++) {
    const comp = target.value[i];
    if (!isNode(comp, N.PseudoSelector) || comp.value.name !== ':is') {
      continue;
    }

    const arg = comp.value.arg;
    if (!isNode(arg, N.SelectorList)) {
      continue;
    }

    // Check if the first part of find matches inside the :is() and the rest matches after
    const firstPart = find.value[0];
    const restParts = find.value.slice(1);

    if (!firstPart || restParts.length === 0 || i + 1 >= target.value.length) {
      continue;
    }

    const firstPartComparison = selectorCompare(arg, firstPart);
    const firstPartMatches = firstPartComparison.hasWholeMatch || firstPartComparison.hasPartialMatch;
    if (!firstPartMatches) {
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
    const targetAfter = isNode(afterIsCompound, N.CompoundSelector) ? afterIsCompound : afterIs[0]!;
    const restComparison = selectorCompare(targetAfter, restCompound);
    restMatches = restComparison.hasWholeMatch || restComparison.hasPartialMatch;

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
      const firstPartIsSimple = !isNode(firstPart, N.CompoundSelector) && !isNode(firstPart, N.ComplexSelector);

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
): SelectorList | ExtendErrorType {
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

// Removed unused functions: getIsSelectorArg, extendWithinIsArg
// These were only used by handleCompoundFullExtend which is also unused

// Removed unused functions: flattenGeneratedIs, flattenGeneratedIsInSelector
// All :is() flattening is now handled in createProcessedSelector in a single pass.
// This eliminates redundant traversals and consolidates all final processing.

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
    const result = extendSelector(target, find, extendWith, partial, skipAmpersandCheck, false);
    if (typeof result === 'string') {
      return { value: target, error: createExtendError(result) };
    }
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
 * @param hasMoreAfterIs - Internal
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
): Selector | ExtendErrorType {
  if (partial && find.valueOf() === extendWith.valueOf()) {
    return target;
  }

  const canFastReject = !!find.keySetLibrary && find.keySetLibrary === target.keySetLibrary;

  // Guaranteed-false: if the required bits for `find` are not present in `target`,
  // the find selector can never match within the target. SelectorList OR-paths are
  // encoded as an empty/smaller requiredKeySet, so this stays a pure data-type swap.
  if (!partial && canFastReject) {
    if (!isSubsetOf(find.requiredKeySet, target.keySet)) {
      return 'NOT_FOUND';
    }
  } else if (partial && canFastReject) {
    // For partial extends, find's keys must have at least some overlap with target's keys
    if (isDisjoint(find.keySet, target.keySet)) {
      return 'NOT_FOUND';
    }
  }

  // Walk-and-consume fast path for simple cases (Phase 1).
  // Only for SimpleSelector find with no ampersands and no extra flags.
  // Also skip when extendWith contains element/ID selectors that need conflict validation.
  if (!skipAmpersandCheck && !hasMoreAfterIs
    && canUseWalkAndConsumeForExtend(target, find)
    && !(partial && extendWithNeedsConflictValidation(extendWith))) {
    const walkResult = walkAndExtendForExtendSelector(target, find, extendWith, partial);
    if (walkResult !== null) {
      return walkResult;
    }
    // Walk path returned null → fall through to legacy path
  }

  // Use the unified ExtendLocation API for all selector matching.
  //
  // IMPORTANT: normalize :is(...) equivalences for matching. In Less output we often materialize
  // parent selector alternatives via `:is(...)`, and exact extends must match any single branch.
  const originalTarget = target;
  const originalFind = find;
  let searchResult = findExtendableLocations(target, find);
  if (!searchResult.hasMatches) {
    const normalizedTarget = normalizeSelectorForExtend(target);
    const normalizedFind = normalizeSelectorForExtend(find);
    if (normalizedTarget.valueOf() !== target.valueOf() || normalizedFind.valueOf() !== find.valueOf()) {
      const normalizedSearch = findExtendableLocations(normalizedTarget, normalizedFind);
      if (normalizedSearch.hasMatches) {
        target = normalizedTarget;
        find = normalizedFind;
        searchResult = normalizedSearch;
      }
    }
  }
  const comparison = selectorCompare(target, find, searchResult);
  if (!searchResult.hasMatches) {
    return 'NOT_FOUND';
  }

  // Check for ampersand boundary: "target only matches when ampersand is resolved" = match only
  // within ampersand. One state: do not extend here; parent selector should carry the extend.
  if (!skipAmpersandCheck) {
    const ampersandCrossingInfo = checkAmpersandCrossingDuringExtension(originalTarget, originalFind);
    if (ampersandCrossingInfo.crossed) {
      const shouldSkipResolvedOnlySimpleBoundary = Boolean(
        !partial
        && ampersandCrossingInfo.reason === 'resolved-only'
        && isNode(originalFind, N.SimpleSelector)
      );
      if (shouldSkipResolvedOnlySimpleBoundary) {
        // Keep exact simple-selector extends on nested rules in normal flow.
        // Forcing amp-boundary hoisting here flattens authored nesting unexpectedly.
      } else {
        const hasWholeSelectorLocation = searchResult.locations.some((loc: any) =>
          !loc?.isPartialMatch
          && Array.isArray(loc?.path)
          && loc.path.length === 0
        );
        // If a partial extend only matches through a resolved ampersand boundary (no whole-selector hit),
        // the current selector should not consume it; parent-level selector processing handles it.
        if (partial && !hasWholeSelectorLocation) {
          return 'NOT_FOUND';
        }
        return handleAmpersandBoundaryCrossing(
          originalTarget,
          originalFind,
          extendWith,
          ampersandCrossingInfo.ampersandNode!,
          searchResult
        );
      }
    }
  }

  // Special handling for SelectorList targets - extend each matching selector in the list
  if (isNode(target, N.SelectorList)) {
    return extendSelectorList(target, find, extendWith, partial, skipAmpersandCheck);
  }

  // Select the best location from search results
  const locationOrError = selectBestLocation(searchResult, comparison, target, find, partial, hasMoreAfterIs, extendWith);
  if (typeof locationOrError === 'string') {
    return locationOrError;
  }
  const location = locationOrError;
  // If the match is entirely inside an ampersand node (e.g. `&:before` matching `.header .header-nav`),
  // do NOT extend here. The parent selector/ruleset should carry the extension.
  if (
    isNode(location.matchedNode, N.Ampersand)
    && location.parentNode
    && isNode(location.parentNode, N.CompoundSelector)
    && location.parentNode.value.length > 1
  ) {
    return 'NOT_FOUND';
  }
  // Also handle the case where the matcher reports a partial match at the compound level:
  // `&:before` is a compound; matching `.header .header-nav` against it should be treated as
  // "within ampersand" rather than rewriting into a descendant combinator form.
  if (
    location.isPartialMatch
    && isNode(location.matchedNode, N.CompoundSelector)
    && location.matchedNode.value.length > 1
    && isNode(location.matchedNode.value[0], N.Ampersand)
  ) {
    const firstResolved = (location.matchedNode.value[0] as Ampersand).getResolvedSelector();
    if (firstResolved && firstResolved.valueOf() === find.valueOf()) {
      return 'NOT_FOUND';
    }
  }

  // If we matched an ampersand *component* within a larger compound selector (e.g. `&:before`),
  // do NOT extend that ampersand. The parent selector should have already been extended/hoisted.
  if (
    isNode(target, N.CompoundSelector)
    && target.value.length > 1
    && location.path.length === 1
    && typeof location.path[0] === 'number'
  ) {
    const idx = location.path[0];
    const component = target.value[idx];
    if (component && isNode(component, N.Ampersand) && (component as Ampersand).getResolvedSelector()) {
      return 'NOT_FOUND';
    }
  }

  // Handle partial vs full matching modes
  if (partial) {
    // PARTIAL MATCHING MODE: Create :is() wrappers for component-level matches

    // If it's a root-level match in partial mode, handle remainders
    if (location.path.length === 0) {
      // When find is a (contiguous or non-contiguous) subset of the compound, wrap matched part as :is(matched, extendWith).rest
      if (location.contiguousCompoundRange || (location.compoundMatchIndices?.length ?? 0) > 0) {
        return applyExtensionAtLocation(target, location, extendWith);
      }
      // §3a spans combinator: wrap the full matched segment as :is(segment, extendWith), keep before components
      if (location.complexMatchRange && isNode(target, N.ComplexSelector)) {
        const [start, end] = location.complexMatchRange;
        const segmentComponents = target.value.slice(start, end);
        const matchedSegment = segmentComponents.length === 1
          ? expectSelector(segmentComponents[0])
          : ComplexSelector.create(segmentComponents).inherit(target);
        const wrapped = createValidatedIsWrapperWithErrors(
          [matchedSegment, extendWith],
          matchedSegment,
          undefined,
          undefined
        );
        if (typeof wrapped === 'string') {
          return wrapped;
        }
        const before = target.value.slice(0, start);
        const newComponents: ComplexSelectorComponent[] = [...before, wrapped, ...target.value.slice(end)];
        return ComplexSelector.create(newComponents).inherit(target);
      }
      // Check if we have remainders that need to be combined with the extension
      if (location.isPartialMatch && location.remainders && location.remainders.length > 0) {
        const remainder = location.remainders[0]!;

        // Combine remainder with extension
        let combinedExtension: Selector;

        if (isNode(remainder, N.ComplexSelector) && remainder.value.length > 0) {
          // Remainder is complex selector - append extension
          const newComponents: ComplexSelectorComponent[] = [...remainder.value, extendWith];
          combinedExtension = ComplexSelector.create(newComponents).inherit(remainder);
        } else {
          // Simple remainder - create compound or complex as needed
          if (isNode(extendWith, N.ComplexSelector)) {
            const newComponents: ComplexSelectorComponent[] = [remainder, ...extendWith.value];
            combinedExtension = ComplexSelector.create(newComponents).inherit(extendWith);
          } else {
            const compResult = createValidatedCompoundSelectorWithErrors([remainder, extendWith], remainder, { target, find, extendWith });
            if (typeof compResult === 'string') {
              return compResult;
            }
            combinedExtension = compResult;
          }
        }

        const listResult = createExtendedSelectorList([target, combinedExtension], target);
        if (typeof listResult === 'string') {
          return listResult;
        }
        return listResult;
      }

      // Partial match that SPANS a combinator: per EXTEND_RULES.md §3a we should wrap the FULL segment
      // (first matched compound through last, including all in between). E.g. .a.b > .x in div + .a.c.b > .y.x
      // → div + :is(.a.c.b > .y.x, .q). The block below may implement a related case (remainder + extendWith as new list item).
      if (location.isPartialMatch && isNode(target, N.ComplexSelector) && isNode(find, N.ComplexSelector)) {
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

            if (sComp && tComp && !isNode(sComp, N.Combinator) && !isNode(tComp, N.Combinator)) {
              // Check if find component partially matches selector component
              if (isNode(sComp, N.CompoundSelector) && isNode(tComp, N.SimpleSelector)) {
                const matchingElement = sComp.value.find(el => el.valueOf() === tComp.valueOf());
                if (matchingElement) {
                  // Found partial match - extract remainder
                  const remainderElements = sComp.value.filter(el => el.valueOf() !== tComp.valueOf());
                  if (remainderElements.length > 0) {
                    if (remainderElements.length === 1) {
                      compoundRemainder = remainderElements[0]!;
                    } else {
                      const remResult = createValidatedCompoundSelectorWithErrors(remainderElements, sComp, { target, find, extendWith });
                      if (typeof remResult === 'string') {
                        return remResult;
                      }
                      compoundRemainder = expectSelector(remResult);
                    }
                    foundCompoundRemainder = true;
                  }
                }
              }
            }
          }

          if (foundCompoundRemainder && compoundRemainder) {
            // Create combined extension with remainder
            const combinedExtension = createValidatedCompoundSelectorWithErrors([compoundRemainder, extendWith], compoundRemainder, { target, find, extendWith });
            if (typeof combinedExtension === 'string') {
              return combinedExtension;
            }
            const listResult2 = createExtendedSelectorList([target, combinedExtension], target);
            if (typeof listResult2 === 'string') {
              return listResult2;
            }
            return listResult2;
          }
        }
      }

      const rootFallback = createExtendedSelectorList([target, extendWith], target);
      if (typeof rootFallback === 'string') {
        return rootFallback;
      }
      return rootFallback;
    }

    // For deeper matches in partial mode, we need to analyze the context
    // If we're matching within a compound selector, create :is() wrapper
    if (location.path.length > 0) {
      // When partial: true, we may have multiple matching locations (e.g., .foo.foo has two .foo matches)
      // Process all matching locations, not just the first one

      // Handle multiple component matches in compound selectors (e.g., .foo.foo)
      if (isNode(target, N.CompoundSelector) && searchResult.locations.length > 1) {
        // Filter to only component-level matches (path length 1 with numeric index)
        const componentMatches = searchResult.locations.filter(loc =>
          loc.path.length === 1
          && typeof loc.path[0] === 'number'
        );

        if (componentMatches.length > 1) {
          // Process all component matches - wrap each matching component in :is()
          const newComponents = [...target.value];
          const extendWithSelectors = extractSelectorsFromIs(extendWith);
          for (const matchLoc of componentMatches) {
            const [componentIndex] = matchLoc.path;
            if (typeof componentIndex !== 'number') {
              continue;
            }
            const matchedComponent = newComponents[componentIndex];
            if (matchedComponent) {
              const wrapped = wrapMatchInIs(
                matchedComponent,
                matchedComponent,
                extendWith,
                target,
                { target, find, extendWith },
                extendWithSelectors
              );
              if (typeof wrapped === 'string') {
                return wrapped;
              }
              newComponents[componentIndex] = wrapped;
            }
          }
          return createValidatedCompoundSelectorWithErrors(newComponents, target);
        }
      }

      // Handle multiple component matches in complex selectors
      if (isNode(target, N.ComplexSelector) && searchResult.locations.length > 1) {
        // Only treat *component* matches as "multiple matches".
        // NOTE: locations inside pseudo-selector args (paths including 'arg') can include both:
        // - a direct match path like [i, 'arg', altIndex]
        // - an "append opportunity" path like [i, 'arg']
        // Those should NOT trigger the "multiple component matches" logic here.

        const componentMatches = searchResult.locations.filter((loc: ExtendLocation) => {
          if (loc.path.length !== 1 || typeof loc.path[0] !== 'number') {
            return false;
          }
          const component = target.value[loc.path[0]];
          return !!component && !isNode(component, N.Combinator);
        });

        const compoundInnerMatches = searchResult.locations.filter((loc: ExtendLocation) => {
          if (loc.path.length !== 2 || typeof loc.path[0] !== 'number' || typeof loc.path[1] !== 'number') {
            return false;
          }
          const component = target.value[loc.path[0]];
          return !!component && isNode(component, N.CompoundSelector);
        });

        // Matches inside pseudo-selector arguments (e.g., :is(...)) won't show up as
        // component/compoundInner matches above. In Less `all` mode we still need to
        // extend occurrences inside the arg (including duplicates like `.replace.replace`).
        const argMatches = searchResult.locations.filter((loc: ExtendLocation) => {
          if (!loc.path.includes('arg')) {
            return false;
          }
          // Ignore "append opportunity" locations which end in 'arg' (no concrete match),
          // and keep only actual matches within the argument.
          return typeof loc.path[loc.path.length - 1] === 'number';
        });

        const complexMatches = [...componentMatches, ...compoundInnerMatches];

        if (complexMatches.length > 1 || argMatches.length > 0) {
          const newComponents = [...target.value];
          const extendWithSelectors = extractSelectorsFromIs(extendWith);

          // Apply arg extensions per pseudo component (once per component index)
          if (argMatches.length > 0) {
            const indices = new Set<number>();
            for (const loc of argMatches) {
              const argIndex = loc.path.indexOf('arg');
              const componentIndex = argIndex > 0 ? loc.path[argIndex - 1] : undefined;
              if (typeof componentIndex === 'number') {
                indices.add(componentIndex);
              }
            }
            for (const idx of indices) {
              const component = newComponents[idx];
              if (!component || !isNode(component, N.PseudoSelector)) {
                continue;
              }
              const arg = component.value.arg as unknown;
              if (!isSelectorNode(arg)) {
                continue;
              }
              // Extend the arg selector itself; this reuses existing SelectorList/Compound logic
              // (including "wrap all occurrences" for `.replace.replace`).
              const extendedArg = isNode(arg, N.SelectorList)
                ? extendSelectorList(arg, find, extendWith, true, true, false)
                : extendSelector(arg, find, extendWith, true, true, false);
              if (typeof extendedArg === 'string') {
                return extendedArg;
              }
              if (component.generated) {
                component.value.arg = extendedArg;
              } else {
                newComponents[idx] = PseudoSelector.create({
                  name: component.value.name,
                  arg: extendedArg
                }).inherit(component);
              }
            }
          }

          for (const matchLoc of complexMatches) {
            const [componentIndex] = matchLoc.path;
            if (typeof componentIndex !== 'number') {
              continue;
            }
            const component = newComponents[componentIndex];
            if (!component || isNode(component, N.Combinator)) {
              continue;
            }

            // Match is the entire complex component
            if (matchLoc.path.length === 1) {
              const wrappedComp = wrapMatchInIs(
                component,
                component,
                extendWith,
                target,
                { target, find, extendWith },
                extendWithSelectors
              );
              if (typeof wrappedComp === 'string') {
                return wrappedComp;
              }
              newComponents[componentIndex] = wrappedComp;
              continue;
            }

            // Match is inside a compound component: [componentIndex, compoundChildIndex]
            if (matchLoc.path.length === 2 && typeof matchLoc.path[1] === 'number' && isNode(component, N.CompoundSelector)) {
              const childIndex = matchLoc.path[1];
              const compoundComponents = [...component.value];
              const matchedChild = compoundComponents[childIndex];
              if (matchedChild) {
                const wrappedChild = wrapMatchInIs(
                  matchedChild,
                  matchedChild,
                  extendWith,
                  component,
                  { target, find, extendWith },
                  extendWithSelectors
                );
                if (typeof wrappedChild === 'string') {
                  return wrappedChild;
                }
                compoundComponents[childIndex] = wrappedChild;
                const compoundResult = createValidatedCompoundSelectorWithErrors(compoundComponents, component, { target, find, extendWith });
                if (typeof compoundResult === 'string') {
                  return compoundResult;
                }
                newComponents[componentIndex] = compoundResult;
              }
              continue;
            }
          }

          return ComplexSelector.create(newComponents).inherit(target);
        }
      }

      const partialResult = handlePartialModeExtension(target, location, extendWith);
      return partialResult;
    }

    return applyExtensionAtLocation(target, location, extendWith);
  } else {
    // FULL MATCHING MODE: Create selector lists for complete matches

    // When partial: false, reject ALL partial matches - unified check before any special-casing.
    // This applies regardless of context (root, SelectorList, :is(), compound, complex, etc.)
    if (!partial && location.isPartialMatch) {
      return target;
    }

    // Less semantics: without `all`, `:extend(.x)` should only apply when `.x` is a complete selector
    // match (i.e. the entire selector / selector-list item), not when `.x` appears as a component
    // inside a larger selector like `.a .b .c`.
    //
    // Runtime evidence: in `extend-exact.less`, `.effected { &:extend(.a); ... }` should NOT affect
    // `.a .b .c`, but it currently does because the matcher can report a non-partial location for a
    // component match.
    if (!partial && isNode(find, N.SimpleSelector)) {
      const findV = find.valueOf();
      const wholeSelectorItemMatch = isNonAllWholeSelectorItemMatch(originalTarget, findV);
      if (!wholeSelectorItemMatch) {
        return target;
      }
    }

    // Check for boundary-crossing matches in compound selectors FIRST
    // This handles cases like :is(.a, .b).c matching .b.c where the match crosses the :is() boundary
    // This must be checked before handleFullExtend because it requires special flattening logic
    if (isNode(target, N.CompoundSelector) && isNode(find, N.CompoundSelector)) {
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
          if (matchedNode && isNode(matchedNode, N.SimpleSelector) && isNode(find, N.SimpleSelector)) {
            if (matchedNode.valueOf() === find.valueOf()) {
              // Component match within compound - treat as partial
              return target;
            }
          }
        }
      }

      // Check if this is a compound target that fully matches a compound selector
      // In this case, create a selector list instead of extending inside the pseudo-selector
      if (isNode(find, N.CompoundSelector) && isNode(target, N.CompoundSelector)) {
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
            if (isNode(target, N.ComplexSelector) && componentIndex > 0) {
              // There are components before the :is() - this is a partial match
              // Return unchanged - chaining logic should skip if selector didn't change
              return target;
            }

            // Check for components before or after the :is() in CompoundSelector
            if (isNode(target, N.CompoundSelector)) {
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
      const applied = applyExtensionAtLocation(target, location, extendWith);
      return applied;
    }

    // Special handling for full matches at the first component of complex selectors
    // Component matches in complex selectors create :is() wrappers (not selector lists)
    // Example: .aa .dd extended with .cc (where .cc:extend(.aa !all)) should produce :is(.aa, .cc) .dd
    // (Partial matches are already handled by the unified check above)
    if (location.path.length === 1 && isNode(target, N.ComplexSelector) && location.path[0] === 0) {
      // This is a component match in a complex selector - create :is() wrapper
      // REASON: Anything that's "part of" a selector gets wrapped in :is()
      const [componentIndex] = location.path;
      if (typeof componentIndex !== 'number') {
        return target;
      }
      const matchedComponent = target.value[componentIndex];

      if (matchedComponent && !isNode(matchedComponent, N.Combinator)) {
        // Replace the matched component with :is(original, extension)
        const newComponents = [...target.value];
        // If extendWith is a :is() selector, extract its selectors to avoid nesting
        const extendWithSelectors = extractSelectorsFromIs(extendWith);
        const isWrapper = createValidatedIsWrapperWithErrors([matchedComponent, ...extendWithSelectors], matchedComponent, target, { target, find, extendWith });
        if (typeof isWrapper === 'string') {
          return isWrapper;
        }

        newComponents[componentIndex] = isWrapper;
        return ComplexSelector.create(newComponents).inherit(target);
      }
    }

    // For full matches within compound selectors, create :is() wrapper
    // (Partial matches are already handled by the unified check above)
    if (location.path.length === 1 && isNode(target, N.CompoundSelector)) {
      // Check if we have multiple matching locations (e.g., .foo.foo has two .foo matches)
      // Process all matching locations, not just the first one
      if (searchResult.locations.length > 1) {
        // Filter to only component-level matches (path length 1 with numeric index)
        const componentMatches = searchResult.locations.filter(loc =>
          loc.path.length === 1
          && typeof loc.path[0] === 'number'
          && !loc.isPartialMatch
        );

        if (componentMatches.length > 1) {
          // Process all component matches - wrap each matching component in :is()
          const newComponents = [...target.value];
          for (const matchLoc of componentMatches) {
            const [componentIndex] = matchLoc.path;
            if (typeof componentIndex !== 'number') {
              continue;
            }
            const matchedComponent = newComponents[componentIndex];
            if (matchedComponent) {
              // Wrap this component in :is(original, extension)
              const isWrapResult = createValidatedIsWrapperWithErrors(
                [matchedComponent, extendWith],
                matchedComponent,
                target,
                { target, find, extendWith }
              );
              if (typeof isWrapResult === 'string') {
                return isWrapResult;
              }
              newComponents[componentIndex] = isWrapResult;
            }
          }
          return createValidatedCompoundSelectorWithErrors(newComponents, target, { target, find, extendWith });
        }
      }

      // Single match case
      const [componentIndex] = location.path;
      if (typeof componentIndex !== 'number') {
        return target;
      }
      const matchedComponent = target.value[componentIndex];

      if (matchedComponent && target.value.length > 1) {
        // Replace the matched component with :is(original, extension)
        const newComponents = [...target.value];
        // If extendWith is a :is() selector, extract its selectors to avoid nesting
        const extendWithSelectors = extractSelectorsFromIs(extendWith);
        const isWrapper = createValidatedIsWrapperWithErrors([matchedComponent, ...extendWithSelectors], matchedComponent, target, { target, find, extendWith });
        if (typeof isWrapper === 'string') {
          return isWrapper;
        }

        newComponents[componentIndex] = isWrapper;
        const result = createValidatedCompoundSelectorWithErrors(newComponents, target, { target, find, extendWith });
        return result;
      }
    }

    // Use handleFullExtend for root-level matches and default cases
    // This consolidates logic for SelectorList, PseudoSelector, and CompoundSelector handling
    // and includes performance optimizations for generated selectors
    return handleFullExtend(target, find, extendWith, location);
  }
}

/**
 * Extends a SelectorList by extending each matching selector in the list
 * @param target - The SelectorList to extend
 * @param find - The selector to find
 * @param extendWith - The selector to extend with
 * @param partial - Whether to use partial matching
 * @param skipAmpersandCheck - Whether to skip ampersand boundary checking
 * @returns Extended SelectorList
 */
function extendSelectorList(
  target: SelectorList,
  find: Selector,
  extendWith: Selector,
  partial: boolean,
  skipAmpersandCheck: boolean,
  preferIsWrapperInPartialMode: boolean = false
): Selector | ExtendErrorType {
  const markExtended = (selector: Selector): Selector => {
    selector.addFlag(F_EXTENDED);
    return selector;
  };
  const markExtendTarget = (selector: Selector): Selector => {
    if (partial && find.valueOf() !== extendWith.valueOf()) {
      selector.addFlag(F_EXTEND_TARGET);
    }
    return selector;
  };
  const keepOriginalInReference = (_selector: Selector): boolean =>
    !partial || (partial && find.valueOf() === extendWith.valueOf());

  const maybePrefixNewSelectorWithImplicitParent = (template: Selector, s: Selector): Selector => {
    // If we're extending inside a nested selector that already starts with an implicit `&`,
    // ensure any newly-added selector alternatives also start with the same implicit `&`.
    //
    // Without this, we can create a "mixed" selector list under a SelectorList parent:
    // - `& .replace` (relative via implicit parent)
    // - `.rep_ace` (absolute)
    //
    // That triggers `maybeHoistMixedNestingSelectorList()` and produces the unwanted
    // `:is(:is(...), ...) .rep_ace` distribution.
    if (!partial) {
      return s;
    }
    if (!isNode(template, N.ComplexSelector)) {
      return s;
    }
    const first = template.value[0];
    const second = template.value[1];
    if (!isNode(first, N.Ampersand) || !first.hasFlag(F_IMPLICIT_AMPERSAND)) {
      return s;
    }
    // If the selector already starts with an implicit `&`, keep it.
    if (isNode(s, N.ComplexSelector)) {
      const sf = s.value[0];
      if (isNode(sf, N.Ampersand) && sf.hasFlag(F_IMPLICIT_AMPERSAND)) {
        return s;
      }
    }
    // Prefix with the same implicit `&` + combinator shape from the template.
    const prefixed = ComplexSelector.create([
      first.derive(),
      isNode(second, N.Combinator) ? copyComplexComponentForPlacement(second) : Combinator.create(' ').inherit(first),
      copySelectorForExtend(s)
    ]).inherit(s);
    return prefixed;
  };

  // For SelectorLists, extend each selector that contains the find target.
  // Build list as [original selectors..., new selectors...] so .replace, .c + extend → .replace, .c, .rep_ace.
  const orderedSelectors: Selector[] = [];
  const orderedMatchFlags: boolean[] = [];
  const newSelectors: Selector[] = [];

  for (const selector of target.value) {
    const comparison = selectorCompare(selector, find);
    if (!comparison.locations.length || (!comparison.hasWholeMatch && !comparison.hasPartialMatch)) {
      orderedSelectors.push(selector);
      orderedMatchFlags.push(comparison.hasWholeMatch || comparison.hasPartialMatch);
      continue;
    }

    const extended = extendSelector(selector, find, extendWith, partial, skipAmpersandCheck, false);
    if (typeof extended === 'string') {
      return extended;
    }
    let appendedVariant = false;

    if (extended === selector) {
      orderedSelectors.push(
        keepOriginalInReference(selector)
          ? markExtended(copySelectorForExtend(selector))
          : markExtendTarget(copySelectorForExtend(selector))
      );
      orderedMatchFlags.push(comparison.hasWholeMatch || comparison.hasPartialMatch);
      if (comparison.hasWholeMatch && extendWith.valueOf() !== selector.valueOf()) {
        newSelectors.push(markExtended(maybePrefixNewSelectorWithImplicitParent(selector, copySelectorForExtend(extendWith))));
      }
      continue;
    }

    if (isNode(extended, N.SelectorList)) {
      if (
        partial
        && preferIsWrapperInPartialMode
        && extended.value.length === 2
        && extended.value[0]!.valueOf() === selector.valueOf()
        && extended.value[1]!.valueOf() === extendWith.valueOf()
      ) {
        const extendWithSelectors = extractSelectorsFromIs(extendWith);
        const isWrapper = createValidatedIsWrapperWithErrors(
          [selector, ...extendWithSelectors],
          selector,
          target,
          { target: selector, find, extendWith }
        );
        if (typeof isWrapper === 'string') {
          return isWrapper;
        }
        isWrapper.generated = true;
        orderedSelectors.push(markExtended(isWrapper));
        orderedMatchFlags.push(comparison.hasWholeMatch || comparison.hasPartialMatch);
        continue;
      }

      if (extended.value.length === 0) {
        orderedSelectors.push(
          keepOriginalInReference(selector)
            ? markExtended(copySelectorForExtend(selector))
            : markExtendTarget(copySelectorForExtend(selector))
        );
        orderedMatchFlags.push(comparison.hasWholeMatch || comparison.hasPartialMatch);
      } else if (extended.value.length === 1 && extended.value[0]!.valueOf() === extendWith.valueOf()) {
        orderedSelectors.push(
          keepOriginalInReference(selector)
            ? markExtended(copySelectorForExtend(selector))
            : markExtendTarget(copySelectorForExtend(selector))
        );
        orderedMatchFlags.push(comparison.hasWholeMatch || comparison.hasPartialMatch);
        if (extendWith.valueOf() !== selector.valueOf()) {
          newSelectors.push(markExtended(maybePrefixNewSelectorWithImplicitParent(selector, copySelectorForExtend(extendWith))));
        }
        appendedVariant = true;
      } else {
        const first = copySelectorForExtend(extended.value[0]!);
        orderedSelectors.push(keepOriginalInReference(selector) ? markExtended(first) : markExtendTarget(first));
        orderedMatchFlags.push(comparison.hasWholeMatch || comparison.hasPartialMatch);
        const template = extended.value[0] ?? selector;
        newSelectors.push(
          ...extended.value
            .slice(1)
            .map(s => markExtended(maybePrefixNewSelectorWithImplicitParent(template as Selector, s as Selector)))
            .map(s => copySelectorForExtend(s))
        );
        appendedVariant = true;
      }
    } else {
      const fullMatchOfListItem =
        selector.valueOf() === find.valueOf() && extended.valueOf() === extendWith.valueOf();

      if (fullMatchOfListItem) {
        orderedSelectors.push(
          keepOriginalInReference(selector)
            ? markExtended(copySelectorForExtend(selector))
            : markExtendTarget(copySelectorForExtend(selector))
        );
        orderedMatchFlags.push(comparison.hasWholeMatch || comparison.hasPartialMatch);
        if (extendWith.valueOf() !== selector.valueOf()) {
          newSelectors.push(markExtended(maybePrefixNewSelectorWithImplicitParent(selector, copySelectorForExtend(extendWith))));
        }
        appendedVariant = true;
      } else {
        orderedSelectors.push(markExtended(copySelectorForExtend(extended)));
        orderedMatchFlags.push(comparison.hasWholeMatch || comparison.hasPartialMatch);
        appendedVariant = true;
      }
    }

    if (!appendedVariant && extended.valueOf() !== selector.valueOf()) {
      const variant = markExtended(maybePrefixNewSelectorWithImplicitParent(selector, copySelectorForExtend(extended)));
      newSelectors.push(variant);
    }
  }

  const allSelectors = [...orderedSelectors, ...newSelectors];
  if (partial) {
    // In partial mode we intentionally keep :is() wrappers as items (Less `all` behavior),
    // rather than extracting them into comma-separated alternatives.
    const processed = createProcessedSelector(allSelectors, true);
    if (typeof processed === 'string') {
      return processed;
    }
    const processedArray = isArray(processed) ? processed : [processed];
    // See createExtendedSelectorList() for rationale: never include `target` as an adopted child
    // when we also inherit from it.
    const safeArray = processedArray.map(s => (s === target ? copySelectorForExtend(s) : s));
    return SelectorList.create(safeArray).inherit(target);
  }
  // Exact-mode OR propagation:
  // If a selector-list contains authored `:is(parent)` sibling branches and only some siblings
  // whole-match `find`, propagate `extendWith` into the shared parent `:is(...)` argument for the
  // non-matching sibling branches in the same group.
  let fullModeSelectors = allSelectors;
  if (!partial && isNode(find, N.ComplexSelector) && isNode(target, N.SelectorList)) {
    type OrGroupCandidate = {
      idx: number;
      selector: ComplexSelector;
      parentArg: SelectorList;
      hasSelectorMatch: boolean;
      groupKey: string;
    };
    const hasStandaloneExtendWith = fullModeSelectors.some(s => s.valueOf() === extendWith.valueOf());
    if (hasStandaloneExtendWith) {
      const candidates: OrGroupCandidate[] = [];
      for (let i = 0; i < orderedSelectors.length; i++) {
        const s = fullModeSelectors[i];
        if (!s || !isNode(s, N.ComplexSelector)) {
          continue;
        }
        const cs = s;
        if (cs.value.length !== 3) {
          continue;
        }
        const first = cs.value[0];
        const second = cs.value[1];
        if (!isNode(first, N.PseudoSelector) || first.value.name !== ':is' || first.generated) {
          continue;
        }
        if (!isNode(second, N.Combinator)) {
          continue;
        }
        const arg = first.value.arg;
        if (!isNode(arg, N.SelectorList)) {
          continue;
        }
        candidates.push({
          idx: i,
          selector: cs,
          parentArg: arg,
          hasSelectorMatch: !!orderedMatchFlags[i],
          groupKey: `${second.valueOf()}|${arg.valueOf()}`
        });
      }
      const byGroup = new Map<string, OrGroupCandidate[]>();
      for (const c of candidates) {
        const list = byGroup.get(c.groupKey) ?? [];
        list.push(c);
        byGroup.set(c.groupKey, list);
      }
      let mutationCount = 0;
      const next = [...fullModeSelectors];
      for (const [, members] of byGroup) {
        if (members.length < 2) {
          continue;
        }
        if (!members.some(m => m.hasSelectorMatch) || !members.some(m => !m.hasSelectorMatch)) {
          continue;
        }
        for (const m of members) {
          if (m.hasSelectorMatch) {
            continue;
          }
          const hasExtendWith = m.parentArg.value.some(s => s.valueOf() === extendWith.valueOf());
          if (hasExtendWith) {
            continue;
          }
          const updatedArg = SelectorList.create([
            ...m.parentArg.value.map(s => copySelectorForExtend(s)),
            copySelectorForExtend(extendWith)
          ]).inherit(m.parentArg);
          const updatedSel = copySelectorForExtend(m.selector);
          if (!isNode(updatedSel, N.ComplexSelector) || !isNode(updatedSel.value[0], N.PseudoSelector)) {
            throw new TypeError('Expected copied complex selector with pseudo head');
          }
          const updatedPseudo = updatedSel.value[0];
          updatedPseudo.value.arg = updatedArg;
          next[m.idx] = updatedSel;
          mutationCount++;
        }
      }
      if (mutationCount > 0) {
        fullModeSelectors = next;
      }
    }
  }
  // In full mode, try to factorize common `:is(parent) <child>` expansions back into
  // `:is(parent) :is(childA, childB, ...)` to match Less output expectations.
  //
  // This specifically targets the pattern produced by implicit parent selector alternatives.
  let finalSelectors = fullModeSelectors;
  try {
    const candidates: { idx: number; sel: ComplexSelector }[] = [];
    let sharedParent: string | null = null;
    let sharedCombinator: string | null = null;
    for (let i = 0; i < allSelectors.length; i++) {
      const s = allSelectors[i]!;
      if (!isNode(s, N.ComplexSelector)) {
        continue;
      }
      const cs = s as ComplexSelector;
      if (cs.value.length !== 3) {
        continue;
      }
      const first = cs.value[0];
      const second = cs.value[1];
      const third = cs.value[2];
      if (!(first instanceof Ampersand) || !first.hasFlag(F_IMPLICIT_AMPERSAND)) {
        continue;
      }
      const parentSel = first.getResolvedSelector();
      if (!parentSel || isNode(parentSel, N.Nil)) {
        continue;
      }
      if (!isNode(parentSel, N.PseudoSelector) || (parentSel as PseudoSelector).value.name !== ':is') {
        continue;
      }
      if (!isNode(second, N.Combinator)) {
        continue;
      }
      if (!isNode(third, N.BasicSelector)) {
        continue;
      }
      const parentStr = parentSel.valueOf();
      const combStr = second.valueOf();
      if (sharedParent === null) {
        sharedParent = parentStr;
      }
      if (sharedCombinator === null) {
        sharedCombinator = combStr;
      }
      if (parentStr !== sharedParent || combStr !== sharedCombinator) {
        continue;
      }
      candidates.push({ idx: i, sel: cs });
    }
    if (candidates.length >= 2 && sharedParent && sharedCombinator) {
      const insertionIdx = candidates[0]!.idx;
      const template = candidates[0]!.sel;
      const first = template.value[0];
      const second = template.value[1];
      if (!isNode(first, N.Ampersand) || !isNode(second, N.Combinator)) {
        throw new TypeError('Expected implicit ampersand factorization template');
      }
      const childBasics = candidates.map((c) => {
        const child = c.sel.value[2];
        if (!isNode(child, N.SimpleSelector)) {
          throw new TypeError('Expected simple selector child');
        }
        return copySimpleSelectorsForPlacement([child])[0]!;
      });
      const childList = SelectorList.create(childBasics).inherit(template);
      const childIs = new PseudoSelector({ name: ':is', arg: childList }).inherit(template);
      const combined = ComplexSelector.create([
        first.derive(),
        copyComplexComponentForPlacement(second),
        childIs
      ]).inherit(template);

      const filtered: Selector[] = [];
      const removeIdx = new Set(candidates.map(c => c.idx));
      for (let i = 0; i < allSelectors.length; i++) {
        if (i === insertionIdx) {
          filtered.push(combined);
        }
        if (removeIdx.has(i)) {
          continue;
        }
        filtered.push(allSelectors[i]!);
      }
      finalSelectors = filtered;
    }

    // Exact-mode de-distribution:
    // Collapse explicit cartesian-product expansions
    //   p1 <c> r1, p2 <c> r1, p1 <c> r2, p2 <c> r2
    // into
    //   :is(p1, p2) <c> :is(r1, r2)
    // when the full cross-product is present.
    if (!partial) {
      type ExplicitCandidate = {
        idx: number;
        selector: ComplexSelector;
        left: Selector;
        right: Selector;
        combinator: Combinator;
      };
      const byCombinator = new Map<string, ExplicitCandidate[]>();
      for (let i = 0; i < finalSelectors.length; i++) {
        const s = finalSelectors[i];
        if (!s || !isNode(s, N.ComplexSelector)) {
          continue;
        }
        const cs = s as ComplexSelector;
        if (cs.value.length !== 3) {
          continue;
        }
        const first = cs.value[0];
        const second = cs.value[1];
        const third = cs.value[2];
        if (!isSelectorNode(first) || !isNode(second, N.Combinator) || !isSelectorNode(third)) {
          continue;
        }
        const groupKey = second.valueOf();
        const list = byCombinator.get(groupKey) ?? [];
        list.push({
          idx: i,
          selector: cs,
          left: first,
          right: third,
          combinator: second
        });
        byCombinator.set(groupKey, list);
      }

      for (const [, group] of byCombinator) {
        if (group.length < 4) {
          continue;
        }
        const leftOrder: string[] = [];
        const rightOrder: string[] = [];
        const leftMap = new Map<string, Selector>();
        const rightMap = new Map<string, Selector>();
        const pairSet = new Set<string>();
        for (const c of group) {
          const lk = c.left.valueOf();
          const rk = c.right.valueOf();
          if (!leftMap.has(lk)) {
            leftMap.set(lk, c.left);
            leftOrder.push(lk);
          }
          if (!rightMap.has(rk)) {
            rightMap.set(rk, c.right);
            rightOrder.push(rk);
          }
          pairSet.add(`${lk}||${rk}`);
        }
        if (leftOrder.length < 2 || rightOrder.length < 2) {
          continue;
        }
        const expectedPairs = leftOrder.length * rightOrder.length;
        if (pairSet.size !== expectedPairs) {
          continue;
        }
        const groupPairCount = group.reduce((count, c) => {
          const lk = c.left.valueOf();
          const rk = c.right.valueOf();
          return pairSet.has(`${lk}||${rk}`) ? count + 1 : count;
        }, 0);
        if (groupPairCount !== expectedPairs) {
          continue;
        }

        const mkSide = (keys: string[], map: Map<string, Selector>, inheritFrom: Selector): Selector => {
          const getMappedSelector = (key: string): Selector => {
            const mapped = map.get(key);
            if (!mapped) {
              throw new TypeError('Expected mapped selector');
            }
            return mapped;
          };
          if (keys.length === 1) {
            return copySelectorForExtend(getMappedSelector(keys[0]!));
          }
          const list = SelectorList.create(
            keys.map(k => copySelectorForExtend(getMappedSelector(k)))
          ).inherit(inheritFrom);
          const pseudo = PseudoSelector.create({ name: ':is', arg: list }).inherit(inheritFrom);
          pseudo.generated = false;
          return pseudo;
        };

        const insertIdx = Math.min(...group.map(c => c.idx));
        const template = group.find(c => c.idx === insertIdx) ?? group[0]!;
        const leftSide = mkSide(leftOrder, leftMap, template.left);
        const rightSide = mkSide(rightOrder, rightMap, template.right);
        const combined = ComplexSelector.create([
          leftSide,
          copyComplexComponentForPlacement(template.combinator),
          rightSide
        ]).inherit(template.selector);

        const removeSet = new Set(group.map(c => c.idx));
        const rebuilt: Selector[] = [];
        for (let i = 0; i < finalSelectors.length; i++) {
          if (i === insertIdx) {
            rebuilt.push(combined);
          }
          if (removeSet.has(i)) {
            continue;
          }
          rebuilt.push(finalSelectors[i]!);
        }
        finalSelectors = rebuilt;

        break;
      }
    }
  } catch {}

  const finalResult = createExtendedSelectorList(finalSelectors, target);
  if (typeof finalResult === 'string') {
    return finalResult;
  }
  return finalResult;
}

/**
 * Selects the best location from search results based on partial/full mode and context
 * @param searchResult - The search result with all matching locations
 * @param target - The target selector
 * @param find - The selector to find
 * @param partial - Whether to use partial matching
 * @param hasMoreAfterIs - Whether there are more components after :is()
 * @param extendWith - The selector to extend with (for error context)
 * @returns The selected location
 */
function selectBestLocation(
  searchResult: ExtendSearchResult,
  comparison: SelectorComparisonResult,
  target: Selector,
  find: Selector,
  partial: boolean,
  hasMoreAfterIs: boolean,
  _extendWith: Selector
): ExtendLocation | ExtendErrorType {
  const getMatchScope = (loc: ExtendLocation): MatchScope => {
    if (loc.matchScope) {
      return loc.matchScope;
    }
    const path = Array.isArray(loc.path) ? loc.path : [];
    if (path.includes('arg')) {
      return 'isArgument';
    }
    if (isNode(target, N.SelectorList)) {
      return 'selectorList';
    }
    return 'root';
  };

  // For partial extends, prefer actual matches over "append to :is() list" extension points
  // The "append to list" locations have paths ending in 'arg', while actual matches have
  // more specific paths like [index, 'arg', altIndex]
  // For full extends (partial: false), prefer valid full matches
  // Prefer an actual matched-node replacement/wrap over "append to :is() list" locations.
  // This matters for cases like:
  //   target: `:is(parent) :is(.replace,.c)`
  //   find: `.c`
  // where the matcher reports both:
  // - a real `.c` match inside the child :is() arg (replace/wrap)
  // - an "append" location for the parent :is() arg
  // In full mode we should extend the `.c` occurrence, not mutate the parent list.
  const originalLocations: ExtendLocation[] = Array.isArray(searchResult.locations)
    ? searchResult.locations
    : [];
  const locations: ExtendLocation[] = originalLocations.length > 0
    ? originalLocations
    : comparison.locations;
  if (locations.length > 0) {
    const typePriority: Record<string, number> = { wrap: 0, replace: 1, append: 2 };
    locations.sort((a, b) => {
      const pa = typePriority[a.extensionType] ?? 3;
      const pb = typePriority[b.extensionType] ?? 3;
      if (pa !== pb) {
        return pa - pb;
      }
      const pathA = Array.isArray(a.path) ? a.path.length : 0;
      const pathB = Array.isArray(b.path) ? b.path.length : 0;
      return pathA - pathB;
    });
    searchResult.locations = locations;
  }

  const findV = find.valueOf();

  // In partial mode, prefer wrapping a specific list item over appending to the :is() list.
  // e.g. .a:is(.b,.c).d + find .b → use path [1,'arg',0] (wrap .b) not [1,'arg'] (append .q to list).
  if (partial && locations.length > 1) {
    const withItemIndex = locations.filter((l: any) =>
      Array.isArray(l?.path) && l.path.length >= 2
      && l.path[l.path.length - 2] === 'arg'
      && typeof l.path[l.path.length - 1] === 'number'
    );
    if (withItemIndex.length > 0) {
      const appendOnly = locations.filter((l: any) =>
        Array.isArray(l?.path) && l.path.length >= 1 && l.path[l.path.length - 1] === 'arg'
      );
      if (appendOnly.length > 0) {
        // Prefer wrap/replace at the item over append at the list
        const wrapOrReplace = withItemIndex.filter((l: any) => l?.extensionType === 'wrap' || l?.extensionType === 'replace');
        (searchResult as { locations: any[] }).locations = wrapOrReplace.length > 0 ? wrapOrReplace : withItemIndex;
      }
    }
  }

  const preferNonAppend = !partial && locations.length > 0;
  if (preferNonAppend) {
    const actualMatches = locations.filter((l: any) => {
      if (l?.extensionType === 'append' && getMatchScope(l) === 'isArgument') {
        return true;
      }
      if (l?.extensionType !== 'append') {
        return true;
      }
      try {
        const mv = l?.matchedNode?.valueOf?.();
        return typeof mv === 'string' && mv === findV;
      } catch {
        return false;
      }
    });
    // Keep "append" locations that target the matched node itself (e.g. appending into a child :is() arg),
    // but drop "append" locations that mutate an enclosing SelectorList (these incorrectly add to the parent list).
    const filtered = actualMatches.filter((l: any) => {
      if (l?.extensionType === 'append' && getMatchScope(l) === 'isArgument') {
        return true;
      }
      if (l?.extensionType !== 'append') {
        return true;
      }
      const mt = l?.matchedNode?.type ?? null;
      if (mt === 'SelectorList') {
        return false;
      }
      // Also drop the common parent-arg append shape: [..., 'arg'] with no index following.
      if (Array.isArray(l?.path) && l.path.length >= 2) {
        const last = l.path[l.path.length - 1];
        const prev = l.path[l.path.length - 2];
        if (last === 'arg' && typeof prev === 'number') {
          return false;
        }
      }
      return true;
    });
    if (filtered.length > 0) {
      // Prefer appending into the exact matched node (keeps `:is(.a,.b,.effected)` shape)
      const appendBasic = isNode(find, N.SimpleSelector)
        ? filtered.find((l: any) => l?.extensionType === 'append' && l?.matchedNode?.type === 'BasicSelector')
        : undefined;
      if (appendBasic) {
        searchResult.locations = [appendBasic];
      } else {
        // Otherwise prefer replace over wrap if both exist.
        const replace = filtered.find((l: any) => l?.extensionType === 'replace');
        const wrap = filtered.find((l: any) => l?.extensionType === 'wrap');
        searchResult.locations = replace ? [replace] : (wrap ? [wrap] : filtered);
      }
    }
  }

  // Narrow rule for complex exact extends (e.g. `.replace.replace .replace`):
  // if both append and non-append candidates exist, prefer concrete non-append
  // locations to avoid mutating the parent :is() argument.
  if (!partial && isNode(find, N.ComplexSelector) && searchResult.locations?.length > 1) {
    const nonAppend = searchResult.locations.filter((l: ExtendLocation) => l.extensionType !== 'append');
    if (nonAppend.length > 0) {
      searchResult.locations = nonAppend;
    }
  }

  if (searchResult.locations?.length) {
    const hasWrap = searchResult.locations.some((l: ExtendLocation) => l.extensionType === 'wrap');
    const hasAppend = searchResult.locations.some((l: ExtendLocation) => l.extensionType === 'append');
    if (hasWrap && hasAppend && !isNode(find, N.SimpleSelector)) {
      searchResult.locations = searchResult.locations.filter((l: ExtendLocation) => l.extensionType !== 'append');
    }
  }

  let locationLocked = false;

  const finalLocations: ExtendLocation[] = (searchResult.locations && searchResult.locations.length > 0)
    ? searchResult.locations
    : locations;
  const matchScopePriority: Record<MatchScope, number> = {
    isArgument: 0,
    selectorList: 1,
    root: 2
  };
  let location = finalLocations[0]!;
  if (!partial && finalLocations.length > 1) {
    let best = finalLocations[0]!;
    for (const candidate of finalLocations) {
      const bestScope = matchScopePriority[getMatchScope(best)];
      const candidateScope = matchScopePriority[getMatchScope(candidate)];
      if (candidateScope < bestScope) {
        best = candidate;
      }
    }
    location = best;
    locationLocked = getMatchScope(best) === 'isArgument';
  }

  if (!locationLocked) {
    const appendInIsArg = finalLocations.find((loc: ExtendLocation) =>
      loc.extensionType === 'append'
      && getMatchScope(loc) === 'isArgument'
      && !loc.isPartialMatch
    );
    if (appendInIsArg && !isNode(find, N.ComplexSelector)) {
      location = appendInIsArg;
      locationLocked = true;
    }
  }

  // Exception: When partial: false and we're inside an :is() with more components after it,
  // even if we've matched the entire find (full match of item in :is()), it's still a partial match
  // of the entire selector because there are components after the :is()
  // Example: :is(.i).j with find .i and partial: false
  // We matched .i (full match of item in :is()), but there's .j after, so this is a partial match
  if (!partial && hasMoreAfterIs) {
    // If target is a SelectorList (we're inside an :is() argument), check if we matched an entire item
    const isInsideSelectorList = isNode(target, N.SelectorList);

    if (isInsideSelectorList) {
      // The location path will be like [index] or ['arg', index] when matching an item in the list
      // Check if we matched an entire item (not a partial match within that item)
      const pathHasIndex = location.path.some((p: string | number, i: number) =>
        typeof p === 'number' && (i === 0 || location.path[i - 1] === 'arg')
      );
      const matchedEntireItem = pathHasIndex && !location.isPartialMatch;

      // Also check if the matched node equals the find
      const matchedNode = location.matchedNode;
      const matchedNodeEqualsFind = matchedNode && matchedNode.valueOf() === find.valueOf();

      // If we matched an entire item and there are more components after, this is a partial match
      if (matchedEntireItem || matchedNodeEqualsFind) {
        return ExtendErrorType.PARTIAL_MATCH;
      }
    }
  }

  // (Partial matches are now handled by the unified check in the full matching mode section)
  if (!locationLocked && !partial && searchResult.locations.length > 1) {
    // When partial: false, prefer valid full matches (root-level or first component of complex selector)
    // IMPORTANT: Must check !loc.isPartialMatch to avoid selecting partial matches
    const validFullMatch = searchResult.locations.find((loc: ExtendLocation) => {
      if (loc.path.length === 0 && !loc.isPartialMatch) {
        return true;
      }
      if (loc.path.length === 1 && isNode(target, N.ComplexSelector) && loc.path[0] === 0 && !loc.isPartialMatch) {
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
    const actualMatch = searchResult.locations.find((loc: ExtendLocation) => {
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

  return location;
}

function isNonAllWholeSelectorItemMatch(target: Selector, findValue: string): boolean {
  // Exact whole-selector match (single selector item).
  if (target.valueOf() === findValue) {
    return true;
  }

  // SelectorList item match.
  if (isNode(target, N.SelectorList)) {
    return target.value.some((s) => {
      try {
        return s.valueOf() === findValue;
      } catch {
        return false;
      }
    });
  }

  // OR-path match: if the *entire selector item* is a selector-arg pseudo like :is(...)
  // and one alternative equals the find selector, that's a valid whole-item match.
  if (isNode(target, N.PseudoSelector)) {
    const arg = target.value.arg;
    if (isNode(arg, N.SelectorList)) {
      return arg.value.some((s) => {
        try {
          return s.valueOf() === findValue;
        } catch {
          return false;
        }
      });
    }
    if (isSelectorNode(arg)) {
      try {
        if (arg.valueOf() === findValue) {
          return true;
        }
        // Nested :is() e.g. :is(:is(.foo)) - recurse into single arg
        if (isNode(arg, N.Selector)) {
          return isNonAllWholeSelectorItemMatch(arg, findValue);
        }
      } catch {
        return false;
      }
    }
  }

  return false;
}

/**
 * Handles extension in partial matching mode - creates :is() wrappers for component-level matches.
 *
 * What gets wrapped: within-one-compound → wrap only matched part; spans-combinator → wrap full segment.
 * See EXTEND_RULES.md §3a.
 *
 * IMPLEMENTATION WARNING: Do NOT decide wrap scope by target type or path length. Target can be
 * :is() containing complex, SelectorList, compound with :is() inside, etc. Use keySet + equivalency
 * and "what does the match PRODUCE" (e.g. does it include combinators?) to decide. The branches
 * below that check path.length and isNode(target, ...) are narrow and fail for nested targets;
 * they should be replaced by match-result-based logic.
 */
function handlePartialModeExtension(
  target: Selector,
  location: any,
  extendWith: Selector
): Selector | ExtendErrorType {
  // Unified path: use path + match result only. For partial mode, component-level matches get :is(matched, extendWith).
  // Force extensionType to 'wrap' when path points to a component (path.length >= 1) so applyExtensionAtPath
  // wraps the node at path instead of replacing. Works for any target shape (SelectorList, :is(complex), etc.).
  const extensionType =
    location.path && location.path.length >= 1 ? ('wrap' as const) : (location.extensionType ?? 'replace');
  const wrapLocation = { ...location, extensionType };
  const result = applyExtensionAtLocation(target, wrapLocation, extendWith);
  return result;
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
  _matchResult: any
): Selector | ExtendErrorType {
  // For full matches, we add the extension as a new selector in a list

  // If target is already a selector list, add to it
  if (isNode(target, N.SelectorList)) {
    return createExtendedSelectorList([...target.value, extendWith], target);
  }

  // If target is a pseudo-selector with selector arguments, check if we should extend arguments or create selector list
  if (isNode(target, N.PseudoSelector)) {
    const arg = target.value.arg;
    // Only extend arguments for :is() pseudo-selectors or when the find is NOT the complete pseudo-selector
    // For other pseudo-selectors like :where(), when the entire pseudo-selector is matched, create a selector list
    if (isSelectorNode(arg) && target.value.name === ':is') {
      if (isNode(arg, N.SelectorList)) {
        // Add to existing selector list
        const newArg = createExtendedSelectorList([...arg.value, extendWith], arg);
        if (typeof newArg === 'string') {
          return newArg;
        }
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
        const newArg = createExtendedSelectorList([arg, extendWith], arg);
        if (typeof newArg === 'string') {
          return newArg;
        }

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
  if (isNode(target, N.CompoundSelector)) {
    // Order: target (ruleset owner) first, then extendWith. Same as SelectorList append and circular ref.
    return createExtendedSelectorList([target, extendWith], target);
  }

  // Order: target (ruleset owner) first, then extendWith. So .e gets [.e, .d], .z gets [.z, .x], and
  // when we later append (e.g. .y to [.z, .x]) we get [.z, .x, .y] — one consistent path.
  return createExtendedSelectorList([target, extendWith], target);
}

// Removed unused function: handleCompoundFullExtend
// This function was never called. The logic it contained is now handled inline
// in extendSelector (lines 1160-1203) for full mode compound selector handling.

/**
 * Creates an :is() wrapper around the given selectors
 * Preserves comments on original selectors, strips them from inheritance chain
 */
function createIsWrapper(selectors: Selector[], inheritFrom: Selector): PseudoSelector {
  // Create selectorList with original selectors (preserving their comments)
  // Basic deduplication here to avoid obvious duplicates
  // Full normalization (flattening) will be handled by createProcessedSelector
  // when the result is processed through createExtendedSelectorList
  const deduplicated = deduplicateSelectors(selectors);
  const selectorList = SelectorList.create(copySelectorsForPlacement(deduplicated));

  // Create PseudoSelector using the create factory method - same signature as constructor but marks as generated
  const pseudoSelector = PseudoSelector.create({
    name: ':is',
    arg: selectorList
  }).inherit(inheritFrom) as PseudoSelector;
  // Ensure downstream normalization can unwrap/merge this wrapper when appropriate.
  pseudoSelector.generated = true;

  return pseudoSelector;
}

// Removed unused function: createValidatedIsWrapper
// Only createValidatedIsWrapperWithErrors (which throws) is used throughout the codebase.
// Fallback behavior is not needed.

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
): PseudoSelector | ExtendErrorType {
  const decoratedSelectors = selectors.map(selector => copySelectorForExtend(selector));
  if (context?.find && context?.extendWith && context.find.valueOf() !== context.extendWith.valueOf()) {
    const first = decoratedSelectors[0];
    if (first) {
      first.addFlag(F_EXTEND_TARGET);
    }
    for (let i = 1; i < decoratedSelectors.length; i++) {
      decoratedSelectors[i]!.addFlag(F_EXTENDED);
    }
  }

  const validation = validateIsWrapper(decoratedSelectors, contextSelector);
  if (!validation.isValid) {
    return validation.errorType!;
  }

  const wrapper = createIsWrapper(decoratedSelectors, inheritFrom);
  // Mark generated so downstream normalization and valueOf can flatten when appropriate.
  wrapper.generated = true;
  return wrapper;
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
  if (contextSelector && isNode(contextSelector, N.CompoundSelector)) {
    // Collect all elements and IDs from context
    const contextElementTypes = new Set<string>();
    const contextIdValues = new Set<string>();

    for (const child of contextSelector.value) {
      if (isNode(child, N.BasicSelector)) {
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
      if (isNode(selector, N.BasicSelector)) {
        if (selector.isTag) {
          allElementTypes.add(selector.value.toLowerCase());
        }
        if (selector.isId) {
          allIdValues.add(selector.value);
        }
      } else if (isNode(selector, N.CompoundSelector)) {
        for (const child of selector.value) {
          if (isNode(child, N.BasicSelector)) {
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
      if (isNode(selector, N.BasicSelector)) {
        if (selector.isTag) {
          elementTypes.add(selector.value.toLowerCase());
        }
        if (selector.isId) {
          idValues.add(selector.value);
        }
      } else if (isNode(selector, N.CompoundSelector)) {
        for (const child of selector.value) {
          if (isNode(child, N.BasicSelector)) {
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
/**
 * True when the selector is entirely "implicit & + rest" (every list item is a complex selector
 * that starts with implicit ampersand + combinator), or a single ComplexSelector that starts
 * that way. In that case, any match of the find in the resolved form is "only within ampersand".
 */
function selectorIsEntirelyImplicitAmpersandLeading(selector: Selector): boolean {
  const checkItem = (item: Selector): boolean => {
    if (!isNode(item, N.ComplexSelector) || item.value.length < 2) {
      return false;
    }
    const [first, second] = item.value;
    return (
      isNode(first, N.Ampersand)
      && (first as Ampersand).hasFlag(F_IMPLICIT_AMPERSAND)
      && isNode(second, N.Combinator)
    );
  };
  if (isNode(selector, N.SelectorList)) {
    const list = (selector as SelectorList).value;
    if (!Array.isArray(list) || list.length === 0) {
      return false;
    }
    return list.every(item => checkItem(item));
  }
  return checkItem(selector);
}

function checkAmpersandCrossingDuringExtension(selector: Selector, target: Selector): {
  crossed: boolean;
  ampersandNode?: Ampersand;
  reason?: 'selectorlist-implicit-leading' | 'resolved-only';
  resolvedMatches?: number;
  nonAmpMatches?: number;
} {
  // When the selector is entirely "implicit & + rest" *and* it's a SelectorList with more than
  // one item (e.g. "& .b, & .a" or "& .a, & .c"), any match in the resolved form is "only within
  // ampersand" — the parent should carry the extend. Single-item "& .a" is handled by the loop
  // below (replaceAmpersandWithEmpty leaves ".a" which matches, so we don't return crossed).
  if (
    isNode(selector, N.SelectorList)
    && (selector as SelectorList).value.length > 1
    && selectorIsEntirelyImplicitAmpersandLeading(selector)
  ) {
    const list = (selector as SelectorList).value;
    const firstItem = list[0];
    if (firstItem && isNode(firstItem, N.ComplexSelector) && firstItem.value.length > 0) {
      const firstComp = firstItem.value[0];
      if (isNode(firstComp, N.Ampersand)) {
        const amp = firstComp as Ampersand;
        const resolved = amp.getResolvedSelector();
        if (resolved && !isNode(resolved, N.Nil)) {
          const resolvedSelector = replaceAmpersandWithItsValue(selector, amp);
          const resolvedComparison = selectorCompare(resolvedSelector, target);
          const selectorWithoutAmpersand = replaceAmpersandWithEmpty(selector, amp);
          const nonAmpersandComparison = selectorCompare(selectorWithoutAmpersand, target);
          if (resolvedComparison.locations.length > 0 && nonAmpersandComparison.locations.length === 0) {
            return {
              crossed: true,
              ampersandNode: amp,
              reason: 'selectorlist-implicit-leading',
              resolvedMatches: resolvedComparison.locations.length,
              nonAmpMatches: nonAmpersandComparison.locations.length
            };
          }
        }
      }
    }
  }

  // Find ampersands in the selector (reaches into compound/complex; SelectorList handled above)
  const ampersandNodes = findAmpersandsInSelector(selector);

  for (const { ampersand } of ampersandNodes) {
    const resolved = ampersand.getResolvedSelector();
    // Skip ampersands without resolved selectors
    if (!resolved || isNode(resolved, N.Nil)) {
      continue;
    }

    // Create resolved version by replacing ampersand with its resolved selector
    const resolvedSelector = replaceAmpersandWithItsValue(selector, ampersand);
    const resolvedComparison = selectorCompare(resolvedSelector, target);

    // Also check if target matches the selector without this ampersand
    const selectorWithoutAmpersand = replaceAmpersandWithEmpty(selector, ampersand);
    const nonAmpersandComparison = selectorCompare(selectorWithoutAmpersand, target);

    if (resolvedComparison.locations.length > 0 && nonAmpersandComparison.locations.length === 0) {
      // Target only matches when ampersand is resolved = boundary crossing
      return {
        crossed: true,
        ampersandNode: ampersand,
        reason: 'resolved-only',
        resolvedMatches: resolvedComparison.locations.length,
        nonAmpMatches: nonAmpersandComparison.locations.length
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
    if (isNode(node, N.Ampersand)) {
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
  const resolved = ampersand.getResolvedSelector();
  if (!resolved || isNode(resolved, N.Nil)) {
    return selector;
  }

  const selectorCopy = isNode(selector, N.CompoundSelector)
    ? copySelectorForExtend(selector)
    : selector.copy();
  let resolvedSelector: Selector = copySelectorForExtend(resolved);

  // If the resolved selector is a SelectorList, wrap it in :is() so it can be used as a single
  // selector component. This prevents invalid structures and matches Less output expectations.
  // Example: & .replace, & .c with parent .a, .b becomes :is(.a, .b) :is(.replace, .c)
  if (isNode(resolvedSelector, N.SelectorList)) {
    const isWrapper = isSelectorPseudo(resolvedSelector);
    isWrapper.generated = true; // Mark as generated so it can be optimized later if needed
    resolvedSelector = isWrapper;
  }

  // Find and replace ALL matching ampersand nodes (not just the first)
  // This is important for SelectorList targets like & .replace, & .c
  const nodesToReplace: Array<{ node: Ampersand; parent: any }> = [];
  const ampersandResolvedValue = ampersand.getResolvedSelector()?.valueOf();
  for (const node of selectorCopy.nodes()) {
    if (isNode(node, N.Ampersand) && (node as Ampersand).getResolvedSelector()?.valueOf() === ampersandResolvedValue) {
      const parent = findParentOfNode(selectorCopy, node);
      if (parent) {
        nodesToReplace.push({ node: node as Ampersand, parent });
      }
    }
  }

  // Replace all matching ampersands
  for (const { node, parent } of nodesToReplace) {
    replaceNodeInParent(parent, node, copySelectorForExtend(resolvedSelector));
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
  const selectorCopy = copySelectorForExtend(selector);

  const ampersandResolvedValue = ampersand.getResolvedSelector()?.valueOf();
  // Find and remove the ampersand node
  for (const node of selectorCopy.nodes()) {
    if (node === ampersand || (isNode(node, N.Ampersand)
      && node.getResolvedSelector()?.valueOf() === ampersandResolvedValue)) {
      // We need to find the parent container and remove the ampersand
      const parent = findParentOfNode(selectorCopy, node);
      if (parent && (isNode(parent, N.CompoundSelector) || isNode(parent, N.ComplexSelector))) {
        // Remove from compound/complex selector
        const idx = parent.value.findIndex(child => child === node);
        if (idx >= 0) {
          parent.value.splice(idx, 1);
          // If we removed a leading ampersand in a complex selector, also remove a following combinator
          // (implicit nesting uses `&` + generated whitespace combinator).
          const next = parent.value[idx];
          if (isNode(next, N.Combinator) && next.value === ' ') {
            parent.value.splice(idx, 1);
          }
        }
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
  _matchResult: any
): Selector | ExtendErrorType {
  const parentSelectorResolved = ampersandNode.getResolvedSelector();
  if (!parentSelectorResolved || isNode(parentSelectorResolved, N.Nil)) {
    throw new Error('Ampersand boundary crossing detected but ampersand has no resolved selector');
  }

  // Special handling for SelectorList: when crossing ampersand boundary, we need to replace
  // all ampersands in the list and wrap the inner SelectorList in :is() instead of distributing.
  // Example: & .replace, & .c with parent .a, .b should become :is(.a, .b) :is(.replace, .c)
  // not :is(.a, .b) .replace, :is(.a, .b) .c
  if (isNode(selector, N.SelectorList)) {
    const parentSelector = parentSelectorResolved;
    let parentWrapped: Selector = copySelectorForExtend(parentSelector);
    if (isNode(parentWrapped, N.SelectorList)) {
      parentWrapped = isSelectorPseudo(parentWrapped);
      parentWrapped.generated = true;
    }
    // Extract nested selectors directly from each selector-list item:
    // "& .replace, & .c" -> ".replace, .c"
    const extractNestedFromItem = (item: Selector): Selector | null => {
      if (!isNode(item, N.ComplexSelector)) {
        return copySelectorForExtend(item);
      }
      const parts = item.value;
      if (parts.length === 0 || !isNode(parts[0], N.Ampersand)) {
        return copySelectorForExtend(item);
      }
      let start = 1;
      if (parts[start] && isNode(parts[start], N.Combinator)) {
        start += 1;
      }
      const tail = parts.slice(start).filter(isComplexComponent);
      if (tail.length === 0) {
        return null;
      }
      if (tail.length === 1 && isNode(tail[0], N.Selector)) {
        return copySelectorForExtend(tail[0]);
      }
      return ComplexSelector.create(tail).inherit(item);
    };
    let nestedItems: Selector[] = selector.value
      .map(extractNestedFromItem)
      .filter((s): s is Selector => !!s);

    // Ensure we have at least one nested item
    if (nestedItems.length === 0) {
      nestedItems = selector.value.map(item => item.copy());
    }
    // Wrap the inner SelectorList in :is() to match Less expectations
    const innerList = SelectorList.create(nestedItems);
    const innerWrapped = isSelectorPseudo(innerList);
    innerWrapped.generated = true;

    // Create the combined selector: :is(parent) :is(inner)
    const combined = ComplexSelector.create([
      parentWrapped,
      Combinator.create(' '),
      innerWrapped
    ]).inherit(selector);

    // Step 2: Extend the combined selector (skip ampersand check to prevent recursion)
    const extendedSelector = extendSelector(combined, target, extendWith, false, true, false);
    if (typeof extendedSelector === 'string') {
      return extendedSelector;
    }

    // Step 3: Mark for hoisting to root
    const hoisted = markSelectorForHoisting(extendedSelector);
    const hoistedList = SelectorList.create([hoisted, copySelectorForExtend(extendWith)]).inherit(hoisted);
    hoistedList.hoistToRoot = true;
    return hoistedList;
  }

  // Step 1: Replace the ampersand with its resolved selector
  const resolvedSelector = replaceAmpersandWithItsValue(selector, ampersandNode);

  // Step 2: Extend the resolved selector (skip ampersand check to prevent recursion)
  const extendedSelector = extendSelector(resolvedSelector, target, extendWith, false, true, false);
  if (typeof extendedSelector === 'string') {
    return extendedSelector;
  }

  // Step 3: Mark for hoisting to root
  return markSelectorForHoisting(extendedSelector);
}

/**
 * Finds the parent container of a specific node
 * @param root - The root selector to search in
 * @param targetNode - The node to find the parent of
 * @returns The parent container or null if not found
 */
function findParentOfNode(
  root: Selector,
  targetNode: Node
): CompoundSelector | ComplexSelector | SelectorList | PseudoSelector | null {
  for (const node of root.nodes()) {
    if (
      (isNode(node, N.CompoundSelector) || isNode(node, N.ComplexSelector) || isNode(node, N.SelectorList))
      && node.value.some(child => child === targetNode)
    ) {
      return node;
    }
    if (isNode(node, N.PseudoSelector) && node.value.arg === targetNode) {
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
  if (isNode(parent, N.CompoundSelector) || isNode(parent, N.ComplexSelector) || isNode(parent, N.SelectorList)) {
    for (let i = 0; i < parent.value.length; i++) {
      if (parent.value[i] === oldNode) {
        parent.value[i] = newNode;
        break;
      }
    }
  } else if (isNode(parent, N.PseudoSelector) && parent.value.arg === oldNode) {
    parent.value.arg = newNode;
  }
}

/**
 * Marks a selector for hoisting to root by setting hoistToRoot option
 * @param selector - The selector to mark for hoisting
 * @returns Selector marked for hoisting
 */
function markSelectorForHoisting(selector: Selector): Selector {
  const hoistedSelector = copySelectorForExtend(selector);
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
// Removed unused function: optimizeUnnecessaryIsWrapper
// This was only used by flattenGeneratedIsInSelector, which has been removed.
// All :is() optimization and flattening is now handled in createProcessedSelector.

// Removed unused functions: isValidCompoundSelector, createValidatedCompoundSelector
// isValidCompoundSelector was never called - validateCompoundSelector has its own implementation
// createValidatedCompoundSelector was never called - only createValidatedCompoundSelectorWithErrors (which throws) is used

/**
 * Creates a compound selector with validation that throws errors on conflicts
 * @param components - Array of selectors to combine
 * @param inheritFrom - Selector to inherit properties from
 * @param context - Context information for error reporting
 * @returns Valid compound selector
 * @throws ExtendError if validation fails
 */
function createValidatedCompoundSelectorWithErrors(
  components: SimpleSelector[],
  inheritFrom: Selector,
  _context?: {
    target?: Selector;
    find?: Selector;
    extendWith?: Selector;
  }
): CompoundSelector | ExtendErrorType {
  const validation = validateCompoundSelector(components);
  if (!validation.isValid) {
    return validation.errorType!;
  }

  const compound = CompoundSelector.create(components);
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
    if (isNode(component, N.BasicSelector)) {
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
    } else if (isNode(component, N.CompoundSelector)) {
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
  return findChainedExtendsWithSkips(
    extendedSelector,
    allExtends,
    new Set([`${currentTarget.valueOf()}|${currentSelectorWithExtend.valueOf()}`]),
    originalSelector
  );
}

function collectSelectorSubtreeValues(
  selector: Selector,
  values: Set<string> = new Set()
): Set<string> {
  const selectorValue = selector.valueOf();
  if (values.has(selectorValue)) {
    return values;
  }
  values.add(selectorValue);

  if (isNode(selector, N.SelectorList)) {
    for (const item of selector.value) {
      collectSelectorSubtreeValues(item as Selector, values);
    }
    return values;
  }

  if (isNode(selector, N.CompoundSelector)) {
    for (const item of selector.value) {
      collectSelectorSubtreeValues(item as Selector, values);
    }
    return values;
  }

  if (isNode(selector, N.ComplexSelector)) {
    for (const item of selector.value) {
      if (isNode(item, N.Combinator)) {
        continue;
      }
      collectSelectorSubtreeValues(item as Selector, values);
    }
    return values;
  }

  if (isNode(selector, N.PseudoSelector)) {
    const { arg } = selector.value;
    if (arg && isSelectorNode(arg)) {
      collectSelectorSubtreeValues(arg, values);
    }
  }

  return values;
}

function collectNewSelectorCandidates(
  selector: Selector,
  originalValues: Set<string>,
  candidates: Selector[] = [],
  seenValues: Set<string> = new Set()
): Selector[] {
  const selectorValue = selector.valueOf();
  if (!originalValues.has(selectorValue) && !seenValues.has(selectorValue)) {
    candidates.push(selector);
    seenValues.add(selectorValue);
  }

  if (isNode(selector, N.SelectorList)) {
    for (const item of selector.value) {
      collectNewSelectorCandidates(item as Selector, originalValues, candidates, seenValues);
    }
    return candidates;
  }

  if (isNode(selector, N.CompoundSelector)) {
    for (const item of selector.value) {
      collectNewSelectorCandidates(item as Selector, originalValues, candidates, seenValues);
    }
    return candidates;
  }

  if (isNode(selector, N.ComplexSelector)) {
    for (const item of selector.value) {
      if (isNode(item, N.Combinator)) {
        continue;
      }
      collectNewSelectorCandidates(item as Selector, originalValues, candidates, seenValues);
    }
    return candidates;
  }

  if (isNode(selector, N.PseudoSelector)) {
    const { arg } = selector.value;
    if (arg && isSelectorNode(arg)) {
      collectNewSelectorCandidates(arg, originalValues, candidates, seenValues);
    }
  }

  return candidates;
}

function findChainedExtendsWithSkips(
  extendedSelector: Selector,
  allExtends: Array<[Selector, Selector, boolean, any, any]>,
  skipKeys: Set<string>,
  originalSelector: Selector
): Array<[Selector, Selector, boolean, any, any]> {
  const chained: Array<[Selector, Selector, boolean, any, any]> = [];
  const originalValues = collectSelectorSubtreeValues(originalSelector);
  const candidates = collectNewSelectorCandidates(extendedSelector, originalValues);
  const queued = new Set<string>();

  for (const candidate of candidates) {
    for (const [otherTarget, otherSelectorWithExtend, otherPartial, otherExtendRoot, otherExtendNode] of allExtends) {
      const skipKey = `${otherTarget.valueOf()}|${otherSelectorWithExtend.valueOf()}`;
      if (skipKeys.has(skipKey)) {
        continue;
      }

      if (wouldExtendChange(originalSelector, otherTarget, otherSelectorWithExtend, otherPartial)) {
        continue;
      }

      if (!wouldExtendChange(candidate, otherTarget, otherSelectorWithExtend, otherPartial)) {
        continue;
      }

      const chainKey = `${otherPartial ? 1 : 0}|${otherTarget.valueOf()}|${otherSelectorWithExtend.valueOf()}`;
      if (queued.has(chainKey)) {
        continue;
      }

      chained.push([otherTarget, otherSelectorWithExtend, otherPartial, otherExtendRoot, otherExtendNode]);
      queued.add(chainKey);
    }
  }

  return chained;
}

/**
 * Applies an extension at a specific location within a selector tree
 * @param selector - The original selector
 * @param location - The location where to apply the extension
 * @param extendWith - The selector to extend with
 * @returns The modified selector with extension applied
 */
export function applyExtensionAtLocation(
  selector: Selector,
  location: ExtendLocation,
  extendWith: Selector
): Selector | ExtendErrorType {
  const result = applyExtensionAtPath(selector, location.path, location.matchedNode, extendWith, location.extensionType, location, undefined);
  return result;
}

/**
 * Recursively applies an extension at a specific path.
 * @param contextSelector - When wrapping inside a compound, the compound that will contain the :is(); used for element/ID conflict validation.
 */
function applyExtensionAtPath(
  current: Selector,
  path: Array<string | number>,
  matchedNode: Selector,
  extendWith: Selector,
  extensionType: 'replace' | 'append' | 'wrap',
  location?: ExtendLocation,
  contextSelector?: Selector
): Selector | ExtendErrorType {
  // When at root compound with a contiguous slice to wrap, replace that slice with :is(matched, extendWith)
  if (path.length === 0 && isNode(current, N.CompoundSelector) && location?.contiguousCompoundRange) {
    const [start, end] = location.contiguousCompoundRange;
    const wrapped = createValidatedIsWrapperWithErrors(
      [matchedNode, extendWith],
      matchedNode,
      undefined,
      undefined
    );
    if (typeof wrapped === 'string') {
      return wrapped;
    }
    const newValue: SimpleSelector[] = [
      ...current.value.slice(0, start),
      wrapped,
      ...current.value.slice(end)
    ];
    return CompoundSelector.create(copySimpleSelectorsForPlacement(newValue)).inherit(current);
  }

  // When at root compound with non-contiguous match indices, replace those indices with :is(matched, extendWith)
  if (path.length === 0 && isNode(current, N.CompoundSelector) && location?.compoundMatchIndices?.length) {
    const indicesSet = new Set(location.compoundMatchIndices);
    const wrapped = createValidatedIsWrapperWithErrors(
      [matchedNode, extendWith],
      matchedNode,
      undefined,
      undefined
    );
    if (typeof wrapped === 'string') {
      return wrapped;
    }
    const newValue: SimpleSelector[] = [];
    let wrappedAdded = false;
    for (let i = 0; i < current.value.length; i++) {
      if (indicesSet.has(i)) {
        if (!wrappedAdded) {
          newValue.push(wrapped);
          wrappedAdded = true;
        }
      } else {
        newValue.push(current.value[i]!);
      }
    }
    return CompoundSelector.create(copySimpleSelectorsForPlacement(newValue)).inherit(current);
  }

  if (path.length === 0) {
    // We've reached the target location
    const applied = applyExtension(current, matchedNode, extendWith, extensionType, contextSelector);
    return applied;
  }

  const [nextSegment, ...remainingPath] = path;

  if (isNode(current, N.SelectorList)) {
    // For selector lists, we need special handling
    if (remainingPath.length === 0) {
      // We're targeting a specific item in the list
      if (typeof nextSegment !== 'number') {
        return current;
      }
      const index = nextSegment;
      const item = current.value[index];

      // Less parity: for targets like `:is(.a,.b):after` extending `.a`,
      // append to the `:is()` argument list (`:is(.a,.b,.x):after`) instead
      // of wrapping the single matched item (`:is(.a,.x,.b):after`).
      // Keep this extremely narrow: only when the :is() pseudo has trailing
      // components in its parent compound selector.
      if (
        extensionType === 'wrap'
        && item
        && isNode(item, N.SimpleSelector)
        && isNode(matchedNode, N.SimpleSelector)
        && isNode(current.parent, N.PseudoSelector)
        && current.parent.value.name === ':is'
        && isNode(current.parent.parent, N.CompoundSelector)
      ) {
        const parentCompound = current.parent.parent;
        const pseudoIndex = parentCompound.value.findIndex(n => n === current.parent);
        const trailing = pseudoIndex >= 0 ? parentCompound.value.slice(pseudoIndex + 1) : [];
        // Only force append-to-:is() for pseudo tails like `:is(.a,.b):after`.
        // For structural tails like `.a:is(.b,.c).d`, preserve positional wrap semantics.
        const hasPseudoOnlyTail = trailing.length > 0 && trailing.every(n => isNode(n, N.PseudoSelector));
        if (hasPseudoOnlyTail) {
          const additions = (isNode(extendWith, N.PseudoSelector) && extendWith.value.name === ':is')
            ? extractSelectorsFromIs(extendWith)
            : [extendWith];
          const newValue = [...current.value];
          let changed = false;
          for (const add of additions) {
            if (!newValue.some(s => s.valueOf() === add.valueOf())) {
              newValue.push(add);
              changed = true;
            }
          }
          return changed ? SelectorList.create(copySelectorsForPlacement(newValue)).inherit(current) : current;
        }
      }

      // For wrap, wrap the matched list item in :is(matched, extendWith) rather than replacing with extendWith
      if (extensionType === 'wrap' && item) {
        const newValue = [...current.value];
        const wrapped = applyExtension(item, matchedNode, extendWith, 'wrap', undefined);
        if (typeof wrapped === 'string') {
          return wrapped;
        }
        newValue[index] = wrapped;
        return SelectorList.create(copySelectorsForPlacement(newValue)).inherit(current);
      }
      // For extend operations (replace/append), add to the list rather than replace the matched item
      if (extensionType === 'wrap') {
        const newValue = [...current.value];
        newValue[index] = extendWith;
        return SelectorList.create(newValue).inherit(current);
      } else {
        // For extend operations (both 'replace' and 'append'), add to the list
        // If extendWith is a :is(), append its argument selectors instead of nesting.
        const additions = (isNode(extendWith, N.PseudoSelector) && extendWith.value.name === ':is')
          ? extractSelectorsFromIs(extendWith)
          : [extendWith];

        const newValue = [...current.value];
        let changed = false;
        for (const add of additions) {
          const extensionExists = newValue.some(item => item.valueOf() === add.valueOf());
          if (!extensionExists) {
            newValue.push(add);
            changed = true;
          }
        }
        const result = changed ? SelectorList.create(copySelectorsForPlacement(newValue)).inherit(current) : current;
        return result;
      }
    } else {
      // Navigate deeper into the list
      if (typeof nextSegment !== 'number') {
        return current;
      }
      const index = nextSegment;
      const newValue = [...current.value];
      const deepResult = applyExtensionAtPath(
        newValue[index]!, remainingPath, matchedNode, extendWith, extensionType, undefined, undefined
      );
      if (typeof deepResult === 'string') {
        return deepResult;
      }
      newValue[index] = deepResult;
      return SelectorList.create(copySelectorsForPlacement(newValue)).inherit(current);
    }
  }

  if (isNode(current, N.CompoundSelector)) {
    if (typeof nextSegment !== 'number') {
      return current;
    }
    const index = nextSegment;
    const newValue = [...current.value];
    // When we recurse into a component that will be wrapped, pass this compound as context for element/ID validation.
    const childContext = remainingPath.length === 0 && extensionType === 'wrap' ? current : undefined;
    const compoundChild = applyExtensionAtPath(
      newValue[index]!, remainingPath, matchedNode, extendWith, extensionType, undefined, childContext
    );
    if (typeof compoundChild === 'string') {
      return compoundChild;
    }
    if (!isNode(compoundChild, N.SimpleSelector)) {
      throw new TypeError('Expected simple selector result');
    }
    newValue[index] = compoundChild;
    return CompoundSelector.create(copySimpleSelectorsForPlacement(newValue)).inherit(current);
  }

  if (isNode(current, N.ComplexSelector)) {
    if (typeof nextSegment !== 'number') {
      return current;
    }
    const index = nextSegment;
    const newValue = [...current.value];
    const currentChild = newValue[index];
    if (!isSelectorNode(currentChild)) {
      return current;
    }
    const complexChild = applyExtensionAtPath(
      currentChild, remainingPath, matchedNode, extendWith, extensionType, undefined, undefined
    );
    if (typeof complexChild === 'string') {
      return complexChild;
    }
    if (!isComplexComponent(complexChild)) {
      throw new TypeError('Expected complex selector component result');
    }
    newValue[index] = complexChild;
    return ComplexSelector.create(copyComplexComponentsForPlacement(newValue)).inherit(current);
  }

  if (isNode(current, N.PseudoSelector) && nextSegment === 'arg') {
    const arg = expectSelector(current.value.arg);
    // Special handling for pseudo-selector arguments
    if (remainingPath.length === 0) {
      // Direct match in the argument - create a list or extend existing list
      let newArg: Selector;
      if (isNode(arg, N.SelectorList)) {
        const newSelectors = [...arg.value, extendWith];
        newArg = SelectorList.create(newSelectors).inherit(arg);
      } else {
        newArg = SelectorList.create([arg as Selector, extendWith]);
      }

      const processedArg = createProcessedSelector(newArg as Selector, true);
      if (typeof processedArg === 'string') {
        return processedArg;
      }
      const normalizedArg = isArray(processedArg) ? SelectorList.create(processedArg as Selector[]) : processedArg;
      const result = PseudoSelector.create({
        name: current.value.name,
        arg: normalizedArg as Selector
      }).inherit(current);
      return result;
    } else {
      // Navigate deeper into the argument
      const newArg = applyExtensionAtPath(arg, remainingPath, matchedNode, extendWith, extensionType, undefined, undefined);
      if (typeof newArg === 'string') {
        return newArg;
      }
      const processedArg = createProcessedSelector(newArg as Selector, true);
      if (typeof processedArg === 'string') {
        return processedArg;
      }
      const normalizedArg = isArray(processedArg) ? SelectorList.create(processedArg as Selector[]) : processedArg;
      const nestedResult = PseudoSelector.create({
        name: current.value.name,
        arg: normalizedArg as Selector
      }).inherit(current);
      return nestedResult;
    }
  }

  throw new Error(`Unable to apply extension at path: ${path.join('.')}`);
}

/**
 * Applies the actual extension based on the extension type.
 * @param contextSelector - When wrapping inside a compound, the compound that will contain the :is(); used for element/ID conflict validation.
 */
function applyExtension(
  current: Selector,
  matchedNode: Selector,
  extendWith: Selector,
  extensionType: 'replace' | 'append' | 'wrap',
  contextSelector?: Selector
): Selector | ExtendErrorType {
  switch (extensionType) {
    case 'replace':
      return extendWith;

    case 'append':
      // For append within a selector list context, we add to the current list
      if (isNode(current, N.SelectorList)) {
        const newSelectors = copySelectorsForPlacement([...current.value, extendWith]);
        return SelectorList.create(newSelectors).inherit(current);
      } else {
        // For append at the selector level, create a list with the current and extension
        return SelectorList.create(copySelectorsForPlacement([current, extendWith]));
      }

    case 'wrap':
      if (isNode(current, N.PseudoSelector) && current.value.name === ':is' && current.value.arg) {
        const existing = extractSelectorsFromIs(current);
        const additions = extractSelectorsFromIs(extendWith);
        const merged = [...existing];
        for (const add of additions) {
          if (!merged.some(s => s.valueOf() === add.valueOf())) {
            merged.push(add);
          }
        }
        return createValidatedIsWrapperWithErrors(
          merged,
          current,
          contextSelector,
          undefined
        );
      }
      // Same rule as everywhere: extend = append extendWith at end of list. Reuse createExtendedSelectorList
      // so order (extendOrderMap) and flattening apply; then wrap that list in :is().
      // Works for both single selector (current → [current, extendWith]) and already-extended :is()
      // (e.g. :is(.clearfix, .foo) + .bar → :is(.clearfix, .foo, .bar)) without branching on :is().
      const wrapExisting = extractSelectorsFromIs(current);
      const wrapOrdered = createExtendedSelectorList([...wrapExisting, extendWith], current);
      if (typeof wrapOrdered === 'string') {
        return wrapOrdered;
      }
      const wrapSelectors = wrapOrdered.value;
      return createValidatedIsWrapperWithErrors(
        wrapSelectors,
        current,
        contextSelector,
        undefined
      );

    default:
      throw new Error(`Unknown extension type: ${extensionType}`);
  }
}
