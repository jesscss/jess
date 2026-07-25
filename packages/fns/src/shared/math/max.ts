import { defineFunction } from '@jesscss/core/value';
import { cssMinMax } from './min-max.js';

/** The CSS `max()` — identical in every dialect. See `min-max.ts`. */
const max = defineFunction('max', {
  params: [{ kinds: ['Dimension'] }],
  variadic: true,
  body: list => cssMinMax(false, list, false)
});

export { max };
export default max;
