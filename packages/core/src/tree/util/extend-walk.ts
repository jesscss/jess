/**
 * Walk-and-consume extend algorithm.
 *
 * Single-pass recursive descent that finds matches and applies transformations
 * in one traversal — no intermediate location objects, no flattening, no expansion.
 *
 * Each `:is()` is treated as an "or" at that position: walk into its alternatives
 * to check for a match, but never expand them into combinations.
 *
 * Phase 1: SimpleSelector find targets (most common case in real stylesheets).
 * Phase 2: CompoundSelector find targets (subset matching with remainders).
 */

import type { Selector } from '../selector.js';
import type { SimpleSelector } from '../selector-simple.js';
import { SelectorList } from '../selector-list.js';
import { ComplexSelector } from '../selector-complex.js';
import { CompoundSelector } from '../selector-compound.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { Ampersand } from '../ampersand.js';
import { isNode } from './is-node.js';
import { F_EXTENDED, F_EXTEND_TARGET } from '../node.js';
import { compoundComponentMatches } from './selector-match-core.js';
import { createProcessedSelector } from './extend.js';

const { isArray } = Array;

/**
 * Checks whether `node` is equivalent to `find` as a *complete* selector
 * (not as a component within a larger selector).
 *
 * This is NOT the same as `componentsMatch()`, which returns true when
 * a SimpleSelector appears inside a CompoundSelector. Here we require
 * whole-selector equivalence:
 *   .a === .a  → true
 *   .a.b === .a → false (`.a` is a component, not the whole thing)
 *   .a.b === .b.a → true (same compound, different order)
 *
 * Phase 1: only SimpleSelector find, so valueOf() is sufficient.
 * Phase 2+: will add structural equivalence for compound/complex finds.
 */
function isWholeNodeMatch(node: Selector, find: Selector): boolean {
  if (isNode(node, 'SelectorList') && !isNode(find, 'SelectorList')) {
    return false;
  }
  if (isNode(node, 'ComplexSelector') && !isNode(find, 'ComplexSelector')) {
    return false;
  }
  // Compound-to-compound: order-independent equivalence
  if (isNode(node, 'CompoundSelector') && isNode(find, 'CompoundSelector')) {
    return areCompoundsEquivalent(node, find);
  }
  if (isNode(node, 'CompoundSelector') && !isNode(find, 'CompoundSelector')) {
    return false;
  }
  return node.valueOf() === find.valueOf();
}

/**
 * Order-independent compound equivalence: every component in `a` has
 * a matching component in `b`, and vice versa.
 */
function areCompoundsEquivalent(a: CompoundSelector, b: CompoundSelector): boolean {
  if (a.value.length !== b.value.length) {
    return false;
  }
  if (a.valueOf() === b.valueOf()) {
    return true;
  }
  // Order-independent: every component in a matches one in b (by valueOf)
  const used = new Uint8Array(b.value.length);
  for (const aComp of a.value) {
    const aVal = (aComp as Selector).valueOf();
    let found = false;
    for (let j = 0; j < b.value.length; j++) {
      if (!used[j] && (b.value[j] as Selector).valueOf() === aVal) {
        used[j] = 1;
        found = true;
        break;
      }
    }
    if (!found) {
      return false;
    }
  }
  return true;
}

// ─────────────────────────────────────────────────
// Context carried through the walk
// ─────────────────────────────────────────────────

interface WalkContext {
  /** True when we're at the topmost call (not nested inside a container) */
  isRoot: boolean;
  /** Parent node type, or null for root */
  parentType: 'SelectorList' | 'ComplexSelector' | 'CompoundSelector' | 'PseudoSelector' | null;
  /** Number of sibling components before this node in the parent container */
  hasContentBefore: boolean;
  /** Number of sibling components after this node in the parent container */
  hasContentAfter: boolean;
}

const ROOT_CTX: WalkContext = {
  isRoot: true,
  parentType: null,
  hasContentBefore: false,
  hasContentAfter: false
};

// ─────────────────────────────────────────────────
// Quick eligibility check
// ─────────────────────────────────────────────────

/**
 * Returns true when the walk-and-consume path can handle this (target, find) pair.
 *
 * Phase 1: SimpleSelector find only, no ampersand in target,
 * no element tags or IDs in find (to avoid needing conflict validation).
 */
export function canUseWalkAndConsume(target: Selector, find: Selector): boolean {
  if (!isNode(find, 'SimpleSelector') && !isNode(find, 'CompoundSelector')) {
    return false;
  }
  if (containsAmpersand(target)) {
    return false;
  }
  return true;
}

/**
 * Whether the extendWith selector could cause element/ID conflicts
 * when wrapping in :is(). If true, fall back to legacy path for validation.
 */
export function extendWithNeedsConflictValidation(extendWith: Selector): boolean {
  if (isNode(extendWith, 'CompoundSelector')) {
    return (extendWith as CompoundSelector).value.some(
      (child: any) => child.isTag || child.isId
    );
  }
  if ((extendWith as any).isTag || (extendWith as any).isId) {
    return true;
  }
  return false;
}

function containsAmpersand(sel: Selector): boolean {
  if (sel instanceof Ampersand) {
    return true;
  }
  if (isNode(sel, 'SelectorList') || isNode(sel, 'CompoundSelector') || isNode(sel, 'ComplexSelector')) {
    return (sel as any).value.some((child: Selector) => containsAmpersand(child));
  }
  if (isNode(sel, 'PseudoSelector') && sel.value.arg && (sel.value.arg as any).isSelector) {
    return containsAmpersand(sel.value.arg as Selector);
  }
  return false;
}

// ─────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────

/**
 * Walk-and-consume extend: single-pass recursive descent.
 *
 * Returns the extended selector, or the original if no match was found.
 *
 * @param target    - The selector to search within and extend
 * @param find      - The SimpleSelector to match
 * @param extendWith - The selector to add as an alternative
 * @param partial   - Whether to use partial (`:extend(X all)`) or full (`:extend(X)`) mode
 */
export function walkAndExtend(
  target: Selector,
  find: Selector,
  extendWith: Selector,
  partial: boolean
): Selector {
  return walkNode(target, find, extendWith, partial, ROOT_CTX);
}

// ─────────────────────────────────────────────────
// Recursive walker
// ─────────────────────────────────────────────────

function walkNode(
  node: Selector,
  find: Selector,
  extendWith: Selector,
  partial: boolean,
  ctx: WalkContext
): Selector {
  // 1. Whole-node equivalence check.
  // Phase 1 only handles SimpleSelector find, so valueOf() is safe here
  // (SimpleSelectors have no internal structure that could reorder).
  // For compound/complex find targets (Phase 2+), we'll need structural
  // equivalence (areCompoundSelectorsEquivalent, areComplexSelectorsEquivalent).
  if (isWholeNodeMatch(node, find)) {
    return applyWholeMatch(node, find, extendWith, partial, ctx);
  }

  // 2. Recurse into containers
  if (isNode(node, 'SelectorList')) {
    return walkSelectorList(node, find, extendWith, partial, ctx);
  }
  if (isNode(node, 'ComplexSelector')) {
    return walkComplexSelector(node, find, extendWith, partial, ctx);
  }
  if (isNode(node, 'CompoundSelector')) {
    return walkCompoundSelector(node, find, extendWith, partial, ctx);
  }
  if (isNode(node, 'PseudoSelector') && node.value.arg && (node.value.arg as any).isSelector) {
    return walkPseudoSelector(node, find, extendWith, partial, ctx);
  }

  // 3. No match
  return node;
}

// ─────────────────────────────────────────────────
// Whole-match transformation
// ─────────────────────────────────────────────────

function applyWholeMatch(
  node: Selector,
  find: Selector,
  extendWith: Selector,
  partial: boolean,
  ctx: WalkContext
): Selector {
  const findVal = find.valueOf();
  const extendVal = extendWith.valueOf();

  // Self-extend guard
  if (findVal === extendVal) {
    return node;
  }

  if (!partial) {
    if (ctx.parentType === 'CompoundSelector' || ctx.parentType === 'ComplexSelector') {
      return node;
    }
    return makeList(node, extendWith);
  }

  if (ctx.parentType === 'CompoundSelector' || ctx.parentType === 'ComplexSelector') {
    return wrapInIs(node, extendWith);
  }

  // Root or SelectorList item: create SelectorList
  return makeList(node, extendWith);
}

// ─────────────────────────────────────────────────
// Container walkers
// ─────────────────────────────────────────────────

function walkSelectorList(
  list: SelectorList,
  find: Selector,
  extendWith: Selector,
  partial: boolean,
  _ctx: WalkContext
): Selector {
  const items = list.value;
  const originals: Selector[] = [];
  const appended: Selector[] = [];
  let anyChanged = false;

  for (let i = 0; i < items.length; i++) {
    const item = items[i]! as Selector;
    const childCtx: WalkContext = {
      isRoot: false,
      parentType: 'SelectorList',
      hasContentBefore: i > 0,
      hasContentAfter: i < items.length - 1
    };

    const extended = walkNode(item, find, extendWith, partial, childCtx);

    if (extended === item) {
      // No match in this item — keep as-is
      originals.push(item);
    } else if (isNode(extended, 'SelectorList')) {
      // walkNode returned a SelectorList (whole match → list expansion)
      // First item goes in place, rest are appended at end
      const extItems = extended.value as Selector[];
      const first = extItems[0]!;
      first.addFlag(F_EXTENDED);
      originals.push(first);
      for (let j = 1; j < extItems.length; j++) {
        const ext = extItems[j]! as Selector;
        ext.addFlag(F_EXTENDED);
        appended.push(ext);
      }
      anyChanged = true;
    } else {
      // walkNode returned a transformed selector (e.g., :is() wrapper)
      extended.addFlag(F_EXTENDED);
      originals.push(extended);
      anyChanged = true;
    }
  }

  if (!anyChanged) {
    return list;
  }

  const allSelectors = [...originals, ...appended];
  const processed = createProcessedSelector(allSelectors, true);
  const processedArray = isArray(processed) ? processed : [processed];
  // Avoid self-parenting: if list is in processedArray, clone it
  const safe = processedArray.map(s => (s === list ? s.clone(true) : s));
  return SelectorList.create(safe).inherit(list) as Selector;
}

function walkComplexSelector(
  complex: ComplexSelector,
  find: Selector,
  extendWith: Selector,
  partial: boolean,
  _ctx: WalkContext
): Selector {
  const components = complex.value;
  let anyChanged = false;
  const newComponents = [...components];

  for (let i = 0; i < components.length; i++) {
    const comp = components[i]!;
    if (isNode(comp, 'Combinator')) {
      continue;
    }

    const childCtx: WalkContext = {
      isRoot: false,
      parentType: 'ComplexSelector',
      hasContentBefore: i > 0,
      hasContentAfter: i < components.length - 1
    };

    const extended = walkNode(comp as Selector, find, extendWith, partial, childCtx);
    if (extended !== comp) {
      newComponents[i] = extended as any;
      anyChanged = true;
    }
  }

  if (!anyChanged) {
    return complex;
  }
  return ComplexSelector.create(newComponents).inherit(complex) as Selector;
}

function walkCompoundSelector(
  compound: CompoundSelector,
  find: Selector,
  extendWith: Selector,
  partial: boolean,
  _ctx: WalkContext
): Selector {
  // Phase 2: compound find subset matching
  if (partial && isNode(find, 'CompoundSelector')) {
    return walkCompoundSubsetMatch(compound, find as CompoundSelector, extendWith);
  }

  // Phase 1: walk individual components (SimpleSelector find)
  const components = compound.value;
  let anyChanged = false;
  const newComponents = [...components];

  for (let i = 0; i < components.length; i++) {
    const comp = components[i]!;
    const childCtx: WalkContext = {
      isRoot: false,
      parentType: 'CompoundSelector',
      hasContentBefore: i > 0,
      hasContentAfter: i < components.length - 1
    };

    const extended = walkNode(comp as Selector, find, extendWith, partial, childCtx);
    if (extended !== comp) {
      newComponents[i] = extended as any;
      anyChanged = true;
    }
  }

  if (!anyChanged) {
    return compound;
  }
  return CompoundSelector.create(newComponents).inherit(compound) as Selector;
}

/**
 * Compound subset match: consume find's components from target's components.
 * If all find components are consumed, the remainder + :is(matched, extendWith)
 * forms the result.
 *
 * Example: target `.a.b.c`, find `.a.b`, extendWith `.q`
 *   → consumed: [.a, .b], remainder: [.c]
 *   → result: `:is(.a.b, .q).c`
 */
function walkCompoundSubsetMatch(
  compound: CompoundSelector,
  find: CompoundSelector,
  extendWith: Selector
): Selector {
  const targetComps = compound.value;
  const findComps = find.value;

  // Try to consume find components in order (subsequence match)
  const matchIndices: number[] = [];
  let findIdx = 0;
  for (let i = 0; i < targetComps.length && findIdx < findComps.length; i++) {
    if (compoundComponentMatches(findComps[findIdx]! as Selector, targetComps[i]! as Selector)) {
      matchIndices.push(i);
      findIdx++;
    }
  }

  if (matchIndices.length !== findComps.length) {
    return compound; // Not all find components consumed → no match
  }

  // Build the matched compound (the find selector as matched)
  // and the remainder (target components not consumed)
  const matchedSet = new Set(matchIndices);
  const remainders: SimpleSelector[] = [];
  for (let i = 0; i < targetComps.length; i++) {
    if (!matchedSet.has(i)) {
      remainders.push(targetComps[i]!);
    }
  }

  // Create :is(find, extendWith) + remainders
  const isWrapper = wrapInIs(find as Selector, extendWith);
  const newComponents: SimpleSelector[] = [isWrapper as unknown as SimpleSelector, ...remainders];
  const result = CompoundSelector.create(newComponents).inherit(compound);
  result.addFlag(F_EXTENDED);
  return result as Selector;
}

function walkPseudoSelector(
  pseudo: PseudoSelector,
  find: Selector,
  extendWith: Selector,
  partial: boolean,
  ctx: WalkContext
): Selector {
  const arg = pseudo.value.arg as Selector;

  // For :is() pseudo-selectors, check if any alternative matches
  // This is the key optimization: no expansion, just walk alternatives
  const childCtx: WalkContext = {
    isRoot: false,
    parentType: 'PseudoSelector',
    hasContentBefore: false,
    hasContentAfter: false
  };

  const extendedArg = walkNode(arg, find, extendWith, partial, childCtx);
  if (extendedArg === arg) {
    return pseudo;
  }

  // In full mode, if we're inside a compound and this :is() has siblings,
  // don't extend (partial match of outer compound)
  if (!partial && (ctx.hasContentBefore || ctx.hasContentAfter)) {
    return pseudo;
  }

  const result = PseudoSelector.create({
    name: pseudo.value.name,
    arg: extendedArg as any
  }).inherit(pseudo);
  result.generated = pseudo.generated;
  return result as Selector;
}

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────

function makeList(original: Selector, extendWith: Selector): Selector {
  const a = original.clone(true) as Selector;
  a.addFlag(F_EXTENDED);

  // If extendWith is :is(), extract its arguments to avoid nesting :is() inside a SelectorList.
  // e.g., .foo + :is(.ext3, .ext4) → .foo, .ext3, .ext4 (not .foo, :is(.ext3, .ext4))
  const extendItems = extractIsArgs(extendWith);
  const items: Selector[] = [a];
  for (const item of extendItems) {
    const b = item.clone(true) as Selector;
    b.addFlag(F_EXTENDED);
    items.push(b);
  }

  const processed = createProcessedSelector(items, true);
  const processedArray = isArray(processed) ? processed : [processed];
  return SelectorList.create(processedArray).inherit(original) as Selector;
}

/** Extract selectors from :is() argument, or return [selector] if not :is(). */
function extractIsArgs(selector: Selector): Selector[] {
  if (isNode(selector, 'PseudoSelector') && selector.value.name === ':is' && selector.value.arg) {
    const arg = selector.value.arg;
    if (isNode(arg, 'SelectorList')) {
      return (arg as SelectorList).value as Selector[];
    }
    return [arg as Selector];
  }
  return [selector];
}

function wrapInIs(matched: Selector, extendWith: Selector): Selector {
  const a = matched.copy(true) as Selector;
  a.addFlag(F_EXTEND_TARGET);

  // Extract :is() arguments from extendWith to avoid nesting :is() inside :is()
  const extendItems = extractIsArgs(extendWith);
  const extendCopies = extendItems.map((item) => {
    const c = item.copy(true) as Selector;
    c.addFlag(F_EXTENDED);
    return c;
  });

  // If matched is already :is(), merge into its argument list
  if (isNode(matched, 'PseudoSelector') && matched.value.name === ':is' && matched.value.arg) {
    const existing = isNode(matched.value.arg, 'SelectorList')
      ? (matched.value.arg as SelectorList).value as Selector[]
      : [matched.value.arg as Selector];

    // Dedup
    const existingVals = new Set(existing.map(s => s.valueOf()));
    const newItems = extendCopies.filter(c => !existingVals.has(c.valueOf()));
    if (newItems.length === 0) {
      return matched; // All already in the list
    }

    const merged = [...existing.map(s => s.copy(true) as Selector), ...newItems];
    const list = SelectorList.create(merged);
    const result = PseudoSelector.create({ name: ':is', arg: list }).inherit(matched);
    result.generated = true;
    return result as Selector;
  }

  // Create new :is(matched, extendWith...)
  const list = SelectorList.create([a, ...extendCopies]);
  const result = PseudoSelector.create({ name: ':is', arg: list }).inherit(matched);
  result.generated = true;
  return result as Selector;
}

// ─────────────────────────────────────────────────
// Dry-run: check whether an extend would change the selector
// ─────────────────────────────────────────────────

/**
 * Checks whether `extendSelector(target, find, extendWith, partial)` would
 * produce a different selector — WITHOUT constructing the result.
 *
 * Returns early on first match → O(depth) instead of O(full-traversal + AST-construction).
 *
 * This is designed to replace the expensive diagnostic calls in processExtends:
 *   `applyExtendsToSelector(ownSelector, [instruction]).valueOf() !== ownSelector.valueOf()`
 */
export function wouldExtendChange(
  target: Selector,
  find: Selector,
  extendWith: Selector,
  partial: boolean
): boolean {
  return wouldMatchNode(target, find, extendWith, partial, ROOT_CTX);
}

function wouldMatchNode(
  node: Selector,
  find: Selector,
  extendWith: Selector,
  partial: boolean,
  ctx: WalkContext
): boolean {
  // Self-extend never changes
  if (find.valueOf() === extendWith.valueOf()) {
    return false;
  }

  // 1. Whole-node equivalence — would this produce a change?
  if (isWholeNodeMatch(node, find)) {
    if (!partial) {
      // Full mode: only match at root/SelectorList level
      if (ctx.parentType === 'CompoundSelector' || ctx.parentType === 'ComplexSelector') {
        return false;
      }
    }
    // Match found, would change
    return true;
  }

  // 2. Recurse into containers (early return on first hit)
  if (isNode(node, 'SelectorList')) {
    return (node as SelectorList).value.some((item, i) =>
      wouldMatchNode(item as Selector, find, extendWith, partial, {
        isRoot: false,
        parentType: 'SelectorList',
        hasContentBefore: i > 0,
        hasContentAfter: i < (node as SelectorList).value.length - 1
      })
    );
  }
  if (isNode(node, 'ComplexSelector')) {
    return (node as ComplexSelector).value.some((comp, i) => {
      if (isNode(comp, 'Combinator')) {
        return false;
      }
      return wouldMatchNode(comp as Selector, find, extendWith, partial, {
        isRoot: false,
        parentType: 'ComplexSelector',
        hasContentBefore: i > 0,
        hasContentAfter: i < (node as ComplexSelector).value.length - 1
      });
    });
  }
  if (isNode(node, 'CompoundSelector')) {
    // Phase 2: compound subset matching in partial mode
    if (partial && isNode(find, 'CompoundSelector')) {
      return wouldCompoundSubsetMatch(node as CompoundSelector, find as CompoundSelector);
    }
    return (node as CompoundSelector).value.some((comp, i) =>
      wouldMatchNode(comp as Selector, find, extendWith, partial, {
        isRoot: false,
        parentType: 'CompoundSelector',
        hasContentBefore: i > 0,
        hasContentAfter: i < (node as CompoundSelector).value.length - 1
      })
    );
  }
  if (isNode(node, 'PseudoSelector') && (node as PseudoSelector).value.arg && ((node as PseudoSelector).value.arg as any).isSelector) {
    const pseudo = node as PseudoSelector;
    if (!partial && (ctx.hasContentBefore || ctx.hasContentAfter)) {
      return false;
    }
    return wouldMatchNode(pseudo.value.arg as Selector, find, extendWith, partial, {
      isRoot: false,
      parentType: 'PseudoSelector',
      hasContentBefore: false,
      hasContentAfter: false
    });
  }

  return false;
}

function wouldCompoundSubsetMatch(target: CompoundSelector, find: CompoundSelector): boolean {
  const targetComps = target.value;
  const findComps = find.value;
  let findIdx = 0;
  for (let i = 0; i < targetComps.length && findIdx < findComps.length; i++) {
    if (compoundComponentMatches(findComps[findIdx]! as Selector, targetComps[i]! as Selector)) {
      findIdx++;
    }
  }
  return findIdx === findComps.length;
}
