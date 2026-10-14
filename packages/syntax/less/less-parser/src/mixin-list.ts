/**
 * Less's `;` rule for a mixin argument or parameter list (owner 2026-10-09,
 * ledger P46), stated once: the grammar's reducer and the language service's
 * tolerant CST both ask it which items the list makes invalid.
 *
 * When the list holds any `;` (a trailing one included), `;` separates its
 * arguments and every `,` belongs to a comma-list value. In a comma run of two
 * or more items a spread or rest cannot be part of the value, and a `@name:`
 * may only start it. Without a `;`, `,` separates arguments and no item is
 * invalid by this rule.
 */

/** What the rule needs to know about one item: a `@name:` binding, a spread or rest, or anything else. */
export type MixinListItemShape = 'named' | 'rest' | 'plain';

/** An item the `;` rule makes invalid, by its index in the list. */
export interface MixinListProblem {
  readonly index: number;
  readonly problem: 'named' | 'rest';
}

const NO_PROBLEMS: readonly MixinListProblem[] = Object.freeze([]);

/**
 * The items a list's `;` makes invalid, in source order. `separators[i]` is
 * the separator after item `i`; `semicolons` says whether any separator,
 * the trailing one included, is `;`.
 */
export function mixinListProblems(
  shapes: readonly MixinListItemShape[],
  separators: readonly string[],
  semicolons: boolean
): readonly MixinListProblem[] {
  if (!semicolons) {
    return NO_PROBLEMS;
  }
  let problems: MixinListProblem[] | undefined;
  let first = 0;
  for (let last = 0; last < shapes.length; last++) {
    if (separators[last] === ',') {
      continue;
    }
    for (let index = first; last > first && index <= last; index++) {
      const shape = shapes[index];
      if (shape === 'rest' || (shape === 'named' && index > first)) {
        (problems ??= []).push({ index, problem: shape });
      }
    }
    first = last + 1;
  }
  return problems ?? NO_PROBLEMS;
}
