import { defineFunction } from '@jesscss/core';
import { minMax } from './min-max.js';

/** Less `max()` — reference-unit coercion, canonical comparison. */
const max = defineFunction('max', {
  params: [{ type: 'Dimension' }],
  variadic: true,
  body: list => minMax(false, list)
});

export { max };
export default max;
