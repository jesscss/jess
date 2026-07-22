import { defineFunction } from '@jesscss/core/value';
import { createSassListResult, getSassListInfo, resolveSassBracketed, resolveSassSeparator } from './util.js';

const join = defineFunction('join', {
  params: [
    { name: 'list1', kinds: 'any' },
    { name: 'list2', kinds: 'any' },
    { name: 'separator', kinds: ['Quoted', 'Keyword'], optional: true },
    { name: 'bracketed', kinds: ['Bool', 'Quoted', 'Keyword'], optional: true }
  ] as const,
  body: (list1, list2, separator, bracketed) => {
    const left = getSassListInfo(list1);
    const right = getSassListInfo(list2);
    const sep = resolveSassSeparator(separator, left.sep ?? right.sep);
    const isBracketed = resolveSassBracketed(bracketed, left.bracketed);
    return createSassListResult([...left.values, ...right.values], sep, isBracketed);
  }
});

export default join;
