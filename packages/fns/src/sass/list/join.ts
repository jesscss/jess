import { define, checkAny, checkKinds, optional } from '@jesscss/core/value';
import { createSassListResult, getSassListInfo, resolveSassBracketed, resolveSassSeparator } from './util.js';

/*
 * An empty list and a one-item list written without a separator (`()`, `[]`,
 * `[1]`) have no separator of their own, so the join takes the second list's
 * (Dart Sass: `list.join([1], (2,))` is `[1, 2]`), else a space.
 */
const undecided = (info: ReturnType<typeof getSassListInfo>): boolean => info.sep === ' ' && info.values.length <= 1;

const join = define('join', {
  params: [
    { name: 'list1', type: 'any', check: checkAny },
    { name: 'list2', type: 'any', check: checkAny },
    /* @__PURE__ */ optional({ type: ['Quoted', 'Keyword'], check: checkKinds, name: 'separator' }),
    /* @__PURE__ */ optional({ type: ['Bool', 'Quoted', 'Keyword'], check: checkKinds, name: 'bracketed' })
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
