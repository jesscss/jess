import { defineFunction } from '@jesscss/core/value';
import { cssMinMax } from './min-max.js';

/** The CSS `min()` — identical in every dialect. See `min-max.ts`. */
const min = defineFunction('min', {
  params: [{ kinds: ['Dimension'] }],
  variadic: true,
  body: list => cssMinMax(true, list, false)
});

export { min };
export default min;
