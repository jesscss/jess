import { defineFunction } from '@jesscss/core';
import { sassMinMax } from './min-max.js';

/** The global Sass `max()` — a bare call, preserved by the engine when it fails. */
const max = defineFunction('max', {
  params: [{ type: 'Dimension' }],
  variadic: true,
  body: list => sassMinMax(false, list, false)
});

/** `math.max()` — the MODULE form; explicitly namespaced, so failure reaches the user. */
const mathMax = defineFunction('max', {
  params: [{ type: 'Dimension' }],
  variadic: true,
  body: list => sassMinMax(false, list, true)
});

export { max, mathMax };
export default max;
