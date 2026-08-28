import { defineFunction, groupItems, makeDimension } from '@jesscss/core';

/** Sass `list.length()`; scalar values are one-item lists. */
const length = defineFunction('length', {
  params: [{ name: 'list', type: 'any' }] as const,
  body: list => makeDimension(groupItems(list).length)
});

export default length;
