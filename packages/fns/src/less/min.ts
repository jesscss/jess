import { asList, defineFunction } from '@jesscss/core/value';
import { minMax } from './min-max.js';

/** Less `min()` with typed list flattening and mode-aware unit reduction. */
const min = defineFunction('min', {
  params: [{ kinds: ['Dimension'] }],
  variadic: true,
  body: (list, context) => minMax(true, asList(list), context.modes)
});

export { min };
export default min;
