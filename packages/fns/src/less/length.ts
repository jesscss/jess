import { asList, coerceListItems, defineFunction, makeDimension } from '@jesscss/core/value';

/**
 * Less `length()` — the number of items in a list (or `1` for a single value).
 * @param value a list or single value
 * @returns the item count as a unitless `Dimension`
 */
const length = defineFunction('length', {
  params: [{ kinds: 'any' }],
  variadic: true,
  body: (list) => {
    const args = asList(list);
    const items = args.sep === ',' ? coerceListItems(args.value[0]) : args.value;
    return makeDimension(items.length);
  }
});

export default length;
