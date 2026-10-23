import { commaListWithComments } from '@jesscss/core/ast';
import type { ValueSlot } from '@jesscss/core/ast';
import type { FieldMap } from 'parseman';
import { isLessValueSlotValue, lessParenFrom, separatorsFromFields } from './grammar-helpers.js';
import { separatorRawIndexes } from './trivia-layout.js';

/**
 * A value-position `Paren` whose items commas separate (`(1, 2)`,
 * `foo((c, d), e)`): the comma list `ValueList` builds, its separators'
 * comments kept as `ValueList` keeps them. The separators are the grammar's
 * `separator` captures; each item between them is read as a lone group's
 * content is, its math folded as a value's.
 */
export function lessParenListFrom(children: readonly unknown[], rawChildren: readonly unknown[], fields: FieldMap, triviaLog: readonly number[], state: unknown): ValueSlot {
  const items: ValueSlot[] = [];
  let from = 0;
  for (const at of [...separatorRawIndexes(rawChildren, separatorsFromFields(fields)), children.length]) {
    items.push(lessParenFrom(children.slice(from, at), rawChildren.slice(from, at), state, true));
    from = at + 1;
  }
  return commaListWithComments(items, fields, triviaLog, state, isLessValueSlotValue);
}
