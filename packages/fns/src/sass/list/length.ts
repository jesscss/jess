import { coerceListItems, defineFunction, makeDimension } from '@jesscss/core/value';

/** Sass `list.length()`; scalar values are one-item lists. */
const length = defineFunction('length', {
  params: [{ name: 'list', kinds: 'any' }] as const,
  body: list => makeDimension(coerceListItems(list).length)
});

export default length;
