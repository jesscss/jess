/**
 * Walk-and-consume extend algorithm.
 *
 * The find selector decomposes into *positions* — each position is a set of
 * simple selectors (AND). Positions are separated by combinators. The walk
 * progresses through the target tree, consuming find positions:
 *
 *   - SimpleSelector find  → 1 position, 1 simple
 *   - CompoundSelector find → 1 position, N simples
 *   - ComplexSelector find  → M positions separated by combinators
 *
 * At each target position:
 *   - full match  → consume ALL of a compound
 *   - partial     → consume any subset of a compound
 *   - :is() / SelectorList → OR (try each alternative)
 *
 * ## :is() as AND branch
 *
 * When :is() appears as a component in a compound selector, it adds an AND
 * branch. The *last* selector in each :is() alternative occupies the same
 * compound position as its sibling components. Everything before the last
 * selector is an ancestral prefix — a separate path.
 *
 *   .a:is(.x > .y).b
 *     → subject has .a, .b, .y (all at one position, ANDed)
 *     → AND is child of .x (ancestral branch from :is())
 *
 * This is equivalent to .x > .a.y.b when there's only one branch. But when
 * combined with outer complex context, the branches can't be flattened:
 *
 *   div + .a:is(.x > .y).b
 *     → subject has .a, .b, .y
 *     → AND follows div     (outer complex path)
 *     → AND is child of .x  (:is() branch path)
 *
 * Walking handles both paths naturally. Flattening cannot represent this.
 *
 * ## Reading back-to-front
 *
 * Selectors read back-to-front: rightmost = subject element, leftward =
 * ancestors/preceding. For :is() alternatives that are complex selectors,
 * the last element is at the current position; the rest is a branch going up.
 *
 * ComplexSelector find support is currently used for diagnostics only
 * (wouldExtendChange); the extend application falls through to legacy
 * due to createProcessedSelector differences.
 */

import type { Selector } from '../selector.js';
import type { SimpleSelector } from '../selector-simple.js';
import { SelectorList } from '../selector-list.js';
import { ComplexSelector } from '../selector-complex.js';
import { CompoundSelector } from '../selector-compound.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { Ampersand } from '../ampersand.js';
import { Combinator } from '../combinator.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { F_EXTENDED, F_EXTEND_TARGET } from '../node.js';
import { createProcessedSelector } from './extend.js';

const { isArray } = Array;

// ─────────────────────────────────────────────────
// Find decomposition
// ─────────────────────────────────────────────────

/**
 * A find selector decomposed into positions.
 * Each position is a set of simple selectors that must ALL match (AND).
 * Positions are separated by combinators.
 */
interface FindSpec {
  /** Simples at each position (AND within a position) */
  positions: Selector[][];
  /** Combinators between positions (length = positions.length - 1) */
  combinators: string[];
  /** Original find selector (for valueOf comparisons) */
  original: Selector;
}

function decomposeFind(find: Selector): FindSpec {
  if (isNode(find, N.ComplexSelector)) {
    const positions: Selector[][] = [];
    const combinators: string[] = [];
    for (const comp of (find as ComplexSelector).value) {
      if (isNode(comp, N.Combinator)) {
        combinators.push((comp as Combinator).value);
      } else if (isNode(comp, N.CompoundSelector)) {
        positions.push([...(comp as CompoundSelector).value as Selector[]]);
      } else {
        positions.push([comp as Selector]);
      }
    }
    return { positions, combinators, original: find };
  }
  if (isNode(find, N.CompoundSelector)) {
    return {
      positions: [[...(find as CompoundSelector).value as Selector[]]],
      combinators: [],
      original: find
    };
  }
  // SimpleSelector or anything else: single position, single simple
  return { positions: [[find]], combinators: [], original: find };
}

/** Whether the find spans multiple positions (has combinators) */
function isMultiPosition(spec: FindSpec): boolean {
  return spec.positions.length > 1;
}

/** Whether the current position has multiple simples (compound) */
function isMultiSimple(spec: FindSpec): boolean {
  return spec.positions.length === 1 && spec.positions[0]!.length > 1;
}

// ─────────────────────────────────────────────────
// Equivalence checks
// ─────────────────────────────────────────────────

function isWholeNodeMatch(node: Selector, spec: FindSpec): boolean {
  const find = spec.original;
  if (isNode(node, N.SelectorList) && !isNode(find, N.SelectorList)) {
    return false;
  }
  if (isNode(node, N.ComplexSelector) && isNode(find, N.ComplexSelector)) {
    return areComplexEquivalent(node as ComplexSelector, find as ComplexSelector);
  }
  if (isNode(node, N.ComplexSelector) && !isNode(find, N.ComplexSelector)) {
    return false;
  }
  if (isNode(node, N.CompoundSelector) && isNode(find, N.CompoundSelector)) {
    return areCompoundsEquivalent(node as CompoundSelector, find as CompoundSelector);
  }
  if (isNode(node, N.CompoundSelector) && !isNode(find, N.CompoundSelector)) {
    return false;
  }
  return node.valueOf() === find.valueOf();
}

function areCompoundsEquivalent(a: CompoundSelector, b: CompoundSelector): boolean {
  if (a.value.length !== b.value.length) {
    return false;
  }
  if (a.valueOf() === b.valueOf()) {
    return true;
  }
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

function areComplexEquivalent(a: ComplexSelector, b: ComplexSelector): boolean {
  if (a.value.length !== b.value.length) {
    return false;
  }
  if (a.valueOf() === b.valueOf()) {
    return true;
  }
  for (let i = 0; i < a.value.length; i++) {
    const ac = a.value[i]!;
    const bc = b.value[i]!;
    if (isNode(ac, N.Combinator) !== isNode(bc, N.Combinator)) {
      return false;
    }
    if (isNode(ac, N.Combinator)) {
      if ((ac as Combinator).value !== (bc as Combinator).value) {
        return false;
      }
      continue;
    }
    if (isNode(ac, N.CompoundSelector) && isNode(bc, N.CompoundSelector)) {
      if (!areCompoundsEquivalent(ac as CompoundSelector, bc as CompoundSelector)) {
        return false;
      }
    } else if ((ac as Selector).valueOf() !== (bc as Selector).valueOf()) {
      return false;
    }
  }
  return true;
}

// ─────────────────────────────────────────────────
// Position matching
// ─────────────────────────────────────────────────

/**
 * Extract what's at the current position from a selector.
 *
 * For a ComplexSelector, the last non-combinator component is at the current
 * position; everything before it is an ancestral prefix. For anything else,
 * the entire selector is at the current position.
 *
 *   .a          → .a
 *   .a.b        → .a.b
 *   .x > .y     → .y     (the .x > prefix is an ancestral branch)
 *   .x > .y.z   → .y.z
 */
function tailOf(sel: Selector): Selector {
  if (isNode(sel, N.ComplexSelector)) {
    const comps = (sel as ComplexSelector).value;
    for (let i = comps.length - 1; i >= 0; i--) {
      if (!isNode(comps[i], N.Combinator)) {
        return comps[i] as Selector;
      }
    }
  }
  return sel;
}

/**
 * Does `find` match `target` at this compound position?
 *
 * Like compoundComponentMatches, but tail-aware: when an :is() alternative
 * is a ComplexSelector, only its tail (last non-combinator) is at the
 * current position.
 *
 *   .y  vs  :is(.x > .y)  → true (.y is the tail of .x > .y)
 *   .x  vs  :is(.x > .y)  → false (.x is in the ancestral prefix)
 */
function positionSimpleMatches(find: Selector, target: Selector): boolean {
  if (find.valueOf() === target.valueOf()) {
    return true;
  }

  // find is :is() → OR: try each alternative's tail
  if (isNode(find, N.PseudoSelector) && find.value.name === ':is' && find.value.arg) {
    const arg = find.value.arg as Selector;
    if (isNode(arg, N.SelectorList)) {
      return (arg as SelectorList).value.some(
        (alt: Selector) => positionSimpleMatches(tailOf(alt), target)
      );
    }
    return positionSimpleMatches(tailOf(arg), target);
  }

  // target is :is() → OR: try each alternative's tail
  if (isNode(target, N.PseudoSelector) && target.value.name === ':is' && target.value.arg) {
    const arg = target.value.arg as Selector;
    if (isNode(arg, N.SelectorList)) {
      return (arg as SelectorList).value.some(
        (alt: Selector) => positionSimpleMatches(find, tailOf(alt))
      );
    }
    return positionSimpleMatches(find, tailOf(arg));
  }

  return false;
}

/**
 * Does `targetComp` match `findComp` at this position?
 * Handles :is() as OR alternatives (tail-aware) and compound equivalence.
 */
function positionComponentMatches(findComp: Selector, targetComp: Selector): boolean {
  if (isNode(findComp, N.CompoundSelector) && isNode(targetComp, N.CompoundSelector)) {
    return areCompoundsEquivalent(findComp as CompoundSelector, targetComp as CompoundSelector);
  }
  return positionSimpleMatches(findComp, targetComp);
}

/**
 * Try to match find positions as a contiguous subsequence in target
 * components. Returns the start index or -1.
 */
function findSubsequence(
  targetComps: any[],
  spec: FindSpec
): number {
  // Reconstruct find components (positions interleaved with combinators)
  const findComps: any[] = [];
  for (let p = 0; p < spec.positions.length; p++) {
    if (p > 0) {
      findComps.push({ type: 'Combinator', value: spec.combinators[p - 1] });
    }
    const simples = spec.positions[p]!;
    if (simples.length === 1) {
      findComps.push(simples[0]);
    } else {
      findComps.push({ type: 'CompoundSelector', value: simples, _isVirtual: true, simples });
    }
  }

  const maxStart = targetComps.length - findComps.length;
  for (let start = 0; start <= maxStart; start++) {
    let matches = true;
    for (let j = 0; j < findComps.length; j++) {
      const tc = targetComps[start + j]!;
      const fc = findComps[j]!;
      if (fc.type === 'Combinator') {
        if (!isNode(tc, N.Combinator) || (tc as Combinator).value !== fc.value) {
          matches = false;
          break;
        }
      } else {
        if (isNode(tc, N.Combinator)) {
          matches = false;
          break;
        }
        if (fc._isVirtual) {
          // Virtual compound: check if all simples match the target component
          if (isNode(tc, N.CompoundSelector)) {
            if (!areCompoundsEquivalent(
              CompoundSelector.create(fc.simples) as CompoundSelector,
              tc as CompoundSelector
            )) {
              matches = false;
              break;
            }
          } else {
            matches = false;
            break;
          }
        } else if (!positionComponentMatches(fc as Selector, tc as Selector)) {
          matches = false;
          break;
        }
      }
    }
    if (matches) {
      return start;
    }
  }
  return -1;
}

/**
 * Try to consume find simples from a compound's components (subsequence match).
 * Returns matched indices or null if not all consumed.
 */
function consumeSimples(
  targetComps: any[],
  findSimples: Selector[]
): number[] | null {
  const matchIndices: number[] = [];
  let findIdx = 0;
  for (let i = 0; i < targetComps.length && findIdx < findSimples.length; i++) {
    if (positionSimpleMatches(findSimples[findIdx]!, targetComps[i]! as Selector)) {
      matchIndices.push(i);
      findIdx++;
    }
  }
  return matchIndices.length === findSimples.length ? matchIndices : null;
}

// ─────────────────────────────────────────────────
// Walk context
// ─────────────────────────────────────────────────

interface WalkContext {
  isRoot: boolean;
  parentType: 'SelectorList' | 'ComplexSelector' | 'CompoundSelector' | 'PseudoSelector' | null;
  hasContentBefore: boolean;
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

export function canUseWalkAndConsume(target: Selector, find: Selector, hasParent?: boolean): boolean {
  if (
    !isNode(find, N.SimpleSelector)
    && !isNode(find, N.CompoundSelector)
    && !isNode(find, N.ComplexSelector)
  ) {
    return false;
  }
  // When a parent is provided, ampersands in the target are treated as
  // the implicit parent — the cursor continues into the parent selector.
  if (!hasParent && containsAmpersand(target)) {
    return false;
  }
  return true;
}

export function extendWithNeedsConflictValidation(extendWith: Selector): boolean {
  if (isNode(extendWith, N.CompoundSelector)) {
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
  if (isNode(sel, N.SelectorList) || isNode(sel, N.CompoundSelector) || isNode(sel, N.ComplexSelector)) {
    return (sel as any).value.some((child: Selector) => containsAmpersand(child));
  }
  if (isNode(sel, N.PseudoSelector) && sel.value.arg && (sel.value.arg as any).isSelector) {
    return containsAmpersand(sel.value.arg as Selector);
  }
  return false;
}

// ─────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────

export function walkAndExtend(
  target: Selector,
  find: Selector,
  extendWith: Selector,
  partial: boolean
): Selector {
  const spec = decomposeFind(find);
  return walkNode(target, spec, extendWith, partial, ROOT_CTX);
}

// ─────────────────────────────────────────────────
// Recursive walk
// ─────────────────────────────────────────────────

function walkNode(
  node: Selector,
  spec: FindSpec,
  extendWith: Selector,
  partial: boolean,
  ctx: WalkContext
): Selector {
  // 1. Whole-node equivalence
  if (isWholeNodeMatch(node, spec)) {
    return applyWholeMatch(node, spec, extendWith, partial, ctx);
  }

  // 2. Recurse into containers
  if (isNode(node, N.SelectorList)) {
    return walkSelectorList(node, spec, extendWith, partial, ctx);
  }
  if (isNode(node, N.ComplexSelector)) {
    return walkComplexSelector(node, spec, extendWith, partial, ctx);
  }
  if (isNode(node, N.CompoundSelector)) {
    return walkCompoundSelector(node, spec, extendWith, partial, ctx);
  }
  if (isNode(node, N.PseudoSelector) && node.value.arg && (node.value.arg as any).isSelector) {
    return walkPseudoSelector(node, spec, extendWith, partial, ctx);
  }

  // 3. No match
  return node;
}

// ─────────────────────────────────────────────────
// Whole-match transformation
// ─────────────────────────────────────────────────

function applyWholeMatch(
  node: Selector,
  spec: FindSpec,
  extendWith: Selector,
  partial: boolean,
  ctx: WalkContext
): Selector {
  const findVal = spec.original.valueOf();
  const extendVal = extendWith.valueOf();

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

  return makeList(node, extendWith, true);
}

// ─────────────────────────────────────────────────
// Container walkers
// ─────────────────────────────────────────────────

function walkSelectorList(
  list: SelectorList,
  spec: FindSpec,
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

    const extended = walkNode(item, spec, extendWith, partial, childCtx);

    if (extended === item) {
      originals.push(item);
    } else if (isNode(extended, N.SelectorList)) {
      const extItems = extended.value as Selector[];
      const first = extItems[0]!;
      first.addFlag(F_EXTENDED);
      if (partial) {
        first.addFlag(F_EXTEND_TARGET);
      }
      originals.push(first);
      for (let j = 1; j < extItems.length; j++) {
        const ext = extItems[j]! as Selector;
        ext.addFlag(F_EXTENDED);
        appended.push(ext);
      }
      anyChanged = true;
    } else {
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
  if (typeof processed === 'string') {
    return list;
  }
  const processedArray = isArray(processed) ? processed : [processed];
  const safe = processedArray.map(s => (s === list ? s.clone(true) : s));
  return SelectorList.create(safe).inherit(list) as Selector;
}

function walkComplexSelector(
  complex: ComplexSelector,
  spec: FindSpec,
  extendWith: Selector,
  partial: boolean,
  ctx: WalkContext
): Selector {
  // Multi-position find: try contiguous subsequence match
  if (isMultiPosition(spec)) {
    return consumePositionsFromComplex(complex, spec, extendWith, partial, ctx);
  }

  // Single-position find: walk each component individually
  const components = complex.value;
  let anyChanged = false;
  const newComponents = [...components];

  for (let i = 0; i < components.length; i++) {
    const comp = components[i]!;
    if (isNode(comp, N.Combinator)) {
      continue;
    }

    const childCtx: WalkContext = {
      isRoot: false,
      parentType: 'ComplexSelector',
      hasContentBefore: i > 0,
      hasContentAfter: i < components.length - 1
    };

    const extended = walkNode(comp as Selector, spec, extendWith, partial, childCtx);
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
  spec: FindSpec,
  extendWith: Selector,
  partial: boolean,
  _ctx: WalkContext
): Selector {
  // Multi-position: can't consume from a single compound
  if (isMultiPosition(spec)) {
    return compound;
  }

  // Multi-simple: consume find simples from compound components
  if (isMultiSimple(spec) && partial) {
    return consumeSimplesFromCompound(compound, spec, extendWith);
  }

  // Single-simple: walk individual components (recurses into :is())
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

    const extended = walkNode(comp as Selector, spec, extendWith, partial, childCtx);
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
 * Consume find simples from a compound's components.
 * Matched components → :is(matched, extendWith). Remainder stays.
 */
function consumeSimplesFromCompound(
  compound: CompoundSelector,
  spec: FindSpec,
  extendWith: Selector
): Selector {
  const targetComps = compound.value;
  const findSimples = spec.positions[0]!;

  const matchIndices = consumeSimples(targetComps, findSimples);
  if (!matchIndices) {
    return compound;
  }

  const matchedSet = new Set(matchIndices);
  const remainders: SimpleSelector[] = [];
  for (let i = 0; i < targetComps.length; i++) {
    if (!matchedSet.has(i)) {
      remainders.push(targetComps[i]!);
    }
  }

  const isWrapper = wrapInIs(spec.original, extendWith);
  const newComponents: SimpleSelector[] = [isWrapper as unknown as SimpleSelector, ...remainders];
  const result = CompoundSelector.create(newComponents).inherit(compound);
  result.addFlag(F_EXTENDED);
  return result as Selector;
}

/**
 * Consume find positions from a complex selector's components.
 * Contiguous subsequence match with exact combinator matching.
 */
function consumePositionsFromComplex(
  complex: ComplexSelector,
  spec: FindSpec,
  extendWith: Selector,
  partial: boolean,
  _ctx: WalkContext
): Selector {
  const targetComps = complex.value;
  const start = findSubsequence(targetComps, spec);
  if (start < 0) {
    return complex;
  }

  // Reconstruct find component count (positions + combinators)
  const findLen = spec.positions.length + spec.combinators.length;
  const end = start + findLen;
  const hasBefore = start > 0;
  const hasAfter = end < targetComps.length;

  if (!partial && (hasBefore || hasAfter)) {
    return complex;
  }

  if (!hasBefore && !hasAfter) {
    return makeList(complex, extendWith, true);
  }

  // Wrap the matched segment
  const matchedSegment = targetComps.slice(start, end);
  const matchedComplex = ComplexSelector.create(matchedSegment).inherit(complex);
  const isWrapper = wrapInIs(matchedComplex as Selector, extendWith);

  const before = targetComps.slice(0, start);
  const after = targetComps.slice(end);
  const newComps = [...before, isWrapper, ...after];
  const result = ComplexSelector.create(newComps).inherit(complex);
  result.addFlag(F_EXTENDED);
  return result as Selector;
}

function walkPseudoSelector(
  pseudo: PseudoSelector,
  spec: FindSpec,
  extendWith: Selector,
  partial: boolean,
  ctx: WalkContext
): Selector {
  const arg = pseudo.value.arg as Selector;

  // When :is() is inside a compound, only the tail of each complex
  // alternative is at the current position. The ancestral prefix is
  // a separate branch and should not be walked for matching.
  if (ctx.parentType === 'CompoundSelector') {
    return walkPseudoTailAware(pseudo, arg, spec, extendWith, partial, ctx);
  }

  const childCtx: WalkContext = {
    isRoot: false,
    parentType: 'PseudoSelector',
    hasContentBefore: false,
    hasContentAfter: false
  };

  const extendedArg = walkNode(arg, spec, extendWith, partial, childCtx);
  if (extendedArg === arg) {
    return pseudo;
  }

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

/**
 * Walk :is() alternatives tail-aware: for complex alternatives, only the
 * last non-combinator component (the tail) is at the current compound
 * position. The ancestral prefix is not walked.
 */
function walkPseudoTailAware(
  pseudo: PseudoSelector,
  arg: Selector,
  spec: FindSpec,
  extendWith: Selector,
  partial: boolean,
  ctx: WalkContext
): Selector {
  if (isNode(arg, N.SelectorList)) {
    const items = (arg as SelectorList).value;
    let anyChanged = false;
    const originals: Selector[] = [];
    const appended: Selector[] = [];

    for (let i = 0; i < items.length; i++) {
      const alt = items[i]! as Selector;
      const extended = walkAlternativeTailAware(alt, spec, extendWith, partial);
      if (extended === alt) {
        originals.push(alt);
      } else if (isNode(extended, N.SelectorList)) {
        // Decompose: first item stays in position, rest appended at end
        const extItems = extended.value as Selector[];
        originals.push(extItems[0]!);
        for (let j = 1; j < extItems.length; j++) {
          appended.push(extItems[j]! as Selector);
        }
        anyChanged = true;
      } else {
        originals.push(extended);
        anyChanged = true;
      }
    }

    if (!anyChanged) {
      return pseudo;
    }

    if (!partial && (ctx.hasContentBefore || ctx.hasContentAfter)) {
      return pseudo;
    }

    const newList = SelectorList.create([...originals, ...appended]).inherit(arg);
    const result = PseudoSelector.create({
      name: pseudo.value.name,
      arg: newList as any
    }).inherit(pseudo);
    result.generated = pseudo.generated;
    return result as Selector;
  }

  // Single alternative
  const extended = walkAlternativeTailAware(arg, spec, extendWith, partial);
  if (extended === arg) {
    return pseudo;
  }

  if (!partial && (ctx.hasContentBefore || ctx.hasContentAfter)) {
    return pseudo;
  }

  const result = PseudoSelector.create({
    name: pseudo.value.name,
    arg: extended as any
  }).inherit(pseudo);
  result.generated = pseudo.generated;
  return result as Selector;
}

/**
 * Walk a single :is() alternative. If it's a ComplexSelector, only walk
 * the tail (last non-combinator). Otherwise walk normally.
 */
function walkAlternativeTailAware(
  alt: Selector,
  spec: FindSpec,
  extendWith: Selector,
  partial: boolean
): Selector {
  if (!isNode(alt, N.ComplexSelector)) {
    // Simple or compound alternative: walk normally
    const childCtx: WalkContext = {
      isRoot: false,
      parentType: 'PseudoSelector',
      hasContentBefore: false,
      hasContentAfter: false
    };
    return walkNode(alt, spec, extendWith, partial, childCtx);
  }

  // Complex alternative: only walk the tail
  const comps = (alt as ComplexSelector).value;
  let tailIdx = -1;
  for (let i = comps.length - 1; i >= 0; i--) {
    if (!isNode(comps[i], N.Combinator)) {
      tailIdx = i;
      break;
    }
  }
  if (tailIdx < 0) {
    return alt;
  }

  const tail = comps[tailIdx]! as Selector;
  // The tail is at the compound position — walk it as if it were a compound child
  const tailCtx: WalkContext = {
    isRoot: false,
    parentType: 'CompoundSelector',
    hasContentBefore: tailIdx > 0,
    hasContentAfter: tailIdx < comps.length - 1
  };
  const extendedTail = walkNode(tail, spec, extendWith, partial, tailCtx);
  if (extendedTail === tail) {
    return alt;
  }

  // Reconstruct complex with modified tail, keeping prefix intact
  const newComps = [...comps];
  newComps[tailIdx] = extendedTail as any;
  return ComplexSelector.create(newComps).inherit(alt) as Selector;
}

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────

function makeList(original: Selector, extendWith: Selector, partial: boolean = false): Selector {
  const a = original.clone(true) as Selector;
  a.addFlag(F_EXTENDED);
  if (partial) {
    a.addFlag(F_EXTEND_TARGET);
  }

  const extendItems = extractIsArgs(extendWith);
  const items: Selector[] = [a];
  for (const item of extendItems) {
    const b = item.clone(true) as Selector;
    b.addFlag(F_EXTENDED);
    items.push(b);
  }

  const processed = createProcessedSelector(items, true);
  if (typeof processed === 'string') {
    return original;
  }
  const processedArray = isArray(processed) ? processed : [processed];
  return SelectorList.create(processedArray).inherit(original) as Selector;
}

function extractIsArgs(selector: Selector): Selector[] {
  if (isNode(selector, N.PseudoSelector) && selector.value.name === ':is' && selector.value.arg) {
    const arg = selector.value.arg;
    if (isNode(arg, N.SelectorList)) {
      return (arg as SelectorList).value as Selector[];
    }
    return [arg as Selector];
  }
  return [selector];
}

function wrapInIs(matched: Selector, extendWith: Selector): Selector {
  const a = matched.copy(true) as Selector;
  a.addFlag(F_EXTEND_TARGET);

  const extendItems = extractIsArgs(extendWith);
  const extendCopies = extendItems.map((item) => {
    const c = item.copy(true) as Selector;
    c.addFlag(F_EXTENDED);
    return c;
  });

  if (isNode(matched, N.PseudoSelector) && matched.value.name === ':is' && matched.value.arg) {
    const existing = isNode(matched.value.arg, N.SelectorList)
      ? (matched.value.arg as SelectorList).value as Selector[]
      : [matched.value.arg as Selector];

    const existingVals = new Set(existing.map(s => s.valueOf()));
    const newItems = extendCopies.filter(c => !existingVals.has(c.valueOf()));
    if (newItems.length === 0) {
      return matched;
    }

    const merged = [...existing.map(s => s.copy(true) as Selector), ...newItems];
    const list = SelectorList.create(merged);
    const result = PseudoSelector.create({ name: ':is', arg: list }).inherit(matched);
    result.generated = true;
    return result as Selector;
  }

  const list = SelectorList.create([a, ...extendCopies]);
  const result = PseudoSelector.create({ name: ':is', arg: list }).inherit(matched);
  result.generated = true;
  return result as Selector;
}

// ─────────────────────────────────────────────────
// Dry-run: would this extend change the selector?
// ─────────────────────────────────────────────────

export function wouldExtendChange(
  target: Selector,
  find: Selector,
  extendWith: Selector,
  partial: boolean,
  parentSelector?: Selector
): boolean {
  const spec = decomposeFind(find);
  return wouldMatchNode(target, spec, extendWith, partial, ROOT_CTX, parentSelector);
}

function wouldMatchNode(
  node: Selector,
  spec: FindSpec,
  extendWith: Selector,
  partial: boolean,
  ctx: WalkContext,
  parentSelector?: Selector
): boolean {
  if (spec.original.valueOf() === extendWith.valueOf()) {
    return false;
  }

  if (isWholeNodeMatch(node, spec)) {
    if (!partial) {
      if (ctx.parentType === 'CompoundSelector' || ctx.parentType === 'ComplexSelector') {
        return false;
      }
    }
    return true;
  }

  if (isNode(node, N.SelectorList)) {
    return (node as SelectorList).value.some((item, i) =>
      wouldMatchNode(item as Selector, spec, extendWith, partial, {
        isRoot: false,
        parentType: 'SelectorList',
        hasContentBefore: i > 0,
        hasContentAfter: i < (node as SelectorList).value.length - 1
      }, parentSelector)
    );
  }

  if (isNode(node, N.ComplexSelector)) {
    if (isMultiPosition(spec)) {
      if (wouldSubsequenceMatch(node as ComplexSelector, spec, partial)) {
        return true;
      }
      // Continue into parent — the local complex selector + parent form a longer chain
      if (parentSelector && partial) {
        return wouldMatchWithParent(node, spec, partial, parentSelector);
      }
      return false;
    }
    return (node as ComplexSelector).value.some((comp, i) => {
      if (isNode(comp, N.Combinator)) {
        return false;
      }
      return wouldMatchNode(comp as Selector, spec, extendWith, partial, {
        isRoot: false,
        parentType: 'ComplexSelector',
        hasContentBefore: i > 0,
        hasContentAfter: i < (node as ComplexSelector).value.length - 1
      });
    });
  }

  // For simple/compound nodes with a multi-position find, the parent provides
  // the implicit & context — treat [parent, ' ', node] as a virtual complex
  if (parentSelector && isMultiPosition(spec)) {
    return wouldMatchWithParent(node, spec, partial, parentSelector);
  }

  if (isNode(node, N.CompoundSelector)) {
    if (isMultiSimple(spec) && partial) {
      return wouldSimplesMatch(node as CompoundSelector, spec);
    }
    return (node as CompoundSelector).value.some((comp, i) =>
      wouldMatchNode(comp as Selector, spec, extendWith, partial, {
        isRoot: false,
        parentType: 'CompoundSelector',
        hasContentBefore: i > 0,
        hasContentAfter: i < (node as CompoundSelector).value.length - 1
      })
    );
  }

  // Ampersand = implicit parent. Continue matching into the stored parent selector.
  if (isNode(node, N.Ampersand)) {
    const amp = node as Ampersand;
    const storedSel = amp._selectorContainer?.selector;
    if (storedSel && !isNode(storedSel, N.Nil)) {
      return wouldMatchNode(storedSel as Selector, spec, extendWith, partial, {
        isRoot: false,
        parentType: ctx.parentType,
        hasContentBefore: ctx.hasContentBefore,
        hasContentAfter: ctx.hasContentAfter
      });
    }
    // No stored selector — try the provided parent
    if (parentSelector) {
      return wouldMatchNode(parentSelector, spec, extendWith, partial, {
        isRoot: false,
        parentType: ctx.parentType,
        hasContentBefore: ctx.hasContentBefore,
        hasContentAfter: ctx.hasContentAfter
      });
    }
    return false;
  }

  if (isNode(node, N.PseudoSelector) && (node as PseudoSelector).value.arg && ((node as PseudoSelector).value.arg as any).isSelector) {
    const pseudo = node as PseudoSelector;
    if (!partial && (ctx.hasContentBefore || ctx.hasContentAfter)) {
      return false;
    }
    // Tail-aware: when :is() is inside a compound, only the tail of
    // complex alternatives is at the current position.
    if (ctx.parentType === 'CompoundSelector') {
      return wouldMatchPseudoTailAware(pseudo, spec, extendWith, partial);
    }
    return wouldMatchNode(pseudo.value.arg as Selector, spec, extendWith, partial, {
      isRoot: false,
      parentType: 'PseudoSelector',
      hasContentBefore: false,
      hasContentAfter: false
    });
  }

  return false;
}

function wouldMatchPseudoTailAware(
  pseudo: PseudoSelector,
  spec: FindSpec,
  extendWith: Selector,
  partial: boolean
): boolean {
  const arg = pseudo.value.arg as Selector;

  const checkAlt = (alt: Selector): boolean => {
    if (!isNode(alt, N.ComplexSelector)) {
      return wouldMatchNode(alt, spec, extendWith, partial, {
        isRoot: false,
        parentType: 'PseudoSelector',
        hasContentBefore: false,
        hasContentAfter: false
      });
    }
    // Complex: only check the tail
    const comps = (alt as ComplexSelector).value;
    for (let i = comps.length - 1; i >= 0; i--) {
      if (!isNode(comps[i], N.Combinator)) {
        return wouldMatchNode(comps[i] as Selector, spec, extendWith, partial, {
          isRoot: false,
          parentType: 'CompoundSelector',
          hasContentBefore: i > 0,
          hasContentAfter: i < comps.length - 1
        });
      }
    }
    return false;
  };

  if (isNode(arg, N.SelectorList)) {
    return (arg as SelectorList).value.some((alt: Selector) => checkAlt(alt));
  }
  return checkAlt(arg);
}

function wouldSimplesMatch(target: CompoundSelector, spec: FindSpec): boolean {
  return consumeSimples(target.value, spec.positions[0]!) !== null;
}

/**
 * Try matching a multi-position find against a virtual [parent, ' ', child] complex.
 * The parent IS the implicit &. No selector creation — just array concatenation
 * fed directly into findSubsequence.
 */
function wouldMatchWithParent(
  child: Selector,
  spec: FindSpec,
  partial: boolean,
  parentSelector: Selector
): boolean {
  // Build the virtual components array: [...parentComponents, SPACE, ...childComponents]
  const parentComps = isNode(parentSelector, N.ComplexSelector)
    ? (parentSelector as ComplexSelector).value
    : [parentSelector];
  const childComps = isNode(child, N.ComplexSelector)
    ? (child as ComplexSelector).value
    : [child];
  const virtualComps = [...parentComps, { type: 'Combinator', value: ' ' }, ...childComps];
  const start = findSubsequence(virtualComps, spec);
  if (start < 0) {
    return false;
  }
  if (!partial) {
    const findLen = spec.positions.length + spec.combinators.length;
    return start === 0 && findLen === virtualComps.length;
  }
  return true;
}

function wouldSubsequenceMatch(
  target: ComplexSelector,
  spec: FindSpec,
  partial: boolean
): boolean {
  const start = findSubsequence(target.value, spec);
  if (start < 0) {
    return false;
  }
  if (!partial) {
    const findLen = spec.positions.length + spec.combinators.length;
    return start === 0 && findLen === target.value.length;
  }
  return true;
}
