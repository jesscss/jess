import { defineFunction, groupItems, makeDimension } from '@jesscss/core/value';

/**
 * Less `length()` — the number of items in a list (or `1` for a single value).
 * @param value a list or single value
 * @returns the item count as a unitless `Dimension`
 */
const length = /* @__PURE__ */ defineFunction('length', {
  params: [{ type: 'any' }],
  variadic: true,
  body: args => makeDimension(groupItems(args[0]).length)
});

export default length;
