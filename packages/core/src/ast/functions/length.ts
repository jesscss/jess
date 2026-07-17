import { makeDimension } from '../value-factory.js';
import { asList, coerceListItems } from './list-helper.js';
import type { Fn } from './types.js';

/**
 * `length(list)` — the element count of a list, as a unitless dimension. A
 * space-group call (`length(a b c)`, bridged to modern space args) counts the
 * args directly; a comma call passes SEPARATE arguments so Less counts only the
 * FIRST (`length(a, b, c)` = 1 — commas are argument delimiters, per Less 4.x),
 * while a list bound to a variable (`@l: a b c; length(@l)`) recovers its
 * elements. Variadic: receives the raw arg `List`.
 */
export const length: Fn = {
  name: 'length',
  params: [{ kinds: 'any' }],
  variadic: true,
  body: (list) => {
    const l = asList(list);
    const items = l.sep === ',' ? coerceListItems(l.items[0]) : l.items;
    return makeDimension(items.length, '');
  },
};
