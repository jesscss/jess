import { defineFunction, makeDimension } from '@jesscss/core/value';

/** Less/Sass `alpha()` over the canonical value domain. */
const alpha = defineFunction('alpha', {
  params: [{ name: 'color', kinds: ['Color'] }] as const,
  body: color => makeDimension(Math.min(Math.max(color.alpha, 0), 1))
});

export default alpha;
