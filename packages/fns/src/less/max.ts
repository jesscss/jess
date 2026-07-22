import { asList, defineFunction } from '@jesscss/core/value';
import { minMax } from './min-max.js';

/** Less `max()` with typed list flattening and mode-aware unit reduction. */
const max = defineFunction('max', {
  params: [{ kinds: ['Dimension'] }],
  variadic: true,
  body: (list, context) => minMax(false, asList(list), context.modes)
});

export { max };
export default max;
