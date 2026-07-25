import { defineFunction } from '@jesscss/core/value';
import { cssMinMax } from '../../shared/math/min-max.js';

/**
 * `math.min()` — the MODULE form. Same reduction as the CSS `min()` (which
 * lives in `shared/math/`), but explicitly namespaced, so it is unambiguously
 * not a CSS function and must raise rather than be preserved.
 */
const mathMin = defineFunction('min', {
  params: [{ kinds: ['Dimension'] }],
  variadic: true,
  body: list => cssMinMax(true, list, true)
});

export { mathMin };
export default mathMin;
