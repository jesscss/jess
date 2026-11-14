import { groupItems, makeDimension, define, checkAny } from '@jesscss/core/value';

/** Sass `list.length()`; scalar values are one-item lists. */
const length = define('length', {
  params: [{ name: 'list', type: 'any', check: checkAny }] as const,
  body: list => makeDimension(groupItems(list).length)
});

export default length;
