import type { ValueSlot } from './nodes.js';
import { isValueSlotArray } from './css-grammar-helpers.js';

export const WHITESPACE = /^[ \t\n\r\f]+$/u;

/**
 * `jess-parser` `delimRun` / `paddedDelimRun` / `gluedDelim`: the delims a
 * `.jess` value run joins (ledger N18) — glued, or after whitespace when it
 * does not start with `>` or `~`, a comment beside it included; `:` or `.`
 * glued only.
 */
const DELIM = /^[=<>|~^?]+$/u;
const PADDED_DELIM = /^[=<|^?][=<>|~^?]*$/u;
const GLUED_DELIM = /^[:.]$/u;

function isDelim(part: ValueSlot | undefined, delim: RegExp): boolean {
  return part !== undefined && !isValueSlotArray(part) && part.type === 'Any' && delim.test(part.src);
}

/**
 * `sep` between two value parts as `.jess`'s `ValueSpaceGroup` writes it, or
 * the `gap` it cannot express.
 */
export function runSeparator(before: ValueSlot | undefined, part: ValueSlot, sep: string, gap: (nodeType: string, reason: string) => never): string {
  if (isDelim(before, GLUED_DELIM) || isDelim(part, GLUED_DELIM)) {
    return sep === '' ? sep : gap('Any', 'a padded `:` or `.`: a `.jess` value joins them only glued');
  }
  if (isDelim(part, DELIM) && sep !== '' && !isDelim(part, PADDED_DELIM)) {
    return gap('Any', 'a `>` or `~` after whitespace: a `.jess` block reads it as a selector combinator');
  }
  return WHITESPACE.test(sep) || isDelim(before, DELIM) || isDelim(part, DELIM)
    ? sep
    : gap('Comment', 'a comment between value parts: `ValueSpaceGroup` separators are whitespace only');
}
