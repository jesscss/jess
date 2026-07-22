import { defineFunction, groupItems, makeDimension } from '@jesscss/core/value';

/** Sass `list.length()`; scalar values are one-item lists. */
const length = defineFunction('length', {
  params: [{ name: 'list', kinds: 'any' }] as const,
  body: list => makeDimension(groupItems(list).length)
});

export default length;
