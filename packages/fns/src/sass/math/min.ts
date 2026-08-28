import { defineFunction } from '@jesscss/core';
import { sassMinMax } from './min-max.js';

/** The global Sass `min()` — a bare call, preserved by the engine when it fails. */
const min = defineFunction('min', {
  params: [{ type: 'Dimension' }],
  variadic: true,
  body: list => sassMinMax(true, list, false)
});

/** `math.min()` — the MODULE form; explicitly namespaced, so failure reaches the user. */
const mathMin = defineFunction('min', {
  params: [{ type: 'Dimension' }],
  variadic: true,
  body: list => sassMinMax(true, list, true)
});

export { min, mathMin };
export default min;
