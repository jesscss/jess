import { groupItems, makeDimension, define, checkAny } from '@jesscss/core/value';

/**
 * Less `length()` — the number of items in a list (or `1` for a single value).
 * @param value a list or single value
 * @returns the item count as a unitless `Dimension`
 */
const length = /* @__PURE__ */ define('length', {
  params: [{ type: 'any', check: checkAny }],
  variadic: true,
  body: args => makeDimension(groupItems(args[0]).length)
});

export default length;
