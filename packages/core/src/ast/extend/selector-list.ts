/**
 * The extend engine over one selector list, outside a stylesheet: what Sass's
 * `selector.extend()` reads.
 */
import { branchFromSelector, branchOutParts } from './ir.js';
import { groupedBranches, siblingCompact } from './emit.js';
import type { PlanInstruction } from './plan.js';
import { buildContribs, groupInstructions, runFixpoint } from './solve.js';
import type { SelectorBranch } from '../nodes.js';
import { irPseudoElementCarriesSuffix } from '../is-grouping.js';

/**
 * `selectors` with `extenders` extending each of `targets`, as SCSS `@extend`
 * extends a top-level rule (a target matches within a compound): the header that
 * rule is written with, each branch {@link branchOutParts part by part}, or null
 * when no target matches. A branch whose pseudo-element is followed by more
 * (`.b::after::before`) is left out: the header writes it as a rule of its own
 * so the rest of the list stays valid, and a list value has no rule to give it.
 */
export function extendSelectorList(
  selectors: readonly SelectorBranch[],
  targets: readonly SelectorBranch[],
  extenders: readonly SelectorBranch[]
): string[][] | null {
  const level = extenders.map(branchFromSelector);
  const instructions = targets.map((target, order): PlanInstruction => ({
    target: branchFromSelector(target), partial: true, extenderPath: [level], scope: [], order, extenderHidden: false, boundary: null
  }));
  const { list, changed } = runFixpoint(selectors.map(branchFromSelector), groupInstructions(instructions, buildContribs(instructions)));
  if (!changed) {
    return null;
  }
  const out: string[][] = [];
  for (const branch of groupedBranches(siblingCompact(list, false), true)) {
    if (!irPseudoElementCarriesSuffix(branch)) {
      out.push(branchOutParts(branch));
    }
  }
  return out;
}
