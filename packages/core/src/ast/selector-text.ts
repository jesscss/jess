/**
 * Reads of composed selector text: the strings the serializer composes a
 * nested rule's selector list into, one per branch.
 */

import { isQuote, stringEnd } from './css-syntax.js';
import { makeKeyword, makeList, makeNull } from './value-factory.js';
import { isValueGroupArray, type List, type ValueGroup } from './value-eval.js';
import type { InterpPart } from './nodes.js';

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
    : makeList(branches.map(components => Object.defineProperty(components.map(makeKeyword), 'selector', { value: true })), ',', true);
}

/**
 * [selector-capture] Whether a value is one selector of a selector value (ledger P49):
 * the space list of its compound selectors and combinators, as {@link selectorValue}
 * built it, read out by `extract()`, `list.nth()`, `each()`, `@each` or `$for`. It stays
 * that space list to the list functions (`list.nth(list.nth($s, 1), 2)` is a compound),
 * and interpolated into a selector it is placed as a selector value of one selector is
 * ({@link placeSelectorList}).
 */
export const isSelectorItem = (value: unknown): boolean => Array.isArray(value) && 'selector' in value;

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
 * A resolved selector's text, or the branches a list it interpolates multiplies it into:
 * a plain list anywhere (`.col-@{l}` with `@l: sm, md` is `.col-sm`, `.col-md`), a
 * selector value where a name is glued after it, as `&__x` (`resolveSimpleTexts` in
 * `serialize.ts`).
 */
export type SelectorText = string | string[];

/**
 * Where each branch of a selector list's resolved copy came from, when one authored
 * branch resolved to several: the index of its authored branch, or `~index` for a lone
 * interpolation naming a selector list, which the header writer composes under a parent
 * as one `:is()` unit (`.toolbar :is(.btn, .button)`).
 */
export type SelectorUnits = Int32Array;

/** Whether no text of `values` is multiplied. */
export const isOneText = <T>(values: readonly (T | T[])[]): values is readonly T[] => !values.some(value => Array.isArray(value));

/** A selector text as the branches it is. */
export const textBranches = (text: SelectorText): readonly string[] => typeof text === 'string' ? [text] : text;

/** A selector text as one string, for a consumer that reads one: its branches as a list. */
export const oneText = (text: SelectorText): string => typeof text === 'string' ? text : text.join(', ');

/**
 * `values` crossed, the leftmost most significant, as a `&` odometer is
 * (`joinAmpersand` in `serialize.ts`): `build` writes each pick, once when none multiplies.
 * Selector texts, or the selector parts the extend pre-pass resolves them into.
 */
export const crossTexts = <T, R = string>(values: readonly (T | T[])[], build: (picked: readonly T[]) => R): R | R[] => isOneText(values)
  ? build(values)
  : values.reduce<T[][]>((picks, value) => picks.flatMap(pick => (Array.isArray(value) ? value : [value]).map(part => [...pick, part])), [[]]).map(build);

/**
 * [selector-capture] Whether a comma list is a selector value (ledger P49, P50): built
 * as one ({@link selectorValue}: a `selector(…)` capture, `&`, `selector.parse()`), or a
 * list of them (`@s: selector(.a), selector(.b)`).
 */
export const isSelectorValue = (list: List): boolean =>
  list.selector || list.value.every(item => !isValueGroupArray(item) && item.type === 'List' && item.sep === ',' && isSelectorValue(item));

/* [selector-capture] Where a selector interpolation stands in its compound ({@link placeSelectorList}): it is the whole compound (`.c @{s}`). */
export const PLACE_ALONE = 0;

/* It opens its compound, and a selector is glued after it (`@{s}:hover`). */
export const PLACE_OPENS = 1;

/* A selector or name is glued before it (`.x@{s}`, `.col-@{s}`). */
export const PLACE_GLUED = 2;

/* A name is glued after it (`@{s}__title`). */
export const PLACE_NAME = 3;

/* It is the whole selector, read one branch per item. */
export const PLACE_WHOLE = 4;

/* It is a whole compound of a pseudo's argument (`:not(@{s})`, `:has(> @{s})`). */
export const PLACE_ARGUMENT = 5;

export type SelectorPlace = typeof PLACE_ALONE | typeof PLACE_OPENS | typeof PLACE_GLUED | typeof PLACE_NAME | typeof PLACE_WHOLE | typeof PLACE_ARGUMENT;

/**
 * [selector-capture] Where a compound stands: in the selector, or in a pseudo's argument,
 * where a plain list that is the whole compound is one `:is()` item of the argument rather
 * than a branch per item ({@link placeSelectorList}).
 */
export type CompoundIn = 'selector' | 'argument';

/** Whether code point `code` ends a selector in an interpolation template's text: `(`, `)`, `,`, whitespace or a combinator (`>`, `+`, `~`). */
const separates = (code: number): boolean => code === 0x28 || code === 0x29 || code === 0x2C
  || code === 0x20 || code === 0x0A || code === 0x09 || code === 0x3E || code === 0x2B || code === 0x7E;

/**
 * [selector-capture] Where the interpolation `parts[at]` of a selector token stands in
 * its compound ({@link placeSelectorList}): a name glued after it (`nameAfter`), anything
 * glued before it (the part before it; for the first part, `token`, the token glued
 * before this one), anything glued after it (likewise, `gluedAfter`), or nothing: the
 * whole compound, of the selector or of a pseudo's argument (`token` says which,
 * {@link CompoundIn}, when no token is glued before). A literal part beside it glues only
 * up to a separator, and only a pseudo argument the Less parser keeps in the token's text
 * puts one there, so an interpolation that opens or closes it (`:not(@{l})`,
 * `:has(> @{l})`, `:not(.k, @{l})`) is a whole compound of that argument.
 */
export const selectorPlace = (parts: readonly InterpPart[], at: number, token: object | CompoundIn, gluedAfter: boolean, nameAfter: boolean): SelectorPlace => {
  const before = parts[at - 1];
  const after = parts[at + 1];
  if (nameAfter) {
    return PLACE_NAME;
  }
  if (before === undefined ? typeof token === 'object' : !('lit' in before) || !separates(before.lit.charCodeAt(before.lit.length - 1))) {
    return PLACE_GLUED;
  }
  if (after === undefined ? gluedAfter : !('lit' in after) || !separates(after.lit.charCodeAt(0))) {
    return PLACE_OPENS;
  }
  return token === 'argument' || before !== undefined || after !== undefined ? PLACE_ARGUMENT : PLACE_ALONE;
};

/**
 * [selector-capture] What a comma list's `branches` splice into a selector at `place`
 * (`selector`: whether it is a selector value, {@link isSelectorValue}, or one selector
 * of one, {@link isSelectorItem}):
 * the text appended, or the texts that multiply the branch. At whole-selector position,
 * one branch per item. A selector value (ledger P49, P50) is placed as `&` is: with a name glued after it, it
 * multiplies the branch, one per selector, as `&__x` does; anywhere else it is one
 * `:is()` group, as `&` stands for `:is(parent)` (`.fruit-cap-:is(apple, satsuma)`,
 * `:is(.btn, .button):hover`, `.c :is(a, b)`), one selector written bare only where
 * nothing is glued before it. A plain list is text: each item is spliced and multiplies
 * the branch (`.col-sm, .col-md`, `sm:hover, md:hover`, `.c a, .c b`), except as a whole
 * compound of a pseudo's argument, where it is one `:is()` item of that argument
 * (`:not(:is(b, i))`), never a rule per item. Owner 2026-10-21: "`@foo: one, two;` is
 * different from: `@foo: selector(one, two);` the latter, with @{foo} is an :is()".
 */
export const placeSelectorList = (branches: string[], selector: boolean, place: SelectorPlace): string[] | string =>
  place === PLACE_NAME || place === PLACE_WHOLE || (place !== PLACE_ARGUMENT && !selector)
    ? branches
    : branches.length === 1 && place !== PLACE_GLUED ? branches[0]! : isUnit(branches.join(', '));

/** `out` with `text` appended to each of its branches. */
export const appendText = (out: SelectorText, text: string): SelectorText =>
  typeof out === 'string' ? out + text : out.map(value => value + text);
