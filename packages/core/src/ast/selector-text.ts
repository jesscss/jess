/**
 * Reads of composed selector text: the strings the serializer composes a
 * nested rule's selector list into, one per branch.
 */

import { isQuote, stringEnd } from './css-syntax.js';
import { makeKeyword, makeList, makeNull } from './value-factory.js';
import type { ValueGroup } from './value-eval.js';

/** Whether `text` has a top-level `,` (outside any `()[]{}` group / quoted string). */
export function hasTopLevelComma(text: string): boolean {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (isQuote(c)) {
      i = stringEnd(text, i);
    } else if (c === '(' || c === '[' || c === '{') {
      depth++;
    } else if (c === ')' || c === ']' || c === '}') {
      depth--;
    } else if (depth === 0 && c === ',') {
      return true;
    }
  }
  return false;
}

/** `lists` read across: the first item of each, then the second of each, and on. */
export function interleave(lists: readonly (readonly string[])[]): string[] {
  const out: string[] = [];
  for (let i = 0, more = true; more; i++) {
    more = false;
    for (const items of lists) {
      if (i < items.length) {
        out.push(items[i]!);
        more = true;
      }
    }
  }
  return out;
}

/**
 * Composed branches as the value Sass gives `&` and `selector.parse()` (owner
 * 2026-10-19: "in .scss, in these cases, i think do what sass does"): a comma
 * list holding, per branch, a space list of its compound selectors and
 * combinators; `null` for no branch.
 */
export function selectorListValue(branches: readonly string[] | null): ValueGroup {
  return branches === null || branches.length === 0
    ? makeNull(true)
    : makeList(branches.map(branch => selectorComponents(branch).map(makeKeyword)), ',');
}

/**
 * A composed branch's compound selectors and combinators: its parts between the
 * spaces outside a quote, bracket or parenthesis (`.a:not(.b .c) > [title="x y"]`
 * is `.a:not(.b .c)`, `>`, `[title="x y"]`).
 */
function selectorComponents(branch: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < branch.length; i++) {
    const c = branch[i]!;
    if (depth === 0 && (c === ' ' || c === '\n' || c === '\t')) {
      if (start >= 0) {
        out.push(branch.slice(start, i));
        start = -1;
      }
      continue;
    }
    if (start < 0) {
      start = i;
    }
    if (c === '\\') {
      i++;
    } else if (isQuote(c)) {
      i = stringEnd(branch, i);
    } else if (c === '(' || c === '[') {
      depth++;
    } else if (c === ')' || c === ']') {
      depth--;
    }
  }
  if (start >= 0) {
    out.push(branch.slice(start));
  }
  return out;
}
