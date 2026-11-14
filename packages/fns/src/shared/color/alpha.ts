import { makeDimension, define, checkColor } from '@jesscss/core/value';

/** Less/Sass `alpha()` over the canonical value domain. */
const alpha = define('alpha', {
  params: [{ name: 'color', type: 'Color', check: checkColor }] as const,
  body: color => makeDimension(Math.min(Math.max(color.alpha, 0), 1))
});

export default alpha;
