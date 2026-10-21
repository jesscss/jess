/**
 * Reads of composed selector text: the strings the serializer composes a
 * nested rule's selector list into, one per branch.
 */

import { isNameCode, isQuote, stringEnd } from './css-syntax.js';
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
  return selectorValue(branches === null ? null : branches.map(selectorComponents));
}

/** {@link selectorListValue} over branches already split into their compound selectors and combinators. */
export function selectorValue(branches: readonly (readonly string[])[] | null): ValueGroup {
  return branches === null || branches.length === 0
    ? makeNull(true)
    : makeList(branches.map(components => components.map(makeKeyword)), ',');
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

/** A selector `:is(…)` holding `selector` as one unit. */
export const isUnit = (selector: string): string => `:is(${selector})`;

/**
 * A resolved selector's text, or, where a selector list it interpolates continues a name
 * ({@link continuesNameAt}), the branches that multiplies it into (`.col-@{l}` with
 * `@l: sm, md` is `.col-sm`, `.col-md`).
 */
export type SelectorText = string | string[];

/** Whether no text of `values` is multiplied. */
export const isOneText = <T>(values: readonly (T | string[])[]): values is readonly T[] => !values.some(value => Array.isArray(value));

/** A selector text as the branches it is. */
export const textBranches = (text: SelectorText): readonly string[] => typeof text === 'string' ? [text] : text;

/** A selector text as one string, for a consumer that reads one: its branches as a list. */
export const oneText = (text: SelectorText): string => typeof text === 'string' ? text : text.join(', ');

/**
 * `values` crossed, the leftmost most significant, as a `&` odometer is
 * (`joinAmpersand` in `serialize.ts`): `build` writes each pick, once when none multiplies.
 */
export const crossTexts = (values: readonly SelectorText[], build: (picked: readonly string[]) => string): SelectorText => isOneText(values)
  ? build(values)
  : values.reduce<string[][]>((picks, value) => picks.flatMap(pick => textBranches(value).map(text => [...pick, text])), [[]]).map(build);

/** Whether code point `code` ends a name, or is the `.`, `#` or `:` that opens one. */
const opensName = (code: number): boolean => code === 0x2E /* . */ || code === 0x23 /* # */ || code === 0x3A /* : */ || isNameCode(code);

/**
 * [nesting] Whether a selector list `branches`, glued after the text `before`, continues
 * a name: a name is glued after it (`after`), as `&__x` continues its parent's
 * (`continuesName` in `serialize.ts`), or one of its selectors opens with a name glued
 * after a name, or after the `.`, `#` or `:` that opens one (`.col-` then `sm`, `:`
 * then `hover`). Such a list multiplies its
 * token, one text per selector, as `&__x` does, since `:is()` is no part of a name and
 * `.col-:is(sm, md)` and `:is(.card, .panel)__title` are no selectors. Glued at a
 * compound boundary (`.x` then `.a`, `.a` then `:hover`, `[x]` then `a`) it is one
 * `:is()` group.
 */
export const continuesNameAt = (branches: readonly string[], before: string, after: boolean): boolean =>
  after || (opensName(before.charCodeAt(before.length - 1)) && branches.some(branch => isNameCode(branch.charCodeAt(0))));

/** `out` with `text` appended to each of its branches. */
export const appendText = (out: SelectorText, text: string): SelectorText =>
  typeof out === 'string' ? out + text : out.map(value => value + text);
