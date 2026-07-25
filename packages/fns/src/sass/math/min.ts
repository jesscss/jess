import { defineFunction } from '@jesscss/core/value';
import { sassMinMax } from './min-max.js';

/** The global Sass `min()` — reduces when it can, otherwise survives as plain CSS. */
const min = defineFunction('min', {
  params: [{ kinds: ['Dimension'] }],
  variadic: true,
  body: list => sassMinMax(true, list, false)
});

/** `math.min()` — the same reduction, but incompatible units RAISE. */
const mathMin = defineFunction('min', {
  params: [{ kinds: ['Dimension'] }],
  variadic: true,
  body: list => sassMinMax(true, list, true)
});

export { min, mathMin };
export default min;
