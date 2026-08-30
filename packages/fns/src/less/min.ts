import { defineFunction } from '@jesscss/core';
import { minMax } from './min-max.js';

/** Less `min()` — reference-unit coercion, canonical comparison. */
const min = defineFunction('min', {
  params: [{ type: 'Dimension' }],
  variadic: true,
  body: list => minMax(true, list)
});

export { min };
export default min;
