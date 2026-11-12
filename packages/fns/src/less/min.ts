import { defineFunction } from '@jesscss/core/value';
import { fitsBeside, minMax } from './min-max.js';

/** Less `min()` — reference-unit coercion, canonical comparison. */
const min = /* @__PURE__ */ defineFunction('min', {
  params: [{ type: 'Dimension', fits: fitsBeside }],
  variadic: true,
  body: list => minMax(true, list)
});

export { min };
export default min;
