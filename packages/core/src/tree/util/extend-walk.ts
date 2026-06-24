/**
 * Walk-and-consume extend algorithm.
 *
 * The find selector decomposes into *positions* — each position is a set of
 * simple value (AND). Positions are separated by combinators. The walk
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
 * compound position as its sibling value. Everything before the last
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
 * ancestors/preceding. For :is() alternatives that are complex value,
 * the last element is at the current position; the rest is a branch going up.
 *
 * ComplexSelector find support is currently used for diagnostics only
 * (wouldExtendChange); the extend application falls through to legacy
 * due to createProcessedSelector differences.
 */

import type { Selector } from '../selector.js';
import { SimpleSelector } from '../selector-simple.js';
import { SelectorList, type SelectorListItem } from '../selector-list.js';
import { selectorListItemForMatch } from './selector-match-core.js';
import { ComplexSelector, type ComplexSelectorComponent } from '../selector-complex.js';
import { CompoundSelector } from '../selector-compound.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { Ampersand } from '../ampersand.js';
import { Combinator } from '../combinator.js';
import { Ruleset } from '../ruleset.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { F_AMPERSAND, F_EXTENDED, F_EXTEND_TARGET } from '../node.js';
import { createProcessedSelector } from './extend.js';
import { copySelectorForPlacement as copySelectorForExtend } from './selector-utils.js';

const { isArray } = Array;

function copySelectorsForPlacement(value: Selector[]): Selector[] {
  return value.map(selector => copySelectorForExtend(selector));
}

function isSelectorNode(value: unknown): value is Selector {
  return !!value
    && typeof value === 'object'
    && (value as { isSelector?: unknown }).isSelector === true;
}

function expectSelector(value: unknown): Selector {
  if (isSelectorNode(value)) {
    return value;
  }
  throw new TypeError('Expected selector');
}

function isComplexComponent(value: unknown): value is ComplexSelectorComponent {
  return value instanceof SimpleSelector
    || value instanceof CompoundSelector
    || value instanceof ComplexSelector
    || value instanceof Combinator;
}

function selectorArgOf(pseudo: PseudoSelector): Selector | undefined {
  const arg = pseudo.arg;
  return isSelectorNode(arg) ? arg : undefined;
}

function hasSelectorIdentityFlag(value: unknown): value is { isTag?: boolean; isId?: boolean } {
  return value !== null && typeof value === 'object';
}

// ─────────────────────────────────────────────────
// Find decomposition
// ─────────────────────────────────────────────────

/**
 * A find selector decomposed into positions.
 * Each position is a set of simple value that must ALL match (AND).
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
    for (const comp of find.value) {
      if (comp instanceof Combinator) {
        combinators.push(comp.value);
      } else if (comp instanceof CompoundSelector) {
        positions.push([...comp.value]);
      } else if (isSelectorNode(comp)) {
        positions.push([comp]);
      }
    }
    return { positions, combinators, original: find };
  }
  if (isNode(find, N.CompoundSelector)) {
    return {
      positions: [[...find.value]],
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
    const aVal = aComp.valueOf();
    let found = false;
    for (let j = 0; j < b.value.length; j++) {
      if (!used[j] && b.value[j]!.valueOf() === aVal) {
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
    if (ac instanceof Combinator) {
      if (!(bc instanceof Combinator) || ac.value !== bc.value) {
        return false;
      }
      continue;
    }
    if (ac instanceof CompoundSelector && bc instanceof CompoundSelector) {
      if (!areCompoundsEquivalent(ac, bc)) {
        return false;
      }
    } else if (isSelectorNode(ac) && isSelectorNode(bc) && ac.valueOf() !== bc.valueOf()) {
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
  if (sel instanceof ComplexSelector) {
    const comps = sel.value;
    for (let i = comps.length - 1; i >= 0; i--) {
      const comp = comps[i];
      if (comp && !(comp instanceof Combinator) && isSelectorNode(comp)) {
        return comp;
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
  if (isNode(find, N.PseudoSelector) && find.name === ':is' && find.arg) {
    const arg = selectorArgOf(find);
    if (!arg) {
      return false;
    }
    if (isNode(arg, N.SelectorList)) {
      return arg.value.some(
        (alt: Selector) => positionSimpleMatches(tailOf(alt), target)
      );
    }
    return positionSimpleMatches(tailOf(arg), target);
  }

  // target is :is() → OR: try each alternative's tail
  if (isNode(target, N.PseudoSelector) && target.name === ':is' && target.arg) {
    const arg = selectorArgOf(target);
    if (!arg) {
      return false;
    }
    if (isNode(arg, N.SelectorList)) {
      return arg.value.some(
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
  if (findComp instanceof CompoundSelector && targetComp instanceof CompoundSelector) {
    return areCompoundsEquivalent(findComp, targetComp);
  }
  return positionSimpleMatches(findComp, targetComp);
}

/**
 * Try to match find positions as a contiguous subsequence in target
 * value. Returns the start index or -1.
 */
function findSubsequence(
  targetComps: any[],
  spec: FindSpec
): number {
  // Reconstruct find value (positions interleaved with combinators)
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
          if (tc instanceof CompoundSelector) {
            if (!areCompoundsEquivalent(
              CompoundSelector.create(fc.simples),
              tc
            )) {
              matches = false;
              break;
            }
          } else {
            matches = false;
            break;
          }
        } else if (!positionComponentMatches(fc, tc)) {
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
 * Try to consume find simples from a compound's value (subsequence match).
 * Returns matched indices or null if not all consumed.
 */
function consumeSimples(
  targetComps: SimpleSelector[],
  findSimples: Selector[]
): number[] | null {
  const matchIndices: number[] = [];
  let findIdx = 0;
  for (let i = 0; i < targetComps.length && findIdx < findSimples.length; i++) {
    if (positionSimpleMatches(findSimples[findIdx]!, targetComps[i]!)) {
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
    return extendWith.value.some(
      child => hasSelectorIdentityFlag(child) && (child.isTag || child.isId)
    );
  }
  if (hasSelectorIdentityFlag(extendWith) && (extendWith.isTag || extendWith.isId)) {
    return true;
  }
  return false;
}

function containsAmpersand(sel: Selector | string): boolean {
  if (typeof sel === "string") {
    return sel.includes("&");
  }
  if (sel instanceof Ampersand) {
    return true;
  }
  if (sel instanceof SelectorList) {
    return sel.value.some(child => containsAmpersand(child));
  }
  if (sel instanceof CompoundSelector) {
    return sel.value.some(child => containsAmpersand(child));
  }
  if (sel instanceof ComplexSelector) {
    return sel.value.some(child => isSelectorNode(child) && containsAmpersand(child));
  }
  if (sel instanceof PseudoSelector) {
    const arg = selectorArgOf(sel);
    return arg ? containsAmpersand(arg) : false;
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
  if (node instanceof PseudoSelector && selectorArgOf(node)) {
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
  const originals: SelectorListItem[] = [];
  const appended: SelectorListItem[] = [];
  let anyChanged = false;

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const childCtx: WalkContext = {
      isRoot: false,
      parentType: 'SelectorList',
      hasContentBefore: i > 0,
      hasContentAfter: i < items.length - 1
    };

    const extended = walkNode(selectorListItemForMatch(item), spec, extendWith, partial, childCtx);

    if (extended === item) {
      originals.push(item);
    } else if (isNode(extended, N.SelectorList)) {
      const extItems = extended.value;
      const first = extItems[0]!;
      first.addFlag(F_EXTENDED);
      // Parity with the non-batched extend path (extend.ts `wrapMatchInIs`),
      // which always tags the matched item as `F_EXTEND_TARGET` regardless of
      // partial. The flag marks "this was the target of an extend", which
      // downstream filters (e.g. reference-mode compose filter) use to tell
      // original-matched items apart from newly-added items.
      first.addFlag(F_EXTEND_TARGET);
      originals.push(first);
      for (let j = 1; j < extItems.length; j++) {
        const ext = extItems[j]!;
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
  return SelectorList.create(copySelectorsForPlacement(processedArray)).inherit(list);
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
  const value = complex.value;
  let anyChanged = false;
  const newComponents = [...value];

  for (let i = 0; i < value.length; i++) {
    const comp = value[i]!;
    if (isNode(comp, N.Combinator)) {
      continue;
    }

    const childCtx: WalkContext = {
      isRoot: false,
      parentType: 'ComplexSelector',
      hasContentBefore: i > 0,
      hasContentAfter: i < value.length - 1
    };

    const extended = walkNode(comp, spec, extendWith, partial, childCtx);
    if (extended !== comp) {
      if (!isComplexComponent(extended)) {
        throw new TypeError('Expected complex selector component');
      }
      newComponents[i] = extended;
      anyChanged = true;
    }
  }

  if (!anyChanged) {
    return complex;
  }
  return ComplexSelector.create(newComponents).inherit(complex);
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

  // Multi-simple: consume find simples from compound value
  if (isMultiSimple(spec) && partial) {
    return consumeSimplesFromCompound(compound, spec, extendWith);
  }

  // Single-simple: walk individual value (recurses into :is())
  const value = compound.value;
  let anyChanged = false;
  const newComponents = [...value];

  for (let i = 0; i < value.length; i++) {
    const comp = value[i]!;
    const childCtx: WalkContext = {
      isRoot: false,
      parentType: 'CompoundSelector',
      hasContentBefore: i > 0,
      hasContentAfter: i < value.length - 1
    };

    const extended = walkNode(comp, spec, extendWith, partial, childCtx);
    if (extended !== comp) {
      if (!(extended instanceof SimpleSelector)) {
        throw new TypeError('Expected simple selector');
      }
      newComponents[i] = extended;
      anyChanged = true;
    }
  }

  if (!anyChanged) {
    return compound;
  }
  return CompoundSelector.create(newComponents).inherit(compound);
}

/**
 * Consume find simples from a compound's value.
 * Matched value → :is(matched, extendWith). Remainder stays.
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
  if (!(isWrapper instanceof SimpleSelector)) {
    return compound;
  }
  const newComponents: SimpleSelector[] = [isWrapper, ...remainders];
  const result = CompoundSelector.create(newComponents).inherit(compound);
  result.addFlag(F_EXTENDED);
  return result;
}

/**
 * Consume find positions from a complex selector's value.
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
  const isWrapper = wrapInIs(matchedComplex, extendWith);

  const before = targetComps.slice(0, start);
  const after = targetComps.slice(end);
  const newComps = [...before, isWrapper, ...after];
  const result = ComplexSelector.create(newComps).inherit(complex);
  result.addFlag(F_EXTENDED);
  return result;
}

function walkPseudoSelector(
  pseudo: PseudoSelector,
  spec: FindSpec,
  extendWith: Selector,
  partial: boolean,
  ctx: WalkContext
): Selector {
  const arg = selectorArgOf(pseudo);
  if (!arg) {
    return pseudo;
  }

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
    name: pseudo.name,
    arg: extendedArg
  }).inherit(pseudo);
  result.generated = pseudo.generated;
  return result;
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
    const items = arg.value;
    let anyChanged = false;
    const originals: SelectorListItem[] = [];
    const appended: SelectorListItem[] = [];

    for (let i = 0; i < items.length; i++) {
      const alt = items[i]!;
      const extended = walkAlternativeTailAware(selectorListItemForMatch(alt), spec, extendWith, partial);
      if (extended === alt) {
        originals.push(alt);
      } else if (isNode(extended, N.SelectorList)) {
        // Decompose: first item stays in position, rest appended at end
        const extItems = extended.value;
        originals.push(extItems[0]!);
        for (let j = 1; j < extItems.length; j++) {
          appended.push(extItems[j]!);
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

    const newList = SelectorList.create(copySelectorsForPlacement([...originals, ...appended])).inherit(arg);
    const result = PseudoSelector.create({
      name: pseudo.name,
      arg: newList
    }).inherit(pseudo);
    result.generated = pseudo.generated;
    return result;
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
    name: pseudo.name,
    arg: extended
  }).inherit(pseudo);
  result.generated = pseudo.generated;
  return result;
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
  const comps = alt.value;
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

  const tail = expectSelector(comps[tailIdx]!);
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
  if (!isComplexComponent(extendedTail)) {
    throw new TypeError('Expected complex selector component');
  }
  newComps[tailIdx] = extendedTail;
  return ComplexSelector.create(newComps).inherit(alt);
}

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────

function makeList(original: Selector, extendWith: Selector, _partial: boolean = false): Selector {
  const a = copySelectorForExtend(original);
  a.addFlag(F_EXTENDED);
  // The original item *is* the extend target (it was matched). Tag it so
  // downstream filters (reference-mode compose filter) can distinguish it
  // from the newly-added items. Tagging is unconditional (same policy as
  // `wrapInIs`) — the `partial` arg no longer affects the tag and is kept
  // only for call-site compatibility.
  a.addFlag(F_EXTEND_TARGET);

  const extendItems = extractIsArgs(extendWith);
  const items: Selector[] = [a];
  for (const item of extendItems) {
    const b = copySelectorForExtend(item);
    b.addFlag(F_EXTENDED);
    items.push(b);
  }

  const processed = createProcessedSelector(items, true);
  if (typeof processed === 'string') {
    return original;
  }
  const processedArray = isArray(processed) ? processed : [processed];
  return SelectorList.create(processedArray).inherit(original);
}

function extractIsArgs(selector: Selector): Selector[] {
  if (isNode(selector, N.PseudoSelector) && selector.name === ':is' && selector.arg) {
    const arg = selectorArgOf(selector);
    if (!arg) {
      return [selector];
    }
    if (isNode(arg, N.SelectorList)) {
      return arg.value;
    }
    return [arg];
  }
  return [selector];
}

function wrapInIs(matched: Selector, extendWith: Selector): Selector {
  const a = copySelectorForExtend(matched);
  a.addFlag(F_EXTEND_TARGET);

  const extendItems = extractIsArgs(extendWith);
  const extendCopies = extendItems.map((item) => {
    const c = copySelectorForExtend(item);
    c.addFlag(F_EXTENDED);
    return c;
  });

  if (isNode(matched, N.PseudoSelector) && matched.name === ':is' && matched.arg) {
    const matchedArg = selectorArgOf(matched);
    const existing = matchedArg && isNode(matchedArg, N.SelectorList)
      ? matchedArg.value
      : matchedArg ? [matchedArg] : [];

    const existingVals = new Set(existing.map(s => s.valueOf()));
    const newItems = extendCopies.filter(c => !existingVals.has(c.valueOf()));
    if (newItems.length === 0) {
      return matched;
    }

    const merged = [...existing.map(s => copySelectorForExtend(selectorListItemForMatch(s))), ...newItems];
    const list = SelectorList.create(merged);
    const result = PseudoSelector.create({ name: ':is', arg: list }).inherit(matched);
    result.generated = true;
    return result;
  }

  const list = SelectorList.create([a, ...extendCopies]);
  const result = PseudoSelector.create({ name: ':is', arg: list }).inherit(matched);
  result.generated = true;
  return result;
}

// ─────────────────────────────────────────────────
// Dry-run: would this extend change the selector?
// ─────────────────────────────────────────────────

export type MatchResult = false | 'local' | 'within-ampersand' | 'crossing';

/**
 * Check if a parent selector contains the target as one of its value.
 * Used to detect same-target nesting (e.g., .bb under .bb) where exact
 * extends should not apply to avoid duplication.
 */
function parentContainsTarget(parent: Selector | string, target: Selector): boolean {
  if (typeof parent === "string") {
    return false;
  }
  const targetVal = target.valueOf();
  if (parent.valueOf() === targetVal) {
    return true;
  }
  if (isNode(parent, N.SelectorList)) {
    return parent.value.some(item => parentContainsTarget(item, target));
  }
  if (isNode(parent, N.ComplexSelector)) {
    return parent.value.some(comp =>
      !isNode(comp, N.Combinator) && isSelectorNode(comp) && parentContainsTarget(comp, target)
    );
  }
  if (isNode(parent, N.CompoundSelector)) {
    return parent.value.some(comp => parentContainsTarget(comp, target));
  }
  return false;
}

export function wouldExtendChange(
  target: Selector,
  find: Selector,
  extendWith: Selector,
  partial: boolean,
  parentSelector?: Selector
): boolean {
  const spec = decomposeFind(find);
  return !!wouldMatchNode(target, spec, extendWith, partial, ROOT_CTX, parentSelector);
}

export function classifyExtendMatch(
  target: Selector,
  find: Selector,
  extendWith: Selector,
  partial: boolean,
  parentSelector?: Selector
): MatchResult {
  const spec = decomposeFind(find);
  return wouldMatchNode(target, spec, extendWith, partial, ROOT_CTX, parentSelector);
}

function wouldMatchNode(
  node: Selector | string,
  spec: FindSpec,
  extendWith: Selector,
  partial: boolean,
  ctx: WalkContext,
  parentSelector?: Selector
): MatchResult {
    if (typeof node === "string") {
      return false;
    }
  if (spec.original.valueOf() === extendWith.valueOf()) {
    return false;
  }

  if (isWholeNodeMatch(node, spec)) {
    if (!partial) {
      // Exact extends match against the fully composed selector. If this local
      // selector still sits under parent selector context, the whole selector
      // is longer than the local node, so an exact local hit is invalid.
      if (ctx.isRoot && parentSelector) {
        if (node.hasFlag(F_AMPERSAND)) {
          const composed = Ruleset.composeSelector(node, parentSelector);
          if (wouldExtendChange(composed, spec.original, extendWith, partial)) {
            return 'crossing';
          }
        }
        return false;
      }
      if (ctx.parentType === 'CompoundSelector' || ctx.parentType === 'ComplexSelector') {
        return false;
      }
      // For non-partial exact extends, the target must equal the entire local
      // selector. Inside a SelectorList item, the whole local is the list, not
      // the item — so exact matches at a list item with a parent selector are
      // overshadowed by the parent's extension (within-ampersand).
      if (ctx.parentType === 'SelectorList' && parentSelector) {
        return 'within-ampersand';
      }
      // If parent already contains this target, applying this extend would
      // produce nesting duplicates (e.g., .bb under .bb with extend(.bb)).
      if (parentSelector && parentContainsTarget(parentSelector, node)) {
        return 'within-ampersand';
      }
    }
    return 'local';
  }

  if (isNode(node, N.SelectorList)) {
    for (let i = 0; i < node.value.length; i++) {
      const result = wouldMatchNode(node.value[i]!, spec, extendWith, partial, {
        isRoot: false,
        parentType: 'SelectorList',
        hasContentBefore: i > 0,
        hasContentAfter: i < node.value.length - 1
      }, parentSelector);
      if (result) {
        return result;
      }
    }
    return false;
  }

  if (isNode(node, N.ComplexSelector)) {
    if (isMultiPosition(spec)) {
      if (wouldSubsequenceMatch(node, spec, partial)) {
        return 'local';
      }
      // Continue into parent — the local complex selector + parent form a longer chain
      if (parentSelector && partial) {
        return wouldMatchWithParent(node, spec, partial, parentSelector) ? 'crossing' : false;
      }
      return false;
    }
    for (let i = 0; i < node.value.length; i++) {
      const comp = node.value[i]!;
      if (isNode(comp, N.Combinator)) {
        continue;
      }
      const result = wouldMatchNode(comp, spec, extendWith, partial, {
        isRoot: false,
        parentType: 'ComplexSelector',
        hasContentBefore: i > 0,
        hasContentAfter: i < node.value.length - 1
      });
      if (result) {
        return result;
      }
    }
    return false;
  }

  // For simple/compound nodes with a multi-position find, the parent provides
  // the implicit & context — treat [parent, ' ', node] as a virtual complex
  if (parentSelector && isMultiPosition(spec)) {
    return wouldMatchWithParent(node, spec, partial, parentSelector) ? 'crossing' : false;
  }

  if (isNode(node, N.CompoundSelector)) {
    // Exact targets like `.e.e` against authored nested value like `&&`
    // only become visible after substituting the parent selector into the
    // whole compound. Looking at each `&` component independently misses that.
    if (parentSelector && !partial && node.hasFlag(F_AMPERSAND)) {
      const composed = Ruleset.composeSelector(node, parentSelector);
      if (wouldExtendChange(composed, spec.original, extendWith, partial)) {
        return 'crossing';
      }
    }
    if (isMultiSimple(spec) && partial) {
      return wouldSimplesMatch(node, spec) ? 'local' : false;
    }
    for (let i = 0; i < node.value.length; i++) {
      const comp = node.value[i]!;
      const result = wouldMatchNode(comp, spec, extendWith, partial, {
        isRoot: false,
        parentType: 'CompoundSelector',
        hasContentBefore: i > 0,
        hasContentAfter: i < node.value.length - 1
      });
      if (result) {
        return result;
      }
    }
    return false;
  }

  // Ampersand = implicit parent. Match within the & means the parent carries the extend.
  if (isNode(node, N.Ampersand)) {
    const storedSel = node.getStoredSelector();
    if (storedSel && !isNode(storedSel, N.Nil)) {
      const innerResult = wouldMatchNode(storedSel, spec, extendWith, partial, {
        isRoot: false,
        parentType: ctx.parentType,
        hasContentBefore: ctx.hasContentBefore,
        hasContentAfter: ctx.hasContentAfter
      });
      return innerResult ? 'within-ampersand' : false;
    }
    if (parentSelector) {
      const innerResult = wouldMatchNode(parentSelector, spec, extendWith, partial, {
        isRoot: false,
        parentType: ctx.parentType,
        hasContentBefore: ctx.hasContentBefore,
        hasContentAfter: ctx.hasContentAfter
      });
      return innerResult ? 'within-ampersand' : false;
    }
    return false;
  }

  if (isNode(node, N.PseudoSelector) && selectorArgOf(node)) {
    const pseudo = node;
    const arg = selectorArgOf(pseudo)!;
    if (!partial && (ctx.hasContentBefore || ctx.hasContentAfter)) {
      return false;
    }
    // Tail-aware: when :is() is inside a compound, only the tail of
    // complex alternatives is at the current position.
    if (ctx.parentType === 'CompoundSelector') {
      return wouldMatchPseudoTailAware(pseudo, spec, extendWith, partial);
    }
    return wouldMatchNode(arg, spec, extendWith, partial, {
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
): MatchResult {
  const arg = selectorArgOf(pseudo);
  if (!arg) {
    return false;
  }

  const checkAlt = (alt: Selector): MatchResult => {
    if (!isNode(alt, N.ComplexSelector)) {
      return wouldMatchNode(alt, spec, extendWith, partial, {
        isRoot: false,
        parentType: 'PseudoSelector',
        hasContentBefore: false,
        hasContentAfter: false
      });
    }
    const comps = alt.value;
    for (let i = comps.length - 1; i >= 0; i--) {
      if (!isNode(comps[i], N.Combinator)) {
        return wouldMatchNode(comps[i]!, spec, extendWith, partial, {
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
    for (const alt of (arg as SelectorList).value) {
      const result = checkAlt(alt as Selector);
      if (result) {
        return result;
      }
    }
    return false;
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
 *
 * If the parent is a SelectorList, each item is tried as a potential parent chain.
 * If the child is a SelectorList, each item is tried as a potential child chain.
 */
function wouldMatchWithParent(
  child: Selector,
  spec: FindSpec,
  partial: boolean,
  parentSelector: Selector
): boolean {
  const parentItems: Selector[] = isNode(parentSelector, N.SelectorList)
    ? (parentSelector as SelectorList).value
    : [parentSelector];
  const childItems: Selector[] = isNode(child, N.SelectorList)
    ? (child as SelectorList).value
    : [child];

  const spaceComb = Combinator.create(' ');
  for (const pItem of parentItems) {
    const parentComps = isNode(pItem, N.ComplexSelector)
      ? (pItem as ComplexSelector).value
      : [pItem];
    for (const cItem of childItems) {
      const childComps = isNode(cItem, N.ComplexSelector)
        ? (cItem as ComplexSelector).value
        : [cItem];
      const virtualComps: any[] = [...parentComps, spaceComb, ...childComps];
      const start = findSubsequence(virtualComps, spec);
      if (start < 0) {
        continue;
      }
      if (!partial) {
        const findLen = spec.positions.length + spec.combinators.length;
        if (start === 0 && findLen === virtualComps.length) {
          return true;
        }
      } else {
        return true;
      }
    }
  }
  return false;
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
