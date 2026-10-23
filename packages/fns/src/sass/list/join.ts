import { defineFunction } from '@jesscss/core';
import { createSassListResult, getSassListInfo, resolveSassBracketed, resolveSassSeparator } from './util.js';

/*
 * An empty list and a one-item list written without a separator (`()`, `[]`,
 * `[1]`) have no separator of their own, so the join takes the second list's
 * (Dart Sass: `list.join([1], (2,))` is `[1, 2]`), else a space.
 */
const undecided = (info: ReturnType<typeof getSassListInfo>): boolean => info.sep === ' ' && info.values.length <= 1;

const join = defineFunction('join', {
  params: [
    { name: 'list1', type: 'any' },
    { name: 'list2', type: 'any' },
    { name: 'separator', type: ['Quoted', 'Keyword'], optional: true },
    { name: 'bracketed', type: ['Bool', 'Quoted', 'Keyword'], optional: true }
  ] as const,
  body: (list1, list2, separator, bracketed) => {
    const left = getSassListInfo(list1);
    const right = getSassListInfo(list2);
    const sep = resolveSassSeparator(separator, undecided(left) ? undecided(right) ? ' ' : right.sep : left.sep);
    const isBracketed = resolveSassBracketed(bracketed, left.bracketed);
    return createSassListResult([...left.values, ...right.values], sep, isBracketed);
  }
});

export default join;
