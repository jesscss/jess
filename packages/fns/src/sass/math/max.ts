import { defineFunction } from '@jesscss/core/value';
import { cssMinMax } from '../../shared/math/min-max.js';

/**
 * `math.max()` — the MODULE form. Same reduction as the CSS `max()` (which
 * lives in `shared/math/`), but explicitly namespaced, so it is unambiguously
 * not a CSS function and must raise rather than be preserved.
 */
const mathMax = defineFunction('max', {
  params: [{ kinds: ['Dimension'] }],
  variadic: true,
  body: list => cssMinMax(false, list, true)
});

export { mathMax };
export default mathMax;
