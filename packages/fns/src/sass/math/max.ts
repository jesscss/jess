import { defineFunction } from '@jesscss/core/value';
import { sassMinMax } from './min-max.js';

/** The global Sass `max()` — reduces when it can, otherwise survives as plain CSS. */
const max = defineFunction('max', {
  params: [{ kinds: ['Dimension'] }],
  variadic: true,
  body: list => sassMinMax(false, list, false)
});

/** `math.max()` — the same reduction, but a non-number or incompatible units RAISE. */
const mathMax = defineFunction('max', {
  params: [{ kinds: ['Dimension'] }],
  variadic: true,
  body: list => sassMinMax(false, list, true)
});

export { max, mathMax };
export default max;
